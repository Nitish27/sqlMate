import { useState, useEffect } from 'react';
import { X, Upload, FileText, Database, Check, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';

export const ImportDialog = () => {
  const { 
    showImportDialog, 
    setShowImportDialog, 
    activeConnectionId, 
    activeDatabase 
  } = useDatabaseStore();

  const [step, setStep] = useState<'selection' | 'config' | 'mapping' | 'progress'>('selection');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [format, setFormat] = useState<'csv' | 'sql'>('csv');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importId] = useState(() => Math.random().toString(36).substring(7));
  
  // CSV Options
  const [csvOptions, setCsvOptions] = useState({
    tableName: '',
    createTable: true,
    hasHeader: true,
    delimiter: ',',
    skipRows: 0,
    batchSize: 1000,
  });

  // SQL Options
  const [sqlOptions, setSqlOptions] = useState({
    stopOnError: false,
  });

  // Progress State
  const [progress, setProgress] = useState<{
    rowsProcessed: number;
    totalRows?: number;
    percentage?: number;
    status: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!showImportDialog) return;

    const unlisten = listen('import-progress', (event: any) => {
      const payload = event.payload;
      if (payload.import_id === importId) {
        setProgress({
          rowsProcessed: payload.rows_processed,
          totalRows: payload.total_rows,
          percentage: payload.percentage,
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
  }, [showImportDialog, importId]);

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Data Files', extensions: ['csv', 'sql', 'txt'] }
        ]
      });

      if (selected && !Array.isArray(selected)) {
        setFilePath(selected);
        const ext = selected.split('.').pop()?.toLowerCase();
        if (ext === 'sql') {
          setFormat('sql');
        } else {
          setFormat('csv');
        }
        setStep('config');
      }
    } catch (err) {
      console.error('File selection failed:', err);
    }
  };

  const startImport = async () => {
    if (!filePath || !activeConnectionId) return;

    setError(null);
    setLoading(true);
    setStep('progress');

    try {
      if (format === 'csv') {
        await invoke('import_csv', {
          connectionId: activeConnectionId,
          importId,
          options: {
            file_path: filePath,
            table_name: csvOptions.tableName,
            create_table_if_missing: csvOptions.createTable,
            has_header: csvOptions.hasHeader,
            delimiter: csvOptions.delimiter,
            skip_rows: csvOptions.skipRows,
            batch_size: csvOptions.batchSize,
            column_mapping: {} // TODO: Implement mapping UI if needed
          }
        });
      } else {
        await invoke('import_sql_dump', {
          connectionId: activeConnectionId,
          importId,
          options: {
            file_path: filePath,
            stop_on_error: sqlOptions.stopOnError
          }
        });
      }
    } catch (err: any) {
      setError(err.toString());
      setLoading(false);
    }
  };

  if (!showImportDialog) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200">
      <div className="bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Upload size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Import Data</h2>
              <p className="text-[11px] text-text-muted">Import CSV or SQL dump into {activeDatabase}</p>
            </div>
          </div>
          <button 
            onClick={() => setShowImportDialog(false)}
            className="p-1.5 hover:bg-[#2a2a2a] rounded-md text-text-muted hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'selection' && (
            <div className="space-y-6 flex flex-col items-center justify-center py-10">
              <div 
                onClick={handleSelectFile}
                className="w-full max-w-sm aspect-video border-2 border-dashed border-[#333] hover:border-accent/50 hover:bg-accent/5 rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all group"
              >
                <div className="p-4 bg-[#252525] rounded-full group-hover:scale-110 transition-transform">
                  <Upload size={32} className="text-text-muted group-hover:text-accent" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-white">Choose a file to import</p>
                  <p className="text-[12px] text-text-muted mt-1">CSV or SQL files are supported</p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-text-muted">
                <div className="flex items-center gap-1.5 grayscale opacity-50">
                  <FileText size={16} />
                  <span className="text-[11px] font-medium">CSV</span>
                </div>
                <div className="flex items-center gap-1.5 grayscale opacity-50">
                  <Database size={16} />
                  <span className="text-[11px] font-medium">SQL DUMP</span>
                </div>
              </div>
            </div>
          )}

          {step === 'config' && (
            <div className="space-y-6">
              <div className="p-3 bg-[#252525] border border-[#333] rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-accent" />
                    <span className="text-[12px] font-medium text-white truncate max-w-[400px]">{filePath?.split('/').pop()}</span>
                  </div>
                  <button onClick={() => setStep('selection')} className="text-[11px] text-accent hover:underline">Change</button>
                </div>
              </div>

              {format === 'csv' ? (
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Target Table</label>
                      <input 
                        type="text"
                        value={csvOptions.tableName}
                        onChange={e => setCsvOptions({...csvOptions, tableName: e.target.value})}
                        placeholder="new_table_name"
                        className="w-full bg-[#252525] border border-[#333] rounded px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-[#555]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        id="createTable"
                        checked={csvOptions.createTable}
                        onChange={e => setCsvOptions({...csvOptions, createTable: e.target.checked})}
                        className="rounded border-[#333] bg-[#252525] text-accent"
                      />
                      <label htmlFor="createTable" className="text-xs text-text-secondary">Create table if it doesn't exist</label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Separator</label>
                      <select 
                        value={csvOptions.delimiter}
                        onChange={e => setCsvOptions({...csvOptions, delimiter: e.target.value})}
                        className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:outline-none"
                      >
                        <option value=",">Comma (,)</option>
                        <option value=";">Semicolon (;)</option>
                        <option value="	">Tab (\t)</option>
                        <option value="|">Pipe (|)</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        id="hasHeader"
                        checked={csvOptions.hasHeader}
                        onChange={e => setCsvOptions({...csvOptions, hasHeader: e.target.checked})}
                        className="rounded border-[#333] bg-[#252525] text-accent"
                      />
                      <label htmlFor="hasHeader" className="text-xs text-text-secondary">First row is header</label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      id="stopOnError"
                      checked={sqlOptions.stopOnError}
                      onChange={e => setSqlOptions({...sqlOptions, stopOnError: e.target.checked})}
                      className="rounded border-[#333] bg-[#252525] text-accent"
                    />
                    <label htmlFor="stopOnError" className="text-xs text-text-secondary">Stop execution on error</label>
                  </div>
                  <p className="text-[11px] text-text-muted bg-[#252525] p-3 rounded border border-[#333]">
                    SQL Import will execute instructions from the file directly. Ensure the file contains valid SQL for {activeDatabase}.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 'progress' && (
            <div className="space-y-8 py-4">
              <div className="flex flex-col items-center gap-4">
                {progress?.status === 'complete' ? (
                  <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center text-green-500">
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
                    {progress?.status === 'complete' ? 'Import Successful' : 
                     progress?.status === 'error' ? 'Import Failed' : 'Importing Data...'}
                  </h3>
                  <p className="text-sm text-text-muted">
                    {progress?.status === 'complete' ? `Processed ${progress.rowsProcessed.toLocaleString()} rows` : 
                     progress?.status === 'error' ? 'Something went wrong during import' : 
                     `Total rows processed: ${progress?.rowsProcessed.toLocaleString() || 0}`}
                  </p>
                </div>
              </div>

              {progress?.percentage !== undefined && progress.status === 'processing' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] font-medium text-text-muted">
                    <span>Progress</span>
                    <span>{Math.round(progress.percentage)}%</span>
                  </div>
                  <div className="h-2 bg-[#252525] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${progress.percentage}%` }}
                    />
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
                onClick={() => setStep('selection')}
                className="px-4 py-2 text-xs font-medium text-text-muted hover:text-white transition-colors"
                disabled={loading}
              >
                Back
              </button>
              <button 
                onClick={startImport}
                disabled={loading || (format === 'csv' && !csvOptions.tableName)}
                className="px-6 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                Start Import
              </button>
            </>
          )}

          {step === 'progress' && (progress?.status === 'complete' || progress?.status === 'error') && (
            <button 
              onClick={() => {
                setShowImportDialog(false);
                setStep('selection');
                setProgress(null);
                setFilePath(null);
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
