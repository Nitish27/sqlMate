export type DatabaseType = 'Postgres' | 'MySql' | 'Sqlite' | 'DuckDb';

const postgresReference = /^("(?:[^"]|"")+")\.("(?:[^"]|"")+")$/;

export const sidebarTableName = (name: string, schema: string | null | undefined, databaseType: DatabaseType) => {
  if (databaseType === 'Postgres') return `${quoteIdentifier(schema ?? 'public', databaseType)}.${quoteIdentifier(name, databaseType)}`;
  return databaseType === 'DuckDb' && schema ? `${schema}.${name}` : name;
};

export function tableDisplayName(name: string, databaseType?: DatabaseType): string {
  if (databaseType !== 'Postgres') return name;
  const parts = postgresReference.exec(name);
  if (!parts || parts[0] !== name) return name;
  return parts.slice(1).map(part => /^[a-z_][a-z0-9_]*$/.test(part.slice(1, -1)) ? part.slice(1, -1) : part).join('.');
}

export const quoteIdentifier = (identifier: string, databaseType: DatabaseType) => {
  if (databaseType === 'MySql') {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  return `"${identifier.replace(/"/g, '""')}"`;
};

export const quoteTableReference = (tableName: string, databaseType: DatabaseType) =>
  databaseType === 'Postgres'
    ? postgresReference.exec(tableName)?.[0] === tableName ? tableName : sidebarTableName(tableName, 'public', databaseType)
    : databaseType === 'DuckDb'
    ? tableName.split('.').map(part => quoteIdentifier(part, databaseType)).join('.')
    : quoteIdentifier(tableName, databaseType);
