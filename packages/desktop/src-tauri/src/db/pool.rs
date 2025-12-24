//! Database pool and query utilities

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::{Conversation, ConversationType, Message, Settings, Theme};

// ============================================================================
// User Queries
// ============================================================================

/// Save or update user in local cache
pub async fn upsert_user(
    pool: &SqlitePool,
    id: &str,
    email: Option<&str>,
    username: Option<&str>,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
    is_anonymous: bool,
) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO users (id, email, username, display_name, avatar_url, is_anonymous, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            username = excluded.username,
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url,
            is_anonymous = excluded.is_anonymous,
            updated_at = datetime('now')
        "#,
    )
    .bind(id)
    .bind(email)
    .bind(username)
    .bind(display_name)
    .bind(avatar_url)
    .bind(is_anonymous)
    .execute(pool)
    .await?;

    Ok(())
}

// ============================================================================
// Session Queries
// ============================================================================

/// Save session to database
pub async fn save_session(
    pool: &SqlitePool,
    user_id: &str,
    token: &str,
    refresh_token: Option<&str>,
    expires_at: Option<DateTime<Utc>>,
) -> AppResult<String> {
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, token, refresh_token, expires_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(user_id)
    .bind(token)
    .bind(refresh_token)
    .bind(expires_at.map(|dt| dt.to_rfc3339()))
    .execute(pool)
    .await?;

    Ok(id)
}

/// Get active session for user
pub async fn get_active_session(
    pool: &SqlitePool,
) -> AppResult<Option<(String, String, String, Option<String>)>> {
    let result = sqlx::query_as::<_, (String, String, String, Option<String>)>(
        r#"
        SELECT s.id, s.user_id, s.token, s.refresh_token
        FROM sessions s
        WHERE (s.expires_at IS NULL OR s.expires_at > datetime('now'))
        ORDER BY s.created_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await?;

    Ok(result)
}

/// Delete all sessions
pub async fn clear_sessions(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions")
        .execute(pool)
        .await?;
    Ok(())
}

// ============================================================================
// Conversation Queries
// ============================================================================

/// Save or update conversation in local cache
pub async fn upsert_conversation(
    pool: &SqlitePool,
    conversation: &Conversation,
) -> AppResult<()> {
    let conv_type = match conversation.conversation_type {
        ConversationType::Direct => "direct",
        ConversationType::Group => "group",
        ConversationType::Channel => "channel",
    };

    sqlx::query(
        r#"
        INSERT INTO conversations (id, type, name, last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            last_message_at = excluded.last_message_at,
            updated_at = datetime('now')
        "#,
    )
    .bind(&conversation.id)
    .bind(conv_type)
    .bind(&conversation.name)
    .bind(conversation.last_message_at.map(|dt| dt.to_rfc3339()))
    .bind(conversation.created_at.to_rfc3339())
    .execute(pool)
    .await?;

    Ok(())
}

/// Get all cached conversations
pub async fn get_conversations(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<Conversation>> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String)>(
        r#"
        SELECT id, type, name, last_message_at, created_at
        FROM conversations
        ORDER BY COALESCE(last_message_at, created_at) DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let conversations = rows
        .into_iter()
        .map(|(id, conv_type, name, last_message_at, created_at)| {
            let conversation_type = match conv_type.as_str() {
                "direct" => ConversationType::Direct,
                "group" => ConversationType::Group,
                "channel" => ConversationType::Channel,
                _ => ConversationType::Direct,
            };

            Conversation {
                id,
                conversation_type,
                name,
                last_message_at: last_message_at
                    .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                    .map(|dt| dt.with_timezone(&Utc)),
                created_at: DateTime::parse_from_rfc3339(&created_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: None,
                participants: vec![],
                last_message: None,
                unread_count: 0,
            }
        })
        .collect();

    Ok(conversations)
}

// ============================================================================
// Message Queries
// ============================================================================

/// Save message to local cache
pub async fn save_message(pool: &SqlitePool, message: &Message) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO messages (id, conversation_id, sender_id, encrypted_content, message_type, encryption_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        "#,
    )
    .bind(&message.id)
    .bind(&message.conversation_id)
    .bind(&message.sender_id)
    .bind(&message.content)
    .bind(&message.message_type)
    .bind(message.encryption_version)
    .bind(message.created_at.to_rfc3339())
    .execute(pool)
    .await?;

    Ok(())
}

/// Get messages for a conversation
pub async fn get_messages(
    pool: &SqlitePool,
    conversation_id: &str,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<Message>> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, i32, String)>(
        r#"
        SELECT id, conversation_id, sender_id, encrypted_content, message_type, encryption_version, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(conversation_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let messages = rows
        .into_iter()
        .map(
            |(id, conversation_id, sender_id, content, message_type, encryption_version, created_at)| {
                Message {
                    id,
                    conversation_id,
                    sender_id,
                    content,
                    message_type,
                    encrypted: true,
                    encryption_version,
                    created_at: DateTime::parse_from_rfc3339(&created_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                }
            },
        )
        .collect();

    Ok(messages)
}

// ============================================================================
// Settings Queries
// ============================================================================

/// Get all settings
pub async fn get_settings(pool: &SqlitePool) -> AppResult<Settings> {
    let rows = sqlx::query_as::<_, (String, String)>("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;

    let mut settings = Settings::default();

    for (key, value) in rows {
        match key.as_str() {
            "theme" => {
                if let Ok(theme) = serde_json::from_str::<Theme>(&value) {
                    settings.theme = theme;
                }
            }
            "notifications_enabled" => {
                if let Ok(v) = serde_json::from_str::<bool>(&value) {
                    settings.notifications_enabled = v;
                }
            }
            "sound_enabled" => {
                if let Ok(v) = serde_json::from_str::<bool>(&value) {
                    settings.sound_enabled = v;
                }
            }
            "auto_start" => {
                if let Ok(v) = serde_json::from_str::<bool>(&value) {
                    settings.auto_start = v;
                }
            }
            "minimize_to_tray" => {
                if let Ok(v) = serde_json::from_str::<bool>(&value) {
                    settings.minimize_to_tray = v;
                }
            }
            _ => {}
        }
    }

    Ok(settings)
}

/// Update a single setting
pub async fn update_setting(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        "#,
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update multiple settings
pub async fn update_settings(pool: &SqlitePool, settings: &Settings) -> AppResult<()> {
    update_setting(
        pool,
        "theme",
        &serde_json::to_string(&settings.theme).unwrap(),
    )
    .await?;
    update_setting(
        pool,
        "notifications_enabled",
        &serde_json::to_string(&settings.notifications_enabled).unwrap(),
    )
    .await?;
    update_setting(
        pool,
        "sound_enabled",
        &serde_json::to_string(&settings.sound_enabled).unwrap(),
    )
    .await?;
    update_setting(
        pool,
        "auto_start",
        &serde_json::to_string(&settings.auto_start).unwrap(),
    )
    .await?;
    update_setting(
        pool,
        "minimize_to_tray",
        &serde_json::to_string(&settings.minimize_to_tray).unwrap(),
    )
    .await?;

    Ok(())
}
