use crate::core::ai_adapters::{AiAuthentication, AiProviderRequest};
use crate::core::ai_credentials::AiProviderId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

const REVIEW_TTL: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiAction {
    Generate,
    Explain,
    Fix,
}

#[derive(Debug, Serialize)]
pub struct AiReviewPreview {
    pub token: Uuid,
    pub expires_in_seconds: u64,
    pub provider: AiProviderId,
    pub model: String,
    pub action: AiAction,
    pub destination: String,
    pub request_body: String,
    pub authentication: &'static str,
}

pub struct PreparedAiRequest {
    pub provider: AiProviderId,
    pub action: AiAction,
    pub request: AiProviderRequest,
}

pub fn build_http_request(
    prepared: &PreparedAiRequest,
    key: &str,
) -> Result<reqwest::Request, String> {
    build_provider_http_request(&prepared.request, key)
}

pub fn build_provider_http_request(
    provider_request: &AiProviderRequest,
    key: &str,
) -> Result<reqwest::Request, String> {
    use reqwest::header::{HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

    let url = reqwest::Url::parse(&provider_request.destination)
        .map_err(|_| "Invalid AI provider destination".to_string())?;
    let mut request = reqwest::Request::new(reqwest::Method::POST, url);
    request
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    match provider_request.authentication {
        AiAuthentication::Bearer => {
            let value = HeaderValue::from_str(&format!("Bearer {key}"))
                .map_err(|_| "Invalid AI provider key".to_string())?;
            request.headers_mut().insert(AUTHORIZATION, value);
        }
        AiAuthentication::ApiKeyHeader(header) => {
            let name = HeaderName::from_bytes(header.as_bytes())
                .map_err(|_| "Invalid AI provider authentication header".to_string())?;
            let value =
                HeaderValue::from_str(key).map_err(|_| "Invalid AI provider key".to_string())?;
            request.headers_mut().insert(name, value);
        }
    }
    for (header, value) in provider_request.extra_headers {
        let name = HeaderName::from_bytes(header.as_bytes())
            .map_err(|_| "Invalid AI provider header".to_string())?;
        request
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
    *request.body_mut() = Some(provider_request.body.clone().into());
    Ok(request)
}

pub struct AiReviewStore {
    entries: Mutex<HashMap<Uuid, PreparedReview>>,
}

#[derive(Default)]
pub struct AiProviderTestStore {
    entries: Mutex<HashMap<Uuid, PreparedProviderTest>>,
}

struct PreparedProviderTest {
    created_at: Instant,
    request: AiProviderRequest,
}

#[derive(Debug, Serialize)]
pub struct AiProviderTestPreview {
    pub token: Uuid,
    pub expires_in_seconds: u64,
    pub provider: AiProviderId,
    pub model: String,
    pub destination: String,
    pub request_body: String,
    pub authentication: &'static str,
}

impl AiProviderTestStore {
    pub fn prepare(&self, request: AiProviderRequest) -> Result<AiProviderTestPreview, String> {
        let token = Uuid::new_v4();
        let preview = AiProviderTestPreview {
            token,
            expires_in_seconds: REVIEW_TTL.as_secs(),
            provider: request.provider,
            model: request.model.clone(),
            destination: request.destination.clone(),
            request_body: String::from_utf8(request.body.clone())
                .map_err(|_| "Could not prepare provider test".to_string())?,
            authentication: "Stored API key (not shown)",
        };
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Could not prepare provider test".to_string())?;
        entries.retain(|_, entry| entry.created_at.elapsed() < REVIEW_TTL);
        if entries.len() >= 32 {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(id, _)| *id)
            {
                entries.remove(&oldest);
            }
        }
        entries.insert(
            token,
            PreparedProviderTest {
                created_at: Instant::now(),
                request,
            },
        );
        Ok(preview)
    }

    pub fn take(&self, token: Uuid) -> Result<AiProviderRequest, String> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "Could not open provider test".to_string())?
            .remove(&token)
            .ok_or_else(|| {
                "Provider test expired or was already sent. Prepare again.".to_string()
            })?;
        if entry.created_at.elapsed() >= REVIEW_TTL {
            return Err("Provider test expired. Prepare again before sending.".to_string());
        }
        Ok(entry.request)
    }
}

#[derive(Debug, Clone)]
pub struct FailedAiQuery {
    pub database: String,
    pub sql: String,
    pub error: String,
}

#[derive(Default)]
pub struct AiFailedQueryStore {
    entries: Mutex<HashMap<Uuid, FailedAiQuery>>,
}

impl AiFailedQueryStore {
    pub fn record(&self, connection_id: Uuid, failed: FailedAiQuery) {
        if failed.sql.len() > 65_536 || failed.error.len() > 16_384 {
            self.clear_connection(connection_id);
            return;
        }
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(connection_id, failed);
        }
    }

    pub fn get(&self, connection_id: Uuid, database: &str) -> Option<FailedAiQuery> {
        self.entries
            .lock()
            .ok()?
            .get(&connection_id)
            .filter(|entry| entry.database == database)
            .cloned()
    }

    pub fn clear_connection(&self, connection_id: Uuid) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(&connection_id);
        }
    }
}

pub struct AiPromptInput<'a> {
    pub action: AiAction,
    pub instruction: &'a str,
    pub schema_context: &'a str,
    pub active_sql: Option<&'a str>,
    pub failed: Option<&'a FailedAiQuery>,
    pub database_type: &'a str,
}

pub struct AiPrompt {
    pub system: String,
    pub user: String,
    pub source_sql: Option<String>,
}

pub fn build_prompt(input: AiPromptInput<'_>) -> Result<AiPrompt, String> {
    if input.instruction.len() > 4_096 || input.schema_context.len() > 65_536 {
        return Err("AI context is too large. Shorten it and review again.".to_string());
    }
    let guidance = match input.action {
        AiAction::Generate => "Generate one SQL statement for the request. Return SQL only. Do not execute it.",
        AiAction::Explain => "Explain the SQL statement in plain language. Mention assumptions and possible risks. Do not execute it.",
        AiAction::Fix => "Suggest a corrected SQL statement for the failed execution. Return SQL only. Do not execute it.",
    };
    let system = format!(
        "You are a {} SQL assistant. {} Use only the schema metadata below; it may be incomplete. Never invent database results.\n\nSCHEMA METADATA:\n{}",
        input.database_type, guidance, input.schema_context
    );
    let (user, source_sql) = match input.action {
        AiAction::Generate => {
            if input.instruction.trim().is_empty() {
                return Err("Describe the SQL you want to generate".to_string());
            }
            (input.instruction.trim().to_string(), None)
        }
        AiAction::Explain => {
            let sql = input
                .active_sql
                .filter(|sql| !sql.trim().is_empty())
                .ok_or_else(|| "Place the cursor inside a SQL statement to explain".to_string())?;
            if sql.len() > 65_536 {
                return Err("SQL statement is too large for AI review".to_string());
            }
            (
                format!(
                    "Instruction: {}\n\nExecuted SQL is not required. Explain this statement:\n{}",
                    input.instruction.trim(),
                    sql
                ),
                Some(sql.to_string()),
            )
        }
        AiAction::Fix => {
            let failed = input
                .failed
                .ok_or_else(|| "Run a query that fails before asking AI to fix it".to_string())?;
            (
                format!(
                    "Instruction: {}\n\nFailed executed SQL:\n{}\n\nDatabase error:\n{}",
                    input.instruction.trim(),
                    failed.sql,
                    failed.error
                ),
                Some(failed.sql.clone()),
            )
        }
    };
    Ok(AiPrompt {
        system,
        user,
        source_sql,
    })
}

pub fn strip_sql_fence(answer: &str) -> String {
    let trimmed = answer.trim();
    let without_opening = trimmed
        .strip_prefix("```sql\n")
        .or_else(|| trimmed.strip_prefix("```SQL\n"))
        .or_else(|| trimmed.strip_prefix("```\n"));
    without_opening
        .and_then(|body| body.strip_suffix("\n```"))
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

struct PreparedReview {
    connection_id: Uuid,
    database: String,
    created_at: Instant,
    provider: AiProviderId,
    action: AiAction,
    request: AiProviderRequest,
}

impl Default for AiReviewStore {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

impl AiReviewStore {
    pub fn connection_for_token(&self, token: Uuid) -> Option<Uuid> {
        self.entries
            .lock()
            .ok()?
            .get(&token)
            .map(|entry| entry.connection_id)
    }
    pub fn prepare(
        &self,
        connection_id: Uuid,
        database: String,
        action: AiAction,
        request: AiProviderRequest,
    ) -> Result<AiReviewPreview, String> {
        let token = Uuid::new_v4();
        let preview = AiReviewPreview {
            token,
            expires_in_seconds: REVIEW_TTL.as_secs(),
            provider: request.provider,
            model: request.model.clone(),
            action,
            destination: request.destination.clone(),
            request_body: String::from_utf8(request.body.clone())
                .map_err(|_| "Could not prepare AI review".to_string())?,
            authentication: "Stored API key (not shown)",
        };
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Could not prepare AI review")?;
        entries.retain(|_, entry| entry.created_at.elapsed() < REVIEW_TTL);
        if entries.len() >= 32 {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(id, _)| *id)
            {
                entries.remove(&oldest);
            }
        }
        entries.insert(
            token,
            PreparedReview {
                connection_id,
                database,
                created_at: Instant::now(),
                provider: request.provider,
                action,
                request,
            },
        );
        Ok(preview)
    }

    pub fn take(
        &self,
        token: Uuid,
        connection_id: Uuid,
        database: &str,
        policy_allowed: bool,
    ) -> Result<PreparedAiRequest, String> {
        let review = self
            .entries
            .lock()
            .map_err(|_| "Could not open AI review")?
            .remove(&token)
            .ok_or_else(|| "AI review expired or was already sent. Review again.".to_string())?;
        if review.created_at.elapsed() >= REVIEW_TTL {
            return Err("AI review expired. Review again before sending.".to_string());
        }
        if review.connection_id != connection_id || review.database != database {
            return Err("Connection or database changed. Review again before sending.".to_string());
        }
        if !policy_allowed {
            return Err(
                "AI is disabled for this connection. Review again after enabling it.".to_string(),
            );
        }
        Ok(PreparedAiRequest {
            provider: review.provider,
            action: review.action,
            request: review.request,
        })
    }

    pub fn clear_connection(&self, connection_id: Uuid) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, entry| entry.connection_id != connection_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai_adapters::{build_request, default_model};

    fn request() -> AiProviderRequest {
        build_request(
            AiProviderId::Groq,
            default_model(AiProviderId::Groq),
            "system",
            "user",
        )
        .unwrap()
    }

    #[test]
    fn provider_test_preview_is_exactly_the_one_time_outbound_body() {
        let store = AiProviderTestStore::default();
        let request = crate::core::ai_adapters::build_test_request(
            AiProviderId::Groq,
            default_model(AiProviderId::Groq),
        )
        .unwrap();
        let preview = store.prepare(request).unwrap();
        let outbound = store.take(preview.token).unwrap();
        assert_eq!(outbound.body, preview.request_body.as_bytes());
        assert_eq!(outbound.destination, preview.destination);
        assert!(store.take(preview.token).is_err());
    }

    #[test]
    fn provider_test_http_request_uses_reviewed_body_and_header_only_key() {
        for provider in AiProviderId::ALL {
            let store = AiProviderTestStore::default();
            let request =
                crate::core::ai_adapters::build_test_request(provider, default_model(provider))
                    .unwrap();
            let preview = store.prepare(request).unwrap();
            let outbound = store.take(preview.token).unwrap();
            let http = build_provider_http_request(&outbound, "secret-api-key").unwrap();
            assert_eq!(
                http.body().unwrap().as_bytes().unwrap(),
                preview.request_body.as_bytes()
            );
            assert!(!preview.destination.contains("secret-api-key"));
            assert!(!preview.request_body.contains("secret-api-key"));
        }
    }

    #[test]
    fn expired_provider_test_cannot_be_sent() {
        let store = AiProviderTestStore::default();
        let request = crate::core::ai_adapters::build_test_request(
            AiProviderId::Gemini,
            default_model(AiProviderId::Gemini),
        )
        .unwrap();
        let preview = store.prepare(request).unwrap();
        store
            .entries
            .lock()
            .unwrap()
            .get_mut(&preview.token)
            .unwrap()
            .created_at = Instant::now() - REVIEW_TTL - Duration::from_secs(1);
        assert!(store.take(preview.token).is_err());
    }

    #[test]
    fn preview_bytes_are_identical_to_the_one_time_outbound_body() {
        let store = AiReviewStore::default();
        let connection = Uuid::new_v4();
        let preview = store
            .prepare(connection, "main".into(), AiAction::Generate, request())
            .unwrap();
        let prepared = store.take(preview.token, connection, "main", true).unwrap();
        assert_eq!(prepared.request.body, preview.request_body.as_bytes());
        assert!(!preview.request_body.contains("secret-api-key"));
        assert!(store.take(preview.token, connection, "main", true).is_err());
    }

    #[test]
    fn wrong_connection_or_database_consumes_the_token_without_sending() {
        let store = AiReviewStore::default();
        let connection = Uuid::new_v4();
        let preview = store
            .prepare(connection, "main".into(), AiAction::Generate, request())
            .unwrap();
        assert!(store
            .take(preview.token, Uuid::new_v4(), "main", true)
            .is_err());
        assert!(store.take(preview.token, connection, "main", true).is_err());

        let preview = store
            .prepare(connection, "main".into(), AiAction::Generate, request())
            .unwrap();
        assert!(store
            .take(preview.token, connection, "other", true)
            .is_err());
    }

    #[test]
    fn revoked_policy_and_connection_change_invalidate_review() {
        let store = AiReviewStore::default();
        let connection = Uuid::new_v4();
        let preview = store
            .prepare(connection, "main".into(), AiAction::Generate, request())
            .unwrap();
        assert!(store
            .take(preview.token, connection, "main", false)
            .is_err());
        assert!(store.take(preview.token, connection, "main", true).is_err());

        let preview = store
            .prepare(connection, "main".into(), AiAction::Generate, request())
            .unwrap();
        store.clear_connection(connection);
        assert!(store.take(preview.token, connection, "main", true).is_err());
    }

    #[test]
    fn expired_review_cannot_be_sent() {
        let store = AiReviewStore::default();
        let connection = Uuid::new_v4();
        let preview = store
            .prepare(connection, "main".into(), AiAction::Generate, request())
            .unwrap();
        store
            .entries
            .lock()
            .unwrap()
            .get_mut(&preview.token)
            .unwrap()
            .created_at = Instant::now() - REVIEW_TTL - Duration::from_secs(1);
        assert!(store.take(preview.token, connection, "main", true).is_err());
    }

    #[test]
    fn fix_uses_the_executed_failed_statement_not_current_editor_text() {
        let failed = FailedAiQuery {
            database: "main".into(),
            sql: "SELECT bad FROM users".into(),
            error: "Unknown column bad".into(),
        };
        let prompt = build_prompt(AiPromptInput {
            action: AiAction::Fix,
            instruction: "repair it",
            schema_context: "TABLE users: id bigint",
            active_sql: Some("DROP TABLE users"),
            failed: Some(&failed),
            database_type: "MySQL",
        })
        .unwrap();
        assert!(prompt.user.contains("SELECT bad FROM users"));
        assert!(prompt.user.contains("Unknown column bad"));
        assert!(!prompt.user.contains("DROP TABLE users"));
        assert_eq!(prompt.source_sql.as_deref(), Some("SELECT bad FROM users"));
    }

    #[test]
    fn failed_query_context_is_connection_and_database_scoped_and_cleared() {
        let store = AiFailedQueryStore::default();
        let connection = Uuid::new_v4();
        store.record(
            connection,
            FailedAiQuery {
                database: "main".into(),
                sql: "SELECT invalid".into(),
                error: "syntax error".into(),
            },
        );
        assert!(store.get(connection, "main").is_some());
        assert!(store.get(connection, "other").is_none());
        assert!(store.get(Uuid::new_v4(), "main").is_none());
        store.clear_connection(connection);
        assert!(store.get(connection, "main").is_none());
    }

    #[test]
    fn generate_and_explain_require_their_own_context_not_result_rows() {
        let generated = build_prompt(AiPromptInput {
            action: AiAction::Generate,
            instruction: "recent admins",
            schema_context: "TABLE admins: id",
            active_sql: None,
            failed: None,
            database_type: "SQLite",
        })
        .unwrap();
        assert!(generated.user.contains("recent admins"));
        assert!(generated.system.contains("TABLE admins: id"));
        assert!(build_prompt(AiPromptInput {
            action: AiAction::Explain,
            instruction: "",
            schema_context: "",
            active_sql: None,
            failed: None,
            database_type: "SQLite",
        })
        .is_err());
        assert!(build_prompt(AiPromptInput {
            action: AiAction::Fix,
            instruction: "",
            schema_context: "",
            active_sql: Some("SELECT 1"),
            failed: None,
            database_type: "SQLite",
        })
        .is_err());
    }

    #[test]
    fn sql_proposals_remove_only_an_outer_presentation_fence() {
        assert_eq!(strip_sql_fence("```sql\nSELECT 1;\n```"), "SELECT 1;");
        assert_eq!(
            strip_sql_fence("SELECT '```' AS marker;"),
            "SELECT '```' AS marker;"
        );
    }

    #[test]
    fn http_request_transmits_exact_reviewed_bytes_without_exposing_auth_in_preview() {
        for provider in AiProviderId::ALL {
            let store = AiReviewStore::default();
            let connection = Uuid::new_v4();
            let request =
                build_request(provider, default_model(provider), "system", "user").unwrap();
            let preview = store
                .prepare(connection, "main".into(), AiAction::Generate, request)
                .unwrap();
            let prepared = store.take(preview.token, connection, "main", true).unwrap();
            let http = build_http_request(&prepared, "secret-api-key").unwrap();
            assert_eq!(
                http.body().unwrap().as_bytes().unwrap(),
                preview.request_body.as_bytes()
            );
            assert!(!preview.request_body.contains("secret-api-key"));
            assert!(!preview.destination.contains("secret-api-key"));
            match provider {
                AiProviderId::Gemini => {
                    assert_eq!(http.headers()["x-goog-api-key"], "secret-api-key")
                }
                AiProviderId::Anthropic => {
                    assert_eq!(http.headers()["x-api-key"], "secret-api-key")
                }
                _ => assert_eq!(http.headers()["authorization"], "Bearer secret-api-key"),
            }
        }
    }
}
