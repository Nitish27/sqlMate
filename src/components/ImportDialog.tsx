import { useState, useEffect } from 'react';
import { X, Upload, FileText, Database, Check, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { useDatabaseStore, type TableStructure } from '../store/databaseStore';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { invokeWithExecutionPolicy } from '../utils/executionPolicy';
import { isSensitiveColumn } from '../utils/sensitiveData';
import { listen } from '@tauri-apps/api/event';

interface CsvPreview {
  columns: string[];
  source_keys: string[];
  rows: string[][];
  total_rows: number;
  file_size: number;
  modified_ns: string;
}

export const ImportDialog = () => {
  const { 
    showImportDialog, 
    setShowImportDialog, 
    activeConnectionId, 
    activeDatabase,
    sidebarItems,
    fetchSidebarItems,
  } = useDatabaseStore();

  const [step, setStep] = useState<'selection' | 'config' | 'review' | 'progress'>('selection');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [format, setFormat] = useState<'csv' | 'sql'>('csv');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importId] = useState(() => Math.random().toString(36).substring(7));
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [targetColumns, setTargetColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [reviewTarget, setReviewTarget] = useState<{ connectionId: string; database: string } | null>(null);
  
  // CSV Options
  const [csvOptions, setCsvOptions] = useState({
    tableName: '',
    createTable: false,
    hasHeader: true,
    delimiter: ',',
    skipRows: 0,
    batchSize: 500,
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
          if (payload.status === 'complete' && activeConnectionId) {
            void fetchSidebarItems(activeConnectionId);
          }
        }
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [showImportDialog, importId, activeConnectionId, fetchSidebarItems]);

  const resetReview = () => {
    setCsvPreview(null);
    setTargetColumns([]);
    setColumnMapping({});
    setReviewTarget(null);
    setError(null);
  };

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Data Files', extensions: ['csv', 'sql', 'txt'] }
        ]
      });

      if (selected && !Array.isArray(selected)) {
        resetReview();
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

  const prepareCsvReview = async () => {
    if (!filePath || !activeConnectionId || !activeDatabase || !csvOptions.tableName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const preview = await invoke<CsvPreview>('preview_csv', {
        filePath,
        delimiter: csvOptions.delimiter,
        hasHeader: csvOptions.hasHeader,
        skipRows: csvOptions.skipRows,
      });
      const structure = await invoke<TableStructure>('get_table_structure', {
        connectionId: activeConnectionId,
        tableName: csvOptions.tableName.trim(),
      });
      const columns = structure.columns.map(column => column.name);
      if (columns.length === 0 && !csvOptions.createTable) {
        throw new Error('Target table not found. Choose an existing table or enable Create table.');
      }
      const mapping = Object.fromEntries(preview.source_keys.flatMap((key, index) => {
        const suggested = columns.length > 0
          ? columns.find(column => column.toLowerCase() === preview.columns[index].toLowerCase())
          : csvOptions.hasHeader ? preview.columns[index] : `column_${index + 1}`;
        return suggested ? [[key, suggested]] : [];
      }));
      setCsvPreview(preview);
      setTargetColumns(columns);
      setColumnMapping(mapping);
      setReviewTarget({ connectionId: activeConnectionId, database: activeDatabase });
      setStep('review');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const startImport = async () => {
    if (!filePath || !activeConnectionId || !activeDatabase) return;
    if (format === 'csv' && (!csvPreview || reviewTarget?.connectionId !== activeConnectionId || reviewTarget?.database !== activeDatabase)) {
      setError('The connection or database changed. Preview this CSV again.');
      return;
    }
    const mappedColumns = Object.values(columnMapping);
    if (format === 'csv' && (mappedColumns.length === 0 || mappedColumns.some(value => !value.trim()) || new Set(mappedColumns.map(value => value.trim().toLowerCase())).size !== mappedColumns.length)) {
      setError('Map at least one CSV column, with each destination used only once.');
      return;
    }

    setError(null);
    setLoading(true);
    setStep('progress');
    setProgress(null);

    try {
      if (format === 'csv') {
        const options = {
            file_path: filePath,
            table_name: csvOptions.tableName.trim(),
            create_table_if_missing: csvOptions.createTable,
            has_header: csvOptions.hasHeader,
            delimiter: csvOptions.delimiter,
            skip_rows: csvOptions.skipRows,
            batch_size: csvOptions.batchSize,
            column_mapping: columnMapping,
            preview_file_size: csvPreview!.file_size,
            preview_modified_ns: csvPreview!.modified_ns,
        };
        await invokeWithExecutionPolicy('import_csv', activeConnectionId, activeDatabase,
          { kind: 'csv_import', payload: options }, { importId, options });
      } else {
        const options = {
            file_path: filePath,
            execute_in_transaction: false,
            stop_on_error: sqlOptions.stopOnError
        };
        await invokeWithExecutionPolicy('import_sql_dump', activeConnectionId, activeDatabase,
          { kind: 'sql_import', payload: options }, { importId, options });
      }
    } catch (err: any) {
      setError(err.toString());
      setLoading(false);
      setStep(format === 'csv' ? 'review' : 'config');
    }
  };

  if (!showImportDialog) return null;

  const knownTables = (activeConnectionId ? sidebarItems[activeConnectionId] || [] : [])
    .filter(item => item.item_type === 'Table')
    .map(item => item.name);
  const mappedTargets = Object.values(columnMapping);
  const mappingValid = mappedTargets.length > 0
    && mappedTargets.every(value => value.trim().length > 0)
    && new Set(mappedTargets.map(value => value.trim().toLowerCase())).size === mappedTargets.length;
  const maskedPreviewColumns = csvPreview?.columns.map((column, index) =>
    isSensitiveColumn(column) || isSensitiveColumn(columnMapping[csvPreview.source_keys[index]] || '')) || [];

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
            onClick={() => { if (!loading) setShowImportDialog(false); }}
            disabled={loading}
            aria-label="Close import dialog"
            className="p-1.5 hover:bg-[#2a2a2a] rounded-md text-text-muted hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'selection' && (
            <div className="space-y-6 flex flex-col items-center justify-center py-10">
              <button type="button"
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
              </button>
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
                  <button onClick={() => { resetReview(); setStep('selection'); }} className="text-[11px] text-accent hover:underline">Change</button>
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
                        onChange={e => { resetReview(); setCsvOptions({...csvOptions, tableName: e.target.value}); }}
                        list="csv-target-tables"
                        placeholder="Select an existing table"
                        className="w-full bg-[#252525] border border-[#333] rounded px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-[#555]"
                      />
                      <datalist id="csv-target-tables">{knownTables.map(name => <option key={name} value={name} />)}</datalist>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        id="createTable"
                        checked={csvOptions.createTable}
                        onChange={e => { resetReview(); setCsvOptions({...csvOptions, createTable: e.target.checked}); }}
                        className="rounded border-[#333] bg-[#252525] text-accent"
                      />
                      <label htmlFor="createTable" className="text-xs text-text-secondary">Create table if it doesn't exist (TEXT columns)</label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Separator</label>
                      <select 
                        value={csvOptions.delimiter}
                        onChange={e => { resetReview(); setCsvOptions({...csvOptions, delimiter: e.target.value}); }}
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
                        onChange={e => { resetReview(); setCsvOptions({...csvOptions, hasHeader: e.target.checked}); }}
                        className="rounded border-[#333] bg-[#252525] text-accent"
                      />
                      <label htmlFor="hasHeader" className="text-xs text-text-secondary">First row is header</label>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="skipCsvRows" className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Skip data rows</label>
                      <input id="skipCsvRows" type="number" min="0" max="1000000" value={csvOptions.skipRows}
                        onChange={e => { resetReview(); setCsvOptions({...csvOptions, skipRows: Math.max(0, Math.floor(Number(e.target.value) || 0))}); }}
                        className="w-full bg-[#252525] border border-[#333] rounded px-3 py-2 text-sm text-white focus:border-accent focus:outline-none" />
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
              {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</p>}
            </div>
          )}

          {step === 'review' && csvPreview && (
            <div className="space-y-5">
              <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-text-secondary">
                <strong className="text-white">Review before import</strong>
                <p className="mt-1">{csvPreview.total_rows.toLocaleString()} rows from {filePath?.split('/').pop()} into {activeDatabase}.{csvOptions.tableName.trim()}.</p>
                <p className="mt-1">Rows are inserted in one transaction. A row error rolls them back. Creating a new table may leave an empty table if import fails.</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white mb-2">Column mapping</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {csvPreview.columns.map((column, index) => {
                    const key = csvPreview.source_keys[index];
                    return <div key={key} className="grid grid-cols-[1fr_1fr] gap-3 items-center text-xs">
                      <span className="truncate text-text-secondary" title={column}>{column}</span>
                      {targetColumns.length > 0 ? (
                        <select aria-label={`Destination for ${column}`} value={columnMapping[key] || ''}
                          onChange={event => {
                            const value = event.target.value;
                            setColumnMapping(current => {
                              const next = { ...current };
                              if (value) next[key] = value;
                              else delete next[key];
                              return next;
                            });
                          }}
                          className="w-full bg-[#252525] border border-[#444] rounded px-2 py-1.5 text-white">
                          <option value="">Skip column</option>
                          {targetColumns.map(target => <option key={target} value={target}>{target}</option>)}
                        </select>
                      ) : (
                        <input aria-label={`Destination for ${column}`} value={columnMapping[key] || ''}
                          onChange={event => {
                            const value = event.target.value;
                            setColumnMapping(current => {
                              const next = { ...current };
                              if (value.trim()) next[key] = value;
                              else delete next[key];
                              return next;
                            });
                          }}
                          placeholder="Skip column"
                          className="w-full bg-[#252525] border border-[#444] rounded px-2 py-1.5 text-white" />
                      )}
                    </div>;
                  })}
                </div>
                {!mappingValid && <p role="alert" className="text-amber-400 text-[11px] mt-2">Map at least one column and use each destination only once.</p>}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white mb-2">First {csvPreview.rows.length} rows</h3>
                <div className="overflow-auto max-h-52 rounded-lg border border-[#333]">
                  <table className="min-w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-[#292929] text-text-secondary"><tr>{csvPreview.columns.map((column, index) => <th key={index} className="px-3 py-2 font-medium">{column}</th>)}</tr></thead>
                    <tbody>{csvPreview.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-[#333] text-text-secondary">{row.map((value, columnIndex) => <td key={columnIndex} className="px-3 py-2 max-w-48 truncate" title={maskedPreviewColumns[columnIndex] ? undefined : value}>{maskedPreviewColumns[columnIndex] ? 'Hidden' : value}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
              {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</p>}
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
                     progress?.status === 'error' ? (format === 'csv' ? 'No CSV rows were committed; check the error below.' : 'Import failed; check the error below.') :
                     `Rows staged: ${progress?.rowsProcessed.toLocaleString() || 0}`}
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
                onClick={format === 'csv' ? prepareCsvReview : startImport}
                disabled={loading || (format === 'csv' && !csvOptions.tableName)}
                className="px-6 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                {format === 'csv' ? 'Preview CSV' : 'Start Import'}
              </button>
            </>
          )}

          {step === 'review' && (
            <>
              <button onClick={() => { resetReview(); setStep('config'); }} disabled={loading}
                className="px-4 py-2 text-xs font-medium text-text-muted hover:text-white">Back</button>
              <button onClick={startImport} disabled={loading || !mappingValid}
                className="px-6 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-xs font-bold rounded-lg">
                Import {csvPreview?.total_rows.toLocaleString()} rows
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
                resetReview();
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
