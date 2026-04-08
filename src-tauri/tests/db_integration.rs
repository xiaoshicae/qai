use rusqlite::Connection;

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    qai_lib::db::init::create_tables(&conn).unwrap();
    conn
}

// ─── Collection CRUD ────────────────────────────────────────

#[test]
fn test_collection_crud() {
    let conn = setup_db();

    let col = qai_lib::db::collection::create(&conn, "Test API", "desc", None).unwrap();
    assert_eq!(col.name, "Test API");
    assert_eq!(col.description, "desc");

    let all = qai_lib::db::collection::list_all(&conn).unwrap();
    assert_eq!(all.len(), 1);

    let updated = qai_lib::db::collection::update(
        &conn,
        &col.id,
        Some("Updated"),
        Some("new desc"),
        None,
        None,
    )
    .unwrap();
    assert_eq!(updated.name, "Updated");
    assert_eq!(updated.description, "new desc");

    qai_lib::db::collection::delete(&conn, &col.id).unwrap();
    let all = qai_lib::db::collection::list_all(&conn).unwrap();
    assert_eq!(all.len(), 0);
}

// ─── Item CRUD ──────────────────────────────────────────────

#[test]
fn test_item_crud() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();

    let item =
        qai_lib::db::item::create(&conn, &col.id, None, "request", "Get Users", "GET").unwrap();
    assert_eq!(item.method, "GET");
    assert_eq!(item.name, "Get Users");
    assert_eq!(item.item_type, "request");

    let updated = qai_lib::db::item::update(
        &conn,
        &item.id,
        &qai_lib::models::item::UpdateItemPayload {
            name: Some("List Users".into()),
            method: Some("POST".into()),
            url: Some("http://example.com/users".into()),
            body_type: Some("json".into()),
            body_content: Some(r#"{"page":1}"#.into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.name, "List Users");
    assert_eq!(updated.method, "POST");
    assert_eq!(updated.url, "http://example.com/users");
    assert_eq!(updated.body_type, "json");

    let all = qai_lib::db::item::list_by_collection(&conn, &col.id).unwrap();
    assert_eq!(all.len(), 1);

    qai_lib::db::item::delete(&conn, &item.id).unwrap();
    let all = qai_lib::db::item::list_by_collection(&conn, &col.id).unwrap();
    assert_eq!(all.len(), 0);
}

// ─── Assertion CRUD ─────────────────────────────────────────

#[test]
fn test_assertion_crud() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();

    let a =
        qai_lib::db::assertion::create(&conn, &item.id, "status_code", "", "eq", "200").unwrap();
    assert!(a.enabled);
    assert_eq!(a.operator, "eq");

    let updated = qai_lib::db::assertion::update(
        &conn,
        &a.id,
        None,
        None,
        Some("neq"),
        Some("404"),
        Some(false),
    )
    .unwrap();
    assert_eq!(updated.operator, "neq");
    assert_eq!(updated.expected, "404");
    assert!(!updated.enabled);

    let list = qai_lib::db::assertion::list_by_item(&conn, &item.id).unwrap();
    assert_eq!(list.len(), 1);

    qai_lib::db::assertion::delete(&conn, &a.id).unwrap();
    let list = qai_lib::db::assertion::list_by_item(&conn, &item.id).unwrap();
    assert_eq!(list.len(), 0);
}

// ─── 级联删除 ───────────────────────────────────────────────

#[test]
fn test_cascade_delete_collection() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();
    qai_lib::db::assertion::create(&conn, &item.id, "status_code", "", "eq", "200").unwrap();
    let folder =
        qai_lib::db::item::create(&conn, &col.id, None, "folder", "Folder", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, Some(&folder.id), "request", "Req2", "POST").unwrap();

    qai_lib::db::collection::delete(&conn, &col.id).unwrap();

    let items = qai_lib::db::item::list_by_collection(&conn, &col.id).unwrap();
    assert_eq!(items.len(), 0, "items should be cascade deleted");

    let assertions = qai_lib::db::assertion::list_by_item(&conn, &item.id).unwrap();
    assert_eq!(assertions.len(), 0, "assertions should be cascade deleted");
}

#[test]
fn test_cascade_delete_item_deletes_assertions() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();
    qai_lib::db::assertion::create(&conn, &item.id, "status_code", "", "eq", "200").unwrap();
    qai_lib::db::assertion::create(&conn, &item.id, "json_path", "$.id", "exists", "").unwrap();

    qai_lib::db::item::delete(&conn, &item.id).unwrap();

    let assertions = qai_lib::db::assertion::list_by_item(&conn, &item.id).unwrap();
    assert_eq!(
        assertions.len(),
        0,
        "assertions should be cascade deleted with item"
    );
}

// ─── Collection Tree ────────────────────────────────────────

#[test]
fn test_collection_tree_structure() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "My API", "", None).unwrap();
    let folder = qai_lib::db::item::create(&conn, &col.id, None, "folder", "Auth", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, Some(&folder.id), "request", "Login", "POST")
        .unwrap();
    qai_lib::db::item::create(&conn, &col.id, None, "request", "Health Check", "GET").unwrap();

    let tree = qai_lib::db::collection::get_tree(&conn, &col.id).unwrap();
    assert_eq!(tree.name, "My API");
    assert_eq!(tree.children.len(), 2);

    let folder_node = tree.children.iter().find(|c| c.name == "Auth").unwrap();
    assert_eq!(folder_node.children.len(), 1);
    assert_eq!(folder_node.children[0].name, "Login");
    assert_eq!(folder_node.children[0].method.as_deref(), Some("POST"));

    let req_node = tree
        .children
        .iter()
        .find(|c| c.name == "Health Check")
        .unwrap();
    assert_eq!(req_node.method.as_deref(), Some("GET"));
    assert!(req_node.children.is_empty());
}

#[test]
fn test_collection_tree_empty() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Empty", "", None).unwrap();
    let tree = qai_lib::db::collection::get_tree(&conn, &col.id).unwrap();
    assert!(tree.children.is_empty());
}

#[test]
fn test_collection_tree_nested_folders() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "API", "", None).unwrap();
    let f1 = qai_lib::db::item::create(&conn, &col.id, None, "folder", "Level1", "GET").unwrap();
    let f2 =
        qai_lib::db::item::create(&conn, &col.id, Some(&f1.id), "folder", "Level2", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, Some(&f2.id), "request", "Deep", "GET").unwrap();

    let tree = qai_lib::db::collection::get_tree(&conn, &col.id).unwrap();
    assert_eq!(tree.children.len(), 1);
    assert_eq!(tree.children[0].name, "Level1");
    assert_eq!(tree.children[0].children[0].name, "Level2");
    assert_eq!(tree.children[0].children[0].children[0].name, "Deep");
}

#[test]
fn test_collection_tree_chain_type() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "API", "", None).unwrap();
    let chain =
        qai_lib::db::item::create(&conn, &col.id, None, "chain", "Login Flow", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, Some(&chain.id), "request", "Step1", "POST").unwrap();

    let tree = qai_lib::db::collection::get_tree(&conn, &col.id).unwrap();
    let chain_node = &tree.children[0];
    assert!(matches!(
        chain_node.node_type,
        qai_lib::models::collection::TreeNodeType::Chain
    ));
    assert_eq!(chain_node.children.len(), 1);
}

// ─── Partial Update ─────────────────────────────────────────

#[test]
fn test_item_partial_update() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();

    let updated = qai_lib::db::item::update(
        &conn,
        &item.id,
        &qai_lib::models::item::UpdateItemPayload {
            url: Some("http://test.com".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.name, "Req");
    assert_eq!(updated.method, "GET");
    assert_eq!(updated.url, "http://test.com");
}

// ─── Item sort_order 自增 ───────────────────────────────────

#[test]
fn test_item_sort_order_auto_increment() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let i1 = qai_lib::db::item::create(&conn, &col.id, None, "request", "First", "GET").unwrap();
    let i2 = qai_lib::db::item::create(&conn, &col.id, None, "request", "Second", "GET").unwrap();
    let i3 = qai_lib::db::item::create(&conn, &col.id, None, "request", "Third", "GET").unwrap();

    assert_eq!(i1.sort_order, 0);
    assert_eq!(i2.sort_order, 1);
    assert_eq!(i3.sort_order, 2);
}

// ─── Item type 过滤 ─────────────────────────────────────────

#[test]
fn test_item_list_requests_only() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    qai_lib::db::item::create(&conn, &col.id, None, "folder", "Folder", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, None, "chain", "Chain", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, None, "request", "Req1", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, None, "request", "Req2", "POST").unwrap();

    let all = qai_lib::db::item::list_by_collection(&conn, &col.id).unwrap();
    assert_eq!(all.len(), 4);

    let requests = qai_lib::db::item::list_requests_by_collection(&conn, &col.id).unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|r| r.item_type == "request"));
}

// ─── 断言引擎：UTF-8 安全 ──────────────────────────────────

#[test]
fn test_assertion_body_contains_chinese() {
    use qai_lib::models::assertion::Assertion;
    use qai_lib::models::item::HttpResponse;

    let assertion = Assertion {
        id: "a1".into(),
        item_id: "r1".into(),
        assertion_type: "body_contains".into(),
        expression: "".into(),
        operator: "contains".into(),
        expected: "成功".into(),
        enabled: true,
        sort_order: 0,
        created_at: "".into(),
    };

    let long_body = "操作成功".repeat(50);
    let response = HttpResponse {
        status: 200,
        status_text: "OK".into(),
        headers: vec![],
        body: long_body,
        time_ms: 100,
        size_bytes: 600,
    };

    let results = qai_lib::runner::assertion::evaluate_assertions(&[assertion], &response);
    assert_eq!(results.len(), 1);
    assert!(results[0].passed);
}

// ─── 断言引擎：Header 大小写不敏感 ─────────────────────────

#[test]
fn test_assertion_header_case_insensitive() {
    use qai_lib::models::assertion::Assertion;
    use qai_lib::models::item::{HttpResponse, KeyValuePair};

    let assertion = Assertion {
        id: "a1".into(),
        item_id: "r1".into(),
        assertion_type: "header_contains".into(),
        expression: "Content-Type".into(),
        operator: "contains".into(),
        expected: "json".into(),
        enabled: true,
        sort_order: 0,
        created_at: "".into(),
    };

    let response = HttpResponse {
        status: 200,
        status_text: "OK".into(),
        headers: vec![KeyValuePair {
            key: "content-type".into(),
            value: "application/json".into(),
            enabled: true,
            field_type: String::new(),
        }],
        body: "{}".into(),
        time_ms: 50,
        size_bytes: 2,
    };

    let results = qai_lib::runner::assertion::evaluate_assertions(&[assertion], &response);
    assert!(results[0].passed);
}

// ─── 断言引擎：response_time ────────────────────────────────

#[test]
fn test_assertion_response_time() {
    use qai_lib::models::assertion::Assertion;
    use qai_lib::models::item::HttpResponse;

    let assertion = Assertion {
        id: "a1".into(),
        item_id: "r1".into(),
        assertion_type: "response_time".into(),
        expression: "".into(),
        operator: "lt".into(),
        expected: "500".into(),
        enabled: true,
        sort_order: 0,
        created_at: "".into(),
    };

    let response = HttpResponse {
        status: 200,
        status_text: "OK".into(),
        headers: vec![],
        body: "{}".into(),
        time_ms: 120,
        size_bytes: 2,
    };

    let results = qai_lib::runner::assertion::evaluate_assertions(&[assertion], &response);
    assert!(results[0].passed);
}

// ─── 断言引擎：disabled 跳过 ────────────────────────────────

#[test]
fn test_disabled_assertions_skipped() {
    use qai_lib::models::assertion::Assertion;
    use qai_lib::models::item::HttpResponse;

    let assertions = vec![
        Assertion {
            id: "a1".into(),
            item_id: "r1".into(),
            assertion_type: "status_code".into(),
            expression: "".into(),
            operator: "eq".into(),
            expected: "999".into(),
            enabled: false,
            sort_order: 0,
            created_at: "".into(),
        },
        Assertion {
            id: "a2".into(),
            item_id: "r1".into(),
            assertion_type: "status_code".into(),
            expression: "".into(),
            operator: "eq".into(),
            expected: "200".into(),
            enabled: true,
            sort_order: 1,
            created_at: "".into(),
        },
    ];

    let response = HttpResponse {
        status: 200,
        status_text: "OK".into(),
        headers: vec![],
        body: "".into(),
        time_ms: 50,
        size_bytes: 0,
    };

    let results = qai_lib::runner::assertion::evaluate_assertions(&assertions, &response);
    assert_eq!(results.len(), 1);
    assert!(results[0].passed);
}

// ─── Environment CRUD ───────────────────────────────────────

#[test]
fn test_environment_crud() {
    let conn = setup_db();
    let env = qai_lib::db::environment::create(&conn, "Dev").unwrap();
    assert_eq!(env.name, "Dev");
    assert!(!env.is_active);

    let updated = qai_lib::db::environment::update(&conn, &env.id, "Production").unwrap();
    assert_eq!(updated.name, "Production");

    let all = qai_lib::db::environment::list_all(&conn).unwrap();
    assert_eq!(all.len(), 1);

    qai_lib::db::environment::delete(&conn, &env.id).unwrap();
    let all = qai_lib::db::environment::list_all(&conn).unwrap();
    assert_eq!(all.len(), 0);
}

#[test]
fn test_environment_set_active() {
    let conn = setup_db();
    let e1 = qai_lib::db::environment::create(&conn, "Dev").unwrap();
    let e2 = qai_lib::db::environment::create(&conn, "Prod").unwrap();

    qai_lib::db::environment::set_active(&conn, &e1.id).unwrap();
    let active = qai_lib::db::environment::get_active(&conn).unwrap();
    assert!(active.is_some());
    assert_eq!(active.unwrap().environment.id, e1.id);

    qai_lib::db::environment::set_active(&conn, &e2.id).unwrap();
    let active = qai_lib::db::environment::get_active(&conn).unwrap();
    assert_eq!(active.unwrap().environment.id, e2.id);

    let e1_fresh = qai_lib::db::environment::get(&conn, &e1.id).unwrap();
    assert!(!e1_fresh.is_active);
}

#[test]
fn test_environment_get_active_none() {
    let conn = setup_db();
    let active = qai_lib::db::environment::get_active(&conn).unwrap();
    assert!(active.is_none());
}

#[test]
fn test_environment_save_variables() {
    use qai_lib::models::environment::EnvVariable;
    let conn = setup_db();
    let env = qai_lib::db::environment::create(&conn, "Dev").unwrap();

    let vars = vec![
        EnvVariable {
            id: String::new(),
            environment_id: env.id.clone(),
            key: "HOST".into(),
            value: "localhost".into(),
            enabled: true,
            sort_order: 0,
        },
        EnvVariable {
            id: String::new(),
            environment_id: env.id.clone(),
            key: "PORT".into(),
            value: "8080".into(),
            enabled: true,
            sort_order: 1,
        },
    ];
    qai_lib::db::environment::save_variables(&conn, &env.id, &vars).unwrap();

    let loaded = qai_lib::db::environment::list_variables(&conn, &env.id).unwrap();
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].key, "HOST");
    assert_eq!(loaded[1].key, "PORT");

    let new_vars = vec![EnvVariable {
        id: String::new(),
        environment_id: env.id.clone(),
        key: "TOKEN".into(),
        value: "abc".into(),
        enabled: true,
        sort_order: 0,
    }];
    qai_lib::db::environment::save_variables(&conn, &env.id, &new_vars).unwrap();
    let loaded = qai_lib::db::environment::list_variables(&conn, &env.id).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].key, "TOKEN");
}

// ─── Execution save & query ─────────────────────────────────

#[test]
fn test_execution_save_and_list() {
    use qai_lib::models::execution::Execution;
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();

    let exec = Execution {
        id: "exec-001".into(),
        item_id: item.id.clone(),
        collection_id: col.id.clone(),
        batch_id: None,
        status: "success".into(),
        request_url: "http://example.com".into(),
        request_method: "GET".into(),
        response_status: Some(200),
        response_headers: "{}".into(),
        response_body: Some("ok".into()),
        response_time_ms: 50,
        response_size: 2,
        assertion_results: r#"[{"passed":true,"actual":"200","message":"ok"}]"#.into(),
        error_message: None,
        executed_at: "2024-01-01 00:00:00".into(),
    };
    qai_lib::db::execution::save(&conn, &exec).unwrap();

    let runs = qai_lib::db::execution::list_by_item(&conn, &item.id, 10).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, "success");
    assert_eq!(runs[0].response_time_ms, 50);
}

#[test]
fn test_execution_cleanup() {
    use qai_lib::models::execution::Execution;
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();

    for i in 0..5 {
        let exec = Execution {
            id: format!("exec-{:03}", i),
            item_id: item.id.clone(),
            collection_id: col.id.clone(),
            batch_id: None,
            status: "success".into(),
            request_url: "http://example.com".into(),
            request_method: "GET".into(),
            response_status: Some(200),
            response_headers: "{}".into(),
            response_body: None,
            response_time_ms: 50,
            response_size: 0,
            assertion_results: "[]".into(),
            error_message: None,
            executed_at: format!("2024-01-01 00:00:0{}", i),
        };
        qai_lib::db::execution::save(&conn, &exec).unwrap();
    }

    let before = qai_lib::db::execution::list_by_item(&conn, &item.id, 100).unwrap();
    assert_eq!(before.len(), 5);

    let deleted = qai_lib::db::execution::cleanup(&conn, 2).unwrap();
    assert_eq!(deleted, 3);

    let after = qai_lib::db::execution::list_by_item(&conn, &item.id, 100).unwrap();
    assert_eq!(after.len(), 2);
}

#[test]
fn test_execution_get_last_status() {
    use qai_lib::models::execution::Execution;
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item1 = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req1", "GET").unwrap();
    let item2 = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req2", "POST").unwrap();

    // save() 不存 executed_at（用 DB 默认值），需手动 UPDATE 来设置不同时间戳
    for (id, item_id, status, time) in [
        ("e1", item1.id.as_str(), "success", "2024-01-01 00:00:00"),
        ("e2", item1.id.as_str(), "failed", "2024-01-01 00:00:01"),
        ("e3", item2.id.as_str(), "success", "2024-01-01 00:00:00"),
    ] {
        let exec = Execution {
            id: id.into(),
            item_id: item_id.into(),
            collection_id: col.id.clone(),
            batch_id: None,
            status: status.into(),
            request_url: "http://x.com".into(),
            request_method: "GET".into(),
            response_status: Some(200),
            response_headers: "{}".into(),
            response_body: None,
            response_time_ms: 50,
            response_size: 0,
            assertion_results: r#"[{"passed":true}]"#.into(),
            error_message: None,
            executed_at: String::new(),
        };
        qai_lib::db::execution::save(&conn, &exec).unwrap();
        conn.execute(
            "UPDATE executions SET executed_at = ?1 WHERE id = ?2",
            rusqlite::params![time, id],
        )
        .unwrap();
    }

    let statuses = qai_lib::db::execution::get_last_status_for_collection(&conn, &col.id).unwrap();
    assert_eq!(statuses.len(), 2);

    let s1 = statuses.iter().find(|s| s.item_id == item1.id).unwrap();
    assert_eq!(s1.status, "failed");
    let s2 = statuses.iter().find(|s| s.item_id == item2.id).unwrap();
    assert_eq!(s2.status, "success");
}

// ─── WebSocket protocol 字段 ────────────────────────────────

#[test]
fn test_item_protocol_default_http() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item =
        qai_lib::db::item::create(&conn, &col.id, None, "request", "HTTP Req", "GET").unwrap();
    assert_eq!(item.protocol, "http");
}

#[test]
fn test_item_protocol_update_to_websocket() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item =
        qai_lib::db::item::create(&conn, &col.id, None, "request", "WS Test", "GET").unwrap();
    assert_eq!(item.protocol, "http");

    let updated = qai_lib::db::item::update(
        &conn,
        &item.id,
        &qai_lib::models::item::UpdateItemPayload {
            url: Some("wss://api.example.com/ws".into()),
            body_type: Some("json".into()),
            body_content: Some(r#"{"text":"hello"}"#.into()),
            protocol: Some("websocket".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.protocol, "websocket");
    assert_eq!(updated.url, "wss://api.example.com/ws");
    assert_eq!(updated.body_type, "json");
}

#[test]
fn test_item_protocol_persists_on_reload() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "WS", "GET").unwrap();

    qai_lib::db::item::update(
        &conn,
        &item.id,
        &qai_lib::models::item::UpdateItemPayload {
            protocol: Some("websocket".into()),
            ..Default::default()
        },
    )
    .unwrap();

    // 重新读取验证持久化
    let reloaded = qai_lib::db::item::get(&conn, &item.id).unwrap();
    assert_eq!(reloaded.protocol, "websocket");
}

#[test]
fn test_item_protocol_unaffected_by_other_updates() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "WS", "GET").unwrap();

    // 先设为 websocket
    qai_lib::db::item::update(
        &conn,
        &item.id,
        &qai_lib::models::item::UpdateItemPayload {
            protocol: Some("websocket".into()),
            ..Default::default()
        },
    )
    .unwrap();

    // 只更新 name，不传 protocol
    let updated = qai_lib::db::item::update(
        &conn,
        &item.id,
        &qai_lib::models::item::UpdateItemPayload {
            name: Some("Renamed".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.protocol, "websocket"); // protocol 不变
}

#[test]
fn test_websocket_item_in_collection_tree() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "API", "", None).unwrap();

    // 创建一个 HTTP 请求和一个 WebSocket 请求
    qai_lib::db::item::create(&conn, &col.id, None, "request", "HTTP Health", "GET").unwrap();
    let ws_item =
        qai_lib::db::item::create(&conn, &col.id, None, "request", "WS TTS", "GET").unwrap();
    qai_lib::db::item::update(
        &conn,
        &ws_item.id,
        &qai_lib::models::item::UpdateItemPayload {
            url: Some("wss://api.example.com/ws".into()),
            protocol: Some("websocket".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let tree = qai_lib::db::collection::get_tree(&conn, &col.id).unwrap();
    assert_eq!(tree.children.len(), 2);

    // list_requests_by_collection 包含两者（不按 protocol 过滤）
    let requests = qai_lib::db::item::list_requests_by_collection(&conn, &col.id).unwrap();
    assert_eq!(requests.len(), 2);
    let ws = requests.iter().find(|r| r.name == "WS TTS").unwrap();
    assert_eq!(ws.protocol, "websocket");
}

// TODO: 导出/导入集成测试需要 commands 模块公开后启用
// 相关函数：import_replace_pub / import_merge_pub

/*
#[test]
fn test_export_import_replace_roundtrip() {
    use qai_lib::commands::import_cmd::{ExportData, ImportStats};

    // 1. 准备数据
    let conn = setup_db();
    let group = qai_lib::db::group::create(&conn, "TTS", None).unwrap();
    let col = qai_lib::db::collection::create(&conn, "Qwen3 TTS", "desc", Some(&group.id)).unwrap();
    let folder = qai_lib::db::item::create(&conn, &col.id, None, "folder", "API Tests", "GET").unwrap();
    let req = qai_lib::db::item::create(&conn, &col.id, Some(&folder.id), "request", "POST generate", "POST").unwrap();
    qai_lib::db::item::update(&conn, &req.id, &qai_lib::models::item::UpdateItemPayload {
        url: Some("http://example.com/api".into()),
        body_type: Some("json".into()),
        body_content: Some(r#"{"text":"hello"}"#.into()),
        ..Default::default()
    }).unwrap();
    qai_lib::db::assertion::create(&conn, &req.id, "status_code", "", "eq", "200").unwrap();
    let env = qai_lib::db::environment::create(&conn, "Production").unwrap();
    qai_lib::db::environment::save_variables(&conn, &env.id, &[
        qai_lib::models::environment::EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "base_url".into(), value: "http://prod.example.com".into(), enabled: true, sort_order: 0 },
    ]).unwrap();

    // 2. 导出
    let groups = qai_lib::db::group::list_all(&conn).unwrap();
    let collections = qai_lib::db::collection::list_all(&conn).unwrap();
    let mut all_items = Vec::new();
    for c in &collections {
        all_items.extend(qai_lib::db::item::list_by_collection(&conn, &c.id).unwrap());
    }
    let item_ids: Vec<String> = all_items.iter().map(|i| i.id.clone()).collect();
    let assertions_map = qai_lib::db::assertion::list_by_items(&conn, &item_ids).unwrap();
    let all_assertions: Vec<_> = assertions_map.into_values().flatten().collect();
    let environments = qai_lib::db::environment::list_all(&conn).unwrap();
    let mut all_env_vars = Vec::new();
    for e in &environments {
        all_env_vars.extend(qai_lib::db::environment::list_variables(&conn, &e.id).unwrap());
    }

    let data = ExportData {
        version: "1.0".into(),
        exported_at: "2026-04-08T10:00:00".into(),
        groups,
        collections,
        collection_items: all_items,
        assertions: all_assertions,
        environments,
        env_variables: all_env_vars,
    };

    let json = serde_json::to_string_pretty(&data).unwrap();

    // 3. 全量替换导入到新数据库
    let conn2 = setup_db();
    // 先加一些旧数据，验证会被清空
    qai_lib::db::collection::create(&conn2, "Old Collection", "", None).unwrap();

    let data2: ExportData = serde_json::from_str(&json).unwrap();
    let tx = conn2.unchecked_transaction().unwrap();
    let stats = qai_lib::commands::import_cmd::import_replace_pub(&tx, &data2).unwrap();
    tx.commit().unwrap();

    // 4. 验证
    assert_eq!(stats.groups, 1);
    assert_eq!(stats.collections, 1);
    assert_eq!(stats.items, 2); // folder + request
    assert_eq!(stats.assertions, 1);
    assert_eq!(stats.environments, 1);
    assert_eq!(stats.env_variables, 1);

    // 旧数据被清空
    let cols = qai_lib::db::collection::list_all(&conn2).unwrap();
    assert_eq!(cols.len(), 1);
    assert_eq!(cols[0].name, "Qwen3 TTS");

    // items 父子关系正确
    let items = qai_lib::db::item::list_by_collection(&conn2, &cols[0].id).unwrap();
    assert_eq!(items.len(), 2);
    let imported_folder = items.iter().find(|i| i.item_type == "folder").unwrap();
    let imported_req = items.iter().find(|i| i.item_type == "request").unwrap();
    assert_eq!(imported_req.parent_id.as_deref(), Some(imported_folder.id.as_str()));
    assert_eq!(imported_req.url, "http://example.com/api");

    // assertion 正确
    let asserts = qai_lib::db::assertion::list_by_item(&conn2, &imported_req.id).unwrap();
    assert_eq!(asserts.len(), 1);
    assert_eq!(asserts[0].expected, "200");

    // 环境变量正确
    let envs = qai_lib::db::environment::list_all(&conn2).unwrap();
    assert_eq!(envs.len(), 1);
    let vars = qai_lib::db::environment::list_variables(&conn2, &envs[0].id).unwrap();
    assert_eq!(vars.len(), 1);
    assert_eq!(vars[0].key, "base_url");
}

// ─── 导出/导入：Merge 模式 ──────────────────────────────────

#[test]
fn test_import_merge_upsert() {
    use qai_lib::commands::import_cmd::ExportData;

    // 1. 目标数据库已有一些数据
    let conn = setup_db();
    let existing_col = qai_lib::db::collection::create(&conn, "Qwen3 TTS", "old desc", None).unwrap();
    let existing_req = qai_lib::db::item::create(&conn, &existing_col.id, None, "request", "POST generate", "POST").unwrap();
    qai_lib::db::item::update(&conn, &existing_req.id, &qai_lib::models::item::UpdateItemPayload {
        url: Some("http://old.example.com".into()),
        ..Default::default()
    }).unwrap();

    // 2. 构造导入数据（同名 collection + 同名 request，应更新而非新建）
    let import_json = serde_json::json!({
        "version": "1.0",
        "exportedAt": "2026-04-08T10:00:00",
        "groups": [],
        "collections": [{
            "id": "ext-col-1",
            "name": "Qwen3 TTS",
            "description": "new desc",
            "groupId": null,
            "sortOrder": 0,
            "createdAt": "2026-04-08",
            "updatedAt": "2026-04-08"
        }],
        "collectionItems": [{
            "id": "ext-req-1",
            "collectionId": "ext-col-1",
            "parentId": null,
            "type": "request",
            "name": "POST generate",
            "sortOrder": 0,
            "method": "POST",
            "url": "http://new.example.com/api",
            "headers": "[]",
            "queryParams": "[]",
            "bodyType": "json",
            "bodyContent": "{\"text\":\"hello\"}",
            "extractRules": "[]",
            "description": "",
            "expectStatus": 200,
            "pollConfig": "",
            "protocol": "http",
            "createdAt": "2026-04-08",
            "updatedAt": "2026-04-08"
        }, {
            "id": "ext-req-2",
            "collectionId": "ext-col-1",
            "parentId": null,
            "type": "request",
            "name": "GET health",
            "sortOrder": 1,
            "method": "GET",
            "url": "http://new.example.com/health",
            "headers": "[]",
            "queryParams": "[]",
            "bodyType": "none",
            "bodyContent": "",
            "extractRules": "[]",
            "description": "",
            "expectStatus": 200,
            "pollConfig": "",
            "protocol": "http",
            "createdAt": "2026-04-08",
            "updatedAt": "2026-04-08"
        }],
        "assertions": [{
            "id": "ext-a1",
            "itemId": "ext-req-1",
            "type": "status_code",
            "expression": "",
            "operator": "eq",
            "expected": "200",
            "enabled": true,
            "sortOrder": 0,
            "createdAt": "2026-04-08"
        }],
        "environments": [],
        "envVariables": []
    });

    let data: ExportData = serde_json::from_value(import_json).unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    let stats = qai_lib::commands::import_cmd::import_merge_pub(&tx, &data).unwrap();
    tx.commit().unwrap();

    // 3. 验证：collection 没有新建（按名称匹配到已有的）
    let cols = qai_lib::db::collection::list_all(&conn).unwrap();
    assert_eq!(cols.len(), 1, "同名 collection 不应重复创建");
    assert_eq!(cols[0].id, existing_col.id, "应复用已有 collection ID");

    // 4. 验证：已有 request 被更新，新 request 被创建
    let items = qai_lib::db::item::list_by_collection(&conn, &existing_col.id).unwrap();
    assert_eq!(items.len(), 2, "应有 1 个已更新 + 1 个新建");

    let updated_req = items.iter().find(|i| i.name == "POST generate").unwrap();
    assert_eq!(updated_req.url, "http://new.example.com/api", "已有 request 的 URL 应被更新");
    assert_eq!(updated_req.id, existing_req.id, "应复用已有 request ID");

    let new_req = items.iter().find(|i| i.name == "GET health").unwrap();
    assert_eq!(new_req.url, "http://new.example.com/health");
    assert_eq!(stats.items, 1, "只有 GET health 是新建的");

    // 5. 验证：assertion 正确关联到已有 request
    let asserts = qai_lib::db::assertion::list_by_item(&conn, &updated_req.id).unwrap();
    assert_eq!(asserts.len(), 1);
    assert_eq!(asserts[0].expected, "200");
}
*/
