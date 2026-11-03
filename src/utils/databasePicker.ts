export function filterDatabases(databases: string[], search: string): string[] {
  const term = search.trim().toLocaleLowerCase();
  return databases.filter(database => database.toLocaleLowerCase().includes(term));
}

export function moveDatabaseSelection(index: number, count: number, direction: -1 | 1): number {
  return count ? (index + direction + count) % count : 0;
}
