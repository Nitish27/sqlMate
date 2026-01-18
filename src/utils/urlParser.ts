export interface ParsedConfig {
  db_type: 'Postgres' | 'MySql' | 'Sqlite';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl_enabled?: boolean;
}

export const parseConnectionUrl = (urlString: string): ParsedConfig | null => {
  try {
    // Handle SQLite specifically as it can be sqlite:///path or sqlite:path
    if (urlString.startsWith('sqlite:')) {
      const path = urlString.replace(/^sqlite:(\/\/\/)?/, '');
      return {
        db_type: 'Sqlite',
        database: path,
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
    }

    return config;
  } catch (e) {
    console.error("Failed to parse URL:", e);
    return null;
  }
};
