import { useState, useEffect } from 'react';
import { X, Download, Check, AlertCircle, Loader2, ChevronRight, List } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';

export const ExportDialog = () => {
  const { 
    showExportDialog, 
    setShowExportDialog, 
    activeConnectionId, 
    activeDatabase,
    activeTable 
  } = useDatabaseStore();

  const [step, setStep] = useState<'config' | 'progress'>('config');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportId] = useState(() => Math.random().toString(36).substring(7));
  const [allTables, setAllTables] = useState<string[]>([]);
  
  // Export Options
  const [options, setOptions] = useState({
    tables: [] as string[],
    outputPath: '',
    format: 'csv' as 'csv' | 'json' | 'sql',
    includeSchema: true,
    includeData: true,
  });

  // Progress State
  const [progress, setProgress] = useState<{
    currentTable: string;
    rowsExported: number;
    status: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (showExportDialog && activeConnectionId) {
      // Fetch all tables to select from
      invoke<string[]>('get_tables', { connectionId: activeConnectionId })
        .then(setAllTables)
        .catch(err => console.error('Failed to fetch tables:', err));

      // Preset current table if any
      if (activeTable) {
        setOptions(prev => ({ ...prev, tables: [activeTable] }));
      }
    }
  }, [showExportDialog, activeConnectionId, activeTable]);

  useEffect(() => {
    if (!showExportDialog) return;

    const unlisten = listen('export-progress', (event: any) => {
      const payload = event.payload;
      if (payload.export_id === exportId) {
        setProgress({
          currentTable: payload.current_table,
          rowsExported: payload.rows_exported,
          status: payload.status,
          error: payload.error,
        });
        
        if (payload.status === 'complete' || payload.status === 'error') {
          setLoading(false);
        }
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [showExportDialog, exportId]);

  const handleSelectPath = async () => {
    try {
      const path = await save({
        filters: [
          { name: options.format.toUpperCase(), extensions: [options.format] }
        ],
        defaultPath: `${activeTable || 'export'}.${options.format}`
      });

      if (path) {
        setOptions({ ...options, outputPath: path });
      }
    } catch (err) {
      console.error('Path selection failed:', err);
    }
  };

  const startExport = async () => {
    if (!options.outputPath || options.tables.length === 0 || !activeConnectionId) return;

    setError(null);
    setLoading(true);
    setStep('progress');

    try {
      await invoke('export_data', {
        connectionId: activeConnectionId,
        exportId,
        options: {
          tables: options.tables,
          output_path: options.outputPath,
          format: options.format,
          include_schema: options.includeSchema,
          include_data: options.includeData,
        }
      });
    } catch (err: any) {
      setError(err.toString());
      setLoading(false);
    }
  };

  const toggleTable = (table: string) => {
    setOptions(prev => ({
      ...prev,
      tables: prev.tables.includes(table) 
        ? prev.tables.filter(t => t !== table)
        : [...prev.tables, table]
    }));
  };

  if (!showExportDialog) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <div className="bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl w-[650px] max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Download size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Export Data</h2>
              <p className="text-[11px] text-text-muted">Extract tables from {activeDatabase}</p>
            </div>
          </div>
          <button 
            onClick={() => setShowExportDialog(false)}
            className="p-1.5 hover:bg-[#2a2a2a] rounded-md text-text-muted hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'config' && (
            <div className="space-y-8">
              {/* Format & Path */}
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Format</label>
                  <div className="flex p-0.5 bg-[#252525] border border-[#333] rounded-lg">
                    {(['csv', 'json', 'sql'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setOptions({ ...options, format: f, outputPath: '' })}
                        className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all ${options.format === f ? 'bg-accent text-white shadow-lg' : 'text-text-muted hover:text-text-secondary'}`}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Storage Path</label>
                  <div 
                    onClick={handleSelectPath}
                    className="w-full bg-[#252525] border border-[#333] rounded px-3 py-2 text-xs text-white cursor-pointer hover:border-accent/40 transition-colors truncate min-h-[34px] flex items-center"
                  >
                    {options.outputPath ? (
                      <span className="truncate">{options.outputPath}</span>
                    ) : (
                      <span className="text-[#555]">Select where to save...</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Table Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Select Tables ({options.tables.length})</label>
                  <div className="flex gap-3">
                    <button onClick={() => setOptions({...options, tables: allTables})} className="text-[10px] text-accent hover:underline">Select All</button>
                    <button onClick={() => setOptions({...options, tables: []})} className="text-[10px] text-text-muted hover:underline">Clear</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 h-48 overflow-y-auto p-2 bg-[#252525] border border-[#333] rounded-lg custom-scrollbar">
                  {allTables.map(table => (
                    <div 
                      key={table}
                      onClick={() => toggleTable(table)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-all ${options.tables.includes(table) ? 'bg-accent/10 border-accent/30 text-accent' : 'border-transparent text-text-secondary hover:bg-[#333]'}`}
                    >
                      <List size={14} className={options.tables.includes(table) ? 'text-accent' : 'text-text-muted'} />
                      <span className="text-[12px] truncate font-medium">{table}</span>
                      {options.tables.includes(table) && <Check size={12} className="ml-auto" />}
                    </div>
                  ))}
                  {allTables.length === 0 && (
                    <div className="col-span-2 flex items-center justify-center h-full text-text-muted text-[11px] italic">No tables found</div>
                  ) }
                </div>
              </div>

              {/* Formatting Options */}
              {options.format === 'sql' && (
                <div className="p-4 bg-accent/5 border border-accent/20 rounded-lg flex gap-4">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      id="incSchema"
                      checked={options.includeSchema}
                      onChange={e => setOptions({...options, includeSchema: e.target.checked})}
                      className="rounded border-[#333] bg-[#252525] text-accent"
                    />
                    <label htmlFor="incSchema" className="text-xs text-text-secondary">Include DDL (Schema)</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      id="incData"
                      checked={options.includeData}
                      onChange={e => setOptions({...options, includeData: e.target.checked})}
                      className="rounded border-[#333] bg-[#252525] text-accent"
                    />
                    <label htmlFor="incData" className="text-xs text-text-secondary">Include Insert Statements</label>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'progress' && (
            <div className="space-y-8 py-4">
              <div className="flex flex-col items-center gap-4">
                {progress?.status === 'complete' ? (
                  <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center text-green-500 animate-in zoom-in duration-300">
                    <Check size={28} />
                  </div>
                ) : progress?.status === 'error' ? (
                  <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center text-red-500">
                    <AlertCircle size={28} />
                  </div>
                ) : (
                  <Loader2 size={32} className="text-accent animate-spin" />
                )}
                
                <div className="text-center">
                  <h3 className="text-lg font-semibold text-white">
                    {progress?.status === 'complete' ? 'Export Complete' : 
                     progress?.status === 'error' ? 'Export Failed' : 'Exporting Data...'}
                  </h3>
                  <p className="text-sm text-text-muted mt-1">
                    {progress?.status === 'complete' ? `Saved to ${options.outputPath.split('/').pop()}` : 
                     progress?.status === 'error' ? 'An error occurred during export' : 
                     `Processing table: ${progress?.currentTable || 'Initializing...'}`}
                  </p>
                </div>
              </div>

              {progress?.status === 'processing' && (
                <div className="p-4 bg-[#252525] border border-[#333] rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-text-muted">Rows Exported</span>
                    <span className="text-[11px] font-bold text-accent">{progress.rowsExported.toLocaleString()}</span>
                  </div>
                  <div className="h-1 bg-[#333] rounded-full overflow-hidden">
                    <div className="h-full bg-accent animate-pulse w-full origin-left" />
                  </div>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono break-all max-h-40 overflow-y-auto">
                  {error}
                </div>
              )}

              {progress?.error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono break-all max-h-40 overflow-y-auto">
                  {progress.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#252526] border-t border-[#333] flex justify-end gap-3">
          {step === 'config' && (
            <>
              <button 
                onClick={() => setShowExportDialog(false)}
                className="px-4 py-2 text-xs font-medium text-text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={startExport}
                disabled={loading || !options.outputPath || options.tables.length === 0}
                className="px-6 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-accent/20"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                Start Export
              </button>
            </>
          )}

          {step === 'progress' && (progress?.status === 'complete' || progress?.status === 'error') && (
            <button 
              onClick={() => {
                setShowExportDialog(false);
                setStep('config');
                setProgress(null);
                setLoading(false);
              }}
              className="px-6 py-2 bg-[#333] hover:bg-[#444] text-white text-xs font-bold rounded-lg transition-all"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
