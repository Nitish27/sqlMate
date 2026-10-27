use serde_json::{json, Map, Value};
use sqlmate_db_lib::core::connection_manager::ConnectionManager;
use sqlmate_db_lib::core::data_compare::get_comparison_rows;
use sqlmate_db_lib::core::execution_policy::{ExecutionPolicy, Operation, SafetyMode};
use sqlmate_db_lib::core::query_engine::QueryEngine;
use sqlmate_db_lib::core::query_parameters::{
    compile_query, DatabaseDialect, ParameterValue, QueryParameter,
};
use sqlmate_db_lib::core::relationships::get_relationships;
use sqlmate_db_lib::core::row_commit::{
    commit_row_changes, MutationKind, RowMutation, RowMutationBatch,
};
use sqlmate_db_lib::core::schema_snapshot::get_schema_snapshot;
use sqlmate_db_lib::core::{ConnectionConfig, DatabaseType};
use uuid::Uuid;

fn smoke_config(database_type: DatabaseType, port: u16) -> ConnectionConfig {
    serde_json::from_value(json!({
        "id": Uuid::new_v4(),
        "name": "Disposable smoke test",
        "db_type": database_type,
        "host": "127.0.0.1",
        "port": port,
        "username": "sqlmate_smoke",
        "database": "sqlmate_smoke",
        "ssl_enabled": false,
        "ssh_enabled": false,
        "safety_mode": "Safe"
    }))
    .unwrap()
}

fn update(id: i64, old_label: &str, new_label: &str) -> RowMutation {
    RowMutation {
        kind: MutationKind::Update,
        original: Some(Map::from_iter([
            ("id".to_string(), json!(id)),
            ("label".to_string(), json!(old_label)),
        ])),
        values: Some(Map::from_iter([("label".to_string(), json!(new_label))])),
    }
}

fn batch(table: &str, changes: Vec<RowMutation>) -> RowMutationBatch {
    RowMutationBatch {
        table_name: table.to_string(),
        primary_key_columns: vec!["id".to_string()],
        changes,
    }
}

async fn run_smoke(database_type: DatabaseType, port: u16) {
    assert_eq!(
        std::env::var("SQLMATE_SMOKE").as_deref(),
        Ok("1"),
        "Set SQLMATE_SMOKE=1 only after starting the disposable smoke Compose stack"
    );

    let config = smoke_config(database_type.clone(), port);
    let reconnect_config = config.clone();
    let id = config.id;
    let manager = ConnectionManager::new();
    assert!(manager
        .test_connection(config.clone(), Some("incorrect-smoke-password".to_string()))
        .await
        .is_err());
    manager
        .test_connection(config.clone(), Some("sqlmate-smoke-only".to_string()))
        .await
        .unwrap();
    manager
        .connect(config, Some("sqlmate-smoke-only".to_string()))
        .await
        .unwrap();

    let table = format!("smoke_items_{}", Uuid::new_v4().simple());
    QueryEngine::execute_query(
        &manager,
        &id,
        &format!("CREATE TABLE {table} (id BIGINT PRIMARY KEY, label VARCHAR(100) NOT NULL)"),
        None,
        None,
    )
    .await
    .unwrap();
    QueryEngine::execute_query(
        &manager,
        &id,
        &format!("INSERT INTO {table} (id, label) VALUES (1, 'original'), (2, 'second')"),
        None,
        None,
    )
    .await
    .unwrap();

    let references = format!("smoke_references_{}", Uuid::new_v4().simple());
    QueryEngine::execute_query(
        &manager,
        &id,
        &format!("CREATE TABLE {references} (id BIGINT PRIMARY KEY, item_id BIGINT NOT NULL, FOREIGN KEY (item_id) REFERENCES {table}(id))"),
        None,
        None,
    )
    .await
    .unwrap();
    let structure = QueryEngine::get_table_structure(&manager, &id, &references)
        .await
        .unwrap();
    assert!(structure
        .foreign_keys
        .iter()
        .any(|key| key.source_columns == ["item_id"]
            && key.target_table == table
            && key.target_columns == ["id"]));

    let relationships = get_relationships(&manager, &id).await.unwrap();
    assert!(relationships
        .iter()
        .any(|edge| edge.source_table == references
            && edge.source_columns == ["item_id"]
            && edge.target_table == table
            && edge.target_columns == ["id"]));

    let snapshot = get_schema_snapshot(&manager, &id).await.unwrap();
    assert_eq!(snapshot.database, "sqlmate_smoke");
    let snapshot_table = snapshot
        .tables
        .iter()
        .find(|entry| entry.name == table)
        .unwrap();
    let label = snapshot_table
        .columns
        .iter()
        .find(|column| column.name == "label")
        .unwrap();
    assert!(!label.is_nullable);
    let data_type = label.data_type.to_lowercase();
    assert!(data_type.contains("varchar") || data_type.contains("character varying"));
    assert!(data_type.contains("100"));
    assert!(
        snapshot_table
            .columns
            .iter()
            .find(|column| column.name == "id")
            .unwrap()
            .is_primary_key
    );
    let compared = get_comparison_rows(
        &manager,
        &id,
        snapshot_table.schema.clone(),
        table.clone(),
        1,
    )
    .await
    .unwrap();
    assert_eq!(compared.primary_key, ["id"]);
    assert_eq!(compared.columns, ["id", "label"]);
    assert_eq!(compared.rows, [vec![Some("1".into()), Some("original".into())]]);
    assert!(compared.has_more);
    if matches!(&database_type, DatabaseType::Postgres) {
        let schema = format!("smoke_schema_{}", Uuid::new_v4().simple());
        QueryEngine::execute_query(
            &manager,
            &id,
            &format!("CREATE SCHEMA {schema}"),
            None,
            None,
        )
        .await
        .unwrap();
        QueryEngine::execute_query(
            &manager,
            &id,
            &format!("CREATE TABLE {schema}.{table} (id BIGINT PRIMARY KEY)"),
            None,
            None,
        )
        .await
        .unwrap();
        QueryEngine::execute_query(
            &manager,
            &id,
            &format!("CREATE TABLE {schema}.{references} (item_id BIGINT REFERENCES {schema}.{table}(id))"),
            None,
            None,
        )
        .await
        .unwrap();
        let relationships = get_relationships(&manager, &id).await.unwrap();
        assert!(relationships
            .iter()
            .any(|edge| edge.source_schema.as_deref() == Some(&schema)
                && edge.source_table == references
                && edge.target_schema.as_deref() == Some(&schema)
                && edge.target_table == table));
        let snapshot = get_schema_snapshot(&manager, &id).await.unwrap();
        let same_name: Vec<_> = snapshot
            .tables
            .iter()
            .filter(|entry| entry.name == table)
            .collect();
        assert_eq!(same_name.len(), 2);
        assert!(same_name
            .iter()
            .any(|entry| entry.schema.as_deref() == Some("public")));
        assert!(same_name
            .iter()
            .any(|entry| entry.schema.as_deref() == Some(&schema)));
        QueryEngine::execute_query(
            &manager,
            &id,
            &format!("DROP SCHEMA {schema} CASCADE"),
            None,
            None,
        )
        .await
        .unwrap();
    }

    let policy = ExecutionPolicy::default();
    let read_sql = format!("SELECT label FROM {table} WHERE id = 1");
    let read = Operation::Sql(read_sql.clone());
    policy
        .authorize(
            SafetyMode::Safe,
            id,
            "sqlmate_smoke",
            "sqlmate_smoke",
            &read,
            None,
        )
        .await
        .unwrap();
    let rows = QueryEngine::execute_read_only_query(&manager, &id, &read_sql, None, None)
        .await
        .unwrap();
    assert_eq!(rows.rows[0][0], Value::String("original".to_string()));
    let template = format!("SELECT label FROM {table} WHERE id = :id OR id = :id");
    let parameter = QueryParameter {
        name: "id".into(),
        value: ParameterValue::Integer(1),
    };
    match database_type {
        DatabaseType::Postgres => {
            let compiled =
                compile_query(&template, &[parameter], DatabaseDialect::Postgres).unwrap();
            assert_eq!(compiled.values.len(), 1);
            let pools = manager.get_postgres_pools().await;
            let row: (String,) = sqlx::query_as(&compiled.sql)
                .bind(1_i64)
                .fetch_one(pools.get(&id).unwrap())
                .await
                .unwrap();
            assert_eq!(row.0, "original");
        }
        DatabaseType::MySql => {
            let compiled = compile_query(&template, &[parameter], DatabaseDialect::MySql).unwrap();
            assert_eq!(compiled.values.len(), 2);
            let pools = manager.get_mysql_pools().await;
            let row: (String,) = sqlx::query_as(&compiled.sql)
                .bind(1_i64)
                .bind(1_i64)
                .fetch_one(pools.get(&id).unwrap())
                .await
                .unwrap();
            assert_eq!(row.0, "original");
        }
        DatabaseType::Sqlite => unreachable!(),
    }
    assert!(QueryEngine::execute_read_only_query(
        &manager,
        &id,
        &format!("UPDATE {table} SET label = 'blocked' WHERE id = 1"),
        None,
        None,
    )
    .await
    .is_err());

    let edit_batch = batch(&table, vec![update(1, "original", "edited")]);
    let write = Operation::RowChanges(serde_json::to_value(&edit_batch).unwrap());
    assert!(policy
        .authorize(
            SafetyMode::Safe,
            id,
            "sqlmate_smoke",
            "sqlmate_smoke",
            &write,
            None
        )
        .await
        .is_err());
    assert!(policy
        .authorize(
            SafetyMode::Alert,
            id,
            "sqlmate_smoke",
            "sqlmate_smoke",
            &write,
            None
        )
        .await
        .is_err());
    let token = policy
        .prepare(SafetyMode::Alert, id, "sqlmate_smoke", write.clone())
        .await
        .unwrap();
    policy
        .authorize(
            SafetyMode::Alert,
            id,
            "sqlmate_smoke",
            "sqlmate_smoke",
            &write,
            Some(token),
        )
        .await
        .unwrap();
    assert!(policy
        .authorize(
            SafetyMode::Alert,
            id,
            "sqlmate_smoke",
            "sqlmate_smoke",
            &write,
            Some(token),
        )
        .await
        .is_err());

    let plan = QueryEngine::explain_query(&manager, &id, &read_sql)
        .await
        .unwrap();
    assert!(plan.plan.as_array().is_some_and(|steps| !steps.is_empty()));

    assert_eq!(
        commit_row_changes(&manager, &id, edit_batch).await.unwrap(),
        1
    );
    let conflict = batch(
        &table,
        vec![
            update(1, "edited", "rolled back"),
            update(2, "stale", "never saved"),
        ],
    );
    assert!(commit_row_changes(&manager, &id, conflict).await.is_err());
    let result = QueryEngine::execute_query(
        &manager,
        &id,
        &format!("SELECT label FROM {table} WHERE id = 1"),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(result.rows[0][0], Value::String("edited".to_string()));
    let second = QueryEngine::execute_query(
        &manager,
        &id,
        &format!("SELECT label FROM {table} WHERE id = 2"),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(second.rows[0][0], Value::String("second".to_string()));

    manager.disconnect(&id).await.unwrap();
    assert!(manager.get_config(&id).await.is_err());
    manager
        .connect(reconnect_config, Some("sqlmate-smoke-only".to_string()))
        .await
        .unwrap();
    assert!(manager.get_config(&id).await.is_ok());
    manager.disconnect(&id).await.unwrap();
}

#[tokio::test]
#[ignore = "requires the disposable smoke Compose stack and SQLMATE_SMOKE=1"]
async fn postgres_release_smoke() {
    run_smoke(DatabaseType::Postgres, 15433).await;
}

#[tokio::test]
#[ignore = "requires the disposable smoke Compose stack and SQLMATE_SMOKE=1"]
async fn mariadb_release_smoke() {
    run_smoke(DatabaseType::MySql, 13307).await;
}

#[tokio::test]
#[ignore = "requires the disposable smoke Compose stack and SQLMATE_SMOKE=1"]
async fn mariadb_nullable_datetime_grid_edit() {
    assert_eq!(std::env::var("SQLMATE_SMOKE").as_deref(), Ok("1"));
    let config = smoke_config(DatabaseType::MySql, 13307);
    let id = config.id;
    let manager = ConnectionManager::new();
    manager
        .connect(config, Some("sqlmate-smoke-only".to_string()))
        .await
        .unwrap();
    let table = format!("smoke_datetime_{}", Uuid::new_v4().simple());
    QueryEngine::execute_query(
        &manager,
        &id,
        &format!("CREATE TABLE {table} (id BIGINT PRIMARY KEY, deleted_at DATETIME NULL)"),
        None,
        None,
    )
    .await
    .unwrap();
    QueryEngine::execute_query(
        &manager,
        &id,
        &format!("INSERT INTO {table} VALUES (300263, '2026-02-09 06:40:14')"),
        None,
        None,
    )
    .await
    .unwrap();
    let before = QueryEngine::execute_query(
        &manager,
        &id,
        &format!("SELECT id, deleted_at FROM {table} WHERE id = 300263"),
        None,
        None,
    )
    .await
    .unwrap();
    let original = Map::from_iter([
        ("id".to_string(), before.rows[0][0].clone()),
        ("deleted_at".to_string(), before.rows[0][1].clone()),
    ]);
    assert_eq!(
        commit_row_changes(
            &manager,
            &id,
            batch(
                &table,
                vec![RowMutation {
                    kind: MutationKind::Update,
                    original: Some(original),
                    values: Some(Map::from_iter([("deleted_at".to_string(), Value::Null)])),
                }]
            )
        )
        .await
        .unwrap(),
        1
    );
    let after = QueryEngine::execute_query(
        &manager,
        &id,
        &format!("SELECT deleted_at FROM {table} WHERE id = 300263"),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(after.rows[0][0], Value::Null);
    manager.disconnect(&id).await.unwrap();
}
