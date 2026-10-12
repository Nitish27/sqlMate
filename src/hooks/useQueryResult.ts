import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDatabaseStore } from '../store/databaseStore';
import { invokeWithExecutionPolicy } from '../utils/executionPolicy';
// Simple ID generator for debugging
const generateId = () => Math.random().toString(36).substring(2, 11);

interface QueryStats {
  time: number;
  rows: number;
  totalRows?: number;
}

export const useQueryResult = (connectionId: string) => {
  const [rows, setRows] = useState<any[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<QueryStats | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(200);

  const queryIdRef = useRef<string | null>(null);
  const rowsBufferRef = useRef<any[][]>([]);

  const cancelQuery = useCallback(async () => {
    if (queryIdRef.current) {
      await invoke('cancel_query', { queryId: queryIdRef.current });
      queryIdRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const runQuery = useCallback(async (sql: string, newPage: number = 0) => {
    setIsLoading(true);
    setError(null);
    if (newPage === 0) {
      setRows([]);
      rowsBufferRef.current = [];
    }

    const queryId = generateId();
    queryIdRef.current = queryId;

    try {
      // Step 1: Execute paged query
      const state = useDatabaseStore.getState();
      const expectedDatabase = state.activeDatabases[connectionId]
        || state.savedConnections.find(connection => connection.id === connectionId)?.database || '';
      const result = await invokeWithExecutionPolicy<any>('execute_query', connectionId, expectedDatabase,
        { kind: 'sql', payload: sql }, {
        sql,
        page: newPage,
        pageSize
      });

      if (result.columns) {
        setColumns(result.columns);
        const newRows = result.rows || [];
        
        if (newPage === 0) {
          setRows(newRows);
        } else {
          setRows((prev: any[][]) => [...prev, ...newRows]);
        }
        
        setPage(newPage);
        setStats({
          time: result.execution_time_ms,
          rows: newRows.length,
          totalRows: result.total_count
        });
      }
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setIsLoading(false);
      queryIdRef.current = null;
    }
  }, [connectionId, pageSize]);

  return {
    rows,
    columns,
    isLoading,
    error,
    stats,
    page,
    runQuery,
    cancelQuery
  };
};
