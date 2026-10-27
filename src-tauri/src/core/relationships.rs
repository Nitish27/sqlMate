use crate::core::connection_manager::ConnectionManager;
use anyhow::{anyhow, Result};
use serde::Serialize;
use sqlx::Row;
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct Relationship {
    pub name: String,
    pub source_schema: Option<String>,
    pub source_table: String,
    pub source_columns: Vec<String>,
    pub target_schema: Option<String>,
    pub target_table: String,
    pub target_columns: Vec<String>,
}

pub async fn get_relationships(
    manager: &ConnectionManager,
    connection_id: &Uuid,
) -> Result<Vec<Relationship>> {
    if let Some(pool) = manager
        .get_postgres_pools()
        .await
        .get(connection_id)
        .cloned()
    {
        let rows = sqlx::query(
            r#"
            SELECT con.conname AS name,
                   source_schema.nspname AS source_schema, source.relname AS source_table,
                   source_column.attname AS source_column,
                   target_schema.nspname AS target_schema, target.relname AS target_table,
                   target_column.attname AS target_column
            FROM pg_catalog.pg_constraint con
            JOIN pg_catalog.pg_class source ON source.oid = con.conrelid
            JOIN pg_catalog.pg_namespace source_schema ON source_schema.oid = source.relnamespace
            JOIN pg_catalog.pg_class target ON target.oid = con.confrelid
            JOIN pg_catalog.pg_namespace target_schema ON target_schema.oid = target.relnamespace
            JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY
              AS keys(source_number, target_number, position) ON true
            JOIN pg_catalog.pg_attribute source_column
              ON source_column.attrelid = source.oid AND source_column.attnum = keys.source_number
            JOIN pg_catalog.pg_attribute target_column
              ON target_column.attrelid = target.oid AND target_column.attnum = keys.target_number
            WHERE con.contype = 'f'
              AND source_schema.nspname NOT IN ('pg_catalog', 'information_schema')
              AND source_schema.nspname NOT LIKE 'pg_toast%'
              AND source_schema.nspname NOT LIKE 'pg_temp_%'
            ORDER BY source_schema.nspname, source.relname, con.conname, keys.position
            "#,
        )
        .fetch_all(&pool)
        .await?;
        let mut edges = BTreeMap::<(String, String, String), Relationship>::new();
        for row in rows {
            let source_schema: String = row.get("source_schema");
            let source_table: String = row.get("source_table");
            let name: String = row.get("name");
            let edge = edges
                .entry((source_schema.clone(), source_table.clone(), name.clone()))
                .or_insert_with(|| Relationship {
                    name,
                    source_schema: Some(source_schema),
                    source_table,
                    source_columns: Vec::new(),
                    target_schema: Some(row.get("target_schema")),
                    target_table: row.get("target_table"),
                    target_columns: Vec::new(),
                });
            edge.source_columns.push(row.get("source_column"));
            edge.target_columns.push(row.get("target_column"));
        }
        return Ok(edges.into_values().collect());
    }

    if let Some(pool) = manager.get_mysql_pools().await.get(connection_id).cloned() {
        let rows = sqlx::query(
            r#"
            SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS source_table,
                   COLUMN_NAME AS source_column,
                   REFERENCED_TABLE_SCHEMA AS target_schema,
                   REFERENCED_TABLE_NAME AS target_table,
                   REFERENCED_COLUMN_NAME AS target_column
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
            "#,
        )
        .fetch_all(&pool)
        .await?;
        let database: String = sqlx::query_scalar("SELECT DATABASE()")
            .fetch_one(&pool)
            .await?;
        let mut edges = BTreeMap::<(String, String), Relationship>::new();
        for row in rows {
            let source_table: String = row.get("source_table");
            let name: String = row.get("name");
            let edge = edges
                .entry((source_table.clone(), name.clone()))
                .or_insert_with(|| {
                    let target_schema: String = row.get("target_schema");
                    Relationship {
                        name,
                        source_schema: None,
                        source_table,
                        source_columns: Vec::new(),
                        target_schema: (target_schema != database).then_some(target_schema),
                        target_table: row.get("target_table"),
                        target_columns: Vec::new(),
                    }
                });
            edge.source_columns.push(row.get("source_column"));
            edge.target_columns.push(row.get("target_column"));
        }
        return Ok(edges.into_values().collect());
    }

    if let Some(pool) = manager.get_sqlite_pools().await.get(connection_id).cloned() {
        let tables = sqlx::query(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await?;
        let mut edges = Vec::new();
        let mut primary_keys = BTreeMap::<String, Vec<String>>::new();
        for table in tables {
            let source_table: String = table.get("name");
            let sql = format!(
                "PRAGMA foreign_key_list(\"{}\")",
                source_table.replace('"', "\"\"")
            );
            let rows = sqlx::query(&sql).fetch_all(&pool).await?;
            let mut grouped = BTreeMap::<i64, (String, Vec<(i64, String, Option<String>)>)>::new();
            for row in rows {
                let id: i64 = row.get("id");
                let position: i64 = row.get("seq");
                let target_table: String = row.get("table");
                grouped
                    .entry(id)
                    .or_insert_with(|| (target_table, Vec::new()))
                    .1
                    .push((position, row.get("from"), row.get("to")));
            }
            for (id, (target_table, mut columns)) in grouped {
                columns.sort_by_key(|(position, _, _)| *position);
                if columns.iter().any(|(_, _, target)| target.is_none())
                    && !primary_keys.contains_key(&target_table)
                {
                    let sql = format!(
                        "PRAGMA table_info(\"{}\")",
                        target_table.replace('"', "\"\"")
                    );
                    let mut keys: Vec<(i32, String)> = sqlx::query(&sql)
                        .fetch_all(&pool)
                        .await?
                        .into_iter()
                        .filter_map(|row| {
                            let position: i32 = row.get("pk");
                            (position > 0).then(|| (position, row.get("name")))
                        })
                        .collect();
                    keys.sort_by_key(|(position, _)| *position);
                    primary_keys.insert(
                        target_table.clone(),
                        keys.into_iter().map(|(_, name)| name).collect(),
                    );
                }
                edges.push(Relationship {
                    name: format!("fk_{source_table}_{id}"),
                    source_schema: None,
                    source_table: source_table.clone(),
                    source_columns: columns.iter().map(|(_, name, _)| name.clone()).collect(),
                    target_schema: None,
                    target_table: target_table.clone(),
                    target_columns: columns
                        .into_iter()
                        .map(|(position, _, name)| {
                            name.or_else(|| {
                                primary_keys
                                    .get(&target_table)
                                    .and_then(|keys| keys.get(position as usize).cloned())
                            })
                            .unwrap_or_default()
                        })
                        .collect(),
                });
            }
        }
        return Ok(edges);
    }

    Err(anyhow!("Connection not found"))
}
