import { invoke } from '@tauri-apps/api/core';
import { rowIdentity, type RowChange, type RowValue } from './rowMutations';

export interface RowDraft {
  version: 1;
  columns: string[];
  primaryKeys: string[];
  changes: RowChange[];
}

export const rowDraftContext = (connectionId: string, database: string, table: string) =>
  JSON.stringify([connectionId, database, table]);

export const parseRowDraftContext = (context: string): [string, string, string] | null => {
  try {
    const parts: unknown = JSON.parse(context);
    if (Array.isArray(parts) && parts.length === 3 && parts.every(part => typeof part === 'string')) {
      return parts as [string, string, string];
    }
  } catch { /* Ignore contexts from unsupported draft versions. */ }
  return null;
};

const sessionChanges = new Map<string, Map<number, RowChange>>();
const sessionSchemas = new Map<string, Pick<RowDraft, 'columns' | 'primaryKeys'>>();
const sessionSchemaErrors = new Map<string, string>();
const persistenceBlocked = new Set<string>();
const writes = new Map<string, Promise<void>>();

export const hasPendingRowDraftWrites = () => writes.size > 0;
export const waitForRowDraftWrites = async () => {
  await Promise.allSettled([...writes.values()]);
};

export const getSessionChanges = (context: string) => sessionChanges.get(context);
export const getSessionSchema = (context: string) => sessionSchemas.get(context);
export const setSessionSchema = (context: string, schema: Pick<RowDraft, 'columns' | 'primaryKeys'>) => {
  sessionSchemas.set(context, schema);
};
export const getDraftSchemaError = (context: string) => sessionSchemaErrors.get(context) || null;
export const setDraftSchemaError = (context: string, error: string | null) => {
  if (error) sessionSchemaErrors.set(context, error);
  else sessionSchemaErrors.delete(context);
};
export const isDraftPersistenceBlocked = (context: string) => persistenceBlocked.has(context);
export const blockDraftPersistence = (context: string) => persistenceBlocked.add(context);
export const setSessionChanges = (context: string, changes: Map<number, RowChange>) => {
  sessionChanges.set(context, changes);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sqlmate:row-draft-changed', {
      detail: { context, changeCount: changes.size },
    }));
  }
};

export async function loadRowDraft(context: string): Promise<RowDraft | null> {
  const draft = await invoke<RowDraft | null>('load_row_draft', { context });
  if (!draft) return null;
  if (draft.version !== 1 || !Array.isArray(draft.columns)
    || !Array.isArray(draft.primaryKeys) || !Array.isArray(draft.changes)) {
    throw new Error('The saved row draft has an unsupported format.');
  }
  return draft;
}

export function queueRowDraftWrite(context: string, draft: RowDraft | null): Promise<void> {
  if (persistenceBlocked.has(context)) return Promise.resolve();
  const previous = writes.get(context) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => {
    if (persistenceBlocked.has(context)) return;
    return draft
      ? invoke<void>('save_row_draft', { context, draft })
      : invoke<void>('delete_row_draft', { context });
  }).catch(error => {
    persistenceBlocked.add(context);
    throw error;
  });
  writes.set(context, next);
  void next.finally(() => {
    if (writes.get(context) === next) writes.delete(context);
  }).catch(() => undefined);
  return next;
}

export function reconcileRowDraft(
  draft: RowDraft, columns: string[], primaryKeys: string[], rows: RowValue[][],
): Map<number, RowChange> {
  if (JSON.stringify(draft.columns) !== JSON.stringify(columns)
    || JSON.stringify(draft.primaryKeys) !== JSON.stringify(primaryKeys)) {
    throw new Error('The table structure changed. The draft was kept, but cannot be applied safely.');
  }

  const result = new Map<number, RowChange>();
  const identities = new Map<string, number>();
  rows.forEach((row, index) => {
    const identity = rowIdentity(columns, row, primaryKeys);
    if (identity) identities.set(JSON.stringify(identity), index);
  });
  let nextInsert = rows.length;
  let nextHidden = -1;
  for (const change of draft.changes) {
    let index: number;
    if (change.type === 'insert') {
      index = nextInsert++;
    } else {
      const identity = change.originalData && rowIdentity(columns, change.originalData, primaryKeys);
      if (!identity) throw new Error('A saved row has no reliable primary key. The draft was kept.');
      index = identities.get(JSON.stringify(identity)) ?? nextHidden--;
    }
    if (result.has(index)) throw new Error('The saved draft has conflicting row changes.');
    result.set(index, { ...change, rowIndex: index,
      cellChanges: change.cellChanges?.map(cell => ({ ...cell, rowIndex: index })) });
  }
  return result;
}
