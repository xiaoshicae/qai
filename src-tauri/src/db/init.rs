use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Connection>);
pub struct HttpClient(pub reqwest::Client);

pub fn initialize_database(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;
    let db_path = app_dir.join("qai.db");

    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    create_tables(&conn)?;
    migrate_if_needed(&conn)?;

    app.manage(DbState(Mutex::new(conn)));
    app.manage(HttpClient(
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build http client"),
    ));
    Ok(())
}

pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS groups (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            parent_id  TEXT REFERENCES groups(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS collections (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            group_id    TEXT REFERENCES groups(id) ON DELETE SET NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS collection_items (
            id             TEXT PRIMARY KEY,
            collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            parent_id      TEXT REFERENCES collection_items(id) ON DELETE CASCADE,
            type           TEXT NOT NULL DEFAULT 'request' CHECK(type IN ('folder', 'chain', 'request')),
            name           TEXT NOT NULL,
            sort_order     INTEGER NOT NULL DEFAULT 0,
            method         TEXT NOT NULL DEFAULT 'GET',
            url            TEXT NOT NULL DEFAULT '',
            headers        TEXT NOT NULL DEFAULT '[]',
            query_params   TEXT NOT NULL DEFAULT '[]',
            body_type      TEXT NOT NULL DEFAULT 'none',
            body_content   TEXT NOT NULL DEFAULT '',
            extract_rules  TEXT NOT NULL DEFAULT '[]',
            description    TEXT NOT NULL DEFAULT '',
            expect_status  INTEGER NOT NULL DEFAULT 200,
            poll_config    TEXT NOT NULL DEFAULT '',
            created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS assertions (
            id         TEXT PRIMARY KEY,
            item_id    TEXT NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
            type       TEXT NOT NULL,
            expression TEXT NOT NULL DEFAULT '',
            operator   TEXT NOT NULL DEFAULT 'eq',
            expected   TEXT NOT NULL DEFAULT '',
            enabled    INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS executions (
            id               TEXT PRIMARY KEY,
            item_id          TEXT NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
            collection_id    TEXT NOT NULL DEFAULT '',
            batch_id         TEXT,
            status           TEXT NOT NULL,
            request_url      TEXT NOT NULL,
            request_method   TEXT NOT NULL,
            response_status  INTEGER,
            response_headers TEXT NOT NULL DEFAULT '{}',
            response_body    TEXT,
            response_time_ms INTEGER NOT NULL DEFAULT 0,
            response_size    INTEGER NOT NULL DEFAULT 0,
            assertion_results TEXT NOT NULL DEFAULT '[]',
            error_message    TEXT,
            executed_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS environments (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS env_variables (
            id             TEXT PRIMARY KEY,
            environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
            key            TEXT NOT NULL,
            value          TEXT NOT NULL DEFAULT '',
            enabled        INTEGER NOT NULL DEFAULT 1,
            sort_order     INTEGER NOT NULL DEFAULT 0,
            UNIQUE(environment_id, key)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_groups_parent ON groups(parent_id);
        CREATE INDEX IF NOT EXISTS idx_collections_group ON collections(group_id);
        CREATE INDEX IF NOT EXISTS idx_items_collection ON collection_items(collection_id);
        CREATE INDEX IF NOT EXISTS idx_items_parent ON collection_items(parent_id);
        CREATE INDEX IF NOT EXISTS idx_assertions_item ON assertions(item_id);
        CREATE INDEX IF NOT EXISTS idx_executions_item ON executions(item_id);
        CREATE INDEX IF NOT EXISTS idx_executions_batch ON executions(batch_id);
        CREATE INDEX IF NOT EXISTS idx_executions_collection ON executions(collection_id);
        CREATE INDEX IF NOT EXISTS idx_env_variables_env ON env_variables(environment_id);
        ",
    )?;
    Ok(())
}

/// 检测旧表并迁移数据
fn migrate_if_needed(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 检查是否存在旧的 requests 表（说明需要迁移）
    let has_old_requests: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='requests'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_old_requests {
        return Ok(());
    }

    log::info!("检测到旧表结构，开始迁移...");

    // 确保旧表有新增列（兼容更早版本）
    let alter_migrations = [
        "ALTER TABLE requests ADD COLUMN extract_rules TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE folders ADD COLUMN is_chain INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE requests ADD COLUMN description TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE requests ADD COLUMN expect_status INTEGER NOT NULL DEFAULT 200",
        "ALTER TABLE collections ADD COLUMN category TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE collections ADD COLUMN endpoint TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE collections ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE requests ADD COLUMN poll_config TEXT NOT NULL DEFAULT ''",
    ];
    for sql in &alter_migrations {
        let _ = conn.execute(sql, []);
    }

    // 1. 从旧 collections.category 创建 groups
    let mut stmt = conn.prepare("SELECT DISTINCT category FROM collections WHERE category != ''")?;
    let categories: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    for cat in &categories {
        let group_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO groups (id, name, sort_order) VALUES (?1, ?2, 0)",
            rusqlite::params![group_id, cat],
        )?;
    }

    // 2. 给旧 collections 关联 group_id（如果还没有 group_id 列则加上）
    let _ = conn.execute("ALTER TABLE collections ADD COLUMN group_id TEXT", []);
    conn.execute_batch(
        "UPDATE collections SET group_id = (SELECT id FROM groups WHERE name = collections.category) WHERE category != '' AND group_id IS NULL;"
    )?;

    // 3. 迁移 folders → collection_items
    conn.execute_batch(
        "INSERT OR IGNORE INTO collection_items (id, collection_id, parent_id, type, name, sort_order, created_at, updated_at)
         SELECT id, collection_id, parent_folder_id,
                CASE WHEN is_chain = 1 THEN 'chain' ELSE 'folder' END,
                name, sort_order, created_at, updated_at
         FROM folders;"
    )?;

    // 4. 迁移 requests → collection_items
    conn.execute_batch(
        "INSERT OR IGNORE INTO collection_items (id, collection_id, parent_id, type, name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, created_at, updated_at)
         SELECT id, collection_id, folder_id, 'request', name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, created_at, updated_at
         FROM requests;"
    )?;

    // 5. 迁移 assertions（request_id → item_id）
    let has_old_assertions: bool = conn
        .query_row("SELECT count(*) FROM pragma_table_info('assertions') WHERE name='request_id'", [], |row| row.get::<_, i32>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_old_assertions {
        conn.execute_batch(
            "INSERT OR IGNORE INTO assertions (id, item_id, type, expression, operator, expected, enabled, sort_order, created_at)
             SELECT id, request_id, type, expression, operator, expected, enabled, sort_order, created_at
             FROM assertions WHERE request_id IN (SELECT id FROM collection_items);"
        )?;
        // 注意：旧 assertions 表如果结构不同，上面 INSERT OR IGNORE 会跳过
    }

    // 6. 迁移 executions（request_id → item_id）
    let has_old_executions: bool = conn
        .query_row("SELECT count(*) FROM pragma_table_info('executions') WHERE name='request_id'", [], |row| row.get::<_, i32>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_old_executions {
        // 新旧 executions 结构差异大，重建
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS executions_new (
                id TEXT PRIMARY KEY, item_id TEXT NOT NULL, collection_id TEXT NOT NULL DEFAULT '',
                batch_id TEXT, status TEXT NOT NULL, request_url TEXT NOT NULL, request_method TEXT NOT NULL,
                response_status INTEGER, response_headers TEXT NOT NULL DEFAULT '{}',
                response_body TEXT, response_time_ms INTEGER NOT NULL DEFAULT 0,
                response_size INTEGER NOT NULL DEFAULT 0, assertion_results TEXT NOT NULL DEFAULT '[]',
                error_message TEXT, executed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            INSERT OR IGNORE INTO executions_new (id, item_id, collection_id, batch_id, status, request_url, request_method, response_status, response_headers, response_body, response_time_ms, response_size, assertion_results, error_message, executed_at)
            SELECT e.id, e.request_id, COALESCE(ci.collection_id, ''), e.batch_id, e.status, e.request_url, e.request_method, e.response_status, e.response_headers, e.response_body, e.response_time_ms, e.response_size, e.assertion_results, e.error_message, e.executed_at
            FROM executions e LEFT JOIN collection_items ci ON ci.id = e.request_id;"
        )?;
    }

    // 7. 删除旧表
    conn.execute_batch(
        "DROP TABLE IF EXISTS executions;
         ALTER TABLE executions_new RENAME TO executions;
         DROP TABLE IF EXISTS requests;
         DROP TABLE IF EXISTS folders;"
    )?;

    // 8. 重建索引
    let _ = conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_executions_item ON executions(item_id);
         CREATE INDEX IF NOT EXISTS idx_executions_batch ON executions(batch_id);
         CREATE INDEX IF NOT EXISTS idx_executions_collection ON executions(collection_id);"
    );

    // 9. 清理旧 collections 列（SQLite 不能 DROP COLUMN，但新数据不再使用这些字段）
    // category/endpoint/subcategory 留着不影响，新代码不读取

    // 10. 删除旧 settings
    let _ = conn.execute("DELETE FROM settings WHERE key = 'category_order'", []);

    log::info!("数据迁移完成");
    Ok(())
}
