const NON_PRODUCTION_ENVIRONMENTS = new Set(['local', 'test', 'dev', 'staging']);

export function effectiveAiAccess(environment?: string, enabled?: boolean | null): boolean {
  const tag = environment?.trim().toLowerCase();
  if (tag === 'production') return enabled === true;
  return Boolean(tag && NON_PRODUCTION_ENVIRONMENTS.has(tag) && enabled !== false);
}

export function aiAccessAfterEnvironmentChange(
  previousEnvironment: string | undefined,
  nextEnvironment: string,
  enabled: boolean,
): boolean {
  if (previousEnvironment?.trim().toLowerCase() !== 'production'
    && nextEnvironment.trim().toLowerCase() === 'production') return false;
  return enabled;
}
