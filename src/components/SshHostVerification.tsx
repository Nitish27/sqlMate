import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ShieldCheck } from 'lucide-react';

interface SshHostVerificationProps {
  host: string;
  port: number;
  savedFingerprint: string;
  disabled: boolean;
  onVerify: (fingerprint: string) => void;
}

export function SshHostVerification({ host, port, savedFingerprint, disabled, onVerify }: SshHostVerificationProps) {
  const [observed, setObserved] = useState('');
  const [expected, setExpected] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const changed = Boolean(savedFingerprint && observed && observed !== savedFingerprint);
  const needsReview = Boolean(observed && observed !== savedFingerprint);
  const canCheck = Boolean(host.trim() && Number.isInteger(port) && port > 0 && port <= 65535);

  const checkFingerprint = async () => {
    setChecking(true);
    setObserved('');
    setExpected('');
    setError('');
    try {
      setObserved(await invoke<string>('inspect_ssh_host_key', { host, port }));
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section aria-label="SSH host verification" className="space-y-2 rounded border border-[#333] bg-[#252525] p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-gray-200">
          <ShieldCheck size={13} aria-hidden="true" /> SSH host verification
        </span>
        <button
          type="button"
          disabled={disabled || checking || !canCheck}
          onClick={() => void checkFingerprint()}
          className="rounded border border-[#444] px-2.5 py-1 text-gray-200 hover:bg-[#333] disabled:opacity-50"
        >
          {checking ? 'Checking...' : 'Check fingerprint'}
        </button>
      </div>
      <div aria-live="polite" className="space-y-1 text-gray-400">
        {savedFingerprint
          ? <p>Trusted fingerprint: <code className="break-all text-gray-200">{savedFingerprint}</code></p>
          : <p>Verify this server before SqlMate sends SSH credentials.</p>}
        {observed && <p>Server fingerprint: <code className="break-all text-gray-200">{observed}</code></p>}
        {changed && <p className="text-red-400">The host key changed. Connections are blocked until you verify the new key.</p>}
        {observed && !needsReview && <p className="text-emerald-400">The server key matches the trusted fingerprint.</p>}
        {error && <p className="text-red-400">{error}</p>}
      </div>
      {needsReview && (
        <div className="space-y-2">
          <label htmlFor="ssh-expected-fingerprint" className="block text-gray-300">
            Enter the SHA256 fingerprint from your server administrator or another trusted source. Do not copy the value shown by the server above.
          </label>
          <input
            id="ssh-expected-fingerprint"
            className="w-full rounded border border-[#444] bg-[#1a1a1a] px-2 py-1.5 font-mono text-white"
            placeholder="SHA256:..."
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
          {expected.trim() && expected.trim() !== observed && <p className="text-gray-400">The fingerprints do not match.</p>}
          <button
            type="button"
            disabled={disabled || expected.trim() !== observed}
            onClick={() => { onVerify(observed); setExpected(''); }}
            className="rounded border border-[#444] px-2.5 py-1 text-gray-200 hover:bg-[#333] disabled:opacity-50"
          >
            {changed ? 'Replace trusted fingerprint' : 'Trust matching fingerprint'}
          </button>
          <p className="text-gray-400">The fingerprint is saved with the connection after a successful connection.</p>
        </div>
      )}
    </section>
  );
}
