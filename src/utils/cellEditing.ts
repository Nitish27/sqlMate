export const parseCellEditorValue = (originalValue: unknown, editorValue: string) => {
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
