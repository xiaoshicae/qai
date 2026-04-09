/// 统一错误类型，替代 `Result<T, String>` 的散装错误处理
///
/// 优势：
/// - 自动 From 转换，消除所有 `.map_err(|e| e.to_string())`
/// - 保留错误分类信息，前端可按需处理
/// - 实现 Serialize 供 Tauri IPC 传输
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Db(#[from] rusqlite::Error),

    #[error("{0}")]
    Http(#[from] reqwest::Error),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Anyhow(#[from] anyhow::Error),

    #[error("{0}")]
    Yaml(#[from] serde_yml::Error),

    #[error("{0}")]
    Generic(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Generic(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Generic(s.to_string())
    }
}

/// 便捷类型别名
pub type AppResult<T> = Result<T, AppError>;
