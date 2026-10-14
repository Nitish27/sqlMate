export interface ParsedConfig {
  db_type: 'Postgres' | 'MySql' | 'Sqlite';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl_enabled?: boolean;
  ssl_mode?: 'prefer' | 'require' | 'verify-ca' | 'verify-full';
}

export const parseConnectionUrl = (urlString: string): ParsedConfig | null => {
  try {
    // Handle SQLite specifically as it can be sqlite:///path or sqlite:path
    if (urlString.startsWith('sqlite:')) {
      const path = urlString.startsWith('sqlite:///')
        ? urlString.slice('sqlite://'.length)
        : urlString.slice('sqlite:'.length);
      return {
        db_type: 'Sqlite',
        database: decodeURIComponent(path),
      };
    }

    const url = new URL(urlString);
    let db_type: 'Postgres' | 'MySql' | 'Sqlite';

    switch (url.protocol.replace(':', '')) {
      case 'postgres':
      case 'postgresql':
        db_type = 'Postgres';
        break;
      case 'mysql':
      case 'mariadb':
        db_type = 'MySql';
        break;
      default:
        return null;
    }

    const config: ParsedConfig = {
      db_type,
      host: url.hostname || undefined,
      port: url.port ? parseInt(url.port) : undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      database: url.pathname ? decodeURIComponent(url.pathname.substring(1)) : undefined,
    };

    // Parse query params for SSL
    const sslMode = url.searchParams.get('sslmode');
    if (sslMode && ['require', 'verify-ca', 'verify-full', 'prefer'].includes(sslMode)) {
      config.ssl_enabled = true;
      config.ssl_mode = sslMode as ParsedConfig['ssl_mode'];
    }

    return config;
  } catch (e) {
    console.error("Failed to parse URL:", e);
    return null;
  }
};
