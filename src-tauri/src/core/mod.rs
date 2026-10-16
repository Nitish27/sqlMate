pub mod ai_adapters;
pub mod ai_credentials;
pub mod ai_review;
pub mod ai_service;
pub mod connection_manager;
pub mod execution_policy;
pub mod query_engine;
pub mod query_parameters;
pub mod read_only_sql;
pub mod row_commit;
pub mod telemetry;

use ai_review::{AiFailedQueryStore, AiProviderTestStore, AiReviewStore};
use execution_policy::{ExecutionPolicy, SafetyMode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DatabaseType {
    Postgres,
    MySql,
    Sqlite,
}

use std::collections::HashMap;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub database: Option<String>,
    pub ssl_enabled: bool,
    pub ssl_mode: Option<String>, // "disable", "prefer", "require", "verify-ca", "verify-full"
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_username: Option<String>,
    pub ssh_auth_method: Option<String>, // "password" | "key"
    pub ssh_password: Option<String>,
    pub ssh_private_key_path: Option<String>,
    pub environment: Option<String>, // "local", "test", "dev", "staging", "production"
    pub color_tag: Option<String>,
    #[serde(default)]
    pub safety_mode: SafetyMode,
    #[serde(default)]
    pub ai_enabled: Option<bool>,
}

impl ConnectionConfig {
    pub fn ai_allowed(&self) -> bool {
        match self.environment.as_deref().map(str::trim) {
            Some("production") => self.ai_enabled == Some(true),
            Some("local" | "test" | "dev" | "staging") => self.ai_enabled != Some(false),
            _ => false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilterConfig {
    pub id: String,
    pub column: String,
    pub operator: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
    pub total_count: Option<u64>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPlanResult {
    pub database_type: String,
    pub plan: serde_json::Value,
    pub planning_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableMetadata {
    pub total_size: Option<String>,
    pub data_size: Option<String>,
    pub index_size: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TableColumnStructure {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TableIndexStructure {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub index_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TableConstraintStructure {
    pub name: String,
    pub constraint_type: String,
    pub definition: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TableStructure {
    pub columns: Vec<TableColumnStructure>,
    pub indexes: Vec<TableIndexStructure>,
    pub constraints: Vec<TableConstraintStructure>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum SidebarItemType {
    Table,
    View,
    Function,
    Procedure,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SidebarItem {
    pub name: String,
    pub item_type: SidebarItemType,
    pub schema: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AiSchemaTable {
    pub name: String,
    pub schema: Option<String>,
    pub item_type: SidebarItemType,
    pub columns: Vec<TableColumnStructure>,
}

#[derive(Debug, Clone)]
pub struct AiSchemaCacheEntry {
    pub tables: Vec<AiSchemaTable>,
    pub cached_at: Instant,
}

pub struct AppState {
    pub connection_manager: Arc<connection_manager::ConnectionManager>,
    pub active_queries: Arc<Mutex<HashMap<Uuid, CancellationToken>>>,
    pub ai_schema_cache: Arc<Mutex<HashMap<Uuid, AiSchemaCacheEntry>>>,
    pub ai_reviews: AiReviewStore,
    pub ai_provider_tests: AiProviderTestStore,
    pub ai_failed_queries: Arc<AiFailedQueryStore>,
    pub execution_policy: ExecutionPolicy,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamingMetadata {
    pub query_id: Uuid,
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamingBatch {
    pub query_id: Uuid,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamingComplete {
    pub query_id: Uuid,
    pub execution_time_ms: u64,
    pub total_rows: u64,
    pub affected_rows: u64,
}

#[cfg(test)]
mod ai_policy_tests {
    use super::ConnectionConfig;
    use serde_json::json;
    use uuid::Uuid;

    fn connection(environment: Option<&str>, enabled: Option<bool>) -> ConnectionConfig {
        serde_json::from_value(json!({
            "id": Uuid::new_v4(), "name": "test", "db_type": "Sqlite",
            "host": null, "port": null, "username": null, "database": "/tmp/test.db",
            "ssl_enabled": false, "ssl_mode": null, "ssl_ca_path": null,
            "ssl_cert_path": null, "ssl_key_path": null, "ssh_enabled": false,
            "ssh_host": null, "ssh_port": null, "ssh_username": null,
            "ssh_auth_method": null, "ssh_password": null, "ssh_private_key_path": null,
            "environment": environment, "color_tag": null, "ai_enabled": enabled
        }))
        .unwrap()
    }

    #[test]
    fn production_and_unknown_environments_are_disabled_by_default() {
        assert!(!connection(Some("production"), None).ai_allowed());
        assert!(!connection(None, None).ai_allowed());
        assert!(!connection(Some("other"), Some(true)).ai_allowed());
    }

    #[test]
    fn production_requires_explicit_opt_in_and_development_can_opt_out() {
        assert!(connection(Some("production"), Some(true)).ai_allowed());
        assert!(connection(Some("dev"), None).ai_allowed());
        assert!(!connection(Some("dev"), Some(false)).ai_allowed());
    }
}
