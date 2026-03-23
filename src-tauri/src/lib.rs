pub mod core;
pub mod db;
pub mod exporter;
pub mod importer;
pub mod security;
pub mod utils;

use crate::core::ai_service;
use crate::core::query_engine::QueryEngine;
use crate::core::{
    connection_manager::ConnectionManager, AiSchemaCacheEntry, AiSchemaTable, AppState,
    ConnectionConfig, FilterConfig, QueryResult, SidebarItem, SidebarItemType, TableMetadata,
};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use std::cmp::Reverse;
use std::collections::HashMap;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const AI_SCHEMA_CACHE_TTL: Duration = Duration::from_secs(300);
const MAX_AI_SCHEMA_TABLES: usize = 12;
const MAX_AI_TABLE_NAMES: usize = 200;

fn tokenize_search_terms(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn expand_search_terms(tokens: Vec<String>) -> HashSet<String> {
    let mut expanded = HashSet::new();

    for token in tokens {
        if token.len() < 2 {
            continue;
        }

        expanded.insert(token.clone());

        if token.ends_with('s') && token.len() > 3 {
            expanded.insert(token.trim_end_matches('s').to_string());
        } else {
            expanded.insert(format!("{}s", token));
        }
    }

    expanded
}

fn format_ai_table_name(table: &AiSchemaTable) -> String {
    match table.schema.as_deref() {
        Some(schema) if !schema.is_empty() && schema != "public" => {
            format!("{}.{}", schema, table.name)
        }
        _ => table.name.clone(),
    }
}

fn table_relevance_score(table: &AiSchemaTable, prompt: &str, terms: &HashSet<String>) -> usize {
    let mut score = 0;
    let table_name = table.name.to_lowercase();

    if prompt.contains(&table_name) {
        score += 10;
    }

    if let Some(schema) = &table.schema {
        let schema_lc = schema.to_lowercase();
        if prompt.contains(&schema_lc) {
            score += 3;
        }
    }

    for token in tokenize_search_terms(&table_name) {
        if terms.contains(&token) {
            score += 4;
        }
    }

    for column in table.columns.iter().take(24) {
        let column_name = column.name.to_lowercase();

        if prompt.contains(&column_name) {
            score += 2;
        }

        for token in tokenize_search_terms(&column_name) {
            if terms.contains(&token) {
                score += 1;
            }
        }
    }

    score
}

fn select_relevant_ai_tables<'a>(
    tables: &'a [AiSchemaTable],
    prompt: &str,
) -> Vec<&'a AiSchemaTable> {
    if tables.is_empty() {
        return Vec::new();
    }

    let prompt_lc = prompt.to_lowercase();
    let terms = expand_search_terms(tokenize_search_terms(&prompt_lc));
    let mut scored = tables
        .iter()
        .map(|table| (table_relevance_score(table, &prompt_lc, &terms), table))
        .collect::<Vec<_>>();

    scored.sort_by_key(|(score, table)| (Reverse(*score), format_ai_table_name(table)));

    let mut selected = scored
        .iter()
        .filter(|(score, _)| *score > 0)
        .take(MAX_AI_SCHEMA_TABLES)
        .map(|(_, table)| *table)
        .collect::<Vec<_>>();

    if selected.is_empty() {
        selected = tables.iter().take(MAX_AI_SCHEMA_TABLES).collect();
    }

    selected
}

fn build_schema_context(tables: &[AiSchemaTable], prompt: &str) -> String {
    if tables.is_empty() {
        return "No schema metadata was available for this connection.".to_string();
    }

    let selected_tables = select_relevant_ai_tables(tables, prompt);
    let total_tables = tables.len();
    let listed_names = tables
        .iter()
        .take(MAX_AI_TABLE_NAMES)
        .map(format_ai_table_name)
        .collect::<Vec<_>>();
    let truncated_count = total_tables.saturating_sub(MAX_AI_TABLE_NAMES);

    let mut sections = Vec::new();
    sections.push(format!(
        "AVAILABLE TABLES/VIEWS ({} total):\n{}{}",
        total_tables,
        listed_names.join(", "),
        if truncated_count > 0 {
            format!(", ... and {} more", truncated_count)
        } else {
            String::new()
        }
    ));

    let detailed_tables = selected_tables
        .into_iter()
        .map(|table| {
            let columns = table
                .columns
                .iter()
                .map(|column| {
                    let pk = if column.is_primary_key {
                        " PRIMARY KEY"
                    } else {
                        ""
                    };
                    let nullable = if column.is_nullable {
                        " NULL"
                    } else {
                        " NOT NULL"
                    };
                    format!("  {} {}{}{}", column.name, column.data_type, pk, nullable)
                })
                .collect::<Vec<_>>()
                .join("\n");

            format!(
                "{} {}:\n{}",
                match table.item_type {
                    SidebarItemType::View => "VIEW",
                    _ => "TABLE",
                },
                format_ai_table_name(table),
                columns
            )
        })
        .collect::<Vec<_>>();

    if !detailed_tables.is_empty() {
        sections.push(format!(
            "MOST RELEVANT SCHEMA DETAILS ({} items):\n{}",
            detailed_tables.len(),
            detailed_tables.join("\n\n")
        ));
    }

    sections.join("\n\n")
}

async fn get_cached_ai_schema(
    state: &AppState,
    connection_id: &Uuid,
) -> Result<Vec<AiSchemaTable>, String> {
    {
        let cache = state.ai_schema_cache.lock().await;
        if let Some(entry) = cache.get(connection_id) {
            if entry.cached_at.elapsed() < AI_SCHEMA_CACHE_TTL {
                return Ok(entry.tables.clone());
            }
        }
    }

    let tables = QueryEngine::get_ai_schema_tables(&state.connection_manager, connection_id)
        .await
        .map_err(|e| format!("Failed to load schema for AI: {}", e))?;

    let mut cache = state.ai_schema_cache.lock().await;
    cache.insert(
        *connection_id,
        AiSchemaCacheEntry {
            tables: tables.clone(),
            cached_at: Instant::now(),
        },
    );

    Ok(tables)
}

async fn invalidate_ai_schema_cache(state: &AppState, connection_id: &Uuid) {
    let mut cache = state.ai_schema_cache.lock().await;
    cache.remove(connection_id);
}

#[tauri::command]
async fn cancel_query(state: State<'_, AppState>, query_id: Uuid) -> Result<(), String> {
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
        )
        .await;

        if let Err(e) = result {
            let _ = window.emit(
                "query-error",
                serde_json::json!({
                    "query_id": query_id,
                    "error": e.to_string()
                }),
            );
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
    invalidate_ai_schema_cache(&state, &config.id).await;
    state
        .connection_manager
        .connect(config, password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<(), String> {
    state
        .connection_manager
        .test_connection(config, password)
        .await
        .map_err(|e| e.to_string())
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
        page_size,
    )
    .await;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_database(
    state: State<'_, AppState>,
    connection_id: Uuid,
    db_name: String,
) -> Result<(), String> {
    QueryEngine::create_database(&state.connection_manager, &connection_id, &db_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<String>, String> {
    QueryEngine::get_databases(&state.connection_manager, &connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn switch_database(
    state: State<'_, AppState>,
    connection_id: Uuid,
    db_name: String,
) -> Result<(), String> {
    state
        .connection_manager
        .switch_database(&connection_id, &db_name)
        .await
        .map_err(|e| e.to_string())?;
    invalidate_ai_schema_cache(&state, &connection_id).await;
    Ok(())
}

#[tauri::command]
async fn get_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<String>, String> {
    QueryEngine::get_tables(&state.connection_manager, &connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_sidebar_items(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<SidebarItem>, String> {
    let items = QueryEngine::get_sidebar_items(&state.connection_manager, &connection_id)
        .await
        .map_err(|e| e.to_string())?;
    invalidate_ai_schema_cache(&state, &connection_id).await;
    Ok(items)
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
    QueryEngine::get_table_data(
        &state.connection_manager,
        &connection_id,
        &table_name,
        limit,
        offset,
        filters,
        sort_column,
        sort_direction,
    )
    .await
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
    QueryEngine::get_table_count(
        &state.connection_manager,
        &connection_id,
        &table_name,
        filters,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_metadata(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
) -> Result<TableMetadata, String> {
    QueryEngine::get_table_metadata(&state.connection_manager, &connection_id, &table_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_table_structure(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_name: String,
) -> Result<crate::core::TableStructure, String> {
    QueryEngine::get_table_structure(&state.connection_manager, &connection_id, &table_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn execute_mutations(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
) -> Result<u64, String> {
    let affected_rows =
        QueryEngine::execute_mutations(&state.connection_manager, &connection_id, statements)
            .await
            .map_err(|e| e.to_string())?;
    invalidate_ai_schema_cache(&state, &connection_id).await;
    Ok(affected_rows)
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
    QueryEngine::export_table_data(
        &state.connection_manager,
        &connection_id,
        &table_name,
        filters,
        sort_column,
        sort_direction,
        &format,
        &file_path,
    )
    .await
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
        if state
            .connection_manager
            .get_postgres_pools()
            .await
            .contains_key(&connection_id)
        {
            "PostgreSQL"
        } else if state
            .connection_manager
            .get_mysql_pools()
            .await
            .contains_key(&connection_id)
        {
            "MySQL"
        } else if state
            .connection_manager
            .get_sqlite_pools()
            .await
            .contains_key(&connection_id)
        {
            "SQLite"
        } else {
            return Err("Connection not found".to_string());
        }
    }
    .to_string();

    let schema_tables = get_cached_ai_schema(&state, &connection_id).await?;
    let schema_context = build_schema_context(&schema_tables, &prompt);

    // Call Gemini API
    ai_service::generate_sql(&api_key, &prompt, &schema_context, &db_type).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    let connection_manager = Arc::new(ConnectionManager::new());
    let state = AppState {
        connection_manager: connection_manager.clone(),
        active_queries: Arc::new(Mutex::new(HashMap::new())),
        ai_schema_cache: Arc::new(Mutex::new(HashMap::new())),
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
