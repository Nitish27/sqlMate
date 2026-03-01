import { useState, useMemo, useEffect } from 'react';
import { useDatabaseStore, SidebarItem, SidebarItemType } from '../store/databaseStore';
import { Layout, Eye, Code, FileCode, ChevronDown, ChevronRight, Search, Pin, PinOff, Settings } from 'lucide-react';

interface TreeItemProps {
  item: SidebarItem;
  onClick: (item: SidebarItem) => void;
  onPin: (itemName: string) => void;
  isPinned: boolean;
  isActive: boolean;
}

const TreeItem = ({ item, onClick, onPin, isPinned, isActive }: TreeItemProps) => {
  const Icon = item.item_type === 'Table' ? Layout : item.item_type === 'View' ? Eye : item.item_type === 'Function' ? Code : FileCode;

  return (
    <div 
      className={`group flex items-center gap-2 px-6 py-1 cursor-pointer text-[11px] transition-colors ${
        isActive 
          ? 'bg-accent/20 text-accent font-medium' 
          : 'text-text-secondary hover:bg-[#2C2C2C] hover:text-text-primary'
      }`}
      onClick={() => onClick(item)}
    >
      <Icon size={12} className={`shrink-0 ${isActive ? 'text-accent opacity-100' : 'opacity-50 group-hover:opacity-100'}`} />
      <span className="truncate flex-1">{item.name}</span>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onPin(item.name);
        }}
        className={`opacity-0 group-hover:opacity-100 p-0.5 hover:text-accent transition-all ${isPinned ? 'opacity-100 text-accent' : ''}`}
        title={isPinned ? "Unpin from top" : "Pin to top"}
      >
        {isPinned ? <PinOff size={10} /> : <Pin size={10} />}
      </button>
    </div>
  );
};

interface TreeSectionProps {
  title: string;
  items: SidebarItem[];
  isOpen: boolean;
  onToggle: () => void;
  onItemClick: (item: SidebarItem) => void;
  onPin: (itemName: string) => void;
  pinnedItems: string[];
  activeItemName: string | null;
}

const TreeSection = ({ title, items, isOpen, onToggle, onItemClick, onPin, pinnedItems, activeItemName }: TreeSectionProps) => {
  if (items.length === 0) return null;

  return (
    <div className="mb-2">
      <button 
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold text-text-muted hover:text-text-primary uppercase tracking-wider group"
      >
        {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>{title} ({items.length})</span>
      </button>
      
      {isOpen && (
        <div className="mt-0.5">
          {items.map(item => (
            <TreeItem 
              key={`${item.name}-${item.item_type}`}
              item={item} 
              onClick={onItemClick} 
              onPin={onPin}
              isPinned={pinnedItems.includes(item.name)}
              isActive={activeItemName === item.name}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const SidebarTree = () => {
  const { 
    selectedConnectionId, 
    sidebarItems, 
    sidebarSettings, 
    toggleSidebarSetting,
    pinnedItems, 
    togglePinnedItem,
    sidebarSearchTerm,
    setSidebarSearchTerm,
    openTab,
    activeDatabase,
    activeTable,
    showDbName,
    setShowDbName,
    showConnectionName,
    setShowConnectionName,
    refreshTrigger,
    fetchSidebarItems
  } = useDatabaseStore();

  useEffect(() => {
    if (selectedConnectionId) {
      fetchSidebarItems(selectedConnectionId);
    }
  }, [selectedConnectionId, refreshTrigger, fetchSidebarItems]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Table: true,
    View: true,
    Function: false,
    Procedure: false,
    Pinned: true
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  // Database switching fix walkthrough:
  // - **`databaseStore.ts`**:
  //   - Added state for `openConnectionIds` (connections in the rail) and `selectedConnectionId`.
  //   - **Connection-Aware Context**: Implemented `activeDatabases` and `activeTables` mappings. This ensures that switching connections correctly restores the active database and table for that specific connection context.
  //   - Updated `setActiveConnection` and `selectConnection` to synchronize the backend database state automatically upon switching.
  //   - Added `sidebarItems` storage per connection.
  // This comment block describes changes made to `databaseStore.ts` to support database switching.

  const currentSettings = selectedConnectionId ? sidebarSettings[selectedConnectionId] : null;

  const currentItems = useMemo(() => {
    if (!selectedConnectionId) return [];
    let items = sidebarItems[selectedConnectionId] || [];
    
    // Apply settings filters
    if (currentSettings) {
      if (!currentSettings.showFunctions) {
        items = items.filter(i => i.item_type !== 'Function' && i.item_type !== 'Procedure');
      }
      // Add more filters (system schemas, etc.) if needed
    }

    if (!sidebarSearchTerm) return items;
    
    const term = sidebarSearchTerm.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(term));
  }, [sidebarItems, selectedConnectionId, sidebarSearchTerm, currentSettings]);

  const sections = useMemo(() => {
    const grouped = {
      Table: [] as SidebarItem[],
      View: [] as SidebarItem[],
      Function: [] as SidebarItem[],
      Procedure: [] as SidebarItem[],
      Pinned: [] as SidebarItem[]
    };

    const pinnedNames = pinnedItems[selectedConnectionId || ''] || [];
    
    currentItems.forEach(item => {
      if (pinnedNames.includes(item.name)) {
        grouped.Pinned.push(item);
      }
      grouped[item.item_type as SidebarItemType].push(item);
    });

    return grouped;
  }, [currentItems, pinnedItems, selectedConnectionId]);

  const handleItemClick = (item: SidebarItem) => {
    if (!selectedConnectionId) return;
    
    if (item.item_type === 'Table' || item.item_type === 'View') {
      openTab({
        type: 'table',
        title: item.name,
        tableName: item.name,
        connectionId: selectedConnectionId,
        database: activeDatabase || undefined,
        viewMode: 'data'
      });
    }
  };

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  if (!selectedConnectionId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center text-text-muted italic text-xs">
        Select a connection to browse objects
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e] relative">
      <div className="p-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search tables, views..."
            value={sidebarSearchTerm}
            onChange={(e) => setSidebarSearchTerm(e.target.value)}
            className="w-full bg-[#2C2C2C] border border-[#3C3C3C] rounded px-8 py-1.5 text-[11px] focus:outline-none focus:border-accent/50 placeholder:text-text-muted/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 custom-scrollbar">
        <TreeSection 
          title="Pinned" 
          items={sections.Pinned} 
          isOpen={openSections.Pinned}
          onToggle={() => toggleSection('Pinned')}
          onItemClick={handleItemClick}
          onPin={(name) => togglePinnedItem(selectedConnectionId, name)}
          pinnedItems={pinnedItems[selectedConnectionId] || []}
          activeItemName={activeTable}
        />

        {sections.Pinned.length > 0 && <div className="mx-3 h-[1px] bg-[#2C2C2C] my-2" />}

        <TreeSection 
          title="Tables" 
          items={sections.Table} 
          isOpen={openSections.Table}
          onToggle={() => toggleSection('Table')}
          onItemClick={handleItemClick}
          onPin={(name) => togglePinnedItem(selectedConnectionId, name)}
          pinnedItems={pinnedItems[selectedConnectionId] || []}
          activeItemName={activeTable}
        />

        <TreeSection 
          title="Views" 
          items={sections.View} 
          isOpen={openSections.View}
          onToggle={() => toggleSection('Views')}
          onItemClick={handleItemClick}
          onPin={(name) => togglePinnedItem(selectedConnectionId, name)}
          pinnedItems={pinnedItems[selectedConnectionId] || []}
          activeItemName={activeTable}
        />

        <TreeSection 
          title="Functions" 
          items={sections.Function} 
          isOpen={openSections.Function}
          onToggle={() => toggleSection('Functions')}
          onItemClick={handleItemClick}
          onPin={(name) => togglePinnedItem(selectedConnectionId, name)}
          pinnedItems={pinnedItems[selectedConnectionId] || []}
          activeItemName={activeTable}
        />

        <TreeSection 
          title="Procedures" 
          items={sections.Procedure} 
          isOpen={openSections.Procedure}
          onToggle={() => toggleSection('Procedures')}
          onItemClick={handleItemClick}
          onPin={(name) => togglePinnedItem(selectedConnectionId, name)}
          pinnedItems={pinnedItems[selectedConnectionId] || []}
          activeItemName={activeTable}
        />
      </div>

      {/* Bottom Settings Bar */}
      <div className="mt-auto border-t border-[#2C2C2C] bg-[#1e1e1e] p-1.5 flex items-center justify-between">
        <button 
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`p-1.5 rounded hover:bg-[#2C2C2C] transition-colors ${settingsOpen ? 'text-accent' : 'text-text-muted'}`}
          title="Sidebar Settings"
        >
          <Settings size={14} />
        </button>
        
        {settingsOpen && (
          <div className="absolute bottom-10 left-2 w-56 bg-[#2C2C2C] border border-[#3C3C3C] rounded-md shadow-2xl z-50 py-2 animate-in slide-in-from-bottom-2 duration-150">
            <div className="px-3 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Display Settings</div>
            
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] cursor-pointer text-[11px]">
              <input 
                type="checkbox" 
                checked={showConnectionName} 
                onChange={(e) => setShowConnectionName(e.target.checked)}
                className="rounded border-[#3C3C3C] bg-[#1e1e1e] text-accent focus:ring-accent"
              />
              Show Connection Name
            </label>
            
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] cursor-pointer text-[11px]">
              <input 
                type="checkbox" 
                checked={showDbName} 
                onChange={(e) => setShowDbName(e.target.checked)}
                className="rounded border-[#3C3C3C] bg-[#1e1e1e] text-accent focus:ring-accent"
              />
              Show Database Name
            </label>

            <div className="mx-2 h-[1px] bg-[#3C3C3C] my-1" />
            <div className="px-3 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Object Visibility</div>

            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] cursor-pointer text-[11px]">
              <input 
                type="checkbox" 
                checked={currentSettings?.showFunctions || false} 
                onChange={() => toggleSidebarSetting(selectedConnectionId, 'showFunctions')}
                className="rounded border-[#3C3C3C] bg-[#1e1e1e] text-accent focus:ring-accent"
              />
              Show Functions
            </label>

            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] cursor-pointer text-[11px]">
              <input 
                type="checkbox" 
                checked={currentSettings?.showRecent || false} 
                onChange={() => toggleSidebarSetting(selectedConnectionId, 'showRecent')}
                className="rounded border-[#3C3C3C] bg-[#1e1e1e] text-accent focus:ring-accent"
              />
              Show Recent
            </label>

            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] cursor-pointer text-[11px]">
              <input 
                type="checkbox" 
                checked={currentSettings?.showSystem || false} 
                onChange={() => toggleSidebarSetting(selectedConnectionId, 'showSystem')}
                className="rounded border-[#3C3C3C] bg-[#1e1e1e] text-accent focus:ring-accent"
              />
              Show System Schemas
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
