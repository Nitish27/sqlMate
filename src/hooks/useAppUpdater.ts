import { useCallback, useEffect, useState } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

type CheckOptions = {
  silent?: boolean;
};

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'error';

const isTauriRuntime = () => '__TAURI_INTERNALS__' in window;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const useAppUpdater = () => {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<AppUpdateStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showStatus, setShowStatus] = useState(false);

  const checkForUpdates = useCallback(async ({ silent = false }: CheckOptions = {}) => {
    if (!isTauriRuntime()) {
      if (!silent) {
        setStatus('up-to-date');
        setShowStatus(true);
      }
      return;
    }

    setStatus('checking');
    setError(null);
    setShowStatus(!silent);

    try {
      const nextUpdate = await check();

      if (nextUpdate) {
        setUpdate(nextUpdate);
        setStatus('available');
        setShowStatus(true);
      } else {
        setUpdate(null);
        setStatus('up-to-date');
        setShowStatus(!silent);
      }
    } catch (checkError) {
      console.error('Failed to check for SqlMate updates:', checkError);
      setStatus('error');
      setError(getErrorMessage(checkError));
      setShowStatus(!silent);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!update) {
      return;
    }

    setStatus('downloading');
    setProgress(0);
    setError(null);

    let downloadedBytes = 0;
    let contentLength: number | undefined;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength;
          return;
        }

        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (contentLength) {
            setProgress(Math.min(100, Math.round((downloadedBytes / contentLength) * 100)));
          }
        }
      });

      await relaunch();
    } catch (installError) {
      console.error('Failed to install the SqlMate update:', installError);
      setStatus('error');
      setError(getErrorMessage(installError));
      setShowStatus(true);
    }
  }, [update]);

  const dismiss = useCallback(() => {
    void update?.close().catch((closeError) => {
      console.error('Failed to close the SqlMate update resource:', closeError);
    });
    setUpdate(null);
    setError(null);
    setStatus('idle');
    setShowStatus(false);
  }, [update]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForUpdates({ silent: true });
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  return {
    update,
    status,
    progress,
    error,
    showStatus,
    checkForUpdates,
    installUpdate,
    dismiss,
  };
};
