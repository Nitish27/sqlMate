import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DataTable } from './DataTable';
import { PendingChanges } from './PendingChanges';
import { useTableMutations } from '../hooks/useTableMutations';
import { useDatabaseStore, SortConfig } from '../store/databaseStore';
import { TableFooter } from './TableFooter';
import { FilterBar } from './FilterBar';
import { ColumnVisibilityPopover } from './ColumnVisibilityPopover';
import { TabContentStructure } from './TabContentStructure';
import { ExportModal } from './ExportModal';

interface TabContentTableProps {
  tableName: string;
  connectionId: string;
}

export const TabContentTable = ({ tableName, connectionId }: TabContentTableProps) => {
  const { 
    refreshTrigger, 
    triggerRefresh, 
    tabs, 
    activeTabId, 
    setSelectedRow, 
    updateTab, 
    toggleFilterBar,
    setSortConfig,
    toggleColumnsPopover,
    setViewMode,
    addToHistory,
    activeDatabase
  } = useDatabaseStore();
  const activeTab = tabs.find(t => t.id === activeTabId);
  const [tableData, setTableData] = useState<any[][]>([]);
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const mutations = useTableMutations();
  const [executionTime, setExecutionTime] = useState<number | undefined>();
  const [pkColumn, setPkColumn] = useState<string | undefined>();
  const [showExportModal, setShowExportModal] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const viewMode = activeTab?.viewMode || 'data';
  const [newRowCounter, setNewRowCounter] = useState(0);


  useEffect(() => {
    const fetchStructure = async () => {
      try {
        const result = await invoke<any>('get_table_structure', { connectionId, tableName });
        if (result && result.columns) {
          const pk = result.columns.find((c: any) => c.is_primary_key)?.name;
          setPkColumn(pk);
        }
      } catch (err) {
        console.error("[ERROR] Failed to fetch table structure:", err);
      }
    };
    if (tableName && connectionId) {
      fetchStructure();
    }
  }, [tableName, connectionId]);

  useEffect(() => {
    const fetchData = async () => {
        setLoading(true);
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

            if (result && result.columns && result.rows) {
                setTableColumns(result.columns);
                setTableData(result.rows);
                if (result.execution_time_ms) {
                    setExecutionTime(result.execution_time_ms);
                }
                
                // Construct SQL for history
                const sql = `SELECT * FROM "${tableName}"${filters.length ? ' WHERE ...' : ''} LIMIT ${limit} OFFSET ${offset};`;
                addToHistory({
                  sql,
                  connectionId,
                  database: activeDatabase || undefined,
                  executionTimeMs: result.execution_time_ms || 0,
                  rowsAffected: result.rows.length
                });

                // Update store
                if (activeTabId) {
                  updateTab(activeTabId, {
                    columns: result.columns,
                    rows: result.rows,
                    totalRows: count
                  });
                }
            }
        } catch (err) {
            console.error("[ERROR] Failed to fetch table data:", err);
        } finally {
            setLoading(false);
            mutations.revertAll();
            setCommitError(null);
        }
    };

    fetchData();
  }, [connectionId, tableName, refreshTrigger, activeTab?.offset, activeTab?.pageSize, activeTab?.sortConfig]); 
  // Note: activeTab?.filters is implicitly covered by refreshTrigger when user clicks "Apply"

  const handleCommit = async (statements: string[]) => {
    if (!connectionId || statements.length === 0) return;
    setLoading(true);
    setCommitError(null);
    try {
      await invoke('execute_mutations', { connectionId, statements });
      mutations.revertAll();
      // Refresh data
      triggerRefresh();
    } catch (err: any) {
      console.error("[ERROR] Commit failed:", err);
      setCommitError(typeof err === 'string' ? err : err.message || JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (direction: 'next' | 'prev') => {
    if (!activeTabId || !activeTab) return;
    const currentOffset = activeTab.offset || 0;
    const pageSize = activeTab.pageSize || 100;
    const newOffset = direction === 'next' ? currentOffset + pageSize : Math.max(0, currentOffset - pageSize);
    if (newOffset !== currentOffset) {
      updateTab(activeTabId, { offset: newOffset });
    }
  };

  const handleSort = (column: string) => {
    if (!activeTabId) return;
    const currentSort = activeTab?.sortConfig;
    
    let newConfig: SortConfig;
    if (currentSort?.column === column) {
      // Toggle direction or clear
      if (currentSort.direction === 'ASC') {
        newConfig = { column, direction: 'DESC' };
      } else {
        // Clear sort after DESC
        setSortConfig(activeTabId, { column: null, direction: 'ASC' });
        return;
      }
    } else {
      // New column, start with ASC
      newConfig = { column, direction: 'ASC' };
    }
    setSortConfig(activeTabId, newConfig);
  };

  // Handle adding a new row
  const handleAddRow = useCallback(() => {
    if (!tableColumns.length) return;
    
    // Create a new row with null values for each column
    const newRow = tableColumns.map(() => null);
    
    // Increment counter for new rows
    setNewRowCounter(prev => prev + 1);
    
    // Add to local state
    setTableData(prev => [...prev, newRow]);
    
    // Track in mutations as an insert
    mutations.insertRow(tableData.length, newRow);
  }, [tableColumns, newRowCounter, tableData.length, mutations]);

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
        {activeTab?.isFilterVisible && activeTabId && (
            <FilterBar 
                tabId={activeTabId}
                columns={tableColumns}
                filters={activeTab.filters || []}
            />
        )}
        
        {viewMode === 'data' ? (
          <div className="flex-1 overflow-hidden relative">
              {loading ? (
              <div className="flex items-center justify-center h-full text-text-muted">Loading data...</div>
              ) : (
              <DataTable 
                  columns={tableColumns} 
                  data={tableData} 
                  mutations={mutations}
                  selectedRowIndex={activeTab?.selectedRowIndex}
                  onRowClick={(index) => {
                  if (activeTabId) {
                      setSelectedRow(activeTabId, index);
                  }
                  }}
                  sortConfig={activeTab?.sortConfig}
                  onSort={handleSort}
                  hiddenColumns={activeTab?.hiddenColumns}
                  pkColumn={pkColumn}
              />
              )}
          </div>
        ) : (
          <TabContentStructure 
            tableName={tableName} 
            connectionId={connectionId} 
            tabId={activeTabId || ''} 
          />
        )}
      </div>

      {/* Column Visibility Popover */}
      {activeTab?.isColumnsPopoverVisible && activeTabId && (
        <div className="absolute bottom-12 right-2 z-[60]">
          <ColumnVisibilityPopover
            tabId={activeTabId}
            columns={tableColumns}
            hiddenColumns={activeTab.hiddenColumns || []}
            onClose={() => toggleColumnsPopover(activeTabId)}
          />
        </div>
      )}

      <TableFooter 
        type={viewMode === 'structure' ? 'Structure' : 'Data'}
        onTypeChange={(type) => activeTabId && setViewMode(activeTabId, type === 'Structure' ? 'structure' : 'data')}
        onAddRow={viewMode === 'data' ? handleAddRow : undefined}
        offset={activeTab?.offset || 0}
        pageSize={activeTab?.pageSize || 100}
        totalRows={activeTab?.totalRows || 0}
        onPageChange={handlePageChange}
        executionTime={executionTime}
        onToggleFilters={() => activeTabId && toggleFilterBar(activeTabId)}
        isFiltersVisible={activeTab?.isFilterVisible}
        onToggleColumns={() => activeTabId && toggleColumnsPopover(activeTabId)}
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
              statements={mutations.generateSQL(tableName, tableColumns, pkColumn)}
              onCommit={(editedStatements) => handleCommit(editedStatements)}
              onDiscard={mutations.revertAll}
              isCommitting={loading}
              error={commitError}
            />
          ) : (
            <div className="p-2 font-mono text-[10px] text-text-muted">
               <div className="flex gap-2">
                  <span className="text-text-secondary">-- {new Date().toISOString().replace('T', ' ').split('.')[0]}</span>
               </div>
               <div className="text-[#a6e22e]">
                   SELECT * FROM "{tableName}" 
                   {activeTab?.filters?.filter(f => f.enabled).length ? ' WHERE ... ' : ''}
                   LIMIT {activeTab?.pageSize || 100} OFFSET {activeTab?.offset || 0};
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
