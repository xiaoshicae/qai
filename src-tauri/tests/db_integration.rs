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

    let updated = qai_lib::db::collection::update(&conn, &col.id, Some("Updated"), Some("new desc"), None).unwrap();
    assert_eq!(updated.name, "Updated");

    qai_lib::db::collection::delete(&conn, &col.id).unwrap();
    let all = qai_lib::db::collection::list_all(&conn).unwrap();
    assert_eq!(all.len(), 0);
}

// ─── Item CRUD ───────────────────────────────────────────

#[test]
fn test_item_crud() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();

    let item = qai_lib::db::item::create(&conn, &col.id, None, "request", "Get Users", "GET").unwrap();
    assert_eq!(item.method, "GET");
    assert_eq!(item.name, "Get Users");

    let updated = qai_lib::db::item::update(
        &conn, &item.id,
        Some("List Users"), Some("POST"), Some("http://example.com/users"),
        None, None, Some("json"), Some(r#"{"page":1}"#), None, None, None, None,
    ).unwrap();
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

    let a = qai_lib::db::assertion::create(&conn, &item.id, "status_code", "", "eq", "200").unwrap();
    assert!(a.enabled);
    assert_eq!(a.operator, "eq");

    let updated = qai_lib::db::assertion::update(&conn, &a.id, None, None, Some("neq"), Some("404"), Some(false)).unwrap();
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
    let req = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();
    qai_lib::db::assertion::create(&conn, &req.id, "status_code", "", "eq", "200").unwrap();
    let folder = qai_lib::db::item::create(&conn, &col.id, None, "folder", "Folder", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, Some(&folder.id), "request", "Req2", "POST").unwrap();

    qai_lib::db::collection::delete(&conn, &col.id).unwrap();

    let items = qai_lib::db::item::list_by_collection(&conn, &col.id).unwrap();
    assert_eq!(items.len(), 0, "items should be cascade deleted");

    let assertions = qai_lib::db::assertion::list_by_item(&conn, &req.id).unwrap();
    assert_eq!(assertions.len(), 0, "assertions should be cascade deleted");
}

#[test]
fn test_cascade_delete_item_deletes_assertions() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let req = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();
    qai_lib::db::assertion::create(&conn, &req.id, "status_code", "", "eq", "200").unwrap();
    qai_lib::db::assertion::create(&conn, &req.id, "json_path", "$.id", "exists", "").unwrap();

    qai_lib::db::item::delete(&conn, &req.id).unwrap();

    let assertions = qai_lib::db::assertion::list_by_item(&conn, &req.id).unwrap();
    assert_eq!(assertions.len(), 0, "assertions should be cascade deleted with item");
}

// ─── Collection Tree ────────────────────────────────────────

#[test]
fn test_collection_tree_structure() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "My API", "", None).unwrap();
    let folder = qai_lib::db::item::create(&conn, &col.id, None, "folder", "Auth", "GET").unwrap();
    qai_lib::db::item::create(&conn, &col.id, Some(&folder.id), "request", "Login", "POST").unwrap();
    qai_lib::db::item::create(&conn, &col.id, None, "request", "Health Check", "GET").unwrap();

    let tree = qai_lib::db::collection::get_tree(&conn, &col.id).unwrap();
    assert_eq!(tree.name, "My API");
    assert_eq!(tree.children.len(), 2); // 1 folder + 1 root request

    let folder_node = tree.children.iter().find(|c| c.name == "Auth").unwrap();
    assert_eq!(folder_node.children.len(), 1);
    assert_eq!(folder_node.children[0].name, "Login");
    assert_eq!(folder_node.children[0].method.as_deref(), Some("POST"));

    let req_node = tree.children.iter().find(|c| c.name == "Health Check").unwrap();
    assert_eq!(req_node.method.as_deref(), Some("GET"));
    assert!(req_node.children.is_empty());
}

// ─── Partial Update ─────────────────────────────────────

#[test]
fn test_item_partial_update() {
    let conn = setup_db();
    let col = qai_lib::db::collection::create(&conn, "Col", "", None).unwrap();
    let req = qai_lib::db::item::create(&conn, &col.id, None, "request", "Req", "GET").unwrap();

    let updated = qai_lib::db::item::update(&conn, &req.id, None, None, Some("http://test.com"), None, None, None, None, None, None, None, None).unwrap();
    assert_eq!(updated.name, "Req");
    assert_eq!(updated.method, "GET");
    assert_eq!(updated.url, "http://test.com");
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
        }],
        body: "{}".into(),
        time_ms: 50,
        size_bytes: 2,
    };

    let results = qai_lib::runner::assertion::evaluate_assertions(&[assertion], &response);
    assert!(results[0].passed, "header match should be case-insensitive");
}

// ─── 断言引擎：response_time 比较 ──────────────────────────

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
    assert!(results[0].passed, "120ms < 500ms should pass");
}

// ─── 断言引擎：disabled 断言被跳过 ─────────────────────────

#[test]
fn test_disabled_assertions_skipped() {
    use qai_lib::models::assertion::Assertion;
    use qai_lib::models::item::HttpResponse;

    let assertions = vec![
        Assertion {
            id: "a1".into(), item_id: "r1".into(),
            assertion_type: "status_code".into(), expression: "".into(),
            operator: "eq".into(), expected: "999".into(),
            enabled: false, sort_order: 0, created_at: "".into(),
        },
        Assertion {
            id: "a2".into(), item_id: "r1".into(),
            assertion_type: "status_code".into(), expression: "".into(),
            operator: "eq".into(), expected: "200".into(),
            enabled: true, sort_order: 1, created_at: "".into(),
        },
    ];

    let response = HttpResponse {
        status: 200, status_text: "OK".into(),
        headers: vec![], body: "".into(),
        time_ms: 50, size_bytes: 0,
    };

    let results = qai_lib::runner::assertion::evaluate_assertions(&assertions, &response);
    assert_eq!(results.len(), 1, "disabled assertion should be skipped");
    assert!(results[0].passed);
}

// ─── Group CRUD ─────────────────────────────────────────────

#[test]
fn test_group_crud() {
    let conn = setup_db();

    let group = qai_lib::db::group::create(&conn, "TEXT", None).unwrap();
    assert_eq!(group.name, "TEXT");
    assert!(group.parent_id.is_none());

    let child = qai_lib::db::group::create(&conn, "LLM", Some(&group.id)).unwrap();
    assert_eq!(child.parent_id.as_deref(), Some(group.id.as_str()));

    let all = qai_lib::db::group::list_all(&conn).unwrap();
    assert_eq!(all.len(), 2);

    qai_lib::db::group::delete(&conn, &group.id).unwrap();
    let all = qai_lib::db::group::list_all(&conn).unwrap();
    // child should be cascade deleted
    assert_eq!(all.len(), 0);
}
