import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { hasPendingSavedQueryWrites, useDatabaseStore, waitForSavedQueryWrites } from '../store/databaseStore';
import { useRecoveryStore, type RowDraftSummary } from '../store/recoveryStore';
import { captureWorkspace, restoreWorkspace, type RecoverySnapshot } from '../utils/workspaceRecovery';
import { hasPendingRowDraftWrites, waitForRowDraftWrites } from '../utils/rowDrafts';

let started = false;

async function startRecovery() {
  if (started) return;
  started = true;
  const recovery = useRecoveryStore.getState();

  window.addEventListener('sqlmate:row-draft-changed', (event) => {
    const { context, changeCount } = (event as CustomEvent<{ context: string; changeCount: number }>).detail;
    useRecoveryStore.getState().setDraftCount(context, changeCount);
  });

  try {
    const drafts = await invoke<RowDraftSummary[]>('list_row_draft_summaries');
    recovery.setDrafts(drafts);
  } catch (error) {
    recovery.setDraftError(`Saved row drafts could not be listed: ${String(error)}`);
  }

  let saved: RecoverySnapshot | null;
  try {
    saved = await invoke<RecoverySnapshot | null>('load_workspace');
  } catch (error) {
    recovery.setStatus('unavailable', `Encrypted workspace unavailable. Changes to tabs and SQL are session-only: ${String(error)}`);
    return;
  }

  if (saved && (saved.version !== 1 || !Array.isArray(saved.tabs))) {
    recovery.setStatus('unavailable', 'The encrypted workspace uses an unsupported format. It was left untouched; tabs and SQL are session-only.');
    return;
  }

  const current = useDatabaseStore.getState();
  if (saved) current.restoreWorkspace(restoreWorkspace(saved, current.savedConnections.map(connection => connection.id)));
  recovery.setStatus('ready');

  let lastSerialized = JSON.stringify(captureWorkspace(useDatabaseStore.getState()));
  let pending: RecoverySnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;
  let blocked = false;

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (writing) return writing;
    writing = (async () => {
      while (pending && !blocked) {
        const snapshot = pending;
        pending = null;
        try {
          await invoke('save_workspace', { workspace: snapshot });
        } catch (error) {
          blocked = true;
          recovery.setStatus('unavailable', `Encrypted workspace could not be saved. Tabs and SQL remain session-only: ${String(error)}`);
        }
      }
    })().finally(() => { writing = null; });
    return writing;
  };

  useDatabaseStore.subscribe(state => {
    if (blocked) return;
    const snapshot = captureWorkspace(state);
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    pending = snapshot;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 200);
  });

  await getCurrentWindow().onCloseRequested(async event => {
    if (!pending && !writing && !hasPendingRowDraftWrites() && !hasPendingSavedQueryWrites()) return;
    event.preventDefault();
    await flush();
    await waitForRowDraftWrites();
    await waitForSavedQueryWrites();
    await getCurrentWindow().destroy();
  });
}

export function useWorkspaceRecovery() {
  useEffect(() => { void startRecovery(); }, []);
}
