import { useDatabaseStore } from '../../store/databaseStore';
import { APPEARANCE_SCOPE_LABELS, type AppearanceScope } from '../../utils/appearance';
import { cn } from '../../utils/cn';

const SCOPES = Object.keys(APPEARANCE_SCOPE_LABELS) as AppearanceScope[];

export const AppearanceScopeTabs = () => {
  const activeScope = useDatabaseStore((state) => state.appearancePreferencesScope);
  const setActiveScope = useDatabaseStore((state) => state.setAppearancePreferencesScope);

  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-1">
      {SCOPES.map((scope) => (
        <button
          key={scope}
          onClick={() => setActiveScope(scope)}
          className={cn(
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            activeScope === scope
              ? 'bg-background text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          {APPEARANCE_SCOPE_LABELS[scope]}
        </button>
      ))}
    </div>
  );
};
