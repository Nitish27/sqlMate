export const JSON_TREE_MAX_CHARACTERS = 500_000;
export const JSON_TREE_MAX_DEPTH = 64;
export const JSON_SEARCH_MAX_MATCHES = 200;

export function formatCellValue(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function parseJsonCellValue(value: unknown): Record<string, unknown> | unknown[] | null {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (!raw || raw.length > JSON_TREE_MAX_CHARACTERS) return null;
    const parsed: unknown = typeof value === 'string' ? JSON.parse(raw) : value;
    if (parsed === null || typeof parsed !== 'object' || ArrayBuffer.isView(parsed)) return null;
    const stack = [{ node: parsed, depth: 0 }];
    const seen = new WeakSet<object>();
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (node === null || typeof node !== 'object' || seen.has(node)) continue;
      if (depth > JSON_TREE_MAX_DEPTH) return null;
      seen.add(node);
      for (const child of Object.values(node)) stack.push({ node: child, depth: depth + 1 });
    }
    return parsed as Record<string, unknown> | unknown[];
  } catch {
    return null;
  }
}

export function jsonChildPath(parent: string, key: string): string {
  return `${parent}/${encodeURIComponent(key)}`;
}

export function searchJsonPaths(value: unknown, search: string): { paths: Set<string>; count: number; capped: boolean } {
  const term = search.trim().toLowerCase();
  const paths = new Set<string>();
  if (!term) return { paths, count: 0, capped: false };

  const stack: { value: unknown; key: string; path: string; ancestors: string[] }[] = [
    { value, key: '', path: '', ancestors: [] },
  ];
  const visited = new WeakSet<object>();
  let count = 0;
  let capped = false;

  while (stack.length > 0) {
    const item = stack.pop()!;
    const scalar = item.value === null || typeof item.value !== 'object';
    const matches = item.key.toLowerCase().includes(term)
      || (scalar && String(item.value).toLowerCase().includes(term));
    if (matches) {
      count += 1;
      paths.add(item.path);
      item.ancestors.forEach(path => paths.add(path));
      if (count >= JSON_SEARCH_MAX_MATCHES) { capped = stack.length > 0; break; }
    }
    if (!scalar && item.value && !visited.has(item.value)) {
      visited.add(item.value);
      for (const [key, child] of Object.entries(item.value)) {
        stack.push({ value: child, key, path: jsonChildPath(item.path, key), ancestors: [...item.ancestors, item.path] });
      }
    }
  }

  return { paths, count, capped };
}
