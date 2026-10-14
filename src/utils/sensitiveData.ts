export function isSensitiveColumn(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (words.some(word => ['password', 'passwd', 'passphrase', 'secret', 'credential', 'credentials'].includes(word))) {
    return true;
  }

  if (words.includes('token') && !words.includes('count')) return true;

  const keyIndex = words.indexOf('key');
  return keyIndex > 0 && ['api', 'private', 'access', 'secret', 'signing', 'encryption'].includes(words[keyIndex - 1]);
}

export function hasSensitiveColumns(columns: string[]): boolean {
  return columns.some(isSensitiveColumn);
}

export function shouldMaskColumn(name: string, maskOverrides: Set<string>): boolean {
  return isSensitiveColumn(name) !== maskOverrides.has(name);
}
