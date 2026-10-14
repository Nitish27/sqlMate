import type { DatabaseType } from './sqlIdentifiers';
import { scanSqlStatements } from './sqlStatements';

export const planGeneratedSqlAppend = (existing: string, generated: string, databaseType: DatabaseType = 'MySql') => {
  const sql = generated.trim();
  if (!sql) return null;
  const { statements, reason } = scanSqlStatements(existing, databaseType);
  if (reason) return null;

  const lastStatement = statements[statements.length - 1];
  const needsTerminator = lastStatement && !lastStatement.sql.endsWith(';');
  const separator = needsTerminator
    ? `${existing.endsWith('\n') ? '' : '\n'};\n\n`
    : existing.endsWith('\n\n') || !existing ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return { offset: existing.length, text: separator + sql };
};
