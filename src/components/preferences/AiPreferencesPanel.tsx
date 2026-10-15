import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, KeyRound, Loader2, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';

type Provider = 'gemini' | 'groq' | 'anthropic' | 'openai';
type ProviderStatus = { provider: Provider; source: 'keychain' | 'environment' | 'missing'; configured: boolean };
type AiSettings = { default_provider: Provider | null; models: Partial<Record<Provider, string>> };
type TestPreview = {
  token: string;
  expires_in_seconds: number;
  provider: Provider;
  model: string;
  destination: string;
  request_body: string;
  authentication: string;
};

const providers: { id: Provider; name: string; description: string }[] = [
  { id: 'gemini', name: 'Gemini', description: 'Google AI' },
  { id: 'groq', name: 'Groq', description: 'GroqCloud' },
  { id: 'anthropic', name: 'Claude', description: 'Anthropic' },
  { id: 'openai', name: 'OpenAI', description: 'OpenAI API' },
];

export const AiPreferencesPanel = () => {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AiSettings>({ default_provider: null, models: {} });
  const [provider, setProvider] = useState<Provider>('gemini');
  const [model, setModel] = useState('');
  const [keyEntry, setKeyEntry] = useState('');
  const [prepared, setPrepared] = useState<TestPreview | null>(null);
  const [verified, setVerified] = useState<{ provider: Provider; model: string } | null>(null);
  const [busy, setBusy] = useState<'key' | 'delete' | 'prepare' | 'send' | 'default' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      invoke<ProviderStatus[]>('list_ai_provider_status'),
      invoke<AiSettings>('get_ai_settings'),
    ]).then(([available, preferences]) => {
      if (!live) return;
      const selected = preferences.default_provider || available.find(item => item.configured)?.provider || 'gemini';
      setStatuses(available);
      setSettings(preferences);
      setProvider(selected);
      setModel(preferences.models[selected] || '');
    }).catch(problem => { if (live) setError(String(problem)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const status = statuses.find(item => item.provider === provider);
  const selectedName = providers.find(item => item.id === provider)?.name || provider;
  const isDefault = settings.default_provider === provider && !!model.trim() && settings.models[provider] === model.trim();
  const resetReview = () => { setPrepared(null); setVerified(null); setError(null); setNotice(null); };

  const selectProvider = (next: Provider) => {
    resetReview();
    setProvider(next);
    setModel(settings.models[next] || '');
    setKeyEntry('');
  };

  const saveKey = async () => {
    if (!keyEntry.trim() || busy || loading) return;
    resetReview();
    setBusy('key');
    try {
      await invoke('save_ai_provider_key', { provider, key: keyEntry.trim() });
      setKeyEntry('');
      setStatuses(await invoke<ProviderStatus[]>('list_ai_provider_status'));
      setNotice(`${selectedName} key saved in the OS keychain. Test it before making requests.`);
    } catch (problem) { setError(String(problem)); }
    finally { setBusy(null); }
  };

  const deleteKey = async () => {
    if (busy || status?.source !== 'keychain') return;
    resetReview();
    setBusy('delete');
    try {
      await invoke('delete_ai_provider_key', { provider });
      setStatuses(await invoke<ProviderStatus[]>('list_ai_provider_status'));
      setNotice(`${selectedName} key removed from the OS keychain. An external environment key may still be available.`);
    } catch (problem) { setError(String(problem)); }
    finally { setBusy(null); }
  };

  const prepareTest = async () => {
    if (busy || loading || !status?.configured) return;
    resetReview();
    setBusy('prepare');
    try {
      setPrepared(await invoke<TestPreview>('prepare_ai_provider_test', { provider, model: model.trim() || null }));
    } catch (problem) { setError(String(problem)); }
    finally { setBusy(null); }
  };

  const sendTest = async () => {
    if (busy || !prepared) return;
    const review = prepared;
    setPrepared(null);
    setBusy('send');
    setError(null);
    try {
      await invoke('send_ai_provider_test', { token: review.token });
      setVerified({ provider: review.provider, model: review.model });
      setNotice(`${selectedName} accepted the test request for ${review.model}. No database data was sent.`);
    } catch (problem) { setError(`${String(problem)} Prepare a fresh test before retrying.`); }
    finally { setBusy(null); }
  };

  const setDefault = async () => {
    if (busy || verified?.provider !== provider) return;
    setBusy('default');
    setError(null);
    try {
      const preferences = await invoke<AiSettings>('set_ai_default', { provider, model: verified.model });
      setSettings(preferences);
      setModel(preferences.models[provider] || '');
      setNotice(`${selectedName} is the default AI provider.`);
    } catch (problem) { setError(String(problem)); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
      <nav aria-label="AI providers" className="shrink-0 border-b border-border p-4 md:w-60 md:border-b-0 md:border-r">
        <div className="px-2 pb-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">Providers</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {providers.map(item => {
            const itemStatus = statuses.find(entry => entry.provider === item.id);
            return <button key={item.id} onClick={() => selectProvider(item.id)} disabled={!!busy} aria-pressed={provider === item.id} className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${provider === item.id ? 'border-accent/60 bg-accent/10' : 'border-border hover:bg-hover'}`}>
              <span className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-text-primary">{item.name}</span>{itemStatus?.configured && <Check size={13} className="text-accent" aria-label="Key configured" />}</span>
              <span className="mt-1 block text-[11px] text-text-muted">{item.description}</span>
            </button>;
          })}
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-5 md:p-7">
        <div className="mx-auto max-w-[650px] space-y-5 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex items-center gap-2 text-base font-semibold text-text-primary"><Sparkles size={17} className="text-accent" /> {selectedName}</div><p className="mt-1 text-text-muted">Use your own developer API key. Provider usage may be billed separately.</p></div>
            {isDefault && <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">Default provider</span>}
          </div>

          <section aria-label="Provider key" className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
            <div className="flex items-center gap-2 font-semibold text-text-primary"><KeyRound size={15} /> API key</div>
            <p className="text-text-muted">{loading ? 'Loading provider status...' : status?.source === 'keychain' ? 'Stored in the OS keychain. The key is never displayed again.' : status?.source === 'environment' ? 'Managed by the app environment. SqlMate cannot display or delete this key here.' : 'No key configured yet. Paste a developer API key below.'}</p>
            <label className="block space-y-1"><span className="text-text-muted">{status?.source === 'keychain' ? 'Replace saved key' : 'Save key to OS keychain'}</span>
              <input type="password" autoComplete="off" spellCheck={false} value={keyEntry} disabled={!!busy} onChange={event => setKeyEntry(event.target.value)} placeholder="Paste API key" className="w-full rounded-lg border border-border-strong bg-background px-3 py-2 text-text-primary outline-none focus:border-accent disabled:opacity-50" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={saveKey} disabled={loading || !keyEntry.trim() || !!busy} className="rounded-lg bg-accent px-3 py-2 font-semibold text-white disabled:opacity-40">Save key</button>
              {status?.source === 'keychain' && <button onClick={deleteKey} disabled={!!busy} className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-text-muted hover:text-red-300 disabled:opacity-40"><Trash2 size={13} /> Remove saved key</button>}
            </div>
          </section>

          <section aria-label="Provider model" className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
            <div className="font-semibold text-text-primary">Model &amp; connection test</div>
            <label className="block space-y-1"><span className="text-text-muted">Model ID</span><input value={model} disabled={!!busy} onChange={event => { resetReview(); setModel(event.target.value); }} placeholder="Use provider default" spellCheck={false} className="w-full rounded-lg border border-border-strong bg-background px-3 py-2 font-mono text-text-primary outline-none focus:border-accent disabled:opacity-50" /></label>
            <p className="text-text-muted">A test sends only a fixed, short prompt and your key to {selectedName}. It sends no schema, SQL, or rows. The provider may charge for this request.</p>
            <button onClick={prepareTest} disabled={loading || !status?.configured || !!busy} className="rounded-lg border border-accent/50 px-3 py-2 font-semibold text-accent hover:bg-accent/10 disabled:opacity-40">{busy === 'prepare' ? <><Loader2 size={13} className="mr-1 inline animate-spin" />Preparing...</> : 'Prepare test'}</button>
            {verified?.provider === provider && <div role="status" className="flex items-center gap-2 text-accent"><ShieldCheck size={15} /> Tested this session with {verified.model}</div>}
          </section>

          {prepared && <section aria-label="Provider test review" className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
            <div className="font-semibold text-text-primary">Review before sending</div>
            <p className="text-text-muted">Only the exact JSON below and an authentication header will be sent. Review expires in {Math.floor(prepared.expires_in_seconds / 60)} minutes.</p>
            <dl className="grid grid-cols-[72px_1fr] gap-1.5 break-all"><dt className="text-text-muted">Endpoint</dt><dd>{prepared.destination}</dd><dt className="text-text-muted">Model</dt><dd>{prepared.model}</dd><dt className="text-text-muted">Auth</dt><dd>{prepared.authentication}</dd></dl>
            <pre tabIndex={0} className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-[11px] select-text">{prepared.request_body}</pre>
            <button onClick={sendTest} disabled={!!busy} className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 font-semibold text-white disabled:opacity-40"><Send size={14} /> Send test to {selectedName}</button>
          </section>}

          {verified?.provider === provider && !isDefault && <button onClick={setDefault} disabled={!!busy} className="rounded-lg bg-accent px-3 py-2 font-semibold text-white disabled:opacity-40">Make {selectedName} default</button>}
          {error && <div role="alert" className="rounded-lg border border-red-800/60 bg-red-900/20 p-3 text-red-300 break-words">{error}</div>}
          {notice && <div role="status" className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-text-primary">{notice}</div>}
        </div>
      </div>
    </div>
  );
};
