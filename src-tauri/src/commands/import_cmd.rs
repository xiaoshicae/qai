use std::path::PathBuf;
use tauri::State;

use crate::db::init::DbState;
use crate::import::yaml::{ImportResult, YamlCase};
use crate::import::postman::PostmanImportResult;

#[tauri::command]
pub fn import_yaml_cases(
    db: State<'_, DbState>,
    dir_path: String,
    clear_first: Option<bool>,
) -> Result<ImportResult, String> {
    let conn = db.conn()?;
    let base = PathBuf::from(&dir_path);

    if !base.exists() {
        return Err(format!("目录不存在: {}", dir_path));
    }

    if clear_first.unwrap_or(false) {
        conn.execute_batch(
            "DELETE FROM executions; DELETE FROM assertions; DELETE FROM collection_items; DELETE FROM collections; DELETE FROM groups;"
        ).map_err(|e| e.to_string())?;
    }

    let mut result = ImportResult {
        collections_created: 0,
        collections_updated: 0,
        requests_created: 0,
        requests_updated: 0,
    };

    let yaml_files = crate::import::yaml::find_yaml_files(&base);
    if yaml_files.is_empty() {
        return Err("未找到 YAML 文件".to_string());
    }

    for path in &yaml_files {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("读取文件失败 {:?}: {}", path, e))?;
        let case: YamlCase = serde_yaml::from_str(&content)
            .map_err(|e| format!("解析 YAML 失败 {:?}: {}", path, e))?;

        let assets_dir = path.parent().unwrap_or(&base).join("../assets");
        let assets_dir = if assets_dir.exists() { assets_dir } else { base.join("assets") };
        crate::import::yaml::import_single_case(&conn, &case, &mut result, &assets_dir)
            .map_err(|e| format!("导入 {} 失败: {}", case.name, e))?;
    }

    Ok(result)
}

#[tauri::command]
pub fn import_postman_collection(
    db: State<'_, DbState>,
    json: String,
    group_id: Option<String>,
) -> Result<PostmanImportResult, String> {
    let conn = db.conn()?;
    crate::import::postman::import(&conn, &json, group_id.as_deref())
}
