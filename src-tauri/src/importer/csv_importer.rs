use std::collections::HashMap;
use std::fs::File;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use crate::core::AppState;
use csv::ReaderBuilder;
use anyhow::{Result, anyhow};


use crate::importer::{ImportProgress, InsertTarget};

#[derive(Deserialize, Debug)]
pub struct CsvImportOptions {
    pub file_path: String,
    pub table_name: String,
    pub create_table_if_missing: bool,
    pub column_mapping: HashMap<String, String>, // csv_column -> db_column
    pub has_header: bool,
    pub delimiter: char,
    pub skip_rows: u32,
    pub batch_size: usize,
}

#[tauri::command]
pub async fn preview_csv(
    file_path: String,
    delimiter: char,
    has_header: bool,
    skip_rows: u32,
) -> Result<Vec<Vec<String>>, String> {
    let file = File::open(&file_path).map_err(|e| e.to_string())?;
    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter as u8)
        .has_headers(has_header)
        .from_reader(file);

    let mut preview = Vec::new();
    
    // Skip rows
    let mut records = reader.records();
    for _ in 0..skip_rows {
        if records.next().is_none() { break; }
    }

    for result in records.take(10) {
        let record = result.map_err(|e| e.to_string())?;
        let row: Vec<String> = record.iter().map(|s| s.to_string()).collect();
        preview.push(row);
    }

    Ok(preview)
}

#[tauri::command]
pub async fn import_csv(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    import_id: String,
    options: CsvImportOptions,
) -> Result<(), String> {
    let manager = state.connection_manager.clone();
    
    tokio::spawn(async move {
        let result = do_import_csv(app_handle.clone(), &manager, &connection_id, &import_id, &options).await;
        
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

async fn do_import_csv(
    app_handle: AppHandle,
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    import_id: &str,
    options: &CsvImportOptions,
) -> Result<()> {
    // 1. Open CSV file
    let file = File::open(&options.file_path)?;
    let mut reader = ReaderBuilder::new()
        .delimiter(options.delimiter as u8)
        .has_headers(options.has_header)
        .from_reader(file);

    // 2. Detect DB type for proper quoting
    let db_type = {
        if manager.get_postgres_pools().await.contains_key(connection_id) { Some("postgres") }
        else if manager.get_mysql_pools().await.contains_key(connection_id) { Some("mysql") }
        else if manager.get_sqlite_pools().await.contains_key(connection_id) { Some("sqlite") }
        else { None }
    }.ok_or_else(|| anyhow!("Connection not found"))?;

    // 3. Create table if missing
    if options.create_table_if_missing {
        create_table_if_not_exists(manager, connection_id, &options.table_name, &mut reader, options.has_header, &options.column_mapping).await?;
    }

    // 4. Prepare batch insert logic
    let mut batch = Vec::new();
    let mut rows_processed = 0u64;

    // Get connection pool
    let pool_guard = match db_type {
        "postgres" => {
            let pools = manager.get_postgres_pools().await;
            let pool = pools.get(connection_id).ok_or_else(|| anyhow!("Pool not found"))?;
            InsertTarget::Postgres(pool.clone())
        },
        "mysql" => {
            let pools = manager.get_mysql_pools().await;
            let pool = pools.get(connection_id).ok_or_else(|| anyhow!("Pool not found"))?;
            InsertTarget::MySql(pool.clone())
        },
        "sqlite" => {
            let pools = manager.get_sqlite_pools().await;
            let pool = pools.get(connection_id).ok_or_else(|| anyhow!("Pool not found"))?;
            InsertTarget::Sqlite(pool.clone())
        },
        _ => return Err(anyhow!("Unsupported database type")),
    };

    let headers = if options.has_header {
        reader.headers()?.clone()
    } else {
        csv::StringRecord::new()
    };

    for result in reader.records() {
        let record = result?;
        batch.push(record);

        if batch.len() >= options.batch_size {
            insert_batch(&pool_guard, &options.table_name, &batch, &options.column_mapping, &headers, db_type).await?;
            rows_processed += batch.len() as u64;
            
            app_handle.emit("import-progress", ImportProgress {
                import_id: import_id.to_string(),
                rows_processed,
                total_rows: None,
                percentage: None,
                status: "processing".to_string(),
                error: None,
            })?;
            
            batch.clear();
        }
    }

    if !batch.is_empty() {
        insert_batch(&pool_guard, &options.table_name, &batch, &options.column_mapping, &headers, db_type).await?;
        rows_processed += batch.len() as u64;
    }

    app_handle.emit("import-progress", ImportProgress {
        import_id: import_id.to_string(),
        rows_processed,
        total_rows: Some(rows_processed),
        percentage: Some(100.0),
        status: "complete".to_string(),
        error: None,
    })?;

    Ok(())
}

// InsertTarget moved to importer/mod.rs

async fn insert_batch(
    target: &InsertTarget,
    table_name: &str,
    batch: &[csv::StringRecord],
    mapping: &HashMap<String, String>,
    headers: &csv::StringRecord,
    db_type: &str,
) -> Result<()> {
    if batch.is_empty() { return Ok(()); }

    // Identify columns to insert
    let mut columns = Vec::new();
    let mut csv_indices = Vec::new();

    if mapping.is_empty() && !headers.is_empty() {
        // Auto-mapping if no specific mapping provided? 
        // Or should we require mapping?
        // Let's assume headers match DB columns if no mapping.
        for (i, h) in headers.iter().enumerate() {
            columns.push(h.to_string());
            csv_indices.push(i);
        }
    } else {
        for (csv_col, db_col) in mapping {
            if let Some(pos) = headers.iter().position(|h| h == csv_col) {
                columns.push(db_col.clone());
                csv_indices.push(pos);
            } else if let Ok(idx) = csv_col.parse::<usize>() {
                // If mapping is from index (0, 1, 2...)
                columns.push(db_col.clone());
                csv_indices.push(idx);
            }
        }
    }

    if columns.is_empty() {
        return Err(anyhow!("No valid columns found for mapping"));
    }

    let quoted_table = match db_type {
        "mysql" => format!("`{}`", table_name.replace("`", "``")),
        _ => format!("\"{}\"", table_name.replace("\"", "\"\"")),
    };

    let quoted_columns: Vec<String> = columns.iter().map(|c| match db_type {
        "mysql" => format!("`{}`", c.replace("`", "``")),
        _ => format!("\"{}\"", c.replace("\"", "\"\"")),
    }).collect();

    let placeholders: Vec<String> = (0..columns.len()).map(|i| match db_type {
        "postgres" => format!("${}", i + 1),
        _ => "?".to_string(),
    }).collect();

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quoted_table,
        quoted_columns.join(", "),
        placeholders.join(", ")
    );

    match target {
        InsertTarget::Postgres(pool) => {
            let mut tx = pool.begin().await?;
            for record in batch {
                let mut query = sqlx::query(&sql);
                for &idx in &csv_indices {
                    let val = record.get(idx).unwrap_or("");
                    query = query.bind(val);
                }
                query.execute(&mut *tx).await?;
            }
            tx.commit().await?;
        },
        InsertTarget::MySql(pool) => {
            let mut tx = pool.begin().await?;
            for record in batch {
                let mut query = sqlx::query(&sql);
                for &idx in &csv_indices {
                    let val = record.get(idx).unwrap_or("");
                    query = query.bind(val);
                }
                query.execute(&mut *tx).await?;
            }
            tx.commit().await?;
        },
        InsertTarget::Sqlite(pool) => {
            let mut tx = pool.begin().await?;
            for record in batch {
                let mut query = sqlx::query(&sql);
                for &idx in &csv_indices {
                    let val = record.get(idx).unwrap_or("");
                    query = query.bind(val);
                }
                query.execute(&mut *tx).await?;
            }
            tx.commit().await?;
        }
    }

    Ok(())
}

async fn create_table_if_not_exists(
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    table_name: &str,
    reader: &mut csv::Reader<File>,
    has_header: bool,
    mapping: &HashMap<String, String>,
) -> Result<()> {
    // 1. Determine columns
    let mut columns = Vec::new();
    if !mapping.is_empty() {
        for db_col in mapping.values() {
            columns.push(db_col.clone());
        }
    } else if has_header {
        let headers = reader.headers()?;
        for h in headers.iter() {
            columns.push(h.to_string());
        }
    } else {
        // We can't easily peek the reader here without consuming it if it's not clonable
        // But we can assume some default or skip if no header and no mapping
        return Err(anyhow!("Cannot create table without headers or column mapping"));
    }

    if columns.is_empty() {
        return Err(anyhow!("Could not determine columns for table creation"));
    }

    // 2. Identify DB type
    let db_type = {
        if manager.get_postgres_pools().await.contains_key(connection_id) { Some("postgres") }
        else if manager.get_mysql_pools().await.contains_key(connection_id) { Some("mysql") }
        else if manager.get_sqlite_pools().await.contains_key(connection_id) { Some("sqlite") }
        else { None }
    }.ok_or_else(|| anyhow!("Connection not found"))?;

    // 3. Build CREATE TABLE statement
    let quoted_table = match db_type {
        "mysql" => format!("`{}`", table_name.replace("`", "``")),
        _ => format!("\"{}\"", table_name.replace("\"", "\"\"")),
    };

    let col_defs: Vec<String> = columns.iter().map(|c| {
        let quoted_col = match db_type {
            "mysql" => format!("`{}`", c.replace("`", "``")),
            _ => format!("\"{}\"", c.replace("\"", "\"\"")),
        };
        format!("{} TEXT", quoted_col)
    }).collect();

    let sql = format!("CREATE TABLE IF NOT EXISTS {} ({})", quoted_table, col_defs.join(", "));

    // 4. Execute
    match db_type {
        "postgres" => {
            let pools = manager.get_postgres_pools().await;
            let pool = pools.get(connection_id).ok_or_else(|| anyhow!("Pool not found"))?;
            sqlx::query(&sql).execute(pool).await?;
        },
        "mysql" => {
            let pools = manager.get_mysql_pools().await;
            let pool = pools.get(connection_id).ok_or_else(|| anyhow!("Pool not found"))?;
            sqlx::query(&sql).execute(pool).await?;
        },
        "sqlite" => {
            let pools = manager.get_sqlite_pools().await;
            let pool = pools.get(connection_id).ok_or_else(|| anyhow!("Pool not found"))?;
            sqlx::query(&sql).execute(pool).await?;
        },
        _ => return Err(anyhow!("Unsupported database type")),
    }

    Ok(())
}
