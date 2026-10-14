import type { SavedConnection } from '../store/databaseStore';

const networkFields = ['host', 'username', 'ssh_enabled'] as const;

const sshFields = ['ssh_host', 'ssh_port', 'ssh_username', 'ssh_auth_method', 'ssh_private_key_path'] as const;

const effectivePort = (connection: SavedConnection) => connection.port || (connection.type === 'Postgres' ? 5432 : 3306);

export const connectionTargetChanged = (previous: SavedConnection, next: SavedConnection): boolean =>
  previous.type !== next.type
  || (previous.database ?? null) !== (next.database ?? null)
  || (previous.type !== 'Sqlite' && networkFields.some(field => (previous[field] ?? null) !== (next[field] ?? null)))
  || (previous.type !== 'Sqlite' && effectivePort(previous) !== effectivePort(next))
  || (Boolean(next.ssh_enabled) && sshFields.some(field => (previous[field] ?? null) !== (next[field] ?? null)));
