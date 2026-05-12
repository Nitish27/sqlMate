import { useEffect } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useDatabaseStore } from '../../store/databaseStore';
import { AppearanceThemeList } from './AppearanceThemeList';
import { AppearanceScopeTabs } from './AppearanceScopeTabs';
import { AppearancePreferencesPanel } from './AppearancePreferencesPanel';

export const PreferencesDialog = () => {
  const isOpen = useDatabaseStore((state) => state.showAppearancePreferences);
  const close = useDatabaseStore((state) => state.closeAppearancePreferences);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div className="flex h-[min(720px,calc(100vh-48px))] w-[min(1080px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">Fonts &amp; Colors</div>
              <div className="text-xs text-text-muted">Tune the appearance of SqlMate across editor, tables, and sidebars.</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AppearanceScopeTabs />
            <button
              onClick={close}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              title="Close preferences"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <AppearanceThemeList />
          <AppearancePreferencesPanel />
        </div>
      </div>
    </div>
  );
};
