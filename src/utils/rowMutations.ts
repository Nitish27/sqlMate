export type RowValue = string | number | boolean | null;

export interface CellChange {
  rowIndex: number;
  columnName: string;
  originalValue: RowValue;
  newValue: RowValue;
}

export interface RowChange {
  type: 'insert' | 'update' | 'delete';
  rowIndex: number;
  originalData?: RowValue[];
  newData?: RowValue[];
  cellChanges?: CellChange[];
}

export interface RowMutation {
  kind: 'insert' | 'update' | 'delete';
  original?: Record<string, RowValue>;
  values?: Record<string, RowValue>;
}

export interface RowMutationBatch {
  table_name: string;
  primary_key_columns: string[];
  changes: RowMutation[];
}

export function applyStagedRows(
  columns: string[], data: RowValue[][], changes: Map<number, RowChange>,
): RowValue[][] {
  return data.map((row, rowIndex) => {
    const change = changes.get(rowIndex);
    if (change?.type === 'insert' && change.newData) return [...change.newData];
    if (change?.type !== 'update' || !change.cellChanges) return row;
    const updated = [...row];
    for (const cell of change.cellChanges) {
      const columnIndex = columns.indexOf(cell.columnName);
      if (columnIndex >= 0) updated[columnIndex] = cell.newValue;
    }
    return updated;
  });
}

const isScalar = (value: unknown): value is RowValue =>
  value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value)
    && (!Number.isInteger(value) || Number.isSafeInteger(value)));

const isUnreadable = (value: RowValue) => typeof value === 'string'
  && /^(Binary\/Complex|BinaryErr|NumError)\s*\(/.test(value);

const rowObject = (columns: string[], data: RowValue[]): Record<string, RowValue> => {
  if (data.length !== columns.length) throw new Error('The row shape changed. Refresh before editing.');
  return Object.fromEntries(columns.map((column, index) => {
    const value = data[index];
    if (!isScalar(value)) {
      throw new Error(`Column ${column} cannot be safely edited from this grid.`);
    }
    return [column, value];
  }));
};

export function rowIdentity(
  columns: string[], data: RowValue[], primaryKeys: string[],
): Record<string, RowValue> | null {
  if (primaryKeys.length === 0) return null;
  const identity: Record<string, RowValue> = {};
  for (const key of primaryKeys) {
    const index = columns.indexOf(key);
    const value = data[index];
    if (index < 0 || value === null || !isScalar(value) || isUnreadable(value)) return null;
    identity[key] = value;
  }
  return identity;
}

export function buildRowMutationBatch(
  tableName: string,
  columns: string[],
  primaryKeys: string[],
  changes: RowChange[],
): RowMutationBatch {
  if (!tableName || columns.length === 0 || new Set(columns).size !== columns.length) {
    throw new Error('The table columns are unavailable or ambiguous. Refresh before editing.');
  }
  const result: RowMutation[] = changes.map(change => {
    if (change.type === 'insert') {
      if (!change.newData) throw new Error('New row data is missing.');
      const values = rowObject(columns, change.newData);
      if (Object.values(values).some(isUnreadable)) throw new Error('An inserted value is not readable.');
      return { kind: 'insert', values };
    }
    if (!change.originalData || !rowIdentity(columns, change.originalData, primaryKeys)) {
      throw new Error('This row has no reliable primary key. It is read-only.');
    }
    const original = rowObject(columns, change.originalData);
    if (change.type === 'delete') {
      if (Object.values(original).some(isUnreadable)) {
        throw new Error('This row has unreadable columns and cannot be safely deleted.');
      }
      return { kind: 'delete', original };
    }
    const values: Record<string, RowValue> = {};
    for (const cell of change.cellChanges || []) {
      if (!columns.includes(cell.columnName) || !isScalar(cell.newValue)
        || isUnreadable(cell.newValue) || isUnreadable(original[cell.columnName])) {
        throw new Error('An edited value or column is unsupported.');
      }
      if (cell.newValue !== original[cell.columnName]) values[cell.columnName] = cell.newValue;
    }
    if (Object.keys(values).length === 0) throw new Error('There are no actual changes to commit.');
    return { kind: 'update', original, values };
  });
  return { table_name: tableName, primary_key_columns: primaryKeys, changes: result };
}
