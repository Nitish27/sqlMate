import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';

export type TabType = 'table' | 'query' | 'structure';

export interface FilterConfig {
  id: string;
  column: string;
  operator: string;
  value: string;
  enabled: boolean;
}

export interface SortConfig {
  column: string | null;
  direction: 'ASC' | 'DESC';
}

export interface TableColumnStructure {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  comment: string | null;
}

export type SidebarItemType = 'Table' | 'View' | 'Function' | 'Procedure';

export interface SidebarItem {
  name: string;
  item_type: SidebarItemType;
  schema?: string;
}

export interface SidebarSettings {
  showFunctions: boolean;
  showRecent: boolean;
  showSystem: boolean;
}

export interface TableIndexStructure {
  name: string;
  columns: string[];
  is_unique: boolean;
  index_type: string;
}

export interface TableConstraintStructure {
  name: string;
  constraint_type: string;
  definition: string;
}

export interface TableStructure {
  columns: TableColumnStructure[];
  indexes: TableIndexStructure[];
  constraints: TableConstraintStructure[];
}

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  tableName?: string;
  connectionId: string;
  database?: string;
  query?: string;
  selectedRowIndex?: number | null;
  columns?: string[];
  rows?: any[][];
  pageSize?: number;
  offset?: number;
  totalRows?: number;
  filters?: FilterConfig[];
  isFilterVisible?: boolean;
  sortConfig?: SortConfig;
  hiddenColumns?: string[];
  isColumnsPopoverVisible?: boolean;
  viewMode?: 'data' | 'structure' | 'message';
  tableStructure?: TableStructure;
  messages?: string[];
  elapsedTime?: number;
  stats?: {
    time: number;
    rows: number;
    totalRows?: number;
  } | null;
}

export interface HistoryItem {
  id: string;
  sql: string;
  timestamp: number;
  connectionId: string;
  database?: string;
  executionTimeMs?: number;
  rowsAffected?: number;
}

// Saved connection type for persistence
export interface SavedConnection {
  id: string;
  name: string;
  type: 'Postgres' | 'MySql' | 'Sqlite';
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  ssl_enabled?: boolean;
  ssl_mode?: string;
  ssl_ca_path?: string;
  ssl_cert_path?: string;
  ssl_key_path?: string;
  ssh_enabled?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  ssh_auth_method?: 'password' | 'key';
  ssh_password?: string;
  ssh_private_key_path?: string;
  environment?: 'local' | 'test' | 'dev' | 'staging' | 'production';
  color: string;
}

// Helper to persist connections to localStorage
const saveConnectionsToStorage = (connections: SavedConnection[]) => {
  localStorage.setItem('sqlmate_saved_connections', JSON.stringify(connections));
};

// Helper to load connections from localStorage
const loadConnectionsFromStorage = (): SavedConnection[] => {
  try {
    const saved = localStorage.getItem('sqlmate_saved_connections') || localStorage.getItem('oxide_saved_connections');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.error('Failed to load connections:', e);
    return [];
  }
};

const loadHistoryFromStorage = (): HistoryItem[] => {
  try {
    const saved = localStorage.getItem('sqlmate_query_history') || localStorage.getItem('oxide_query_history');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.error('Failed to load history:', e);
    return [];
  }
};

interface DatabaseState {
  activeConnectionId: string | null;
  openConnectionIds: string[];
  selectedConnectionId: string | null;
  activeDatabase: string | null;
  activeTable: string | null;
  activeSchema: string | null;
  activeDatabases: Record<string, string | null>; // Connection ID -> Database Name
  activeTables: Record<string, string | null>;    // Connection ID -> Table Name
  savedConnections: SavedConnection[];
  sidebarItems: Record<string, SidebarItem[]>;
  sidebarSettings: Record<string, SidebarSettings>;
  pinnedItems: Record<string, string[]>;
  databases: string[];
  showDbName: boolean;
  showConnectionName: boolean;
  
  // Tab state
  tabs: Tab[];
  activeTabId: string | null;
  activeTabIds: Record<string, string | null>; // Connection ID -> Active Tab ID

  // Query History
  queryHistory: HistoryItem[];

  // UI state
  showConnectionModal: boolean;
  showDatabaseSelector: boolean;
  showImportDialog: boolean;
  showExportDialog: boolean;
  safeMode: 'Silent' | 'Alert' | 'Safe';
  activePanels: {
    sidebar: boolean;
    right: boolean;
    console: boolean;
  };
  prefilledConfig: any | null;
  connectionModalMode: 'manual' | 'url';
  sidebarSearchTerm: string;
  sidebarViewMode: 'items' | 'queries' | 'history';
  theme: 'dark' | 'light';

  setActiveConnection: (id: string | null) => void;
  selectConnection: (id: string) => void;
  closeConnectionFromRail: (id: string) => void;
  fetchSidebarItems: (id: string) => Promise<void>;
  toggleSidebarSetting: (connId: string, setting: keyof SidebarSettings) => void;
  togglePinnedItem: (connId: string, itemName: string) => void;
  setShowDbName: (show: boolean) => void;
  setShowConnectionName: (show: boolean) => void;
  setActiveDatabase: (db: string | null) => Promise<void>;
  setDatabases: (dbs: string[]) => void;
  setSafeMode: (mode: 'Silent' | 'Alert' | 'Safe') => void;
  togglePanel: (panel: 'sidebar' | 'right' | 'console') => void;
  setActiveSchema: (schema: string | null) => void;
  setActiveTable: (table: string | null) => void;
  addConnection: (connection: SavedConnection) => void;
  updateConnection: (id: string, updates: Partial<SavedConnection>) => void;
  removeConnection: (id: string) => void;
  setSidebarViewMode: (mode: 'items' | 'queries' | 'history') => void;
  setTheme: (theme: 'dark' | 'light') => void;
  
  // Tab actions
  openTab: (tab: Omit<Tab, 'id'>) => void;
  closeTab: (id: string) => void;
  setActiveTabId: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  setSelectedRow: (tabId: string, rowIndex: number | null) => void;
  
  // Filter actions
  addFilter: (tabId: string, filter: FilterConfig) => void;
  removeFilter: (tabId: string, filterId: string) => void;
  updateFilter: (tabId: string, filterId: string, updates: Partial<FilterConfig>) => void;
  toggleFilterBar: (tabId: string) => void;
  setFilters: (tabId: string, filters: FilterConfig[]) => void;

  // Sort actions
  setSortConfig: (tabId: string, config: SortConfig) => void;
  clearSort: (tabId: string) => void;

  // Column visibility actions
  toggleColumnVisibility: (tabId: string, column: string) => void;
  showAllColumns: (tabId: string) => void;
  hideAllColumns: (tabId: string, columns: string[]) => void;
  toggleColumnsPopover: (tabId: string) => void;
  setViewMode: (tabId: string, mode: 'data' | 'structure') => void;
  setTableStructure: (tabId: string, structure: TableStructure) => void;

  // History actions
  addToHistory: (item: Omit<HistoryItem, 'id' | 'timestamp'>) => void;

  // Refresh mechanism
  refreshTrigger: number;
  triggerRefresh: () => void;

  // UI state
  setShowConnectionModal: (show: boolean) => void;
  setShowDatabaseSelector: (show: boolean) => void;
  setShowImportDialog: (show: boolean) => void;
  setShowExportDialog: (show: boolean) => void;
  setPrefilledConfig: (config: any | null) => void;
  setConnectionModalMode: (mode: 'manual' | 'url') => void;
  setSidebarSearchTerm: (term: string) => void;
}

export const useDatabaseStore = create<DatabaseState>((set) => ({
  activeConnectionId: null,
  openConnectionIds: [],
  selectedConnectionId: null,
  activeDatabase: null,
  activeTable: null,
  activeDatabases: {},
  activeTables: {},
  savedConnections: loadConnectionsFromStorage(),
  sidebarItems: {},
  sidebarSettings: {},
  pinnedItems: {},
  databases: [],
  showDbName: true,
  showConnectionName: true,
  tabs: [],
  activeTabId: null,
  activeTabIds: {},
  queryHistory: loadHistoryFromStorage(),
  refreshTrigger: 0,
  showConnectionModal: false,
  showDatabaseSelector: false,
  showImportDialog: false,
  showExportDialog: false,
  safeMode: 'Silent',
  activePanels: {
    sidebar: true,
    right: false,
    console: false,
  },
  prefilledConfig: null,
  connectionModalMode: 'manual',
  sidebarSearchTerm: '',
  sidebarViewMode: 'items',
  theme: 'dark',
  
  setTheme: (theme) => set({ theme }),
  
  triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),
  setShowConnectionModal: (show) => set({ showConnectionModal: show }),
  setShowDatabaseSelector: (show) => set({ showDatabaseSelector: show }),
  setShowImportDialog: (show) => set({ showImportDialog: show }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),

  addToHistory: (item) => set((state) => {
    const newItem: HistoryItem = {
      ...item,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now()
    };
    const newHistory = [newItem, ...state.queryHistory].slice(0, 100);
    localStorage.setItem('sqlmate_query_history', JSON.stringify(newHistory));
    return {
      queryHistory: newHistory
    };
  }),

  setActiveConnection: (id) => set((state) => {
    const conn = state.savedConnections.find(c => c.id === id);
    const openIds = id ? (state.openConnectionIds.includes(id) ? state.openConnectionIds : [...state.openConnectionIds, id]) : state.openConnectionIds;
    
    // Restore connection-specific database and table context
    const restoredDb = id ? state.activeDatabases[id] || conn?.database || null : null;
    const restoredTable = id ? state.activeTables[id] || null : null;
    const restoredTabId = id ? state.activeTabIds[id] || null : null;

    if (id) {
       // Proactively switch database in backend if needed
       if (restoredDb) {
         invoke('switch_database', { connectionId: id, dbName: restoredDb }).catch(() => {});
       }
       useDatabaseStore.getState().fetchSidebarItems(id);
    }

    return { 
      activeConnectionId: id,
      selectedConnectionId: id,
      openConnectionIds: openIds,
      activeDatabase: restoredDb,
      activeTable: restoredTable,
      activeTabId: restoredTabId,
      databases: [],
      tabs: state.tabs,
    };
  }),

  selectConnection: (id) => set((state) => {
    const conn = state.savedConnections.find(c => c.id === id);
    const restoredDb = state.activeDatabases[id] || conn?.database || null;
    const restoredTable = state.activeTables[id] || null;
    const restoredTabId = state.activeTabIds[id] || null;

    if (restoredDb) {
      invoke('switch_database', { connectionId: id, dbName: restoredDb }).catch(() => {});
    }

    return { 
      selectedConnectionId: id, 
      activeConnectionId: id,
      activeDatabase: restoredDb,
      activeTable: restoredTable,
      activeTabId: restoredTabId
    };
  }),

  closeConnectionFromRail: (id) => set((state) => {
    const newOpenIds = state.openConnectionIds.filter(oid => oid !== id);
    let newSelectedId = state.selectedConnectionId;
    if (newSelectedId === id) {
      newSelectedId = newOpenIds.length > 0 ? newOpenIds[newOpenIds.length - 1] : null;
    }
    return { 
      openConnectionIds: newOpenIds,
      selectedConnectionId: newSelectedId,
      activeConnectionId: newSelectedId
    };
  }),

  fetchSidebarItems: async (id) => {
    try {
      const items = await invoke('get_sidebar_items', { connectionId: id }) as SidebarItem[];
      set((state) => ({
        sidebarItems: { ...state.sidebarItems, [id]: items },
        sidebarSettings: {
          ...state.sidebarSettings,
          [id]: state.sidebarSettings[id] || { showFunctions: true, showRecent: true, showSystem: false }
        }
      }));
    } catch (err) {
      console.error('Failed to fetch sidebar items:', err);
    }
  },

  toggleSidebarSetting: (connId, setting) => set((state) => ({
    sidebarSettings: {
      ...state.sidebarSettings,
      [connId]: {
        ...state.sidebarSettings[connId],
        [setting]: !state.sidebarSettings[connId][setting]
      }
    }
  })),

  togglePinnedItem: (connId, itemName) => set((state) => {
    const currentPinned = state.pinnedItems[connId] || [];
    const newPinned = currentPinned.includes(itemName)
      ? currentPinned.filter(i => i !== itemName)
      : [...currentPinned, itemName];
    return {
      pinnedItems: { ...state.pinnedItems, [connId]: newPinned }
    };
  }),

  setShowDbName: (show) => set({ showDbName: show }),
  setShowConnectionName: (show) => set({ showConnectionName: show }),
  setActiveDatabase: async (db) => {
    const { activeConnectionId } = useDatabaseStore.getState();
    if (activeConnectionId && db) {
      try {
        await invoke('switch_database', { connectionId: activeConnectionId, dbName: db });
      } catch (err) {
        console.error('Failed to switch database:', err);
      }
    }

    set((state) => {
      // Close tabs related to tables of the previous database for this connection
      const newTabs = state.tabs.filter(t => t.type !== 'table' || t.connectionId !== state.activeConnectionId);
      
      let newActiveTabId = state.activeTabId;
      if (newActiveTabId && !newTabs.find(t => t.id === newActiveTabId)) {
        newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
      }

      const activeConnId = state.activeConnectionId;
      const newActiveDatabases = activeConnId ? { ...state.activeDatabases, [activeConnId]: db } : state.activeDatabases;
      const newActiveTables = activeConnId ? { ...state.activeTables, [activeConnId]: null } : state.activeTables;

      return { 
        activeDatabase: db, 
        activeTable: null,
        activeDatabases: newActiveDatabases,
        activeTables: newActiveTables,
        tabs: newTabs,
        activeTabId: newActiveTabId
      };
    });
  },
  setDatabases: (dbs) => set({ databases: dbs }),
  setSafeMode: (mode) => set({ safeMode: mode }),
  togglePanel: (panel) => set((state) => ({
    activePanels: {
      ...state.activePanels,
      [panel]: !state.activePanels[panel]
    }
  })),
  activeSchema: null, // Placeholder if still needed for UI
  setActiveSchema: (schema) => set({ activeSchema: schema }),
  setActiveTable: (table) => set((state) => {
    const activeConnId = state.activeConnectionId;
    const newActiveTables = activeConnId ? { ...state.activeTables, [activeConnId]: table } : state.activeTables;
    return {
      activeTable: table,
      activeTables: newActiveTables
    };
  }),
  addConnection: (conn) => set((state) => {
    const newConnections = [...state.savedConnections, conn];
    saveConnectionsToStorage(newConnections);
    return { savedConnections: newConnections };
  }),

  updateConnection: (id, updates) => set((state) => {
    const newConnections = state.savedConnections.map(c =>
      c.id === id ? { ...c, ...updates } : c
    );
    saveConnectionsToStorage(newConnections);
    return { savedConnections: newConnections };
  }),

  removeConnection: (id) => set((state) => {
    const newConnections = state.savedConnections.filter(c => c.id !== id);
    saveConnectionsToStorage(newConnections);
    return { savedConnections: newConnections };
  }),

  openTab: (tabData) => set((state) => {
    // If it's a table tab and already open, just switch to it
    if (tabData.type === 'table') {
      const existing = state.tabs.find(t => t.type === 'table' && t.tableName === tabData.tableName && t.connectionId === tabData.connectionId);
      if (existing) {
        const newActiveTabIds = { ...state.activeTabIds, [tabData.connectionId]: existing.id };
        return { 
          activeTabId: existing.id, 
          activeTable: tabData.tableName,
          activeTabIds: newActiveTabIds
        };
      }
    }

    const id = uuidv4();
    const newTab: Tab = { 
      ...tabData, 
      id,
      pageSize: 100,
      offset: 0,
      totalRows: 0,
      filters: [],
      isFilterVisible: false
    };

    const newTabs = [...state.tabs, newTab];
    const newActiveTabIds = { ...state.activeTabIds, [tabData.connectionId]: id };

    return { 
      tabs: newTabs, 
      activeTabId: id,
      activeTabIds: newActiveTabIds,
      activeTable: tabData.type === 'table' ? (tabData.tableName || state.activeTable) : null
    };
  }),

  closeTab: (id) => set((state) => {
    const tabToClose = state.tabs.find(t => t.id === id);
    if (!tabToClose) return state;

    const newTabs = state.tabs.filter(t => t.id !== id);
    const connId = tabToClose.connectionId;
    
    let newActiveId = state.activeTabId;
    let newActiveTabIds = { ...state.activeTabIds };

    if (state.activeTabId === id) {
      const otherTabsForConn = newTabs.filter(t => t.connectionId === connId);
      newActiveId = otherTabsForConn.length > 0 ? otherTabsForConn[otherTabsForConn.length - 1].id : null;
      newActiveTabIds[connId] = newActiveId;
    }

    // Synchronize background connections
    Object.keys(newActiveTabIds).forEach(cid => {
      if (newActiveTabIds[cid] === id) {
        const connTabs = newTabs.filter(t => t.connectionId === cid);
        newActiveTabIds[cid] = connTabs.length > 0 ? connTabs[connTabs.length - 1].id : null;
      }
    });

    const currentConnActiveId = state.activeConnectionId === connId ? newActiveId : state.activeTabId;
    const activeTab = newTabs.find(t => t.id === currentConnActiveId);
    
    return { 
      tabs: newTabs, 
      activeTabId: currentConnActiveId,
      activeTabIds: newActiveTabIds,
      activeTable: activeTab?.tableName || null
    };
  }),

  setActiveTabId: (id) => set((state) => {
    const tab = state.tabs.find(t => t.id === id);
    if (!tab) return state;

    const newActiveTabIds = { ...state.activeTabIds, [tab.connectionId]: id };

    return { 
      activeTabId: id,
      activeTabIds: newActiveTabIds,
      activeTable: tab.type === 'table' ? tab.tableName || null : state.activeTable
    };
  }),

  updateTab: (id, updates) => set((state) => ({
    tabs: state.tabs.map(t => t.id === id ? { ...t, ...updates } : t)
  })),
  setSelectedRow: (tabId, rowIndex) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, selectedRowIndex: rowIndex } : t)
  })),

  // Filter actions implementation
  addFilter: (tabId, filter) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { 
      ...t, 
      filters: [...(t.filters || []), filter] 
    } : t)
  })),
  
  removeFilter: (tabId, filterId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { 
      ...t, 
      filters: (t.filters || []).filter(f => f.id !== filterId) 
    } : t)
  })),
  
  updateFilter: (tabId, filterId, updates) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { 
      ...t, 
      filters: (t.filters || []).map(f => f.id === filterId ? { ...f, ...updates } : f) 
    } : t)
  })),
  
  toggleFilterBar: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { 
      ...t, 
      isFilterVisible: !t.isFilterVisible 
    } : t)
  })),
  
  setFilters: (tabId, filters) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, filters } : t)
  })),

  // Sort actions
  setSortConfig: (tabId, config) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, sortConfig: config } : t)
  })),

  clearSort: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, sortConfig: undefined } : t)
  })),

  // Column visibility actions
  toggleColumnVisibility: (tabId, column) => set((state) => ({
    tabs: state.tabs.map(t => {
      if (t.id !== tabId) return t;
      const hidden = t.hiddenColumns || [];
      const isHidden = hidden.includes(column);
      return {
        ...t,
        hiddenColumns: isHidden 
          ? hidden.filter(c => c !== column)
          : [...hidden, column]
      };
    })
  })),

  showAllColumns: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, hiddenColumns: [] } : t)
  })),

  hideAllColumns: (tabId, columns) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, hiddenColumns: columns } : t)
  })),

  toggleColumnsPopover: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, isColumnsPopoverVisible: !t.isColumnsPopoverVisible } : t)
  })),

  setViewMode: (tabId, mode) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, viewMode: mode } : t)
  })),

  setTableStructure: (tabId, structure) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, tableStructure: structure } : t)
  })),

  setPrefilledConfig: (config) => set({ prefilledConfig: config }),
  setConnectionModalMode: (mode) => set({ connectionModalMode: mode }),
  setSidebarSearchTerm: (term) => set({ sidebarSearchTerm: term }),
}));
