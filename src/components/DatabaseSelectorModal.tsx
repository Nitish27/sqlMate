import { useState, useEffect, useRef } from 'react';
import { Search, Database, Plus, X, ChevronRight, AlertCircle } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '../utils/cn';

export const DatabaseSelectorModal = () => {
  const { 
    showDatabaseSelector, 
    setShowDatabaseSelector, 
    activeConnectionId, 
    activeDatabase, 
    setActiveDatabase, 
    databases, 
    setDatabases 
  } = useDatabaseStore();

  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredDatabases = databases.filter(db => 
    db.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (showDatabaseSelector && activeConnectionId) {
      setSearch('');
      setSelectedIndex(0);
      setIsCreating(false);
      setError(null);
      
      // Fetch latest database list when modal opens
      setIsSubmitting(true);
      invoke<string[]>('get_databases', { connectionId: activeConnectionId })
        .then(dbs => {
          setDatabases(dbs);
          setIsSubmitting(false);
        })
        .catch(err => {
          console.error('Failed to fetch databases in modal:', err);
          setError(err.toString());
          setIsSubmitting(false);
        });

      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showDatabaseSelector, activeConnectionId, setDatabases]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  const handleClose = () => setShowDatabaseSelector(false);

  const handleSelect = (db: string) => {
    setActiveDatabase(db);
    handleClose();
  };

  const handleCreate = async () => {
    if (!newDbName.trim() || !activeConnectionId) return;
    
    setIsSubmitting(true);
    setError(null);
    try {
      await invoke('create_database', { 
        connectionId: activeConnectionId, 
        dbName: newDbName.trim() 
      });
      
      // Refresh database list
      const updatedDbs = await invoke<string[]>('get_databases', { connectionId: activeConnectionId });
      setDatabases(updatedDbs);
      
      // Select the new database
      await setActiveDatabase(newDbName.trim());
      useDatabaseStore.getState().triggerRefresh();
      handleClose();
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
    
    if (isCreating) {
      if (e.key === 'Enter') handleCreate();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredDatabases.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredDatabases.length) % Math.max(1, filteredDatabases.length));
    } else if (e.key === 'Enter') {
      if (filteredDatabases.length > 0) {
        handleSelect(filteredDatabases[selectedIndex]);
      }
    }
  };

  if (!showDatabaseSelector) return null;

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-sm bg-black/40 animate-in fade-in duration-200"
    >
      <div 
        ref={modalRef}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl bg-[#2C2C2C] border border-[#3C3C3C] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header / Search */}
        <div className="p-4 border-b border-[#3C3C3C] bg-[#1e1e1e]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Database size={16} className="text-accent" />
              {isCreating ? 'Create New Database' : 'Open Database'}
            </h2>
            <button onClick={handleClose} className="p-1 hover:bg-[#3C3C3C] rounded transition-colors">
              <X size={16} />
            </button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
            <input
              ref={inputRef}
              autoFocus
              value={isCreating ? newDbName : search}
              onChange={(e) => isCreating ? setNewDbName(e.target.value) : setSearch(e.target.value)}
              placeholder={isCreating ? "Database name..." : "Search for database... (⌘K)"}
              className="w-full bg-[#2C2C2C] border border-[#3C3C3C] rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-accent shadow-inner transition-all"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 max-h-[400px] overflow-y-auto custom-scrollbar">
          {error && (
            <div className="p-4 bg-red-500/10 border-b border-red-500/20 flex items-start gap-3 text-red-400 text-xs">
              <AlertCircle size={14} className="mt-0.5" />
              <p className="flex-1">{error}</p>
            </div>
          )}

          {isCreating ? (
            <div className="p-6 text-center space-y-4">
              <p className="text-xs text-text-secondary">
                You are creating a new database in the current connection.
              </p>
              <div className="flex justify-center gap-3">
                <button 
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-1.5 text-xs font-medium border border-[#3C3C3C] rounded-md hover:bg-[#3C3C3C] transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreate}
                  disabled={!newDbName.trim() || isSubmitting}
                  className="px-6 py-1.5 text-xs font-bold bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-lg shadow-accent/20"
                >
                  {isSubmitting ? 'Creating...' : 'Create Database'}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-2">
              {filteredDatabases.length > 0 ? (
                filteredDatabases.map((db, index) => (
                  <button
                    key={db}
                    onClick={() => handleSelect(db)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-all group",
                      index === selectedIndex ? "bg-accent text-white" : "text-text-secondary hover:bg-[#3C3C3C]"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded flex items-center justify-center transition-colors",
                      index === selectedIndex ? "bg-white/20" : "bg-[#1e1e1e] group-hover:bg-[#444]"
                    )}>
                      <Database size={16} className={index === selectedIndex ? "text-white" : "text-text-muted"} />
                    </div>
                    <div className="flex-1 flex items-center justify-between">
                      <span className="font-medium truncate">{db}</span>
                      <div className="flex items-center gap-2">
                        {db === activeDatabase && (
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                            index === selectedIndex ? "bg-white/20" : "bg-accent/10 text-accent"
                          )}>Active</span>
                        )}
                        <ChevronRight size={14} className={cn(
                          "transition-transform",
                          index === selectedIndex ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"
                        )} />
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-12 text-center flex flex-col items-center gap-3">
                  <div className="w-12 h-12 bg-[#1e1e1e] rounded-full flex items-center justify-center border border-[#3C3C3C]">
                    <Search size={20} className="text-text-muted" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-text-primary">No databases found</p>
                    <p className="text-xs text-text-secondary">Try a different search term or create one.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isCreating && (
          <div className="p-2 border-t border-[#3C3C3C] bg-[#1e1e1e] flex items-center justify-between">
            <div className="flex items-center gap-4 px-2">
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                <kbd className="bg-[#2C2C2C] px-1 rounded border border-[#3C3C3C]">↑↓</kbd>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                <kbd className="bg-[#2C2C2C] px-1 rounded border border-[#3C3C3C]">Enter</kbd>
                <span>Open</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                <kbd className="bg-[#2C2C2C] px-1 rounded border border-[#3C3C3C]">Esc</kbd>
                <span>Close</span>
              </div>
            </div>
            
            <button 
              onClick={() => {
                setIsCreating(true);
                setNewDbName('');
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-accent hover:bg-accent/10 rounded-md transition-colors"
            >
              <Plus size={14} />
              New Database...
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
