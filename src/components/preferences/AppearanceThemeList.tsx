import { Monitor, Moon, Sun } from 'lucide-react';
import { useDatabaseStore } from '../../store/databaseStore';
import { cn } from '../../utils/cn';
import { type ThemePreference } from '../../utils/theme';

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  Icon: typeof Monitor;
}> = [
  {
    value: 'system',
    label: 'System',
    description: 'Follow your macOS appearance',
    Icon: Monitor,
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Brighter workspace',
    Icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Dark interface',
    Icon: Moon,
  },
];

export const AppearanceThemeList = () => {
  const themePreference = useDatabaseStore((state) => state.themePreference);
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const setThemePreference = useDatabaseStore((state) => state.setThemePreference);

  return (
    <div className="w-[240px] border-r border-border bg-sidebar/70 p-4">
      <div className="mb-3 text-xs font-semibold text-text-primary">Themes</div>
      <div className="space-y-2">
        {THEME_OPTIONS.map(({ value, label, description, Icon }) => {
          const isActive = themePreference === value;
          const showResolvedTheme = value === 'system';

          return (
            <button
              key={value}
              onClick={() => setThemePreference(value)}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-colors',
                isActive
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border bg-surface text-text-secondary hover:border-accent/30 hover:bg-hover'
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg border',
                  isActive ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border bg-background text-text-muted'
                )}>
                  <Icon size={16} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-text-primary">{label}</div>
                  <div className="mt-1 text-xs text-text-muted">
                    {description}
                    {showResolvedTheme && (
                      <span className="block text-[11px] text-text-muted/80">
                        Current: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
