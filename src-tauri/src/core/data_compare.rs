use crate::core::connection_manager::ConnectionManager;
use crate::core::schema_snapshot::{get_schema_snapshot, SchemaTable};
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Deserialize)]
pub struct PrimaryKeyRange {
    pub column: String,
    pub lower: Option<String>,
    pub upper: Option<String>,
}

#[derive(Debug, PartialEq)]
enum RangeBounds {
    Signed(Vec<i64>),
    Unsigned(Vec<u64>),
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

fn integer_key_unsigned(engine: &str, data_type: &str) -> Option<bool> {
    let data_type = data_type.trim().to_ascii_lowercase();
    match engine {
        "Postgres" if matches!(data_type.as_str(), "smallint" | "integer" | "bigint") => {
            Some(false)
        }
        "Sqlite" if data_type == "integer" => Some(false),
        "MySql" => {
            let mut words = data_type.split_ascii_whitespace();
            let name = words.next()?.split('(').next()?;
            if !matches!(
                name,
                "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint"
            ) {
                return None;
            }
            Some(words.any(|word| matches!(word, "unsigned" | "zerofill")))
        }
        _ => None,
    }
}

fn parse_bound(raw: Option<&str>, unsigned: bool) -> Result<Option<i128>> {
    let Some(raw) = raw else { return Ok(None) };
    let raw = raw.trim();
    let value = if raw.len() <= 21 {
        raw.parse::<i128>().ok()
    } else {
        None
    };
    let (min, max) = if unsigned {
        (0, u64::MAX as i128)
    } else {
        (i64::MIN as i128, i64::MAX as i128)
    };
    value
        .filter(|value| (min..=max).contains(value))
        .map(Some)
        .ok_or_else(|| anyhow!("Primary-key bounds must be whole numbers between {min} and {max}"))
}

fn range_predicate(
    table: &SchemaTable,
    engine: &str,
    range: Option<&PrimaryKeyRange>,
) -> Result<(String, RangeBounds)> {
    let Some(range) = range else {
        return Ok((String::new(), RangeBounds::Signed(vec![])));
    };
    let mut keys = table.columns.iter().filter(|column| column.is_primary_key);
    let key = keys
        .next()
        .filter(|key| key.name == range.column && keys.next().is_none());
    let (key, unsigned) = key.and_then(|key| integer_key_unsigned(engine, &key.data_type).map(|unsigned| (key, unsigned)))
        .ok_or_else(|| anyhow!("A range requires the current single-column integer primary key. Reload the tables if it changed."))?;
    let lower = parse_bound(range.lower.as_deref(), unsigned)?;
    let upper = parse_bound(range.upper.as_deref(), unsigned)?;
    if lower.is_none() && upper.is_none() {
        bail!("Provide at least one primary-key bound");
    }
    if matches!((lower, upper), (Some(lower), Some(upper)) if lower > upper) {
        bail!("Lower bound must be less than or equal to upper bound");
    }
    let key = quoted(&key.name, engine);
    let mut terms = Vec::with_capacity(3);
    if engine == "Sqlite" {
        // SQLite integer affinity can retain non-integer values in non-rowid keys.
        terms.push(format!("typeof({key}) = 'integer'"));
    }
    let mut values = Vec::with_capacity(2);
    for (operator, value) in [(">=", lower), ("<=", upper)] {
        if let Some(value) = value {
            values.push(value);
            let placeholder = if engine == "Postgres" {
                format!("${}", values.len())
            } else {
                "?".into()
            };
            terms.push(format!("{key} {operator} {placeholder}"));
        }
    }
    let bounds = if unsigned {
        RangeBounds::Unsigned(values.into_iter().map(|value| value as u64).collect())
    } else {
        RangeBounds::Signed(values.into_iter().map(|value| value as i64).collect())
    };
    Ok((format!(" WHERE {}", terms.join(" AND ")), bounds))
}

fn comparison_sql(
    table: &SchemaTable,
    engine: &str,
    limit: u32,
    range: Option<&PrimaryKeyRange>,
) -> Result<(String, Vec<String>, RangeBounds)> {
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
    let alias = quoted("__sqlmate_compare", engine);
    let order = primary_key
        .iter()
        // Sort by the original value, not the text-formatted output alias.
        .map(|key| format!("{alias}.{}", quoted(key, engine)))
        .collect::<Vec<_>>()
        .join(", ");
    let (predicate, bounds) = range_predicate(table, engine, range)?;
    Ok((
        format!(
            "SELECT {columns} FROM {relation} AS {alias}{predicate} ORDER BY {order} LIMIT {}",
            limit + 1
        ),
        primary_key,
        bounds,
    ))
}

pub async fn get_comparison_rows(
    manager: &ConnectionManager,
    connection_id: &Uuid,
    schema: Option<String>,
    table: String,
    limit: u32,
    range: Option<PrimaryKeyRange>,
) -> Result<ComparisonRows> {
    let _guard = manager.execution_guard(connection_id).await;
    let snapshot = get_schema_snapshot(manager, connection_id).await?;
    let metadata = snapshot
        .tables
        .iter()
        .find(|item| item.schema == schema && item.name == table)
        .ok_or_else(|| anyhow!("Table not found in the selected database"))?;
    let (sql, primary_key, bounds) =
        comparison_sql(metadata, &snapshot.engine, limit, range.as_ref())?;
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
    macro_rules! bind_signed {
        ($query:expr) => {{
            let RangeBounds::Signed(values) = &bounds else {
                bail!("Unsigned primary-key bounds are only supported for MySQL/MariaDB");
            };
            values
                .iter()
                .fold($query, |query, value| query.bind(*value))
        }};
    }
    macro_rules! read_rows {
        ($query:expr, $connection:expr) => {{
            let raw = $query.fetch_all($connection).await?;
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
        read_rows!(bind_signed!(sqlx::query(&sql)), &mut *tx);
    }
    if let Some(pool) = manager.get_mysql_pools().await.get(connection_id).cloned() {
        let mut connection = pool.acquire().await?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *connection)
            .await?;
        let mut tx = connection.begin().await?;
        let query = sqlx::query(&sql);
        let query = match &bounds {
            RangeBounds::Signed(values) => {
                values.iter().fold(query, |query, value| query.bind(*value))
            }
            RangeBounds::Unsigned(values) => {
                values.iter().fold(query, |query, value| query.bind(*value))
            }
        };
        read_rows!(query, &mut *tx);
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
        read_rows!(bind_signed!(sqlx::query(&sql)), &mut connection);
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
        let (sql, keys, _) = comparison_sql(&table, "Postgres", 100, None).unwrap();
        assert_eq!(keys, ["key\"id"]);
        assert!(sql.contains("FROM \"public\".\"odd\"\"name\""));
        assert!(sql.ends_with("ORDER BY \"__sqlmate_compare\".\"key\"\"id\" LIMIT 101"));
        assert!(comparison_sql(&table, "Postgres", 201, None).is_err());
        let (mysql, _, _) = comparison_sql(&table, "MySql", 2, None).unwrap();
        assert!(mysql.contains("CAST(`key\"id` AS CHAR)"));
        assert!(mysql.contains("LIMIT 3"));
    }

    #[test]
    fn range_sql_uses_placeholders_and_revalidates_the_current_key() {
        let mut table = SchemaTable {
            schema: Some("public".into()),
            name: "items".into(),
            columns: vec![SchemaColumn {
                name: "id".into(),
                data_type: "bigint".into(),
                is_nullable: false,
                default_value: None,
                is_primary_key: true,
            }],
        };
        let mut range = PrimaryKeyRange {
            column: "id".into(),
            lower: None,
            upper: Some("-9007199254740993".into()),
        };
        let (sql, _, values) = comparison_sql(&table, "Postgres", 1, Some(&range)).unwrap();
        assert!(sql.contains(r#"WHERE "id" <= $1 ORDER BY"#));
        assert!(!sql.contains("-9007199254740993"));
        assert_eq!(values, RangeBounds::Signed(vec![-9007199254740993]));
        range.column = "retired_id".into();
        assert!(comparison_sql(&table, "Postgres", 1, Some(&range)).is_err());

        table.schema = None;
        table.columns[0].data_type = "bigint(20) unsigned".into();
        range.column = "id".into();
        assert!(comparison_sql(&table, "MySql", 1, Some(&range)).is_err());
        range.upper = Some(u64::MAX.to_string());
        let (sql, _, values) = comparison_sql(&table, "MySql", 1, Some(&range)).unwrap();
        assert!(sql.contains("WHERE `id` <= ? ORDER BY"));
        assert_eq!(values, RangeBounds::Unsigned(vec![u64::MAX]));
    }
}
