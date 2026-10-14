use crate::core::read_only_sql::validate_read_only_sql;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum SafetyMode {
    #[default]
    Silent,
    Alert,
    Safe,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub enum Operation {
    Sql(String),
    RowChanges(serde_json::Value),
    CreateDatabase(String),
    CsvImport(serde_json::Value),
    SqlImport(serde_json::Value),
}

#[derive(Clone)]
struct Approval {
    connection_id: Uuid,
    database: String,
    operation: Operation,
    created_at: Instant,
}

#[derive(Default)]
pub struct ExecutionPolicy {
    approvals: Mutex<HashMap<Uuid, Approval>>,
}

impl ExecutionPolicy {
    pub async fn prepare(
        &self,
        mode: SafetyMode,
        connection_id: Uuid,
        database: &str,
        operation: Operation,
    ) -> Result<Uuid, String> {
        if mode != SafetyMode::Alert {
            return Err("This connection does not accept execution approvals".to_string());
        }
        let token = Uuid::new_v4();
        let mut approvals = self.approvals.lock().await;
        approvals.retain(|_, approval| approval.created_at.elapsed() < Duration::from_secs(120));
        approvals.insert(
            token,
            Approval {
                connection_id,
                database: database.to_string(),
                operation,
                created_at: Instant::now(),
            },
        );
        Ok(token)
    }

    pub async fn authorize(
        &self,
        mode: SafetyMode,
        connection_id: Uuid,
        actual_database: &str,
        expected_database: &str,
        operation: &Operation,
        approval_token: Option<Uuid>,
    ) -> Result<(), String> {
        if actual_database != expected_database {
            return Err("The database changed. Review the target and try again.".to_string());
        }
        match mode {
            SafetyMode::Silent => Ok(()),
            SafetyMode::Safe => match operation {
                Operation::Sql(sql) => validate_read_only_sql(sql),
                _ => Err("Safe mode blocks data changes on this connection".to_string()),
            },
            SafetyMode::Alert => {
                let token =
                    approval_token.ok_or("Alert mode requires approval for this operation")?;
                let approval = self
                    .approvals
                    .lock()
                    .await
                    .remove(&token)
                    .ok_or("Approval expired or was already used")?;
                if approval.created_at.elapsed() >= Duration::from_secs(120)
                    || approval.connection_id != connection_id
                    || approval.database != actual_database
                    || approval.operation != *operation
                {
                    return Err(
                        "Approval does not match this connection, database, or operation"
                            .to_string(),
                    );
                }
                Ok(())
            }
        }
    }

    pub async fn revoke_connection(&self, connection_id: Uuid) {
        self.approvals
            .lock()
            .await
            .retain(|_, approval| approval.connection_id != connection_id);
    }
}

#[cfg(test)]
mod tests {
    use super::{ExecutionPolicy, Operation, SafetyMode};
    use serde_json::json;
    use uuid::Uuid;

    #[tokio::test]
    async fn approval_is_bound_to_connection_database_and_exact_sql_and_used_once() {
        let policy = ExecutionPolicy::default();
        let connection_id = Uuid::new_v4();
        let operation = Operation::Sql("DELETE FROM users".to_string());
        let token = policy
            .prepare(SafetyMode::Alert, connection_id, "dev", operation.clone())
            .await
            .unwrap();
        assert!(policy
            .authorize(
                SafetyMode::Alert,
                connection_id,
                "prod",
                "dev",
                &operation,
                Some(token)
            )
            .await
            .is_err());
        assert!(policy
            .authorize(
                SafetyMode::Alert,
                connection_id,
                "dev",
                "dev",
                &Operation::Sql("DELETE FROM admins".to_string()),
                Some(token)
            )
            .await
            .is_err());
        assert!(policy
            .authorize(
                SafetyMode::Alert,
                connection_id,
                "dev",
                "dev",
                &operation,
                Some(token)
            )
            .await
            .is_err());
        let token = policy
            .prepare(SafetyMode::Alert, connection_id, "dev", operation.clone())
            .await
            .unwrap();
        assert!(policy
            .authorize(
                SafetyMode::Alert,
                connection_id,
                "dev",
                "dev",
                &operation,
                Some(token)
            )
            .await
            .is_ok());
        assert!(policy
            .authorize(
                SafetyMode::Alert,
                connection_id,
                "dev",
                "dev",
                &operation,
                Some(token)
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn safe_blocks_execution_even_with_approval_and_silent_rejects_stale_context() {
        let policy = ExecutionPolicy::default();
        let connection_id = Uuid::new_v4();
        let operation = Operation::RowChanges(json!({"table_name": "users", "changes": []}));
        let token = policy
            .prepare(SafetyMode::Alert, connection_id, "dev", operation.clone())
            .await
            .unwrap();
        assert!(policy
            .authorize(
                SafetyMode::Safe,
                connection_id,
                "dev",
                "dev",
                &operation,
                Some(token)
            )
            .await
            .is_err());
        assert!(policy
            .authorize(
                SafetyMode::Silent,
                connection_id,
                "prod",
                "dev",
                &operation,
                None
            )
            .await
            .is_err());
        assert!(policy
            .authorize(
                SafetyMode::Silent,
                connection_id,
                "dev",
                "dev",
                &operation,
                None
            )
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn safe_allows_select_but_never_approves_writes() {
        let policy = ExecutionPolicy::default();
        let connection_id = Uuid::new_v4();
        assert!(policy
            .authorize(
                SafetyMode::Safe,
                connection_id,
                "dev",
                "dev",
                &Operation::Sql("SELECT * FROM users".to_string()),
                None,
            )
            .await
            .is_ok());
        assert!(policy
            .authorize(
                SafetyMode::Safe,
                connection_id,
                "dev",
                "dev",
                &Operation::Sql("DELETE FROM users".to_string()),
                None,
            )
            .await
            .is_err());
        assert!(policy
            .authorize(
                SafetyMode::Safe,
                connection_id,
                "dev",
                "prod",
                &Operation::Sql("SELECT * FROM users".to_string()),
                None,
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn changing_connection_policy_revokes_pending_approval() {
        let policy = ExecutionPolicy::default();
        let connection_id = Uuid::new_v4();
        let operation = Operation::Sql("DROP TABLE users".to_string());
        let token = policy
            .prepare(SafetyMode::Alert, connection_id, "dev", operation.clone())
            .await
            .unwrap();
        policy.revoke_connection(connection_id).await;
        assert!(policy
            .authorize(
                SafetyMode::Alert,
                connection_id,
                "dev",
                "dev",
                &operation,
                Some(token)
            )
            .await
            .is_err());
    }

    #[test]
    fn operation_payload_matches_the_frontend_contract() {
        let operation: Operation = serde_json::from_value(json!({
            "kind": "sql", "payload": "SELECT 1"
        }))
        .unwrap();
        assert_eq!(operation, Operation::Sql("SELECT 1".to_string()));
        assert_eq!(
            serde_json::to_value(operation).unwrap(),
            json!({
                "kind": "sql", "payload": "SELECT 1"
            })
        );
        let row_changes: Operation = serde_json::from_value(json!({
            "kind": "row_changes", "payload": {
                "table_name": "users", "primary_key_columns": ["id"], "changes": []
            }
        }))
        .unwrap();
        assert!(matches!(row_changes, Operation::RowChanges(_)));
    }
}
