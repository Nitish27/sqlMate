import { useState } from 'react';
import { X, Download, FileJson, FileText, Database } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { hasSensitiveColumns } from '../utils/sensitiveData';

interface ExportModalProps {
  tableName: string;
  columns: string[];
  connectionId: string;
  filters: any[];
  sortConfig?: any;
  onClose: () => void;
}

export const ExportModal = ({ tableName, columns, connectionId, filters, sortConfig, onClose }: ExportModalProps) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'sql'>('csv');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if ((columns.length === 0 || hasSensitiveColumns(columns))
      && !window.confirm('This export will include raw values from columns that may contain secrets. Continue?')) return;
    try {
      setIsExporting(true);
      setError(null);

      // 1. Get save path from user
      const defaultPath = `${tableName}.${format}`;
      const filePath = await save({
        defaultPath,
        filters: [
          {
            name: format.toUpperCase(),
            extensions: [format]
          }
        ]
      });

      if (!filePath) {
        setIsExporting(false);
        return;
      }

      // 2. Call backend to export
      const result = await invoke<number>('export_table_data', {
        connectionId,
        tableName,
        filters,
        sortColumn: sortConfig?.column,
        sortDirection: sortConfig?.direction,
        format,
        filePath
      });

      console.log(`Successfully exported ${result} rows to ${filePath}`);
      onClose();
    } catch (err: any) {
      console.error("[ERROR] Export failed:", err);
      setError(err.toString());
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-[#2C2C2C] border border-[#3C3C3C] rounded-lg shadow-2xl w-[400px] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#3C3C3C] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-accent" />
            <span className="text-[13px] font-bold text-white">Export Table: {tableName}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {(columns.length === 0 || hasSensitiveColumns(columns)) && (
            <p role="note" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded p-3">
              This table may contain secrets. Exported files contain raw values, not masked grid values.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Format</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setFormat('csv')}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-md border transition-all ${
                  format === 'csv' 
                    ? 'bg-accent/10 border-accent text-white' 
                    : 'bg-[#333333] border-transparent text-gray-400 hover:border-[#444444]'
                }`}
              >
                <FileText size={20} />
                <span className="text-[11px] font-medium">CSV</span>
              </button>
              <button
                onClick={() => setFormat('json')}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-md border transition-all ${
                  format === 'json' 
                    ? 'bg-accent/10 border-accent text-white' 
                    : 'bg-[#333333] border-transparent text-gray-400 hover:border-[#444444]'
                }`}
              >
                <FileJson size={20} />
                <span className="text-[11px] font-medium">JSON</span>
              </button>
              <button
                onClick={() => setFormat('sql')}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-md border transition-all ${
                  format === 'sql' 
                    ? 'bg-accent/10 border-accent text-white' 
                    : 'bg-[#333333] border-transparent text-gray-400 hover:border-[#444444]'
                }`}
              >
                <Database size={20} />
                <span className="text-[11px] font-medium">SQL</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-[11px] bg-red-500/10 p-2 rounded border border-red-500/20">
              Error: {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 bg-[#252526] border-t border-[#3C3C3C] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] font-medium text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-6 py-1.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded text-[12px] font-bold transition-all shadow-lg flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download size={14} />
                <span>Export</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
