//! Application state management
//!
//! Uses Arc<RwLock<>> for thread-safe concurrent access to shared state.
//! The Rust backend maintains the single source of truth (Headless Core pattern).

use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{AppError, AppResult};

/// User session information
#[derive(Debug, Clone)]
pub struct UserSession {
    pub user_id: String,
    pub token: String,
    pub refresh_token: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// OAuth state for tracking pending authentication flows
#[derive(Debug, Clone)]
pub struct OAuthState {
    pub state: String,
    pub provider: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Global application state
///
/// This struct holds all shared state for the application.
/// It is wrapped in Arc<RwLock<>> for safe concurrent access.
pub struct AppState {
    /// Database connection pool
    pub db: SqlitePool,

    /// Current user session (None if not authenticated)
    pub session: Option<UserSession>,

    /// Pending OAuth states for validation
    pub pending_oauth: Vec<OAuthState>,

    /// Pending deep link URLs (for OAuth callbacks received before frontend is ready)
    pub pending_deep_links: Vec<String>,

    /// API base URL
    pub api_url: String,

    /// WebSocket URL
    pub ws_url: String,
}

impl AppState {
    /// Create new application state with database connection
    pub async fn new(db_path: &str) -> AppResult<Self> {
        // Connect to SQLite with WAL mode for concurrent access
        let db_url = format!("sqlite:{}?mode=rwc", db_path);
        let db = SqlitePool::connect(&db_url).await?;

        // Enable WAL mode for better concurrent performance
        sqlx::query("PRAGMA journal_mode=WAL;")
            .execute(&db)
            .await?;

        // Set synchronous mode to NORMAL for better performance with WAL
        sqlx::query("PRAGMA synchronous=NORMAL;")
            .execute(&db)
            .await?;

        // Run migrations
        sqlx::migrate!("../migrations").run(&db).await?;

        tracing::info!("Database initialized with WAL mode at: {}", db_path);

        Ok(Self {
            db,
            session: None,
            pending_oauth: Vec::new(),
            pending_deep_links: Vec::new(),
            api_url: "https://nochat-server.fly.dev".to_string(),
            ws_url: "wss://nochat-server.fly.dev".to_string(),
        })
    }

    /// Check if user is authenticated
    pub fn is_authenticated(&self) -> bool {
        self.session.is_some()
    }

    /// Get current user ID if authenticated
    pub fn user_id(&self) -> Option<&str> {
        self.session.as_ref().map(|s| s.user_id.as_str())
    }

    /// Get current auth token if authenticated
    pub fn token(&self) -> Option<&str> {
        self.session.as_ref().map(|s| s.token.as_str())
    }

    /// Set user session after successful authentication
    pub fn set_session(&mut self, session: UserSession) {
        self.session = Some(session);
    }

    /// Clear user session on logout
    pub fn clear_session(&mut self) {
        self.session = None;
    }

    /// Add pending OAuth state
    pub fn add_oauth_state(&mut self, state: OAuthState) {
        // Clean up old states (older than 10 minutes)
        let cutoff = chrono::Utc::now() - chrono::Duration::minutes(10);
        self.pending_oauth.retain(|s| s.created_at > cutoff);

        self.pending_oauth.push(state);
    }

    /// Validate and consume OAuth state
    pub fn validate_oauth_state(&mut self, state: &str) -> Option<OAuthState> {
        if let Some(pos) = self.pending_oauth.iter().position(|s| s.state == state) {
            Some(self.pending_oauth.remove(pos))
        } else {
            None
        }
    }

    /// Add a pending deep link URL (for OAuth callbacks received before frontend is ready)
    pub fn add_pending_deep_link(&mut self, url: String) {
        tracing::info!("Storing pending deep link: {}", url);
        self.pending_deep_links.push(url);
    }

    /// Take and clear all pending deep links
    pub fn take_pending_deep_links(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending_deep_links)
    }

    /// Require authentication, returning error if not authenticated
    pub fn require_auth(&self) -> AppResult<&UserSession> {
        self.session.as_ref().ok_or(AppError::NotAuthenticated)
    }
}

/// Thread-safe shared state type
pub type SharedState = Arc<RwLock<AppState>>;

/// Create a new shared state instance
pub async fn create_shared_state(db_path: &str) -> AppResult<SharedState> {
    let state = AppState::new(db_path).await?;
    Ok(Arc::new(RwLock::new(state)))
}
