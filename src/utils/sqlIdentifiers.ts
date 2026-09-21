export type DatabaseType = 'Postgres' | 'MySql' | 'Sqlite';

export const quoteIdentifier = (identifier: string, databaseType: DatabaseType) => {
  if (databaseType === 'MySql') {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  return `"${identifier.replace(/"/g, '""')}"`;
};
