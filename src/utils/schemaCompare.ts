export interface SchemaColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
}

export interface SchemaTable {
  schema: string | null;
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaSnapshot {
  engine: 'Postgres' | 'MySql' | 'Sqlite';
  database: string;
  tables: SchemaTable[];
}

export type DiffStatus = 'source-only' | 'target-only' | 'changed' | 'unchanged';
export type ChangedField = 'data_type' | 'is_nullable' | 'default_value' | 'is_primary_key';

export interface ColumnDiff {
  name: string;
  status: DiffStatus;
  source?: SchemaColumn;
  target?: SchemaColumn;
  changedFields: ChangedField[];
}

export interface TableDiff {
  key: string;
  schema: string | null;
  name: string;
  status: DiffStatus;
  source?: SchemaTable;
  target?: SchemaTable;
  columns: ColumnDiff[];
}

export interface SchemaDiff {
  tables: TableDiff[];
  summary: { sourceOnly: number; targetOnly: number; changed: number; unchanged: number };
}

export function comparableTargets<T extends { id: string; type: string }>(
  source: T | undefined,
  connections: T[],
  openConnectionIds: string[],
): T[] {
  if (!source) return [];
  const open = new Set(openConnectionIds);
  return connections.filter(connection => connection.id !== source.id
    && connection.type === source.type && open.has(connection.id));
}

const tableKey = (table: SchemaTable) => JSON.stringify([table.schema ?? '', table.name]);

function compareColumns(source?: SchemaTable, target?: SchemaTable): ColumnDiff[] {
  const sourceColumns = new Map(source?.columns.map(column => [column.name, column]) ?? []);
  const targetColumns = new Map(target?.columns.map(column => [column.name, column]) ?? []);
  return [...new Set([...sourceColumns.keys(), ...targetColumns.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((name): ColumnDiff => {
      const sourceColumn = sourceColumns.get(name);
      const targetColumn = targetColumns.get(name);
      const changedFields: ChangedField[] = sourceColumn && targetColumn
        ? (['data_type', 'is_nullable', 'default_value', 'is_primary_key'] as ChangedField[])
          .filter(field => sourceColumn[field] !== targetColumn[field])
        : [];
      return {
        name,
        status: !sourceColumn ? 'target-only' : !targetColumn ? 'source-only' : changedFields.length ? 'changed' : 'unchanged',
        source: sourceColumn,
        target: targetColumn,
        changedFields,
      };
    });
}

export function compareSchemas(source: SchemaSnapshot, target: SchemaSnapshot): SchemaDiff {
  if (source.engine !== target.engine) {
    throw new Error('Schema comparison requires the same engine on both connections.');
  }
  const sourceTables = new Map(source.tables.map(table => [tableKey(table), table]));
  const targetTables = new Map(target.tables.map(table => [tableKey(table), table]));
  const tables = [...new Set([...sourceTables.keys(), ...targetTables.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((key): TableDiff => {
      const sourceTable = sourceTables.get(key);
      const targetTable = targetTables.get(key);
      const table = sourceTable ?? targetTable!;
      const columns = compareColumns(sourceTable, targetTable);
      return {
        key,
        schema: table.schema,
        name: table.name,
        status: !sourceTable ? 'target-only' : !targetTable ? 'source-only'
          : columns.some(column => column.status !== 'unchanged') ? 'changed' : 'unchanged',
        source: sourceTable,
        target: targetTable,
        columns,
      };
    });
  return {
    tables,
    summary: {
      sourceOnly: tables.filter(table => table.status === 'source-only').length,
      targetOnly: tables.filter(table => table.status === 'target-only').length,
      changed: tables.filter(table => table.status === 'changed').length,
      unchanged: tables.filter(table => table.status === 'unchanged').length,
    },
  };
}
