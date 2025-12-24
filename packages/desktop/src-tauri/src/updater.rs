//! Auto-updater module with rollback protection
//!
//! This module handles automatic updates with security features:
//! - Signature verification (via Tauri updater plugin)
//! - Rollback protection (prevents downgrade attacks)
//! - Background update checking

use semver::Version;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Interval between update checks (4 hours)
const UPDATE_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(4 * 60 * 60);

/// Setup the auto-updater with rollback protection
pub fn setup_updater(app: &tauri::App) {
    let handle = app.handle().clone();

    // Spawn background update checker
    tauri::async_runtime::spawn(async move {
        // Initial delay before first check (30 seconds after startup)
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;

        loop {
            check_for_updates(&handle).await;
            tokio::time::sleep(UPDATE_CHECK_INTERVAL).await;
        }
    });
}

/// Check for updates with rollback protection
async fn check_for_updates(handle: &AppHandle) {
    tracing::info!("Checking for updates...");

    // Get the updater from the app handle
    let updater = match handle.updater() {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("Failed to get updater: {}", e);
            return;
        }
    };

    // Check for updates
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            tracing::info!("No updates available");
            return;
        }
        Err(e) => {
            tracing::error!("Failed to check for updates: {}", e);
            return;
        }
    };

    // Get version strings
    let current_version_str = env!("CARGO_PKG_VERSION");
    let new_version_str = update.version.as_str();

    tracing::info!(
        "Update available: {} -> {}",
        current_version_str,
        new_version_str
    );

    // Parse versions for comparison
    let current_version = match Version::parse(current_version_str) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("Failed to parse current version '{}': {}", current_version_str, e);
            return;
        }
    };

    let new_version = match Version::parse(new_version_str) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("Failed to parse new version '{}': {}", new_version_str, e);
            return;
        }
    };

    // CRITICAL: Rollback protection - reject downgrades
    if new_version <= current_version {
        tracing::warn!(
            "SECURITY: Rejecting update {} <= {} (possible downgrade attack)",
            new_version,
            current_version
        );
        return;
    }

    // Emit event to frontend about available update
    if let Err(e) = handle.emit("update-available", UpdateInfo {
        version: new_version_str.to_string(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    }) {
        tracing::error!("Failed to emit update event: {}", e);
    }
}

/// Install a pending update
///
/// This is exposed as a Tauri command so the frontend can trigger installation
/// after user confirmation.
#[tauri::command]
pub async fn install_update(handle: AppHandle) -> Result<(), String> {
    let updater = handle.updater().map_err(|e| e.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;

    // Parse and verify versions one more time
    let current_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| format!("Invalid current version: {}", e))?;
    let new_version = Version::parse(&update.version)
        .map_err(|e| format!("Invalid update version: {}", e))?;

    // Final rollback protection check
    if new_version <= current_version {
        return Err(format!(
            "Update rejected: {} <= {} (security violation)",
            new_version, current_version
        ));
    }

    tracing::info!("Starting update download and installation...");

    // Download and install
    // The signature is verified by the Tauri updater plugin
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update failed: {}", e))?;

    tracing::info!("Update installed successfully. Restart required.");

    // Emit event for frontend to show restart prompt
    let _ = handle.emit("update-installed", ());

    Ok(())
}

/// Check for updates manually (from frontend)
#[tauri::command]
pub async fn check_update(handle: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = handle.updater().map_err(|e| e.to_string())?;

    let update = match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => u,
        None => return Ok(None),
    };

    // Parse and verify versions
    let current_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| format!("Invalid current version: {}", e))?;
    let new_version = Version::parse(&update.version)
        .map_err(|e| format!("Invalid update version: {}", e))?;

    // Rollback protection
    if new_version <= current_version {
        tracing::warn!(
            "Rejecting update {} <= {} (rollback protection)",
            new_version,
            current_version
        );
        return Ok(None);
    }

    Ok(Some(UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    }))
}

/// Get the current app version
#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Update information sent to frontend
#[derive(serde::Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}
