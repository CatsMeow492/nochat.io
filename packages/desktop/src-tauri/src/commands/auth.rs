//! Authentication command handlers

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::api::ApiClient;
use crate::db;
use crate::error::AppError;
use crate::models::{AuthResponse, OAuthProvider, OAuthUrlResponse, UserInfo};
use crate::state::{OAuthState, SharedState, UserSession};

/// Sign in with email and password
#[tauri::command]
pub async fn login(
    state: State<'_, SharedState>,
    email: String,
    password: String,
) -> Result<AuthResponse, String> {
    let app_state = state.read().await;
    let api_client = ApiClient::new(&app_state.api_url);
    drop(app_state);

    match api_client.signin(&email, &password).await {
        Ok(response) => {
            if response.success {
                if let (Some(user), Some(token)) = (&response.user, &response.token) {
                    let mut app_state = state.write().await;

                    // Save session to database
                    if let Err(e) = db::save_session(
                        &app_state.db,
                        &user.id,
                        token,
                        response.refresh_token.as_deref(),
                        None,
                    )
                    .await
                    {
                        tracing::error!("Failed to save session: {}", e);
                    }

                    // Save user to cache
                    if let Err(e) = db::upsert_user(
                        &app_state.db,
                        &user.id,
                        user.email.as_deref(),
                        user.username.as_deref(),
                        user.display_name.as_deref(),
                        user.avatar_url.as_deref(),
                        user.is_anonymous,
                    )
                    .await
                    {
                        tracing::error!("Failed to cache user: {}", e);
                    }

                    // Set session in memory
                    app_state.set_session(UserSession {
                        user_id: user.id.clone(),
                        token: token.clone(),
                        refresh_token: response.refresh_token.clone(),
                        email: user.email.clone(),
                        username: user.username.clone(),
                        expires_at: None,
                    });

                    tracing::info!("User logged in: {}", user.id);
                }
            }
            Ok(response)
        }
        Err(e) => Ok(AuthResponse {
            success: false,
            user: None,
            token: None,
            refresh_token: None,
            error: Some(e.to_string()),
        }),
    }
}

/// Sign out current user
#[tauri::command]
pub async fn logout(state: State<'_, SharedState>) -> Result<(), String> {
    let mut app_state = state.write().await;

    // Clear sessions from database
    if let Err(e) = db::clear_sessions(&app_state.db).await {
        tracing::error!("Failed to clear sessions: {}", e);
    }

    // Clear session from memory
    app_state.clear_session();

    tracing::info!("User logged out");
    Ok(())
}

/// Get current authenticated user
#[tauri::command]
pub async fn get_current_user(state: State<'_, SharedState>) -> Result<Option<UserInfo>, String> {
    let app_state = state.read().await;

    if let Some(session) = &app_state.session {
        // Fetch fresh user data from API
        let api_client = ApiClient::new(&app_state.api_url);
        match api_client.get_current_user(&session.token).await {
            Ok(user) => Ok(Some(user)),
            Err(AppError::SessionExpired) => {
                drop(app_state);
                // Session expired, clear it
                let mut app_state = state.write().await;
                app_state.clear_session();
                Ok(None)
            }
            Err(e) => {
                tracing::warn!("Failed to fetch user: {}", e);
                // Return cached data if available
                Ok(Some(UserInfo {
                    id: session.user_id.clone(),
                    email: session.email.clone(),
                    username: session.username.clone(),
                    display_name: None,
                    avatar_url: None,
                    is_anonymous: false,
                }))
            }
        }
    } else {
        Ok(None)
    }
}

/// Start OAuth flow for a provider
#[tauri::command]
pub async fn start_oauth(
    app_handle: tauri::AppHandle,
    state: State<'_, SharedState>,
    provider: String,
) -> Result<OAuthUrlResponse, String> {
    let oauth_provider = match provider.to_lowercase().as_str() {
        "google" => OAuthProvider::Google,
        "github" => OAuthProvider::Github,
        "apple" => OAuthProvider::Apple,
        "facebook" => OAuthProvider::Facebook,
        _ => return Err(format!("Unknown OAuth provider: {}", provider)),
    };

    // Generate random state for CSRF protection
    let oauth_state = uuid::Uuid::new_v4().to_string();

    // Build OAuth URL - use desktop=true to tell server to redirect to nochat:// scheme
    let app_state = state.read().await;
    let auth_url = format!(
        "{}/api/auth/oauth/{}?desktop=true",
        app_state.api_url,
        oauth_provider,
    );
    drop(app_state);

    // Store pending OAuth state
    let mut app_state = state.write().await;
    app_state.add_oauth_state(OAuthState {
        state: oauth_state.clone(),
        provider: provider.clone(),
        created_at: chrono::Utc::now(),
    });
    drop(app_state);

    // Open browser with auth URL
    if let Err(e) = app_handle.opener().open_url(&auth_url, None::<&str>) {
        tracing::error!("Failed to open browser: {}", e);
        return Err(format!("Failed to open browser: {}", e));
    }

    tracing::info!("Started OAuth flow for provider: {}", provider);

    Ok(OAuthUrlResponse {
        url: auth_url,
        state: oauth_state,
    })
}

/// Handle OAuth callback with token from deep link
/// The backend has already exchanged the code for a token and redirected to nochat://auth/callback?token=...
#[tauri::command]
pub async fn handle_oauth_callback(
    state: State<'_, SharedState>,
    token: String,
) -> Result<AuthResponse, String> {
    let app_state = state.read().await;
    let api_url = app_state.api_url.clone();
    let db = app_state.db.clone();
    drop(app_state);

    // Validate token by fetching user info
    let api_client = ApiClient::new(&api_url);
    match api_client.get_current_user(&token).await {
        Ok(user) => {
            let mut app_state = state.write().await;

            // Save session to database
            if let Err(e) = db::save_session(&db, &user.id, &token, None, None).await {
                tracing::error!("Failed to save session: {}", e);
            }

            // Save user to cache
            if let Err(e) = db::upsert_user(
                &db,
                &user.id,
                user.email.as_deref(),
                user.username.as_deref(),
                user.display_name.as_deref(),
                user.avatar_url.as_deref(),
                user.is_anonymous,
            )
            .await
            {
                tracing::error!("Failed to cache user: {}", e);
            }

            // Set session in memory
            app_state.set_session(UserSession {
                user_id: user.id.clone(),
                token: token.clone(),
                refresh_token: None,
                email: user.email.clone(),
                username: user.username.clone(),
                expires_at: None,
            });

            tracing::info!("User logged in via OAuth: {}", user.id);

            Ok(AuthResponse {
                success: true,
                user: Some(user),
                token: Some(token),
                refresh_token: None,
                error: None,
            })
        }
        Err(e) => {
            tracing::error!("OAuth callback failed: {}", e);
            Ok(AuthResponse {
                success: false,
                user: None,
                token: None,
                refresh_token: None,
                error: Some(e.to_string()),
            })
        }
    }
}

/// Restore session from database on app startup
#[tauri::command]
pub async fn restore_session(state: State<'_, SharedState>) -> Result<Option<UserInfo>, String> {
    let app_state = state.read().await;
    let db = app_state.db.clone();
    let api_url = app_state.api_url.clone();
    drop(app_state);

    // Check for existing session in database
    match db::get_active_session(&db).await {
        Ok(Some((_session_id, user_id, token, refresh_token))) => {
            // Try to validate the token
            let api_client = ApiClient::new(&api_url);
            match api_client.get_current_user(&token).await {
                Ok(user) => {
                    // Session is valid, restore it
                    let mut app_state = state.write().await;
                    app_state.set_session(UserSession {
                        user_id: user.id.clone(),
                        token,
                        refresh_token,
                        email: user.email.clone(),
                        username: user.username.clone(),
                        expires_at: None,
                    });
                    tracing::info!("Session restored for user: {}", user.id);
                    Ok(Some(user))
                }
                Err(AppError::SessionExpired) => {
                    // Session expired, clear it
                    if let Err(e) = db::clear_sessions(&db).await {
                        tracing::error!("Failed to clear expired sessions: {}", e);
                    }
                    Ok(None)
                }
                Err(e) => {
                    tracing::warn!("Failed to validate session: {}", e);
                    // Keep session for offline use
                    let mut app_state = state.write().await;
                    app_state.set_session(UserSession {
                        user_id: user_id.clone(),
                        token,
                        refresh_token,
                        email: None,
                        username: None,
                        expires_at: None,
                    });
                    Ok(Some(UserInfo {
                        id: user_id,
                        email: None,
                        username: None,
                        display_name: None,
                        avatar_url: None,
                        is_anonymous: false,
                    }))
                }
            }
        }
        Ok(None) => Ok(None),
        Err(e) => {
            tracing::error!("Failed to check for existing session: {}", e);
            Ok(None)
        }
    }
}

/// Get pending OAuth deep links that arrived before the frontend was ready.
/// This handles the race condition where deep links arrive before React mounts.
#[tauri::command]
pub fn get_pending_oauth_urls() -> Vec<String> {
    let urls = crate::take_pending_deep_links();
    if !urls.is_empty() {
        tracing::info!("Returning {} pending OAuth URL(s) to frontend", urls.len());
    }
    urls
}

/// Debug logging command - allows frontend to log to Rust console
#[tauri::command]
pub fn debug_log(message: String) {
    tracing::info!("[Frontend] {}", message);
}
