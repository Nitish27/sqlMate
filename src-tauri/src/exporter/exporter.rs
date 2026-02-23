use std::fs::File;
use std::io::{BufWriter, Write};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use crate::core::AppState;
use anyhow::{Result, anyhow};
use futures::TryStreamExt;
use sqlx::{Row, Column};
use serde_json::Value;

#[derive(Serialize, Clone)]
pub struct ExportProgress {
    pub export_id: String,
    pub current_table: String,
    pub rows_exported: u64,
    pub status: String, // "processing" | "complete" | "error"
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct ExportOptions {
    pub tables: Vec<String>,
    pub output_path: String,
    pub format: String, // "csv" | "json" | "sql"
    pub include_schema: bool,
    pub include_data: bool,
}

#[tauri::command]
pub async fn export_data(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    export_id: String,
    options: ExportOptions,
) -> std::result::Result<(), String> {
    let manager = state.connection_manager.clone();

    tokio::spawn(async move {
        let result = match options.format.as_str() {
            "csv" => do_export_csv(app_handle.clone(), &manager, &connection_id, &export_id, &options).await,
            "json" => do_export_json(app_handle.clone(), &manager, &connection_id, &export_id, &options).await,
            "sql" => do_export_sql(app_handle.clone(), &manager, &connection_id, &export_id, &options).await,
            _ => Err(anyhow!("Unsupported format")),
        };

        if let Err(e) = result {
            let _ = app_handle.emit("export-progress", ExportProgress {
                export_id: export_id.clone(),
                current_table: "".to_string(),
                rows_exported: 0,
                status: "error".to_string(),
                error: Some(e.to_string()),
            });
        }
    });

    Ok(())
}

async fn do_export_csv(
    app_handle: AppHandle,
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    export_id: &str,
    options: &ExportOptions,
) -> Result<()> {
    let db_type = {
        if manager.get_postgres_pools().await.contains_key(connection_id) { Some("postgres") }
        else if manager.get_mysql_pools().await.contains_key(connection_id) { Some("mysql") }
        else if manager.get_sqlite_pools().await.contains_key(connection_id) { Some("sqlite") }
        else { None }
    }.ok_or_else(|| anyhow!("Connection not found"))?;

    for table in &options.tables {
        let file_path = if options.tables.len() > 1 {
            format!("{}_{}.csv", options.output_path, table)
        } else {
            options.output_path.clone()
        };

        let file = File::create(&file_path)?;
        let mut wtr = csv::Writer::from_writer(file);

        let quoted_table = match db_type {
            "mysql" => format!("`{}`", table.replace("`", "``")),
            _ => format!("\"{}\"", table.replace("\"", "\"\"")),
        };

        let sql = format!("SELECT * FROM {}", quoted_table);

        match db_type {
            "postgres" => {
                let pool = manager.get_postgres_pools().await.get(connection_id).cloned().unwrap();
                let mut stream = sqlx::query(&sql).fetch(&pool);
                let mut rows_exported = 0u64;
                let mut columns_written = false;
                while let Some(row) = stream.try_next().await? {
                    if !columns_written {
                        let cols: Vec<String> = row.columns().iter().map(|c| c.name().to_string()).collect();
                        wtr.write_record(&cols)?;
                        columns_written = true;
                    }
                    let record: Vec<String> = (0..row.columns().len()).map(|i| {
                        row.try_get::<Option<String>, _>(i).ok().flatten().unwrap_or_default()
                    }).collect();
                    wtr.write_record(&record)?;
                    rows_exported += 1;
                    if rows_exported % 1000 == 0 {
                        let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                    }
                }
            },
            "mysql" => {
                let pool = manager.get_mysql_pools().await.get(connection_id).cloned().unwrap();
                let mut stream = sqlx::query(&sql).fetch(&pool);
                let mut rows_exported = 0u64;
                let mut columns_written = false;
                while let Some(row) = stream.try_next().await? {
                    if !columns_written {
                        let cols: Vec<String> = row.columns().iter().map(|c| c.name().to_string()).collect();
                        wtr.write_record(&cols)?;
                        columns_written = true;
                    }
                    let record: Vec<String> = (0..row.columns().len()).map(|i| {
                        row.try_get::<Option<String>, _>(i).ok().flatten().unwrap_or_default()
                    }).collect();
                    wtr.write_record(&record)?;
                    rows_exported += 1;
                    if rows_exported % 1000 == 0 {
                        let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                    }
                }
            },
            "sqlite" => {
                let pool = manager.get_sqlite_pools().await.get(connection_id).cloned().unwrap();
                let mut stream = sqlx::query(&sql).fetch(&pool);
                let mut rows_exported = 0u64;
                let mut columns_written = false;
                while let Some(row) = stream.try_next().await? {
                    if !columns_written {
                        let cols: Vec<String> = row.columns().iter().map(|c| c.name().to_string()).collect();
                        wtr.write_record(&cols)?;
                        columns_written = true;
                    }
                    let record: Vec<String> = (0..row.columns().len()).map(|i| {
                        row.try_get::<Option<String>, _>(i).ok().flatten().unwrap_or_default()
                    }).collect();
                    wtr.write_record(&record)?;
                    rows_exported += 1;
                    if rows_exported % 1000 == 0 {
                        let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                    }
                }
            },
            _ => return Err(anyhow!("Unsupported database type")),
        }
        wtr.flush()?;
    }

    let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: "".to_string(), rows_exported: 0, status: "complete".to_string(), error: None });
    Ok(())
}

async fn do_export_json(
    app_handle: AppHandle,
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    export_id: &str,
    options: &ExportOptions,
) -> Result<()> {
    let db_type = {
        if manager.get_postgres_pools().await.contains_key(connection_id) { Some("postgres") }
        else if manager.get_mysql_pools().await.contains_key(connection_id) { Some("mysql") }
        else if manager.get_sqlite_pools().await.contains_key(connection_id) { Some("sqlite") }
        else { None }
    }.ok_or_else(|| anyhow!("Connection not found"))?;

    for table in &options.tables {
        let file_path = if options.tables.len() > 1 {
            format!("{}_{}.json", options.output_path, table)
        } else {
            options.output_path.clone()
        };

        let file = File::create(&file_path)?;
        let mut writer = BufWriter::new(file);
        writer.write_all(b"[\n")?;

        let quoted_table = match db_type {
            "mysql" => format!("`{}`", table.replace("`", "``")),
            _ => format!("\"{}\"", table.replace("\"", "\"\"")),
        };

        let sql = format!("SELECT * FROM {}", quoted_table);
        let mut rows_exported = 0u64;
        let mut first_row = true;

        match db_type {
            "postgres" => {
                let pool = manager.get_postgres_pools().await.get(connection_id).cloned().unwrap();
                let mut stream = sqlx::query(&sql).fetch(&pool);
                while let Some(row) = stream.try_next().await? {
                    if !first_row { writer.write_all(b",\n")?; }
                    let mut obj = serde_json::Map::new();
                    for col in row.columns() {
                        let i = col.ordinal();
                        obj.insert(col.name().to_string(), postgres_row_to_json(&row, i));
                    }
                    serde_json::to_writer(&mut writer, &Value::Object(obj))?;
                    first_row = false;
                    rows_exported += 1;
                    if rows_exported % 1000 == 0 {
                        let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                    }
                }
            },
            "mysql" => {
                let pool = manager.get_mysql_pools().await.get(connection_id).cloned().unwrap();
                let mut stream = sqlx::query(&sql).fetch(&pool);
                while let Some(row) = stream.try_next().await? {
                    if !first_row { writer.write_all(b",\n")?; }
                    let mut obj = serde_json::Map::new();
                    for col in row.columns() {
                        let i = col.ordinal();
                        obj.insert(col.name().to_string(), mysql_row_to_json(&row, i));
                    }
                    serde_json::to_writer(&mut writer, &Value::Object(obj))?;
                    first_row = false;
                    rows_exported += 1;
                    if rows_exported % 1000 == 0 {
                        let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                    }
                }
            },
            "sqlite" => {
                let pool = manager.get_sqlite_pools().await.get(connection_id).cloned().unwrap();
                let mut stream = sqlx::query(&sql).fetch(&pool);
                while let Some(row) = stream.try_next().await? {
                    if !first_row { writer.write_all(b",\n")?; }
                    let mut obj = serde_json::Map::new();
                    for col in row.columns() {
                        let i = col.ordinal();
                        obj.insert(col.name().to_string(), sqlite_row_to_json(&row, i));
                    }
                    serde_json::to_writer(&mut writer, &Value::Object(obj))?;
                    first_row = false;
                    rows_exported += 1;
                    if rows_exported % 1000 == 0 {
                        let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                    }
                }
            },
            _ => return Err(anyhow!("Unsupported database type")),
        }

        writer.write_all(b"\n]")?;
        writer.flush()?;
    }

    let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: "".to_string(), rows_exported: 0, status: "complete".to_string(), error: None });
    Ok(())
}

async fn do_export_sql(
    app_handle: AppHandle,
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    export_id: &str,
    options: &ExportOptions,
) -> Result<()> {
    let db_type = {
        if manager.get_postgres_pools().await.contains_key(connection_id) { Some("postgres") }
        else if manager.get_mysql_pools().await.contains_key(connection_id) { Some("mysql") }
        else if manager.get_sqlite_pools().await.contains_key(connection_id) { Some("sqlite") }
        else { None }
    }.ok_or_else(|| anyhow!("Connection not found"))?;

    let file = File::create(&options.output_path)?;
    let mut writer = BufWriter::new(file);

    for table in &options.tables {
        if options.include_schema {
            let schema = get_create_table_sql(manager, connection_id, table, db_type).await?;
            writer.write_all(schema.as_bytes())?;
            writer.write_all(b";\n\n")?;
        }

        if options.include_data {
            let quoted_table = match db_type {
                "mysql" => format!("`{}`", table.replace("`", "``")),
                _ => format!("\"{}\"", table.replace("\"", "\"\"")),
            };
            let sql = format!("SELECT * FROM {}", quoted_table);
            let mut rows_exported = 0u64;

            match db_type {
                "postgres" => {
                    let pool = manager.get_postgres_pools().await.get(connection_id).cloned().unwrap();
                    let mut stream = sqlx::query(&sql).fetch(&pool);
                    while let Some(row) = stream.try_next().await? {
                        writer.write_all(postgres_row_to_sql(&row, table).as_bytes())?;
                        rows_exported += 1;
                        if rows_exported % 1000 == 0 {
                            let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                        }
                    }
                },
                "mysql" => {
                    let pool = manager.get_mysql_pools().await.get(connection_id).cloned().unwrap();
                    let mut stream = sqlx::query(&sql).fetch(&pool);
                    while let Some(row) = stream.try_next().await? {
                        writer.write_all(mysql_row_to_sql(&row, table).as_bytes())?;
                        rows_exported += 1;
                        if rows_exported % 1000 == 0 {
                            let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                        }
                    }
                },
                "sqlite" => {
                    let pool = manager.get_sqlite_pools().await.get(connection_id).cloned().unwrap();
                    let mut stream = sqlx::query(&sql).fetch(&pool);
                    while let Some(row) = stream.try_next().await? {
                        writer.write_all(sqlite_row_to_sql(&row, table).as_bytes())?;
                        rows_exported += 1;
                        if rows_exported % 1000 == 0 {
                            let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: table.to_string(), rows_exported, status: "processing".to_string(), error: None });
                        }
                    }
                },
                _ => {}
            }
            writer.write_all(b"\n")?;
        }
    }

    writer.flush()?;
    let _ = app_handle.emit("export-progress", ExportProgress { export_id: export_id.to_string(), current_table: "".to_string(), rows_exported: 0, status: "complete".to_string(), error: None });
    Ok(())
}

fn postgres_row_to_json(row: &sqlx::postgres::PgRow, i: usize) -> Value {
    if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) { Value::String(s) }
    else if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(i) { Value::Number(n.into()) }
    else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(i) { serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null) }
    else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(i) { Value::Bool(b) }
    else { Value::Null }
}

fn mysql_row_to_json(row: &sqlx::mysql::MySqlRow, i: usize) -> Value {
    if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) { Value::String(s) }
    else if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(i) { Value::Number(n.into()) }
    else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(i) { serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null) }
    else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(i) { Value::Bool(b) }
    else { Value::Null }
}

fn sqlite_row_to_json(row: &sqlx::sqlite::SqliteRow, i: usize) -> Value {
    if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) { Value::String(s) }
    else if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(i) { Value::Number(n.into()) }
    else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(i) { serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null) }
    else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(i) { Value::Bool(b) }
    else { Value::Null }
}

fn postgres_row_to_sql(row: &sqlx::postgres::PgRow, table: &str) -> String {
    let quoted_table = format!("\"{}\"", table.replace("\"", "\"\""));
    let col_names: Vec<String> = row.columns().iter().map(|c| format!("\"{}\"", c.name().replace("\"", "\"\""))).collect();
    let values: Vec<String> = (0..row.columns().len()).map(|i| {
        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) { format!("'{}'", s.replace("'", "''")) }
        else if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(i) { n.to_string() }
        else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(i) { f.to_string() }
        else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(i) { if b { "true" } else { "false" }.to_string() }
        else { "NULL".to_string() }
    }).collect();
    format!("INSERT INTO {} ({}) VALUES ({});\n", quoted_table, col_names.join(", "), values.join(", "))
}

fn mysql_row_to_sql(row: &sqlx::mysql::MySqlRow, table: &str) -> String {
    let quoted_table = format!("`{}`", table.replace("`", "``"));
    let col_names: Vec<String> = row.columns().iter().map(|c| format!("`{}`", c.name().replace("`", "``"))).collect();
    let values: Vec<String> = (0..row.columns().len()).map(|i| {
        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) { format!("'{}'", s.replace("'", "''")) }
        else if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(i) { n.to_string() }
        else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(i) { f.to_string() }
        else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(i) { if b { "true" } else { "false" }.to_string() }
        else { "NULL".to_string() }
    }).collect();
    format!("INSERT INTO {} ({}) VALUES ({});\n", quoted_table, col_names.join(", "), values.join(", "))
}

fn sqlite_row_to_sql(row: &sqlx::sqlite::SqliteRow, table: &str) -> String {
    let quoted_table = format!("\"{}\"", table.replace("\"", "\"\""));
    let col_names: Vec<String> = row.columns().iter().map(|c| format!("\"{}\"", c.name().replace("\"", "\"\""))).collect();
    let values: Vec<String> = (0..row.columns().len()).map(|i| {
        if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) { format!("'{}'", s.replace("'", "''")) }
        else if let Ok(Some(n)) = row.try_get::<Option<i64>, _>(i) { n.to_string() }
        else if let Ok(Some(f)) = row.try_get::<Option<f64>, _>(i) { f.to_string() }
        else if let Ok(Some(b)) = row.try_get::<Option<bool>, _>(i) { if b { "true" } else { "false" }.to_string() }
        else { "NULL".to_string() }
    }).collect();
    format!("INSERT INTO {} ({}) VALUES ({});\n", quoted_table, col_names.join(", "), values.join(", "))
}

async fn get_create_table_sql(
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    table_name: &str,
    db_type: &str,
) -> Result<String> {
    match db_type {
        "mysql" => {
            let pools = manager.get_mysql_pools().await;
            let pool = pools.get(connection_id).cloned().unwrap();
            let row = sqlx::query(&format!("SHOW CREATE TABLE `{}`", table_name.replace("`", "``"))).fetch_one(&pool).await?;
            Ok(row.get(1))
        },
        "sqlite" => {
            let pools = manager.get_sqlite_pools().await;
            let pool = pools.get(connection_id).cloned().unwrap();
            let row = sqlx::query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table_name).fetch_one(&pool).await?;
            Ok(row.get(0))
        },
        "postgres" => {
            Ok(format!("-- CREATE TABLE for {} (Postgres DDL extraction not fully implemented)", table_name))
        },
        _ => Err(anyhow!("Unsupported database type")),
    }
}
