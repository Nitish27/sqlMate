export interface QueryPlanResult {
  databaseType: 'Postgres' | 'MySql' | 'Sqlite';
  plan: unknown;
  planningTimeMs: number;
}

export interface QueryPlanNode {
  id: string;
  title: string;
  meta: string[];
  badge?: 'scan' | 'index';
  children: QueryPlanNode[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

const text = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);

const unavailable = (): QueryPlanNode[] => [{ id: 'unavailable', title: 'Plan unavailable', meta: [], children: [] }];

function postgresNode(value: unknown, id: string): QueryPlanNode | null {
  const item = record(value);
  if (!item) return null;
  const operation = text(item['Node Type']) || 'Plan step';
  const relation = text(item['Relation Name']);
  const meta = [
    item['Index Name'] && `Index: ${item['Index Name']}`,
    item['Plan Rows'] !== undefined && `Est. rows: ${item['Plan Rows']}`,
    item['Total Cost'] !== undefined && `Cost: ${item['Total Cost']}`,
  ].filter((part): part is string => typeof part === 'string');
  const children = Array.isArray(item.Plans)
    ? item.Plans.map((child, index) => postgresNode(child, `${id}.${index}`)).filter((child): child is QueryPlanNode => child !== null)
    : [];
  return {
    id, title: relation ? `${operation} on ${relation}` : operation, meta, children,
    badge: operation.includes('Seq Scan') ? 'scan' : operation.includes('Index') ? 'index' : undefined,
  };
}

function mysqlNodes(value: unknown): QueryPlanNode[] {
  if (!Array.isArray(value) || value.length === 0) return unavailable();
  return value.map((raw, index) => {
    const item = record(raw) || {};
    const table = text(item.table) || text(item.select_type) || `Plan step ${index + 1}`;
    const access = text(item.type);
    const indexName = text(item.key);
    const rows = text(item.rows);
    const extra = text(item.Extra);
    return {
      id: String(index), title: table,
      meta: [access && `Access: ${access}`, indexName && `Index: ${indexName}`,
        rows && `Est. rows: ${rows}`, extra].filter((part): part is string => part !== null),
      badge: access === 'ALL' ? 'scan' as const : indexName ? 'index' as const : undefined,
      children: [],
    };
  });
}

function sqliteNodes(value: unknown): QueryPlanNode[] {
  if (!Array.isArray(value)) return unavailable();
  const entries = value.map(record).filter((item): item is Record<string, unknown> => item !== null);
  const nodes = new Map<number, QueryPlanNode>();
  for (const item of entries) {
    if (typeof item.id !== 'number') continue;
    const detail = text(item.detail) || 'Plan step';
    nodes.set(item.id, {
      id: String(item.id), title: detail, meta: [], children: [],
      badge: /^SCAN\b/i.test(detail) ? 'scan' : /^SEARCH\b/i.test(detail) ? 'index' : undefined,
    });
  }
  const roots: QueryPlanNode[] = [];
  for (const item of entries) {
    if (typeof item.id !== 'number') continue;
    const node = nodes.get(item.id);
    if (!node) continue;
    const parent = typeof item.parent === 'number' && item.parent !== item.id ? nodes.get(item.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots.length ? roots : unavailable();
}

export function getQueryPlanNodes(result: QueryPlanResult): QueryPlanNode[] {
  if (result.databaseType === 'Postgres') {
    const top = Array.isArray(result.plan) ? record(result.plan[0]) : record(result.plan);
    const root = postgresNode(top?.Plan, '0');
    return root ? [root] : unavailable();
  }
  if (result.databaseType === 'MySql') return mysqlNodes(result.plan);
  if (result.databaseType === 'Sqlite') return sqliteNodes(result.plan);
  return unavailable();
}
