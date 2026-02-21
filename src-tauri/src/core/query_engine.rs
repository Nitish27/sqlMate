use anyhow::{Result, anyhow};
use crate::core::{QueryResult, TableMetadata, TableStructure, TableColumnStructure, TableIndexStructure, TableConstraintStructure, connection_manager::ConnectionManager, FilterConfig, StreamingMetadata, StreamingBatch, StreamingComplete};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use std::time::Instant;
use uuid::Uuid;
use serde_json::Value;
use std::fs::File;
use std::io::Write;
use tokio_util::sync::CancellationToken;
use tauri::Emitter;
use tokio::time::{sleep, Duration};

fn type_name_is_text(name: &str) -> bool {
    name == "text" || name.contains("char") || name == "name" || name == "citext" || name == "json" || name == "jsonb" || name == "enum"
}

fn wrap_pagination(sql: &str, limit: u32, offset: u32) -> String {
    let trimmed = sql.trim();
    if trimmed.to_uppercase().starts_with("SELECT") {
        format!("SELECT * FROM ({}) AS __sqlmate_q LIMIT {} OFFSET {}", trimmed.trim_end_matches(';'), limit, offset)
    } else {
        trimmed.to_string()
    }
}

fn wrap_count(sql: &str) -> String {
    let trimmed = sql.trim();
    if trimmed.to_uppercase().starts_with("SELECT") {
        format!("SELECT COUNT(*) FROM ({}) AS __sqlmate_count_q", trimmed.trim_end_matches(';'))
    } else {
        "".to_string()
    }
}

macro_rules! postgres_row_to_values {
    ($row:expr) => {{
        let mut result_row = Vec::new();
        for i in 0..$row.columns().len() {
            let val: Value = if $row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
                Value::Null
            } else {
                let type_name = $row.column(i).type_info().name().to_lowercase();
                if type_name == "bool" || type_name == "boolean" || type_name == "bit" {
                    if let Ok(b) = $row.try_get::<bool, _>(i) { Value::Bool(b) }
                    else { Value::Null }
                } else if type_name == "uuid" {
                    if let Ok(u) = $row.try_get::<uuid::Uuid, _>(i) { Value::String(u.to_string()) } else { Value::String("Invalid UUID".to_string()) }
                } else if type_name.contains("int") || type_name == "serial" || type_name == "year" {
                    if let Ok(n) = $row.try_get::<i64, _>(i) { 
                        Value::Number(serde_json::Number::from(n)) 
                    } else if let Ok(n) = $row.try_get::<i32, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i16, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i8, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else {
                        Value::String(format!("NumError({})", type_name))
                    }
                } else if type_name.contains("float") || type_name == "real" || type_name == "double" || type_name == "numeric" || type_name == "decimal" {
                    if let Ok(f) = $row.try_get::<f64, _>(i) {
                        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                    } else if let Ok(f) = $row.try_get::<f32, _>(i) {
                        serde_json::Number::from_f64(f as f64).map(Value::Number).unwrap_or(Value::Null)
                    } else if let Ok(d) = $row.try_get::<rust_decimal::Decimal, _>(i) {
                        Value::String(d.to_string())
                    } else { 
                        Value::Null 
                    }
                } else if type_name_is_text(&type_name) {
                    if let Ok(s) = $row.try_get::<String, _>(i) { Value::String(s) } else { Value::String("".to_string()) }
                } else if type_name.contains("time") || type_name == "date" {
                    if let Ok(dt) = $row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                        Value::String(dt.to_rfc3339())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDateTime, _>(i) {
                        Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDate, _>(i) {
                        Value::String(dt.to_string())
                    } else if let Ok(t) = $row.try_get::<chrono::NaiveTime, _>(i) {
                        Value::String(t.to_string())
                    } else {
                        if let Ok(s) = $row.try_get::<String, _>(i) { Value::String(s) } else { Value::String("Invalid Date".to_string()) }
                    }
                } else if type_name.contains("bytea") {
                    if let Ok(bytes) = $row.try_get::<Vec<u8>, _>(i) {
                        let hex_string: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                        Value::String(format!("0x{}", hex_string))
                    } else {
                        Value::String(format!("BinaryErr({})", type_name))
                    }
                } else {
                    if let Ok(s) = $row.try_get::<String, _>(i) {
                        Value::String(s)
                    } else {
                        Value::String(format!("Binary/Complex ({})", type_name))
                    }
                }
            };
            result_row.push(val);
        }
        result_row
    }};
}

macro_rules! mysql_row_to_values {
    ($row:expr) => {{
        let mut result_row = Vec::new();
        for i in 0..$row.columns().len() {
            let val: Value = if $row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
                Value::Null
            } else {
                let type_name = $row.column(i).type_info().name().to_lowercase();
                if type_name == "tinyint" && $row.column(i).type_info().to_string().contains("TINYINT(1)") {
                    if let Ok(b) = $row.try_get::<bool, _>(i) { Value::Bool(b) }
                    else if let Ok(v) = $row.try_get::<i8, _>(i) { Value::Bool(v != 0) }
                    else { Value::Null }
                } else if type_name.contains("int") || type_name == "serial" || type_name == "year" {
                    if let Ok(n) = $row.try_get::<i64, _>(i) { 
                        Value::Number(serde_json::Number::from(n)) 
                    } else if let Ok(n) = $row.try_get::<i32, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i16, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i8, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<u64, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<u32, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else {
                        Value::String(format!("NumError({})", type_name))
                    }
                } else if type_name.contains("float") || type_name == "real" || type_name == "double" || type_name == "numeric" || type_name == "decimal" {
                    if let Ok(f) = $row.try_get::<f64, _>(i) {
                        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                    } else if let Ok(f) = $row.try_get::<f32, _>(i) {
                        serde_json::Number::from_f64(f as f64).map(Value::Number).unwrap_or(Value::Null)
                    } else if let Ok(d) = $row.try_get::<rust_decimal::Decimal, _>(i) {
                        Value::String(d.to_string())
                    } else { 
                        Value::Null 
                    }
                } else if type_name_is_text(&type_name) {
                    if let Ok(s) = $row.try_get::<String, _>(i) { Value::String(s) } else { Value::String("".to_string()) }
                } else if type_name.contains("time") || type_name == "date" || type_name == "timestamp" {
                    if let Ok(dt) = $row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                        Value::String(dt.to_rfc3339())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDateTime, _>(i) {
                        Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDate, _>(i) {
                        Value::String(dt.to_string())
                    } else if let Ok(t) = $row.try_get::<chrono::NaiveTime, _>(i) {
                        Value::String(t.to_string())
                    } else {
                        if let Ok(s) = $row.try_get::<String, _>(i) { Value::String(s) } else { Value::String("Invalid Date".to_string()) }
                    }
                } else if type_name.contains("blob") || type_name.contains("binary") {
                    if let Ok(bytes) = $row.try_get::<Vec<u8>, _>(i) {
                        let hex_string: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                        if bytes.len() == 16 {
                            if let Ok(u) = uuid::Uuid::from_slice(&bytes) {
                                Value::String(u.to_string())
                            } else {
                                Value::String(format!("0x{}", hex_string))
                            }
                        } else {
                            Value::String(format!("0x{}", hex_string))
                        }
                    } else {
                        Value::String(format!("BinaryErr({})", type_name))
                    }
                } else {
                    if let Ok(s) = $row.try_get::<String, _>(i) {
                        Value::String(s)
                    } else {
                        Value::String(format!("Binary/Complex ({})", type_name))
                    }
                }
            };
            result_row.push(val);
        }
        result_row
    }};
}

macro_rules! sqlite_row_to_values {
    ($row:expr) => {{
        let mut result_row = Vec::new();
        for i in 0..$row.columns().len() {
            let val: Value = if $row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
                Value::Null
            } else {
                let type_name = $row.column(i).type_info().name().to_lowercase();
                if type_name == "bool" || type_name == "boolean" {
                    if let Ok(b) = $row.try_get::<bool, _>(i) { Value::Bool(b) }
                    else { Value::Null }
                } else if type_name.contains("int") || type_name == "integer" {
                    if let Ok(n) = $row.try_get::<i64, _>(i) { 
                        Value::Number(serde_json::Number::from(n)) 
                    } else if let Ok(n) = $row.try_get::<i32, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i16, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i8, _>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else {
                        Value::String(format!("NumError({})", type_name))
                    }
                } else if type_name.contains("float") || type_name == "real" || type_name == "double" {
                    if let Ok(f) = $row.try_get::<f64, _>(i) {
                        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
                    } else { Value::Null }
                } else if type_name_is_text(&type_name) {
                    if let Ok(s) = $row.try_get::<String, _>(i) { Value::String(s) } else { Value::String("".to_string()) }
                } else if type_name.contains("blob") {
                    if let Ok(bytes) = $row.try_get::<Vec<u8>, _>(i) {
                        let hex_string: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                        Value::String(format!("0x{}", hex_string))
                    } else {
                        Value::String("Blob Error".to_string())
                    }
                } else {
                    if let Ok(s) = $row.try_get::<String, _>(i) {
                        Value::String(s)
                    } else {
                        Value::String(format!("Binary/Complex ({})", type_name))
                    }
                }
            };
            result_row.push(val);
        }
        result_row
    }};
}

fn build_where_clause(filters: Vec<FilterConfig>, db_type: &str) -> String {
    if filters.is_empty() {
        return String::new();
    }
    
    let conditions: Vec<String> = filters.iter().filter(|f| f.enabled).map(|f| {
        let col = match db_type {
            "mysql" => format!("`{}`", f.column.replace("`", "``")),
            _ => format!("\"{}\"", f.column.replace("\"", "\"\"")),
        };
        
        let val = &f.value;
        // Basic SQL escaping for value - THIS IS NOT SECURE against clever attacks but standard precaution for now. 
        // Ideally we should use bind parameters, but dynamic binding with sqlx is complex.
        // For this task, simple escaping of single quotes should suffice for string literals.
        let escaped_val = val.replace("'", "''");
        
        match f.operator.as_str() {
            "=" => format!("{} = '{}'", col, escaped_val),
            "!=" => format!("{} != '{}'", col, escaped_val),
            ">" => format!("{} > '{}'", col, escaped_val),
            "<" => format!("{} < '{}'", col, escaped_val),
            ">=" => format!("{} >= '{}'", col, escaped_val),
            "<=" => format!("{} <= '{}'", col, escaped_val),
            "Contains" | "LIKE" => format!("{} LIKE '%{}%'", col, escaped_val),
            "Starts With" | "ILIKE" => {
                if db_type == "postgres" && f.operator == "ILIKE" {
                     format!("{} ILIKE '{}%'", col, escaped_val)
                } else {
                     format!("{} LIKE '{}%'", col, escaped_val)
                }
            },
            "Ends With" => format!("{} LIKE '%{}'", col, escaped_val),
            "IN" => format!("{} IN ({})", col, val), // User types "1, 2, 3"
            "IS NULL" => format!("{} IS NULL", col),
            "IS NOT NULL" => format!("{} IS NOT NULL", col),
            _ => format!("{} = '{}'", col, escaped_val),
        }
    }).collect();
    
    if conditions.is_empty() {
        return String::new();
    }
    
    format!("WHERE {}", conditions.join(" AND "))
}

fn build_order_clause(sort_column: Option<String>, sort_direction: Option<String>, db_type: &str) -> String {
    match (sort_column, sort_direction) {
        (Some(col), dir) => {
            let quoted_col = match db_type {
                "mysql" => format!("`{}`", col.replace("`", "``")),
                _ => format!("\"{}\"", col.replace("\"", "\"\"")),
            };
            let direction = match dir.as_deref() {
                Some("DESC") => "DESC",
                _ => "ASC",
            };
            format!("ORDER BY {} {}", quoted_col, direction)
        },
        _ => String::new(),
    }
}

pub struct QueryEngine;

impl QueryEngine {
    pub async fn execute_query_streaming(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        sql: &str,
        query_id: Uuid,
        window: &tauri::Window,
        token: CancellationToken,
    ) -> Result<()> {
        let start = Instant::now();
        use futures::StreamExt;
        
                macro_rules! stream_db {
                    ($pool:expr, $db_macro:ident) => {{
                        let mut stream = sqlx::query(sql).fetch($pool);
                        let mut columns_sent = false;
                        let mut batch = Vec::new();
                        let mut total_rows = 0u64;
                        let batch_size = 1000;

                        while let Some(row_result) = stream.next().await {
                            if token.is_cancelled() {
                                return Ok(());
                            }

                            let row = row_result?;
                            
                            if !columns_sent {
                                let columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                                window.emit("query-metadata", StreamingMetadata { query_id, columns })?;
                                columns_sent = true;
                            }

                            batch.push($db_macro!(&row));
                            total_rows += 1;

                            if batch.len() >= batch_size {
                                window.emit("query-batch", StreamingBatch { query_id, rows: batch.clone() })?;
                                batch.clear();
                                // Yield to allow the frontend and the event loop to breathe
                                sleep(Duration::from_millis(5)).await;
                            }
                        }

                        if !batch.is_empty() {
                            window.emit("query-batch", StreamingBatch { query_id, rows: batch })?;
                        }

                        window.emit("query-complete", StreamingComplete {
                            query_id,
                            execution_time_ms: start.elapsed().as_millis() as u64,
                            total_rows,
                        })?;

                        return Ok(());
                    }};
                }

                // Check Postgres
                {
                    let pools = manager.get_postgres_pools().await;
                    if let Some(pool) = pools.get(connection_id) {
                        stream_db!(pool, postgres_row_to_values);
                    }
                }

                // Check MySQL
                {
                    let pools = manager.get_mysql_pools().await;
                    if let Some(pool) = pools.get(connection_id) {
                        stream_db!(pool, mysql_row_to_values);
                    }
                }

                // Check SQLite
                {
                    let pools = manager.get_sqlite_pools().await;
                    if let Some(pool) = pools.get(connection_id) {
                        stream_db!(pool, sqlite_row_to_values);
                    }
                }

        Err(anyhow!("Connection not found"))
    }

    pub async fn execute_query(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        sql: &str,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<QueryResult> {
        let start = Instant::now();
        let mut total_count = None;
        let mut final_sql = sql.to_string();

        if let (Some(p), Some(ps)) = (page, page_size) {
            if ps > 0 {
                final_sql = wrap_pagination(sql, ps, p * ps);
            }
        }

        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                // Get count if requested
                if page.is_some() {
                    let c_sql = wrap_count(sql);
                    if !c_sql.is_empty() {
                        if let Ok(count_row) = sqlx::query(&c_sql).fetch_one(pool).await {
                            total_count = Some(count_row.get::<i64, _>(0) as u64);
                        }
                    }
                }

                let rows = sqlx::query(&final_sql).fetch_all(pool).await?;
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                if let Some(first) = rows.first() {
                    columns = first.columns().iter().map(|c| c.name().to_string()).collect();
                }
                for row in rows {
                    result_rows.push(postgres_row_to_values!(&row));
                }

                return Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count,
                    page,
                    page_size,
                });
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                if page.is_some() {
                    let c_sql = wrap_count(sql);
                    if !c_sql.is_empty() {
                        if let Ok(count_row) = sqlx::query(&c_sql).fetch_one(pool).await {
                            total_count = Some(count_row.get::<i64, _>(0) as u64);
                        }
                    }
                }

                let rows = sqlx::query(&final_sql).fetch_all(pool).await?;
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                if let Some(first) = rows.first() {
                    columns = first.columns().iter().map(|c| c.name().to_string()).collect();
                }
                for row in rows {
                    result_rows.push(mysql_row_to_values!(&row));
                }

                return Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count,
                    page,
                    page_size,
                });
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                if page.is_some() {
                    let c_sql = wrap_count(sql);
                    if !c_sql.is_empty() {
                        if let Ok(count_row) = sqlx::query(&c_sql).fetch_one(pool).await {
                            total_count = Some(count_row.get::<i64, _>(0) as u64);
                        }
                    }
                }

                let rows = sqlx::query(&final_sql).fetch_all(pool).await?;
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                if let Some(first) = rows.first() {
                    columns = first.columns().iter().map(|c| c.name().to_string()).collect();
                }
                for row in rows {
                    result_rows.push(sqlite_row_to_values!(&row));
                }

                return Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count,
                    page,
                    page_size,
                });
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn create_database(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        db_name: &str,
    ) -> Result<()> {
        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = format!("CREATE DATABASE \"{}\"", db_name);
                sqlx::query(&sql).execute(pool).await?;
                return Ok(());
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = format!("CREATE DATABASE `{}`", db_name);
                sqlx::query(&sql).execute(pool).await?;
                return Ok(());
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(_) = pools.get(connection_id) {
                return Err(anyhow!("Creation of new databases in SQLite is not supported via this command. Please create a new connection for a different SQLite file."));
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn get_databases(
        manager: &ConnectionManager,
        connection_id: &Uuid,
    ) -> Result<Vec<String>> {
        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                // List databases that are not templates and are accessible
                let sql = "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname;";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                return Ok(rows.into_iter()
                    .filter_map(|row| row.try_get::<String, _>(0).ok())
                    .collect());
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = "SHOW DATABASES;";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                 return Ok(rows.into_iter()
                    .filter_map(|row| row.try_get::<String, _>(0).ok())
                    .collect());
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                // SQLite usually has one main database, but we can list attached ones
                let sql = "PRAGMA database_list;";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                 return Ok(rows.into_iter()
                    .filter_map(|row| row.try_get::<String, _>(1).ok())
                    .collect());
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn get_tables(
        manager: &ConnectionManager,
        connection_id: &Uuid,
    ) -> Result<Vec<String>> {

        
        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = "SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public';";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                let tables: Vec<String> = rows.into_iter()
                    .filter_map(|row| row.try_get::<String, _>(0).ok())
                    .collect();

                return Ok(tables);
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = "SHOW TABLES;";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                 return Ok(rows.into_iter()
                    .filter_map(|row| row.try_get::<String, _>(0).ok())
                    .collect());
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = "SELECT name FROM sqlite_schema WHERE type ='table' AND name NOT LIKE 'sqlite_%';";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                 return Ok(rows.into_iter()
                    .filter_map(|row| row.try_get::<String, _>(0).ok())
                    .collect());
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn get_table_data(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
        limit: u32,
        offset: u32,
        filters: Vec<FilterConfig>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<QueryResult> {
        let db_type = {
            if manager.get_postgres_pools().await.contains_key(connection_id) {
                Some("postgres")
            } else if manager.get_mysql_pools().await.contains_key(connection_id) {
                Some("mysql")
            } else if manager.get_sqlite_pools().await.contains_key(connection_id) {
                Some("sqlite")
            } else {
                None
            }
        };

        match db_type {
            Some("postgres") => {
                 let where_clause = build_where_clause(filters, "postgres");
                 let order_clause = build_order_clause(sort_column, sort_direction, "postgres");
                 let sql = format!("SELECT * FROM \"{}\" {} {} LIMIT {} OFFSET {};", table_name.replace("\"", "\"\""), where_clause, order_clause, limit, offset);
                 Self::execute_query(manager, connection_id, &sql, None, None).await
            },
            Some("mysql") => {
                 let where_clause = build_where_clause(filters, "mysql");
                 let order_clause = build_order_clause(sort_column, sort_direction, "mysql");
                 let sql = format!("SELECT * FROM `{}` {} {} LIMIT {} OFFSET {};", table_name.replace("`", "``"), where_clause, order_clause, limit, offset);
                 Self::execute_query(manager, connection_id, &sql, None, None).await
            },
            Some("sqlite") => {
                 let where_clause = build_where_clause(filters, "sqlite");
                 let order_clause = build_order_clause(sort_column, sort_direction, "sqlite");
                 let sql = format!("SELECT * FROM \"{}\" {} {} LIMIT {} OFFSET {};", table_name.replace("\"", "\"\""), where_clause, order_clause, limit, offset);
                 Self::execute_query(manager, connection_id, &sql, None, None).await
            },
            Some(_) => Err(anyhow!("Unknown database type")),
            None => Err(anyhow!("Connection not found"))
        }
    }

    pub async fn get_table_count(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
        filters: Vec<FilterConfig>,
    ) -> Result<u64> {
        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                // Use exact count for accuracy, as reltuples can be 0 for unanalyzed tables
                let where_clause = build_where_clause(filters, "postgres");
                let sql = format!("SELECT COUNT(*) FROM \"{}\" {};", table_name.replace("\"", "\"\""), where_clause);
                let row = sqlx::query(&sql).fetch_one(pool).await?;
                return Ok(row.try_get::<i64, _>(0)? as u64);
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let where_clause = build_where_clause(filters, "mysql");
                let sql = format!("SELECT COUNT(*) FROM `{}` {};", table_name.replace("`", "``"), where_clause);
                let row = sqlx::query(&sql).fetch_one(pool).await?;
                return Ok(row.try_get::<i64, _>(0).unwrap_or(0) as u64);
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let where_clause = build_where_clause(filters, "sqlite");
                let sql = format!("SELECT COUNT(*) FROM \"{}\" {};", table_name.replace("\"", "\"\""), where_clause);
                let row = sqlx::query(&sql).fetch_one(pool).await?;
                return Ok(row.try_get::<i64, _>(0)? as u64);
            }
        }

        Err(anyhow!("Connection not found"))
    }

    /// Execute multiple SQL statements (mutations) - used for committing changes
    pub async fn execute_mutations(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        statements: Vec<String>,
    ) -> Result<u64> {
        let mut total_affected = 0u64;

        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                for sql in &statements {

                    let result = sqlx::query(sql).execute(pool).await?;
                    total_affected += result.rows_affected();
                }
                return Ok(total_affected);
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                for sql in &statements {
                    let result = sqlx::query(sql).execute(pool).await?;
                    total_affected += result.rows_affected();
                }
                return Ok(total_affected);
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                for sql in &statements {
                    let result = sqlx::query(sql).execute(pool).await?;
                    total_affected += result.rows_affected();
                }
                return Ok(total_affected);
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn get_table_metadata(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
    ) -> Result<TableMetadata> {
        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = r#"
                    SELECT 
                        pg_size_pretty(pg_total_relation_size(quote_ident($1))) as total_size,
                        pg_size_pretty(pg_relation_size(quote_ident($1))) as data_size,
                        pg_size_pretty(pg_indexes_size(quote_ident($1))) as index_size,
                        obj_description(quote_ident($1)::regclass, 'pg_class') as comment
                "#;
                let row = sqlx::query(sql)
                    .bind(table_name)
                    .fetch_one(pool)
                    .await?;

                return Ok(TableMetadata {
                    total_size: row.try_get(0).ok(),
                    data_size: row.try_get(1).ok(),
                    index_size: row.try_get(2).ok(),
                    comment: row.try_get(3).ok(),
                });
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = r#"
                    SELECT 
                        (DATA_LENGTH + INDEX_LENGTH) as total_size,
                        DATA_LENGTH as data_size,
                        INDEX_LENGTH as index_size,
                        TABLE_COMMENT as comment
                    FROM information_schema.TABLES
                    WHERE TABLE_NAME = ?
                "#;
                let row = sqlx::query(sql)
                    .bind(table_name)
                    .fetch_one(pool)
                    .await?;

                let total: Option<u64> = row.try_get(0).ok();
                let data: Option<u64> = row.try_get(1).ok();
                let index: Option<u64> = row.try_get(2).ok();

                return Ok(TableMetadata {
                    total_size: total.map(|s| format!("{} KB", s / 1024)),
                    data_size: data.map(|s| format!("{} KB", s / 1024)),
                    index_size: index.map(|s| format!("{} KB", s / 1024)),
                    comment: row.try_get(3).ok(),
                });
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(_) = pools.get(connection_id) {
                // SQLite doesn't easily provide per-table size in standard SQL
                return Ok(TableMetadata {
                    total_size: Some("Unknown".to_string()),
                    data_size: Some("Unknown".to_string()),
                    index_size: Some("Unknown".to_string()),
                    comment: None,
                });
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn get_table_structure(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
    ) -> Result<TableStructure> {
        let db_type = {
            if manager.get_postgres_pools().await.contains_key(connection_id) {
                Some("postgres")
            } else if manager.get_mysql_pools().await.contains_key(connection_id) {
                Some("mysql")
            } else if manager.get_sqlite_pools().await.contains_key(connection_id) {
                Some("sqlite")
            } else {
                None
            }
        };

        match db_type {
            Some("postgres") => {
                let pool = manager.get_postgres_pools().await.get(connection_id).cloned().unwrap();
                
                // Fetch columns
                let col_sql = r#"
                    SELECT 
                        column_name, 
                        data_type, 
                        is_nullable, 
                        column_default,
                        EXISTS (
                            SELECT 1 FROM information_schema.key_column_usage kcu
                            JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
                            WHERE kcu.table_name = c.table_name AND kcu.column_name = c.column_name AND tc.constraint_type = 'PRIMARY KEY'
                        ) as is_primary
                    FROM information_schema.columns c
                    WHERE table_name = $1 AND table_schema = 'public'
                    ORDER BY ordinal_position;
                "#;
                let col_rows = sqlx::query(col_sql).bind(table_name).fetch_all(&pool).await?;
                let columns = col_rows.into_iter().map(|row| {
                    TableColumnStructure {
                        name: row.get(0),
                        data_type: row.get(1),
                        is_nullable: row.get::<String, _>(2) == "YES",
                        default_value: row.get(3),
                        is_primary_key: row.get(4),
                        comment: None, // We could fetch this too if needed
                    }
                }).collect();

                // Fetch indexes
                let idx_sql = "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1 AND schemaname = 'public';";
                let idx_rows = sqlx::query(idx_sql).bind(table_name).fetch_all(&pool).await?;
                let indexes = idx_rows.into_iter().map(|row| {
                    let def: String = row.get(1);
                    TableIndexStructure {
                        name: row.get(0),
                        columns: vec![], // Logic to parse columns from def would be complex, leaving empty for now or could just show def
                        is_unique: def.contains("UNIQUE"),
                        index_type: "btree".to_string(), // Default in PG
                    }
                }).collect();

                // Fetch constraints
                let cons_sql = r#"
                    SELECT 
                        constraint_name, 
                        constraint_type
                    FROM information_schema.table_constraints 
                    WHERE table_name = $1 AND table_schema = 'public';
                "#;
                let cons_rows = sqlx::query(cons_sql).bind(table_name).fetch_all(&pool).await?;
                let constraints = cons_rows.into_iter().map(|row| {
                    TableConstraintStructure {
                        name: row.get(0),
                        constraint_type: row.get(1),
                        definition: "".to_string(),
                    }
                }).collect();

                Ok(TableStructure { columns, indexes, constraints })
            },
            Some("mysql") => {
                let pool = manager.get_mysql_pools().await.get(connection_id).cloned().unwrap();
                
                // Fetch columns
                let col_sql = r#"
                    SELECT 
                        COLUMN_NAME, 
                        COLUMN_TYPE, 
                        IS_NULLABLE, 
                        COLUMN_DEFAULT, 
                        COLUMN_KEY,
                        COLUMN_COMMENT
                    FROM information_schema.COLUMNS 
                    WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()
                    ORDER BY ORDINAL_POSITION;
                "#;
                let col_rows = sqlx::query(col_sql).bind(table_name).fetch_all(&pool).await?;
                let columns = col_rows.into_iter().map(|row| {
                    TableColumnStructure {
                        name: row.get(0),
                        data_type: row.get(1),
                        is_nullable: row.get::<String, _>(2) == "YES",
                        default_value: row.get(3),
                        is_primary_key: row.get::<String, _>(4) == "PRI",
                        comment: row.get(5),
                    }
                }).collect();

                // Fetch indexes
                let idx_sql = format!("SHOW INDEX FROM `{}`", table_name.replace("`", "``"));
                let idx_rows = sqlx::query(&idx_sql).fetch_all(&pool).await?;
                
                // Group by index name
                let mut indexes_map: std::collections::HashMap<String, TableIndexStructure> = std::collections::HashMap::new();
                for row in idx_rows {
                    let name: String = row.get("Key_name");
                    let column: String = row.get("Column_name");
                    let non_unique: i32 = row.get("Non_unique");
                    
                    let entry = indexes_map.entry(name.clone()).or_insert(TableIndexStructure {
                        name: name.clone(),
                        columns: vec![],
                        is_unique: non_unique == 0,
                        index_type: row.get("Index_type"),
                    });
                    entry.columns.push(column);
                }
                let indexes = indexes_map.into_values().collect();

                // Fetch constraints
                let cons_sql = "SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE();";
                let cons_rows = sqlx::query(cons_sql).bind(table_name).fetch_all(&pool).await?;
                let constraints = cons_rows.into_iter().map(|row| {
                    TableConstraintStructure {
                        name: row.get(0),
                        constraint_type: row.get(1),
                        definition: "".to_string(),
                    }
                }).collect();

                Ok(TableStructure { columns, indexes, constraints })
            },
            Some("sqlite") => {
                let pool = manager.get_sqlite_pools().await.get(connection_id).cloned().unwrap();
                
                // Fetch columns
                let col_sql = format!("PRAGMA table_info(\"{}\")", table_name.replace("\"", "\"\""));
                let col_rows = sqlx::query(&col_sql).fetch_all(&pool).await?;
                let columns = col_rows.into_iter().map(|row| {
                    TableColumnStructure {
                        name: row.get("name"),
                        data_type: row.get("type"),
                        is_nullable: row.get::<i32, _>("notnull") == 0,
                        default_value: row.get("dflt_value"),
                        is_primary_key: row.get::<i32, _>("pk") > 0,
                        comment: None,
                    }
                }).collect();

                // Fetch indexes
                let idx_list_sql = format!("PRAGMA index_list(\"{}\")", table_name.replace("\"", "\"\""));
                let idx_list_rows = sqlx::query(&idx_list_sql).fetch_all(&pool).await?;
                let mut indexes = Vec::new();
                for row in idx_list_rows {
                    let name: String = row.get("name");
                    let unique: i32 = row.get("unique");
                    
                    // Get columns for this index
                    let idx_info_sql = format!("PRAGMA index_info(\"{}\")", name.replace("\"", "\"\""));
                    let idx_info_rows = sqlx::query(&idx_info_sql).fetch_all(&pool).await?;
                    let cols: Vec<String> = idx_info_rows.into_iter().filter_map(|r| r.try_get("name").ok()).collect();
                    
                    indexes.push(TableIndexStructure {
                        name,
                        columns: cols,
                        is_unique: unique > 0,
                        index_type: "btree".to_string(),
                    });
                }

                // Fetch constraints (foreign keys)
                let fk_sql = format!("PRAGMA foreign_key_list(\"{}\")", table_name.replace("\"", "\"\""));
                let fk_rows = sqlx::query(&fk_sql).fetch_all(&pool).await?;
                let constraints = fk_rows.into_iter().map(|row| {
                    let table: String = row.get("table");
                    let from: String = row.get("from");
                    let to: String = row.get("to");
                    TableConstraintStructure {
                        name: format!("fk_{}_{}", table, from),
                        constraint_type: "FOREIGN KEY".to_string(),
                        definition: format!("{} -> {}({})", from, table, to),
                    }
                }).collect();

                Ok(TableStructure { columns, indexes, constraints })
            },
            Some(_) => Err(anyhow!("Unknown database type")),
            None => Err(anyhow!("Connection not found"))
        }
    }

    pub async fn export_table_data(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
        filters: Vec<FilterConfig>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
        format: &str,
        file_path: &str,
    ) -> Result<u64> {
        let db_type = {
            if manager.get_postgres_pools().await.contains_key(connection_id) { Some("postgres") }
            else if manager.get_mysql_pools().await.contains_key(connection_id) { Some("mysql") }
            else if manager.get_sqlite_pools().await.contains_key(connection_id) { Some("sqlite") }
            else { None }
        };

        if db_type.is_none() { return Err(anyhow!("Connection not found")); }
        let db_type = db_type.unwrap();

        let where_clause = build_where_clause(filters, db_type);
        let order_clause = build_order_clause(sort_column, sort_direction, db_type);
        
        let sql = match db_type {
            "postgres" | "sqlite" => format!("SELECT * FROM \"{}\" {} {};", table_name.replace("\"", "\"\""), where_clause, order_clause),
            "mysql" => format!("SELECT * FROM `{}` {} {};", table_name.replace("`", "``"), where_clause, order_clause),
            _ => return Err(anyhow!("Unknown database type")),
        };

        let result = Self::execute_query(manager, connection_id, &sql, None, None).await?;
        let rows_count = result.rows.len() as u64;

        let mut file = File::create(file_path)?;

        match format {
            "csv" => {
                let mut wtr = csv::Writer::from_writer(file);
                // Write headers
                wtr.write_record(&result.columns)?;
                // Write rows
                for row in result.rows {
                    let record: Vec<String> = row.into_iter().map(|v| match v {
                        Value::Null => "".to_string(),
                        Value::String(s) => s,
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string(),
                        _ => v.to_string(),
                    }).collect();
                    wtr.write_record(&record)?;
                }
                wtr.flush()?;
            },
            "json" => {
                let mut json_rows = Vec::new();
                for row in result.rows {
                    let mut obj = serde_json::Map::new();
                    for (i, col) in result.columns.iter().enumerate() {
                        obj.insert(col.clone(), row[i].clone());
                    }
                    json_rows.push(Value::Object(obj));
                }
                let json_data = serde_json::to_string_pretty(&json_rows)?;
                file.write_all(json_data.as_bytes())?;
            },
            "sql" => {
                for row in result.rows {
                    let values: Vec<String> = row.into_iter().map(|v| match v {
                        Value::Null => "NULL".to_string(),
                        Value::String(s) => format!("'{}'", s.replace("'", "''")),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => if b { "true" } else { "false" }.to_string(),
                        _ => format!("'{}'", v.to_string().replace("'", "''")),
                    }).collect();
                    
                    let insert_sql = match db_type {
                        "mysql" => format!("INSERT INTO `{}` ({}) VALUES ({});\n", 
                            table_name.replace("`", "``"), 
                            result.columns.iter().map(|c| format!("`{}`", c.replace("`", "``"))).collect::<Vec<_>>().join(", "),
                            values.join(", ")
                        ),
                        _ => format!("INSERT INTO \"{}\" ({}) VALUES ({});\n", 
                            table_name.replace("\"", "\"\""), 
                            result.columns.iter().map(|c| format!("\"{}\"", c.replace("\"", "\"\""))).collect::<Vec<_>>().join(", "),
                            values.join(", ")
                        ),
                    };
                    file.write_all(insert_sql.as_bytes())?;
                }
            },
            _ => return Err(anyhow!("Unsupported export format")),
        }

        Ok(rows_count)
    }
}
