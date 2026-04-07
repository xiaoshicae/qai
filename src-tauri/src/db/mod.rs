pub mod assertion;
pub mod collection;
pub mod environment;
pub mod execution;
pub mod group;
pub mod init;
pub mod item;

/// 动态 UPDATE SQL 构建器，消除各 CRUD 模块重复的 update 模式
pub struct DynamicUpdate {
    sets: Vec<String>,
    values: Vec<Box<dyn rusqlite::types::ToSql>>,
}

impl DynamicUpdate {
    pub fn new() -> Self {
        Self {
            sets: Vec::new(),
            values: Vec::new(),
        }
    }

    /// 添加一个要更新的字段（仅在 value 为 Some 时生效）
    pub fn set_opt<T: rusqlite::types::ToSql + 'static>(
        &mut self,
        col: &str,
        value: Option<T>,
    ) -> &mut Self {
        if let Some(v) = value {
            self.sets
                .push(format!("{} = ?{}", col, self.values.len() + 1));
            self.values.push(Box::new(v));
        }
        self
    }

    /// 无条件添加一个要更新的字段
    pub fn set<T: rusqlite::types::ToSql + 'static>(&mut self, col: &str, value: T) -> &mut Self {
        self.sets
            .push(format!("{} = ?{}", col, self.values.len() + 1));
        self.values.push(Box::new(value));
        self
    }

    /// 添加自动更新 updated_at 并执行，返回是否有字段被更新
    pub fn execute(
        mut self,
        conn: &rusqlite::Connection,
        table: &str,
        id: &str,
    ) -> Result<bool, rusqlite::Error> {
        if self.sets.is_empty() {
            return Ok(false);
        }
        self.sets
            .push("updated_at = datetime('now', 'localtime')".to_string());
        let idx = self.values.len() + 1;
        let sql = format!(
            "UPDATE {} SET {} WHERE id = ?{}",
            table,
            self.sets.join(", "),
            idx
        );
        self.values.push(Box::new(id.to_string()));
        let params: Vec<&dyn rusqlite::types::ToSql> =
            self.values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
        Ok(true)
    }

    /// 执行（不自动添加 updated_at，用于没有该字段的表）
    pub fn execute_without_timestamp(
        mut self,
        conn: &rusqlite::Connection,
        table: &str,
        id: &str,
    ) -> Result<bool, rusqlite::Error> {
        if self.sets.is_empty() {
            return Ok(false);
        }
        let idx = self.values.len() + 1;
        let sql = format!(
            "UPDATE {} SET {} WHERE id = ?{}",
            table,
            self.sets.join(", "),
            idx
        );
        self.values.push(Box::new(id.to_string()));
        let params: Vec<&dyn rusqlite::types::ToSql> =
            self.values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::DynamicUpdate;

    #[test]
    fn test_empty_update_returns_false() {
        let conn = crate::db::init::create_test_db();
        let g = crate::db::group::create(&conn, "G", None).unwrap();
        let u = DynamicUpdate::new();
        let updated = u.execute_without_timestamp(&conn, "groups", &g.id).unwrap();
        assert!(!updated);
    }

    #[test]
    fn test_set_opt_none_skipped() {
        let conn = crate::db::init::create_test_db();
        let g = crate::db::group::create(&conn, "G", None).unwrap();
        let mut u = DynamicUpdate::new();
        u.set_opt("name", None::<String>);
        let updated = u.execute_without_timestamp(&conn, "groups", &g.id).unwrap();
        assert!(!updated);
    }

    #[test]
    fn test_set_opt_some_applied() {
        let conn = crate::db::init::create_test_db();
        let g = crate::db::group::create(&conn, "Old", None).unwrap();
        let mut u = DynamicUpdate::new();
        u.set_opt("name", Some("New".to_string()));
        let updated = u.execute_without_timestamp(&conn, "groups", &g.id).unwrap();
        assert!(updated);
        let fetched = crate::db::group::get(&conn, &g.id).unwrap();
        assert_eq!(fetched.name, "New");
    }

    #[test]
    fn test_set_unconditional() {
        let conn = crate::db::init::create_test_db();
        let g = crate::db::group::create(&conn, "G", None).unwrap();
        let mut u = DynamicUpdate::new();
        u.set("sort_order", 99);
        u.execute_without_timestamp(&conn, "groups", &g.id).unwrap();
        let fetched = crate::db::group::get(&conn, &g.id).unwrap();
        assert_eq!(fetched.sort_order, 99);
    }

    #[test]
    fn test_execute_with_timestamp() {
        let conn = crate::db::init::create_test_db();
        let c = crate::db::collection::create(&conn, "C", "", None).unwrap();
        // 手动将 updated_at 设为过去时间，避免同秒比较
        conn.execute(
            "UPDATE collections SET updated_at = '2000-01-01 00:00:00' WHERE id = ?1",
            rusqlite::params![c.id],
        )
        .unwrap();
        let mut u = DynamicUpdate::new();
        u.set("name", "Updated".to_string());
        u.execute(&conn, "collections", &c.id).unwrap();
        let fetched = crate::db::collection::get(&conn, &c.id).unwrap();
        assert_eq!(fetched.name, "Updated");
        assert_ne!(fetched.updated_at, "2000-01-01 00:00:00");
    }
}
