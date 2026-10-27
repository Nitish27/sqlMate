export const DEFAULT_TABLE_CONSOLE_HEIGHT = 192;
export const MIN_TABLE_CONSOLE_HEIGHT = 80;
export const MIN_TABLE_VIEW_HEIGHT = 160;

export function maxTableConsoleHeight(availableHeight: number) {
  return Math.max(MIN_TABLE_CONSOLE_HEIGHT, Math.floor(availableHeight - MIN_TABLE_VIEW_HEIGHT));
}

export function clampTableConsoleHeight(requestedHeight: number, availableHeight: number) {
  return Math.max(MIN_TABLE_CONSOLE_HEIGHT,
    Math.min(maxTableConsoleHeight(availableHeight), Math.round(requestedHeight)));
}
