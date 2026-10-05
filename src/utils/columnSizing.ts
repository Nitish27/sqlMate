export const resizeColumnWidth = (startWidth: number, pointerDelta: number, minimumWidth: number) => (
  Math.max(minimumWidth, startWidth + pointerDelta)
);
