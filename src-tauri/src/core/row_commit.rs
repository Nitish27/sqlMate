#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn columns() -> Vec<TableColumnStructure> {
        ["tenant_id", "id", "name"]
            .into_iter()
            .map(|name| TableColumnStructure {
                name: name.to_string(),
                data_type: if name == "name" { "text" } else { "integer" }.to_string(),
                is_nullable: false,
                default_value: None,
                is_primary_key: name != "name",
                comment: None,
            })
            .collect()
    }

    #[test]
    fn plans_a_composite_key_update_with_original_value_check() {
        let batch = RowMutationBatch {
            table_name: "users".to_string(),
            primary_key_columns: vec!["tenant_id".to_string(), "id".to_string()],
            changes: vec![RowMutation {
                kind: MutationKind::Update,
                original: Some(
                    serde_json::from_value(json!({"tenant_id": 7, "id": 42, "name": "old"}))
                        .unwrap(),
                ),
                values: Some(serde_json::from_value(json!({"name": "new"})).unwrap()),
            }],
        };
        let plans = plan_batch(&batch, &columns(), "sqlite").unwrap();
        assert_eq!(plans.len(), 1);
        assert!(plans[0].sql.contains("\"tenant_id\" IS ?"));
        assert!(plans[0].sql.contains("\"id\" IS ?"));
        assert!(plans[0].sql.contains("\"name\" IS ?"));
        assert_eq!(
            plans[0].binds,
            vec![json!("new"), json!(7), json!(42), json!("old")]
        );
    }

    #[test]
    fn mysql_datetime_conflict_check_uses_database_datetime_format() {
        let mut columns = columns();
        columns.push(TableColumnStructure {
            name: "deleted_at".to_string(),
            data_type: "datetime".to_string(),
            is_nullable: true,
            default_value: None,
            is_primary_key: false,
            comment: None,
        });
        let batch = RowMutationBatch {
            table_name: "company_targets".to_string(),
            primary_key_columns: vec!["tenant_id".to_string(), "id".to_string()],
            changes: vec![RowMutation {
                kind: MutationKind::Update,
                original: Some(
                    serde_json::from_value(json!({
                        "tenant_id": 7, "id": 300263, "name": "test",
                        "deleted_at": "2026-02-09T06:40:14+00:00"
                    }))
                    .unwrap(),
                ),
                values: Some(serde_json::from_value(json!({"deleted_at": null})).unwrap()),
            }],
        };
        let plans = plan_batch(&batch, &columns, "mysql").unwrap();
        assert!(plans[0].sql.contains("`deleted_at` = ?"));
        assert!(plans[0].sql.contains("`deleted_at` <=> ?"));
        assert_eq!(
            plans[0].binds,
            vec![
                json!(null),
                json!(7),
                json!(300263),
                json!("2026-02-09 06:40:14")
            ]
        );
    }

    #[test]
    fn refuses_a_write_when_the_table_has_no_primary_key() {
        let batch = RowMutationBatch {
            table_name: "users".to_string(),
            primary_key_columns: vec![],
            changes: vec![RowMutation {
                kind: MutationKind::Delete,
                original: Some(serde_json::from_value(json!({"id": 42})).unwrap()),
                values: None,
            }],
        };
        let mut no_key = columns();
        for column in &mut no_key {
            column.is_primary_key = false;
        }
        assert!(plan_batch(&batch, &no_key, "sqlite").is_err());
    }

    #[test]
    fn postgres_plans_target_the_public_table_used_for_metadata() {
        let batch = RowMutationBatch {
            table_name: "users".to_string(),
            primary_key_columns: vec!["tenant_id".to_string(), "id".to_string()],
            changes: vec![RowMutation {
                kind: MutationKind::Delete,
                original: Some(
                    serde_json::from_value(json!({"tenant_id": 7, "id": 42, "name": "old"}))
                        .unwrap(),
                ),
                values: None,
            }],
        };
        let plans = plan_batch(&batch, &columns(), "postgres").unwrap();
        assert!(plans[0].sql.starts_with("DELETE FROM \"public\".\"users\""));
    }

    #[test]
    fn missing_server_metadata_refuses_inserts_too() {
        let batch = RowMutationBatch {
            table_name: "users".to_string(),
            primary_key_columns: vec![],
            changes: vec![RowMutation {
                kind: MutationKind::Insert,
                original: None,
                values: Some(serde_json::from_value(json!({"name": "new"})).unwrap()),
            }],
        };
        assert!(plan_batch(&batch, &[], "postgres").is_err());
    }

    #[tokio::test]
    async fn sqlite_conflict_rolls_back_the_entire_batch() {
        let manager = ConnectionManager::new();
        let id = Uuid::new_v4();
        let config: crate::core::ConnectionConfig = serde_json::from_value(json!({
            "id": id, "name": "test", "db_type": "Sqlite", "host": null, "port": null,
            "username": null, "database": ":memory:", "ssl_enabled": false, "ssl_mode": null,
            "ssl_ca_path": null, "ssl_cert_path": null, "ssl_key_path": null,
            "ssh_enabled": false, "ssh_host": null, "ssh_port": null,
            "ssh_username": null, "ssh_auth_method": null, "ssh_password": null,
            "ssh_private_key_path": null, "environment": null, "color_tag": null
        }))
        .unwrap();
        manager.connect(config, None).await.unwrap();
        let pool = manager.get_sqlite_pools().await.get(&id).unwrap().clone();
        sqlx::query("CREATE TABLE users (tenant_id INTEGER, id INTEGER, name TEXT, PRIMARY KEY (tenant_id, id))")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO users VALUES (7, 42, 'old'), (7, 43, 'other')")
            .execute(&pool)
            .await
            .unwrap();
        let update = |id: i64, original_name: &str, new_name: &str| RowMutation {
            kind: MutationKind::Update,
            original: Some(
                serde_json::from_value(json!({"tenant_id": 7, "id": id, "name": original_name}))
                    .unwrap(),
            ),
            values: Some(serde_json::from_value(json!({"name": new_name})).unwrap()),
        };
        let batch = RowMutationBatch {
            table_name: "users".to_string(),
            primary_key_columns: vec!["tenant_id".to_string(), "id".to_string()],
            changes: vec![update(42, "old", "new"), update(43, "stale", "changed")],
        };
        assert!(commit_row_changes(&manager, &id, batch).await.is_err());
        let name: String = sqlx::query_scalar("SELECT name FROM users WHERE id = 42")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "old");

        let batch = RowMutationBatch {
            table_name: "users".to_string(),
            primary_key_columns: vec!["tenant_id".to_string(), "id".to_string()],
            changes: vec![update(42, "old", "a'\\b; DROP TABLE users; --")],
        };
        assert_eq!(commit_row_changes(&manager, &id, batch).await.unwrap(), 1);
        let name: String = sqlx::query_scalar("SELECT name FROM users WHERE id = 42")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "a'\\b; DROP TABLE users; --");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }
}
use crate::core::{
    connection_manager::ConnectionManager, query_engine::QueryEngine, TableColumnStructure,
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RowMutationBatch {
    pub table_name: String,
    pub primary_key_columns: Vec<String>,
    pub changes: Vec<RowMutation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RowMutation {
    pub kind: MutationKind,
    pub original: Option<Map<String, Value>>,
    pub values: Option<Map<String, Value>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationKind {
    Insert,
    Update,
    Delete,
}

#[derive(Debug)]
struct SqlPlan {
    sql: String,
    binds: Vec<Value>,
}

fn quote_identifier(name: &str, dialect: &str) -> String {
    if dialect == "mysql" {
        format!("`{}`", name.replace('`', "``"))
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

fn pg_cast(data_type: &str) -> Result<&'static str> {
    match data_type.to_ascii_lowercase().as_str() {
        "smallint" => Ok("smallint"),
        "integer" => Ok("integer"),
        "bigint" => Ok("bigint"),
        "real" => Ok("real"),
        "double precision" => Ok("double precision"),
        "numeric" | "decimal" => Ok("numeric"),
        "boolean" => Ok("boolean"),
        "text" => Ok("text"),
        "character varying" => Ok("character varying"),
        "character" => Ok("character"),
        "uuid" => Ok("uuid"),
        "date" => Ok("date"),
        "time without time zone" => Ok("time without time zone"),
        "time with time zone" => Ok("time with time zone"),
        "timestamp without time zone" => Ok("timestamp without time zone"),
        "timestamp with time zone" => Ok("timestamp with time zone"),
        _ => Err(anyhow!(
            "Column type {} is not supported for safe grid edits",
            data_type
        )),
    }
}

fn add_bind(
    plan: &mut SqlPlan,
    value: &Value,
    column: &TableColumnStructure,
    dialect: &str,
) -> Result<String> {
    if !(value.is_null() || value.is_boolean() || value.is_number() || value.is_string()) {
        return Err(anyhow!(
            "Complex values cannot be safely edited in the grid"
        ));
    }
    if let Some(text) = value.as_str() {
        if text.starts_with("Binary/Complex (")
            || text.starts_with("BinaryErr(")
            || text.starts_with("NumError(")
        {
            return Err(anyhow!("Column {} has a non-editable value", column.name));
        }
    }
    let lower = column.data_type.to_ascii_lowercase();
    if dialect != "postgres"
        && (lower.contains("blob") || lower.contains("binary") || lower.contains("geometry"))
    {
        return Err(anyhow!(
            "Column {} has an unsupported binary type",
            column.name
        ));
    }
    let bind_value = if dialect == "mysql"
        && (lower.contains("datetime") || lower.contains("timestamp"))
    {
        value
            .as_str()
            .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
            .map(|date| Value::String(date.naive_utc().format("%Y-%m-%d %H:%M:%S%.f").to_string()))
            .unwrap_or_else(|| value.clone())
    } else {
        value.clone()
    };
    plan.binds.push(bind_value);
    if dialect == "postgres" {
        Ok(format!(
            "CAST(CAST(${} AS text) AS {})",
            plan.binds.len(),
            pg_cast(&column.data_type)?
        ))
    } else {
        Ok("?".to_string())
    }
}

fn plan_batch(
    batch: &RowMutationBatch,
    columns: &[TableColumnStructure],
    dialect: &str,
) -> Result<Vec<SqlPlan>> {
    if batch.table_name.is_empty() || batch.changes.is_empty() || batch.changes.len() > 500 {
        return Err(anyhow!(
            "A commit needs 1 to 500 row changes and a table name"
        ));
    }
    if columns.is_empty() {
        return Err(anyhow!(
            "Table structure is unavailable. Refresh before committing."
        ));
    }
    let server_keys: Vec<&str> = columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.as_str())
        .collect();
    let supplied_keys: HashSet<&str> = batch
        .primary_key_columns
        .iter()
        .map(String::as_str)
        .collect();
    if batch.primary_key_columns.len() != server_keys.len()
        || supplied_keys.len() != server_keys.len()
        || server_keys.iter().any(|key| !supplied_keys.contains(key))
    {
        return Err(anyhow!(
            "The primary key changed. Refresh the table before committing."
        ));
    }
    let quoted_table = if dialect == "postgres" {
        format!(
            "\"public\".{}",
            quote_identifier(&batch.table_name, dialect)
        )
    } else {
        quote_identifier(&batch.table_name, dialect)
    };
    let mut plans = Vec::with_capacity(batch.changes.len());
    for change in &batch.changes {
        let mut plan = SqlPlan {
            sql: String::new(),
            binds: Vec::new(),
        };
        let values = change.values.as_ref();
        let original = change.original.as_ref();
        let checked_columns = |names: &Map<String, Value>| -> Result<()> {
            if names
                .keys()
                .any(|name| !columns.iter().any(|c| c.name == *name))
            {
                return Err(anyhow!("A column changed. Refresh before committing."));
            }
            Ok(())
        };
        if let Some(map) = values {
            checked_columns(map)?;
        }
        if let Some(map) = original {
            checked_columns(map)?;
        }

        match change.kind {
            MutationKind::Insert => {
                let values = values.ok_or_else(|| anyhow!("Insert values are missing"))?;
                if values.is_empty() || original.is_some() {
                    return Err(anyhow!("Invalid insert payload"));
                }
                let insert_columns: Vec<&TableColumnStructure> = columns
                    .iter()
                    .filter(|c| values.contains_key(&c.name))
                    .collect();
                let placeholders = insert_columns
                    .iter()
                    .map(|column| add_bind(&mut plan, &values[&column.name], column, dialect))
                    .collect::<Result<Vec<_>>>()?;
                plan.sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    quoted_table,
                    insert_columns
                        .iter()
                        .map(|c| quote_identifier(&c.name, dialect))
                        .collect::<Vec<_>>()
                        .join(", "),
                    placeholders.join(", ")
                );
            }
            MutationKind::Update | MutationKind::Delete => {
                if server_keys.is_empty() {
                    return Err(anyhow!("Rows without a primary key are read-only"));
                }
                let original =
                    original.ok_or_else(|| anyhow!("Original row values are missing"))?;
                if original.len() != columns.len()
                    || columns.iter().any(|c| !original.contains_key(&c.name))
                {
                    return Err(anyhow!(
                        "Original row is incomplete. Refresh before committing."
                    ));
                }
                for key in &server_keys {
                    if original[*key].is_null() {
                        return Err(anyhow!("Null primary keys cannot be edited"));
                    }
                }
                let checked: Vec<&TableColumnStructure> = if change.kind == MutationKind::Update {
                    let values = values.ok_or_else(|| anyhow!("Update values are missing"))?;
                    if values.is_empty() {
                        return Err(anyhow!("Update has no changed values"));
                    }
                    let updated = columns
                        .iter()
                        .filter(|c| values.contains_key(&c.name))
                        .collect::<Vec<_>>();
                    let assignments = updated
                        .iter()
                        .map(|column| {
                            let placeholder =
                                add_bind(&mut plan, &values[&column.name], column, dialect)?;
                            Ok(format!(
                                "{} = {}",
                                quote_identifier(&column.name, dialect),
                                placeholder
                            ))
                        })
                        .collect::<Result<Vec<_>>>()?;
                    plan.sql = format!("UPDATE {} SET {}", quoted_table, assignments.join(", "));
                    let mut checked = columns
                        .iter()
                        .filter(|c| c.is_primary_key)
                        .collect::<Vec<_>>();
                    checked.extend(updated.into_iter().filter(|c| !c.is_primary_key));
                    checked
                } else {
                    if values.is_some() {
                        return Err(anyhow!("Delete must not contain new values"));
                    }
                    plan.sql = format!("DELETE FROM {}", quoted_table);
                    columns
                        .iter()
                        .filter(|c| c.is_primary_key)
                        .chain(columns.iter().filter(|c| !c.is_primary_key))
                        .collect()
                };
                let predicate = match dialect {
                    "postgres" => "IS NOT DISTINCT FROM",
                    "mysql" => "<=>",
                    _ => "IS",
                };
                let conditions = checked
                    .iter()
                    .map(|column| {
                        let placeholder =
                            add_bind(&mut plan, &original[&column.name], column, dialect)?;
                        Ok(format!(
                            "{} {} {}",
                            quote_identifier(&column.name, dialect),
                            predicate,
                            placeholder
                        ))
                    })
                    .collect::<Result<Vec<_>>>()?;
                plan.sql
                    .push_str(&format!(" WHERE {}", conditions.join(" AND ")));
            }
        }
        plans.push(plan);
    }
    Ok(plans)
}

pub async fn commit_row_changes(
    manager: &ConnectionManager,
    connection_id: &Uuid,
    batch: RowMutationBatch,
) -> Result<u64> {
    let structure =
        QueryEngine::get_table_structure(manager, connection_id, &batch.table_name).await?;
    macro_rules! execute_plans {
        ($pool:expr, $database:ty, $dialect:literal) => {{
            let plans = plan_batch(&batch, &structure.columns, $dialect)?;
            let mut transaction = $pool.begin().await?;
            for plan in &plans {
                let mut query = sqlx::query::<$database>(&plan.sql);
                for value in &plan.binds {
                    if $dialect == "postgres" {
                        query = query.bind(if value.is_null() {
                            None
                        } else {
                            Some(
                                value
                                    .as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(|| value.to_string()),
                            )
                        });
                    } else {
                        query = match value {
                            Value::Null => query.bind(None::<String>),
                            Value::Bool(v) => query.bind(*v),
                            Value::Number(v) if v.is_i64() => query.bind(v.as_i64().unwrap()),
                            Value::Number(v)
                                if v.is_u64() && v.as_u64().unwrap() <= i64::MAX as u64 =>
                            {
                                query.bind(v.as_u64().unwrap() as i64)
                            }
                            Value::Number(v) => {
                                query.bind(v.as_f64().ok_or_else(|| anyhow!("Unsupported number"))?)
                            }
                            Value::String(v) => query.bind(v.clone()),
                            _ => return Err(anyhow!("Unsupported value")),
                        };
                    }
                }
                let result = match query.execute(&mut *transaction).await {
                    Ok(result) => result,
                    Err(error) => {
                        transaction.rollback().await?;
                        return Err(error.into());
                    }
                };
                if result.rows_affected() != 1 {
                    transaction.rollback().await?;
                    return Err(anyhow!(
                        "Row conflict: expected one affected row, got {}. No changes were saved.",
                        result.rows_affected()
                    ));
                }
            }
            transaction.commit().await?;
            return Ok(plans.len() as u64);
        }};
    }
    if let Some(pool) = manager
        .get_postgres_pools()
        .await
        .get(connection_id)
        .cloned()
    {
        execute_plans!(pool, sqlx::Postgres, "postgres");
    }
    if let Some(pool) = manager.get_mysql_pools().await.get(connection_id).cloned() {
        execute_plans!(pool, sqlx::MySql, "mysql");
    }
    if let Some(pool) = manager.get_sqlite_pools().await.get(connection_id).cloned() {
        execute_plans!(pool, sqlx::Sqlite, "sqlite");
    }
    Err(anyhow!("Connection not found"))
}
