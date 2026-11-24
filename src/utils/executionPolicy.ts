import { invoke } from '@tauri-apps/api/core';
import type { RowMutationBatch } from './rowMutations';
import { useDatabaseStore } from '../store/databaseStore';
import { connectionIdentity } from './connectionClarity';
import { requestReview } from './actionReview';
import { connectionTargetFingerprint } from './connectionTarget';

export type ExecutionOperation =
  | { kind: 'sql'; payload: string }
  | { kind: 'row_changes'; payload: RowMutationBatch }
  | { kind: 'create_database'; payload: string }
  | { kind: 'csv_import' | 'sql_import'; payload: Record<string, unknown> };

export async function requestExecutionApproval(
  connectionId: string,
  expectedDatabase: string,
  operation: ExecutionOperation,
  action = 'Run',
): Promise<string | undefined> {
  const [database, mode] = await invoke<[string, 'Silent' | 'Alert' | 'Safe']>('get_execution_context', { connectionId });
  if (database !== expectedDatabase) {
    throw new Error('The database changed. Review the target and try again.');
  }
  if (mode === 'Safe') {
    if (operation.kind === 'sql') return undefined;
    throw new Error('Safe mode blocks data changes on this connection.');
  }

  if (mode === 'Alert') {
    operation = structuredClone(operation);
    const connection = useDatabaseStore.getState().savedConnections.find(item => item.id === connectionId);
    const target = connection ? connectionIdentity({ ...connection, database }).description : database;
    const details = operation.kind === 'sql' ? operation.payload
      : operation.kind === 'row_changes' ? `Table: ${operation.payload.table_name}\n${operation.payload.changes.map(change => change.kind).join(', ')}`
      : operation.kind === 'create_database' ? `Create database: ${operation.payload}`
      : `${operation.kind === 'csv_import' ? 'Import CSV' : 'Import SQL'}: ${String(operation.payload.file_path || '')}`;
    if (await requestReview({ title: 'Review database operation', description: target, details,
      actions: [{ id: 'run', label: operation.kind === 'sql' ? action : 'Approve operation' }],
    }) !== 'run') {
      throw new Error('Execution cancelled');
    }
    const current = useDatabaseStore.getState().savedConnections.find(item => item.id === connectionId);
    if (connection && (!current || connectionTargetFingerprint(connection) !== connectionTargetFingerprint(current))) {
      throw new Error('The connection target changed. Review the operation again.');
    }
    return invoke<string>('prepare_execution', {
      connectionId, expectedDatabase, operation,
    });
  }

  return undefined;
}

export async function invokeWithExecutionPolicy<T>(
  command: string,
  connectionId: string,
  expectedDatabase: string,
  operation: ExecutionOperation,
  args: Record<string, unknown>,
): Promise<T> {
  args = structuredClone(args);
  const approvalToken = await requestExecutionApproval(connectionId, expectedDatabase, operation);
  return invoke<T>(command, {
    ...args,
    connectionId,
    expectedDatabase,
    approvalToken,
  });
}
