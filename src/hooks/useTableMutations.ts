import { useState, useCallback } from 'react';
import { quoteIdentifier, type DatabaseType } from '../utils/sqlIdentifiers';
import { buildRowMutationBatch, type RowChange, type RowValue } from '../utils/rowMutations';
import { getSessionChanges, setSessionChanges } from '../utils/rowDrafts';
import { isSensitiveColumn } from '../utils/sensitiveData';
export type { RowChange } from '../utils/rowMutations';

export interface MutationState {
  changes: Map<number, RowChange>;
  hasChanges: boolean;
}

export interface UseTableMutationsReturn {
  state: MutationState;
  updateCell: (rowIndex: number, columnName: string, columnIndex: number, originalValue: RowValue, newValue: RowValue, originalData: RowValue[]) => void;
  insertRow: (rowIndex: number, data: RowValue[]) => void;
  deleteRow: (rowIndex: number, originalData: RowValue[]) => void;
  revertRow: (rowIndex: number) => void;
  revertAll: () => void;
  restore: (changes: Map<number, RowChange>) => void;
  getRowState: (rowIndex: number) => RowChange | undefined;
  generateSQL: (
    tableName: string,
    columns: string[],
    primaryKeyColumns: string[],
    databaseType?: DatabaseType
  ) => string[];
}

export function useTableMutations(context: string): UseTableMutationsReturn {
  const [changes, setLocalChanges] = useState<Map<number, RowChange>>(() => getSessionChanges(context) || new Map());
  const setChanges = useCallback((updater: (previous: Map<number, RowChange>) => Map<number, RowChange>) => {
    const next = updater(getSessionChanges(context) || new Map());
    setSessionChanges(context, next);
    setLocalChanges(next);
  }, [context]);

  const updateCell = useCallback((
    rowIndex: number,
    columnName: string,
    columnIndex: number,
    originalValue: RowValue,
    newValue: RowValue,
    originalData: RowValue[]
  ) => {
    setChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(rowIndex);

      if (existing?.type === 'insert') {
        // For new rows, just update the newData
        if (existing.newData) {
          next.set(rowIndex, { ...existing, newData: existing.newData.map((value, index) =>
            index === columnIndex ? newValue : value) });
        }
        return next;
      }

      if (existing?.type === 'update') {
        const cellChanges = [...(existing.cellChanges || [])];
        const existingCellIndex = cellChanges.findIndex(c => c.columnName === columnName);
        
        if (existingCellIndex >= 0) {
          if (cellChanges[existingCellIndex].originalValue === newValue) {
            cellChanges.splice(existingCellIndex, 1);
            if (cellChanges.length === 0) {
              next.delete(rowIndex);
              return next;
            }
          } else {
            cellChanges[existingCellIndex] = {
              ...cellChanges[existingCellIndex],
              newValue
            };
          }
        } else {
          cellChanges.push({ rowIndex, columnName, originalValue, newValue });
        }
        
        next.set(rowIndex, {
          ...existing,
          cellChanges
        });
        return next;
      }

      // New update
      if (originalValue === newValue) {
        return prev; // No change
      }

      next.set(rowIndex, {
        type: 'update',
        rowIndex,
        originalData: [...originalData],
        cellChanges: [{ rowIndex, columnName, originalValue, newValue }]
      });
      return next;
    });
  }, [setChanges]);

  const insertRow = useCallback((rowIndex: number, data: RowValue[]) => {
    setChanges(prev => {
      const next = new Map(prev);
      next.set(rowIndex, {
        type: 'insert',
        rowIndex,
        newData: [...data]
      });
      return next;
    });
  }, [setChanges]);

  const deleteRow = useCallback((rowIndex: number, originalData: RowValue[]) => {
    setChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(rowIndex);

      // If it was a new row, just remove it entirely
      if (existing?.type === 'insert') {
        next.delete(rowIndex);
        for (const [index, change] of [...next]) {
          if (change.type === 'insert' && index > rowIndex) {
            next.delete(index);
            next.set(index - 1, { ...change, rowIndex: index - 1 });
          }
        }
        return next;
      }

      next.set(rowIndex, {
        type: 'delete',
        rowIndex,
        originalData: [...originalData]
      });
      return next;
    });
  }, [setChanges]);

  const revertRow = useCallback((rowIndex: number) => {
    setChanges(prev => {
      const next = new Map(prev);
      const wasInsert = next.get(rowIndex)?.type === 'insert';
      next.delete(rowIndex);
      if (wasInsert) {
        for (const [index, change] of [...next]) {
          if (change.type === 'insert' && index > rowIndex) {
            next.delete(index);
            next.set(index - 1, { ...change, rowIndex: index - 1 });
          }
        }
      }
      return next;
    });
  }, [setChanges]);

  const revertAll = useCallback(() => {
    setChanges(() => new Map());
  }, [setChanges]);

  const restore = useCallback((restored: Map<number, RowChange>) => {
    setChanges(() => restored);
  }, [setChanges]);

  const getRowState = useCallback((rowIndex: number) => {
    return changes.get(rowIndex);
  }, [changes]);

  const generateSQL = useCallback((
    tableName: string,
    columns: string[],
    primaryKeyColumns: string[],
    databaseType: DatabaseType = 'Postgres'
  ): string[] => {
    const batch = buildRowMutationBatch(tableName, columns, primaryKeyColumns, [...changes.values()]);
    const quotedTableName = quoteIdentifier(tableName, databaseType);
    const literal = (value: RowValue, column?: string) => column && isSensitiveColumn(column) && value !== null ? "'[REDACTED]'"
      : value === null ? 'NULL'
      : typeof value === 'string' ? `'${value.replace(/\\/g, databaseType === 'MySql' ? '\\\\' : '\\').replace(/'/g, "''")}'`
      : String(value);
    const predicate = (column: string, value: RowValue) =>
      `${quoteIdentifier(column, databaseType)} ${value === null ? 'IS NULL' : `= ${literal(value, column)}`}`;
    return batch.changes.map(change => {
      const values = change.values || {};
      if (change.kind === 'insert') {
        return `INSERT INTO ${quotedTableName} (${Object.keys(values).map(c => quoteIdentifier(c, databaseType)).join(', ')}) VALUES (${Object.entries(values).map(([column, value]) => literal(value, column)).join(', ')});`;
      }
      const original = change.original || {};
      const checked = change.kind === 'delete' ? Object.keys(original)
        : [...new Set([...primaryKeyColumns, ...Object.keys(values)])];
      const where = checked.map(column => predicate(column, original[column])).join(' AND ');
      if (change.kind === 'delete') return `DELETE FROM ${quotedTableName} WHERE ${where};`;
      const set = Object.entries(values).map(([column, value]) =>
        `${quoteIdentifier(column, databaseType)} = ${literal(value, column)}`).join(', ');
      return `UPDATE ${quotedTableName} SET ${set} WHERE ${where};`;
    });
  }, [changes]);

  return {
    state: {
      changes,
      hasChanges: changes.size > 0
    },
    updateCell,
    insertRow,
    deleteRow,
    revertRow,
    revertAll,
    restore,
    getRowState,
    generateSQL
  };
}
