import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Table as TableIcon, Eye, Zap, Hash } from 'lucide-react';
import { cn } from '../utils/cn';
import { useDatabaseStore } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';

interface TreeItemProps {
  label: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

const TreeItem = ({ label, icon, children, active, onClick }: TreeItemProps) => {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = !!children;

  return (
    <div className="select-none">
      <div 
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          onClick?.();
        }}
        className={cn(
          "flex items-center gap-2 px-2 py-1 cursor-pointer transition-colors text-xs rounded-md mx-2",
          active ? "bg-accent/20 text-accent font-medium" : "text-text-secondary hover:bg-border"
        )}
      >
        <div className="w-4 flex items-center justify-center">
          {hasChildren && (
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          )}
        </div>
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
      </div>
      {expanded && children && (
        <div className="pl-4">
          {children}
        </div>
      )}
    </div>
  );
};

export const DatabaseExplorer = () => {
  const { activeConnectionId, activeDatabase, activeTable, openTab, refreshTrigger, sidebarSearchTerm } = useDatabaseStore();
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!activeConnectionId || !activeDatabase) {
      setTables([]);
      return;
    }

    const fetchTables = async () => {

      setLoading(true);
      setTables([]); // Visual feedback: clear tables while loading
      try {
        const result = await invoke<string[]>('get_tables', { connectionId: activeConnectionId });

        setTables(result);
      } catch (err) {
        console.error("Failed to fetch tables:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, [activeConnectionId, activeDatabase, refreshTrigger]);

  const handleTableClick = (table: string) => {
    if (!activeConnectionId) return;
    openTab({
      type: 'table',
      title: table,
      tableName: table,
      connectionId: activeConnectionId
    });
  };

  const filteredTables = tables.filter(t => 
    t.toLowerCase().includes(sidebarSearchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto pt-2 space-y-1">
      <TreeItem 
        label={`Tables (${filteredTables.length}${sidebarSearchTerm ? ` / ${tables.length}` : ''})`}
        icon={<TableIcon size={14} className="text-accent" />}
      >
        {loading ? (
           <div className="px-8 py-1 text-xs text-text-muted italic">Loading...</div>
        ) : (
          filteredTables.map((table) => (
             <TreeItem 
               key={table}
               label={table} 
               icon={<TableIcon size={14} className="text-text-muted" />} 
               active={activeTable === table}
               onClick={() => handleTableClick(table)}
             />
          ))
        )}
      </TreeItem>

      <TreeItem 
        label="Views" 
        icon={<Eye size={14} className="text-sky-500" />}
      />

      <TreeItem 
        label="Indexes" 
        icon={<Zap size={14} className="text-amber-500" />}
      />

      <TreeItem 
        label="Functions" 
        icon={<Hash size={14} className="text-emerald-500" />}
      />
    </div>
  );
};
