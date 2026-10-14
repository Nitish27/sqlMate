import type { SavedConnection } from '../store/databaseStore';

export interface CredentialStatus {
  database: boolean;
  ssh: boolean;
}

export const sanitizeConnections = (connections: SavedConnection[]): SavedConnection[] =>
  connections.map((connection) => {
    const safe = { ...connection };
    delete (safe as SavedConnection & { ssh_password?: string }).ssh_password;
    delete (safe as SavedConnection & { password?: string }).password;
    return safe;
  });

export const needsCredentialPrompt = (
  connection: Pick<SavedConnection, 'type' | 'rememberCredentials' | 'ssh_enabled' | 'ssh_auth_method'>,
  status: CredentialStatus | null,
): boolean => {
  if (connection.type === 'Sqlite') return false;
  if (!connection.rememberCredentials || !status?.database) return true;
  return Boolean(connection.ssh_enabled && connection.ssh_auth_method !== 'key' && !status.ssh);
};
