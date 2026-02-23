import { useRef, CSSProperties, useEffect } from 'react';
import { List } from 'react-window';

interface QueryResultsTableProps {
  columns: string[];
  data: any[][];
  onReachBottom?: () => void;
  isLoadingMore?: boolean;
  selectedRowIndex?: number | null;
  onSelectRow?: (index: number) => void;
}

const ROW_HEIGHT = 28;
const COLUMN_WIDTH = 150;
const INDEX_COLUMN_WIDTH = 40;

export const QueryResultsTable = ({ 
  columns, 
  data, 
  onReachBottom, 
  isLoadingMore,
  selectedRowIndex,
  onSelectRow 
}: QueryResultsTableProps) => {
  const headerRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: any) => {
    if (headerRef.current) {
      headerRef.current.scrollLeft = e.scrollOffset || (e.target as any)?.scrollLeft || 0;
    }
  };

  useEffect(() => {
    // Try to attach native scroll listener if `react-window` inner element exposes it
    const el = document.querySelector('.react-window-list');
    if (el) {
      const nativeScroll = (e: Event) => {
        if (headerRef.current) {
          headerRef.current.scrollLeft = (e.currentTarget as HTMLDivElement).scrollLeft;
        }
      };
      el.addEventListener('scroll', nativeScroll);
      return () => el.removeEventListener('scroll', nativeScroll);
    }
  }, []);

  const formatValue = (value: any) => {
    if (value === null) return <span className="text-text-muted italic opacity-40">NULL</span>;
    if (typeof value === 'boolean') return <span className="text-blue-400 font-medium">{value ? 'true' : 'false'}</span>;
    return <span className="truncate text-[#ccc]">{String(value)}</span>;
  };

  const totalWidth = INDEX_COLUMN_WIDTH + columns.length * COLUMN_WIDTH;

  const Row = ({ index, style }: { index: number; style: CSSProperties }) => {
    const row = data[index];
    if (!row) return null;
    const isSelected = selectedRowIndex === index;

    return (
      <div 
        style={{ ...style, width: totalWidth, minWidth: '100%' }} 
        className={`flex border-b border-[#2C2C2C] hover:bg-accent/5 transition-colors group cursor-default ${
          isSelected ? 'bg-accent/15 after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-accent z-10' : ''
        }`}
        onClick={() => onSelectRow?.(index)}
      >
        <div 
          className={`sticky left-0 z-10 shrink-0 border-r border-[#3C3C3C] text-[10px] text-text-muted flex items-center justify-center group-hover:bg-accent/10 shadow-[2px_0_5px_rgba(0,0,0,0.2)] ${
            isSelected ? 'bg-accent/20 text-accent font-bold' : 'bg-[#1e1e1e]'
          }`}
          style={{ width: INDEX_COLUMN_WIDTH }}
        >
          {index + 1}
        </div>
        {row.map((val, i) => (
          <div 
            key={i} 
            className={`shrink-0 px-3 border-r border-[#3C3C3C] flex items-center text-[11px] truncate ${
              isSelected ? 'text-text-primary' : 'text-[#ccc]'
            }`}
            style={{ width: COLUMN_WIDTH }}
          >
            {formatValue(val)}
          </div>
        ))}
      </div>
    );
  };

  if (columns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        No results to display
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] overflow-hidden">
      {/* Header */}
      <div 
        ref={headerRef}
        className="overflow-hidden bg-[#2C2C2C] border-b border-[#3C3C3C] shrink-0"
      >
        <div className="flex" style={{ width: totalWidth, minWidth: '100%' }}>
          <div 
            className="sticky left-0 z-20 bg-[#2C2C2C] shrink-0 border-r border-[#3C3C3C] h-8 flex items-center justify-center text-text-muted text-[10px]"
            style={{ width: INDEX_COLUMN_WIDTH }}
          >
            #
          </div>
          {columns.map((name) => (
            <div 
              key={name}
              className="shrink-0 px-3 border-r border-[#3C3C3C] h-8 flex items-center text-[11px] font-semibold text-text-secondary truncate"
              style={{ width: COLUMN_WIDTH }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>

      {/* Body with Virtualization */}
      <div className="flex-1 relative min-h-0 bg-[#1e1e1e]">
        <List
          rowCount={data.length}
          rowHeight={ROW_HEIGHT}
          rowComponent={Row as any}
          rowProps={{}}
          onScroll={handleScroll}
          onRowsRendered={({ stopIndex }: any) => {
            if (onReachBottom && stopIndex >= data.length - 20) {
              onReachBottom();
            }
          }}
          className="react-window-list overflow-auto"
          style={{ width: '100%', height: '100%' }}
        />
        
        {isLoadingMore && (
          <div className="absolute bottom-4 right-4 bg-accent/80 text-white px-3 py-1 rounded-full text-[10px] animate-pulse flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping"></span>
            Loading more...
          </div>
        )}
      </div>
    </div>
  );
};
