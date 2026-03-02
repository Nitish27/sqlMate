import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { TableStructure } from '../store/types';
import { Package, Key, Hash, ShieldAlert } from 'lucide-react';

interface TabContentStructureProps {
  tableName: string;
  connectionId: string;
  tabId: string;
}

export const TabContentStructure = ({ tableName, connectionId, tabId }: TabContentStructureProps) => {
  const setTableStructure = useWorkspaceStore(s => s.setTableStructure);
  const tabs = useWorkspaceStore(s => s.tabs);
  const activeTab = tabs.find(t => t.id === tabId);
  const [loading, setLoading] = useState(false);
  const structure = activeTab?.tableStructure;

  useEffect(() => {
    const fetchStructure = async () => {
      if (structure) return; // Only fetch if not already loaded

      setLoading(true);
      try {
        const result = await invoke<TableStructure>('get_table_structure', {
          connectionId,
          tableName,
        });
        setTableStructure(tabId, result);
      } catch (err) {
        console.error("[ERROR] Failed to fetch table structure:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStructure();
  }, [connectionId, tableName, tabId, structure, setTableStructure]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="flex flex-col items-center gap-2">
           <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#007acc]"></div>
           Loading structure...
        </div>
      </div>
    );
  }

  if (!structure) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No structure information available.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Columns Section */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-[#ccc]">
            <Package size={18} className="text-[#007acc]" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Columns</h2>
            <span className="text-xs text-[#666] ml-2">({structure.columns.length})</span>
          </div>
          <div className="bg-[#1e1e1e] border border-[#333] rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#2a2d2e] text-[#999] border-b border-[#333]">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Null</th>
                  <th className="px-4 py-2 font-medium">Default</th>
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#333]">
                {structure.columns.map((col) => (
                  <tr key={col.name} className="hover:bg-[#252526] transition-colors group">
                    <td className="px-4 py-2.5 font-mono text-[#007acc] flex items-center gap-2">
                       {col.is_primary_key && <Key size={12} className="text-[#eab308]" />}
                       {col.name}
                    </td>
                    <td className="px-4 py-2.5 text-[#ccc]">{col.data_type}</td>
                    <td className="px-4 py-2.5 text-[#666]">{col.is_nullable ? 'YES' : 'NO'}</td>
                    <td className="px-4 py-2.5 text-[#666] italic font-mono">{col.default_value || 'NULL'}</td>
                    <td className="px-4 py-2.5">
                      {col.is_primary_key && (
                        <span className="px-1.5 py-0.5 bg-[#eab308]/10 text-[#eab308] rounded text-[10px] font-bold uppercase tracking-tight border border-[#eab308]/20">
                          PRI
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[#666]">{col.comment || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Indexes Section */}
          <section>
            <div className="flex items-center gap-2 mb-4 text-[#ccc]">
              <Hash size={18} className="text-[#007acc]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Indexes</h2>
              <span className="text-xs text-[#666] ml-2">({structure.indexes.length})</span>
            </div>
            <div className="bg-[#1e1e1e] border border-[#333] rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#2a2d2e] text-[#999] border-b border-[#333]">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Columns</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#333]">
                  {structure.indexes.map((idx) => (
                    <tr key={idx.name} className="hover:bg-[#252526] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-[#4ade80]">{idx.name}</td>
                      <td className="px-4 py-2.5 text-[#ccc]">{idx.columns.join(', ') || '-'}</td>
                      <td className="px-4 py-2.5 text-[#666]">
                        {idx.is_unique && <span className="text-[#007acc] mr-1">UNIQUE</span>}
                        {idx.index_type}
                      </td>
                    </tr>
                  ))}
                  {structure.indexes.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-[#555] italic">No indexes found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Constraints Section */}
          <section>
            <div className="flex items-center gap-2 mb-4 text-[#ccc]">
              <ShieldAlert size={18} className="text-[#007acc]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Constraints</h2>
              <span className="text-xs text-[#666] ml-2">({structure.constraints.length})</span>
            </div>
            <div className="bg-[#1e1e1e] border border-[#333] rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#2a2d2e] text-[#999] border-b border-[#333]">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Definition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#333]">
                  {structure.constraints.map((cons) => (
                    <tr key={cons.name} className="hover:bg-[#252526] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-[#f87171]">{cons.name}</td>
                      <td className="px-4 py-2.5 text-[#ccc] font-medium">{cons.constraint_type}</td>
                      <td className="px-4 py-2.5 text-[#666] font-mono text-[10px] break-all max-w-[200px]">{cons.definition || '-'}</td>
                    </tr>
                  ))}
                  {structure.constraints.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-[#555] italic">No constraints found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
