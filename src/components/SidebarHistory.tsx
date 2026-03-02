import { useMemo, useState } from 'react';
import { useHistoryStore } from '../store/historyStore';
import { useSchemaStore } from '../store/schemaStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { HistoryItem } from '../store/types';
import { ChevronDown, ChevronRight } from 'lucide-react';

export const SidebarHistory = () => {
  const queryHistory = useHistoryStore(s => s.queryHistory);
  const sidebarSearchTerm = useSchemaStore(s => s.sidebarSearchTerm);
  const openTab = useWorkspaceStore(s => s.openTab);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});

  const toggleDate = (date: string) => {
    setCollapsedDates(prev => ({
      ...prev,
      [date]: !prev[date]
    }));
  };

  const groupedHistory = useMemo(() => {
    const filtered = queryHistory.filter(item => 
      !sidebarSearchTerm || 
      item.sql.toLowerCase().includes(sidebarSearchTerm.toLowerCase())
    );

    const groups: { [date: string]: HistoryItem[] } = {};
    
    filtered.forEach(item => {
      const date = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(new Date(item.timestamp));
      
      if (!groups[date]) groups[date] = [];
      groups[date].push(item);
    });

    return Object.entries(groups).sort((a, b) => {
        // Assume the first item in each group is representative of the group's time
        return b[1][0].timestamp - a[1][0].timestamp;
    });
  }, [queryHistory, sidebarSearchTerm]);

  const handleReplay = (item: HistoryItem) => {
    openTab({
      type: 'query',
      title: 'Query',
      query: item.sql,
      connectionId: item.connectionId,
      database: item.database
    });
  };

  const formatTime = (timestamp: number) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(new Date(timestamp));
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {groupedHistory.length === 0 ? (
        <div className="p-4 text-center text-text-muted text-[11px] italic">
          No history found
        </div>
      ) : (
        <div className="overflow-y-auto overflow-x-hidden flex-1 py-1">
          {groupedHistory.map(([date, items]: [string, HistoryItem[]]) => {
            const isCollapsed = collapsedDates[date];
            return (
              <div key={date} className="mb-2">
                <div 
                  onClick={() => toggleDate(date)}
                  className="flex items-center px-2 py-1 text-[11px] font-bold text-text-primary uppercase tracking-tight opacity-80 cursor-pointer hover:bg-accent/5 transition-colors select-none"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} className="mr-1 text-text-muted" />
                  ) : (
                    <ChevronDown size={14} className="mr-1 text-text-muted" />
                  )}
                  {date}
                </div>
                {!isCollapsed && (
                  <div className="flex flex-col">
                {items.map((item: HistoryItem) => (
                  <div
                    key={item.id}
                    onClick={() => handleReplay(item)}
                    className="group px-4 py-2 hover:bg-accent/10 cursor-pointer transition-colors border-l-2 border-transparent hover:border-accent"
                  >
                    <div className="text-[10px] text-text-muted mb-0.5">
                      {formatTime(item.timestamp)}
                    </div>
                    <div className="text-[11px] font-mono text-text-primary line-clamp-2 break-all opacity-90 group-hover:opacity-100">
                      {item.sql}
                    </div>
                  </div>
                ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
