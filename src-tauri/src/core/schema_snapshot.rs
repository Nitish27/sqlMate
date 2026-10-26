use crate::core::connection_manager::ConnectionManager;
use anyhow::{anyhow, Result};
use serde::Serialize;
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct SchemaColumn {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaTable {
    pub schema: Option<String>,
    pub name: String,
    pub columns: Vec<SchemaColumn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaSnapshot {
    pub engine: String,
    pub database: String,
    pub tables: Vec<SchemaTable>,
}

pub async fn get_schema_snapshot(
    manager: &ConnectionManager,
    connection_id: &Uuid,
) -> Result<SchemaSnapshot> {
    if let Some(pool) = manager
        .get_postgres_pools()
        .await
        .get(connection_id)
        .cloned()
    {
        let database: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&pool)
            .await?;
        let rows = sqlx::query(
            r#"
            SELECT n.nspname AS schema_name, c.relname AS table_name,
                   a.attname AS column_name,
                   pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                   NOT a.attnotnull AS is_nullable,
                   pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value,
                   EXISTS (
                       SELECT 1 FROM pg_catalog.pg_index i
                       WHERE i.indrelid = c.oid AND i.indisprimary
                         AND a.attnum = ANY(i.indkey)
                   ) AS is_primary_key
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
                AND a.attnum > 0 AND NOT a.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
            WHERE c.relkind IN ('r', 'p')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg_toast%'
              AND n.nspname NOT LIKE 'pg_temp_%'
            ORDER BY n.nspname, c.relname, a.attnum
            "#,
        )
        .fetch_all(&pool)
        .await?;
        let mut tables = BTreeMap::<(String, String), SchemaTable>::new();
        for row in rows {
            let schema: String = row.get("schema_name");
            let name: String = row.get("table_name");
            let table = tables
                .entry((schema.clone(), name.clone()))
                .or_insert_with(|| SchemaTable {
                    schema: Some(schema),
                    name,
                    columns: Vec::new(),
                });
            if let Some(column_name) = row.get::<Option<String>, _>("column_name") {
                table.columns.push(SchemaColumn {
                    name: column_name,
                    data_type: row.get("data_type"),
                    is_nullable: row.get("is_nullable"),
                    default_value: row.get("default_value"),
                    is_primary_key: row.get("is_primary_key"),
                });
            }
        }
        return Ok(SchemaSnapshot {
            engine: "Postgres".to_string(),
            database,
            tables: tables.into_values().collect(),
        });
    }

    if let Some(pool) = manager.get_mysql_pools().await.get(connection_id).cloned() {
        let database: String = sqlx::query_scalar("SELECT DATABASE()")
            .fetch_one(&pool)
            .await?;
        let rows = sqlx::query(
            r#"
            SELECT t.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
                   c.COLUMN_TYPE AS data_type, c.IS_NULLABLE AS is_nullable,
                   c.COLUMN_DEFAULT AS default_value, c.COLUMN_KEY AS column_key
            FROM information_schema.TABLES t
            LEFT JOIN information_schema.COLUMNS c
              ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
            WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
            ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
            "#,
        )
        .fetch_all(&pool)
        .await?;
        let mut tables = BTreeMap::<String, SchemaTable>::new();
        for row in rows {
            let name: String = row.get("table_name");
            let table = tables.entry(name.clone()).or_insert_with(|| SchemaTable {
                schema: None,
                name,
                columns: Vec::new(),
            });
            if let Some(column_name) = row.get::<Option<String>, _>("column_name") {
                table.columns.push(SchemaColumn {
                    name: column_name,
                    data_type: row.get("data_type"),
                    is_nullable: row.get::<String, _>("is_nullable") == "YES",
                    default_value: row.get("default_value"),
                    is_primary_key: row.get::<String, _>("column_key") == "PRI",
                });
            }
        }
        return Ok(SchemaSnapshot {
            engine: "MySql".to_string(),
            database,
            tables: tables.into_values().collect(),
        });
    }

    if let Some(pool) = manager.get_sqlite_pools().await.get(connection_id).cloned() {
        let database = sqlx::query("PRAGMA database_list")
            .fetch_all(&pool)
            .await?
            .into_iter()
            .find_map(|row| {
                (row.get::<String, _>("name") == "main").then(|| row.get::<String, _>("file"))
            })
            .filter(|path| !path.is_empty())
            .unwrap_or_else(|| "main".to_string());
        let rows = sqlx::query(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await?;
        let mut tables = Vec::with_capacity(rows.len());
        for row in rows {
            let name: String = row.get("name");
            let sql = format!("PRAGMA table_xinfo(\"{}\")", name.replace('"', "\"\""));
            let column_rows = sqlx::query(&sql).fetch_all(&pool).await?;
            let columns = column_rows
                .into_iter()
                .map(|column| SchemaColumn {
                    name: column.get("name"),
                    data_type: column.get("type"),
                    is_nullable: column.get::<i32, _>("notnull") == 0,
                    default_value: column.get("dflt_value"),
                    is_primary_key: column.get::<i32, _>("pk") > 0,
                })
                .collect();
            tables.push(SchemaTable {
                schema: None,
                name,
                columns,
            });
        }
        return Ok(SchemaSnapshot {
            engine: "Sqlite".to_string(),
            database,
            tables,
        });
    }

    Err(anyhow!("Connection not found"))
}

#[cfg(test)]
mod tests {
    use super::get_schema_snapshot;
    use crate::core::{connection_manager::ConnectionManager, ConnectionConfig};
    use serde_json::json;
    use sqlx::{ConnectOptions, Executor};
    use uuid::Uuid;

    #[tokio::test]
    async fn schema_snapshot_reads_sqlite_tables_and_columns_without_rows() {
        let id = Uuid::new_v4();
        let path = std::env::temp_dir().join(format!("sqlmate-schema-compare-{id}.db"));
        let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap();
        setup
            .execute("CREATE TABLE empty_table (id INTEGER PRIMARY KEY)")
            .await
            .unwrap();
        setup.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT 'untitled', archived_at TEXT)").await.unwrap();
        setup
            .execute("INSERT INTO projects (id) VALUES (1)")
            .await
            .unwrap();
        drop(setup);

        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "test", "db_type": "Sqlite",
            "database": path.to_string_lossy(), "ssl_enabled": false,
            "ssh_enabled": false
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();

        let snapshot = get_schema_snapshot(&manager, &id).await.unwrap();
        assert_eq!(snapshot.engine, "Sqlite");
        assert_eq!(
            snapshot.database,
            path.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(snapshot.tables.len(), 2);
        let projects = snapshot
            .tables
            .iter()
            .find(|table| table.name == "projects")
            .unwrap();
        assert_eq!(projects.columns.len(), 3);
        let title = projects
            .columns
            .iter()
            .find(|column| column.name == "title")
            .unwrap();
        assert_eq!(title.data_type, "TEXT");
        assert!(!title.is_nullable);
        assert_eq!(title.default_value.as_deref(), Some("'untitled'"));
        assert!(
            projects
                .columns
                .iter()
                .find(|column| column.name == "id")
                .unwrap()
                .is_primary_key
        );

        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(path).unwrap();
    }
}
