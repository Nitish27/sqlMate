export function headerContentWidthForBody(gridWidth: number, scrollbarWidth: number): number {
  return gridWidth + Math.max(0, scrollbarWidth);
}
