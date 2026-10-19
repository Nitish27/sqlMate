export interface CellPress {
  rowIndex: number;
  columnName: string;
  x: number;
  y: number;
  time: number;
}

export const isRepeatedCellPress = (previous: CellPress | null, current: CellPress): boolean =>
  previous !== null
  && previous.rowIndex === current.rowIndex
  && previous.columnName === current.columnName
  && current.time >= previous.time
  && current.time - previous.time <= 500
  && Math.hypot(current.x - previous.x, current.y - previous.y) <= 5;

export const getContextEditColumn = (
  contextCell: { rowIndex: number; columnName: string } | null,
  rowIndex: number,
  visibleColumns: string[],
): string | undefined => contextCell?.rowIndex === rowIndex
  && visibleColumns.includes(contextCell.columnName)
  ? contextCell.columnName : visibleColumns[0];

export const parseCellEditorValue = (
  originalValue: unknown,
  editorValue: string,
  column?: { isNullable: boolean; dataType: string },
) => {
  if (column?.isNullable && editorValue.trim() === ''
    && /^(date|datetime|timestamp|time)(?:\b|\()/i.test(column.dataType)) {
    return null;
  }
  if (typeof originalValue === 'number' && editorValue.trim() !== '') {
    const numericValue = Number(editorValue);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  if (typeof originalValue === 'boolean') {
    if (editorValue === 'true' || editorValue === '1') return true;
    if (editorValue === 'false' || editorValue === '0') return false;
  }

  return editorValue;
};

export const nullCellEditValue = (isNullable: boolean): null => {
  if (!isNullable) throw new Error('This column is not nullable.');
  return null;
};
