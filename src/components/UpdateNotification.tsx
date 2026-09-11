import { AlertCircle, CheckCircle2, Download, Loader2, X } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';
import type { AppUpdateStatus } from '../hooks/useAppUpdater';

interface UpdateNotificationProps {
  update: Update | null;
  status: AppUpdateStatus;
  progress: number;
  error: string | null;
  showStatus: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

export const UpdateNotification = ({
  update,
  status,
  progress,
  error,
  showStatus,
  onInstall,
  onDismiss,
}: UpdateNotificationProps) => {
  const isChecking = status === 'checking';
  const isDownloading = status === 'downloading';
  const isUpToDate = status === 'up-to-date';
  const hasError = status === 'error' && Boolean(error);

  if (!showStatus && !update && !isChecking && !isDownloading && !hasError) {
    return null;
  }

  return (
    <div className="fixed bottom-5 right-5 z-[200] w-[min(380px,calc(100vw-40px))] rounded-xl border border-border-strong bg-surface p-4 shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-accent/10 p-2 text-accent">
          {hasError ? <AlertCircle size={16} /> : isUpToDate ? <CheckCircle2 size={16} /> : <Download size={16} />}
        </div>

        <div className="min-w-0 flex-1">
          {hasError ? (
            <>
              <div className="text-sm font-medium text-text-primary">Could not install the update</div>
              <div className="mt-1 break-words text-xs text-text-muted">{error}</div>
            </>
          ) : isChecking ? (
            <div className="text-sm font-medium text-text-primary">Checking for updates...</div>
          ) : isDownloading ? (
            <div className="text-sm font-medium text-text-primary">Downloading SqlMate update...</div>
          ) : isUpToDate ? (
            <div className="text-sm font-medium text-text-primary">SqlMate is up to date.</div>
          ) : update ? (
            <>
              <div className="text-sm font-semibold text-text-primary">SqlMate {update.version} is available</div>
              <div className="mt-1 text-xs text-text-muted">Update from {update.currentVersion} with the latest fixes and improvements.</div>
              {update.body && (
                <div className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-xs text-text-secondary">
                  {update.body}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-text-primary">Could not check for updates</div>
              <div className="mt-1 break-words text-xs text-text-muted">{error}</div>
            </>
          )}

          {isDownloading && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1 text-right text-[10px] text-text-muted">{progress}%</div>
            </div>
          )}

          {update && !isDownloading && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={onDismiss}
                className="rounded-lg px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              >
                Later
              </button>
              <button
                onClick={onInstall}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90"
              >
                <Download size={13} />
                {hasError ? 'Retry' : 'Download and Install'}
              </button>
            </div>
          )}
        </div>

        {!isDownloading && (
          <button
            onClick={onDismiss}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        )}

        {isChecking && <Loader2 size={15} className="mt-1 shrink-0 animate-spin text-text-muted" />}
      </div>
    </div>
  );
};
