pub mod group;
pub mod collection;
pub mod item;
pub mod assertion;
pub mod execution;
pub mod environment;

/// 执行状态常量，避免字符串硬编码拼写错误
pub mod status {
    pub const SUCCESS: &str = "success";
    pub const FAILED: &str = "failed";
    pub const ERROR: &str = "error";
    pub const RUNNING: &str = "running";
}

/// 节点类型常量
pub mod item_type {
    pub const FOLDER: &str = "folder";
    pub const CHAIN: &str = "chain";
    pub const REQUEST: &str = "request";
}
