import { RotateCcw } from 'lucide-react';
import { useDatabaseStore } from '../../store/databaseStore';
import { APPEARANCE_SCOPE_LABELS, FONT_FAMILY_OPTIONS } from '../../utils/appearance';
import { SqlEditorPreview } from './previews/SqlEditorPreview';
import { DataTablePreview } from './previews/DataTablePreview';
import { SidebarPreview } from './previews/SidebarPreview';

const getNumericValue = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => {
  return <div className="text-xs font-semibold text-text-primary">{children}</div>;
};

const InputLabel = ({ children }: { children: React.ReactNode }) => {
  return <label className="text-xs font-medium text-text-secondary">{children}</label>;
};

const FieldShell = ({ children }: { children: React.ReactNode }) => {
  return <div className="space-y-2">{children}</div>;
};

export const AppearancePreferencesPanel = () => {
  const activeScope = useDatabaseStore((state) => state.appearancePreferencesScope);
  const appearanceSettings = useDatabaseStore((state) => state.appearanceSettings);
  const resetAppearanceScope = useDatabaseStore((state) => state.resetAppearanceScope);
  const updateSqlEditorAppearance = useDatabaseStore((state) => state.updateSqlEditorAppearance);
  const updateDataTableAppearance = useDatabaseStore((state) => state.updateDataTableAppearance);
  const updateSidebarAppearance = useDatabaseStore((state) => state.updateSidebarAppearance);

  let preview: React.ReactNode = null;
  let controls: React.ReactNode = null;

  if (activeScope === 'sqlEditor') {
    const sqlEditor = appearanceSettings.sqlEditor;
    preview = <SqlEditorPreview />;
    controls = (
      <div className="grid grid-cols-2 gap-4">
        <FieldShell>
          <InputLabel>Font</InputLabel>
          <select
            value={sqlEditor.fontFamily}
            onChange={(event) => updateSqlEditorAppearance({ fontFamily: event.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell>
          <InputLabel>Font Size</InputLabel>
          <input
            type="number"
            min={11}
            max={20}
            value={sqlEditor.fontSize}
            onChange={(event) => updateSqlEditorAppearance({ fontSize: getNumericValue(event.target.value, sqlEditor.fontSize) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>

        <FieldShell>
          <InputLabel>Line Height</InputLabel>
          <input
            type="number"
            min={1}
            max={2}
            step={0.05}
            value={sqlEditor.lineHeight}
            onChange={(event) => updateSqlEditorAppearance({ lineHeight: getNumericValue(event.target.value, sqlEditor.lineHeight) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>

        <FieldShell>
          <InputLabel>Padding</InputLabel>
          <input
            type="number"
            min={4}
            max={24}
            value={sqlEditor.padding}
            onChange={(event) => updateSqlEditorAppearance({ padding: getNumericValue(event.target.value, sqlEditor.padding) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>
      </div>
    );
  }

  if (activeScope === 'dataTable') {
    const dataTable = appearanceSettings.dataTable;
    preview = <DataTablePreview />;
    controls = (
      <div className="grid grid-cols-2 gap-4">
        <FieldShell>
          <InputLabel>Font</InputLabel>
          <select
            value={dataTable.fontFamily}
            onChange={(event) => updateDataTableAppearance({ fontFamily: event.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell>
          <InputLabel>Font Size</InputLabel>
          <input
            type="number"
            min={11}
            max={18}
            value={dataTable.fontSize}
            onChange={(event) => updateDataTableAppearance({ fontSize: getNumericValue(event.target.value, dataTable.fontSize) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>

        <FieldShell>
          <InputLabel>Row Padding</InputLabel>
          <input
            type="number"
            min={2}
            max={18}
            value={dataTable.rowPadding}
            onChange={(event) => updateDataTableAppearance({ rowPadding: getNumericValue(event.target.value, dataTable.rowPadding) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>

        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <InputLabel>Line Numbers</InputLabel>
          <label className="flex items-center gap-3 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={dataTable.showLineNumbersInQueryResults}
              onChange={(event) => updateDataTableAppearance({ showLineNumbersInQueryResults: event.target.checked })}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            Query results
          </label>
          <label className="flex items-center gap-3 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={dataTable.showLineNumbersInTables}
              onChange={(event) => updateDataTableAppearance({ showLineNumbersInTables: event.target.checked })}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            Tables and views
          </label>
        </div>
      </div>
    );
  }

  if (activeScope === 'sidebars') {
    const sidebars = appearanceSettings.sidebars;
    preview = <SidebarPreview />;
    controls = (
      <div className="grid grid-cols-2 gap-4">
        <FieldShell>
          <InputLabel>Font</InputLabel>
          <select
            value={sidebars.fontFamily}
            onChange={(event) => updateSidebarAppearance({ fontFamily: event.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell>
          <InputLabel>Font Size</InputLabel>
          <input
            type="number"
            min={11}
            max={18}
            value={sidebars.fontSize}
            onChange={(event) => updateSidebarAppearance({ fontSize: getNumericValue(event.target.value, sidebars.fontSize) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>

        <FieldShell>
          <InputLabel>Item Padding</InputLabel>
          <input
            type="number"
            min={6}
            max={18}
            value={sidebars.itemPadding}
            onChange={(event) => updateSidebarAppearance({ itemPadding: getNumericValue(event.target.value, sidebars.itemPadding) })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </FieldShell>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Appearance</div>
          <div className="mt-2 text-lg font-semibold text-text-primary">{APPEARANCE_SCOPE_LABELS[activeScope]}</div>
          <div className="mt-1 text-sm text-text-muted">
            Preview and tune how SqlMate looks before applying it to your workspace.
          </div>
        </div>

        <button
          onClick={() => resetAppearanceScope(activeScope)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
        >
          <RotateCcw size={14} />
          Restore Defaults
        </button>
      </div>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-6 overflow-hidden px-6 py-6">
        <div className="space-y-5 overflow-auto pr-1">
          <SectionLabel>Settings</SectionLabel>
          {controls}
        </div>

        <div className="overflow-auto">{preview}</div>
      </div>
    </div>
  );
};
