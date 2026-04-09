use tauri::State;

use crate::db::init::DbState;
use crate::errors::AppError;
use crate::models::environment::{EnvVariable, Environment, EnvironmentWithVars};

#[tauri::command]
pub fn list_environments(db: State<'_, DbState>) -> Result<Vec<Environment>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::environment::list_all(&conn)?)
}

#[tauri::command]
pub fn create_environment(db: State<'_, DbState>, name: String) -> Result<Environment, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::environment::create(&conn, &name)?)
}

#[tauri::command]
pub fn update_environment(
    db: State<'_, DbState>,
    id: String,
    name: String,
) -> Result<Environment, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::environment::update(&conn, &id, &name)?)
}

#[tauri::command]
pub fn delete_environment(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    Ok(crate::db::environment::delete(&conn, &id)?)
}

#[tauri::command]
pub fn set_active_environment(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    Ok(crate::db::environment::set_active(&conn, &id)?)
}

#[tauri::command]
pub fn get_environment_with_vars(
    db: State<'_, DbState>,
    id: String,
) -> Result<EnvironmentWithVars, AppError> {
    let conn = db.conn()?;
    let env = crate::db::environment::get(&conn, &id)?;
    let vars = crate::db::environment::list_variables(&conn, &id)?;
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
) -> Result<(), AppError> {
    let conn = db.conn()?;
    Ok(crate::db::environment::save_variables(
        &conn,
        &environment_id,
        &variables,
    )?)
}
