import type { FilterConfig } from '../store/databaseStore';

export const createDefaultTableFilter = (columns: string[], id: string): FilterConfig => ({
  id,
  column: columns[0] || '',
  operator: '=',
  value: '',
  enabled: true
});
