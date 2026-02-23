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
  activeDatabase: string | null;
  activeSchema: string | null;
  activeTable: string | null;
  savedConnections: SavedConnection[];
  databases: string[];
  
  // Tab state
  tabs: Tab[];
  activeTabId: string | null;

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
  activeDatabase: null,
  activeSchema: null,
  activeTable: null,
  savedConnections: loadConnectionsFromStorage(),
  tabs: [],
  activeTabId: null,
  queryHistory: loadHistoryFromStorage(),
  refreshTrigger: 0,
  databases: [],
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
    return { 
      activeConnectionId: id, 
      activeDatabase: conn?.database || null, 
      databases: [],
      tabs: [], 
      activeTabId: null 
    };
  }),
  setActiveDatabase: async (db) => {
    const state = useDatabaseStore.getState();
    if (state.activeConnectionId && db) {

      try {
        await invoke('switch_database', { connectionId: state.activeConnectionId, dbName: db });

      } catch (err) {

      }
    }

    set((state) => {

      // Close tabs related to tables of the previous database for this connection
      const newTabs = state.tabs.filter(t => t.type !== 'table' || t.connectionId !== state.activeConnectionId);
      
      let newActiveTabId = state.activeTabId;
      if (newActiveTabId && !newTabs.find(t => t.id === newActiveTabId)) {
        newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
      }

      return { 
        activeDatabase: db, 
        activeTable: null,
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
  setActiveSchema: (schema) => set({ activeSchema: schema }),
  setActiveTable: (table) => set({ activeTable: table }),
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
        return { activeTabId: existing.id, activeTable: tabData.tableName };
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
    return { 
      tabs: [...state.tabs, newTab], 
      activeTabId: id,
      activeTable: tabData.type === 'table' ? (tabData.tableName || state.activeTable) : null
    };
  }),

  closeTab: (id) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== id);
    let newActiveId = state.activeTabId;
    if (newActiveId === id) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }
    
    // Find the new active table if we switched tabs
    const activeTab = newTabs.find(t => t.id === newActiveId);
    
    return { 
      tabs: newTabs, 
      activeTabId: newActiveId,
      activeTable: activeTab?.tableName || null
    };
  }),

  setActiveTabId: (id) => set((state) => {
    const tab = state.tabs.find(t => t.id === id);
    return { 
      activeTabId: id, 
      activeTable: tab?.tableName || null 
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
