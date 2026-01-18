import { useState, useEffect, useMemo } from 'react';
import { useDatabaseStore } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';
import { Search, Info, MessageSquare } from 'lucide-react';
import { cn } from '../utils/cn';

interface TableMetadata {
  total_size?: string;
  data_size?: string;
  index_size?: string;
  comment?: string;
}

export const ObjectDetails = () => {
  const tabs = useDatabaseStore((state) => state.tabs);
  const activeTabId = useDatabaseStore((state) => state.activeTabId);
  const connectionId = useDatabaseStore((state) => state.activeConnectionId);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);
  const [activeSubTab, setActiveSubTab] = useState<'details' | 'assistant'>('details');
  const [searchQuery, setSearchQuery] = useState('');
  const [metadata, setMetadata] = useState<TableMetadata | null>(null);

  useEffect(() => {
    const fetchMetadata = async () => {
      if (activeTab?.type === 'table' && activeTab.tableName && connectionId) {
        try {
          const result = await invoke<TableMetadata>('get_table_metadata', {
            connectionId,
            tableName: activeTab.tableName
          });
          setMetadata(result);
        } catch (err) {
          console.error("Failed to fetch metadata:", err);
          setMetadata(null);
        }
      } else {
        setMetadata(null);
      }
    };

    if (!activeTab?.selectedRowIndex && activeTab?.selectedRowIndex !== 0) {
      fetchMetadata();
    }
  }, [activeTab?.tableName, activeTab?.selectedRowIndex, connectionId, activeTab?.type]);

  if (!activeTab || activeTab.type !== 'table') {
    return (
      <div className="flex-1 flex flex-col bg-[#262626] border-l border-[#1e1e1e]">
        <div className="p-4 text-center text-text-muted italic text-[11px] mt-10">
          No table selected
        </div>
      </div>
    );
  }

  const isRowSelected = activeTab.selectedRowIndex !== null && activeTab.selectedRowIndex !== undefined;
  const currentRow = isRowSelected && activeTab.rows ? activeTab.rows[activeTab.selectedRowIndex!] : null;
  
  const fields = useMemo(() => {
    if (isRowSelected) {
      return activeTab.columns?.map((name, i) => ({ 
        name, 
        value: currentRow ? currentRow[i] : undefined,
        originalIndex: i 
      })) || [];
    } else {
      return [
        { name: 'total_size', value: metadata?.total_size || '...', originalIndex: 0 },
        { name: 'data_size', value: metadata?.data_size || '...', originalIndex: 1 },
        { name: 'index_size', value: metadata?.index_size || '...', originalIndex: 2 },
        { name: 'comment', value: metadata?.comment || 'NULL', originalIndex: 3 },
      ];
    }
  }, [isRowSelected, activeTab.columns, currentRow, metadata]);

  const filteredFields = fields.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    String(f.value || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col bg-[#262626] border-l border-[#1e1e1e] w-full overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center bg-[#2C2C2C] border-b border-[#1e1e1e]">
        <button 
          onClick={() => setActiveSubTab('details')}
          className={cn(
            "px-4 py-2 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors focus:outline-none",
            activeSubTab === 'details' ? "text-white bg-[#262626]" : "text-text-muted hover:text-text-secondary"
          )}
        >
          <Info size={12} />
          Details
        </button>
        <button 
          onClick={() => setActiveSubTab('assistant')}
          className={cn(
            "px-4 py-2 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors focus:outline-none",
            activeSubTab === 'assistant' ? "text-white bg-[#262626]" : "text-text-muted hover:text-text-secondary"
          )}
        >
          <MessageSquare size={12} />
          Assistant
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-[#1e1e1e]">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
          <input 
            type="text"
            placeholder="Search for field..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1e1e1e] border border-[#3C3C3C] rounded px-7 py-1 text-[11px] text-[#ccc] focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeSubTab === 'details' ? (
          <div className="divide-y divide-[#1e1e1e]">
            {filteredFields.map((field) => (
              <div key={field.name} className="px-3 py-2 flex flex-col gap-0.5 hover:bg-white/5 group transition-colors">
                <div className="flex justify-between items-center text-[10px] font-bold text-text-muted uppercase tracking-tighter">
                  <span>{field.name}</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                    {isRowSelected ? (activeTab.columns && activeTab.columns[field.originalIndex] === 'id' ? 'int8' : 'text') : 'stat'}
                  </span>
                </div>
                <div className="text-[12px] text-[#cccccc] break-all">
                  {field.value === null || field.value === undefined ? (
                    <span className="text-text-muted italic">NULL</span>
                  ) : String(field.value)}
                </div>
              </div>
            ))}
            {filteredFields.length === 0 && (
               <div className="p-8 text-center text-text-muted italic text-[11px]">No matching fields</div>
            )}
          </div>
        ) : (
          <div className="p-10 text-center text-text-muted flex flex-col items-center justify-center h-full">
            <MessageSquare size={32} className="opacity-10 mb-4" />
            <div className="text-[11px] max-w-[150px] leading-relaxed">Assistant is currently unavailable in your region.</div>
          </div>
        )}
      </div>
    </div>
  );
};
