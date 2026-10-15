import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronDown, Copy, KeyRound, Loader2, Send, Sparkles, X } from 'lucide-react';
import { canEditAssistantProposal, type AssistantEditorContext } from '../utils/assistantProposal';
import { useDatabaseStore } from '../store/databaseStore';
import type { SQLEditorHandle } from './SQLEditor';

type Provider = 'gemini' | 'groq' | 'anthropic' | 'openai';
type Action = 'generate' | 'explain' | 'fix';
type ProviderStatus = { provider: Provider; source: string; configured: boolean };
type AiSettings = { default_provider: Provider | null; models: Partial<Record<Provider, string>> };
type PreparedReview = {
  review: { token: string; expires_in_seconds: number; provider: Provider; model: string;
    action: Action; destination: string; request_body: string; authentication: string };
  database: string;
  schema_context: string;
  source_sql: string | null;
};
type Proposal = { action: Action; text: string };

const providerLabels: Record<Provider, string> = {
  gemini: 'Gemini', groq: 'Groq', anthropic: 'Claude', openai: 'OpenAI',
};
const providers: Provider[] = ['gemini', 'groq', 'anthropic', 'openai'];
const actions: { id: Action; label: string; hint: string }[] = [
  { id: 'generate', label: 'Generate', hint: 'Describe the SQL you need' },
  { id: 'explain', label: 'Explain', hint: 'Explain the statement under your cursor' },
  { id: 'fix', label: 'Fix', hint: 'Fix the last failed executed statement' },
];

interface Props {
  connectionId: string;
  connectionLabel: string;
  database: string;
  aiAllowed: boolean;
  editor: RefObject<SQLEditorHandle | null>;
  currentStatementSql: string | null;
  onNewQuery: (sql: string) => void;
  onClose: () => void;
}

export const AiAssistantPanel = ({ connectionId, connectionLabel, database, aiAllowed, editor, currentStatementSql, onNewQuery, onClose }: Props) => {
  const openAiPreferences = useDatabaseStore(state => state.openAiPreferences);
  const showPreferences = useDatabaseStore(state => state.showPreferences);
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState<Provider>('gemini');
  const [savedModels, setSavedModels] = useState<AiSettings['models']>({});
  const [model, setModel] = useState('');
  const [action, setAction] = useState<Action>('generate');
  const [instruction, setInstruction] = useState('');
  const [keyEntry, setKeyEntry] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [prepared, setPrepared] = useState<PreparedReview | null>(null);
  const [schemaOverride, setSchemaOverride] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalSourceSql, setProposalSourceSql] = useState<string | null>(null);
  const [preparedContext, setPreparedContext] = useState<AssistantEditorContext | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'send' | 'key' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sequence = useRef(0);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    instructionRef.current?.focus();
    return () => { sequence.current += 1; };
  }, []);

  useEffect(() => {
    if (showPreferences) return;
    let live = true;
    Promise.all([
      invoke<ProviderStatus[]>('list_ai_provider_status'),
      invoke<AiSettings>('get_ai_settings'),
    ]).then(([available, settings]) => {
      if (!live) return;
      setStatuses(available);
      setSavedModels(settings.models);
      const selected = settings.default_provider || available.find(item => item.configured)?.provider || 'gemini';
      setProvider(selected);
      setModel(settings.models[selected] || '');
    }).catch(problem => { if (live) setError(String(problem)); });
    return () => { live = false; };
  }, [showPreferences]);

  const invalidate = () => {
    sequence.current += 1;
    setPrepared(null);
    setProposal(null);
    setProposalSourceSql(null);
    setPreparedContext(null);
    setSchemaOverride(null);
    setBusy(null);
    setError(null);
    setNotice(null);
  };

  useEffect(() => {
    invalidate();
  }, [connectionId, database, aiAllowed]);

  const status = statuses.find(item => item.provider === provider);
  const currentContext = (): AssistantEditorContext => ({
    connectionId, database, version: editor.current?.getVersionId() ?? null,
  });
  const editable = preparedContext && canEditAssistantProposal(preparedContext, currentContext());
  const applyable = editable && !!proposalSourceSql && currentStatementSql === proposalSourceSql;

  const prepare = async (editedSchema: string | null = null) => {
    if (!aiAllowed || busy) return;
    const requestId = ++sequence.current;
    const context = currentContext();
    if (context.version === null) {
      setError('The SQL editor is still loading. Wait a moment and try again.');
      return;
    }
    const activeSql = action === 'explain' ? editor.current?.resolveExecution('current').target?.sql : null;
    if (action === 'explain' && !activeSql) {
      setError('Place the cursor in the statement you want to explain.');
      return;
    }
    setBusy('prepare');
    setError(null);
    setNotice(null);
    setPrepared(null);
    setProposal(null);
    try {
      const result = await invoke<PreparedReview>('prepare_ai_request', {
        connectionId, expectedDatabase: database, provider, model: model.trim() || null,
        action, instruction: instruction.trim(), activeSql: activeSql || null,
        schemaOverride: editedSchema,
      });
      if (requestId !== sequence.current) return;
      setPrepared(result);
      setSchemaOverride(result.schema_context);
      setPreparedContext(context);
    } catch (problem) {
      if (requestId === sequence.current) setError(String(problem));
    } finally {
      if (requestId === sequence.current) setBusy(null);
    }
  };

  const send = async () => {
    if (!prepared || busy) return;
    if (!preparedContext || !canEditAssistantProposal(preparedContext, currentContext())) {
      setPrepared(null);
      setError('The editor or target changed since review. Prepare the request again.');
      return;
    }
    const requestId = ++sequence.current;
    setBusy('send');
    setError(null);
    try {
      const answer = await invoke<Proposal>('send_ai_request', { token: prepared.review.token });
      if (requestId !== sequence.current) return;
      setProposal(answer);
      setProposalSourceSql(prepared.source_sql);
      setPrepared(null);
      setNotice('Provider response received. SQL is not run automatically.');
    } catch (problem) {
      if (requestId === sequence.current) {
        setPrepared(null);
        setError(`${String(problem)} Prepare a fresh review before retrying.`);
      }
    } finally {
      if (requestId === sequence.current) setBusy(null);
    }
  };

  const saveKey = async () => {
    if (!keyEntry.trim() || busy) return;
    setBusy('key');
    setError(null);
    try {
      await invoke('save_ai_provider_key', { provider, key: keyEntry.trim() });
      setKeyEntry('');
      setStatuses(await invoke<ProviderStatus[]>('list_ai_provider_status'));
      setShowSetup(false);
      setNotice(`${providerLabels[provider]} key saved in the OS keychain.`);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!proposal) return;
    try {
      await navigator.clipboard.writeText(proposal.text);
      setNotice('Copied to clipboard.');
    } catch {
      setError('Clipboard access failed. Select and copy the proposal text instead.');
    }
  };

  const insert = () => {
    if (!proposal || !editable) return;
    if (editor.current?.appendGeneratedSql(proposal.text)) setNotice('Inserted below existing SQL. Nothing was run.');
    else setError('Could not insert into this editor. Use Copy or New query tab.');
  };

  const apply = () => {
    if (!proposal || !editable || !preparedContext || !proposalSourceSql) return;
    if (editor.current?.replaceCurrentStatement(proposal.text, preparedContext.version!, proposalSourceSql))
      setNotice('Replaced the reviewed statement. Nothing was run.');
    else setError('The statement changed. Use Copy or New query tab instead.');
  };

  return (
    <aside aria-label="AI assistant" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} className="w-full h-full border-l border-border bg-surface flex flex-col text-text-primary shadow-[-14px_0_30px_rgba(0,0,0,0.14)] overflow-hidden">
      <div className="h-11 shrink-0 px-4 flex items-center justify-between border-b border-border bg-[#292929]">
        <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-accent" /> AI Assistant</div>
        <button onClick={onClose} aria-label="Close AI assistant" className="p-1 rounded hover:bg-white/10"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs">
        {!aiAllowed && <div role="alert" className="p-3 rounded border border-amber-700/50 bg-amber-900/15 text-amber-200">AI is off for this connection. Enable "Allow AI assistance" in its connection settings before preparing a request.</div>}
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-text-muted">Provider</span>
            <span className="relative block">
              <select aria-label="AI provider" disabled={!!busy} value={provider} onChange={event => { const next = event.target.value as Provider; invalidate(); setProvider(next); setModel(savedModels[next] || ''); setKeyEntry(''); }} className="h-10 w-full appearance-none rounded border border-border bg-[#1e1e1e] px-3 pr-8 text-text-primary focus:outline-none focus:border-accent disabled:opacity-50">
                {providers.map(item => <option key={item} value={item}>{providerLabels[item]}</option>)}
              </select>
              <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
            </span>
          </label>
          <label className="space-y-1"><span className="text-text-muted">Model ID</span>
            <input aria-label="AI model ID" disabled={!!busy} value={model} onChange={event => { invalidate(); setModel(event.target.value); }} placeholder="Provider default" className="h-10 w-full rounded border border-border bg-[#1e1e1e] px-3 text-text-primary focus:outline-none focus:border-accent disabled:opacity-50" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 text-text-muted">
          <span>{status?.configured ? `Key: ${status.source === 'environment' ? 'external environment' : 'OS keychain'}` : 'No key configured'}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => { invalidate(); setKeyEntry(''); setShowSetup(false); openAiPreferences(); }} disabled={!!busy} className="text-accent hover:underline disabled:opacity-40">AI settings</button>
            <button onClick={() => { if (showSetup) setKeyEntry(''); setShowSetup(!showSetup); }} className="flex items-center gap-1 text-accent hover:underline"><KeyRound size={13} /> {showSetup ? 'Close setup' : 'Quick key'}</button>
          </div>
        </div>
        {showSetup && <div className="rounded border border-border bg-[#202020] p-3 space-y-2">
          <p className="text-text-muted">Use a {providerLabels[provider]} developer API key. API usage may be billed separately from consumer subscriptions.</p>
          <label className="block"><span className="sr-only">API key for {providerLabels[provider]}</span>
            <input type="password" autoComplete="off" value={keyEntry} onChange={event => setKeyEntry(event.target.value)} placeholder="Paste API key" className="w-full rounded border border-border bg-[#171717] p-2 text-text-primary" />
          </label>
          <button onClick={saveKey} disabled={!keyEntry.trim() || !!busy} className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50">Save to keychain</button>
        </div>}
        <div className="grid grid-cols-3 rounded border border-border bg-[#202020] p-1 gap-1" role="group" aria-label="Assistant action">
          {actions.map(item => <button key={item.id} disabled={!!busy} onClick={() => { invalidate(); setAction(item.id); }} aria-pressed={action === item.id} title={item.hint} className={`rounded px-2 py-1.5 disabled:opacity-50 ${action === item.id ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}>{item.label}</button>)}
        </div>
        <label className="block space-y-1"><span className="text-text-muted">{action === 'generate' ? 'What should the SQL do?' : 'Optional guidance'}</span>
          <textarea ref={instructionRef} disabled={!!busy} value={instruction} onChange={event => { invalidate(); setInstruction(event.target.value); }} rows={3} placeholder={action === 'generate' ? 'Show the five most recently created admins' : 'Focus on correctness and safety'} className="w-full resize-y rounded border border-border bg-[#1e1e1e] p-2 text-sm text-text-primary focus:outline-none focus:border-accent disabled:opacity-50" />
        </label>
        <button onClick={() => prepare()} disabled={!aiAllowed || !status?.configured || !!busy || (action === 'generate' && !instruction.trim())} className="w-full rounded bg-[#3d3d3d] px-3 py-2 font-semibold hover:bg-[#4a4a4a] disabled:opacity-50">
          {busy === 'prepare' ? <><Loader2 size={13} className="inline animate-spin mr-1" />Preparing...</> : 'Prepare review'}
        </button>
        {error && <div role="alert" className="rounded border border-red-800/60 bg-red-900/20 p-3 text-red-300 break-words">{error}</div>}
        {notice && <div role="status" className="rounded border border-accent/30 bg-accent/10 p-3 text-text-primary">{notice}</div>}
        {prepared && <section aria-label="Outbound request review" className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2 font-semibold text-accent"><Check size={14} /> Review before sending</div>
          <p className="text-text-muted">The JSON body below and an authentication header go to {providerLabels[prepared.review.provider]}. SqlMate does not add result rows or stored credentials to the body. Schema names, SQL literals, and anything you typed may be sensitive. Review expires after {Math.floor(prepared.review.expires_in_seconds / 60)} minutes.</p>
          <dl className="grid grid-cols-[72px_1fr] gap-1.5 break-all"><dt className="text-text-muted">Connection</dt><dd>{connectionLabel}</dd><dt className="text-text-muted">Database</dt><dd>{prepared.database}</dd><dt className="text-text-muted">Endpoint</dt><dd>{prepared.review.destination}</dd><dt className="text-text-muted">Model</dt><dd>{prepared.review.model}</dd><dt className="text-text-muted">Auth</dt><dd>{prepared.review.authentication}</dd></dl>
          <label className="block space-y-1"><span className="text-text-muted">Schema context (edit to remove details, then prepare again)</span>
            <textarea disabled={!!busy} value={schemaOverride ?? ''} onChange={event => { setSchemaOverride(event.target.value); setPrepared(null); }} rows={5} className="w-full resize-y rounded border border-border bg-[#1e1e1e] p-2 font-mono text-[11px] text-text-primary disabled:opacity-50" />
          </label>
          <div><div className="mb-1 text-text-muted">Exact outbound JSON body</div><pre tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-[#161616] p-3 font-mono text-[11px] select-text">{prepared.review.request_body}</pre></div>
          <button onClick={send} disabled={!!busy} className="flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 font-semibold text-white hover:brightness-110 disabled:opacity-50"><Send size={14} />{busy === 'send' ? 'Sending...' : `Send to ${providerLabels[prepared.review.provider]}`}</button>
        </section>}
        {!prepared && schemaOverride !== null && !proposal && <button onClick={() => prepare(schemaOverride)} disabled={!!busy} className="w-full rounded border border-accent/50 p-2 text-accent disabled:opacity-50">Prepare with edited schema</button>}
        {proposal && <section aria-label="AI proposal" className="space-y-3 border-t border-border pt-4">
          <div className="font-semibold text-accent">Proposal, not executed</div>
          <pre tabIndex={0} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-[#161616] p-3 font-mono text-[11px] select-text">{proposal.text}</pre>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className="flex items-center gap-1 rounded border border-border px-2 py-1.5 hover:bg-white/5"><Copy size={13} /> Copy</button>
            {proposal.action !== 'explain' && <>
              <button onClick={insert} disabled={!editable} title={!editable ? 'Editor changed since review' : 'Insert after existing SQL'} className="rounded border border-border px-2 py-1.5 hover:bg-white/5 disabled:opacity-40">Insert</button>
              <button onClick={apply} disabled={!applyable} title="Replace the same failed statement under the cursor" className="rounded border border-border px-2 py-1.5 hover:bg-white/5 disabled:opacity-40">Apply</button>
              <button onClick={() => onNewQuery(proposal.text)} className="rounded border border-border px-2 py-1.5 hover:bg-white/5">New query tab</button>
            </>}
          </div>
          {!editable && proposal.action !== 'explain' && <p className="text-amber-300">The editor or target changed. Copy or open a new query tab instead.</p>}
        </section>}
      </div>
    </aside>
  );
};
