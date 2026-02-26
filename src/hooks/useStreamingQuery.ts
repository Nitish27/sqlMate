import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { v4 as uuidv4 } from 'uuid';

export interface QueryStats {
  time: number;
  rows: number;
  totalRows?: number;
  affectedRows?: number;
}

export interface StreamingMetadata {
  query_id: string;
  columns: string[];
}

export interface StreamingBatch {
  query_id: string;
  rows: any[][];
}

export interface StreamingComplete {
  query_id: string;
  execution_time_ms: number;
  total_rows: number;
  affected_rows: number;
}

export const useStreamingQuery = (connectionId: string, initialData?: { rows?: any[][], columns?: string[], stats?: QueryStats | null }) => {
  const [rows, setRows] = useState<any[][]>(initialData?.rows || []);
  const [columns, setColumns] = useState<string[]>(initialData?.columns || []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<QueryStats | null>(initialData?.stats || null);
  
  // We use functional updates, but keeping refs can prevent stale closures
  const queryIdRef = useRef<string | null>(null);
  
  // We buffer row updates to prevent React from freezing due to too many state updates
  const rowBufferRef = useRef<any[][]>([]);
  const isBufferingRef = useRef(false);

  const flushBuffer = useCallback(() => {
    if (rowBufferRef.current.length > 0) {
      const chunk = [...rowBufferRef.current];
      rowBufferRef.current = []; // Clear immediately to allow new events to buffer
      
      setRows((prev) => [...prev, ...chunk]);
      setStats((prev) => prev ? { ...prev, rows: prev.rows + chunk.length } : null);
    }
    isBufferingRef.current = false;
  }, []);

  useEffect(() => {
    let unlistenMetadata: UnlistenFn | null = null;
    let unlistenBatch: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;
    let unlistenError: UnlistenFn | null = null;
    let isMounted = true;

    const setupListeners = async () => {
      const uMetadata = await listen<StreamingMetadata>('query-metadata', (event) => {
        if (event.payload.query_id !== queryIdRef.current) return;
        setColumns(event.payload.columns);
      });
      if (isMounted) unlistenMetadata = uMetadata; else uMetadata();

      const uBatch = await listen<StreamingBatch>('query-batch', (event) => {
        if (event.payload.query_id !== queryIdRef.current) return;
        rowBufferRef.current.push(...event.payload.rows);
        
        // Use requestAnimationFrame to batch UI updates and keep the thread free
        if (!isBufferingRef.current) {
          isBufferingRef.current = true;
          requestAnimationFrame(() => flushBuffer());
        }
      });
      if (isMounted) unlistenBatch = uBatch; else uBatch();

      const uComplete = await listen<StreamingComplete>('query-complete', (event) => {
        if (event.payload.query_id !== queryIdRef.current) return;
        
        flushBuffer(); // Ensure all remaining rows are flushed
        
        setStats({
          time: event.payload.execution_time_ms,
          rows: event.payload.total_rows,
          totalRows: event.payload.total_rows,
          affectedRows: event.payload.affected_rows
        });
        setIsLoading(false);
        queryIdRef.current = null;
      });
      if (isMounted) unlistenComplete = uComplete; else uComplete();

      const uError = await listen<{ query_id: string, error: string }>('query-error', (event) => {
        if (event.payload.query_id !== queryIdRef.current) return;
        
        flushBuffer();
        setError(event.payload.error);
        setIsLoading(false);
        queryIdRef.current = null;
      });
      if (isMounted) unlistenError = uError; else uError();
    };

    setupListeners();

    return () => {
      isMounted = false;
      if (unlistenMetadata) unlistenMetadata();
      if (unlistenBatch) unlistenBatch();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, [flushBuffer]);

  const cancelQuery = useCallback(async () => {
    if (queryIdRef.current) {
      try {
        await invoke('cancel_query', { queryId: queryIdRef.current });
      } catch (err) {
        console.error('Failed to cancel query:', err);
      }
      queryIdRef.current = null;
    }
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelQuery();
    };
  }, [cancelQuery]);

  const runQuery = useCallback(async (sql: string) => {
    // If a query is already running for this hook instance, cancel it first
    if (queryIdRef.current) {
      await cancelQuery();
    }

    // Reset state for new query
    setIsLoading(true);
    setError(null);
    setRows([]);
    setColumns([]);
    setStats({ time: 0, rows: 0, totalRows: undefined });
    rowBufferRef.current = [];
    isBufferingRef.current = false;

    try {
      const newQueryId = uuidv4();
      queryIdRef.current = newQueryId;
      
      await invoke('execute_query_streaming', {
        connectionId,
        queryId: newQueryId,
        sql
      });
    } catch (err: any) {
      setError(err.toString());
      setIsLoading(false);
      queryIdRef.current = null;
    }
  }, [connectionId, cancelQuery]);

  return {
    rows,
    columns,
    isLoading,
    error,
    stats,
    runQuery,
    cancelQuery
  };
};
