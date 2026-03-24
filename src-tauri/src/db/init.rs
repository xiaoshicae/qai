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
        CREATE TABLE IF NOT EXISTS collections (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS folders (
            id               TEXT PRIMARY KEY,
            collection_id    TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            parent_folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
            name             TEXT NOT NULL,
            sort_order       INTEGER NOT NULL DEFAULT 0,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS requests (
            id            TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
            name          TEXT NOT NULL,
            method        TEXT NOT NULL DEFAULT 'GET',
            url           TEXT NOT NULL DEFAULT '',
            headers       TEXT NOT NULL DEFAULT '[]',
            query_params  TEXT NOT NULL DEFAULT '[]',
            body_type     TEXT NOT NULL DEFAULT 'none',
            body_content  TEXT NOT NULL DEFAULT '',
            sort_order    INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS assertions (
            id          TEXT PRIMARY KEY,
            request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            type        TEXT NOT NULL,
            expression  TEXT NOT NULL DEFAULT '',
            operator    TEXT NOT NULL DEFAULT 'eq',
            expected    TEXT NOT NULL DEFAULT '',
            enabled     INTEGER NOT NULL DEFAULT 1,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS executions (
            id               TEXT PRIMARY KEY,
            request_id       TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            batch_id         TEXT,
            status           TEXT NOT NULL,
            request_url      TEXT NOT NULL,
            request_method   TEXT NOT NULL,
            request_headers  TEXT NOT NULL DEFAULT '{}',
            request_body     TEXT,
            response_status  INTEGER,
            response_headers TEXT NOT NULL DEFAULT '{}',
            response_body    TEXT,
            response_time_ms INTEGER NOT NULL DEFAULT 0,
            response_size    INTEGER NOT NULL DEFAULT 0,
            assertion_results TEXT NOT NULL DEFAULT '[]',
            error_message    TEXT,
            executed_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS environments (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS env_variables (
            id             TEXT PRIMARY KEY,
            environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
            key            TEXT NOT NULL,
            value          TEXT NOT NULL DEFAULT '',
            enabled        INTEGER NOT NULL DEFAULT 1,
            sort_order     INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_env_variables_env ON env_variables(environment_id);

        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_folders_collection ON folders(collection_id);
        CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id);
        CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests(folder_id);
        CREATE INDEX IF NOT EXISTS idx_assertions_request ON assertions(request_id);
        CREATE INDEX IF NOT EXISTS idx_executions_request ON executions(request_id);
        CREATE INDEX IF NOT EXISTS idx_executions_batch ON executions(batch_id);
        ",
    )?;
    Ok(())
}
