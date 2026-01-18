pub mod connection_manager;
pub mod query_engine;

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DatabaseType {
    Postgres,
    MySql,
    Sqlite,
}

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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableMetadata {
    pub total_size: Option<String>,
    pub data_size: Option<String>,
    pub index_size: Option<String>,
    pub comment: Option<String>,
}

pub struct AppState {
    pub connection_manager: Arc<connection_manager::ConnectionManager>,
}
