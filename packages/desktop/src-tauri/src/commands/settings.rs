//! Settings command handlers

use tauri::State;

use crate::db;
use crate::models::Settings;
use crate::state::SharedState;

/// Get current settings
#[tauri::command]
pub async fn get_settings(state: State<'_, SharedState>) -> Result<Settings, String> {
    let app_state = state.read().await;
    db::get_settings(&app_state.db)
        .await
        .map_err(|e| e.to_string())
}

/// Update settings
#[tauri::command]
pub async fn update_settings(
    state: State<'_, SharedState>,
    settings: Settings,
) -> Result<Settings, String> {
    let app_state = state.read().await;
    db::update_settings(&app_state.db, &settings)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!("Settings updated");
    Ok(settings)
}

/// Reset settings to defaults
#[tauri::command]
pub async fn reset_settings(state: State<'_, SharedState>) -> Result<Settings, String> {
    let default_settings = Settings::default();
    let app_state = state.read().await;
    db::update_settings(&app_state.db, &default_settings)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!("Settings reset to defaults");
    Ok(default_settings)
}
