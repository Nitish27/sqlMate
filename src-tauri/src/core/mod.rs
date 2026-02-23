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

use std::collections::HashMap;
use tokio_util::sync::CancellationToken;
use tokio::sync::Mutex;

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

pub struct AppState {
    pub connection_manager: Arc<connection_manager::ConnectionManager>,
    pub active_queries: Arc<Mutex<HashMap<Uuid, CancellationToken>>>,
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
}

