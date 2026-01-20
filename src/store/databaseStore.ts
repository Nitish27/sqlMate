import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type TabType = 'table' | 'query' | 'structure' | 'history';

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
}

interface DatabaseState {
  activeConnectionId: string | null;
  activeDatabase: string | null;
  activeSchema: string | null;
  activeTable: string | null;
  savedConnections: Array<{ 
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
  }>;
  databases: string[];
  
  // Tab state
  tabs: Tab[];
  activeTabId: string | null;

  // UI state
  showConnectionModal: boolean;
  showDatabaseSelector: boolean;
  safeMode: 'Silent' | 'Alert' | 'Safe';
  activePanels: {
    sidebar: boolean;
    right: boolean;
    console: boolean;
  };
  prefilledConfig: any | null;
  connectionModalMode: 'manual' | 'url';
  sidebarSearchTerm: string;

  setActiveConnection: (id: string | null) => void;
  setActiveDatabase: (db: string | null) => Promise<void>;
  setDatabases: (dbs: string[]) => void;
  setSafeMode: (mode: 'Silent' | 'Alert' | 'Safe') => void;
  togglePanel: (panel: 'sidebar' | 'right' | 'console') => void;
  setActiveSchema: (schema: string | null) => void;
  setActiveTable: (table: string | null) => void;
  addConnection: (connection: any) => void;
  
  // Tab actions
  openTab: (tab: Omit<Tab, 'id'>) => void;
  closeTab: (id: string) => void;
  setActiveTabId: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  setSelectedRow: (tabId: string, rowIndex: number | null) => void;
  
  // Refresh mechanism
  refreshTrigger: number;
  triggerRefresh: () => void;

  // UI state
  setShowConnectionModal: (show: boolean) => void;
  setShowDatabaseSelector: (show: boolean) => void;
  setPrefilledConfig: (config: any | null) => void;
  setConnectionModalMode: (mode: 'manual' | 'url') => void;
  setSidebarSearchTerm: (term: string) => void;
}

export const useDatabaseStore = create<DatabaseState>((set) => ({
  activeConnectionId: null,
  activeDatabase: null,
  activeSchema: null,
  activeTable: null,
  savedConnections: [
    { id: 'test-id', name: 'Localhost (SQLite)', type: 'Sqlite', color: 'blue' }
  ],
  tabs: [],
  activeTabId: null,
  refreshTrigger: 0,
  databases: [],
  showConnectionModal: false,
  showDatabaseSelector: false,
  safeMode: 'Silent',
  activePanels: {
    sidebar: true,
    right: false,
    console: false,
  },
  prefilledConfig: null,
  connectionModalMode: 'manual',
  sidebarSearchTerm: '',
  
  triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),
  setShowConnectionModal: (show) => set({ showConnectionModal: show }),
  setShowDatabaseSelector: (show) => set({ showDatabaseSelector: show }),

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
  addConnection: (conn) => set((state) => ({ savedConnections: [...state.savedConnections, conn] })),

  openTab: (tabData) => set((state) => {
    // If it's a table tab and already open, just switch to it
    if (tabData.type === 'table') {
      const existing = state.tabs.find(t => t.type === 'table' && t.tableName === tabData.tableName && t.connectionId === tabData.connectionId);
      if (existing) {
        return { activeTabId: existing.id, activeTable: tabData.tableName };
      }
    }

    const id = Math.random().toString(36).substring(7);
    const newTab: Tab = { 
      ...tabData, 
      id,
      pageSize: 100,
      offset: 0,
      totalRows: 0
    };
    return { 
      tabs: [...state.tabs, newTab], 
      activeTabId: id,
      activeTable: tabData.tableName || state.activeTable
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
  setPrefilledConfig: (config) => set({ prefilledConfig: config }),
  setConnectionModalMode: (mode) => set({ connectionModalMode: mode }),
  setSidebarSearchTerm: (term) => set({ sidebarSearchTerm: term }),
}));
