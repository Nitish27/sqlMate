import { X, Layout, Terminal, Settings } from 'lucide-react';
import { useDatabaseStore, TabType } from '../store/databaseStore';

const TabIcon = ({ type, size = 12 }: { type: TabType; size?: number }) => {
  switch (type) {
    case 'table': return <Layout size={size} />;
    case 'query': return <Terminal size={size} />;
    case 'structure': return <Settings size={size} />;
    default: return <Layout size={size} />;
  }
};

export const TabManager = () => {
  const { tabs, activeTabId, setActiveTabId, closeTab, activeConnectionId } = useDatabaseStore();

  const currentTabs = tabs.filter(t => t.connectionId === activeConnectionId);

  if (currentTabs.length === 0) return null;

  return (
    <div className="h-9 bg-[#2C2C2C] flex items-end px-2 gap-px border-b border-[#1e1e1e] overflow-x-auto no-scrollbar">
      {currentTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`
              group flex items-center gap-2 px-3 py-1.5 min-w-[120px] max-w-[200px] h-7 text-[11px] 
              rounded-t-md transition-all cursor-default select-none relative
              ${isActive ? 'bg-[#1e1e1e] text-text-primary' : 'bg-[#333333] text-text-muted hover:bg-[#383838]'}
            `}
          >
            <span className={isActive ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'}>
              <TabIcon type={tab.type} />
            </span>
            <span className="flex-1 truncate font-medium">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`
                p-0.5 rounded-sm hover:bg-[#444] transition-colors
                ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              `}
            >
              <X size={10} />
            </button>
            {/* Active indicator line */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
            )}
          </div>
        );
      })}
    </div>
  );
};
