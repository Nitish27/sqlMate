import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { parseParameterValue, type ParameterInputType, type QueryParameter } from '../utils/queryParameters';

interface Props {
  sql: string;
  names: string[];
  connectionLabel: string;
  onCancel: () => void;
  onRun: (parameters: QueryParameter[]) => void;
}

export function QueryParametersDialog({ sql, names, connectionLabel, onCancel, onRun }: Props) {
  const [entries, setEntries] = useState<Record<string, { text: string; type: ParameterInputType }>>({});
  const [error, setError] = useState<string | null>(null);

  const update = (name: string, patch: Partial<{ text: string; type: ParameterInputType }>) => {
    setEntries(current => ({ ...current, [name]: { text: current[name]?.text ?? '', type: current[name]?.type ?? 'auto', ...patch } }));
    setError(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const parameters = names.map(name => {
        if (!entries[name]) throw new Error(`Enter a value for :${name}, or choose NULL`);
        return { name, value: parseParameterValue(entries[name].text, entries[name].type) };
      });
      onRun(parameters);
    } catch (cause) {
      setError(String(cause));
    }
  };

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[min(520px,calc(100vw-32px))] max-h-[min(80vh,720px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-[#292929] p-5 shadow-2xl text-text-primary">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">Run with parameters</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-secondary">Values are bound to this SELECT, never inserted into its SQL. Target: {connectionLabel}.</Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 text-text-muted hover:bg-white/10 hover:text-text-primary" aria-label="Cancel"><X size={16} /></Dialog.Close>
          </div>
          <pre className="mt-4 max-h-24 overflow-auto rounded border border-border bg-[#1e1e1e] p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap break-all">{sql}</pre>
          <form onSubmit={submit} className="mt-5 space-y-3">
            {names.map((name, index) => (
              <div key={name} className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                <label className="min-w-0 text-xs font-medium text-text-secondary">
                  <span className="block mb-1 font-mono text-accent">:{name}</span>
                  <input autoFocus={index === 0} value={entries[name]?.text ?? ''} onChange={event => update(name, { text: event.target.value })} disabled={entries[name]?.type === 'null'} autoComplete="off" spellCheck={false} className="w-full h-9 rounded border border-border bg-[#1e1e1e] px-3 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-50" />
                </label>
                <label className="text-xs font-medium text-text-secondary">
                  <span className="block mb-1">Type</span>
                  <select value={entries[name]?.type ?? 'auto'} onChange={event => update(name, { type: event.target.value as ParameterInputType })} className="w-full h-9 rounded border border-border bg-[#1e1e1e] px-2 text-sm text-text-primary focus:border-accent focus:outline-none">
                    <option value="auto">Auto</option><option value="text">Text</option><option value="integer">Integer</option><option value="float">Float (approx.)</option><option value="boolean">Boolean</option><option value="null">NULL</option>
                  </select>
                </label>
              </div>
            ))}
            <p className="text-xs text-text-muted">Auto recognizes integers and true/false; other input stays text. For exact decimals, cast Text in SQL. Values are not saved with query history.</p>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onCancel} className="rounded px-3 py-2 text-xs text-text-secondary hover:bg-white/10">Cancel</button>
              <button type="submit" className="rounded bg-accent px-4 py-2 text-xs font-semibold text-white hover:brightness-110">Run SELECT</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
