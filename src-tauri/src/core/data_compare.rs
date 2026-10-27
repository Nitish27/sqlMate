use crate::core::connection_manager::ConnectionManager;
use crate::core::schema_snapshot::{get_schema_snapshot, SchemaTable};
use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use sqlx::{Acquire, ConnectOptions, Row};
use uuid::Uuid;

const MAX_ROWS: u32 = 200;
const MAX_COLUMNS: usize = 128;
const MAX_CELL_BYTES: usize = 8 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ComparisonRows {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub primary_key: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub has_more: bool,
}

fn quoted(identifier: &str, engine: &str) -> String {
    if engine == "MySql" {
        format!("`{}`", identifier.replace('`', "``"))
    } else {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    }
}

fn supported_type(data_type: &str) -> bool {
    let lower = data_type.to_ascii_lowercase();
    !lower.is_empty()
        && ![
            "blob",
            "binary",
            "bytea",
            "json",
            "array",
            "geometry",
            "geography",
            "vector",
            "image",
            "xml",
            "bit",
        ]
        .iter()
        .any(|part| lower.contains(part))
        && !lower.ends_with("[]")
}

fn comparison_sql(table: &SchemaTable, engine: &str, limit: u32) -> Result<(String, Vec<String>)> {
    if limit == 0 || limit > MAX_ROWS {
        bail!("Compare at most {MAX_ROWS} rows per connection");
    }
    if table.columns.is_empty() {
        bail!("This table has no readable columns");
    }
    if table.columns.len() > MAX_COLUMNS {
        bail!("Data Compare supports at most {MAX_COLUMNS} columns per table");
    }
    let mut primary_key: Vec<String> = table
        .columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect();
    if primary_key.is_empty() {
        bail!("Data Compare requires a declared primary key");
    }
    primary_key.sort();
    if let Some(column) = table
        .columns
        .iter()
        .find(|column| !supported_type(&column.data_type))
    {
        bail!(
            "Column {} has an unsupported type for text comparison",
            column.name
        );
    }
    let cast = if engine == "MySql" { "CHAR" } else { "TEXT" };
    let flag_cast = if engine == "MySql" {
        "SIGNED"
    } else {
        "INTEGER"
    };
    let columns = table
        .columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let identifier = quoted(&column.name, engine);
            let text = format!("CAST({identifier} AS {cast})");
            let bytes = match engine {
                "Postgres" => format!("octet_length({text})"),
                "Sqlite" => format!("length(CAST({identifier} AS BLOB))"),
                _ => format!("length({text})"),
            };
            format!(
                "CAST(CASE WHEN {bytes} > {MAX_CELL_BYTES} THEN NULL ELSE {text} END AS {cast}) AS {identifier}, CAST(CASE WHEN {bytes} > {MAX_CELL_BYTES} THEN 1 ELSE 0 END AS {flag_cast}) AS {}",
                quoted(&format!("__sqlmate_oversize_{index}"), engine),
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let relation = match &table.schema {
        Some(schema) => format!("{}.{}", quoted(schema, engine), quoted(&table.name, engine)),
        None => quoted(&table.name, engine),
    };
    let order = primary_key
        .iter()
        .map(|key| quoted(key, engine))
        .collect::<Vec<_>>()
        .join(", ");
    Ok((
        format!(
            "SELECT {columns} FROM {relation} ORDER BY {order} LIMIT {}",
            limit + 1
        ),
        primary_key,
    ))
}

pub async fn get_comparison_rows(
    manager: &ConnectionManager,
    connection_id: &Uuid,
    schema: Option<String>,
    table: String,
    limit: u32,
) -> Result<ComparisonRows> {
    let snapshot = get_schema_snapshot(manager, connection_id).await?;
    let metadata = snapshot
        .tables
        .iter()
        .find(|item| item.schema == schema && item.name == table)
        .ok_or_else(|| anyhow!("Table not found in the selected database"))?;
    let (sql, primary_key) = comparison_sql(metadata, &snapshot.engine, limit)?;
    let column_count = metadata.columns.len();
    let columns = metadata
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect();
    let column_types = metadata
        .columns
        .iter()
        .map(|column| column.data_type.clone())
        .collect();
    macro_rules! read_rows {
        ($connection:expr) => {{
            let raw = sqlx::query(&sql).fetch_all($connection).await?;
            let has_more = raw.len() > limit as usize;
            let mut total_bytes = 0;
            let mut rows = Vec::with_capacity(raw.len().min(limit as usize));
            for row in raw.into_iter().take(limit as usize) {
                let mut values = Vec::with_capacity(column_count);
                for index in 0..column_count {
                    let flag_index = index * 2 + 1;
                    let oversized = row
                        .try_get::<i64, _>(flag_index)
                        .or_else(|_| row.try_get::<i32, _>(flag_index).map(i64::from))?;
                    if oversized != 0 {
                        bail!("Comparison sample contains values too large to compare safely");
                    }
                    let value: Option<String> = row.try_get(index * 2)?;
                    if let Some(text) = &value {
                        total_bytes += text.len();
                        if text.len() > MAX_CELL_BYTES || total_bytes > MAX_RESPONSE_BYTES {
                            bail!("Comparison sample contains values too large to compare safely");
                        }
                    }
                    values.push(value);
                }
                rows.push(values);
            }
            return Ok(ComparisonRows {
                columns,
                column_types,
                primary_key,
                rows,
                has_more,
            });
        }};
    }

    // Identifiers come only from the current schema snapshot; each engine enforces a read-only connection.
    if let Some(pool) = manager
        .get_postgres_pools()
        .await
        .get(connection_id)
        .cloned()
    {
        let mut tx = pool.begin().await?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *tx)
            .await?;
        read_rows!(&mut *tx);
    }
    if let Some(pool) = manager.get_mysql_pools().await.get(connection_id).cloned() {
        let mut connection = pool.acquire().await?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *connection)
            .await?;
        let mut tx = connection.begin().await?;
        read_rows!(&mut *tx);
    }
    if manager.get_sqlite_pools().await.contains_key(connection_id) {
        let path = manager
            .get_config(connection_id)
            .await?
            .database
            .ok_or_else(|| anyhow!("SQLite path is missing"))?;
        if path == ":memory:" {
            bail!("Data Compare is unavailable for in-memory SQLite databases");
        }
        let mut connection = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .read_only(true)
            .connect()
            .await?;
        read_rows!(&mut connection);
    }
    Err(anyhow!("Connection not found"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::schema_snapshot::SchemaColumn;

    #[test]
    fn sql_quotes_identifiers_and_caps_reads() {
        let table = SchemaTable {
            schema: Some("public".into()),
            name: "odd\"name".into(),
            columns: vec![SchemaColumn {
                name: "key\"id".into(),
                data_type: "integer".into(),
                is_nullable: false,
                default_value: None,
                is_primary_key: true,
            }],
        };
        let (sql, keys) = comparison_sql(&table, "Postgres", 100).unwrap();
        assert_eq!(keys, ["key\"id"]);
        assert!(sql.contains("FROM \"public\".\"odd\"\"name\""));
        assert!(sql.ends_with("ORDER BY \"key\"\"id\" LIMIT 101"));
        assert!(comparison_sql(&table, "Postgres", 201).is_err());
        let (mysql, _) = comparison_sql(&table, "MySql", 2).unwrap();
        assert!(mysql.contains("CAST(`key\"id` AS CHAR)"));
        assert!(mysql.contains("LIMIT 3"));
    }
}
