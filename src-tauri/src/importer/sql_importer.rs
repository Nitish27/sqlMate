use serde::{Deserialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use crate::core::AppState;
use anyhow::{Result, anyhow};

use crate::drivers::DriverConnection;
use crate::importer::{ImportProgress, InsertTarget};
use std::fs::File;
use std::io::{BufReader, BufRead};

#[derive(Deserialize, Debug)]
pub struct SqlImportOptions {
    pub file_path: String,
    pub execute_in_transaction: bool,
}

#[tauri::command]
pub async fn import_sql_dump(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    import_id: String,
    options: SqlImportOptions,
) -> Result<(), String> {
    let registry = state.driver_registry.clone();

    tokio::spawn(async move {
        let result = do_import_sql(app_handle.clone(), &registry, &connection_id, &import_id, &options).await;

        if let Err(e) = result {
            let _ = app_handle.emit("import-progress", ImportProgress {
                import_id: import_id.clone(),
                rows_processed: 0,
                total_rows: None,
                percentage: None,
                status: "error".to_string(),
                error: Some(e.to_string()),
            });
        }
    });

    Ok(())
}

async fn do_import_sql(
    app_handle: AppHandle,
    registry: &crate::drivers::DriverRegistry,
    connection_id: &Uuid,
    import_id: &str,
    options: &SqlImportOptions,
) -> Result<()> {
    // 1. Detect DB type and get pool
    let (db_type, pool_guard) = {
        let connections = registry.get_connections().await;
        let conn = connections.get(connection_id).ok_or_else(|| anyhow!("Connection not found"))?;
        let dt = match conn {
            DriverConnection::Postgres(_) => "postgres",
            DriverConnection::MySQL(_) => "mysql",
            DriverConnection::SQLite(_) => "sqlite",
        };
        let target = match conn {
            DriverConnection::Postgres(d) => InsertTarget::Postgres(d.pool()?.clone()),
            DriverConnection::MySQL(d) => InsertTarget::MySql(d.pool()?.clone()),
            DriverConnection::SQLite(d) => InsertTarget::Sqlite(d.pool()?.clone()),
        };
        (dt.to_string(), target)
    };

    // 2. Open file
    let file = File::open(&options.file_path)?;
    let reader = BufReader::new(file);

    // 3. Process statements
    let mut current_statement = String::new();
    let mut statements_executed = 0u64;
    let mut in_string = false;
    let mut quote_char = ' ';

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
                    execute_statement(&pool_guard, stmt).await?;
                    statements_executed += 1;

                    if statements_executed % 100 == 0 {
                        app_handle.emit("import-progress", ImportProgress {
                            import_id: import_id.to_string(),
                            rows_processed: statements_executed,
                            total_rows: None,
                            percentage: None,
                            status: "processing".to_string(),
                            error: None,
                        })?;
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
        execute_statement(&pool_guard, stmt).await?;
        statements_executed += 1;
    }

    app_handle.emit("import-progress", ImportProgress {
        import_id: import_id.to_string(),
        rows_processed: statements_executed,
        total_rows: Some(statements_executed),
        percentage: Some(100.0),
        status: "complete".to_string(),
        error: None,
    })?;

    Ok(())
}

async fn execute_statement(target: &InsertTarget, sql: &str) -> Result<()> {
    match target {
        InsertTarget::Postgres(pool) => {
            sqlx::query(sql).execute(pool).await?;
        },
        InsertTarget::MySql(pool) => {
            sqlx::query(sql).execute(pool).await?;
        },
        InsertTarget::Sqlite(pool) => {
            sqlx::query(sql).execute(pool).await?;
        }
    }
    Ok(())
}
