export type SafetyMode = 'Silent' | 'Alert' | 'Safe';

type ConnectionIdentityInput = {
  name?: string;
  type: 'Postgres' | 'MySql' | 'Sqlite';
  environment?: string;
  host?: string;
  port?: number;
  database?: string;
};

export function connectionIdentity(connection: ConnectionIdentityInput) {
  const environment = connection.environment?.trim().toUpperCase() || 'UNTAGGED';
  const database = connection.database?.trim() || 'No database selected';
  const host = connection.host?.trim() || 'No host';
  const target = connection.type === 'Sqlite'
    ? database
    : `${database} @ ${host}${connection.port ? `:${connection.port}` : ''}`;
  const description = `${connection.name?.trim() || 'New connection'} | ${environment} tag | ${target}`;
  return { environment, target, description };
}

export function safetyModeDescription(mode: SafetyMode): string {
  switch (mode) {
    case 'Safe': return 'Only read-only SELECT queries run. Data changes are blocked.';
    case 'Alert': return 'Confirm every SQL query and data change before it runs.';
    case 'Silent': return 'SQL queries and data changes run without confirmation.';
  }
}

export function requiresProtectionDowngradeConfirmation(current: SafetyMode, next: SafetyMode): boolean {
  const rank: Record<SafetyMode, number> = { Silent: 0, Alert: 1, Safe: 2 };
  return rank[next] < rank[current];
}
