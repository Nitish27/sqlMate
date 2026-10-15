import { useEffect } from 'react';
import { SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useDatabaseStore } from '../../store/databaseStore';
import { AppearanceThemeList } from './AppearanceThemeList';
import { AppearanceScopeTabs } from './AppearanceScopeTabs';
import { AppearancePreferencesPanel } from './AppearancePreferencesPanel';
import { AiPreferencesPanel } from './AiPreferencesPanel';

export const PreferencesDialog = () => {
  const isOpen = useDatabaseStore((state) => state.showPreferences);
  const section = useDatabaseStore((state) => state.preferencesSection);
  const setSection = useDatabaseStore((state) => state.setPreferencesSection);
  const close = useDatabaseStore((state) => state.closePreferences);

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
      <div role="dialog" aria-modal="true" aria-label="Preferences" className="flex h-[min(720px,calc(100vh-48px))] w-[min(1080px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              {section === 'ai' ? <Sparkles size={18} /> : <SlidersHorizontal size={18} />}
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">Preferences</div>
              <div className="text-xs text-text-muted">{section === 'ai' ? 'Connect your own AI provider, then test it before use.' : 'Tune the appearance of SqlMate across editor, tables, and sidebars.'}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={close}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              title="Close preferences"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border px-6 py-2" aria-label="Preference sections">
          <button aria-pressed={section === 'appearance'} onClick={() => setSection('appearance')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${section === 'appearance' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-hover hover:text-text-primary'}`}>Appearance</button>
          <button aria-pressed={section === 'ai'} onClick={() => setSection('ai')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${section === 'ai' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-hover hover:text-text-primary'}`}>AI</button>
          {section === 'appearance' && <div className="ml-auto"><AppearanceScopeTabs /></div>}
        </div>

        {section === 'appearance' ? <div className="flex min-h-0 flex-1"><AppearanceThemeList /><AppearancePreferencesPanel /></div> : <AiPreferencesPanel />}
      </div>
    </div>
  );
};
