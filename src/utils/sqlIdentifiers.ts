export type DatabaseType = 'Postgres' | 'MySql' | 'Sqlite' | 'DuckDb';

export const sidebarTableName = (name: string, schema: string | undefined, databaseType: DatabaseType) =>
  databaseType === 'DuckDb' && schema ? `${schema}.${name}` : name;

export const quoteIdentifier = (identifier: string, databaseType: DatabaseType) => {
  if (databaseType === 'MySql') {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  return `"${identifier.replace(/"/g, '""')}"`;
};

export const quoteTableReference = (tableName: string, databaseType: DatabaseType) =>
  databaseType === 'DuckDb'
    ? tableName.split('.').map(part => quoteIdentifier(part, databaseType)).join('.')
    : quoteIdentifier(tableName, databaseType);
