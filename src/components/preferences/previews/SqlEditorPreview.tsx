import { useDatabaseStore } from '../../../store/databaseStore';
import { previewSyntaxColors } from '../../../utils/appearance';

export const SqlEditorPreview = () => {
  const sqlEditor = useDatabaseStore((state) => state.appearanceSettings.sqlEditor);
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const syntaxColors = previewSyntaxColors(sqlEditor.syntaxColors, resolvedTheme);

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-background"
      style={{
        fontFamily: sqlEditor.fontFamily,
        fontSize: `${sqlEditor.fontSize}px`,
        lineHeight: sqlEditor.lineHeight,
        padding: `${sqlEditor.padding}px`,
      }}
    >
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
        Preview
      </div>
      <div className="space-y-2 text-text-primary">
        <div>
          <span style={{ color: syntaxColors.comments }}>-- Sample query 1 --</span>
        </div>
        <div className="whitespace-pre-wrap">
          <span style={{ color: syntaxColors.keywords }}>SELECT</span>
          <span style={{ color: syntaxColors.operators }}> *</span>
          <span style={{ color: syntaxColors.keywords }}> FROM</span>
          <span style={{ color: syntaxColors.identifiers }}> public</span>
          <span style={{ color: syntaxColors.operators }}>.</span>
          <span style={{ color: syntaxColors.doubleQuoteStrings }}>"comments"</span>
          <span style={{ color: syntaxColors.keywords }}> WHERE</span>
          <span style={{ color: syntaxColors.identifiers }}> content</span>
          <span style={{ color: syntaxColors.operators }}> = </span>
          <span style={{ color: syntaxColors.singleQuoteStrings }}>'Love!'</span>
          <span style={{ color: syntaxColors.keywords }}> LIMIT</span>
          <span style={{ color: syntaxColors.numbers }}> 1000</span>
          <span style={{ color: syntaxColors.operators }}>;</span>
        </div>
        <div className="pt-2">
          <span style={{ color: syntaxColors.comments }}>-- Sample query 2 --</span>
        </div>
        <div className="whitespace-pre-wrap">
          <span style={{ color: syntaxColors.keywords }}>SELECT</span>
          <span style={{ color: syntaxColors.operators }}> *</span>
          <span style={{ color: syntaxColors.keywords }}> FROM</span>
          <span style={{ color: syntaxColors.operators }}> `</span>
          <span style={{ color: syntaxColors.backtickQuoteStrings }}>audit_events</span>
          <span style={{ color: syntaxColors.operators }}>` </span>
          <span style={{ color: syntaxColors.keywords }}>WHERE</span>
          <span style={{ color: syntaxColors.identifiers }}> id</span>
          <span style={{ color: syntaxColors.operators }}> {'>'}= </span>
          <span style={{ color: syntaxColors.numbers }}>42</span>
          <span style={{ color: syntaxColors.keywords }}> LIMIT</span>
          <span style={{ color: syntaxColors.numbers }}> 10</span>
          <span style={{ color: syntaxColors.operators }}>;</span>
        </div>
      </div>
    </div>
  );
};
