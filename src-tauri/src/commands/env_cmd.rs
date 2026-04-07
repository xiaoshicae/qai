use tauri::State;

use crate::db::init::DbState;
use crate::models::environment::{EnvVariable, Environment, EnvironmentWithVars};

#[tauri::command]
pub fn list_environments(db: State<'_, DbState>) -> Result<Vec<Environment>, String> {
    let conn = db.conn()?;
    crate::db::environment::list_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_environment(db: State<'_, DbState>, name: String) -> Result<Environment, String> {
    let conn = db.conn()?;
    crate::db::environment::create(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_environment(
    db: State<'_, DbState>,
    id: String,
    name: String,
) -> Result<Environment, String> {
    let conn = db.conn()?;
    crate::db::environment::update(&conn, &id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_environment(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn()?;
    crate::db::environment::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_active_environment(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn()?;
    crate::db::environment::set_active(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_environment_with_vars(
    db: State<'_, DbState>,
    id: String,
) -> Result<EnvironmentWithVars, String> {
    let conn = db.conn()?;
    let env = crate::db::environment::get(&conn, &id).map_err(|e| e.to_string())?;
    let vars = crate::db::environment::list_variables(&conn, &id).map_err(|e| e.to_string())?;
    Ok(EnvironmentWithVars {
        environment: env,
        variables: vars,
    })
}

#[tauri::command]
pub fn save_env_variables(
    db: State<'_, DbState>,
    environment_id: String,
    variables: Vec<EnvVariable>,
) -> Result<(), String> {
    let conn = db.conn()?;
    crate::db::environment::save_variables(&conn, &environment_id, &variables)
        .map_err(|e| e.to_string())
}
