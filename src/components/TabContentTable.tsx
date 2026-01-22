import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DataTable } from './DataTable';
import { PendingChanges } from './PendingChanges';
import { useTableMutations } from '../hooks/useTableMutations';
import { useDatabaseStore } from '../store/databaseStore';
import { TableFooter } from './TableFooter';
import { FilterBar } from './FilterBar';

interface TabContentTableProps {
  tableName: string;
  connectionId: string;
}

export const TabContentTable = ({ tableName, connectionId }: TabContentTableProps) => {
  const { refreshTrigger, triggerRefresh, tabs, activeTabId, setSelectedRow, updateTab, toggleFilterBar } = useDatabaseStore();
  const activeTab = tabs.find(t => t.id === activeTabId);
  const [tableData, setTableData] = useState<any[][]>([]);
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const mutations = useTableMutations();
  const [executionTime, setExecutionTime] = useState<number | undefined>();

  useEffect(() => {
    const fetchData = async () => {
        setLoading(true);
        try {
            const limit = activeTab?.pageSize || 100;
            const offset = activeTab?.offset || 0;
            const filters = activeTab?.filters?.filter(f => f.enabled) || [];

            const [result, count] = await Promise.all([
              invoke<any>('get_table_data', { 
                  connectionId, 
                  tableName,
                  limit,
                  offset,
                  filters
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
        }
    };

    fetchData();
  }, [connectionId, tableName, refreshTrigger, activeTab?.offset, activeTab?.pageSize]); 
  // Note: activeTab?.filters is implicitly covered by refreshTrigger when user clicks "Apply"

  const handleCommit = async (statements: string[]) => {
    if (!connectionId || statements.length === 0) return;
    setLoading(true);
    try {
      await invoke('execute_mutations', { connectionId, statements });
      mutations.revertAll();
      // Refresh data
      triggerRefresh();
    } catch (err) {
      console.error("[ERROR] Commit failed:", err);
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
            />
            )}
        </div>
      </div>

      <TableFooter 
        type="Data"
        onTypeChange={() => {}}
        onAddRow={() => {}}
        offset={activeTab?.offset || 0}
        pageSize={activeTab?.pageSize || 100}
        totalRows={activeTab?.totalRows || 0}
        onPageChange={handlePageChange}
        executionTime={executionTime}
        onToggleFilters={() => activeTabId && toggleFilterBar(activeTabId)}
        isFiltersVisible={activeTab?.isFilterVisible}
      />

      {/* Bottom Console / Pending Changes */}
      <div className="h-40 bg-[#252526] border-t border-[#1e1e1e] flex flex-col shrink-0">
        <div className="flex-1 overflow-auto">
          {mutations.state.hasChanges ? (
            <PendingChanges 
              statements={mutations.generateSQL(tableName, tableColumns)}
              onCommit={() => handleCommit(mutations.generateSQL(tableName, tableColumns))}
              onDiscard={mutations.revertAll}
              isCommitting={loading}
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
