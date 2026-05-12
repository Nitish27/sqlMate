import { Palette, SunMoon } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { cn } from '../utils/cn';
import { type AppearanceScope } from '../utils/appearance';

interface ThemeSettingsProps {
  align?: 'left' | 'right';
  displayMode?: 'toolbar' | 'sidebar';
  defaultScope?: AppearanceScope;
}

export const ThemeSettings = ({
  displayMode = 'toolbar',
  defaultScope = 'sqlEditor',
}: ThemeSettingsProps) => {
  const themePreference = useDatabaseStore((state) => state.themePreference);
  const openAppearancePreferences = useDatabaseStore((state) => state.openAppearancePreferences);

  const summary = themePreference === 'system'
    ? 'System'
    : themePreference[0].toUpperCase() + themePreference.slice(1);

  return (
    <button
      onClick={() => openAppearancePreferences(defaultScope)}
      className={cn(
        'transition-colors',
        displayMode === 'toolbar'
          ? 'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-text-muted hover:bg-hover hover:text-text-primary'
          : 'w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-text-secondary hover:bg-hover'
      )}
      title="Open appearance settings"
    >
      <span className="flex items-center gap-1.5">
        {displayMode === 'toolbar' ? <SunMoon size={14} /> : <Palette size={14} className="text-accent" />}
        {displayMode === 'sidebar' && (
          <span className="text-sm font-medium text-text-primary">Appearance</span>
        )}
      </span>
      {displayMode === 'sidebar' && (
        <span className="text-xs text-text-muted">{summary}</span>
      )}
    </button>
  );
};
