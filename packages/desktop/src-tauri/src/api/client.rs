//! HTTP client for NoChat API
//!
//! Handles all communication with the NoChat backend server.

use reqwest::{Client, Response};
use serde::{de::DeserializeOwned, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::{AuthResponse, Conversation, Message, UserInfo};

/// Wrapper for user response from /api/users/me
#[derive(Debug, serde::Deserialize)]
struct UserResponse {
    user: UserInfo,
}

/// API client for NoChat backend
#[derive(Debug, Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
}

impl ApiClient {
    /// Create a new API client
    pub fn new(base_url: &str) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.to_string(),
        }
    }

    /// Build URL for endpoint
    fn url(&self, endpoint: &str) -> String {
        format!("{}{}", self.base_url, endpoint)
    }

    /// Make authenticated GET request
    async fn get<T: DeserializeOwned>(&self, endpoint: &str, token: Option<&str>) -> AppResult<T> {
        let mut request = self.client.get(self.url(endpoint));

        if let Some(token) = token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let response = request.send().await?;
        self.handle_response(response).await
    }

    /// Make authenticated POST request
    async fn post<T: DeserializeOwned, B: Serialize>(
        &self,
        endpoint: &str,
        body: &B,
        token: Option<&str>,
    ) -> AppResult<T> {
        let mut request = self.client.post(self.url(endpoint)).json(body);

        if let Some(token) = token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let response = request.send().await?;
        self.handle_response(response).await
    }

    /// Handle response and parse JSON
    async fn handle_response<T: DeserializeOwned>(&self, response: Response) -> AppResult<T> {
        let status = response.status();

        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::SessionExpired);
        }

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AppError::Auth(format!(
                "API error ({}): {}",
                status, error_text
            )));
        }

        let data = response.json().await?;
        Ok(data)
    }

    // ========================================================================
    // Auth Endpoints
    // ========================================================================

    /// Sign in with email and password
    pub async fn signin(&self, email: &str, password: &str) -> AppResult<AuthResponse> {
        #[derive(Serialize)]
        struct SigninRequest<'a> {
            email: &'a str,
            password: &'a str,
        }

        self.post("/api/auth/signin", &SigninRequest { email, password }, None)
            .await
    }

    /// Sign up with email and password
    pub async fn signup(
        &self,
        email: &str,
        username: &str,
        password: &str,
    ) -> AppResult<AuthResponse> {
        #[derive(Serialize)]
        struct SignupRequest<'a> {
            email: &'a str,
            username: &'a str,
            password: &'a str,
        }

        self.post(
            "/api/auth/signup",
            &SignupRequest {
                email,
                username,
                password,
            },
            None,
        )
        .await
    }

    /// Exchange OAuth code for token
    pub async fn oauth_callback(
        &self,
        provider: &str,
        code: &str,
        state: &str,
    ) -> AppResult<AuthResponse> {
        #[derive(Serialize)]
        struct OAuthRequest<'a> {
            provider: &'a str,
            code: &'a str,
            state: &'a str,
        }

        self.post(
            "/api/auth/oauth/callback",
            &OAuthRequest {
                provider,
                code,
                state,
            },
            None,
        )
        .await
    }

    // ========================================================================
    // User Endpoints
    // ========================================================================

    /// Get current user info
    pub async fn get_current_user(&self, token: &str) -> AppResult<UserInfo> {
        let response: UserResponse = self.get("/api/users/me", Some(token)).await?;
        Ok(response.user)
    }

    /// Get user by ID
    pub async fn get_user(&self, user_id: &str, token: &str) -> AppResult<UserInfo> {
        self.get(&format!("/api/users/{}", user_id), Some(token))
            .await
    }

    /// Search for users
    pub async fn search_users(&self, query: &str, token: &str) -> AppResult<Vec<UserInfo>> {
        self.get(&format!("/api/users/search?q={}", query), Some(token))
            .await
    }

    // ========================================================================
    // Conversation Endpoints
    // ========================================================================

    /// Get user's conversations
    pub async fn get_conversations(&self, token: &str) -> AppResult<Vec<Conversation>> {
        self.get("/api/conversations", Some(token)).await
    }

    /// Create a new conversation
    pub async fn create_conversation(
        &self,
        participant_ids: &[String],
        token: &str,
    ) -> AppResult<Conversation> {
        #[derive(Serialize)]
        struct CreateConversationRequest<'a> {
            participant_ids: &'a [String],
        }

        self.post(
            "/api/conversations",
            &CreateConversationRequest { participant_ids },
            Some(token),
        )
        .await
    }

    // ========================================================================
    // Message Endpoints
    // ========================================================================

    /// Get messages for a conversation (paginated)
    pub async fn get_messages(
        &self,
        conversation_id: &str,
        limit: i64,
        offset: i64,
        token: &str,
    ) -> AppResult<Vec<Message>> {
        self.get(
            &format!(
                "/api/conversations/{}/messages?limit={}&offset={}",
                conversation_id, limit, offset
            ),
            Some(token),
        )
        .await
    }

    /// Send a message to a conversation
    pub async fn send_message(
        &self,
        conversation_id: &str,
        content: &str,
        token: &str,
    ) -> AppResult<Message> {
        #[derive(Serialize)]
        struct SendMessageRequest<'a> {
            content: &'a str,
            encrypted: bool,
        }

        self.post(
            &format!("/api/conversations/{}/messages", conversation_id),
            &SendMessageRequest {
                content,
                encrypted: true,
            },
            Some(token),
        )
        .await
    }
}
