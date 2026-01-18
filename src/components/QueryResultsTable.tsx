import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';

interface QueryResultsTableProps {
  columns: string[];
  data: any[][];
}

export const QueryResultsTable = ({ columns: columnNames, data }: QueryResultsTableProps) => {
  const columns = useMemo(() => {
    const helper = createColumnHelper<any[]>();
    return columnNames.map((name, index) => 
      helper.accessor(row => row[index], {
        id: name,
        header: name,
        cell: info => {
          const value = info.getValue();
          return (
            <span className="cursor-text">
              {value === null ? (
                <span className="text-text-muted italic">NULL</span>
              ) : typeof value === 'boolean' ? (
                value ? 'true' : 'false'
              ) : (
                String(value)
              )}
            </span>
          );
        },
      })
    );
  }, [columnNames]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (columnNames.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        No results to display
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]" style={{ minWidth: 'max-content' }}>
          <thead className="sticky top-0 z-10 bg-[#2C2C2C] border-b border-[#3C3C3C] shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                <th className="w-10 px-2 py-1.5 border-r border-[#3C3C3C] text-text-muted font-normal text-center">#</th>
                {headerGroup.headers.map(header => (
                  <th 
                    key={header.id}
                    className="px-3 py-1.5 text-left font-semibold text-text-secondary border-r border-[#3C3C3C] min-w-[120px] truncate"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, index) => (
              <tr 
                key={row.id}
                className="hover:bg-accent/5 border-b border-[#2C2C2C] group transition-colors"
              >
                <td className="px-2 py-1 border-r border-[#3C3C3C] text-center text-text-muted group-hover:bg-accent/10 transition-colors">
                  {index + 1}
                </td>
                {row.getVisibleCells().map(cell => (
                  <td 
                    key={cell.id}
                    className="px-3 py-1 border-r border-[#3C3C3C] truncate whitespace-nowrap"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
