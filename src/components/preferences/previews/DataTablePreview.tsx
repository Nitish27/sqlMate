import { useDatabaseStore } from '../../../store/databaseStore';

const ROWS = [
  ['Cool jeans!', '2015-08-18 23:28:23', 'TRUE'],
  ['Gorgeous dress', '2015-08-23 16:21:03', 'TRUE'],
  ['Love your style', '2015-11-18 22:32:58', 'TRUE'],
  ['Cutest outfit', '2015-08-30 21:57:48', 'FALSE'],
];

export const DataTablePreview = () => {
  const dataTable = useDatabaseStore((state) => state.appearanceSettings.dataTable);
  const headerDividerStyle = { boxShadow: 'inset -1px 0 0 var(--color-border-strong)' };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
        Preview
      </div>

      <div
        className="overflow-hidden"
        style={{
          fontFamily: dataTable.fontFamily,
          fontSize: `${dataTable.fontSize}px`,
        }}
      >
        <div className="grid grid-cols-[48px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)] border-b border-border bg-surface">
          {dataTable.showLineNumbersInQueryResults && (
            <div className="px-3 py-2 text-text-muted" style={headerDividerStyle}>#</div>
          )}
          <div className="px-3 py-2 font-semibold text-text-secondary" style={headerDividerStyle}>comment</div>
          <div className="px-3 py-2 font-semibold text-text-secondary" style={headerDividerStyle}>created_at</div>
          <div className="px-3 py-2 font-semibold text-text-secondary" style={headerDividerStyle}>approved</div>
        </div>

        {ROWS.map((row, index) => {
          const isSelected = index === 2;
          const rowStyles = index === 1
            ? { backgroundColor: `${dataTable.statusColors.modifiedValues}22` }
            : index === 2
              ? { backgroundColor: `${dataTable.statusColors.selectionCursor}22` }
              : index === 3
                ? { backgroundColor: `${dataTable.statusColors.newRows}1f` }
                : undefined;

          return (
            <div
              key={`${row[0]}-${index}`}
              className="grid grid-cols-[48px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)] border-b border-border text-text-primary"
              style={rowStyles}
            >
              {dataTable.showLineNumbersInQueryResults && (
                <div
                  className="border-r border-border px-3"
                  style={{
                    color: dataTable.statusColors.rowNumbers,
                    paddingTop: `${dataTable.rowPadding}px`,
                    paddingBottom: `${dataTable.rowPadding}px`,
                  }}
                >
                  {index + 1}
                </div>
              )}
              {row.map((cell, cellIndex) => (
                <div
                  key={`${cell}-${cellIndex}`}
                  className={cellIndex < row.length - 1 ? 'border-r border-border px-3' : 'px-3'}
                  style={{
                    paddingTop: `${dataTable.rowPadding}px`,
                    paddingBottom: `${dataTable.rowPadding}px`,
                  }}
                >
                  {cell}
                </div>
              ))}
              {isSelected && (
                <div
                  className="pointer-events-none absolute left-0 mt-[81px] h-[30px] w-1 rounded-r-full"
                  style={{ backgroundColor: dataTable.statusColors.selectionCursor }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
