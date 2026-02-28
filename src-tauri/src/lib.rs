pub mod core;
pub mod db;
pub mod security;
pub mod utils;
pub mod importer;
pub mod exporter;

use tauri::State;
use std::sync::Arc;
use crate::core::{AppState, ConnectionConfig, QueryResult, TableMetadata, FilterConfig, SidebarItem, SidebarItemType, connection_manager::ConnectionManager};
use crate::core::query_engine::QueryEngine;
use crate::core::ai_service;
use uuid::Uuid;

use tauri::{Emitter, Window};
use tokio_util::sync::CancellationToken;
use std::collections::HashMap;
use tokio::sync::Mutex;


#[tauri::command]
async fn cancel_query(
    state: State<'_, AppState>,
    query_id: Uuid,
) -> Result<(), String> {
    let mut active = state.active_queries.lock().await;
    if let Some(token) = active.remove(&query_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
async fn execute_query_streaming(
    state: State<'_, AppState>,
    window: Window,
    connection_id: Uuid,
    query_id: Uuid,
    sql: String,
) -> Result<(), String> {
    let token = CancellationToken::new();
    
    {
        let mut active = state.active_queries.lock().await;
        active.insert(query_id, token.clone());
    }

    let active_queries = state.active_queries.clone();
    let connection_manager = state.connection_manager.clone();

    // Run the actual query in a background task so we can return the query_id immediately
    tokio::spawn(async move {
        let result = QueryEngine::execute_query_streaming(
            &connection_manager,
            &connection_id,
            &sql,
            query_id,
            &window,
            token,
        ).await;

        if let Err(e) = result {
            let _ = window.emit("query-error", serde_json::json!({
                "query_id": query_id,
                "error": e.to_string()
            }));
        }

        // Cleanup
        let mut active = active_queries.lock().await;
        active.remove(&query_id);
    });

    Ok(())
}

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
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<QueryResult, String> {
    let result = QueryEngine::execute_query(
        &state.connection_manager, 
        &connection_id, 
        &sql, 
        page, 
        page_size
    ).await;
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
async fn get_sidebar_items(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<SidebarItem>, String> {
    QueryEngine::get_sidebar_items(&state.connection_manager, &connection_id).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_data(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
    limit: u32,
    offset: u32,
    filters: Option<Vec<FilterConfig>>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Result<QueryResult, String> {
    let filters = filters.unwrap_or_default();
    QueryEngine::get_table_data(&state.connection_manager, &connection_id, &table_name, limit, offset, filters, sort_column, sort_direction).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_count(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
    filters: Option<Vec<FilterConfig>>,
) -> Result<u64, String> {
    let filters = filters.unwrap_or_default();
    QueryEngine::get_table_count(&state.connection_manager, &connection_id, &table_name, filters).await
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
async fn get_table_structure(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
) -> Result<crate::core::TableStructure, String> {
    QueryEngine::get_table_structure(&state.connection_manager, &connection_id, &table_name).await
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

#[tauri::command]
async fn export_table_data(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
    filters: Option<Vec<FilterConfig>>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    format: String,
    file_path: String,
) -> Result<u64, String> {
    let filters = filters.unwrap_or_default();
    QueryEngine::export_table_data(&state.connection_manager, &connection_id, &table_name, filters, sort_column, sort_direction, &format, &file_path).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn text_to_sql(
    state: State<'_, AppState>,
    connection_id: Uuid,
    prompt: String,
) -> Result<String, String> {
    // Read API key from environment
    let api_key = std::env::var("YOUR_GROQ_API_KEY")
        .map_err(|_| "Groq API key not found. Set YOUR_GROQ_API_KEY in .env file".to_string())?;

    // Detect database type
    let db_type = {
        if state.connection_manager.get_postgres_pools().await.contains_key(&connection_id) {
            "PostgreSQL"
        } else if state.connection_manager.get_mysql_pools().await.contains_key(&connection_id) {
            "MySQL"
        } else if state.connection_manager.get_sqlite_pools().await.contains_key(&connection_id) {
            "SQLite"
        } else {
            return Err("Connection not found".to_string());
        }
    }.to_string();

    // Fetch all tables/views from sidebar items
    let items = QueryEngine::get_sidebar_items(&state.connection_manager, &connection_id)
        .await
        .map_err(|e| format!("Failed to fetch tables: {}", e))?;

    let table_names: Vec<&str> = items
        .iter()
        .filter(|i| matches!(i.item_type, SidebarItemType::Table | SidebarItemType::View))
        .map(|i| i.name.as_str())
        .take(50) // Limit to prevent excessive API calls
        .collect();

    // Build schema context by fetching structure for each table
    let mut schema_parts: Vec<String> = Vec::new();
    for table_name in &table_names {
        match QueryEngine::get_table_structure(&state.connection_manager, &connection_id, table_name).await {
            Ok(structure) => {
                let cols: Vec<String> = structure.columns.iter().map(|c| {
                    let pk = if c.is_primary_key { " PRIMARY KEY" } else { "" };
                    let nullable = if c.is_nullable { " NULL" } else { " NOT NULL" };
                    format!("  {} {}{}{}", c.name, c.data_type, pk, nullable)
                }).collect();
                schema_parts.push(format!("TABLE {}:\n{}", table_name, cols.join("\n")));
            },
            Err(_) => {
                schema_parts.push(format!("TABLE {} (columns unavailable)", table_name));
            }
        }
    }

    let schema_context = schema_parts.join("\n\n");

    // Call Gemini API
    ai_service::generate_sql(&api_key, &prompt, &schema_context, &db_type)
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    let connection_manager = Arc::new(ConnectionManager::new());
    let state = AppState {
        connection_manager: connection_manager.clone(),
        active_queries: Arc::new(Mutex::new(HashMap::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            connect, 
            test_connection, 
            execute_query, 
            execute_query_streaming,
            cancel_query,
            create_database, 
            switch_database, 
            get_databases, 
            get_tables, 
            get_table_data, 
            get_table_count, 
            get_table_metadata, 
            get_table_structure, 
            get_sidebar_items,
            execute_mutations, 
            export_table_data,
            text_to_sql,
            importer::csv_importer::preview_csv,
            importer::csv_importer::import_csv,
            importer::sql_importer::import_sql_dump,
            exporter::exporter::export_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
