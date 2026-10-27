import type { SchemaSnapshot, SchemaTable } from './schemaCompare';

export interface Relationship {
  name: string;
  source_schema: string | null;
  source_table: string;
  source_columns: string[];
  target_schema: string | null;
  target_table: string;
  target_columns: string[];
}

export interface RelationshipNode {
  key: string;
  schema: string | null;
  name: string;
  table?: SchemaTable;
  missing: boolean;
  direction: 'center' | 'incoming' | 'outgoing' | 'both';
}

export interface RelationshipEdge {
  sourceKey: string;
  targetKey: string;
  relationship: Relationship;
}

export interface RelationshipGraph {
  centerKey: string;
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
}

export const relationshipTableKey = (schema: string | null, name: string) => JSON.stringify([schema ?? '', name]);

export function resolveRelationshipFocus(snapshot: SchemaSnapshot, tableName: string) {
  const exact = snapshot.tables.filter(table => table.name === tableName);
  const match = exact.find(table => table.schema === 'public') ?? (exact.length === 1 ? exact[0] : undefined)
    ?? snapshot.tables.find(table => table.schema && `${table.schema}.${table.name}` === tableName);
  if (!match) throw new Error(`Table ${tableName} is not available in this database.`);
  return { schema: match.schema, name: match.name };
}

export function canOpenRelationshipNode(
  node: Pick<RelationshipNode, 'schema' | 'missing'>,
  engine: SchemaSnapshot['engine'],
) {
  if (node.missing) return false;
  return engine === 'Postgres' ? node.schema === 'public' : node.schema === null;
}

export function relationshipContextAvailable(
  context: {
    openConnectionIds: string[];
    activeConnectionId: string | null;
    activeDatabases: Record<string, string | null>;
  },
  connectionId: string,
  expectedDatabase: string | null | undefined,
) {
  return context.activeConnectionId === connectionId
    && context.openConnectionIds.includes(connectionId)
    && context.activeDatabases[connectionId] === expectedDatabase;
}

export function buildRelationshipMap(
  snapshot: SchemaSnapshot,
  relationships: Relationship[],
  focus: { schema: string | null; name: string },
): RelationshipGraph {
  const tables = new Map(snapshot.tables.map(table => [relationshipTableKey(table.schema, table.name), table]));
  const centerKey = relationshipTableKey(focus.schema, focus.name);
  if (!tables.has(centerKey)) throw new Error(`Table ${focus.name} is not in the selected database.`);

  const nodes = new Map<string, RelationshipNode>();
  const ensureNode = (schema: string | null, name: string, direction: RelationshipNode['direction']) => {
    const key = relationshipTableKey(schema, name);
    const existing = nodes.get(key);
    if (existing) {
      if (existing.direction !== direction && existing.direction !== 'center') existing.direction = 'both';
      return;
    }
    const table = tables.get(key);
    nodes.set(key, { key, schema, name, table, missing: !table, direction });
  };
  ensureNode(focus.schema, focus.name, 'center');

  const edges: RelationshipEdge[] = [];
  for (const relationship of relationships) {
    const sourceKey = relationshipTableKey(relationship.source_schema, relationship.source_table);
    const targetKey = relationshipTableKey(relationship.target_schema, relationship.target_table);
    if (sourceKey !== centerKey && targetKey !== centerKey) continue;
    if (sourceKey !== centerKey) ensureNode(relationship.source_schema, relationship.source_table, 'incoming');
    if (targetKey !== centerKey) ensureNode(relationship.target_schema, relationship.target_table, 'outgoing');
    edges.push({ sourceKey, targetKey, relationship });
  }

  return {
    centerKey,
    nodes: [...nodes.values()].sort((left, right) =>
      left.direction === 'center' ? -1 : right.direction === 'center' ? 1
        : `${left.schema || ''}.${left.name}`.localeCompare(`${right.schema || ''}.${right.name}`)),
    edges,
  };
}
