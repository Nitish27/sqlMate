pub mod core;
pub mod db;
pub mod security;
pub mod utils;

use tauri::State;
use std::sync::Arc;
use crate::core::{AppState, ConnectionConfig, QueryResult, TableMetadata, connection_manager::ConnectionManager};
use crate::core::query_engine::QueryEngine;
use uuid::Uuid;

#[tauri::command]
async fn connect(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<(), String> {
    state.connection_manager.connect(config, password).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<(), String> {
    state.connection_manager.test_connection(config, password).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn execute_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<QueryResult, String> {
    let result: anyhow::Result<QueryResult> = QueryEngine::execute_query(&state.connection_manager, &connection_id, &sql).await;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_database(
    state: State<'_, AppState>,
    connection_id: Uuid,
    db_name: String,
) -> Result<(), String> {
    QueryEngine::create_database(&state.connection_manager, &connection_id, &db_name).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<String>, String> {
    QueryEngine::get_databases(&state.connection_manager, &connection_id).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn switch_database(
    state: State<'_, AppState>,
    connection_id: Uuid,
    db_name: String,
) -> Result<(), String> {
    state.connection_manager.switch_database(&connection_id, &db_name).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<String>, String> {
    QueryEngine::get_tables(&state.connection_manager, &connection_id).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_data(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
    limit: u32,
    offset: u32,
) -> Result<QueryResult, String> {
    QueryEngine::get_table_data(&state.connection_manager, &connection_id, &table_name, limit, offset).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_count(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
) -> Result<u64, String> {
    QueryEngine::get_table_count(&state.connection_manager, &connection_id, &table_name).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_metadata(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
) -> Result<TableMetadata, String> {
    QueryEngine::get_table_metadata(&state.connection_manager, &connection_id, &table_name).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn execute_mutations(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
) -> Result<u64, String> {
    QueryEngine::execute_mutations(&state.connection_manager, &connection_id, statements).await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let connection_manager = Arc::new(ConnectionManager::new());
    let state = AppState {
        connection_manager: connection_manager.clone(), // Clone Arc for AppState
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![connect, test_connection, execute_query, create_database, switch_database, get_databases, get_tables, get_table_data, get_table_count, get_table_metadata, execute_mutations])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
