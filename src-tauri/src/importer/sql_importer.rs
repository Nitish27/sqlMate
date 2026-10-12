use crate::core::AppState;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::importer::{ImportProgress, InsertTarget};
use std::fs::File;
use std::io::{BufRead, BufReader};

#[derive(Deserialize, Serialize, Debug)]
pub struct SqlImportOptions {
    pub file_path: String,
    pub execute_in_transaction: bool,
    #[serde(default)]
    pub stop_on_error: bool,
}

#[tauri::command]
pub async fn import_sql_dump(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    import_id: String,
    options: SqlImportOptions,
    expected_database: String,
    approval_token: Option<Uuid>,
) -> Result<(), String> {
    let operation = crate::core::execution_policy::Operation::SqlImport(
        serde_json::to_value(&options).map_err(|e| e.to_string())?,
    );
    let guard = crate::authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &operation,
        approval_token,
    )
    .await?;
    let manager = state.connection_manager.clone();

    tokio::spawn(async move {
        let _guard = guard;
        let result = do_import_sql(
            app_handle.clone(),
            &manager,
            &connection_id,
            &import_id,
            &options,
        )
        .await;

        if let Err(e) = result {
            let _ = app_handle.emit(
                "import-progress",
                ImportProgress {
                    import_id: import_id.clone(),
                    rows_processed: 0,
                    total_rows: None,
                    percentage: None,
                    status: "error".to_string(),
                    error: Some(e.to_string()),
                },
            );
        }
    });

    Ok(())
}

async fn do_import_sql(
    app_handle: AppHandle,
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    import_id: &str,
    options: &SqlImportOptions,
) -> Result<()> {
    // 1. Detect DB type
    let db_type = {
        if manager
            .get_postgres_pools()
            .await
            .contains_key(connection_id)
        {
            Some("postgres")
        } else if manager.get_mysql_pools().await.contains_key(connection_id) {
            Some("mysql")
        } else if manager.get_sqlite_pools().await.contains_key(connection_id) {
            Some("sqlite")
        } else {
            None
        }
    }
    .ok_or_else(|| anyhow!("Connection not found"))?;

    // 2. Open file
    let file = File::open(&options.file_path)?;
    let reader = BufReader::new(file);

    // 3. Process statements
    let mut current_statement = String::new();
    let mut statements_executed = 0u64;
    let mut failed_statements = 0u64;
    let mut first_error = None;
    let mut in_string = false;
    let mut quote_char = ' ';

    // Get pool
    let pool_guard = match db_type {
        "postgres" => InsertTarget::Postgres(
            manager
                .get_postgres_pools()
                .await
                .get(connection_id)
                .unwrap()
                .clone(),
        ),
        "mysql" => InsertTarget::MySql(
            manager
                .get_mysql_pools()
                .await
                .get(connection_id)
                .unwrap()
                .clone(),
        ),
        "sqlite" => InsertTarget::Sqlite(
            manager
                .get_sqlite_pools()
                .await
                .get(connection_id)
                .unwrap()
                .clone(),
        ),
        _ => return Err(anyhow!("Unsupported database type")),
    };

    for line in reader.lines() {
        let line = line?;
        if line.trim().starts_with("--") || line.trim().starts_with("/*") {
            continue; // Basic comment skip
        }

        for c in line.chars() {
            if (c == '\'' || c == '"' || c == '`') && (db_type == "mysql" || c != '`') {
                if in_string {
                    if c == quote_char {
                        in_string = false;
                    }
                } else {
                    in_string = true;
                    quote_char = c;
                }
            }

            current_statement.push(c);

            if c == ';' && !in_string {
                let stmt = current_statement.trim();
                if !stmt.is_empty() {
                    match execute_statement(&pool_guard, stmt).await {
                        Ok(()) => statements_executed += 1,
                        Err(error) if options.stop_on_error => return Err(error),
                        Err(error) => {
                            failed_statements += 1;
                            if first_error.is_none() {
                                first_error = Some(error.to_string());
                            }
                        }
                    }

                    if statements_executed % 100 == 0 {
                        app_handle.emit(
                            "import-progress",
                            ImportProgress {
                                import_id: import_id.to_string(),
                                rows_processed: statements_executed,
                                total_rows: None,
                                percentage: None,
                                status: "processing".to_string(),
                                error: None,
                            },
                        )?;
                    }
                }
                current_statement.clear();
            }
        }
        current_statement.push('\n');
    }

    // Execute remaining
    let stmt = current_statement.trim();
    if !stmt.is_empty() {
        match execute_statement(&pool_guard, stmt).await {
            Ok(()) => statements_executed += 1,
            Err(error) if options.stop_on_error => return Err(error),
            Err(error) => {
                failed_statements += 1;
                if first_error.is_none() {
                    first_error = Some(error.to_string());
                }
            }
        }
    }

    if failed_statements > 0 {
        return Err(anyhow!(
            "{} SQL import statement(s) failed after {} succeeded. First error: {}",
            failed_statements,
            statements_executed,
            first_error.unwrap_or_default()
        ));
    }

    app_handle.emit(
        "import-progress",
        ImportProgress {
            import_id: import_id.to_string(),
            rows_processed: statements_executed,
            total_rows: Some(statements_executed),
            percentage: Some(100.0),
            status: "complete".to_string(),
            error: None,
        },
    )?;

    Ok(())
}

async fn execute_statement(target: &InsertTarget, sql: &str) -> Result<()> {
    match target {
        InsertTarget::Postgres(pool) => {
            sqlx::query(sql).execute(pool).await?;
        }
        InsertTarget::MySql(pool) => {
            sqlx::query(sql).execute(pool).await?;
        }
        InsertTarget::Sqlite(pool) => {
            sqlx::query(sql).execute(pool).await?;
        }
    }
    Ok(())
}
