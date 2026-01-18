use anyhow::{Result, anyhow};
use crate::core::{QueryResult, TableMetadata, connection_manager::ConnectionManager};
use sqlx::{Column, Row, ValueRef};
use std::time::Instant;
use uuid::Uuid;
use serde_json::Value;

// Macro to map rows without generic trait hell
macro_rules! map_rows {
    ($rows:expr, $duration:expr) => {{
        let mut columns = Vec::new();
        let mut result_rows = Vec::new();

        if let Some(first_row) = $rows.first() {
            for col in first_row.columns() {
                columns.push(col.name().to_string());
            }
        }

        for row in $rows {
            let mut result_row = Vec::new();
            for i in 0..row.columns().len() {
                let val: Value = match row.try_get_raw(i)? {
                    v if v.is_null() => Value::Null,
                    _ => {
                         // Try common types in order
                         if let Ok(s) = row.try_get::<String, _>(i) {
                            Value::String(s)
                         } else if let Ok(b) = row.try_get::<bool, _>(i) {
                            Value::Bool(b)
                         } else if let Ok(n) = row.try_get::<i64, _>(i) {
                            Value::Number(serde_json::Number::from(n))
                         } else if let Ok(n) = row.try_get::<i32, _>(i) {
                            Value::Number(serde_json::Number::from(n))
                         } else if let Ok(f) = row.try_get::<f64, _>(i) {
                            serde_json::Number::from_f64(f)
                                .map(Value::Number)
                                .unwrap_or_else(|| Value::String(f.to_string()))
                         } else if let Ok(f) = row.try_get::<f32, _>(i) {
                            serde_json::Number::from_f64(f as f64)
                                .map(Value::Number)
                                .unwrap_or_else(|| Value::String(f.to_string()))
                         } else if let Ok(dt) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                            Value::String(dt.to_rfc3339())
                         } else if let Ok(dt) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                            Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string())
                         } else if let Ok(dt) = row.try_get::<chrono::NaiveDate, _>(i) {
                            Value::String(dt.to_string())
                         } else if let Ok(u) = row.try_get::<uuid::Uuid, _>(i) {
                            Value::String(u.to_string())
                         } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(i) {
                            let hex_string: String = bytes.iter()
                                .map(|b| format!("{:02x}", b))
                                .collect();
                            Value::String(format!("0x{}", hex_string))
                         } else {
                            Value::String("Binary/Complex".to_string())
                         }
                    }
                };
                result_row.push(val);
            }
            result_rows.push(result_row);
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            affected_rows: 0,
            execution_time_ms: $duration,
        })
    }}
}

pub struct QueryEngine;

impl QueryEngine {
    pub async fn execute_query(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        sql: &str,
    ) -> Result<QueryResult> {
        let start = Instant::now();

        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;

            if let Some(pool) = pools.get(connection_id) {

                let rows = sqlx::query(sql).fetch_all(pool).await?;

                return map_rows!(rows, start.elapsed().as_millis() as u64);
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                return map_rows!(rows, start.elapsed().as_millis() as u64);
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                return map_rows!(rows, start.elapsed().as_millis() as u64);
            }
        }

        Err(anyhow!("Connection not found"))
    }

    // Kept for backward compat if needed, but redundant now
    pub async fn execute_query_sqlite(
         manager: &ConnectionManager,
         connection_id: &Uuid,
         sql: &str,
    ) -> Result<QueryResult> {
        Self::execute_query(manager, connection_id, sql).await
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
                 // Postgres uses double quotes
                 let sql = format!("SELECT * FROM \"{}\" LIMIT 100;", table_name.replace("\"", "\"\""));

                 let result = Self::execute_query(manager, connection_id, &sql).await;

                 result
            },
            Some("mysql") => {
                 // MySQL uses backticks
                 let sql = format!("SELECT * FROM `{}` LIMIT 100;", table_name.replace("`", "``"));
                 Self::execute_query(manager, connection_id, &sql).await
            },
            Some("sqlite") => {
                 // SQLite uses double quotes or brackets
                 let sql = format!("SELECT * FROM \"{}\" LIMIT 100;", table_name.replace("\"", "\"\""));
                 Self::execute_query(manager, connection_id, &sql).await
            },
            Some(_) => Err(anyhow!("Unknown database type")),
            None => Err(anyhow!("Connection not found"))
        }
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
}
