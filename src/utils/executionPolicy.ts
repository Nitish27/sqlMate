import { invoke } from '@tauri-apps/api/core';
import type { RowMutationBatch } from './rowMutations';

export type ExecutionOperation =
  | { kind: 'sql'; payload: string }
  | { kind: 'row_changes'; payload: RowMutationBatch }
  | { kind: 'create_database'; payload: string }
  | { kind: 'csv_import' | 'sql_import'; payload: Record<string, unknown> };

export async function requestExecutionApproval(
  connectionId: string,
  expectedDatabase: string,
  operation: ExecutionOperation,
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
    const details = operation.kind === 'sql' ? operation.payload
      : operation.kind === 'row_changes' ? `Save ${Array.isArray(operation.payload.changes) ? operation.payload.changes.length : 0} row change(s) in ${String(operation.payload.table_name || '')}`
      : operation.kind === 'create_database' ? `Create database: ${operation.payload}`
      : `${operation.kind === 'csv_import' ? 'Import CSV' : 'Import SQL'}: ${String(operation.payload.file_path || '')}`;
    if (!window.confirm(`Run on ${database}?\n\n${details}`)) {
      throw new Error('Execution cancelled');
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
  const approvalToken = await requestExecutionApproval(connectionId, expectedDatabase, operation);
  return invoke<T>(command, {
    ...args,
    connectionId,
    expectedDatabase,
    approvalToken,
  });
}
