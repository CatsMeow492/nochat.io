//! Messaging command handlers

use tauri::State;

use crate::api::ApiClient;
use crate::db;
use crate::error::AppError;
use crate::models::{Conversation, Message};
use crate::state::SharedState;

/// Get user's conversations
#[tauri::command]
pub async fn get_conversations(
    state: State<'_, SharedState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Conversation>, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let app_state = state.read().await;

    // Check authentication
    let session = app_state.session.as_ref().ok_or("Not authenticated")?;

    // Try to fetch from API first
    let api_client = ApiClient::new(&app_state.api_url);
    match api_client.get_conversations(&session.token).await {
        Ok(conversations) => {
            // Cache conversations locally
            for conv in &conversations {
                if let Err(e) = db::upsert_conversation(&app_state.db, conv).await {
                    tracing::warn!("Failed to cache conversation: {}", e);
                }
            }
            Ok(conversations)
        }
        Err(AppError::SessionExpired) => Err("Session expired".to_string()),
        Err(e) => {
            // Fall back to cached data
            tracing::warn!("Failed to fetch conversations from API: {}", e);
            db::get_conversations(&app_state.db, limit, offset)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

/// Get messages for a conversation (paginated)
#[tauri::command]
pub async fn get_messages(
    state: State<'_, SharedState>,
    conversation_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Message>, String> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let app_state = state.read().await;

    // Check authentication
    let session = app_state.session.as_ref().ok_or("Not authenticated")?;

    // Try to fetch from API first
    let api_client = ApiClient::new(&app_state.api_url);
    match api_client
        .get_messages(&conversation_id, limit, offset, &session.token)
        .await
    {
        Ok(messages) => {
            // Cache messages locally
            for msg in &messages {
                if let Err(e) = db::save_message(&app_state.db, msg).await {
                    tracing::warn!("Failed to cache message: {}", e);
                }
            }
            Ok(messages)
        }
        Err(AppError::SessionExpired) => Err("Session expired".to_string()),
        Err(e) => {
            // Fall back to cached data
            tracing::warn!("Failed to fetch messages from API: {}", e);
            db::get_messages(&app_state.db, &conversation_id, limit, offset)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

/// Send a message to a conversation
#[tauri::command]
pub async fn send_message(
    state: State<'_, SharedState>,
    conversation_id: String,
    content: String,
) -> Result<Message, String> {
    let app_state = state.read().await;

    // Check authentication
    let session = app_state.session.as_ref().ok_or("Not authenticated")?;

    // Send via API
    let api_client = ApiClient::new(&app_state.api_url);
    let message = api_client
        .send_message(&conversation_id, &content, &session.token)
        .await
        .map_err(|e| e.to_string())?;

    // Cache message locally
    if let Err(e) = db::save_message(&app_state.db, &message).await {
        tracing::warn!("Failed to cache sent message: {}", e);
    }

    tracing::info!("Message sent to conversation: {}", conversation_id);
    Ok(message)
}

/// Mark a message as read
#[tauri::command]
pub async fn mark_as_read(
    state: State<'_, SharedState>,
    _message_id: String,
) -> Result<(), String> {
    let app_state = state.read().await;

    // Check authentication
    let _session = app_state.session.as_ref().ok_or("Not authenticated")?;

    // TODO: Implement mark as read API call
    // For now, this is a stub

    Ok(())
}

/// Create a new conversation
#[tauri::command]
pub async fn create_conversation(
    state: State<'_, SharedState>,
    participant_ids: Vec<String>,
) -> Result<Conversation, String> {
    let app_state = state.read().await;

    // Check authentication
    let session = app_state.session.as_ref().ok_or("Not authenticated")?;

    // Create via API
    let api_client = ApiClient::new(&app_state.api_url);
    let conversation = api_client
        .create_conversation(&participant_ids, &session.token)
        .await
        .map_err(|e| e.to_string())?;

    // Cache conversation locally
    if let Err(e) = db::upsert_conversation(&app_state.db, &conversation).await {
        tracing::warn!("Failed to cache conversation: {}", e);
    }

    tracing::info!("Created conversation: {}", conversation.id);
    Ok(conversation)
}

/// Search for users
#[tauri::command]
pub async fn search_users(
    state: State<'_, SharedState>,
    query: String,
) -> Result<Vec<crate::models::UserInfo>, String> {
    let app_state = state.read().await;

    // Check authentication
    let session = app_state.session.as_ref().ok_or("Not authenticated")?;

    // Search via API
    let api_client = ApiClient::new(&app_state.api_url);
    api_client
        .search_users(&query, &session.token)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Crypto commands (Signal Protocol)
// ============================================================================

use crate::crypto::CryptoService;

/// Initialize the crypto service
#[tauri::command]
pub async fn init_crypto(state: State<'_, SharedState>) -> Result<(), String> {
    let app_state = state.read().await;
    let _crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Store crypto service in state
    // Note: In a full implementation, you'd add CryptoService to SharedState
    tracing::info!("Crypto service initialized");
    Ok(())
}

/// Get identity key for this device
#[tauri::command]
pub async fn get_identity_key(state: State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    let key = crypto.identity_key().await;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &key))
}

/// Get one-time keys for upload to server
#[tauri::command]
pub async fn get_one_time_keys(
    state: State<'_, SharedState>,
    count: Option<usize>,
) -> Result<Vec<(String, String)>, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    let count = count.unwrap_or(100);
    let keys = crypto.generate_one_time_keys(count)
        .await
        .map_err(|e| e.to_string())?;

    // Convert to base64 for transmission
    Ok(keys.into_iter().map(|(id, key)| {
        (id, base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &key))
    }).collect())
}

/// Mark one-time keys as published to server
#[tauri::command]
pub async fn mark_keys_published(state: State<'_, SharedState>) -> Result<(), String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    crypto.mark_keys_as_published()
        .await
        .map_err(|e| e.to_string())
}

/// Establish an outbound session with a peer
#[tauri::command]
pub async fn establish_session(
    state: State<'_, SharedState>,
    peer_id: String,
    identity_key: String,
    one_time_key: String,
) -> Result<(), String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    let identity = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &identity_key)
        .map_err(|e| e.to_string())?;
    let otk = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &one_time_key)
        .map_err(|e| e.to_string())?;

    crypto.establish_outbound_session(&peer_id, &identity, &otk)
        .await
        .map_err(|e| e.to_string())
}

/// Check if we have a session with a peer
#[tauri::command]
pub async fn has_session(
    state: State<'_, SharedState>,
    peer_id: String,
) -> Result<bool, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    Ok(crypto.has_session(&peer_id).await)
}

/// Encrypt a message for a peer (Signal Protocol)
#[tauri::command]
pub async fn encrypt_message(
    state: State<'_, SharedState>,
    peer_id: String,
    plaintext: String,
) -> Result<String, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    let ciphertext = crypto.encrypt(&peer_id, plaintext.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ciphertext))
}

/// Decrypt a message from a peer (Signal Protocol)
#[tauri::command]
pub async fn decrypt_message(
    state: State<'_, SharedState>,
    peer_id: String,
    ciphertext: String,
    sender_identity_key: Option<String>,
) -> Result<String, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    let ciphertext_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &ciphertext)
        .map_err(|e| e.to_string())?;

    let identity_key = sender_identity_key.map(|k| {
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &k)
    }).transpose().map_err(|e| e.to_string())?;

    let plaintext = crypto.decrypt(&peer_id, identity_key.as_deref(), &ciphertext_bytes)
        .await
        .map_err(|e| e.to_string())?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

/// Get identity key fingerprint for verification
#[tauri::command]
pub async fn get_fingerprint(state: State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    Ok(crypto.fingerprint().await)
}

/// Get session statistics
#[tauri::command]
pub async fn get_session_stats(
    state: State<'_, SharedState>,
) -> Result<Vec<serde_json::Value>, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    let stats = crypto.get_session_stats().await;
    Ok(stats.into_iter().map(|s| serde_json::json!({
        "peer_id": s.peer_id,
        "session_id": s.session_id,
        "messages_sent": s.messages_sent,
        "messages_received": s.messages_received,
    })).collect())
}

/// Check if we need more one-time keys
#[tauri::command]
pub async fn needs_more_keys(state: State<'_, SharedState>) -> Result<bool, String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    Ok(crypto.needs_more_keys().await)
}

/// Delete session with a peer
#[tauri::command]
pub async fn delete_session(
    state: State<'_, SharedState>,
    peer_id: String,
) -> Result<(), String> {
    let app_state = state.read().await;
    let crypto = CryptoService::initialize(app_state.db.clone())
        .await
        .map_err(|e| e.to_string())?;

    crypto.delete_session(&peer_id)
        .await
        .map_err(|e| e.to_string())
}
