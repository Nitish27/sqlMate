pub mod core;
pub mod db;
pub mod exporter;
pub mod importer;
pub mod row_drafts;
pub mod security;
pub mod utils;

use crate::core::ai_adapters;
use crate::core::ai_credentials::{
    self, AiKeyStore, AiProviderId, AiProviderStatus, AiSettings, KeychainAiStore,
};
use crate::core::ai_review::{self, AiAction, AiReviewPreview, FailedAiQuery};
use crate::core::execution_policy::{ExecutionPolicy, Operation, SafetyMode};
use crate::core::query_engine::QueryEngine;
use crate::core::query_parameters::{compile_query, DatabaseDialect, QueryParameter};
use crate::core::{
    connection_manager::ConnectionManager, telemetry, AiSchemaCacheEntry, AiSchemaTable, AppState,
    ConnectionConfig, DatabaseType, FilterConfig, QueryPlanResult, QueryResult, SidebarItem,
    SidebarItemType, TableMetadata,
};
use crate::security::SecureStore;
use serde::Serialize;
use std::sync::Arc;
use tauri::Manager;
use tauri::State;
use uuid::Uuid;

use std::cmp::Reverse;
use std::collections::HashMap;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};
use tokio::sync::Mutex;
use tokio::sync::OwnedRwLockReadGuard;
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
    state.ai_reviews.clear_connection(*connection_id);
}

async fn authorize_execution(
    state: &AppState,
    connection_id: Uuid,
    expected_database: &str,
    operation: &Operation,
    approval_token: Option<Uuid>,
) -> Result<(OwnedRwLockReadGuard<()>, SafetyMode), String> {
    let guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    let (database, mode) = state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    state
        .execution_policy
        .authorize(
            mode,
            connection_id,
            &database,
            expected_database,
            operation,
            approval_token,
        )
        .await?;
    Ok((guard, mode))
}

#[tauri::command]
async fn get_execution_context(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<(String, SafetyMode), String> {
    let _guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_connection_safety_mode(
    state: State<'_, AppState>,
    connection_id: Uuid,
    mode: SafetyMode,
) -> Result<(), String> {
    state
        .connection_manager
        .set_safety_mode(&connection_id, mode)
        .await
        .map_err(|e| e.to_string())?;
    state
        .execution_policy
        .revoke_connection(connection_id)
        .await;
    Ok(())
}

#[tauri::command]
async fn set_connection_ai_metadata(
    state: State<'_, AppState>,
    connection_id: Uuid,
    environment: String,
    ai_enabled: Option<bool>,
) -> Result<bool, String> {
    state
        .connection_manager
        .set_ai_metadata(&connection_id, environment, ai_enabled)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn prepare_execution(
    state: State<'_, AppState>,
    connection_id: Uuid,
    expected_database: String,
    operation: Operation,
) -> Result<Uuid, String> {
    let _guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    let (database, mode) = state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    if database != expected_database {
        return Err("The database changed. Review the target and try again.".to_string());
    }
    state
        .execution_policy
        .prepare(mode, connection_id, &database, operation)
        .await
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
    expected_database: String,
    approval_token: Option<Uuid>,
    parameters: Option<Vec<QueryParameter>>,
) -> Result<(), String> {
    let compiled = if let Some(ref parameters) = parameters {
        let config = state
            .connection_manager
            .get_config(&connection_id)
            .await
            .map_err(|e| e.to_string())?;
        let dialect = match config.db_type {
            DatabaseType::Postgres => DatabaseDialect::Postgres,
            DatabaseType::MySql => DatabaseDialect::MySql,
            DatabaseType::Sqlite => DatabaseDialect::Sqlite,
        };
        Some(compile_query(&sql, parameters, dialect)?)
    } else {
        None
    };
    let (guard, mode) = authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &Operation::Sql(sql.clone()),
        approval_token,
    )
    .await?;
    let token = CancellationToken::new();

    {
        let mut active = state.active_queries.lock().await;
        active.insert(query_id, token.clone());
    }

    let active_queries = state.active_queries.clone();
    let connection_manager = state.connection_manager.clone();
    let failed_queries = state.ai_failed_queries.clone();

    // Run the actual query in a background task so we can return the query_id immediately
    tokio::spawn(async move {
        let _guard = guard;
        let query_sql = compiled
            .as_ref()
            .map_or(sql.as_str(), |query| query.sql.as_str());
        let parameter_values = compiled.as_ref().map(|query| query.values.as_slice());
        let result = QueryEngine::execute_query_streaming(
            &connection_manager,
            &connection_id,
            query_sql,
            query_id,
            &window,
            token.clone(),
            mode == SafetyMode::Safe || parameter_values.is_some(),
            parameter_values,
        )
        .await;

        if let Err(e) = result {
            let error = if parameter_values.is_some() {
                if e.to_string().contains("in-memory SQLite databases") {
                    "Parameterized SELECT is unavailable for in-memory SQLite databases. Use a file-backed database."
                        .to_string()
                } else {
                    "Parameterized SELECT failed. Check the SQL and parameter types, then try again."
                        .to_string()
                }
            } else {
                e.to_string()
            };
            if !token.is_cancelled() && parameter_values.is_none() {
                failed_queries.record(
                    connection_id,
                    FailedAiQuery {
                        database: expected_database,
                        sql,
                        error: error.clone(),
                    },
                );
            }
            let _ = window.emit(
                "query-error",
                serde_json::json!({
                    "query_id": query_id,
                    "error": error
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
    mut config: ConnectionConfig,
    password: Option<String>,
    remember_credentials: Option<bool>,
    clear_credentials: Option<bool>,
) -> Result<(), String> {
    let connection_id = config.id;
    let remember = remember_credentials.unwrap_or(false);
    let db_password = if password.is_some() || !remember {
        password
    } else {
        SecureStore::get_optional_password(&connection_id).map_err(|e| e.to_string())?
    };
    if config.ssh_enabled
        && config.ssh_auth_method.as_deref() == Some("password")
        && config.ssh_password.is_none()
        && remember
    {
        config.ssh_password =
            SecureStore::get_optional_ssh_password(&connection_id).map_err(|e| e.to_string())?;
    }
    let ssh_password = config.ssh_password.clone();
    invalidate_ai_schema_cache(&state, &connection_id).await;
    state
        .connection_manager
        .connect(config, db_password.clone())
        .await
        .map_err(|e| e.to_string())?;
    state.ai_failed_queries.clear_connection(connection_id);
    if remember {
        let save_result =
            SecureStore::save_password(&connection_id, db_password.as_deref().unwrap_or_default())
                .and_then(|_| {
                    if let Some(ssh_password) = ssh_password.as_deref() {
                        SecureStore::save_ssh_password(&connection_id, ssh_password)
                    } else {
                        SecureStore::delete_ssh_password(&connection_id)
                    }
                });
        if let Err(error) = save_result {
            let _ = disconnect(state.clone(), connection_id).await;
            return Err(format!(
                "CREDENTIAL_STORAGE_FAILED: {}. Connection was closed.",
                error
            ));
        }
    } else if clear_credentials.unwrap_or(false) {
        let delete_result = SecureStore::delete_password(&connection_id)
            .and_then(|_| SecureStore::delete_ssh_password(&connection_id));
        if let Err(error) = delete_result {
            let _ = disconnect(state.clone(), connection_id).await;
            return Err(format!(
                "CREDENTIAL_STORAGE_FAILED: {}. Connection was closed.",
                error
            ));
        }
    }
    state
        .execution_policy
        .revoke_connection(connection_id)
        .await;
    Ok(())
}

#[derive(serde::Serialize)]
struct CredentialStatus {
    database: bool,
    ssh: bool,
}

#[tauri::command]
fn credential_status(connection_id: Uuid) -> Result<CredentialStatus, String> {
    Ok(CredentialStatus {
        database: SecureStore::get_optional_password(&connection_id)
            .map_err(|e| e.to_string())?
            .is_some(),
        ssh: SecureStore::get_optional_ssh_password(&connection_id)
            .map_err(|e| e.to_string())?
            .is_some(),
    })
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>, connection_id: Uuid) -> Result<(), String> {
    state
        .connection_manager
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    state
        .execution_policy
        .revoke_connection(connection_id)
        .await;
    invalidate_ai_schema_cache(&state, &connection_id).await;
    state.ai_failed_queries.clear_connection(connection_id);
    Ok(())
}

#[tauri::command]
async fn forget_connection(state: State<'_, AppState>, connection_id: Uuid) -> Result<(), String> {
    SecureStore::delete_password(&connection_id).map_err(|e| e.to_string())?;
    SecureStore::delete_ssh_password(&connection_id).map_err(|e| e.to_string())?;
    disconnect(state.clone(), connection_id).await?;
    Ok(())
}

#[tauri::command]
async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
    remember_credentials: Option<bool>,
) -> Result<(), String> {
    let password = if password.is_none() && remember_credentials.unwrap_or(false) {
        SecureStore::get_optional_password(&config.id).map_err(|e| e.to_string())?
    } else {
        password
    };
    let mut config = config;
    if config.ssh_enabled
        && config.ssh_auth_method.as_deref() == Some("password")
        && config.ssh_password.is_none()
        && remember_credentials.unwrap_or(false)
    {
        config.ssh_password =
            SecureStore::get_optional_ssh_password(&config.id).map_err(|e| e.to_string())?;
    }
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
    expected_database: String,
    approval_token: Option<Uuid>,
) -> Result<QueryResult, String> {
    let (_guard, mode) = authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &Operation::Sql(sql.clone()),
        approval_token,
    )
    .await?;
    let result = if mode == SafetyMode::Safe {
        QueryEngine::execute_read_only_query(
            &state.connection_manager,
            &connection_id,
            &sql,
            page,
            page_size,
        )
        .await
    } else {
        QueryEngine::execute_query(
            &state.connection_manager,
            &connection_id,
            &sql,
            page,
            page_size,
        )
        .await
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn explain_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    expected_database: String,
    approval_token: Option<Uuid>,
) -> Result<QueryPlanResult, String> {
    let (_guard, _) = authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &Operation::Sql(sql.clone()),
        approval_token,
    )
    .await?;
    QueryEngine::explain_query(&state.connection_manager, &connection_id, &sql)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_database(
    state: State<'_, AppState>,
    connection_id: Uuid,
    db_name: String,
    expected_database: String,
    approval_token: Option<Uuid>,
) -> Result<(), String> {
    let (_guard, _) = authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &Operation::CreateDatabase(db_name.clone()),
        approval_token,
    )
    .await?;
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
    state
        .execution_policy
        .revoke_connection(connection_id)
        .await;
    invalidate_ai_schema_cache(&state, &connection_id).await;
    state.ai_failed_queries.clear_connection(connection_id);
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
async fn get_sql_completion_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
    expected_database: String,
) -> Result<Vec<SidebarItem>, String> {
    let _guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    let (database, _) = state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    if database != expected_database {
        return Err("Connection database changed; refresh completions".to_string());
    }
    QueryEngine::get_sidebar_items(&state.connection_manager, &connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_sql_completion_columns(
    state: State<'_, AppState>,
    connection_id: Uuid,
    expected_database: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<String>, String> {
    let _guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    let (database, _) = state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
    if database != expected_database {
        return Err("Connection database changed; refresh completions".to_string());
    }
    QueryEngine::get_sql_completion_columns(
        &state.connection_manager,
        &connection_id,
        &table_name,
        schema.as_deref(),
    )
    .await
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
    primary_keys: Option<Vec<String>>,
    seek_after: Option<serde_json::Value>,
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
        primary_keys.unwrap_or_default(),
        seek_after,
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
async fn commit_row_changes(
    state: State<'_, AppState>,
    connection_id: Uuid,
    batch: serde_json::Value,
    expected_database: String,
    approval_token: Option<Uuid>,
) -> Result<u64, String> {
    let (_guard, _) = authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &Operation::RowChanges(batch.clone()),
        approval_token,
    )
    .await?;
    let typed_batch: crate::core::row_commit::RowMutationBatch =
        serde_json::from_value(batch).map_err(|e| e.to_string())?;
    let affected_rows = crate::core::row_commit::commit_row_changes(
        &state.connection_manager,
        &connection_id,
        typed_batch,
    )
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

fn ai_config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|_| "Could not locate AI configuration directory".to_string())
}

fn migrate_legacy_ai_key(app: &tauri::AppHandle) -> Result<(), String> {
    let path = ai_config_dir(app)?.join("config.json");
    ai_credentials::migrate_legacy_groq_key(&KeychainAiStore, &path)
        .map(|_| ())
        .map_err(|error| format!("Could not migrate legacy Groq key: {error}"))
}

#[tauri::command]
fn list_ai_provider_status(app: tauri::AppHandle) -> Result<Vec<AiProviderStatus>, String> {
    migrate_legacy_ai_key(&app)?;
    AiProviderId::ALL
        .iter()
        .map(|provider| {
            ai_credentials::provider_status(
                &KeychainAiStore,
                *provider,
                provider.environment_key().is_some(),
            )
            .map_err(|error| error.to_string())
        })
        .collect()
}

#[tauri::command]
fn save_ai_provider_key(provider: String, key: String) -> Result<(), String> {
    let provider: AiProviderId = provider.parse().map_err(str::to_string)?;
    ai_credentials::save_key(&KeychainAiStore, provider, &key).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_ai_provider_key(app: tauri::AppHandle, provider: String) -> Result<(), String> {
    let provider: AiProviderId = provider.parse().map_err(str::to_string)?;
    if provider == AiProviderId::Groq {
        migrate_legacy_ai_key(&app)?;
    }
    KeychainAiStore
        .delete(provider)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_ai_settings(app: tauri::AppHandle) -> Result<AiSettings, String> {
    let path = ai_config_dir(&app)?.join("ai-settings.json");
    let mut settings =
        ai_credentials::load_ai_settings(&path).map_err(|error| error.to_string())?;
    if settings.default_provider.is_none() {
        settings.default_provider = std::env::var("SQLMATE_AI_PROVIDER")
            .ok()
            .and_then(|value| value.parse().ok());
    }
    Ok(settings)
}

#[tauri::command]
fn set_ai_default(
    app: tauri::AppHandle,
    provider: String,
    model: String,
) -> Result<AiSettings, String> {
    let provider: AiProviderId = provider.parse().map_err(str::to_string)?;
    if !ai_credentials::valid_model_id(&model) {
        return Err("Enter a valid model ID".to_string());
    }
    let configured = ai_credentials::provider_status(
        &KeychainAiStore,
        provider,
        provider.environment_key().is_some(),
    )
    .map_err(|error| error.to_string())?;
    if !configured.configured {
        return Err("Configure this provider's API key first".to_string());
    }
    let path = ai_config_dir(&app)?.join("ai-settings.json");
    let mut settings =
        ai_credentials::load_ai_settings(&path).map_err(|error| error.to_string())?;
    settings.default_provider = Some(provider);
    settings.models.insert(provider, model);
    ai_credentials::save_ai_settings(&path, &settings).map_err(|error| error.to_string())?;
    Ok(settings)
}

#[derive(Serialize)]
struct PreparedAiView {
    review: AiReviewPreview,
    database: String,
    schema_context: String,
    source_sql: Option<String>,
}

#[derive(Serialize)]
struct AiProposal {
    action: AiAction,
    text: String,
}

#[tauri::command]
fn prepare_ai_provider_test(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    provider: String,
    model: Option<String>,
) -> Result<ai_review::AiProviderTestPreview, String> {
    let provider: AiProviderId = provider.parse().map_err(str::to_string)?;
    if provider == AiProviderId::Groq {
        migrate_legacy_ai_key(&app)?;
    }
    let status = ai_credentials::provider_status(
        &KeychainAiStore,
        provider,
        provider.environment_key().is_some(),
    )
    .map_err(|error| error.to_string())?;
    if !status.configured {
        return Err("Configure this provider's API key before testing".to_string());
    }
    let settings = get_ai_settings(app)?;
    let model = model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| settings.models.get(&provider).cloned())
        .unwrap_or_else(|| ai_adapters::default_model(provider).to_string());
    let request = ai_adapters::build_test_request(provider, &model)?;
    state.ai_provider_tests.prepare(request)
}

#[tauri::command]
async fn send_ai_provider_test(state: State<'_, AppState>, token: Uuid) -> Result<(), String> {
    let request = state.ai_provider_tests.take(token)?;
    let provider = request.provider;
    let key = ai_credentials::resolve_key(
        &KeychainAiStore,
        provider,
        provider.environment_key().as_deref(),
    )
    .map_err(|error| error.to_string())?
    .ok_or_else(|| {
        "The selected provider key is missing. Configure it and prepare again.".to_string()
    })?;
    let bytes = execute_ai_provider_request(&request, &key).await?;
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|_| "AI provider returned an invalid response".to_string())?;
    Ok(())
}

async fn execute_ai_provider_request(
    request: &ai_adapters::AiProviderRequest,
    key: &str,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize AI network client".to_string())?;
    let http = ai_review::build_provider_http_request(request, key)?;
    let mut response = client.execute(http).await.map_err(|error| {
        if error.is_timeout() {
            "AI request timed out. Try again."
        } else {
            "Could not reach the selected AI provider. Try again."
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            400 | 404 | 422 => {
                "AI provider rejected the model or request. Check the model ID and try again."
                    .to_string()
            }
            401 | 403 => "AI provider rejected the API key or access. Check the selected account."
                .to_string(),
            429 => "AI provider rate limit or quota reached. Try again later.".to_string(),
            _ => format!("AI provider returned HTTP {}. Try again.", status.as_u16()),
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read AI provider response".to_string())?
    {
        if bytes.len().saturating_add(chunk.len()) > ai_adapters::MAX_RESPONSE_BYTES {
            return Err("AI provider response was too large".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
async fn prepare_ai_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    expected_database: String,
    provider: String,
    model: Option<String>,
    action: AiAction,
    instruction: String,
    active_sql: Option<String>,
    schema_override: Option<String>,
) -> Result<PreparedAiView, String> {
    let _guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    let (database, _) = state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|error| error.to_string())?;
    if database != expected_database {
        return Err("Connection database changed. Review the target and try again.".to_string());
    }
    state
        .connection_manager
        .authorize_ai(&connection_id)
        .await
        .map_err(|error| error.to_string())?;
    let provider: AiProviderId = provider.parse().map_err(str::to_string)?;
    if provider == AiProviderId::Groq {
        migrate_legacy_ai_key(&app)?;
    }
    let available = ai_credentials::provider_status(
        &KeychainAiStore,
        provider,
        provider.environment_key().is_some(),
    )
    .map_err(|error| error.to_string())?;
    if !available.configured {
        return Err(format!(
            "Configure the {} API key before requesting AI assistance",
            provider.as_str()
        ));
    }
    let settings = get_ai_settings(app)?;
    let model = model
        .filter(|name| !name.trim().is_empty())
        .or_else(|| settings.models.get(&provider).cloned())
        .unwrap_or_else(|| ai_adapters::default_model(provider).to_string());
    let db_type = if state
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
    };
    let failed = if action == AiAction::Fix {
        state.ai_failed_queries.get(connection_id, &database)
    } else {
        None
    };
    let relevance = match action {
        AiAction::Generate => instruction.as_str(),
        AiAction::Explain => active_sql.as_deref().unwrap_or(""),
        AiAction::Fix => failed
            .as_ref()
            .map(|entry| entry.sql.as_str())
            .unwrap_or(""),
    };
    if instruction.len() > 4_096 || active_sql.as_ref().is_some_and(|sql| sql.len() > 65_536) {
        return Err("AI instruction or SQL is too large".to_string());
    }
    let schema_context = match schema_override {
        Some(context) => context,
        None => {
            let tables = get_cached_ai_schema(&state, &connection_id).await?;
            build_schema_context(&tables, relevance)
        }
    };
    let prompt = ai_review::build_prompt(ai_review::AiPromptInput {
        action,
        instruction: &instruction,
        schema_context: &schema_context,
        active_sql: active_sql.as_deref(),
        failed: failed.as_ref(),
        database_type: db_type,
    })?;
    let request = ai_adapters::build_request(provider, &model, &prompt.system, &prompt.user)?;
    let review = state
        .ai_reviews
        .prepare(connection_id, database.clone(), action, request)?;
    Ok(PreparedAiView {
        review,
        database,
        schema_context,
        source_sql: prompt.source_sql,
    })
}

#[tauri::command]
async fn send_ai_request(state: State<'_, AppState>, token: Uuid) -> Result<AiProposal, String> {
    let connection_id = state
        .ai_reviews
        .connection_for_token(token)
        .ok_or_else(|| "AI review expired or was already sent. Review again.".to_string())?;
    let _guard = state
        .connection_manager
        .execution_guard(&connection_id)
        .await;
    let (database, _) = state
        .connection_manager
        .execution_context(&connection_id)
        .await
        .map_err(|_| "Connection changed. Review again before sending.".to_string())?;
    let policy_allowed = state
        .connection_manager
        .authorize_ai(&connection_id)
        .await
        .is_ok();
    let prepared = state
        .ai_reviews
        .take(token, connection_id, &database, policy_allowed)?;
    let provider = prepared.provider;
    let environment_key = provider.environment_key();
    let key = ai_credentials::resolve_key(&KeychainAiStore, provider, environment_key.as_deref())
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "The selected provider key is missing. Configure it and review again.".to_string()
        })?;
    let bytes = execute_ai_provider_request(&prepared.request, &key).await?;
    let text = ai_adapters::parse_response(provider, &bytes)?;
    let text = if prepared.action == AiAction::Explain {
        text
    } else {
        ai_review::strip_sql_fence(&text)
    };
    Ok(AiProposal {
        action: prepared.action,
        text,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    let connection_manager = Arc::new(ConnectionManager::new());
    let state = AppState {
        connection_manager: connection_manager.clone(),
        active_queries: Arc::new(Mutex::new(HashMap::new())),
        ai_schema_cache: Arc::new(Mutex::new(HashMap::new())),
        ai_reviews: ai_review::AiReviewStore::default(),
        ai_provider_tests: ai_review::AiProviderTestStore::default(),
        ai_failed_queries: Arc::new(ai_review::AiFailedQueryStore::default()),
        execution_policy: ExecutionPolicy::default(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Ok(config_dir) = app.path().app_config_dir() {
                dotenvy::from_path(config_dir.join(".env")).ok();
            }
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            telemetry::start(app.package_info().version.to_string());
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            connect,
            credential_status,
            disconnect,
            forget_connection,
            get_execution_context,
            set_connection_safety_mode,
            set_connection_ai_metadata,
            prepare_execution,
            test_connection,
            execute_query,
            explain_query,
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
            get_sql_completion_tables,
            get_sql_completion_columns,
            commit_row_changes,
            row_drafts::load_row_draft,
            row_drafts::save_row_draft,
            row_drafts::delete_row_draft,
            row_drafts::list_row_draft_summaries,
            row_drafts::load_workspace,
            row_drafts::save_workspace,
            row_drafts::load_saved_queries,
            row_drafts::save_saved_queries,
            export_table_data,
            list_ai_provider_status,
            save_ai_provider_key,
            delete_ai_provider_key,
            get_ai_settings,
            set_ai_default,
            prepare_ai_provider_test,
            send_ai_provider_test,
            prepare_ai_request,
            send_ai_request,
            importer::csv_importer::preview_csv,
            importer::csv_importer::import_csv,
            importer::sql_importer::import_sql_dump,
            exporter::exporter::export_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
