import type { FilterConfig, ForeignKeyStructure } from '../store/databaseStore';

export function filtersForForeignKey(
  key: ForeignKeyStructure,
  columns: string[],
  row: unknown[],
): FilterConfig[] | null {
  if (!key.source_columns.length || key.source_columns.length !== key.target_columns.length) return null;

  const filters: FilterConfig[] = [];
  for (let index = 0; index < key.source_columns.length; index++) {
    const columnIndex = columns.indexOf(key.source_columns[index]);
    const targetColumn = key.target_columns[index];
    if (columnIndex < 0 || !targetColumn) return null;
    const value = row[columnIndex];
    if (value === null || value === undefined || typeof value === 'object') return null;
    filters.push({
      id: `foreign-key-${index}`,
      column: targetColumn,
      operator: '=',
      value: String(value),
      enabled: true,
    });
  }
  return filters;
}
