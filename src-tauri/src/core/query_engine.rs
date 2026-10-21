use crate::core::{
    connection_manager::ConnectionManager, query_parameters::ParameterValue,
    read_only_sql::validate_read_only_sql, AiSchemaTable, DatabaseType, FilterConfig,
    ForeignKeyStructure, QueryPlanResult, QueryResult, SidebarItem, SidebarItemType,
    StreamingBatch, StreamingComplete, StreamingMetadata, TableColumnStructure,
    TableConstraintStructure, TableIndexStructure, TableMetadata, TableStructure,
};
use anyhow::{anyhow, Result};
use futures::{StreamExt, TryStreamExt};
use serde_json::Value;
use sqlx::{Acquire, Column, ConnectOptions, Executor, Row, Statement, TypeInfo, ValueRef};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;
use tauri::Emitter;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const MAX_QUERY_RESULT_ROWS: u64 = 10_000;

struct PendingExport {
    temporary: PathBuf,
    destination: PathBuf,
}

impl PendingExport {
    fn create(file_path: &str) -> Result<(Self, File)> {
        let destination = PathBuf::from(file_path);
        let filename = destination
            .file_name()
            .ok_or_else(|| anyhow!("Invalid export path"))?;
        let temporary = destination.with_file_name(format!(
            ".{}.{}.tmp",
            filename.to_string_lossy(),
            Uuid::new_v4()
        ));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        Ok((
            Self {
                temporary,
                destination,
            },
            file,
        ))
    }

    fn commit(self) -> Result<()> {
        #[cfg(windows)]
        std::fs::copy(&self.temporary, &self.destination)?;
        #[cfg(not(windows))]
        std::fs::rename(&self.temporary, &self.destination)?;
        Ok(())
    }
}

impl Drop for PendingExport {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.temporary);
    }
}

fn mysql_type_is_boolean(type_name: &str, type_display: &str) -> bool {
    type_name == "bool"
        || type_name == "boolean"
        || (type_name == "tinyint" && type_display.to_uppercase().contains("TINYINT(1)"))
}

fn json_boolean_number(value: bool) -> Value {
    Value::Number(serde_json::Number::from(u8::from(value)))
}

enum TableExportWriter<W: Write> {
    Csv(csv::Writer<W>),
    Json {
        writer: W,
        columns: Vec<String>,
        first: bool,
    },
    Sql {
        writer: W,
        insert_prefix: String,
    },
}

impl<W: Write> TableExportWriter<W> {
    fn new(
        format: &str,
        mut writer: W,
        columns: Vec<String>,
        table: &str,
        db_type: &str,
    ) -> Result<Self> {
        match format {
            "csv" => {
                let mut csv = csv::Writer::from_writer(writer);
                csv.write_record(&columns)?;
                Ok(Self::Csv(csv))
            }
            "json" => {
                writer.write_all(b"[")?;
                Ok(Self::Json {
                    writer,
                    columns,
                    first: true,
                })
            }
            "sql" => {
                let quote = if db_type == "mysql" { '`' } else { '"' };
                let quoted = |name: &str| {
                    format!(
                        "{quote}{}{quote}",
                        name.replace(quote, &quote.to_string().repeat(2))
                    )
                };
                let insert_prefix = format!(
                    "INSERT INTO {} ({}) VALUES (",
                    quoted(table),
                    columns
                        .iter()
                        .map(|column| quoted(column))
                        .collect::<Vec<_>>()
                        .join(", "),
                );
                Ok(Self::Sql {
                    writer,
                    insert_prefix,
                })
            }
            _ => Err(anyhow!("Unsupported export format")),
        }
    }

    fn write_row(&mut self, row: Vec<Value>) -> Result<()> {
        match self {
            Self::Csv(writer) => {
                let record = row
                    .into_iter()
                    .map(|value| match value {
                        Value::Null => String::new(),
                        Value::String(value) => value,
                        Value::Number(value) => value.to_string(),
                        Value::Bool(value) => value.to_string(),
                        value => value.to_string(),
                    })
                    .collect::<Vec<_>>();
                writer.write_record(&record)?;
            }
            Self::Json {
                writer,
                columns,
                first,
            } => {
                if !*first {
                    writer.write_all(b",")?;
                }
                let object = columns
                    .iter()
                    .cloned()
                    .zip(row)
                    .collect::<serde_json::Map<String, Value>>();
                serde_json::to_writer(writer, &object)?;
                *first = false;
            }
            Self::Sql {
                writer,
                insert_prefix,
            } => {
                writer.write_all(insert_prefix.as_bytes())?;
                for (index, value) in row.into_iter().enumerate() {
                    if index > 0 {
                        writer.write_all(b", ")?;
                    }
                    match value {
                        Value::Null => writer.write_all(b"NULL")?,
                        Value::String(value) => write!(writer, "'{}'", value.replace("'", "''"))?,
                        Value::Number(value) => write!(writer, "{value}")?,
                        Value::Bool(value) => write!(writer, "{value}")?,
                        value => write!(writer, "'{}'", value.to_string().replace("'", "''"))?,
                    }
                }
                writer.write_all(b");\n")?;
            }
        }
        Ok(())
    }

    fn finish(mut self) -> Result<()> {
        match &mut self {
            Self::Csv(writer) => writer.flush()?,
            Self::Json { writer, .. } => {
                writer.write_all(b"]")?;
                writer.flush()?;
            }
            Self::Sql { writer, .. } => writer.flush()?,
        }
        Ok(())
    }
}

fn group_foreign_keys(
    columns: impl IntoIterator<Item = (String, String, String, String)>,
) -> Vec<ForeignKeyStructure> {
    let mut keys = BTreeMap::<String, ForeignKeyStructure>::new();
    let mut incomplete = BTreeSet::new();
    for (name, source_column, target_table, target_column) in columns {
        if target_column.is_empty() {
            incomplete.insert(name);
            continue;
        }
        let key = keys
            .entry(name.clone())
            .or_insert_with(|| ForeignKeyStructure {
                name,
                source_columns: Vec::new(),
                target_table,
                target_columns: Vec::new(),
            });
        key.source_columns.push(source_column);
        key.target_columns.push(target_column);
    }
    keys.retain(|name, _| !incomplete.contains(name));
    keys.into_values().collect()
}

fn build_explain_sql(sql: &str, database_type: &DatabaseType) -> Result<String> {
    validate_read_only_sql(sql).map_err(anyhow::Error::msg)?;
    let statement = sql.trim().trim_end_matches(';').trim_end();
    let prefix = match database_type {
        DatabaseType::Postgres => "EXPLAIN (FORMAT JSON)",
        DatabaseType::MySql => "EXPLAIN",
        DatabaseType::Sqlite => "EXPLAIN QUERY PLAN",
    };
    Ok(format!("{prefix} {statement}"))
}

#[cfg(test)]
mod tests {
    use super::{
        build_browse_order_clause, build_explain_sql, build_seek_predicate, build_where_clause,
        group_foreign_keys, json_boolean_number, mysql_type_is_boolean, with_seek_predicate,
        PendingExport, QueryEngine, TableExportWriter,
    };
    use crate::core::{
        connection_manager::ConnectionManager, ConnectionConfig, DatabaseType, FilterConfig,
    };
    use serde_json::{json, Value};
    use uuid::Uuid;

    #[test]
    fn table_browse_uses_primary_key_as_stable_tie_breaker() {
        let keys = vec!["id".to_string()];
        assert_eq!(
            build_browse_order_clause(None, None, &keys, "mysql"),
            "ORDER BY `id` ASC"
        );
        assert_eq!(
            build_browse_order_clause(Some("name"), Some("DESC"), &keys, "postgres"),
            "ORDER BY \"name\" DESC, \"id\" ASC"
        );
        assert_eq!(
            build_browse_order_clause(Some("id"), Some("DESC"), &keys, "sqlite"),
            "ORDER BY \"id\" DESC"
        );
        assert_eq!(
            with_seek_predicate("WHERE \"status\" = 1".into(), Some("\"id\" > 9".into())),
            "WHERE \"status\" = 1 AND \"id\" > 9"
        );
        assert_eq!(
            build_seek_predicate(&json!(9), "id", "sqlite").unwrap(),
            "\"id\" > 9"
        );
        assert!(build_seek_predicate(&json!("9 OR 1=1"), "id", "mysql").is_err());
    }

    #[test]
    fn streamed_table_export_preserves_csv_json_and_sql_values() {
        let columns = vec!["id".to_string(), "name".to_string(), "note".to_string()];
        let row = vec![json!(1), json!("O'Brien"), Value::Null];
        for format in ["csv", "json", "sql"] {
            let mut output = Vec::new();
            let mut writer =
                TableExportWriter::new(format, &mut output, columns.clone(), "people", "mysql")
                    .unwrap();
            writer.write_row(row.clone()).unwrap();
            writer.finish().unwrap();
            let content = String::from_utf8(output).unwrap();
            match format {
                "csv" => assert_eq!(content, "id,name,note\n1,O'Brien,\n"),
                "json" => assert_eq!(
                    serde_json::from_str::<Value>(&content).unwrap(),
                    json!([{"id": 1, "name": "O'Brien", "note": null}])
                ),
                "sql" => assert_eq!(
                    content,
                    "INSERT INTO `people` (`id`, `name`, `note`) VALUES (1, 'O''Brien', NULL);\n"
                ),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn empty_json_export_is_valid() {
        let mut output = Vec::new();
        TableExportWriter::new("json", &mut output, vec!["id".into()], "people", "sqlite")
            .unwrap()
            .finish()
            .unwrap();
        assert_eq!(String::from_utf8(output).unwrap(), "[]");
    }

    #[test]
    fn failed_stream_keeps_the_previous_export_and_removes_partial_file() {
        use std::io::Write;

        let path =
            std::env::temp_dir().join(format!("sqlmate-export-abort-{}.json", Uuid::new_v4()));
        std::fs::write(&path, b"previous export").unwrap();
        let (pending, mut file) = PendingExport::create(path.to_str().unwrap()).unwrap();
        let temporary = pending.temporary.clone();
        file.write_all(b"incomplete").unwrap();
        drop(file);
        drop(pending);
        assert_eq!(std::fs::read(&path).unwrap(), b"previous export");
        assert!(!temporary.exists());
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn sqlite_progress_handler_interrupts_a_cancelled_statement() {
        use sqlx::ConnectOptions;
        use tokio_util::sync::CancellationToken;

        let mut conn = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(":memory:")
            .connect()
            .await
            .unwrap();
        let token = CancellationToken::new();
        {
            let progress_token = token.clone();
            let mut handle = conn.lock_handle().await.unwrap();
            handle.set_progress_handler(1000, move || !progress_token.is_cancelled());
        }
        token.cancel();
        let result = sqlx::query_scalar::<_, i64>(
            "WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 1000000) SELECT sum(n) FROM sequence",
        )
        .fetch_one(&mut conn)
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn sqlite_browse_keyset_paging_survives_an_insert_before_the_cursor() {
        use sqlx::{ConnectOptions, Executor};

        let id = Uuid::new_v4();
        let path = std::env::temp_dir().join(format!("sqlmate-browse-{id}.db"));
        let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap();
        setup
            .execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
            .await
            .unwrap();
        setup
            .execute("INSERT INTO items VALUES (2, 'second'), (3, 'third'), (4, 'fourth')")
            .await
            .unwrap();
        drop(setup);

        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "test", "db_type": "Sqlite",
            "database": path.to_string_lossy(), "ssl_enabled": false, "ssh_enabled": false,
            "safety_mode": "Silent"
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();
        let keys = vec!["id".to_string()];
        let first = QueryEngine::get_table_data(
            &manager,
            &id,
            "items",
            2,
            0,
            vec![],
            None,
            None,
            keys.clone(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(first.has_more, Some(true));
        assert_eq!(first.rows[0][0], json!(2));
        assert_eq!(first.rows[1][0], json!(3));

        QueryEngine::execute_query(
            &manager,
            &id,
            "INSERT INTO items VALUES (1, 'first')",
            None,
            None,
        )
        .await
        .unwrap();
        let second = QueryEngine::get_table_data(
            &manager,
            &id,
            "items",
            2,
            2,
            vec![],
            None,
            None,
            keys,
            Some(json!(3)),
        )
        .await
        .unwrap();
        assert_eq!(second.rows.len(), 1);
        assert_eq!(second.rows[0][0], json!(4));
        assert_eq!(second.has_more, Some(false));

        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn sqlite_table_export_streams_rows_and_keeps_empty_csv_headers() {
        use sqlx::{ConnectOptions, Executor};

        let id = Uuid::new_v4();
        let db_path = std::env::temp_dir().join(format!("sqlmate-export-{id}.db"));
        let export_path = std::env::temp_dir().join(format!("sqlmate-export-{id}.csv"));
        let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap();
        setup
            .execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
            .await
            .unwrap();
        setup
            .execute("INSERT INTO items (name) VALUES ('first'), ('second')")
            .await
            .unwrap();
        drop(setup);

        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "test", "db_type": "Sqlite",
            "database": db_path.to_string_lossy(), "ssl_enabled": false, "ssh_enabled": false,
            "safety_mode": "Silent"
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();

        let count = QueryEngine::export_table_data(
            &manager,
            &id,
            "items",
            vec![],
            None,
            None,
            "csv",
            export_path.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(count, 2);
        let csv = std::fs::read_to_string(&export_path).unwrap();
        assert!(csv.starts_with("id,name\n"));
        assert!(csv.contains("1,first\n"));

        let empty_filter = FilterConfig {
            id: "none".into(),
            column: "id".into(),
            operator: "=".into(),
            value: "999".into(),
            enabled: true,
        };
        let count = QueryEngine::export_table_data(
            &manager,
            &id,
            "items",
            vec![empty_filter],
            None,
            None,
            "csv",
            export_path.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(count, 0);
        assert_eq!(std::fs::read_to_string(&export_path).unwrap(), "id,name\n");

        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(export_path).unwrap();
        std::fs::remove_file(db_path).unwrap();
    }

    #[test]
    fn recognizes_mariadb_boolean_types() {
        assert!(mysql_type_is_boolean("boolean", "BOOLEAN"));
        assert!(mysql_type_is_boolean("tinyint", "TINYINT(1)"));
        assert!(!mysql_type_is_boolean("tinyint", "TINYINT(4)"));
    }

    #[test]
    fn displays_mysql_booleans_as_zero_or_one() {
        assert_eq!(json_boolean_number(false), json!(0));
        assert_eq!(json_boolean_number(true), json!(1));
    }

    #[test]
    fn incomplete_composite_reference_is_not_navigable() {
        let keys = group_foreign_keys([
            (
                "fk".into(),
                "tenant_id".into(),
                "tenants".into(),
                "id".into(),
            ),
            ("fk".into(), "region_id".into(), "tenants".into(), "".into()),
        ]);
        assert!(keys.is_empty());
    }

    #[test]
    fn table_filters_never_insert_raw_in_values_or_mysql_backslashes() {
        let filter = |operator: &str, value: &str| FilterConfig {
            id: "1".to_string(),
            column: "id".to_string(),
            operator: operator.to_string(),
            value: value.to_string(),
            enabled: true,
        };
        assert_eq!(
            build_where_clause(vec![filter("IN", "1, 2); DELETE FROM users; --")], "mysql"),
            "WHERE `id` IN ('1', '2); DELETE FROM users; --')"
        );
        assert_eq!(
            build_where_clause(vec![filter("=", "\\' OR 1=1 --")], "mysql"),
            "WHERE `id` = '\\\\'' OR 1=1 --'"
        );
        assert_eq!(
            build_where_clause(vec![filter("=", "a\\b")], "sqlite"),
            "WHERE \"id\" = 'a\\b'"
        );
        assert_eq!(
            build_where_clause(vec![filter("IN", "  ,  ")], "postgres"),
            "WHERE 1 = 0"
        );
    }

    #[test]
    fn explain_is_plan_only_and_rejects_multiple_or_write_statements() {
        assert_eq!(
            build_explain_sql(" SELECT * FROM items; ", &DatabaseType::Postgres).unwrap(),
            "EXPLAIN (FORMAT JSON) SELECT * FROM items"
        );
        assert_eq!(
            build_explain_sql("SELECT * FROM items", &DatabaseType::MySql).unwrap(),
            "EXPLAIN SELECT * FROM items"
        );
        assert_eq!(
            build_explain_sql("SELECT * FROM items", &DatabaseType::Sqlite).unwrap(),
            "EXPLAIN QUERY PLAN SELECT * FROM items"
        );
        for sql in [
            "DELETE FROM items",
            "SELECT * FROM items; DELETE FROM items",
            "SELECT * FROM items INTO OUTFILE '/tmp/out'",
        ] {
            assert!(
                build_explain_sql(sql, &DatabaseType::Postgres).is_err(),
                "{sql}"
            );
        }
    }

    #[tokio::test]
    async fn sqlite_safe_query_reads_but_cannot_write() {
        use sqlx::{ConnectOptions, Executor};

        let id = Uuid::new_v4();
        let path = std::env::temp_dir().join(format!("sqlmate-read-only-{id}.db"));
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let mut setup = options.connect().await.unwrap();
        setup
            .execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)")
            .await
            .unwrap();
        setup
            .execute("INSERT INTO items (value) VALUES ('original')")
            .await
            .unwrap();
        drop(setup);

        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id,
            "name": "test",
            "db_type": "Sqlite",
            "database": path.to_string_lossy(),
            "ssl_enabled": false,
            "ssh_enabled": false,
            "safety_mode": "Safe"
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();

        let result = QueryEngine::execute_read_only_query(
            &manager,
            &id,
            "SELECT value FROM items",
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.rows, vec![vec![json!("original")]]);
        let empty = QueryEngine::execute_read_only_query(
            &manager,
            &id,
            "SELECT value FROM items WHERE 1 = 0",
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(empty.columns, vec!["value"]);
        assert!(empty.rows.is_empty());
        assert!(QueryEngine::execute_read_only_query(
            &manager,
            &id,
            "UPDATE items SET value = 'changed'",
            None,
            None
        )
        .await
        .is_err());

        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn sqlite_structure_exposes_single_and_composite_foreign_keys() {
        use sqlx::{ConnectOptions, Executor};

        let id = Uuid::new_v4();
        let path = std::env::temp_dir().join(format!("sqlmate-foreign-keys-{id}.db"));
        let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap();
        setup
            .execute("CREATE TABLE accounts (id INTEGER PRIMARY KEY)")
            .await
            .unwrap();
        setup
            .execute(
                "CREATE TABLE groups (tenant_id INTEGER, id INTEGER, PRIMARY KEY (tenant_id, id))",
            )
            .await
            .unwrap();
        setup.execute("CREATE TABLE memberships (account_id INTEGER REFERENCES accounts, tenant_id INTEGER, group_id INTEGER, FOREIGN KEY (tenant_id, group_id) REFERENCES groups)").await.unwrap();
        drop(setup);

        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "test", "db_type": "Sqlite",
            "database": path.to_string_lossy(), "ssl_enabled": false,
            "ssh_enabled": false
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();

        let structure = QueryEngine::get_table_structure(&manager, &id, "memberships")
            .await
            .unwrap();
        assert!(structure
            .foreign_keys
            .iter()
            .any(|key| key.source_columns == ["account_id"]
                && key.target_table == "accounts"
                && key.target_columns == ["id"]));
        assert!(structure
            .foreign_keys
            .iter()
            .any(|key| key.source_columns == ["tenant_id", "group_id"]
                && key.target_table == "groups"
                && key.target_columns == ["tenant_id", "id"]));

        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn sqlite_explain_returns_a_plan_without_running_the_statement() {
        use sqlx::{ConnectOptions, Executor};

        let id = Uuid::new_v4();
        let path = std::env::temp_dir().join(format!("sqlmate-explain-{id}.db"));
        let mut setup = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .connect()
            .await
            .unwrap();
        setup
            .execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)")
            .await
            .unwrap();
        setup
            .execute("INSERT INTO items (value) VALUES ('original')")
            .await
            .unwrap();
        drop(setup);

        let config: ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "test", "db_type": "Sqlite",
            "database": path.to_string_lossy(), "ssl_enabled": false,
            "ssh_enabled": false, "safety_mode": "Safe"
        }))
        .unwrap();
        let manager = ConnectionManager::new();
        manager.connect(config, None).await.unwrap();

        let result =
            QueryEngine::explain_query(&manager, &id, "SELECT value FROM items WHERE id = 1;")
                .await
                .unwrap();
        assert_eq!(result.database_type, "Sqlite");
        assert!(result
            .plan
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["detail"].as_str().unwrap().contains("items")));
        assert!(
            QueryEngine::explain_query(&manager, &id, "DELETE FROM items")
                .await
                .is_err()
        );
        let mut check = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .read_only(true)
            .connect()
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
            .fetch_one(&mut check)
            .await
            .unwrap();
        assert_eq!(count, 1);
        drop(check);

        manager.disconnect(&id).await.unwrap();
        std::fs::remove_file(path).unwrap();
    }
}

fn type_name_is_text(name: &str) -> bool {
    name == "text"
        || name.contains("char")
        || name == "name"
        || name == "citext"
        || name == "json"
        || name == "jsonb"
        || name == "enum"
}

fn wrap_pagination(sql: &str, limit: u32, offset: u32) -> String {
    let trimmed = sql.trim();
    if trimmed.to_uppercase().starts_with("SELECT") {
        format!(
            "SELECT * FROM ({}) AS __sqlmate_q LIMIT {} OFFSET {}",
            trimmed.trim_end_matches(';'),
            limit,
            offset
        )
    } else {
        trimmed.to_string()
    }
}

fn wrap_count(sql: &str) -> String {
    let trimmed = sql.trim();
    if trimmed.to_uppercase().starts_with("SELECT") {
        format!(
            "SELECT COUNT(*) FROM ({}) AS __sqlmate_count_q",
            trimmed.trim_end_matches(';')
        )
    } else {
        "".to_string()
    }
}

fn sidebar_item_type_from_table_type(table_type: &str) -> SidebarItemType {
    if table_type.eq_ignore_ascii_case("VIEW") {
        SidebarItemType::View
    } else {
        SidebarItemType::Table
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
                    if let Ok(b) = $row.try_get::<bool, usize>(i) {
                        Value::Bool(b)
                    } else {
                        Value::Null
                    }
                } else if type_name == "uuid" {
                    if let Ok(u) = $row.try_get::<uuid::Uuid, usize>(i) {
                        Value::String(u.to_string())
                    } else {
                        Value::String("Invalid UUID".to_string())
                    }
                } else if type_name.contains("int") || type_name == "serial" || type_name == "year"
                {
                    if let Ok(n) = $row.try_get::<i64, usize>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i32, usize>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i16, usize>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i8, usize>(i) {
                        Value::Number(serde_json::Number::from(n))
                    } else {
                        Value::String(format!("NumError({})", type_name))
                    }
                } else if type_name.contains("float")
                    || type_name == "real"
                    || type_name == "double"
                    || type_name == "numeric"
                    || type_name == "decimal"
                {
                    if let Ok(f) = $row.try_get::<f64, usize>(i) {
                        serde_json::Number::from_f64(f)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    } else if let Ok(f) = $row.try_get::<f32, usize>(i) {
                        serde_json::Number::from_f64(f as f64)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    } else if let Ok(d) = $row.try_get::<rust_decimal::Decimal, usize>(i) {
                        Value::String(d.to_string())
                    } else {
                        Value::Null
                    }
                } else if type_name_is_text(&type_name) {
                    if let Ok(s) = $row.try_get::<String, usize>(i) {
                        Value::String(s)
                    } else {
                        Value::String("".to_string())
                    }
                } else if type_name.contains("time") || type_name == "date" {
                    if let Ok(dt) = $row.try_get::<chrono::DateTime<chrono::Utc>, usize>(i) {
                        Value::String(dt.to_rfc3339())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDateTime, usize>(i) {
                        Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDate, usize>(i) {
                        Value::String(dt.to_string())
                    } else if let Ok(t) = $row.try_get::<chrono::NaiveTime, usize>(i) {
                        Value::String(t.to_string())
                    } else {
                        if let Ok(s) = $row.try_get::<String, usize>(i) {
                            Value::String(s)
                        } else {
                            Value::String("Invalid Date".to_string())
                        }
                    }
                } else if type_name.contains("bytea") {
                    if let Ok(bytes) = $row.try_get::<Vec<u8>, usize>(i) {
                        let hex_string: String = bytes
                            .iter()
                            .map(|b| format!("{:02x}", b))
                            .collect::<String>();
                        Value::String(format!("0x{}", hex_string))
                    } else {
                        Value::String(format!("BinaryErr({})", type_name))
                    }
                } else {
                    if let Ok(s) = $row.try_get::<String, usize>(i) {
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
            let val: Value = if Row::try_get_raw($row, i as usize)
                .map(|v| v.is_null())
                .unwrap_or(true)
            {
                Value::Null
            } else {
                let type_info = $row.column(i as usize).type_info();
                let type_name = type_info.name().to_lowercase();
                if mysql_type_is_boolean(&type_name, &type_info.to_string()) {
                    if let Ok(b) = $row.try_get::<bool, usize>(i as usize) {
                        json_boolean_number(b)
                    } else if let Ok(v) = $row.try_get::<i8, usize>(i as usize) {
                        json_boolean_number(v != 0)
                    } else if let Ok(v) = $row.try_get::<u8, usize>(i as usize) {
                        json_boolean_number(v != 0)
                    } else {
                        Value::Null
                    }
                } else if type_name.contains("int") || type_name == "serial" || type_name == "year"
                {
                    if let Ok(n) = $row.try_get::<i64, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i32, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i16, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i8, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<u64, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<u32, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else {
                        Value::String(format!("NumError({})", type_name))
                    }
                } else if type_name.contains("float")
                    || type_name == "real"
                    || type_name == "double"
                    || type_name == "numeric"
                    || type_name == "decimal"
                {
                    if let Ok(f) = $row.try_get::<f64, usize>(i as usize) {
                        serde_json::Number::from_f64(f)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    } else if let Ok(f) = $row.try_get::<f32, usize>(i as usize) {
                        serde_json::Number::from_f64(f as f64)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    } else if let Ok(d) = $row.try_get::<rust_decimal::Decimal, usize>(i as usize) {
                        Value::String(d.to_string())
                    } else {
                        Value::Null
                    }
                } else if type_name_is_text(&type_name) {
                    if let Ok(s) = $row.try_get::<String, usize>(i as usize) {
                        Value::String(s)
                    } else {
                        Value::String("".to_string())
                    }
                } else if type_name.contains("time")
                    || type_name == "date"
                    || type_name == "timestamp"
                {
                    if let Ok(dt) = $row.try_get::<chrono::DateTime<chrono::Utc>, usize>(i as usize)
                    {
                        Value::String(dt.to_rfc3339())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDateTime, usize>(i as usize)
                    {
                        Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    } else if let Ok(dt) = $row.try_get::<chrono::NaiveDate, usize>(i as usize) {
                        Value::String(dt.to_string())
                    } else if let Ok(t) = $row.try_get::<chrono::NaiveTime, usize>(i as usize) {
                        Value::String(t.to_string())
                    } else {
                        if let Ok(s) = $row.try_get::<String, usize>(i as usize) {
                            Value::String(s)
                        } else {
                            Value::String("Invalid Date".to_string())
                        }
                    }
                } else if type_name.contains("blob") || type_name.contains("binary") {
                    if let Ok(bytes) = $row.try_get::<Vec<u8>, usize>(i as usize) {
                        let hex_string: String = bytes
                            .iter()
                            .map(|b| format!("{:02x}", b))
                            .collect::<String>();
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
                    if let Ok(s) = $row.try_get::<String, usize>(i as usize) {
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
            let val: Value = if Row::try_get_raw($row, i as usize)
                .map(|v| v.is_null())
                .unwrap_or(true)
            {
                Value::Null
            } else {
                let type_name = $row.column(i as usize).type_info().name().to_lowercase();
                if type_name == "bool" || type_name == "boolean" {
                    if let Ok(b) = $row.try_get::<bool, usize>(i as usize) {
                        Value::Bool(b)
                    } else {
                        Value::Null
                    }
                } else if type_name.contains("int") || type_name == "integer" {
                    if let Ok(n) = $row.try_get::<i64, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i32, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i16, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else if let Ok(n) = $row.try_get::<i8, usize>(i as usize) {
                        Value::Number(serde_json::Number::from(n))
                    } else {
                        Value::String(format!("NumError({})", type_name))
                    }
                } else if type_name.contains("float")
                    || type_name == "real"
                    || type_name == "double"
                {
                    if let Ok(f) = $row.try_get::<f64, usize>(i as usize) {
                        serde_json::Number::from_f64(f)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    } else {
                        Value::Null
                    }
                } else if type_name_is_text(&type_name) {
                    if let Ok(s) = $row.try_get::<String, usize>(i as usize) {
                        Value::String(s)
                    } else {
                        Value::String("".to_string())
                    }
                } else if type_name.contains("blob") {
                    if let Ok(bytes) = $row.try_get::<Vec<u8>, usize>(i as usize) {
                        let hex_string: String = bytes
                            .iter()
                            .map(|b| format!("{:02x}", b))
                            .collect::<String>();
                        Value::String(format!("0x{}", hex_string))
                    } else {
                        Value::String("Blob Error".to_string())
                    }
                } else {
                    if let Ok(s) = $row.try_get::<String, usize>(i as usize) {
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

    let conditions: Vec<String> = filters
        .iter()
        .filter(|f| f.enabled)
        .map(|f| {
            let col = match db_type {
                "mysql" => format!("`{}`", f.column.replace("`", "``")),
                _ => format!("\"{}\"", f.column.replace("\"", "\"\"")),
            };

            let val = &f.value;
            let quote_value = |value: &str| {
                let escaped = if db_type == "sqlite" {
                    value.replace('\'', "''")
                } else {
                    value.replace('\\', "\\\\").replace('\'', "''")
                };
                if db_type == "postgres" {
                    format!("E'{}'", escaped)
                } else {
                    format!("'{}'", escaped)
                }
            };

            match f.operator.as_str() {
                "=" => format!("{} = {}", col, quote_value(val)),
                "!=" => format!("{} != {}", col, quote_value(val)),
                ">" => format!("{} > {}", col, quote_value(val)),
                "<" => format!("{} < {}", col, quote_value(val)),
                ">=" => format!("{} >= {}", col, quote_value(val)),
                "<=" => format!("{} <= {}", col, quote_value(val)),
                "Contains" | "LIKE" => {
                    format!("{} LIKE {}", col, quote_value(&format!("%{}%", val)))
                }
                "Starts With" | "ILIKE" => {
                    if db_type == "postgres" && f.operator == "ILIKE" {
                        format!("{} ILIKE {}", col, quote_value(&format!("{}%", val)))
                    } else {
                        format!("{} LIKE {}", col, quote_value(&format!("{}%", val)))
                    }
                }
                "Ends With" => format!("{} LIKE {}", col, quote_value(&format!("%{}", val))),
                "IN" => {
                    let values = val
                        .split(',')
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .map(|item| quote_value(item.trim_matches('\'')))
                        .collect::<Vec<_>>();
                    if values.is_empty() {
                        "1 = 0".to_string()
                    } else {
                        format!("{} IN ({})", col, values.join(", "))
                    }
                }
                "IS NULL" => format!("{} IS NULL", col),
                "IS NOT NULL" => format!("{} IS NOT NULL", col),
                _ => format!("{} = {}", col, quote_value(val)),
            }
        })
        .collect();

    if conditions.is_empty() {
        return String::new();
    }

    format!("WHERE {}", conditions.join(" AND "))
}

fn build_order_clause(
    sort_column: Option<String>,
    sort_direction: Option<String>,
    db_type: &str,
) -> String {
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
        }
        _ => String::new(),
    }
}

fn quote_browse_column(name: &str, db_type: &str) -> String {
    if db_type == "mysql" {
        format!("`{}`", name.replace('`', "``"))
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

fn build_browse_order_clause(
    sort_column: Option<&str>,
    sort_direction: Option<&str>,
    primary_keys: &[String],
    db_type: &str,
) -> String {
    let mut terms = Vec::new();
    if let Some(column) = sort_column.filter(|column| !column.is_empty()) {
        let direction = if sort_direction == Some("DESC") {
            "DESC"
        } else {
            "ASC"
        };
        terms.push(format!(
            "{} {direction}",
            quote_browse_column(column, db_type)
        ));
    }
    for column in primary_keys {
        if sort_column != Some(column.as_str()) {
            terms.push(format!("{} ASC", quote_browse_column(column, db_type)));
        }
    }
    if terms.is_empty() {
        String::new()
    } else {
        format!("ORDER BY {}", terms.join(", "))
    }
}

fn build_seek_predicate(value: &Value, primary_key: &str, db_type: &str) -> Result<String> {
    // JSON integers are the only cursors accepted here. Strings need bound parameters
    // and collation-specific ordering before they can be used safely.
    let literal = match value {
        Value::Number(value) if value.is_i64() || value.is_u64() => value.to_string(),
        _ => {
            return Err(anyhow!(
                "This primary-key value cannot be used as a page cursor"
            ))
        }
    };
    Ok(format!(
        "{} > {literal}",
        quote_browse_column(primary_key, db_type)
    ))
}

fn with_seek_predicate(where_clause: String, predicate: Option<String>) -> String {
    match predicate {
        Some(predicate) if where_clause.is_empty() => format!("WHERE {predicate}"),
        Some(predicate) => format!("{where_clause} AND {predicate}"),
        None => where_clause,
    }
}

async fn cancel_postgres_statement(pool: &sqlx::PgPool, backend_pid: i32) {
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        sqlx::query_scalar::<_, bool>("SELECT pg_cancel_backend($1)")
            .bind(backend_pid)
            .fetch_one(pool),
    )
    .await;
}

async fn cancel_mysql_statement(pool: &sqlx::MySqlPool, connection_id: u64) {
    let sql = format!("KILL QUERY {connection_id}");
    let _ = tokio::time::timeout(Duration::from_secs(2), sqlx::query(&sql).execute(pool)).await;
}

pub struct QueryEngine;

impl QueryEngine {
    pub async fn explain_query(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        sql: &str,
    ) -> Result<QueryPlanResult> {
        let config = manager.get_config(connection_id).await?;
        let explain_sql = build_explain_sql(sql, &config.db_type)?;
        let start = Instant::now();

        let plan = match config.db_type {
            DatabaseType::Postgres => {
                let pools = manager.get_postgres_pools().await;
                let pool = pools
                    .get(connection_id)
                    .ok_or_else(|| anyhow!("Connection not found"))?;
                let mut tx = pool.begin().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *tx)
                    .await?;
                let row = sqlx::query(&explain_sql).fetch_one(&mut *tx).await?;
                row.try_get::<Value, _>(0)?
            }
            DatabaseType::MySql => {
                let pools = manager.get_mysql_pools().await;
                let pool = pools
                    .get(connection_id)
                    .ok_or_else(|| anyhow!("Connection not found"))?;
                let mut conn = pool.acquire().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *conn)
                    .await?;
                let mut tx = conn.begin().await?;
                let rows = sqlx::query(&explain_sql).fetch_all(&mut *tx).await?;
                let mut plan_rows = Vec::with_capacity(rows.len());
                for row in &rows {
                    let values = mysql_row_to_values!(row);
                    let fields = row
                        .columns()
                        .iter()
                        .zip(values)
                        .map(|(column, value)| (column.name().to_string(), value))
                        .collect::<serde_json::Map<String, Value>>();
                    plan_rows.push(Value::Object(fields));
                }
                Value::Array(plan_rows)
            }
            DatabaseType::Sqlite => {
                let path = config
                    .database
                    .ok_or_else(|| anyhow!("SQLite path is missing"))?;
                if path == ":memory:" {
                    return Err(anyhow!(
                        "Query plans are unavailable for in-memory SQLite databases"
                    ));
                }
                let mut conn = sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(path)
                    .read_only(true)
                    .connect()
                    .await?;
                let rows = sqlx::query(&explain_sql).fetch_all(&mut conn).await?;
                let mut steps = Vec::with_capacity(rows.len());
                for row in rows {
                    steps.push(serde_json::json!({
                        "id": row.try_get::<i64, _>(0)?,
                        "parent": row.try_get::<i64, _>(1)?,
                        "detail": row.try_get::<String, _>(3)?,
                    }));
                }
                Value::Array(steps)
            }
        };

        let database_type = match config.db_type {
            DatabaseType::Postgres => "Postgres",
            DatabaseType::MySql => "MySql",
            DatabaseType::Sqlite => "Sqlite",
        };
        Ok(QueryPlanResult {
            database_type: database_type.to_string(),
            plan,
            planning_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    pub async fn execute_query_streaming(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        sql: &str,
        query_id: Uuid,
        window: &tauri::Window,
        token: CancellationToken,
        read_only: bool,
        parameter_values: Option<&[ParameterValue]>,
    ) -> Result<()> {
        let start = Instant::now();
        use futures::StreamExt;

        macro_rules! bind_values {
            ($query:expr, $values:expr) => {{
                let mut query = $query;
                for value in $values {
                    query = match value {
                        ParameterValue::Text(value) => query.bind(value.clone()),
                        ParameterValue::Integer(value) => query.bind(*value),
                        ParameterValue::Float(value) => query.bind(*value),
                        ParameterValue::Boolean(value) => query.bind(*value),
                        ParameterValue::Null => query.bind(Option::<String>::None),
                    };
                }
                query
            }};
        }

        macro_rules! stream_db {
            ($pool:expr, $db_macro:ident, $stream:expr, $cancel:expr) => {{
                use sqlx::Either;
                let mut stream = $stream;
                let mut columns_sent = false;
                let mut batch = Vec::new();
                let mut total_rows = 0u64;
                let mut displayed_rows = 0u64;
                let mut affected_rows = 0u64;
                let mut truncated = false;
                let batch_size = 1000;

                while let Some(res_result) = tokio::select! {
                    _ = token.cancelled() => {
                        $cancel.await;
                        return Ok(());
                    },
                    result = StreamExt::next(&mut stream) => result,
                } {
                    match res_result? {
                        Either::Left(result) => {
                            affected_rows += result.rows_affected();
                        }
                        Either::Right(row) => {
                            if !columns_sent {
                                let columns = row
                                    .columns()
                                    .iter()
                                    .map(|c| Column::name(c).to_string())
                                    .collect::<Vec<String>>();
                                window.emit(
                                    "query-metadata",
                                    StreamingMetadata { query_id, columns },
                                )?;
                                columns_sent = true;
                            }

                            total_rows += 1;
                            if displayed_rows >= MAX_QUERY_RESULT_ROWS {
                                truncated = true;
                                // Only database-enforced read-only queries may stop early.
                                if read_only {
                                    break;
                                }
                                continue;
                            }
                            batch.push($db_macro!(&row));
                            displayed_rows += 1;

                            if batch.len() >= batch_size {
                                window.emit(
                                    "query-batch",
                                    StreamingBatch {
                                        query_id,
                                        rows: std::mem::take(&mut batch),
                                    },
                                )?;
                                sleep(Duration::from_millis(5)).await;
                            }
                        }
                    }
                }
                drop(stream);

                if !columns_sent {
                    let trimmed = sql.trim().to_uppercase();
                    if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
                        if let Ok(stmt) = Executor::prepare($pool, sql).await {
                            let columns = stmt
                                .columns()
                                .iter()
                                .map(|c| Column::name(c).to_string())
                                .collect::<Vec<String>>();
                            window
                                .emit("query-metadata", StreamingMetadata { query_id, columns })?;
                        }
                    }
                }

                if !batch.is_empty() {
                    window.emit(
                        "query-batch",
                        StreamingBatch {
                            query_id,
                            rows: batch,
                        },
                    )?;
                }

                window.emit(
                    "query-complete",
                    StreamingComplete {
                        query_id,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        total_rows,
                        affected_rows,
                        truncated,
                    },
                )?;

                return Ok(());
            }};
        }

        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                if read_only {
                    let mut tx = pool.begin().await?;
                    let backend_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                        .fetch_one(&mut *tx)
                        .await?;
                    sqlx::query("SET TRANSACTION READ ONLY")
                        .execute(&mut *tx)
                        .await?;
                    if let Some(values) = parameter_values {
                        let query = bind_values!(sqlx::query::<sqlx::Postgres>(sql), values);
                        let cancel_pool = (*pool).clone();
                        stream_db!(
                            &mut *tx,
                            postgres_row_to_values,
                            query.fetch(&mut *tx).map(|row| row
                                .map(sqlx::Either::<sqlx::postgres::PgQueryResult, _>::Right)),
                            async { cancel_postgres_statement(&cancel_pool, backend_pid).await }
                        );
                    }
                    let cancel_pool = (*pool).clone();
                    stream_db!(
                        &mut *tx,
                        postgres_row_to_values,
                        sqlx::raw_sql(sql).fetch_many(&mut *tx),
                        async { cancel_postgres_statement(&cancel_pool, backend_pid).await }
                    );
                }
                let mut conn = pool.acquire().await?;
                let backend_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                    .fetch_one(&mut *conn)
                    .await?;
                if let Some(values) = parameter_values {
                    let query = bind_values!(sqlx::query::<sqlx::Postgres>(sql), values);
                    let cancel_pool = (*pool).clone();
                    stream_db!(
                        &mut *conn,
                        postgres_row_to_values,
                        query
                            .fetch(&mut *conn)
                            .map(|row| row
                                .map(sqlx::Either::<sqlx::postgres::PgQueryResult, _>::Right)),
                        async { cancel_postgres_statement(&cancel_pool, backend_pid).await }
                    );
                }
                let cancel_pool = (*pool).clone();
                stream_db!(
                    &mut *conn,
                    postgres_row_to_values,
                    sqlx::raw_sql(sql).fetch_many(&mut *conn),
                    async { cancel_postgres_statement(&cancel_pool, backend_pid).await }
                );
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                if read_only {
                    let mut conn = pool.acquire().await?;
                    let backend_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
                        .fetch_one(&mut *conn)
                        .await?;
                    sqlx::query("SET TRANSACTION READ ONLY")
                        .execute(&mut *conn)
                        .await?;
                    let mut tx = conn.begin().await?;
                    if let Some(values) = parameter_values {
                        let query = bind_values!(sqlx::query::<sqlx::MySql>(sql), values);
                        let cancel_pool = (*pool).clone();
                        stream_db!(
                            &mut *tx,
                            mysql_row_to_values,
                            query.fetch(&mut *tx).map(|row| row
                                .map(sqlx::Either::<sqlx::mysql::MySqlQueryResult, _>::Right)),
                            async { cancel_mysql_statement(&cancel_pool, backend_id).await }
                        );
                    }
                    let cancel_pool = (*pool).clone();
                    stream_db!(
                        &mut *tx,
                        mysql_row_to_values,
                        sqlx::raw_sql(sql).fetch_many(&mut *tx),
                        async { cancel_mysql_statement(&cancel_pool, backend_id).await }
                    );
                }
                let mut conn = pool.acquire().await?;
                let backend_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
                    .fetch_one(&mut *conn)
                    .await?;
                if let Some(values) = parameter_values {
                    let query = bind_values!(sqlx::query::<sqlx::MySql>(sql), values);
                    let cancel_pool = (*pool).clone();
                    stream_db!(
                        &mut *conn,
                        mysql_row_to_values,
                        query
                            .fetch(&mut *conn)
                            .map(|row| row
                                .map(sqlx::Either::<sqlx::mysql::MySqlQueryResult, _>::Right)),
                        async { cancel_mysql_statement(&cancel_pool, backend_id).await }
                    );
                }
                let cancel_pool = (*pool).clone();
                stream_db!(
                    &mut *conn,
                    mysql_row_to_values,
                    sqlx::raw_sql(sql).fetch_many(&mut *conn),
                    async { cancel_mysql_statement(&cancel_pool, backend_id).await }
                );
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let config = manager.get_config(connection_id).await?;
                let path = config
                    .database
                    .ok_or_else(|| anyhow!("SQLite path is missing"))?;
                if path != ":memory:" {
                    let mut conn = sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(path)
                        .read_only(read_only)
                        .connect()
                        .await?;
                    {
                        let progress_token = token.clone();
                        let mut handle = conn.lock_handle().await?;
                        handle.set_progress_handler(1000, move || !progress_token.is_cancelled());
                    }
                    if let Some(values) = parameter_values {
                        let query = bind_values!(sqlx::query::<sqlx::Sqlite>(sql), values);
                        stream_db!(
                            &mut conn,
                            sqlite_row_to_values,
                            query.fetch(&mut conn).map(|row| row
                                .map(sqlx::Either::<sqlx::sqlite::SqliteQueryResult, _>::Right)),
                            async {}
                        );
                    }
                    stream_db!(
                        &mut conn,
                        sqlite_row_to_values,
                        sqlx::raw_sql(sql).fetch_many(&mut conn),
                        async {}
                    );
                }
                if read_only {
                    return Err(anyhow!(
                        "Read-only SQL, including parameterized SELECT, is unavailable for in-memory SQLite databases"
                    ));
                }
                if let Some(values) = parameter_values {
                    let query = bind_values!(sqlx::query::<sqlx::Sqlite>(sql), values);
                    stream_db!(
                        pool,
                        sqlite_row_to_values,
                        query.fetch(pool).map(|row| row
                            .map(sqlx::Either::<sqlx::sqlite::SqliteQueryResult, _>::Right)),
                        async {}
                    );
                }
                stream_db!(
                    pool,
                    sqlite_row_to_values,
                    sqlx::raw_sql(sql).fetch_many(pool),
                    async {}
                );
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn execute_read_only_query(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        sql: &str,
        page: Option<u32>,
        page_size: Option<u32>,
    ) -> Result<QueryResult> {
        let start = Instant::now();
        let final_sql = match (page, page_size) {
            (Some(page), Some(size)) if size > 0 => {
                wrap_pagination(sql, size, page.saturating_mul(size))
            }
            _ => sql.to_string(),
        };

        macro_rules! read_only_rows {
            ($connection:expr, $db_macro:ident) => {{
                let rows = sqlx::query(&final_sql).fetch_all($connection).await?;
                let mut columns: Vec<String> = rows
                    .first()
                    .map(|row| {
                        row.columns()
                            .iter()
                            .map(|column| Column::name(column).to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                if columns.is_empty() {
                    columns = Executor::prepare($connection, &final_sql)
                        .await?
                        .columns()
                        .iter()
                        .map(|column| Column::name(column).to_string())
                        .collect();
                }
                let values = rows.iter().map(|row| $db_macro!(row)).collect();
                return Ok(QueryResult {
                    columns,
                    rows: values,
                    affected_rows: 0,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count: None,
                    page,
                    page_size,
                    has_more: None,
                });
            }};
        }

        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let mut tx = pool.begin().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *tx)
                    .await?;
                read_only_rows!(&mut *tx, postgres_row_to_values);
            }
        }
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let mut conn = pool.acquire().await?;
                sqlx::query("SET TRANSACTION READ ONLY")
                    .execute(&mut *conn)
                    .await?;
                let mut tx = conn.begin().await?;
                read_only_rows!(&mut *tx, mysql_row_to_values);
            }
        }
        {
            let pools = manager.get_sqlite_pools().await;
            if pools.contains_key(connection_id) {
                let config = manager.get_config(connection_id).await?;
                let path = config
                    .database
                    .ok_or_else(|| anyhow!("SQLite path is missing"))?;
                if path == ":memory:" {
                    return Err(anyhow!(
                        "Safe mode read-only SQL is unavailable for in-memory SQLite databases"
                    ));
                }
                let mut conn = sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(path)
                    .read_only(true)
                    .connect()
                    .await?;
                read_only_rows!(&mut conn, sqlite_row_to_values);
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

                use sqlx::Either;
                let mut stream = sqlx::raw_sql(&final_sql).fetch_many(pool);
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                let mut affected_rows = 0;

                while let Some(res) = StreamExt::next(&mut stream).await {
                    match res? {
                        Either::Left(result) => {
                            affected_rows += result.rows_affected();
                        }
                        Either::Right(row) => {
                            if columns.is_empty() {
                                columns = row
                                    .columns()
                                    .iter()
                                    .map(|c| Column::name(c).to_string())
                                    .collect::<Vec<String>>();
                            }
                            result_rows.push(postgres_row_to_values!(&row));
                        }
                    }
                }

                // Fallback for empty SELECT columns
                if columns.is_empty() {
                    let trimmed = sql.trim().to_uppercase();
                    if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
                        if let Ok(stmt) = Executor::prepare(pool, sql).await {
                            columns = stmt
                                .columns()
                                .iter()
                                .map(|c| Column::name(c).to_string())
                                .collect::<Vec<String>>();
                        }
                    }
                }

                return Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count,
                    page,
                    page_size,
                    has_more: None,
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

                use sqlx::Either;
                let mut stream = sqlx::raw_sql(&final_sql).fetch_many(pool);
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                let mut affected_rows = 0;

                while let Some(res) = StreamExt::next(&mut stream).await {
                    match res? {
                        Either::Left(result) => {
                            affected_rows += result.rows_affected();
                        }
                        Either::Right(row) => {
                            if columns.is_empty() {
                                columns = row
                                    .columns()
                                    .iter()
                                    .map(|c| Column::name(c).to_string())
                                    .collect::<Vec<String>>();
                            }
                            result_rows.push(mysql_row_to_values!(&row));
                        }
                    }
                }

                // Fallback for empty SELECT columns
                if columns.is_empty() {
                    let trimmed = sql.trim().to_uppercase();
                    if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
                        if let Ok(stmt) = Executor::prepare(pool, sql).await {
                            columns = stmt
                                .columns()
                                .iter()
                                .map(|c| Column::name(c).to_string())
                                .collect::<Vec<String>>();
                        }
                    }
                }

                return Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count,
                    page,
                    page_size,
                    has_more: None,
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

                use sqlx::Either;
                let mut stream = sqlx::raw_sql(&final_sql).fetch_many(pool);
                let mut result_rows = Vec::new();
                let mut columns = Vec::new();
                let mut affected_rows = 0;

                while let Some(res) = StreamExt::next(&mut stream).await {
                    match res? {
                        Either::Left(result) => {
                            affected_rows += result.rows_affected();
                        }
                        Either::Right(row) => {
                            if columns.is_empty() {
                                columns = row
                                    .columns()
                                    .iter()
                                    .map(|c| Column::name(c).to_string())
                                    .collect::<Vec<String>>();
                            }
                            result_rows.push(sqlite_row_to_values!(&row));
                        }
                    }
                }

                // Fallback for empty SELECT columns
                if columns.is_empty() {
                    let trimmed = sql.trim().to_uppercase();
                    if trimmed.starts_with("SELECT") || trimmed.starts_with("WITH") {
                        if let Ok(stmt) = Executor::prepare(pool, sql).await {
                            columns = stmt
                                .columns()
                                .iter()
                                .map(|c| Column::name(c).to_string())
                                .collect::<Vec<String>>();
                        }
                    }
                }

                return Ok(QueryResult {
                    columns,
                    rows: result_rows,
                    affected_rows,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                    total_count,
                    page,
                    page_size,
                    has_more: None,
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
                // List databases. Removed datallowconn filter to match TablePlus behavior.
                let sql = "SELECT datname::text FROM pg_database WHERE datistemplate = false ORDER BY datname;";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                return Ok(rows
                    .into_iter()
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
                return Ok(rows
                    .into_iter()
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
                return Ok(rows
                    .into_iter()
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
                // Explicitly check current search path or public schema
                let sql = "SELECT table_name::text FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_type = 'BASE TABLE';";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                let tables: Vec<String> = rows
                    .into_iter()
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
                return Ok(rows
                    .into_iter()
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
                return Ok(rows
                    .into_iter()
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
        primary_keys: Vec<String>,
        seek_after: Option<Value>,
    ) -> Result<QueryResult> {
        let limit = limit.clamp(1, 1000);
        if seek_after.is_some() && (sort_column.is_some() || primary_keys.len() != 1) {
            return Err(anyhow!(
                "Keyset paging requires one primary key and default sort"
            ));
        }
        let db_type = {
            if manager
                .get_postgres_pools()
                .await
                .contains_key(connection_id)
            {
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
                let pool = manager
                    .get_postgres_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();
                let public_exists: bool = sqlx::query_scalar(
                    "SELECT to_regclass(format('%I.%I', 'public', $1)) IS NOT NULL",
                )
                .bind(table_name)
                .fetch_one(&pool)
                .await?;
                let predicate = seek_after
                    .as_ref()
                    .map(|value| build_seek_predicate(value, &primary_keys[0], "postgres"))
                    .transpose()?;
                let where_clause =
                    with_seek_predicate(build_where_clause(filters, "postgres"), predicate);
                let order_clause = build_browse_order_clause(
                    sort_column.as_deref(),
                    sort_direction.as_deref(),
                    &primary_keys,
                    "postgres",
                );
                let sql = format!(
                    "SELECT * FROM {}\"{}\" {} {} LIMIT {} OFFSET {};",
                    if public_exists { "\"public\"." } else { "" },
                    table_name.replace("\"", "\"\""),
                    where_clause,
                    order_clause,
                    limit + 1,
                    if seek_after.is_some() { 0 } else { offset }
                );
                let mut result =
                    Self::execute_query(manager, connection_id, &sql, None, None).await?;
                result.has_more = Some(result.rows.len() > limit as usize);
                result.rows.truncate(limit as usize);
                Ok(result)
            }
            Some("mysql") => {
                let predicate = seek_after
                    .as_ref()
                    .map(|value| build_seek_predicate(value, &primary_keys[0], "mysql"))
                    .transpose()?;
                let where_clause =
                    with_seek_predicate(build_where_clause(filters, "mysql"), predicate);
                let order_clause = build_browse_order_clause(
                    sort_column.as_deref(),
                    sort_direction.as_deref(),
                    &primary_keys,
                    "mysql",
                );
                let sql = format!(
                    "SELECT * FROM `{}` {} {} LIMIT {} OFFSET {};",
                    table_name.replace("`", "``"),
                    where_clause,
                    order_clause,
                    limit + 1,
                    if seek_after.is_some() { 0 } else { offset }
                );
                let mut result =
                    Self::execute_query(manager, connection_id, &sql, None, None).await?;
                result.has_more = Some(result.rows.len() > limit as usize);
                result.rows.truncate(limit as usize);
                Ok(result)
            }
            Some("sqlite") => {
                let predicate = seek_after
                    .as_ref()
                    .map(|value| build_seek_predicate(value, &primary_keys[0], "sqlite"))
                    .transpose()?;
                let where_clause =
                    with_seek_predicate(build_where_clause(filters, "sqlite"), predicate);
                let order_clause = build_browse_order_clause(
                    sort_column.as_deref(),
                    sort_direction.as_deref(),
                    &primary_keys,
                    "sqlite",
                );
                let sql = format!(
                    "SELECT * FROM \"{}\" {} {} LIMIT {} OFFSET {};",
                    table_name.replace("\"", "\"\""),
                    where_clause,
                    order_clause,
                    limit + 1,
                    if seek_after.is_some() { 0 } else { offset }
                );
                let mut result =
                    Self::execute_query(manager, connection_id, &sql, None, None).await?;
                result.has_more = Some(result.rows.len() > limit as usize);
                result.rows.truncate(limit as usize);
                Ok(result)
            }
            Some(_) => Err(anyhow!("Unknown database type")),
            None => Err(anyhow!("Connection not found")),
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
                let public_exists: bool = sqlx::query_scalar(
                    "SELECT to_regclass(format('%I.%I', 'public', $1)) IS NOT NULL",
                )
                .bind(table_name)
                .fetch_one(pool)
                .await?;
                let where_clause = build_where_clause(filters, "postgres");
                let sql = format!(
                    "SELECT COUNT(*) FROM {}\"{}\" {};",
                    if public_exists { "\"public\"." } else { "" },
                    table_name.replace("\"", "\"\""),
                    where_clause
                );
                let row = sqlx::query(&sql).fetch_one(pool).await?;
                return Ok(row.try_get::<i64, _>(0)? as u64);
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let where_clause = build_where_clause(filters, "mysql");
                let sql = format!(
                    "SELECT COUNT(*) FROM `{}` {};",
                    table_name.replace("`", "``"),
                    where_clause
                );
                let row = sqlx::query(&sql).fetch_one(pool).await?;
                return Ok(row.try_get::<i64, _>(0).unwrap_or(0) as u64);
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let where_clause = build_where_clause(filters, "sqlite");
                let sql = format!(
                    "SELECT COUNT(*) FROM \"{}\" {};",
                    table_name.replace("\"", "\"\""),
                    where_clause
                );
                let row = sqlx::query(&sql).fetch_one(pool).await?;
                return Ok(row.try_get::<i64, _>(0)? as u64);
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
                let row = sqlx::query(sql).bind(table_name).fetch_one(pool).await?;

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
                let row = sqlx::query(sql).bind(table_name).fetch_one(pool).await?;

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

    pub async fn get_ai_schema_tables(
        manager: &ConnectionManager,
        connection_id: &Uuid,
    ) -> Result<Vec<AiSchemaTable>> {
        let db_type = {
            if manager
                .get_postgres_pools()
                .await
                .contains_key(connection_id)
            {
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
                let pool = manager
                    .get_postgres_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();
                let sql = r#"
                    SELECT
                        c.table_schema,
                        c.table_name,
                        t.table_type,
                        c.column_name,
                        c.data_type,
                        c.is_nullable,
                        c.column_default,
                        (pk.column_name IS NOT NULL) AS is_primary
                    FROM information_schema.columns c
                    JOIN information_schema.tables t
                      ON c.table_schema = t.table_schema
                     AND c.table_name = t.table_name
                    LEFT JOIN (
                        SELECT
                            kcu.table_schema,
                            kcu.table_name,
                            kcu.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema = kcu.table_schema
                         AND tc.table_name = kcu.table_name
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                    ) pk
                      ON pk.table_schema = c.table_schema
                     AND pk.table_name = c.table_name
                     AND pk.column_name = c.column_name
                    WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
                    ORDER BY c.table_schema, c.table_name, c.ordinal_position;
                "#;

                let rows = sqlx::query(sql).fetch_all(&pool).await?;
                let mut tables = BTreeMap::new();

                for row in rows {
                    let schema: String = row.get(0);
                    let table_name: String = row.get(1);
                    let table_type: String = row.get(2);
                    let key = format!("{}.{}", schema, table_name);

                    let entry = tables.entry(key).or_insert_with(|| AiSchemaTable {
                        name: table_name.clone(),
                        schema: Some(schema.clone()),
                        item_type: sidebar_item_type_from_table_type(&table_type),
                        columns: Vec::new(),
                    });

                    entry.columns.push(TableColumnStructure {
                        name: row.get(3),
                        data_type: row.get(4),
                        is_nullable: row.get::<String, _>(5) == "YES",
                        default_value: row.get(6),
                        is_primary_key: row.get(7),
                        comment: None,
                    });
                }

                Ok(tables.into_values().collect())
            }
            Some("mysql") => {
                let pool = manager
                    .get_mysql_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();
                let sql = r#"
                    SELECT
                        c.TABLE_SCHEMA,
                        c.TABLE_NAME,
                        t.TABLE_TYPE,
                        c.COLUMN_NAME,
                        c.COLUMN_TYPE,
                        c.IS_NULLABLE,
                        c.COLUMN_DEFAULT,
                        c.COLUMN_KEY
                    FROM information_schema.COLUMNS c
                    JOIN information_schema.TABLES t
                      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
                     AND c.TABLE_NAME = t.TABLE_NAME
                    WHERE c.TABLE_SCHEMA = DATABASE()
                    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;
                "#;

                let rows = sqlx::query(sql).fetch_all(&pool).await?;
                let mut tables = BTreeMap::new();

                for row in rows {
                    let schema: String = row.get(0);
                    let table_name: String = row.get(1);
                    let table_type: String = row.get(2);
                    let key = format!("{}.{}", schema, table_name);

                    let entry = tables.entry(key).or_insert_with(|| AiSchemaTable {
                        name: table_name.clone(),
                        schema: Some(schema.clone()),
                        item_type: sidebar_item_type_from_table_type(&table_type),
                        columns: Vec::new(),
                    });

                    entry.columns.push(TableColumnStructure {
                        name: row.get(3),
                        data_type: row.get(4),
                        is_nullable: row.get::<String, _>(5) == "YES",
                        default_value: row.get(6),
                        is_primary_key: row.get::<String, _>(7) == "PRI",
                        comment: None,
                    });
                }

                Ok(tables.into_values().collect())
            }
            Some("sqlite") => {
                let pool = manager
                    .get_sqlite_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();
                let rows = sqlx::query(
                    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;",
                )
                .fetch_all(&pool)
                .await?;

                let mut tables = Vec::new();

                for row in rows {
                    let table_name: String = row.get(0);
                    let table_type: String = row.get(1);
                    let pragma_sql =
                        format!("PRAGMA table_info(\"{}\")", table_name.replace('"', "\"\""));
                    let col_rows = sqlx::query(&pragma_sql).fetch_all(&pool).await?;
                    let columns = col_rows
                        .into_iter()
                        .map(|col_row| TableColumnStructure {
                            name: col_row.get("name"),
                            data_type: col_row.get("type"),
                            is_nullable: col_row.get::<i64, _>("notnull") == 0,
                            default_value: col_row.get("dflt_value"),
                            is_primary_key: col_row.get::<i64, _>("pk") > 0,
                            comment: None,
                        })
                        .collect();

                    tables.push(AiSchemaTable {
                        name: table_name,
                        schema: None,
                        item_type: sidebar_item_type_from_table_type(&table_type),
                        columns,
                    });
                }

                Ok(tables)
            }
            _ => Err(anyhow!("Connection not found")),
        }
    }

    pub async fn get_table_structure(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
    ) -> Result<TableStructure> {
        let db_type = {
            if manager
                .get_postgres_pools()
                .await
                .contains_key(connection_id)
            {
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
                let pool = manager
                    .get_postgres_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();

                // Fetch columns
                let col_sql = r#"
                    SELECT 
                        column_name, 
                        data_type, 
                        is_nullable, 
                        column_default,
                        EXISTS (
                            SELECT 1 FROM information_schema.key_column_usage kcu
                            JOIN information_schema.table_constraints tc
                              ON kcu.constraint_name = tc.constraint_name
                             AND kcu.table_schema = tc.table_schema
                             AND kcu.table_name = tc.table_name
                            WHERE kcu.table_schema = c.table_schema
                              AND kcu.table_name = c.table_name
                              AND kcu.column_name = c.column_name
                              AND tc.constraint_type = 'PRIMARY KEY'
                        ) as is_primary
                    FROM information_schema.columns c
                    WHERE table_name = $1 AND table_schema = 'public'
                    ORDER BY ordinal_position;
                "#;
                let col_rows = sqlx::query(col_sql)
                    .bind(table_name)
                    .fetch_all(&pool)
                    .await?;
                let columns = col_rows
                    .into_iter()
                    .map(|row| {
                        TableColumnStructure {
                            name: row.get(0),
                            data_type: row.get(1),
                            is_nullable: row.get::<String, _>(2) == "YES",
                            default_value: row.get(3),
                            is_primary_key: row.get(4),
                            comment: None, // We could fetch this too if needed
                        }
                    })
                    .collect();

                // Fetch indexes
                let idx_sql = "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1 AND schemaname = 'public';";
                let idx_rows = sqlx::query(idx_sql)
                    .bind(table_name)
                    .fetch_all(&pool)
                    .await?;
                let indexes = idx_rows
                    .into_iter()
                    .map(|row| {
                        let def: String = row.get(1);
                        TableIndexStructure {
                            name: row.get(0),
                            columns: vec![], // Logic to parse columns from def would be complex, leaving empty for now or could just show def
                            is_unique: def.contains("UNIQUE"),
                            index_type: "btree".to_string(), // Default in PG
                        }
                    })
                    .collect();

                // Fetch constraints
                let cons_sql = r#"
                    SELECT 
                        constraint_name, 
                        constraint_type
                    FROM information_schema.table_constraints 
                    WHERE table_name = $1 AND table_schema = 'public';
                "#;
                let cons_rows = sqlx::query(cons_sql)
                    .bind(table_name)
                    .fetch_all(&pool)
                    .await?;
                let constraints = cons_rows
                    .into_iter()
                    .map(|row| TableConstraintStructure {
                        name: row.get(0),
                        constraint_type: row.get(1),
                        definition: "".to_string(),
                    })
                    .collect();

                let fk_rows = sqlx::query(r#"
                    SELECT c.conname, source_column.attname, target.relname, target_column.attname
                    FROM pg_constraint c
                    JOIN pg_class source ON source.oid = c.conrelid
                    JOIN pg_namespace source_schema ON source_schema.oid = source.relnamespace
                    JOIN pg_class target ON target.oid = c.confrelid
                    JOIN pg_namespace target_schema ON target_schema.oid = target.relnamespace
                    JOIN unnest(c.conkey, c.confkey) WITH ORDINALITY
                      AS columns(source_number, target_number, position) ON true
                    JOIN pg_attribute source_column
                      ON source_column.attrelid = source.oid AND source_column.attnum = columns.source_number
                    JOIN pg_attribute target_column
                      ON target_column.attrelid = target.oid AND target_column.attnum = columns.target_number
                    WHERE c.contype = 'f' AND source_schema.nspname = 'public'
                      AND target_schema.nspname = 'public' AND source.relname = $1
                    ORDER BY c.conname, columns.position
                "#).bind(table_name).fetch_all(&pool).await?;
                let foreign_keys = group_foreign_keys(
                    fk_rows
                        .into_iter()
                        .map(|row| (row.get(0), row.get(1), row.get(2), row.get(3))),
                );

                Ok(TableStructure {
                    columns,
                    indexes,
                    constraints,
                    foreign_keys,
                })
            }
            Some("mysql") => {
                let pool = manager
                    .get_mysql_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();

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
                let col_rows = sqlx::query(col_sql)
                    .bind(table_name)
                    .fetch_all(&pool)
                    .await?;
                let columns = col_rows
                    .into_iter()
                    .map(|row| TableColumnStructure {
                        name: row.get(0),
                        data_type: row.get(1),
                        is_nullable: row.get::<String, _>(2) == "YES",
                        default_value: row.get(3),
                        is_primary_key: row.get::<String, _>(4) == "PRI",
                        comment: row.get(5),
                    })
                    .collect();

                // Fetch indexes
                let idx_sql = format!("SHOW INDEX FROM `{}`", table_name.replace("`", "``"));
                let idx_rows = sqlx::query(&idx_sql).fetch_all(&pool).await?;

                // Group by index name
                let mut indexes_map: std::collections::HashMap<String, TableIndexStructure> =
                    std::collections::HashMap::new();
                for row in idx_rows {
                    let name: String = row.get("Key_name");
                    let column: String = row.get("Column_name");
                    let non_unique: i32 = row.get("Non_unique");

                    let entry = indexes_map
                        .entry(name.clone())
                        .or_insert(TableIndexStructure {
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
                let cons_rows = sqlx::query(cons_sql)
                    .bind(table_name)
                    .fetch_all(&pool)
                    .await?;
                let constraints = cons_rows
                    .into_iter()
                    .map(|row| TableConstraintStructure {
                        name: row.get(0),
                        constraint_type: row.get(1),
                        definition: "".to_string(),
                    })
                    .collect();

                let fk_rows = sqlx::query(r#"
                    SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM information_schema.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                      AND REFERENCED_TABLE_SCHEMA = DATABASE()
                      AND REFERENCED_TABLE_NAME IS NOT NULL
                    ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
                "#).bind(table_name).fetch_all(&pool).await?;
                let foreign_keys = group_foreign_keys(
                    fk_rows
                        .into_iter()
                        .map(|row| (row.get(0), row.get(1), row.get(2), row.get(3))),
                );

                Ok(TableStructure {
                    columns,
                    indexes,
                    constraints,
                    foreign_keys,
                })
            }
            Some("sqlite") => {
                let pool = manager
                    .get_sqlite_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .unwrap();

                // Fetch columns
                let col_sql = format!(
                    "PRAGMA table_info(\"{}\")",
                    table_name.replace("\"", "\"\"")
                );
                let col_rows = sqlx::query(&col_sql).fetch_all(&pool).await?;
                let columns = col_rows
                    .into_iter()
                    .map(|row| TableColumnStructure {
                        name: row.get("name"),
                        data_type: row.get("type"),
                        is_nullable: row.get::<i32, _>("notnull") == 0,
                        default_value: row.get("dflt_value"),
                        is_primary_key: row.get::<i32, _>("pk") > 0,
                        comment: None,
                    })
                    .collect();

                // Fetch indexes
                let idx_list_sql = format!(
                    "PRAGMA index_list(\"{}\")",
                    table_name.replace("\"", "\"\"")
                );
                let idx_list_rows = sqlx::query(&idx_list_sql).fetch_all(&pool).await?;
                let mut indexes = Vec::new();
                for row in idx_list_rows {
                    let name: String = row.get("name");
                    let unique: i32 = row.get("unique");

                    // Get columns for this index
                    let idx_info_sql =
                        format!("PRAGMA index_info(\"{}\")", name.replace("\"", "\"\""));
                    let idx_info_rows = sqlx::query(&idx_info_sql).fetch_all(&pool).await?;
                    let cols: Vec<String> = idx_info_rows
                        .into_iter()
                        .filter_map(|r| r.try_get("name").ok())
                        .collect();

                    indexes.push(TableIndexStructure {
                        name,
                        columns: cols,
                        is_unique: unique > 0,
                        index_type: "btree".to_string(),
                    });
                }

                // Fetch constraints (foreign keys)
                let fk_sql = format!(
                    "PRAGMA foreign_key_list(\"{}\")",
                    table_name.replace("\"", "\"\"")
                );
                let fk_rows = sqlx::query(&fk_sql).fetch_all(&pool).await?;
                let mut constraints = Vec::new();
                let mut fk_columns = Vec::new();
                let mut target_primary_keys = BTreeMap::<String, Vec<String>>::new();
                for row in fk_rows {
                    let id: i64 = row.get("id");
                    let position: i64 = row.get("seq");
                    let target_table: String = row.get("table");
                    let source_column: String = row.get("from");
                    let mut target_column: String =
                        row.try_get::<Option<String>, _>("to")?.unwrap_or_default();
                    if target_column.is_empty() {
                        if !target_primary_keys.contains_key(&target_table) {
                            let target_sql = format!(
                                "PRAGMA table_info(\"{}\")",
                                target_table.replace('"', "\"\"")
                            );
                            let target_rows = sqlx::query(&target_sql).fetch_all(&pool).await?;
                            let mut primary: Vec<(i32, String)> = target_rows
                                .into_iter()
                                .filter_map(|target_row| {
                                    let order: i32 = target_row.get("pk");
                                    (order > 0).then(|| (order, target_row.get("name")))
                                })
                                .collect();
                            primary.sort_by_key(|(order, _)| *order);
                            target_primary_keys.insert(
                                target_table.clone(),
                                primary.into_iter().map(|(_, name)| name).collect(),
                            );
                        }
                        target_column = target_primary_keys[&target_table]
                            .get(position as usize)
                            .cloned()
                            .unwrap_or_default();
                    }
                    let name = format!("fk_{table_name}_{id}");
                    constraints.push(TableConstraintStructure {
                        name: name.clone(),
                        constraint_type: "FOREIGN KEY".to_string(),
                        definition: format!(
                            "{} -> {}({})",
                            source_column, target_table, target_column
                        ),
                    });
                    fk_columns.push((name, source_column, target_table, target_column));
                }
                let foreign_keys = group_foreign_keys(fk_columns);

                Ok(TableStructure {
                    columns,
                    indexes,
                    constraints,
                    foreign_keys,
                })
            }
            Some(_) => Err(anyhow!("Unknown database type")),
            None => Err(anyhow!("Connection not found")),
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
            if manager
                .get_postgres_pools()
                .await
                .contains_key(connection_id)
            {
                Some("postgres")
            } else if manager.get_mysql_pools().await.contains_key(connection_id) {
                Some("mysql")
            } else if manager.get_sqlite_pools().await.contains_key(connection_id) {
                Some("sqlite")
            } else {
                None
            }
        };

        if db_type.is_none() {
            return Err(anyhow!("Connection not found"));
        }
        let db_type = db_type.unwrap();

        let where_clause = build_where_clause(filters, db_type);
        let order_clause = build_order_clause(sort_column, sort_direction, db_type);

        let sql = match db_type {
            "postgres" | "sqlite" => format!(
                "SELECT * FROM \"{}\" {} {};",
                table_name.replace("\"", "\"\""),
                where_clause,
                order_clause
            ),
            "mysql" => format!(
                "SELECT * FROM `{}` {} {};",
                table_name.replace("`", "``"),
                where_clause,
                order_clause
            ),
            _ => return Err(anyhow!("Unknown database type")),
        };

        macro_rules! export_rows {
            ($pool:expr, $row_macro:ident) => {{
                let statement = Executor::prepare($pool, sql.as_str()).await?;
                let columns = statement
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect();
                let (pending, file) = PendingExport::create(file_path)?;
                let file = BufWriter::new(file);
                let mut writer =
                    TableExportWriter::new(format, file, columns, table_name, db_type)?;
                let mut rows_count = 0;
                let mut stream = sqlx::query(&sql).fetch($pool);
                while let Some(row) = stream.try_next().await? {
                    writer.write_row($row_macro!(&row))?;
                    rows_count += 1;
                }
                drop(stream);
                writer.finish()?;
                pending.commit()?;
                return Ok(rows_count);
            }};
        }

        match db_type {
            "postgres" => {
                let pool = manager
                    .get_postgres_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .ok_or_else(|| anyhow!("Connection not found"))?;
                export_rows!(&pool, postgres_row_to_values);
            }
            "mysql" => {
                let pool = manager
                    .get_mysql_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .ok_or_else(|| anyhow!("Connection not found"))?;
                export_rows!(&pool, mysql_row_to_values);
            }
            "sqlite" => {
                let pool = manager
                    .get_sqlite_pools()
                    .await
                    .get(connection_id)
                    .cloned()
                    .ok_or_else(|| anyhow!("Connection not found"))?;
                export_rows!(&pool, sqlite_row_to_values);
            }
            _ => Err(anyhow!("Unknown database type")),
        }
    }

    pub async fn get_sidebar_items(
        manager: &ConnectionManager,
        connection_id: &Uuid,
    ) -> Result<Vec<SidebarItem>> {
        let mut items = Vec::new();

        // Check Postgres
        {
            let pools = manager.get_postgres_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                // Tables and Views
                let sql = r#"
                    SELECT table_name, table_type, table_schema
                    FROM information_schema.tables
                    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                    ORDER BY table_name;
                "#;
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                for row in rows {
                    let name: String = row.get(0);
                    let table_type: String = row.get(1);
                    let schema: String = row.get(2);
                    let item_type = if table_type == "VIEW" {
                        SidebarItemType::View
                    } else {
                        SidebarItemType::Table
                    };
                    items.push(SidebarItem {
                        name,
                        item_type,
                        schema: Some(schema),
                    });
                }

                // Functions and Procedures
                let sql = r#"
                    SELECT routine_name, routine_type, routine_schema
                    FROM information_schema.routines
                    WHERE routine_schema NOT IN ('information_schema', 'pg_catalog')
                    ORDER BY routine_name;
                "#;
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                for row in rows {
                    let name: String = row.get(0);
                    let routine_type: String = row.get(1);
                    let schema: String = row.get(2);
                    let item_type = if routine_type == "PROCEDURE" {
                        SidebarItemType::Procedure
                    } else {
                        SidebarItemType::Function
                    };
                    items.push(SidebarItem {
                        name,
                        item_type,
                        schema: Some(schema),
                    });
                }
                return Ok(items);
            }
        }

        // Check MySQL
        {
            let pools = manager.get_mysql_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                // Tables and Views
                let sql = r#"
                    SELECT TABLE_NAME, TABLE_TYPE, TABLE_SCHEMA
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                    ORDER BY TABLE_NAME;
                "#;
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                for row in rows {
                    let name: String = row.get(0);
                    let table_type: String = row.get(1);
                    let schema: String = row.get(2);
                    let item_type = if table_type == "VIEW" {
                        SidebarItemType::View
                    } else {
                        SidebarItemType::Table
                    };
                    items.push(SidebarItem {
                        name,
                        item_type,
                        schema: Some(schema),
                    });
                }

                // Routines
                let sql = r#"
                    SELECT ROUTINE_NAME, ROUTINE_TYPE, ROUTINE_SCHEMA
                    FROM information_schema.ROUTINES
                    WHERE ROUTINE_SCHEMA = DATABASE()
                    ORDER BY ROUTINE_NAME;
                "#;
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                for row in rows {
                    let name: String = row.get(0);
                    let routine_type: String = row.get(1);
                    let schema: String = row.get(2);
                    let item_type = if routine_type == "PROCEDURE" {
                        SidebarItemType::Procedure
                    } else {
                        SidebarItemType::Function
                    };
                    items.push(SidebarItem {
                        name,
                        item_type,
                        schema: Some(schema),
                    });
                }
                return Ok(items);
            }
        }

        // Check SQLite
        {
            let pools = manager.get_sqlite_pools().await;
            if let Some(pool) = pools.get(connection_id) {
                let sql = "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;";
                let rows = sqlx::query(sql).fetch_all(pool).await?;
                for row in rows {
                    let name: String = row.get(0);
                    let item_type_str: String = row.get(1);
                    let item_type = if item_type_str == "view" {
                        SidebarItemType::View
                    } else {
                        SidebarItemType::Table
                    };
                    items.push(SidebarItem {
                        name,
                        item_type,
                        schema: None,
                    });
                }
                return Ok(items);
            }
        }

        Err(anyhow!("Connection not found"))
    }

    pub async fn get_sql_completion_columns(
        manager: &ConnectionManager,
        connection_id: &Uuid,
        table_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<String>> {
        if let Some(pool) = manager
            .get_postgres_pools()
            .await
            .get(connection_id)
            .cloned()
        {
            let rows = sqlx::query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
            )
            .bind(schema.unwrap_or("public"))
            .bind(table_name)
            .fetch_all(&pool)
            .await?;
            return Ok(rows.into_iter().map(|row| row.get(0)).collect());
        }

        if let Some(pool) = manager.get_mysql_pools().await.get(connection_id).cloned() {
            let rows = sqlx::query(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            )
            .bind(table_name)
            .fetch_all(&pool)
            .await?;
            return Ok(rows.into_iter().map(|row| row.get(0)).collect());
        }

        if let Some(pool) = manager.get_sqlite_pools().await.get(connection_id).cloned() {
            let sql = format!("PRAGMA table_info(\"{}\")", table_name.replace('"', "\"\""));
            let rows = sqlx::query(&sql).fetch_all(&pool).await?;
            return Ok(rows.into_iter().map(|row| row.get("name")).collect());
        }

        Err(anyhow!("Connection not found"))
    }
}
