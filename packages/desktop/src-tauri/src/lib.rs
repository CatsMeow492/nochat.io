//! NoChat Desktop - Core library
//!
//! This crate provides the Tauri backend for the NoChat desktop application.
//! It follows the "Headless Core" architecture where all business logic,
//! database operations, and cryptography are handled in Rust.

pub mod api;
pub mod commands;
pub mod crypto;
pub mod db;
pub mod error;
pub mod models;
pub mod state;
pub mod updater;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Global storage for pending deep links that arrive before the frontend is ready.
/// This is needed because deep links can arrive during app startup before React mounts.
static PENDING_DEEP_LINKS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Store a deep link URL for later retrieval by the frontend
pub fn store_pending_deep_link(url: String) {
    if let Ok(mut links) = PENDING_DEEP_LINKS.lock() {
        tracing::info!("Storing pending deep link for frontend: {}", url);
        links.push(url);
    }
}

/// Take and clear all pending deep links
pub fn take_pending_deep_links() -> Vec<String> {
    if let Ok(mut links) = PENDING_DEEP_LINKS.lock() {
        std::mem::take(&mut *links)
    } else {
        Vec::new()
    }
}

/// Run the Tauri application
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nochat_desktop=info,tauri=info".into()),
        )
        .init();

    tracing::info!("Starting NoChat Desktop");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Setup auto-updater with rollback protection
            #[cfg(not(debug_assertions))]
            updater::setup_updater(app);
            let app_handle = app.handle().clone();

            // Initialize state asynchronously
            tauri::async_runtime::spawn(async move {
                // Get app data directory
                let data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .expect("Failed to get app data dir");

                // Ensure directory exists
                if let Err(e) = std::fs::create_dir_all(&data_dir) {
                    tracing::error!("Failed to create data directory: {}", e);
                    return;
                }

                let db_path = data_dir.join("nochat.db");
                let db_path_str = db_path.to_string_lossy().to_string();

                tracing::info!("Database path: {}", db_path_str);

                // Initialize application state
                match state::create_shared_state(&db_path_str).await {
                    Ok(shared_state) => {
                        app_handle.manage(shared_state);
                        tracing::info!("Application state initialized successfully");
                    }
                    Err(e) => {
                        tracing::error!("Failed to initialize application state: {}", e);
                    }
                }
            });

            // Set up deep link handler for OAuth callbacks
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("nochat");
            }

            // Handle deep links using the Tauri v2 deep link plugin API
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle_for_deep_link = app.handle().clone();

                // Handle deep links received while app is running
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    tracing::info!("Received deep link URLs: {:?}", urls);

                    for url in urls {
                        let url_str = url.to_string();
                        tracing::info!("Processing deep link: {}", url_str);

                        // Store in global storage so frontend can retrieve it
                        store_pending_deep_link(url_str.clone());

                        // Also emit event in case frontend is already listening
                        if let Err(e) = app_handle_for_deep_link.emit("oauth-callback", &url_str) {
                            tracing::error!("Failed to emit oauth-callback event: {}", e);
                        }
                    }
                });

                // Check for deep links that launched the app
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    tracing::info!("App launched with deep links: {:?}", urls);
                    let app_handle_startup = app.handle().clone();
                    for url in urls {
                        let url_str: String = url.to_string();
                        tracing::info!("Processing startup deep link: {}", url_str);

                        // Store in global storage so frontend can retrieve it
                        store_pending_deep_link(url_str.clone());

                        // Also emit event in case frontend is already listening
                        if let Err(e) = app_handle_startup.emit("oauth-callback", &url_str) {
                            tracing::error!("Failed to emit startup oauth-callback event: {}", e);
                        }
                    }
                }
            }

            Ok(())
        })
        // Register all IPC command handlers
        .invoke_handler(tauri::generate_handler![
            // Auth commands
            commands::login,
            commands::logout,
            commands::get_current_user,
            commands::start_oauth,
            commands::handle_oauth_callback,
            commands::restore_session,
            commands::get_pending_oauth_urls,
            commands::debug_log,
            // Messaging commands
            commands::get_conversations,
            commands::get_messages,
            commands::send_message,
            commands::mark_as_read,
            commands::create_conversation,
            commands::search_users,
            // Crypto commands (Signal Protocol)
            commands::init_crypto,
            commands::get_identity_key,
            commands::get_one_time_keys,
            commands::mark_keys_published,
            commands::establish_session,
            commands::has_session,
            commands::encrypt_message,
            commands::decrypt_message,
            commands::get_fingerprint,
            commands::get_session_stats,
            commands::needs_more_keys,
            commands::delete_session,
            // Settings commands
            commands::get_settings,
            commands::update_settings,
            commands::reset_settings,
            // Updater commands
            updater::check_update,
            updater::install_update,
            updater::get_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
