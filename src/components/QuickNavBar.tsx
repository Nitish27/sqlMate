import { useState } from 'react';
import { useDatabaseStore } from '../store/databaseStore';
import { Database, Server, Plus, ChevronDown } from 'lucide-react';

export const QuickNavBar = () => {
  const { 
    activeConnectionId, 
    activeDatabase, 
    savedConnections, 
    setActiveConnection,
    setActiveDatabase,
    databases,
    openTab,
    setShowConnectionModal,
    setShowDatabaseSelector
  } = useDatabaseStore();

  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const [dbDropdownOpen, setDbDropdownOpen] = useState(false);

  const connection = savedConnections.find(c => c.id === activeConnectionId);

  return (
    <div className="flex items-center gap-1 p-2 border-b border-[#2C2C2C] bg-[#1e1e1e]">
      <div className="relative flex-1">
        <button 
          onClick={() => setConnDropdownOpen(!connDropdownOpen)}
          className="w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded bg-[#2C2C2C] hover:bg-[#3C3C3C] transition-colors text-[11px] font-medium"
        >
          <div className="flex items-center gap-1.5 truncate">
            <Server size={12} className="text-accent opacity-70" />
            <span className="truncate">{connection?.name || 'Select connection...'}</span>
          </div>
          <ChevronDown size={10} className="opacity-50" />
        </button>

        {connDropdownOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#2C2C2C] border border-[#3C3C3C] rounded-md shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
            {savedConnections.map(conn => (
              <button
                key={conn.id}
                onClick={() => {
                  setActiveConnection(conn.id);
                  setConnDropdownOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-white text-left text-[11px] transition-colors ${conn.id === activeConnectionId ? 'bg-accent/10 border-l-2 border-accent' : ''}`}
              >
                <div className={`w-2 h-2 rounded-full bg-${conn.color}-500`} />
                <span className="truncate">{conn.name}</span>
              </button>
            ))}
            <div className="border-t border-[#3C3C3C] my-1" />
            <button 
              onClick={() => {
                setShowConnectionModal(true);
                setConnDropdownOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] text-left text-[11px] italic"
            >
              <Plus size={12} />
              Manage Connections...
            </button>
          </div>
        )}
      </div>

      <div className="relative flex-1">
        <button 
          onClick={() => setDbDropdownOpen(!dbDropdownOpen)}
          disabled={!activeConnectionId}
          className="w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded bg-[#2C2C2C] hover:bg-[#3C3C3C] transition-colors text-[11px] font-medium disabled:opacity-30"
        >
          <div className="flex items-center gap-1.5 truncate">
            <Database size={12} className="text-accent opacity-70" />
            <span className="truncate">{activeDatabase || 'Select DB...'}</span>
          </div>
          <ChevronDown size={10} className="opacity-50" />
        </button>

        {dbDropdownOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#2C2C2C] border border-[#3C3C3C] rounded-md shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
            {databases.map(db => (
              <button
                key={db}
                onClick={() => {
                  setActiveDatabase(db);
                  setDbDropdownOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-white text-left text-[11px] transition-colors ${db === activeDatabase ? 'bg-accent/10 border-l-2 border-accent' : ''}`}
              >
                <Database size={10} className="opacity-50" />
                <span className="truncate">{db}</span>
              </button>
            ))}
            <div className="border-t border-[#3C3C3C] my-1" />
            <button 
              onClick={() => {
                setShowDatabaseSelector(true);
                setDbDropdownOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] text-left text-[11px] italic"
            >
              <Plus size={12} />
              Manage Databases...
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => {
          if (activeConnectionId) {
            openTab({
              type: 'query',
              title: 'New Query',
              connectionId: activeConnectionId,
              query: ''
            });
          }
        }}
        disabled={!activeConnectionId}
        className="p-2 rounded bg-accent/20 hover:bg-accent text-accent hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-accent/20 disabled:hover:text-accent"
        title="New Query Editor"
      >
        <Plus size={14} />
      </button>
    </div>
  );
};
