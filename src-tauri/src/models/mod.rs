pub mod assertion;
pub mod collection;
pub mod environment;
pub mod execution;
pub mod group;
pub mod item;

/// 执行状态枚举 — 编译期检查，杜绝拼写错误
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Success,
    Failed,
    Error,
    Running,
}

impl Status {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Status::Success => "success",
            Status::Failed => "failed",
            Status::Error => "error",
            Status::Running => "running",
        }
    }
}

impl std::fmt::Display for Status {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 节点类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Folder,
    Chain,
    Request,
}

impl ItemType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            ItemType::Folder => "folder",
            ItemType::Chain => "chain",
            ItemType::Request => "request",
        }
    }
}

impl std::fmt::Display for ItemType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// 向后兼容：保留模块级常量（引用枚举的 as_str()）
pub mod status {
    pub const SUCCESS: &str = "success";
    pub const FAILED: &str = "failed";
    pub const ERROR: &str = "error";
    pub const RUNNING: &str = "running";
}

pub mod item_type {
    pub const FOLDER: &str = "folder";
    pub const CHAIN: &str = "chain";
    pub const REQUEST: &str = "request";
}
