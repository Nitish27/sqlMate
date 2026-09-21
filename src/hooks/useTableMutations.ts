import { useState, useCallback } from 'react';
import { quoteIdentifier, type DatabaseType } from '../utils/sqlIdentifiers';

export interface CellChange {
  rowIndex: number;
  columnName: string;
  originalValue: any;
  newValue: any;
}

export interface RowChange {
  type: 'insert' | 'update' | 'delete';
  rowIndex: number;
  primaryKeyValue?: any;
  originalData?: any[];
  newData?: any[];
  cellChanges?: CellChange[];
}

export interface MutationState {
  changes: Map<number, RowChange>;
  hasChanges: boolean;
}

export interface UseTableMutationsReturn {
  state: MutationState;
  updateCell: (rowIndex: number, columnName: string, columnIndex: number, originalValue: any, newValue: any, primaryKeyValue: any) => void;
  insertRow: (rowIndex: number, data: any[]) => void;
  deleteRow: (rowIndex: number, primaryKeyValue: any, originalData: any[]) => void;
  updateRow: (rowIndex: number, rowData: any[], columns: string[], primaryKeyValue: any) => void;
  revertRow: (rowIndex: number) => void;
  revertAll: () => void;
  getRowState: (rowIndex: number) => RowChange | undefined;
  generateSQL: (
    tableName: string,
    columns: string[],
    primaryKeyColumn?: string,
    databaseType?: DatabaseType
  ) => string[];
}

export function useTableMutations(): UseTableMutationsReturn {
  const [changes, setChanges] = useState<Map<number, RowChange>>(new Map());

  const updateCell = useCallback((
    rowIndex: number,
    columnName: string,
    columnIndex: number,
    originalValue: any,
    newValue: any,
    primaryKeyValue: any
  ) => {
    setChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(rowIndex);

      if (existing?.type === 'insert') {
        // For new rows, just update the newData
        if (existing.newData) {
          existing.newData[columnIndex] = newValue;
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
        primaryKeyValue,
        cellChanges: [{ rowIndex, columnName, originalValue, newValue }]
      });
      return next;
    });
  }, []);

  const insertRow = useCallback((rowIndex: number, data: any[]) => {
    setChanges(prev => {
      const next = new Map(prev);
      next.set(rowIndex, {
        type: 'insert',
        rowIndex,
        newData: [...data]
      });
      return next;
    });
  }, []);

  const deleteRow = useCallback((rowIndex: number, primaryKeyValue: any, originalData: any[]) => {
    setChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(rowIndex);

      // If it was a new row, just remove it entirely
      if (existing?.type === 'insert') {
        next.delete(rowIndex);
        return next;
      }

      next.set(rowIndex, {
        type: 'delete',
        rowIndex,
        primaryKeyValue,
        originalData: [...originalData]
      });
      return next;
    });
  }, []);

  const updateRow = useCallback((rowIndex: number, rowData: any[], columns: string[], primaryKeyValue: any) => {
    setChanges(prev => {
      const next = new Map(prev);
      const cellChanges = columns.map((name, idx) => ({
        rowIndex,
        columnName: name,
        originalValue: rowData[idx],
        newValue: rowData[idx]
      }));

      next.set(rowIndex, {
        type: 'update',
        rowIndex,
        primaryKeyValue,
        cellChanges
      });
      return next;
    });
  }, []);

  const revertRow = useCallback((rowIndex: number) => {
    setChanges(prev => {
      const next = new Map(prev);
      next.delete(rowIndex);
      return next;
    });
  }, []);

  const revertAll = useCallback(() => {
    setChanges(new Map());
  }, []);

  const getRowState = useCallback((rowIndex: number) => {
    return changes.get(rowIndex);
  }, [changes]);

  const generateSQL = useCallback((
    tableName: string,
    columns: string[],
    primaryKeyColumn: string = 'id',
    databaseType: DatabaseType = 'Postgres'
  ): string[] => {
    const statements: string[] = [];
    const quotedTableName = quoteIdentifier(tableName, databaseType);

    changes.forEach((change) => {
      if (change.type === 'insert' && change.newData) {
        const values = change.newData.map(v => 
          v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v
        );
        statements.push(
          `INSERT INTO ${quotedTableName} (${columns.map(c => quoteIdentifier(c, databaseType)).join(', ')}) VALUES (${values.join(', ')});`
        );
      } else if (change.type === 'update' && change.cellChanges) {
        const pkVal = change.primaryKeyValue !== undefined ? (
          typeof change.primaryKeyValue === 'string' ? `'${change.primaryKeyValue.replace(/'/g, "''")}'` : change.primaryKeyValue
        ) : change.cellChanges[0]?.rowIndex;

        const setClauses = change.cellChanges.map(cc => {
          const val = cc.newValue === null ? 'NULL' : 
            typeof cc.newValue === 'string' ? `'${cc.newValue.replace(/'/g, "''")}'` : cc.newValue;
          return `${quoteIdentifier(cc.columnName, databaseType)} = ${val}`;
        });
        
        statements.push(
          `UPDATE ${quotedTableName} SET ${setClauses.join(', ')} WHERE ${quoteIdentifier(primaryKeyColumn, databaseType)} = ${pkVal};`
        );
      } else if (change.type === 'delete' && change.primaryKeyValue !== undefined) {
        const pkVal = typeof change.primaryKeyValue === 'string' 
          ? `'${change.primaryKeyValue.replace(/'/g, "''")}'` 
          : change.primaryKeyValue;
        statements.push(
          `DELETE FROM ${quotedTableName} WHERE ${quoteIdentifier(primaryKeyColumn, databaseType)} = ${pkVal};`
        );
      }
    });

    return statements;
  }, [changes]);

  return {
    state: {
      changes,
      hasChanges: changes.size > 0
    },
    updateCell,
    insertRow,
    deleteRow,
    updateRow,
    revertRow,
    revertAll,
    getRowState,
    generateSQL
  };
}
