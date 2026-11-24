export type ConnectionType = 'Postgres' | 'MySql' | 'Sqlite' | 'DuckDb';

export const CONNECTION_TYPES: ReadonlyArray<{
  id: ConnectionType;
  name: string;
  description: string;
  kind: 'server' | 'file';
  keywords: string;
}> = [
  { id: 'Postgres', name: 'PostgreSQL', description: 'Connect to a PostgreSQL server', kind: 'server', keywords: 'postgres pg' },
  { id: 'MySql', name: 'MySQL / MariaDB', description: 'Connect using the MySQL protocol', kind: 'server', keywords: 'mysql mariadb' },
  { id: 'Sqlite', name: 'SQLite', description: 'Open a local SQLite database file', kind: 'file', keywords: 'sqlite file local' },
  { id: 'DuckDb', name: 'DuckDB', description: 'Open a local file, read-only preview', kind: 'file', keywords: 'duckdb file local read only' },
];

export const filterConnectionTypes = (query: string) => {
  const search = query.trim().toLowerCase();
  return search
    ? CONNECTION_TYPES.filter(type => `${type.name} ${type.description} ${type.keywords}`.toLowerCase().includes(search))
    : CONNECTION_TYPES;
};

export const OTHER_DATABASES = [
  'Amazon Redshift', 'Microsoft SQL Server', 'Cassandra', 'ClickHouse',
  'BigQuery', 'DynamoDB', 'Elasticsearch', 'libSQL', 'Cloudflare D1',
  'MongoDB', 'Snowflake', 'Redis', 'Oracle', 'CockroachDB',
  'Greenplum', 'Vertica', 'SingleStore',
] as const;

export const filterOtherDatabases = (query: string) => {
  const search = query.trim().toLowerCase();
  return search ? OTHER_DATABASES.filter(name => name.toLowerCase().includes(search)) : OTHER_DATABASES;
};

export const moveConnectionTypeSelection = (current: number, count: number, delta: number) =>
  count === 0 ? 0 : (current + delta + count) % count;
