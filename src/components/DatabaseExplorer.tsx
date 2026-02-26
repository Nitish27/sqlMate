import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Table as TableIcon, Eye, Zap, Hash, ExternalLink, Columns, Copy, CopyPlus, Trash, Trash2 } from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
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
          "flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors text-xs rounded-md mx-2",
          active ? "bg-accent/20 text-accent font-medium" : "text-text-secondary hover:bg-border"
        )}
        title={label}
      >
        <div className="w-4 flex items-center justify-center flex-shrink-0">
          {hasChildren && (
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="flex-shrink-0">{icon}</div>
          <span className="truncate">{label}</span>
        </div>
      </div>
      {expanded && children && (
        <div>
          {children}
        </div>
      )}
    </div>
  );
};

// Inline table item with built-in context menu
const TableItem = ({ table, active, onClick, connectionId }: {
  table: string;
  active: boolean;
  onClick: () => void;
  connectionId: string;
}) => {
  const { openTab, triggerRefresh, savedConnections, tabs, closeTab } = useDatabaseStore();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');

  const conn = savedConnections.find(c => c.id === connectionId);
  const dbType = conn?.type || 'Postgres';

  const quoteId = (name: string) => dbType === 'MySql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;

  const handleOpenStructure = () => {
    openTab({ type: 'table', title: table, tableName: table, connectionId, viewMode: 'structure' });
  };

  const handleClone = () => {
    setCloneName(`${table}_copy`);
    setCloneDialogOpen(true);
  };

  const executeClone = async () => {
    if (!cloneName.trim()) return;
    const sql = `CREATE TABLE ${quoteId(cloneName.trim())} AS SELECT * FROM ${quoteId(table)}`;
    try {
      await invoke('execute_query', { connectionId, sql });
      triggerRefresh();
    } catch (err: any) {
      alert(`Clone failed: ${err}`);
    }
    setCloneDialogOpen(false);
  };

  const handleTruncate = async () => {
    if (!window.confirm(`Are you sure you want to truncate "${table}"?\n\nThis will permanently delete ALL rows.`)) return;
    const sql = dbType === 'Sqlite' ? `DELETE FROM ${quoteId(table)}` : `TRUNCATE TABLE ${quoteId(table)}`;
    try {
      await invoke('execute_query', { connectionId, sql });
      triggerRefresh();
    } catch (err: any) {
      alert(`Truncate failed: ${err}`);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete "${table}"?\n\nThis action CANNOT be undone.`)) return;
    const sql = dbType === 'Postgres' ? `DROP TABLE ${quoteId(table)} CASCADE` : `DROP TABLE ${quoteId(table)}`;
    try {
      await invoke('execute_query', { connectionId, sql });
      tabs.filter(t => t.type === 'table' && t.tableName === table && t.connectionId === connectionId).forEach(t => closeTab(t.id));
      triggerRefresh();
    } catch (err: any) {
      alert(`Delete failed: ${err}`);
    }
  };

  const menuItemClass = "flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm";
  const dangerItemClass = "flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 outline-none focus:bg-red-900/40 focus:text-red-300 cursor-default rounded-sm";

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <div
            className="select-none"
            onClick={onClick}
          >
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors text-xs rounded-md mx-2",
                active ? "bg-accent/20 text-accent font-medium" : "text-text-secondary hover:bg-border"
              )}
              title={table}
            >
              <div className="w-4 flex items-center justify-center flex-shrink-0" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <div className="flex-shrink-0"><TableIcon size={14} className="text-text-muted" /></div>
                <span className="truncate">{table}</span>
              </div>
            </div>
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content
            className={cn(
              "min-w-[180px] bg-[#252526] border border-[#454545] rounded-md overflow-hidden p-1 shadow-xl z-[100]",
              "animate-in fade-in zoom-in duration-100"
            )}
          >
            <ContextMenu.Item className={menuItemClass} onClick={onClick}>
              <ExternalLink size={14} />
              <span>Open in new tab</span>
            </ContextMenu.Item>

            <ContextMenu.Item className={menuItemClass} onClick={handleOpenStructure}>
              <Columns size={14} />
              <span>Open structure</span>
            </ContextMenu.Item>

            <ContextMenu.Separator className="h-px bg-[#454545] my-1" />

            <ContextMenu.Item className={menuItemClass} onClick={() => navigator.clipboard.writeText(table)}>
              <Copy size={14} />
              <span>Copy name</span>
            </ContextMenu.Item>

            <ContextMenu.Separator className="h-px bg-[#454545] my-1" />

            <ContextMenu.Item className={menuItemClass} onClick={handleClone}>
              <CopyPlus size={14} />
              <span>Clone...</span>
            </ContextMenu.Item>

            <ContextMenu.Item className={dangerItemClass} onClick={handleTruncate}>
              <Trash size={14} />
              <span>Truncate...</span>
            </ContextMenu.Item>

            <ContextMenu.Item className={dangerItemClass} onClick={handleDelete}>
              <Trash2 size={14} />
              <span>Delete...</span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {/* Clone dialog */}
      {cloneDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
          <div className="bg-[#252526] border border-[#454545] rounded-lg p-4 w-[360px] shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-3">Clone Table</h3>
            <p className="text-xs text-text-muted mb-3">
              Create a copy of <span className="font-mono text-accent">{table}</span>:
            </p>
            <input
              type="text"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') executeClone();
                if (e.key === 'Escape') setCloneDialogOpen(false);
              }}
              className="w-full bg-[#1e1e1e] border border-[#454545] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent mb-4"
              autoFocus
              placeholder="New table name"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCloneDialogOpen(false)} className="px-3 py-1 text-xs text-text-muted hover:text-white rounded transition-colors">Cancel</button>
              <button onClick={executeClone} disabled={!cloneName.trim()} className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors disabled:opacity-50">Clone</button>
            </div>
          </div>
        </div>
      )}
    </>
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
      setTables([]);
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
            <TableItem
              key={table}
              table={table}
              active={activeTable === table}
              onClick={() => handleTableClick(table)}
              connectionId={activeConnectionId!}
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
