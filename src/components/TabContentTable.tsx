import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { DataTable } from './DataTable';
import { PendingChanges } from './PendingChanges';
import { useTableMutations } from '../hooks/useTableMutations';
import { useDatabaseStore, SortConfig } from '../store/databaseStore';
import { TableFooter } from './TableFooter';
import { FilterBar } from './FilterBar';
import { ColumnVisibilityPopover } from './ColumnVisibilityPopover';
import { TabContentStructure } from './TabContentStructure';
import { ExportModal } from './ExportModal';
import { createDefaultTableFilter } from '../utils/tableFilters';
import { invokeWithExecutionPolicy } from '../utils/executionPolicy';
import { buildRowMutationBatch } from '../utils/rowMutations';
import {
  blockDraftPersistence,
  getDraftSchemaError,
  getSessionChanges,
  getSessionSchema,
  isDraftPersistenceBlocked,
  loadRowDraft,
  queueRowDraftWrite,
  reconcileRowDraft,
  rowDraftContext,
  setDraftSchemaError as rememberDraftSchemaError,
  setSessionChanges,
  setSessionSchema,
} from '../utils/rowDrafts';

interface TabContentTableProps {
  id: string;
  tableName: string;
  connectionId: string;
}

export const TabContentTable = ({ id, tableName, connectionId }: TabContentTableProps) => {
  const { 
    refreshTrigger, 
    triggerRefresh, 
    tabs, 
    setSelectedRow, 
    toggleSelectedRow,
    updateTab, 
    toggleFilterBar,
    setSortConfig,
    addFilter,
    toggleColumnsPopover,
    setViewMode,
    addToHistory,
    activeDatabase,
    savedConnections
  } = useDatabaseStore();
  const activeTab = tabs.find(t => t.id === id);
  const [tableData, setTableData] = useState<any[][]>(activeTab?.rows || []);
  const [tableColumns, setTableColumns] = useState<string[]>(activeTab?.columns || []);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const connection = savedConnections.find(saved => saved.id === connectionId);
  const draftContext = rowDraftContext(connectionId,
    activeTab?.database || activeDatabase || connection?.database || '', tableName);
  const mutations = useTableMutations(draftContext);
  const [draftReady, setDraftReady] = useState(() => getSessionChanges(draftContext) !== undefined
    && (activeTab?.columns?.length || 0) > 0);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const [draftSchemaError, setDraftSchemaError] = useState<string | null>(() => getDraftSchemaError(draftContext));
  const [dataLoaded, setDataLoaded] = useState(() => (activeTab?.columns?.length || 0) > 0);
  const [tableLoadError, setTableLoadError] = useState<string | null>(null);
  const draftLoadStarted = useRef(false);
  const [executionTime, setExecutionTime] = useState<number | undefined>(activeTab?.stats?.time);
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [structureColumns, setStructureColumns] = useState<string[]>([]);
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const viewMode = activeTab?.viewMode || 'data';
  const [lastExecutedSql, setLastExecutedSql] = useState<string | null>(null);
  const databaseType = connection?.type || 'Postgres';
  const isSafeMode = connection?.safetyMode === 'Safe';
  const dirtyRef = useRef(false);
  const commitInFlightRef = useRef(false);
  const loadedRowsRef = useRef<any[][]>(activeTab?.rows || []);
  const tableDataRef = useRef(tableData);
  tableDataRef.current = tableData;
  dirtyRef.current = mutations.state.hasChanges;
  const metadataMatches = structureLoaded && structureColumns.length === tableColumns.length
    && structureColumns.every((column, index) => column === tableColumns[index]);

  useEffect(() => {
    if (draftReady || draftLoadStarted.current || !dataLoaded || !structureLoaded) return;
    draftLoadStarted.current = true;
    let cancelled = false;
    const cached = getSessionChanges(draftContext);
    const schema = getSessionSchema(draftContext);
    const pending = cached ? Promise.resolve({
      version: 1 as const,
      columns: schema?.columns || tableColumns,
      primaryKeys: schema?.primaryKeys || pkColumns,
      changes: [...cached.values()],
    }) : loadRowDraft(draftContext);
    pending.then(draft => {
      if (cancelled || !draft) return;
      try {
        mutations.restore(reconcileRowDraft(draft, tableColumns, pkColumns, tableDataRef.current));
      } catch (error) {
        setDraftSchemaError(String(error));
        rememberDraftSchemaError(draftContext, String(error));
        mutations.restore(new Map(draft.changes.map((change, index) => [-index - 1, change])));
      }
    }).catch(error => {
      if (!cancelled) {
        blockDraftPersistence(draftContext);
        setDraftStorageError(`Could not read saved draft. Edits are session-only; the encrypted copy was left untouched. ${String(error)}`);
      }
    }).finally(() => {
      if (!cancelled) {
        if (!getSessionChanges(draftContext)) {
          // Keep future edits alive across tab switches even without Keychain access.
          setSessionChanges(draftContext, new Map());
        }
        setDraftReady(true);
      }
    });
    return () => { cancelled = true; draftLoadStarted.current = false; };
  }, [draftContext, draftReady, dataLoaded, structureLoaded, tableColumns, pkColumns]);

  useEffect(() => {
    if (!draftReady || !structureLoaded || !dataLoaded || draftSchemaError
      || isDraftPersistenceBlocked(draftContext)) return;
    const draft = mutations.state.hasChanges ? {
      version: 1 as const,
      columns: tableColumns,
      primaryKeys: pkColumns,
      changes: [...mutations.state.changes.values()],
    } : null;
    if (draft) setSessionSchema(draftContext, draft);
    void queueRowDraftWrite(draftContext, draft).then(() => setDraftStorageError(null))
      .catch(error => setDraftStorageError(`Drafts are session-only: ${String(error)}`));
  }, [draftContext, draftReady, structureLoaded, dataLoaded, draftSchemaError,
    tableColumns, pkColumns, mutations.state.changes]);
  let previewStatements: string[] = [];
  let previewError: string | null = null;
  if (mutations.state.hasChanges) {
    try {
      previewStatements = mutations.generateSQL(tableName, tableColumns, pkColumns, databaseType);
    } catch (error) {
      previewError = String(error);
    }
  }


  useEffect(() => {
    let cancelled = false;
    const fetchStructure = async () => {
      setStructureLoaded(false);
      setStructureError(null);
      try {
        const result = await invoke<any>('get_table_structure', { connectionId, tableName });
        if (cancelled) return;
        if (result && result.columns) {
          setPkColumns(result.columns.filter((c: any) => c.is_primary_key).map((c: any) => c.name));
          setStructureColumns(result.columns.map((c: any) => c.name));
          setStructureLoaded(true);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[ERROR] Failed to fetch table structure:", err);
        setStructureError(String(err));
      }
    };
    if (tableName && connectionId) {
      fetchStructure();
    }
    return () => { cancelled = true; };
  }, [tableName, connectionId]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
        if (dirtyRef.current && dataLoaded) {
          setCommitError('Apply or discard pending changes before reloading this table.');
          setLoading(false);
          return;
        }
        setLoading(true);
        setTableLoadError(null);
        try {
            const limit = activeTab?.pageSize || 100;
            const offset = activeTab?.offset || 0;
            const filters = activeTab?.filters?.filter(f => f.enabled) || [];
            const sortConfig = activeTab?.sortConfig;

            const [result, count] = await Promise.all([
              invoke<any>('get_table_data', { 
                  connectionId, 
                  tableName,
                  limit,
                  offset,
                  filters,
                  sortColumn: sortConfig?.column,
                  sortDirection: sortConfig?.direction
              }),
              invoke<number>('get_table_count', {
                  connectionId,
                  tableName,
                  filters
              })
            ]);

            if (cancelled) return;
            if (dirtyRef.current && dataLoaded) {
                setCommitError('Apply or discard pending changes before reloading this table.');
                return;
            }

            if (result && result.columns && result.rows) {
                setTableColumns(result.columns);
                setTableData(result.rows);
                setDataLoaded(true);
                tableDataRef.current = result.rows;
                loadedRowsRef.current = result.rows;
                if (result.execution_time_ms) {
                    setExecutionTime(result.execution_time_ms);
                }
                
                // Construct SQL for history
                const sql = `SELECT * FROM "${tableName}"${filters.length ? ' WHERE ...' : ''} LIMIT ${limit} OFFSET ${offset};`;
                setLastExecutedSql(sql);
                addToHistory({
                  sql,
                  connectionId,
                  database: activeDatabase || undefined,
                  executionTimeMs: result.execution_time_ms || 0,
                  rowsAffected: result.rows.length
                });

                // Update store
                if (id) {
                  updateTab(id, {
                    columns: result.columns,
                    rows: result.rows,
                    totalRows: count,
                    stats: {
                      time: result.execution_time_ms || 0,
                      rows: result.rows.length,
                      totalRows: count
                    }
                  });
                }
            }
        } catch (err) {
            if (cancelled) return;
            console.error("[ERROR] Failed to fetch table data:", err);
            setTableLoadError(String(err));
            setCommitError(`Could not load table data: ${err}`);
        } finally {
            if (!cancelled) setLoading(false);
        }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [connectionId, tableName, refreshTrigger, activeTab?.offset, activeTab?.pageSize, activeTab?.sortConfig]); 
  // Note: activeTab?.filters is implicitly covered by refreshTrigger when user clicks "Apply"

  const handleCommit = async () => {
    if (!connectionId || !draftReady || !metadataMatches || draftSchemaError || !mutations.state.hasChanges || commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    setCommitting(true);
    setCommitError(null);
    const startTime = Date.now();
    try {
      const batch = buildRowMutationBatch(tableName, tableColumns, pkColumns,
        [...mutations.state.changes.values()]);
      const affectedRows = await invokeWithExecutionPolicy<number>('commit_row_changes', connectionId,
        activeTab?.database || activeDatabase || '', { kind: 'row_changes', payload: batch }, { batch });
      
      const duration = Math.round((Date.now() - startTime) / previewStatements.length);
      previewStatements.forEach((sql, idx) => {
        if (idx === previewStatements.length - 1) {
          setLastExecutedSql(sql);
        }
        addToHistory({
          sql,
          connectionId,
          database: activeDatabase || undefined,
          executionTimeMs: duration,
          rowsAffected: idx === previewStatements.length - 1 ? affectedRows : undefined
        });
      });

      mutations.revertAll();
      if (!isDraftPersistenceBlocked(draftContext)) {
        void queueRowDraftWrite(draftContext, null).catch(error =>
          setDraftStorageError(`Could not clear saved draft: ${String(error)}`));
      }
      // Refresh data
      triggerRefresh();
    } catch (err: any) {
      console.error("[ERROR] Commit failed:", err);
      setCommitError(typeof err === 'string' ? err : err.message || JSON.stringify(err));
    } finally {
      commitInFlightRef.current = false;
      setCommitting(false);
    }
  };

  const handlePageChange = (direction: 'next' | 'prev') => {
    if (!id || !activeTab) return;
    if (mutations.state.hasChanges) {
      setCommitError('Apply or discard pending changes before changing pages.');
      return;
    }
    const currentOffset = activeTab.offset || 0;
    const pageSize = activeTab.pageSize || 100;
    const newOffset = direction === 'next' ? currentOffset + pageSize : Math.max(0, currentOffset - pageSize);
    if (newOffset !== currentOffset) {
      updateTab(id, { offset: newOffset });
    }
  };

  const handleSort = (column: string) => {
    if (!id) return;
    if (mutations.state.hasChanges) {
      setCommitError('Apply or discard pending changes before sorting.');
      return;
    }
    const currentSort = activeTab?.sortConfig;
    
    let newConfig: SortConfig;
    if (currentSort?.column === column) {
      // Toggle direction or clear
      if (currentSort.direction === 'ASC') {
        newConfig = { column, direction: 'DESC' };
      } else {
        // Clear sort after DESC
        setSortConfig(id, { column: null, direction: 'ASC' });
        return;
      }
    } else {
      // New column, start with ASC
      newConfig = { column, direction: 'ASC' };
    }
    setSortConfig(id, newConfig);
  };

  const appendRow = useCallback((newRow: any[]) => {
    if (!draftReady || !metadataMatches || isSafeMode || loading || committing) return;
    const rowIndex = tableDataRef.current.length
      + [...mutations.state.changes.values()].filter(change => change.type === 'insert').length;
    mutations.insertRow(rowIndex, newRow);
  }, [draftReady, metadataMatches, isSafeMode, mutations, loading, committing]);

  const handleAddRow = useCallback(() => {
    appendRow(tableColumns.map(() => null));
  }, [appendRow, tableColumns]);

  const handleToggleFilters = () => {
    if (!id) return;

    if (!activeTab?.isFilterVisible && (activeTab?.filters?.length || 0) === 0 && tableColumns.length > 0) {
      addFilter(id, createDefaultTableFilter(tableColumns, uuidv4()));
    }

    toggleFilterBar(id);
  };

  // Keyboard shortcut for adding row (⌘+I)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'i' && viewMode === 'data') {
        e.preventDefault();
        handleAddRow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddRow, viewMode]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden relative">
      <div className="flex-1 overflow-hidden flex flex-col">
        {draftStorageError && (
          <div role="status" className="px-3 py-1 text-xs text-yellow-300 bg-yellow-900/20 border-b border-yellow-600/30">
            {draftStorageError}
          </div>
        )}
        {structureError && !draftReady && (
          <div role="alert" className="px-3 py-1 text-xs text-red-300 bg-red-900/20 border-b border-red-600/30">
            Cannot restore row drafts until table structure loads: {structureError}
          </div>
        )}
        {activeTab?.isFilterVisible && id && (
            <FilterBar 
                tabId={id}
                columns={tableColumns}
                filters={activeTab.filters || []}
                refreshDisabled={mutations.state.hasChanges || committing}
            />
        )}
        
        {viewMode === 'data' ? (
          <div className="flex-1 overflow-hidden relative">
              {tableLoadError && !dataLoaded ? (
              <div role="alert" className="flex items-center justify-center h-full text-red-300">Could not load table data: {tableLoadError}</div>
              ) : loading || (!draftReady && !structureError) ? (
              <div className="flex items-center justify-center h-full text-text-muted">{loading ? 'Loading data...' : 'Restoring saved draft...'}</div>
              ) : (
              <DataTable 
                  columns={tableColumns} 
                  data={tableData} 
                  mutations={mutations}
                  selectedRowIndex={activeTab?.selectedRowIndex}
                  selectedRowIndices={activeTab?.selectedRowIndices}
                  onRowClick={(index, event) => {
                    if (!id) return;
                    if (event.metaKey || event.ctrlKey) {
                      toggleSelectedRow(id, index);
                      return;
                    }
                    setSelectedRow(id, index);
                  }}
                  sortConfig={activeTab?.sortConfig}
                  onSort={handleSort}
                  hiddenColumns={activeTab?.hiddenColumns}
                  pkColumns={metadataMatches ? pkColumns : []}
                  readOnly={isSafeMode || committing || !draftReady || !metadataMatches || !!draftSchemaError}
                  onDuplicateRow={appendRow}
              />
              )}
          </div>
        ) : (
          <TabContentStructure 
            tableName={tableName} 
            connectionId={connectionId} 
            tabId={id || ''} 
          />
        )}
      </div>

      {/* Column Visibility Popover */}
      {activeTab?.isColumnsPopoverVisible && id && (
        <div className="absolute bottom-12 right-2 z-[60]">
          <ColumnVisibilityPopover
            tabId={id}
            columns={tableColumns}
            hiddenColumns={activeTab.hiddenColumns || []}
            onClose={() => toggleColumnsPopover(id)}
          />
        </div>
      )}

      <TableFooter 
        type={viewMode === 'structure' ? 'Structure' : 'Data'}
        onTypeChange={(type) => id && setViewMode(id, type === 'Structure' ? 'structure' : 'data')}
        onAddRow={viewMode === 'data' && draftReady && metadataMatches && !draftSchemaError && !isSafeMode && !committing && !loading ? handleAddRow : undefined}
        offset={activeTab?.offset || 0}
        pageSize={activeTab?.pageSize || 100}
        totalRows={activeTab?.totalRows || 0}
        onPageChange={handlePageChange}
        executionTime={executionTime}
        onToggleFilters={handleToggleFilters}
        isFiltersVisible={activeTab?.isFilterVisible}
        onToggleColumns={() => id && toggleColumnsPopover(id)}
        isColumnsVisible={activeTab?.isColumnsPopoverVisible}
        onExport={() => setShowExportModal(true)}
      />

      {showExportModal && (
        <ExportModal
          tableName={tableName}
          connectionId={connectionId}
          filters={activeTab?.filters || []}
          sortConfig={activeTab?.sortConfig}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Bottom Console / Pending Changes */}
      <div className="h-48 bg-[#252526] border-t border-[#1e1e1e] flex flex-col shrink-0 relative">
        <div className="flex-1 overflow-auto">
          {mutations.state.hasChanges ? (
            <PendingChanges 
              statements={previewStatements}
              changeCount={mutations.state.changes.size}
              onCommit={handleCommit}
              onDiscard={() => {
                mutations.revertAll();
                setDraftSchemaError(null);
                rememberDraftSchemaError(draftContext, null);
                if (!isDraftPersistenceBlocked(draftContext)) {
                  void queueRowDraftWrite(draftContext, null).catch(error =>
                    setDraftStorageError(`Could not clear saved draft: ${String(error)}`));
                }
                const restoredRows = [...loadedRowsRef.current];
                tableDataRef.current = restoredRows;
                setTableData(restoredRows);
                setCommitError(null);
              }}
              isCommitting={committing}
              error={commitError}
              disabledReason={isSafeMode ? 'Safe mode is browse-only. Switch modes before committing.'
                : !draftReady ? 'Restoring saved draft...' : draftSchemaError || previewError || structureError
                || (!structureLoaded ? 'Checking row identity...'
                  : !metadataMatches ? 'Table structure does not match the displayed rows. Grid edits are unavailable.' : null)}
            />
          ) : (
            <div className="p-2 font-mono text-[10px] text-text-muted">
               <div className="flex gap-2">
                  <span className="text-text-secondary">-- {new Date().toISOString().replace('T', ' ').split('.')[0]}</span>
               </div>
               <div className="text-[#a6e22e] whitespace-pre-wrap">
                   {lastExecutedSql || `SELECT * FROM "${tableName}" LIMIT ${activeTab?.pageSize || 100} OFFSET ${activeTab?.offset || 0};`}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
