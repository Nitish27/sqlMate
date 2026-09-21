export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_PREFERENCE_OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export const isThemePreference = (value: unknown): value is ThemePreference => {
  return typeof value === 'string' && THEME_PREFERENCE_OPTIONS.includes(value as ThemePreference);
};

export const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }

  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
};

export const resolveThemePreference = (themePreference: ThemePreference): ResolvedTheme => {
  return themePreference === 'system' ? getSystemTheme() : themePreference;
};

export const applyThemeToDocument = (theme: ResolvedTheme) => {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

export const subscribeToSystemTheme = (callback: (theme: ResolvedTheme) => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
  const listener = (event: MediaQueryListEvent) => {
    callback(event.matches ? 'dark' : 'light');
  };

  mediaQuery.addEventListener('change', listener);

  return () => {
    mediaQuery.removeEventListener('change', listener);
  };
};
