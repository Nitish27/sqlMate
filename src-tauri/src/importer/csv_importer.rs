use crate::core::{query_engine::QueryEngine, AppState};
use anyhow::{anyhow, Result};
use csv::ReaderBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::importer::{ImportProgress, InsertTarget};

#[derive(Deserialize, Serialize, Debug)]
pub struct CsvImportOptions {
    pub file_path: String,
    pub table_name: String,
    pub create_table_if_missing: bool,
    pub column_mapping: HashMap<String, String>, // csv_column -> db_column
    pub has_header: bool,
    pub delimiter: char,
    pub skip_rows: u32,
    pub batch_size: usize,
    pub preview_file_size: u64,
    pub preview_modified_ns: String,
}

#[derive(Serialize, Debug)]
pub struct CsvPreview {
    pub columns: Vec<String>,
    pub source_keys: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: u64,
    pub file_size: u64,
    pub modified_ns: String,
}

struct CsvInspection {
    columns: Vec<String>,
    source_keys: Vec<String>,
    rows: Vec<Vec<String>>,
    total_rows: u64,
}

fn delimiter_byte(delimiter: char) -> Result<u8> {
    if delimiter.is_ascii() && delimiter != '\n' && delimiter != '\r' && delimiter != '"' {
        Ok(delimiter as u8)
    } else {
        Err(anyhow!(
            "Choose a single ASCII separator other than a quote or newline"
        ))
    }
}

fn file_stamp(path: &str) -> Result<(u64, String)> {
    let metadata = std::fs::metadata(path)?;
    let modified = metadata.modified()?.duration_since(UNIX_EPOCH)?.as_nanos();
    Ok((metadata.len(), modified.to_string()))
}

fn inspect_reader<R: Read>(
    input: R,
    delimiter: u8,
    has_header: bool,
    skip_rows: u32,
) -> Result<CsvInspection> {
    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .from_reader(input);
    let mut records = reader.records();
    let first = records
        .next()
        .ok_or_else(|| anyhow!("CSV file is empty"))??;
    if first.is_empty() {
        return Err(anyhow!("CSV file has no columns"));
    }
    let (columns, source_keys, first_data) = if has_header {
        let columns: Vec<String> = first.iter().map(|value| value.trim().to_string()).collect();
        if columns.iter().any(String::is_empty) {
            return Err(anyhow!("CSV headers cannot be blank"));
        }
        let mut seen = HashSet::new();
        if columns.iter().any(|name| !seen.insert(name.to_lowercase())) {
            return Err(anyhow!("CSV headers must be unique"));
        }
        (columns.clone(), columns, None)
    } else {
        let columns = (1..=first.len())
            .map(|index| format!("Column {index}"))
            .collect();
        let keys = (0..first.len()).map(|index| index.to_string()).collect();
        (columns, keys, Some(first))
    };
    let mut rows = Vec::new();
    let mut total_rows = 0;
    for (index, record) in first_data.into_iter().map(Ok).chain(records).enumerate() {
        let record = record?;
        if record.len() != source_keys.len() {
            return Err(anyhow!(
                "CSV row {} has a different number of columns",
                index + 1
            ));
        }
        if index < skip_rows as usize {
            continue;
        }
        total_rows += 1;
        if rows.len() < 10 {
            rows.push(record.iter().map(str::to_string).collect());
        }
    }
    if total_rows == 0 {
        return Err(anyhow!("CSV has no rows to import after skipped rows"));
    }
    Ok(CsvInspection {
        columns,
        source_keys,
        rows,
        total_rows,
    })
}

fn resolve_mapping(
    source_keys: &[String],
    mapping: &HashMap<String, String>,
) -> Result<Vec<(usize, String)>> {
    if mapping.keys().any(|key| !source_keys.contains(key)) {
        return Err(anyhow!("Column mapping contains an unknown CSV column"));
    }
    let mut result = Vec::new();
    let mut targets = HashSet::new();
    for (index, source) in source_keys.iter().enumerate() {
        let target = if mapping.is_empty() {
            Some(source)
        } else {
            mapping.get(source)
        };
        if let Some(target) = target {
            let target = target.trim();
            if target.is_empty() || !targets.insert(target.to_lowercase()) {
                return Err(anyhow!(
                    "Mapped destination columns must be nonempty and unique"
                ));
            }
            result.push((index, target.to_string()));
        }
    }
    if result.is_empty() {
        return Err(anyhow!("Map at least one CSV column"));
    }
    Ok(result)
}

#[tauri::command]
pub async fn preview_csv(
    file_path: String,
    delimiter: char,
    has_header: bool,
    skip_rows: u32,
) -> Result<CsvPreview, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<CsvPreview> {
        let delimiter = delimiter_byte(delimiter)?;
        let (file_size, modified_ns) = file_stamp(&file_path)?;
        let inspection = inspect_reader(File::open(&file_path)?, delimiter, has_header, skip_rows)?;
        if file_stamp(&file_path)? != (file_size, modified_ns.clone()) {
            return Err(anyhow!(
                "The CSV changed while it was being previewed. Try again."
            ));
        }
        Ok(CsvPreview {
            columns: inspection.columns,
            source_keys: inspection.source_keys,
            rows: inspection.rows,
            total_rows: inspection.total_rows,
            file_size,
            modified_ns,
        })
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_csv(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    import_id: String,
    options: CsvImportOptions,
    expected_database: String,
    approval_token: Option<Uuid>,
) -> Result<(), String> {
    let operation = crate::core::execution_policy::Operation::CsvImport(
        serde_json::to_value(&options).map_err(|e| e.to_string())?,
    );
    let guard = crate::authorize_execution(
        &state,
        connection_id,
        &expected_database,
        &operation,
        approval_token,
    )
    .await?;
    let manager = state.connection_manager.clone();

    tokio::spawn(async move {
        let _guard = guard;
        let result = do_import_csv(
            app_handle.clone(),
            &manager,
            &connection_id,
            &import_id,
            &options,
        )
        .await;

        if let Err(e) = result {
            let _ = app_handle.emit(
                "import-progress",
                ImportProgress {
                    import_id: import_id.clone(),
                    rows_processed: 0,
                    total_rows: None,
                    percentage: None,
                    status: "error".to_string(),
                    error: Some(e.to_string()),
                },
            );
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
    if options.table_name.trim().is_empty()
        || options.batch_size == 0
        || options.batch_size > 10_000
    {
        return Err(anyhow!(
            "Choose a target table and a batch size between 1 and 10000"
        ));
    }
    let delimiter = delimiter_byte(options.delimiter)?;
    let expected_stamp = (
        options.preview_file_size,
        options.preview_modified_ns.clone(),
    );
    if file_stamp(&options.file_path)? != expected_stamp {
        return Err(anyhow!(
            "The CSV changed since preview. Preview it again before importing."
        ));
    }
    let inspection = inspect_reader(
        File::open(&options.file_path)?,
        delimiter,
        options.has_header,
        options.skip_rows,
    )?;
    if file_stamp(&options.file_path)? != expected_stamp {
        return Err(anyhow!(
            "The CSV changed since preview. Preview it again before importing."
        ));
    }
    if !options.has_header && options.column_mapping.is_empty() {
        return Err(anyhow!("Map columns when the CSV has no header"));
    }
    let mapping = resolve_mapping(&inspection.source_keys, &options.column_mapping)?;
    let columns: Vec<String> = mapping.iter().map(|(_, column)| column.clone()).collect();

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
    }
    .ok_or_else(|| anyhow!("Connection not found"))?;

    if options.create_table_if_missing {
        create_table_if_not_exists(manager, connection_id, &options.table_name, &columns).await?;
    }
    let structure =
        QueryEngine::get_table_structure(manager, connection_id, &options.table_name).await?;
    if structure.columns.is_empty() {
        return Err(anyhow!(
            "Target table was not found. Check the table name and database."
        ));
    }
    let target_columns: HashSet<&str> = structure
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    if let Some(column) = columns
        .iter()
        .find(|column| !target_columns.contains(column.as_str()))
    {
        return Err(anyhow!(
            "Destination column '{}' does not exist in the target table",
            column
        ));
    }

    let pool_guard = match db_type {
        "postgres" => {
            let pools = manager.get_postgres_pools().await;
            let pool = pools
                .get(connection_id)
                .ok_or_else(|| anyhow!("Pool not found"))?;
            InsertTarget::Postgres(pool.clone())
        }
        "mysql" => {
            let pools = manager.get_mysql_pools().await;
            let pool = pools
                .get(connection_id)
                .ok_or_else(|| anyhow!("Pool not found"))?;
            InsertTarget::MySql(pool.clone())
        }
        "sqlite" => {
            let pools = manager.get_sqlite_pools().await;
            let pool = pools
                .get(connection_id)
                .ok_or_else(|| anyhow!("Pool not found"))?;
            InsertTarget::Sqlite(pool.clone())
        }
        _ => return Err(anyhow!("Unsupported database type")),
    };
    let sql = insert_sql(&options.table_name, &columns, db_type);
    let mut tx = match &pool_guard {
        InsertTarget::Postgres(pool) => CsvTransaction::Postgres(pool.begin().await?),
        InsertTarget::MySql(pool) => CsvTransaction::MySql(pool.begin().await?),
        InsertTarget::Sqlite(pool) => CsvTransaction::Sqlite(pool.begin().await?),
    };
    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(options.has_header)
        .from_reader(File::open(&options.file_path)?);
    let mut rows_processed = 0u64;
    for result in reader.records().skip(options.skip_rows as usize) {
        let record = result?;
        if record.len() != inspection.source_keys.len() {
            return Err(anyhow!("CSV column count changed during import"));
        }
        tx.insert(&sql, &record, &mapping).await?;
        rows_processed += 1;
        if rows_processed % options.batch_size as u64 == 0 {
            app_handle.emit(
                "import-progress",
                ImportProgress {
                    import_id: import_id.to_string(),
                    rows_processed,
                    total_rows: Some(inspection.total_rows),
                    percentage: Some(rows_processed as f32 * 100.0 / inspection.total_rows as f32),
                    status: "processing".to_string(),
                    error: None,
                },
            )?;
        }
    }
    if rows_processed != inspection.total_rows || file_stamp(&options.file_path)? != expected_stamp
    {
        return Err(anyhow!(
            "The CSV changed during import. No rows were committed."
        ));
    }
    tx.commit().await?;

    let _ = app_handle.emit(
        "import-progress",
        ImportProgress {
            import_id: import_id.to_string(),
            rows_processed,
            total_rows: Some(rows_processed),
            percentage: Some(100.0),
            status: "complete".to_string(),
            error: None,
        },
    );

    Ok(())
}

fn insert_sql(table_name: &str, columns: &[String], db_type: &str) -> String {
    let quoted_table = match db_type {
        "mysql" => format!("`{}`", table_name.replace("`", "``")),
        _ => format!("\"{}\"", table_name.replace("\"", "\"\"")),
    };

    let quoted_columns: Vec<String> = columns
        .iter()
        .map(|c| match db_type {
            "mysql" => format!("`{}`", c.replace("`", "``")),
            _ => format!("\"{}\"", c.replace("\"", "\"\"")),
        })
        .collect();

    let placeholders: Vec<String> = (0..columns.len())
        .map(|i| match db_type {
            "postgres" => format!("${}", i + 1),
            _ => "?".to_string(),
        })
        .collect();

    format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quoted_table,
        quoted_columns.join(", "),
        placeholders.join(", ")
    )
}

enum CsvTransaction {
    Postgres(sqlx::Transaction<'static, sqlx::Postgres>),
    MySql(sqlx::Transaction<'static, sqlx::MySql>),
    Sqlite(sqlx::Transaction<'static, sqlx::Sqlite>),
}

impl CsvTransaction {
    async fn insert(
        &mut self,
        sql: &str,
        record: &csv::StringRecord,
        mapping: &[(usize, String)],
    ) -> Result<()> {
        match self {
            Self::Postgres(tx) => {
                let mut query = sqlx::query(sql);
                for (index, _) in mapping {
                    query = query.bind(record.get(*index).unwrap_or(""));
                }
                query.execute(&mut **tx).await?;
            }
            Self::MySql(tx) => {
                let mut query = sqlx::query(sql);
                for (index, _) in mapping {
                    query = query.bind(record.get(*index).unwrap_or(""));
                }
                query.execute(&mut **tx).await?;
            }
            Self::Sqlite(tx) => {
                let mut query = sqlx::query(sql);
                for (index, _) in mapping {
                    query = query.bind(record.get(*index).unwrap_or(""));
                }
                query.execute(&mut **tx).await?;
            }
        }
        Ok(())
    }

    async fn commit(self) -> Result<()> {
        match self {
            Self::Postgres(tx) => tx.commit().await?,
            Self::MySql(tx) => tx.commit().await?,
            Self::Sqlite(tx) => tx.commit().await?,
        }
        Ok(())
    }
}

async fn create_table_if_not_exists(
    manager: &crate::core::connection_manager::ConnectionManager,
    connection_id: &Uuid,
    table_name: &str,
    columns: &[String],
) -> Result<()> {
    // Table creation is separate from the row transaction and may leave an empty table on failure.
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
    }
    .ok_or_else(|| anyhow!("Connection not found"))?;

    // 3. Build CREATE TABLE statement
    let quoted_table = match db_type {
        "mysql" => format!("`{}`", table_name.replace("`", "``")),
        _ => format!("\"{}\"", table_name.replace("\"", "\"\"")),
    };

    let col_defs: Vec<String> = columns
        .iter()
        .map(|c| {
            let quoted_col = match db_type {
                "mysql" => format!("`{}`", c.replace("`", "``")),
                _ => format!("\"{}\"", c.replace("\"", "\"\"")),
            };
            format!("{} TEXT", quoted_col)
        })
        .collect();

    let sql = format!(
        "CREATE TABLE IF NOT EXISTS {} ({})",
        quoted_table,
        col_defs.join(", ")
    );

    // 4. Execute
    match db_type {
        "postgres" => {
            let pools = manager.get_postgres_pools().await;
            let pool = pools
                .get(connection_id)
                .ok_or_else(|| anyhow!("Pool not found"))?;
            sqlx::query(&sql).execute(pool).await?;
        }
        "mysql" => {
            let pools = manager.get_mysql_pools().await;
            let pool = pools
                .get(connection_id)
                .ok_or_else(|| anyhow!("Pool not found"))?;
            sqlx::query(&sql).execute(pool).await?;
        }
        "sqlite" => {
            let pools = manager.get_sqlite_pools().await;
            let pool = pools
                .get(connection_id)
                .ok_or_else(|| anyhow!("Pool not found"))?;
            sqlx::query(&sql).execute(pool).await?;
        }
        _ => return Err(anyhow!("Unsupported database type")),
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn preview_counts_rows_after_skipping_and_keeps_only_a_sample() {
        let input = Cursor::new("name,age\nignored,0\nAda,37\nLin,42\n");
        let preview = inspect_reader(input, b',', true, 1).unwrap();
        assert_eq!(preview.columns, vec!["name", "age"]);
        assert_eq!(preview.source_keys, vec!["name", "age"]);
        assert_eq!(preview.total_rows, 2);
        assert_eq!(preview.rows, vec![vec!["Ada", "37"], vec!["Lin", "42"]]);
    }

    #[test]
    fn preview_rejects_duplicate_headers_and_inconsistent_rows() {
        assert!(inspect_reader(Cursor::new("id,id\n1,2\n"), b',', true, 0).is_err());
        assert!(inspect_reader(Cursor::new("id,name\n1\n"), b',', true, 0).is_err());
    }

    #[test]
    fn mapping_rejects_duplicate_targets_and_missing_source_columns() {
        let sources = vec!["id".to_string(), "name".to_string()];
        let duplicate = HashMap::from([
            ("id".to_string(), "same".to_string()),
            ("name".to_string(), "same".to_string()),
        ]);
        assert!(resolve_mapping(&sources, &duplicate).is_err());
        let unknown = HashMap::from([("missing".to_string(), "id".to_string())]);
        assert!(resolve_mapping(&sources, &unknown).is_err());
        assert_eq!(
            resolve_mapping(&sources, &HashMap::new()).unwrap(),
            vec![(0, "id".to_string()), (1, "name".to_string())]
        );
    }

    #[test]
    fn headerless_csv_uses_stable_index_keys() {
        let preview = inspect_reader(Cursor::new("Ada,37\nLin,42\n"), b',', false, 0).unwrap();
        assert_eq!(preview.columns, vec!["Column 1", "Column 2"]);
        assert_eq!(preview.source_keys, vec!["0", "1"]);
        assert_eq!(preview.total_rows, 2);
    }

    #[tokio::test]
    async fn a_failed_insert_rolls_back_earlier_rows() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE items (name TEXT UNIQUE)")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = CsvTransaction::Sqlite(pool.begin().await.unwrap());
        let mapping = vec![(0, "name".to_string())];
        let record = csv::StringRecord::from(vec!["Ada"]);
        tx.insert("INSERT INTO items (name) VALUES (?)", &record, &mapping)
            .await
            .unwrap();
        assert!(tx
            .insert("INSERT INTO items (name) VALUES (?)", &record, &mapping)
            .await
            .is_err());
        drop(tx);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
