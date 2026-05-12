import { type ThemePreference } from './theme';

export type AppearanceScope = 'sqlEditor' | 'dataTable' | 'sidebars';

export interface SqlEditorSyntaxColors {
  comments: string;
  numbers: string;
  singleQuoteStrings: string;
  doubleQuoteStrings: string;
  backtickQuoteStrings: string;
  keywords: string;
  identifiers: string;
  operators: string;
}

export interface SqlEditorAppearance {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  padding: number;
  syntaxColors: SqlEditorSyntaxColors;
}

export interface DataTableStatusColors {
  selectionCursor: string;
  modifiedValues: string;
  newRows: string;
  softDeletedRows: string;
  rowNumbers: string;
}

export interface DataTableAppearance {
  fontFamily: string;
  fontSize: number;
  rowPadding: number;
  showLineNumbersInQueryResults: boolean;
  showLineNumbersInTables: boolean;
  statusColors: DataTableStatusColors;
}

export interface SidebarAppearance {
  fontFamily: string;
  fontSize: number;
  itemPadding: number;
}

export interface AppearanceSettings {
  sqlEditor: SqlEditorAppearance;
  dataTable: DataTableAppearance;
  sidebars: SidebarAppearance;
}

export type SqlEditorAppearancePatch = Partial<Omit<SqlEditorAppearance, 'syntaxColors'>> & {
  syntaxColors?: Partial<SqlEditorSyntaxColors>;
};

export type DataTableAppearancePatch = Partial<Omit<DataTableAppearance, 'statusColors'>> & {
  statusColors?: Partial<DataTableStatusColors>;
};

export const DEFAULT_THEME_PRESET: ThemePreference = 'system';

export const FONT_FAMILY_OPTIONS = [
  { label: 'System Sans', value: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: 'System Mono', value: '"SFMono-Regular", "JetBrains Mono", "Fira Code", "Menlo", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", "Fira Code", "Menlo", monospace' },
  { label: 'Fira Code', value: '"Fira Code", "Menlo", monospace' },
] as const;

export const APPEARANCE_SCOPE_LABELS: Record<AppearanceScope, string> = {
  sqlEditor: 'SQL Editor',
  dataTable: 'Data Table',
  sidebars: 'Sidebars',
};

export const DEFAULT_SQL_EDITOR_APPEARANCE: SqlEditorAppearance = {
  fontFamily: FONT_FAMILY_OPTIONS[1].value,
  fontSize: 13,
  lineHeight: 1.55,
  padding: 10,
  syntaxColors: {
    comments: '#16a34a',
    numbers: '#a855f7',
    singleQuoteStrings: '#fb7185',
    doubleQuoteStrings: '#ef4444',
    backtickQuoteStrings: '#f59e0b',
    keywords: '#60a5fa',
    identifiers: '#e5e7eb',
    operators: '#94a3b8',
  },
};

export const DEFAULT_DATA_TABLE_APPEARANCE: DataTableAppearance = {
  fontFamily: FONT_FAMILY_OPTIONS[0].value,
  fontSize: 13,
  rowPadding: 6,
  showLineNumbersInQueryResults: true,
  showLineNumbersInTables: false,
  statusColors: {
    selectionCursor: '#2563eb',
    modifiedValues: '#ca8a04',
    newRows: '#16a34a',
    softDeletedRows: '#b91c1c',
    rowNumbers: '#6b7280',
  },
};

export const DEFAULT_SIDEBAR_APPEARANCE: SidebarAppearance = {
  fontFamily: FONT_FAMILY_OPTIONS[0].value,
  fontSize: 13,
  itemPadding: 10,
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  sqlEditor: DEFAULT_SQL_EDITOR_APPEARANCE,
  dataTable: DEFAULT_DATA_TABLE_APPEARANCE,
  sidebars: DEFAULT_SIDEBAR_APPEARANCE,
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const getString = (value: unknown, fallback: string) => {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
};

const getNumber = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
};

const getBoolean = (value: unknown, fallback: boolean) => {
  return typeof value === 'boolean' ? value : fallback;
};

export const cloneAppearanceSettings = (settings: AppearanceSettings): AppearanceSettings => ({
  sqlEditor: {
    ...settings.sqlEditor,
    syntaxColors: {
      ...settings.sqlEditor.syntaxColors,
    },
  },
  dataTable: {
    ...settings.dataTable,
    statusColors: {
      ...settings.dataTable.statusColors,
    },
  },
  sidebars: {
    ...settings.sidebars,
  },
});

export const getAppearanceScopeDefaults = <TScope extends AppearanceScope>(scope: TScope): AppearanceSettings[TScope] => {
  return cloneAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)[scope];
};

export const mergeAppearanceSettings = (value: unknown): AppearanceSettings => {
  const settings = isRecord(value) ? value : {};
  const sqlEditor = isRecord(settings.sqlEditor) ? settings.sqlEditor : {};
  const dataTable = isRecord(settings.dataTable) ? settings.dataTable : {};
  const sidebars = isRecord(settings.sidebars) ? settings.sidebars : {};
  const syntaxColors = isRecord(sqlEditor.syntaxColors) ? sqlEditor.syntaxColors : {};
  const statusColors = isRecord(dataTable.statusColors) ? dataTable.statusColors : {};

  return {
    sqlEditor: {
      fontFamily: getString(sqlEditor.fontFamily, DEFAULT_SQL_EDITOR_APPEARANCE.fontFamily),
      fontSize: getNumber(sqlEditor.fontSize, DEFAULT_SQL_EDITOR_APPEARANCE.fontSize, 11, 20),
      lineHeight: getNumber(sqlEditor.lineHeight, DEFAULT_SQL_EDITOR_APPEARANCE.lineHeight, 1, 2),
      padding: getNumber(sqlEditor.padding, DEFAULT_SQL_EDITOR_APPEARANCE.padding, 4, 24),
      syntaxColors: {
        comments: getString(syntaxColors.comments, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.comments),
        numbers: getString(syntaxColors.numbers, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.numbers),
        singleQuoteStrings: getString(syntaxColors.singleQuoteStrings, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.singleQuoteStrings),
        doubleQuoteStrings: getString(syntaxColors.doubleQuoteStrings, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.doubleQuoteStrings),
        backtickQuoteStrings: getString(syntaxColors.backtickQuoteStrings, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.backtickQuoteStrings),
        keywords: getString(syntaxColors.keywords, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.keywords),
        identifiers: getString(syntaxColors.identifiers, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.identifiers),
        operators: getString(syntaxColors.operators, DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors.operators),
      },
    },
    dataTable: {
      fontFamily: getString(dataTable.fontFamily, DEFAULT_DATA_TABLE_APPEARANCE.fontFamily),
      fontSize: getNumber(dataTable.fontSize, DEFAULT_DATA_TABLE_APPEARANCE.fontSize, 11, 18),
      rowPadding: getNumber(dataTable.rowPadding, DEFAULT_DATA_TABLE_APPEARANCE.rowPadding, 2, 18),
      showLineNumbersInQueryResults: getBoolean(dataTable.showLineNumbersInQueryResults, DEFAULT_DATA_TABLE_APPEARANCE.showLineNumbersInQueryResults),
      showLineNumbersInTables: getBoolean(dataTable.showLineNumbersInTables, DEFAULT_DATA_TABLE_APPEARANCE.showLineNumbersInTables),
      statusColors: {
        selectionCursor: getString(statusColors.selectionCursor, DEFAULT_DATA_TABLE_APPEARANCE.statusColors.selectionCursor),
        modifiedValues: getString(statusColors.modifiedValues, DEFAULT_DATA_TABLE_APPEARANCE.statusColors.modifiedValues),
        newRows: getString(statusColors.newRows, DEFAULT_DATA_TABLE_APPEARANCE.statusColors.newRows),
        softDeletedRows: getString(statusColors.softDeletedRows, DEFAULT_DATA_TABLE_APPEARANCE.statusColors.softDeletedRows),
        rowNumbers: getString(statusColors.rowNumbers, DEFAULT_DATA_TABLE_APPEARANCE.statusColors.rowNumbers),
      },
    },
    sidebars: {
      fontFamily: getString(sidebars.fontFamily, DEFAULT_SIDEBAR_APPEARANCE.fontFamily),
      fontSize: getNumber(sidebars.fontSize, DEFAULT_SIDEBAR_APPEARANCE.fontSize, 11, 18),
      itemPadding: getNumber(sidebars.itemPadding, DEFAULT_SIDEBAR_APPEARANCE.itemPadding, 6, 18),
    },
  };
};
