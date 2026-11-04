use crate::core::{
    read_only_sql::validate_read_only_sql, FilterConfig, QueryResult, SidebarItem, SidebarItemType,
    TableColumnStructure, TableStructure,
};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use duckdb::{types::ValueRef, AccessMode, Config, Connection};
use serde_json::Value;
use std::{path::Path, time::Instant};
use tokio_util::sync::CancellationToken;

const MAX_RESULT_ROWS: usize = 10_000;

pub fn open(path: &str) -> Result<Connection> {
    let file = Path::new(path);
    if !file.is_file() {
        return Err(anyhow!("DuckDB file does not exist: {path}"));
    }
    let config = Config::default()
        .access_mode(AccessMode::ReadOnly)?
        .enable_external_access(false)?
        .enable_autoload_extension(false)?;
    Ok(Connection::open_with_flags(file, config)?)
}

pub async fn run<T: Send + 'static>(
    path: String,
    work: impl FnOnce(&Connection) -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(move || {
        let connection = open(&path)?;
        work(&connection)
    })
    .await?
}

pub async fn run_cancellable<T: Send + 'static>(
    path: String,
    token: CancellationToken,
    work: impl FnOnce(&Connection) -> Result<T> + Send + 'static,
) -> Result<Option<T>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut task = tokio::task::spawn_blocking(move || {
        let connection = open(&path)?;
        let _ = sender.send(connection.interrupt_handle());
        work(&connection)
    });
    let handle = match receiver.await {
        Ok(handle) => handle,
        Err(_) => return task.await?.map(Some),
    };
    tokio::select! {
        result = &mut task => result?.map(Some),
        _ = token.cancelled() => {
            handle.interrupt();
            let _ = task.await;
            Ok(None)
        }
    }
}

fn json_value(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Boolean(value) => Value::Bool(value),
        ValueRef::TinyInt(value) => Value::from(value),
        ValueRef::SmallInt(value) => Value::from(value),
        ValueRef::Int(value) => Value::from(value),
        ValueRef::BigInt(value) if value.unsigned_abs() > 9_007_199_254_740_991 => {
            Value::String(value.to_string())
        }
        ValueRef::BigInt(value) => Value::from(value),
        ValueRef::UTinyInt(value) => Value::from(value),
        ValueRef::USmallInt(value) => Value::from(value),
        ValueRef::UInt(value) => Value::from(value),
        ValueRef::UBigInt(value) if value > 9_007_199_254_740_991 => {
            Value::String(value.to_string())
        }
        ValueRef::UBigInt(value) => Value::from(value),
        ValueRef::Float(value) => Value::from(value as f64),
        ValueRef::Double(value) => Value::from(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::HugeInt(value) => Value::String(value.to_string()),
        ValueRef::UHugeInt(value) => Value::String(value.to_string()),
        ValueRef::Decimal(value) => Value::String(value.to_string()),
        ValueRef::Date32(days) => {
            let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
            epoch
                .checked_add_signed(Duration::days(days as i64))
                .map(|date| Value::String(date.to_string()))
                .unwrap_or(Value::Null)
        }
        ValueRef::Timestamp(unit, value) => {
            DateTime::<Utc>::from_timestamp_micros(unit.to_micros(value))
                .map(|time| Value::String(time.naive_utc().to_string()))
                .unwrap_or(Value::Null)
        }
        ValueRef::Time64(unit, value) => {
            let micros = unit.to_micros(value);
            u32::try_from(micros.div_euclid(1_000_000))
                .ok()
                .and_then(|seconds| {
                    NaiveTime::from_num_seconds_from_midnight_opt(
                        seconds,
                        (micros.rem_euclid(1_000_000) * 1_000) as u32,
                    )
                })
                .map(|time| Value::String(time.to_string()))
                .unwrap_or(Value::Null)
        }
        other => Value::String(format!("{other:?}")),
    }
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn quote_table(name: &str) -> String {
    name.split('.')
        .map(quote_ident)
        .collect::<Vec<_>>()
        .join(".")
}

fn literal(value: &Value) -> Result<String> {
    match value {
        Value::Null => Ok("NULL".into()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => Ok(format!("'{}'", value.replace('\'', "''"))),
        _ => Err(anyhow!("Unsupported keyset cursor")),
    }
}

pub fn query(
    connection: &Connection,
    sql: &str,
    limit: usize,
    offset: usize,
) -> Result<QueryResult> {
    validate_read_only_sql(sql).map_err(|error| anyhow!(error))?;
    let start = Instant::now();
    let statement = sql.trim().trim_end_matches(';').trim();
    let bounded = format!(
        "SELECT * FROM (\n{statement}\n) AS sqlmate_result LIMIT {} OFFSET {offset}",
        limit.min(MAX_RESULT_ROWS) + 1
    );
    let mut prepared = connection.prepare(&bounded)?;
    let mut cursor = prepared.query([])?;
    let columns = cursor
        .as_ref()
        .ok_or_else(|| anyhow!("DuckDB result metadata is unavailable"))?
        .column_names();
    let mut rows = Vec::new();
    let mut has_more = false;
    while let Some(row) = cursor.next()? {
        if rows.len() == limit.min(MAX_RESULT_ROWS) {
            has_more = true;
            break;
        }
        rows.push(
            (0..columns.len())
                .map(|index| row.get_ref(index).map(json_value))
                .collect::<duckdb::Result<Vec<_>>>()?,
        );
    }
    Ok(QueryResult {
        columns,
        rows,
        affected_rows: 0,
        execution_time_ms: start.elapsed().as_millis() as u64,
        total_count: None,
        page: None,
        page_size: None,
        has_more: Some(has_more),
    })
}

pub fn sidebar(connection: &Connection) -> Result<Vec<SidebarItem>> {
    let mut statement = connection.prepare("SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_schema, table_name")?;
    let items = statement.query_map([], |row| {
        let schema: String = row.get(0)?;
        let name: String = row.get(1)?;
        let kind: String = row.get(2)?;
        Ok(SidebarItem {
            name,
            schema: Some(schema),
            item_type: if kind == "VIEW" {
                SidebarItemType::View
            } else {
                SidebarItemType::Table
            },
        })
    })?;
    items
        .collect::<duckdb::Result<Vec<_>>>()
        .map_err(Into::into)
}

pub fn structure(connection: &Connection, table: &str) -> Result<TableStructure> {
    let (schema, name) = table
        .rsplit_once('.')
        .map_or(("main", table), |(schema, name)| (schema, name));
    let mut statement = connection.prepare("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position")?;
    let primary_keys: Vec<String> = connection.prepare("SELECT k.column_name FROM information_schema.key_column_usage k JOIN information_schema.table_constraints c ON c.constraint_name = k.constraint_name AND c.table_schema = k.table_schema AND c.table_name = k.table_name WHERE c.constraint_type = 'PRIMARY KEY' AND k.table_schema = ? AND k.table_name = ?")?
        .query_map([schema, name], |row| row.get(0))?.collect::<duckdb::Result<Vec<_>>>()?;
    let columns = statement
        .query_map([schema, name], |row| {
            let nullable: String = row.get(2)?;
            let column_name: String = row.get(0)?;
            Ok(TableColumnStructure {
                is_primary_key: primary_keys.contains(&column_name),
                name: column_name,
                data_type: row.get(1)?,
                is_nullable: nullable == "YES",
                default_value: row.get(3)?,
                comment: None,
            })
        })?
        .collect::<duckdb::Result<Vec<_>>>()?;
    if columns.is_empty() {
        return Err(anyhow!("Table not found: {table}"));
    }
    Ok(TableStructure {
        columns,
        indexes: vec![],
        constraints: vec![],
        foreign_keys: vec![],
    })
}

pub fn table_data(
    connection: &Connection,
    table: &str,
    limit: u32,
    offset: u32,
    filters: Vec<FilterConfig>,
    sort: Option<String>,
    direction: Option<String>,
    primary_keys: Vec<String>,
    seek: Option<Value>,
) -> Result<QueryResult> {
    if filters.iter().any(|filter| filter.enabled) {
        return Err(anyhow!("Filters are not yet supported for DuckDB tables"));
    }
    if seek.is_some() && (sort.is_some() || primary_keys.len() != 1) {
        return Err(anyhow!(
            "Keyset paging requires one primary key and default sort"
        ));
    }
    let mut order_terms = Vec::new();
    if let Some(column) = sort.as_deref().filter(|column| !column.is_empty()) {
        let direction = if direction.as_deref() == Some("DESC") {
            "DESC"
        } else {
            "ASC"
        };
        order_terms.push(format!("{} {direction}", quote_ident(column)));
    }
    for column in &primary_keys {
        if sort.as_deref() != Some(column.as_str()) {
            order_terms.push(format!("{} ASC", quote_ident(column)));
        }
    }
    let order_sql = if order_terms.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order_terms.join(", "))
    };
    let seek_sql = match seek {
        Some(value) if primary_keys.len() == 1 && direction.as_deref() != Some("DESC") => format!(
            " WHERE {} > {}",
            quote_ident(&primary_keys[0]),
            literal(&value)?
        ),
        Some(_) => return Err(anyhow!("Unsupported DuckDB keyset cursor")),
        None => String::new(),
    };
    let sql = format!(
        "SELECT * FROM {}{}{}",
        quote_table(table),
        seek_sql,
        order_sql
    );
    query(
        connection,
        &sql,
        limit.clamp(1, 1000) as usize,
        if seek_sql.is_empty() {
            offset as usize
        } else {
            0
        },
    )
}

pub fn count(connection: &Connection, table: &str) -> Result<u64> {
    let sql = format!("SELECT COUNT(*) FROM {}", quote_table(table));
    Ok(connection.query_row(&sql, [], |row| row.get::<_, i64>(0))? as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{
        connection_manager::ConnectionManager, execution_policy::SafetyMode,
        query_engine::QueryEngine, ConnectionConfig,
    };
    use serde_json::json;
    use uuid::Uuid;
    #[test]
    fn opens_existing_database_read_only_and_bounds_results() {
        let file =
            std::env::temp_dir().join(format!("sqlmate-duckdb-{}.duckdb", uuid::Uuid::new_v4()));
        {
            let connection = Connection::open(&file).unwrap();
            connection.execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY, name VARCHAR); INSERT INTO items VALUES (1, 'a'), (2, 'b'), (3, 'c')").unwrap();
        }
        let connection = open(file.to_str().unwrap()).unwrap();
        assert_eq!(sidebar(&connection).unwrap().len(), 1);
        let columns = structure(&connection, "items").unwrap().columns;
        assert_eq!(columns.len(), 2);
        assert!(columns[0].is_primary_key);
        let result = query(&connection, "SELECT * FROM items ORDER BY id", 2, 0).unwrap();
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.has_more, Some(true));
        assert_eq!(
            query(&connection, "SELECT * FROM items -- browse items", 2, 0)
                .unwrap()
                .rows
                .len(),
            2
        );
        assert_eq!(
            query(&connection, "SELECT * FROM items ORDER BY id", 2, 2)
                .unwrap()
                .has_more,
            Some(false)
        );
        assert_eq!(
            table_data(&connection, "items", 2, 0, vec![], None, None, vec![], None)
                .unwrap()
                .rows
                .len(),
            2
        );
        assert!(query(&connection, "DELETE FROM items", 10, 0).is_err());
        assert!(query(&connection, "SELECT * FROM read_csv('/etc/passwd')", 10, 0).is_err());
        assert!(connection
            .execute("INSERT INTO items VALUES (4, 'd')", [])
            .is_err());
        drop(connection);
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn table_browse_orders_by_every_composite_primary_key_column() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE parts(a INTEGER, b INTEGER, PRIMARY KEY(a, b)); \
                 INSERT INTO parts VALUES (1, 2), (1, 1), (2, 1)",
            )
            .unwrap();
        let result = table_data(
            &connection,
            "parts",
            3,
            0,
            vec![],
            None,
            None,
            vec!["a".into(), "b".into()],
            None,
        )
        .unwrap();
        assert_eq!(
            result.rows,
            vec![
                vec![json!(1), json!(1)],
                vec![json!(1), json!(2)],
                vec![json!(2), json!(1)]
            ]
        );
    }

    #[test]
    fn schema_qualified_browse_keeps_same_named_tables_separate() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE main.items(id INTEGER PRIMARY KEY, label VARCHAR); \
                 INSERT INTO main.items VALUES (1, 'current'); \
                 CREATE SCHEMA archive; \
                 CREATE TABLE archive.items(id INTEGER PRIMARY KEY, label VARCHAR); \
                 INSERT INTO archive.items VALUES (1, 'old')",
            )
            .unwrap();
        let items = sidebar(&connection).unwrap();
        assert!(items
            .iter()
            .any(|item| item.name == "items" && item.schema.as_deref() == Some("main")));
        assert!(items
            .iter()
            .any(|item| item.name == "items" && item.schema.as_deref() == Some("archive")));
        assert_eq!(
            structure(&connection, "archive.items")
                .unwrap()
                .columns
                .len(),
            2
        );
        let rows = table_data(
            &connection,
            "archive.items",
            10,
            0,
            vec![],
            None,
            None,
            vec!["id".into()],
            None,
        )
        .unwrap()
        .rows;
        assert_eq!(rows[0][1], json!("old"));
    }

    #[tokio::test]
    async fn connection_manager_routes_browse_profile_and_select_without_writes() {
        let file =
            std::env::temp_dir().join(format!("sqlmate-duckdb-route-{}.duckdb", Uuid::new_v4()));
        {
            let connection = Connection::open(&file).unwrap();
            connection.execute_batch("CREATE TABLE products(id INTEGER PRIMARY KEY, price DECIMAL(8, 2)); INSERT INTO products VALUES (1, 12.50), (2, 9.99)").unwrap();
        }
        let id = Uuid::new_v4();
        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "shop", "db_type": "DuckDb", "database": file.to_str().unwrap(),
            "host": null, "port": null, "username": null, "ssl_enabled": false,
            "ssh_enabled": false, "safety_mode": "Silent", "environment": "local"
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();
        assert_eq!(
            manager.execution_context(&id).await.unwrap().1,
            SafetyMode::Safe
        );
        assert!(manager
            .set_safety_mode(&id, SafetyMode::Silent)
            .await
            .is_err());
        assert_eq!(
            QueryEngine::get_sidebar_items(&manager, &id)
                .await
                .unwrap()
                .len(),
            1
        );
        let structure = QueryEngine::get_table_structure(&manager, &id, "products")
            .await
            .unwrap();
        assert!(structure.columns[0].is_primary_key);
        let page = QueryEngine::get_table_data(
            &manager,
            &id,
            "products",
            1,
            0,
            vec![],
            None,
            None,
            vec!["id".into()],
            None,
        )
        .await
        .unwrap();
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.has_more, Some(true));
        let next = QueryEngine::get_table_data(
            &manager,
            &id,
            "products",
            1,
            1,
            vec![],
            None,
            None,
            vec!["id".into()],
            Some(json!(1)),
        )
        .await
        .unwrap();
        assert_eq!(next.rows[0][0], json!(2));
        let sample = QueryEngine::get_table_data(
            &manager,
            &id,
            "products",
            100,
            0,
            vec![],
            None,
            None,
            vec!["id".into()],
            None,
        )
        .await
        .unwrap();
        assert_eq!(sample.rows.len(), 2);
        assert!(QueryEngine::execute_read_only_query(
            &manager,
            &id,
            "UPDATE products SET price = 0",
            None,
            None
        )
        .await
        .is_err());
        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(file).unwrap();
    }
}
