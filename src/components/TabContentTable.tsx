import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeft } from 'lucide-react';
import { DataTable } from './DataTable';
import { PendingChanges } from './PendingChanges';
import { useTableMutations } from '../hooks/useTableMutations';
import { useDatabaseStore, SortConfig, type ForeignKeyStructure } from '../store/databaseStore';
import { TableFooter } from './TableFooter';
import { FilterBar } from './FilterBar';
import { ColumnVisibilityPopover } from './ColumnVisibilityPopover';
import { TabContentStructure } from './TabContentStructure';
import { ExportModal } from './ExportModal';
import { createDefaultTableFilter } from '../utils/tableFilters';
import { filtersForForeignKey } from '../utils/foreignKeyNavigation';
import { invokeWithExecutionPolicy } from '../utils/executionPolicy';
import { buildRowMutationBatch } from '../utils/rowMutations';
import { integerKeysetCursor, tablePageCache, tablePageKeys } from '../utils/tablePageCache';
import { tableStructureCache } from '../utils/tableStructureCache';
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
    openTab,
    setActiveTabId,
    activeDatabase,
    savedConnections
  } = useDatabaseStore();
  const activeTab = tabs.find(t => t.id === id);
  const originTab = tabs.find(t => t.id === activeTab?.originTabId && t.connectionId === connectionId);
  const initialKeys = tablePageKeys({
    connectionId, database: activeTab?.database || activeDatabase || '', tableName,
    filters: activeTab?.filters?.filter(f => f.enabled) || [],
    sortColumn: activeTab?.sortConfig?.column || null,
    sortDirection: activeTab?.sortConfig?.direction || 'ASC',
    limit: activeTab?.pageSize || 100, offset: activeTab?.offset || 0,
    generation: refreshTrigger,
  });
  const currentPageIdentity = initialKeys.page;
  const initialPage = tablePageCache.getPage(id, initialKeys.page)
    || (activeTab?.rowsIdentity === currentPageIdentity && activeTab.rows && activeTab.columns
      ? { value: { rows: activeTab.rows, columns: activeTab.columns, time: activeTab.stats?.time || 0 }, fresh: false }
      : undefined);
  const initialCount = tablePageCache.getCount(id, initialKeys.count);
  const [tableData, setTableData] = useState<any[][]>(initialPage?.value.rows || []);
  const [tableColumns, setTableColumns] = useState<string[]>(initialPage?.value.columns || activeTab?.columns || []);
  const [loadedPageIdentity, setLoadedPageIdentity] = useState(initialPage ? currentPageIdentity : '');
  const [totalRows, setTotalRows] = useState<number | null>(initialCount?.value ?? null);
  const [hasMore, setHasMore] = useState(initialPage && 'hasMore' in initialPage.value
    ? initialPage.value.hasMore ?? false : false);
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
  const [dataLoaded, setDataLoaded] = useState(() => !!initialPage);
  const [tableLoadError, setTableLoadError] = useState<string | null>(null);
  const [countLoadError, setCountLoadError] = useState<string | null>(null);
  const [countingRows, setCountingRows] = useState(false);
  const draftLoadStarted = useRef(false);
  const [executionTime, setExecutionTime] = useState<number | undefined>(initialPage?.value.time);
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [structureColumns, setStructureColumns] = useState<string[]>([]);
  const [nullableColumns, setNullableColumns] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [structureLoaded, setStructureLoaded] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureVersion, setStructureVersion] = useState(-1);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyStructure[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const viewMode = activeTab?.viewMode || 'data';
  const [lastExecutedSql, setLastExecutedSql] = useState<string | null>(null);
  const databaseType = connection?.type || 'Postgres';
  const isSafeMode = connection?.safetyMode === 'Safe';
  const dirtyRef = useRef(false);
  const commitInFlightRef = useRef(false);
  const loadedRowsRef = useRef<any[][]>(initialPage?.value.rows || []);
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
        const result = await tableStructureCache.get(
          connectionId, activeTab?.database || activeDatabase || '', tableName,
          () => invoke<any>('get_table_structure', { connectionId, tableName }),
        );
        if (cancelled) return;
        if (result && Array.isArray(result.columns)) {
          setPkColumns(result.columns.filter((c: any) => c.is_primary_key).map((c: any) => c.name));
          setStructureColumns(result.columns.map((c: any) => c.name));
          setNullableColumns(result.columns.filter((c: any) => c.is_nullable).map((c: any) => c.name));
          setColumnTypes(Object.fromEntries(result.columns.map((c: any) => [c.name, c.data_type])));
          setForeignKeys(result.foreign_keys || []);
          setStructureLoaded(true);
          setStructureVersion(refreshTrigger);
        } else {
          throw new Error('Database returned invalid table structure.');
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[ERROR] Failed to fetch table structure:", err);
        setStructureError(String(err));
        setStructureVersion(refreshTrigger);
      }
    };
    if (tableName && connectionId) {
      fetchStructure();
    }
    return () => { cancelled = true; };
  }, [tableName, connectionId, refreshTrigger]);

  useEffect(() => {
    if (structureVersion !== refreshTrigger || (!structureLoaded && !structureError)) return;
    let cancelled = false;
    const fetchData = async () => {
        if (dirtyRef.current && dataLoaded) {
          setCommitError('Apply or discard pending changes before reloading this table.');
          setLoading(false);
          return;
        }
        const limit = activeTab?.pageSize || 100;
        const offset = activeTab?.offset || 0;
        const filters = activeTab?.filters?.filter(f => f.enabled) || [];
        const sortConfig = activeTab?.sortConfig;
        const keys = tablePageKeys({
          connectionId, database: activeTab?.database || activeDatabase || '', tableName,
          filters, sortColumn: sortConfig?.column || null,
          sortDirection: sortConfig?.direction || 'ASC', limit, offset,
          generation: refreshTrigger,
        });
        const cachedPage = tablePageCache.getPage(id, keys.page);
        const retainedPage = !cachedPage && activeTab?.rowsIdentity === keys.page && activeTab.rows && activeTab.columns
          ? { value: { columns: activeTab.columns, rows: activeTab.rows, time: activeTab.stats?.time || 0 }, fresh: false }
          : undefined;
        const visiblePage = cachedPage || retainedPage;
        const cachedCount = tablePageCache.getCount(id, keys.count);
        setTableLoadError(null);
        setCountLoadError(null);
        setTotalRows(cachedCount?.fresh ? cachedCount.value : null);
        if (visiblePage) {
          setTableColumns(visiblePage.value.columns);
          setTableData(visiblePage.value.rows);
          setDataLoaded(true);
          setLoadedPageIdentity(currentPageIdentity);
          setExecutionTime(visiblePage.value.time);
          setHasMore(cachedPage?.value.hasMore ?? false);
          tableDataRef.current = visiblePage.value.rows;
          loadedRowsRef.current = visiblePage.value.rows;
          updateTab(id, { columns: visiblePage.value.columns, rows: visiblePage.value.rows, rowsIdentity: currentPageIdentity });
          if (cachedPage?.value.hasMore === false && !cachedCount?.fresh) {
            setTotalRows(offset + visiblePage.value.rows.length);
          }
        }
        setLoading(!visiblePage);
        if (!visiblePage) setHasMore(false);

        if (cachedPage?.fresh) {
          return;
        }

        try {
          const previousKeys = offset >= limit ? tablePageKeys({
            connectionId, database: activeTab?.database || activeDatabase || '', tableName,
            filters, sortColumn: null, sortDirection: 'ASC', limit,
            offset: offset - limit, generation: refreshTrigger,
          }) : null;
          const previous = previousKeys ? tablePageCache.getPage(id, previousKeys.page) : undefined;
          const seekAfter = previous?.fresh
            ? integerKeysetCursor(previous.value, pkColumns, columnTypes, sortConfig?.column || null)
            : undefined;
          const result = await invoke<any>('get_table_data', {
            connectionId, tableName, limit, offset, filters,
            sortColumn: sortConfig?.column, sortDirection: sortConfig?.direction,
            primaryKeys: pkColumns, seekAfter,
          });
          if (cancelled) return;
          if (dirtyRef.current && dataLoaded) {
            setCommitError('Apply or discard pending changes before reloading this table.');
            return;
          }
          if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows)) {
            throw new Error('Database returned an invalid table page.');
          }
          const time = result.execution_time_ms || 0;
          const pageHasMore = result.has_more === true;
          tablePageCache.putPage(id, keys.page, { columns: result.columns, rows: result.rows, time, hasMore: pageHasMore });
          setTableColumns(result.columns);
          setTableData(result.rows);
          setDataLoaded(true);
          setLoadedPageIdentity(currentPageIdentity);
          tableDataRef.current = result.rows;
          loadedRowsRef.current = result.rows;
          setExecutionTime(time);
          setHasMore(pageHasMore);
          if (!pageHasMore) {
            const count = offset + result.rows.length;
            tablePageCache.putCount(id, keys.count, count);
            setTotalRows(count);
            updateTab(id, { totalRows: count });
          }

          const sql = `SELECT * FROM "${tableName}"${filters.length ? ' WHERE ...' : ''} LIMIT ${limit} OFFSET ${offset};`;
          setLastExecutedSql(sql);
          addToHistory({
            sql, connectionId, database: activeDatabase || undefined,
            executionTimeMs: time, rowsAffected: result.rows.length,
          });
          updateTab(id, {
            columns: result.columns, rows: result.rows, rowsIdentity: currentPageIdentity,
            stats: { time, rows: result.rows.length },
          });
        } catch (err) {
          if (cancelled) return;
          console.error('[ERROR] Failed to fetch table data:', err);
          setTableLoadError(String(err));
          setCommitError(`Could not load table data: ${err}`);
        } finally {
          if (!cancelled) setLoading(false);
        }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [connectionId, tableName, refreshTrigger, activeTab?.offset, activeTab?.pageSize,
    activeTab?.sortConfig, structureLoaded, structureError, structureVersion, pkColumns, columnTypes]);
  // Note: activeTab?.filters is implicitly covered by refreshTrigger when user clicks "Apply"

  const handleCountRows = async () => {
    if (countingRows || !activeTab) return;
    const filters = activeTab.filters?.filter(filter => filter.enabled) || [];
    const keys = tablePageKeys({
      connectionId, database: activeTab.database || activeDatabase || '', tableName, filters,
      sortColumn: activeTab.sortConfig?.column || null,
      sortDirection: activeTab.sortConfig?.direction || 'ASC',
      limit: activeTab.pageSize || 100, offset: activeTab.offset || 0,
      generation: refreshTrigger,
    });
    setCountingRows(true);
    setCountLoadError(null);
    try {
      const count = await invoke<number>('get_table_count', { connectionId, tableName, filters });
      const current = useDatabaseStore.getState();
      const currentTab = current.tabs.find(tab => tab.id === id);
      if (!currentTab || current.refreshTrigger !== refreshTrigger || currentTab.connectionId !== connectionId
        || JSON.stringify(currentTab.filters?.filter(filter => filter.enabled) || []) !== JSON.stringify(filters)) return;
      tablePageCache.putCount(id, keys.count, count);
      setTotalRows(count);
      updateTab(id, { totalRows: count });
    } catch (err) {
      setCountLoadError(String(err));
    } finally {
      setCountingRows(false);
    }
  };

  const handleCommit = async () => {
    if (!connectionId || activeTab?.originTabId || !draftReady || !metadataMatches || draftSchemaError || !mutations.state.hasChanges || commitInFlightRef.current) return;
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
    if (!draftReady || !metadataMatches || isSafeMode || activeTab?.originTabId || loading || committing) return;
    const rowIndex = tableDataRef.current.length
      + [...mutations.state.changes.values()].filter(change => change.type === 'insert').length;
    mutations.insertRow(rowIndex, newRow);
  }, [draftReady, metadataMatches, isSafeMode, activeTab?.originTabId, mutations, loading, committing]);

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

  const handleFollowForeignKey = (key: ForeignKeyStructure, row: any[]) => {
    const filters = filtersForForeignKey(key, tableColumns, row);
    if (!filters) return;
    openTab({
      type: 'table',
      title: key.target_table,
      tableName: key.target_table,
      connectionId,
      database: activeTab?.database,
      originTabId: id,
      filters,
      isFilterVisible: true,
    }, { forceNew: true });
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
        {activeTab?.originTabId && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-sidebar text-xs text-text-secondary">
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-accent hover:bg-accent/10 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => originTab && setActiveTabId(originTab.id)}
              disabled={!originTab}
              title={originTab ? `Back to ${originTab.title}` : 'Source tab is closed'}
            >
              <ArrowLeft size={13} aria-hidden="true" /> Back
            </button>
            <span className="truncate">Referenced row in {tableName}</span>
            <span className="ml-auto shrink-0 text-text-muted">Browse-only</span>
          </div>
        )}
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
        {tableLoadError && loadedPageIdentity === currentPageIdentity && (
          <div role="alert" className="px-3 py-1 text-xs text-red-300 bg-red-900/20 border-b border-red-600/30">
            Could not refresh table data. Showing the last loaded page: {tableLoadError}
          </div>
        )}
        {countLoadError && (
          <div role="alert" className="px-3 py-1 text-xs text-yellow-300 bg-yellow-900/20 border-b border-yellow-600/30">
            Could not count rows. Pagination still works: {countLoadError}
          </div>
        )}
        {activeTab?.originTabId && dataLoaded && loadedPageIdentity === currentPageIdentity && !loading && !tableLoadError && tableData.length === 0 && (
          <div role="status" className="px-3 py-1 text-xs text-text-secondary border-b border-border">
            No matching row. It may have been deleted or may not be visible to this connection.
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
              {loading && loadedPageIdentity === currentPageIdentity && (
                <div role="status" className="absolute top-2 right-3 z-10 rounded border border-border bg-sidebar px-2 py-1 text-xs text-text-muted">
                  Refreshing data...
                </div>
              )}
              {tableLoadError && loadedPageIdentity !== currentPageIdentity ? (
              <div role="alert" className="flex items-center justify-center h-full text-red-300">Could not load table data: {tableLoadError}</div>
              ) : loadedPageIdentity !== currentPageIdentity || (!draftReady && !structureError) ? (
              <div className="flex items-center justify-center h-full text-text-muted">{loadedPageIdentity !== currentPageIdentity ? 'Loading data...' : 'Restoring saved draft...'}</div>
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
                  nullableColumns={metadataMatches ? nullableColumns : []}
                  columnTypes={metadataMatches ? columnTypes : {}}
                  readOnly={isSafeMode || !!activeTab?.originTabId || loading || committing || !!tableLoadError || !draftReady || !metadataMatches || !!draftSchemaError}
                  onDuplicateRow={appendRow}
                  foreignKeys={foreignKeys}
                  onFollowForeignKey={handleFollowForeignKey}
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
        onAddRow={viewMode === 'data' && draftReady && metadataMatches && !draftSchemaError && !isSafeMode && !activeTab?.originTabId && !committing && !loading ? handleAddRow : undefined}
        offset={activeTab?.offset || 0}
        totalRows={totalRows}
        displayedRows={tableData.length}
        hasMore={hasMore}
        countingRows={countingRows}
        onCountRows={handleCountRows}
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
          columns={tableColumns}
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
              disableDiscard={!!activeTab?.originTabId}
              disabledReason={activeTab?.originTabId ? 'Referenced-row tabs are browse-only. Return to a table tab to commit edits.'
                : isSafeMode ? 'Safe mode blocks row commits. Switch modes before committing.'
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
