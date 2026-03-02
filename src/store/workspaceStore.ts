// Workspace store: tabs, active tab tracking, tab CRUD, filter/sort/column actions.
// Row data (rows field on Tab) is kept for backward compat but should migrate to component-local refs.

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Tab, FilterConfig, SortConfig, TableStructure } from './types';

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  activeTabIds: Record<string, string | null>;

  // Tab actions
  openTab: (tab: Omit<Tab, 'id'>) => void;
  closeTab: (id: string) => void;
  setActiveTabId: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  setSelectedRow: (tabId: string, rowIndex: number | null) => void;
  closeTabsForConnection: (connectionId: string, keepTypes?: string[]) => void;

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
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [],
  activeTabId: null,
  activeTabIds: {},

  openTab: (tabData) => set((state) => {
    // If it's a table tab and already open, just switch to it
    if (tabData.type === 'table') {
      const existing = state.tabs.find(t => t.type === 'table' && t.tableName === tabData.tableName && t.connectionId === tabData.connectionId);
      if (existing) {
        const newActiveTabIds = { ...state.activeTabIds, [tabData.connectionId]: existing.id };
        return {
          activeTabId: existing.id,
          activeTabIds: newActiveTabIds,
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
      isFilterVisible: false,
    };

    const newTabs = [...state.tabs, newTab];
    const newActiveTabIds = { ...state.activeTabIds, [tabData.connectionId]: id };

    return {
      tabs: newTabs,
      activeTabId: id,
      activeTabIds: newActiveTabIds,
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

    const currentConnActiveId = state.activeTabId === id
      ? newActiveId
      : state.activeTabId;

    return {
      tabs: newTabs,
      activeTabId: currentConnActiveId,
      activeTabIds: newActiveTabIds,
    };
  }),

  setActiveTabId: (id) => set((state) => {
    const tab = state.tabs.find(t => t.id === id);
    if (!tab) return state;

    const newActiveTabIds = { ...state.activeTabIds, [tab.connectionId]: id };

    return {
      activeTabId: id,
      activeTabIds: newActiveTabIds,
    };
  }),

  updateTab: (id, updates) => set((state) => ({
    tabs: state.tabs.map(t => t.id === id ? { ...t, ...updates } : t),
  })),

  setSelectedRow: (tabId, rowIndex) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, selectedRowIndex: rowIndex } : t),
  })),

  closeTabsForConnection: (connectionId, keepTypes) => set((state) => {
    const newTabs = state.tabs.filter(t => {
      if (t.connectionId !== connectionId) return true;
      if (keepTypes && keepTypes.includes(t.type)) return true;
      return false;
    });

    let newActiveTabId = state.activeTabId;
    const newActiveTabIds = { ...state.activeTabIds };

    if (newActiveTabId && !newTabs.find(t => t.id === newActiveTabId)) {
      newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }

    // Update per-connection active tabs
    Object.keys(newActiveTabIds).forEach(cid => {
      if (!newTabs.find(t => t.id === newActiveTabIds[cid])) {
        const connTabs = newTabs.filter(t => t.connectionId === cid);
        newActiveTabIds[cid] = connTabs.length > 0 ? connTabs[connTabs.length - 1].id : null;
      }
    });

    return {
      tabs: newTabs,
      activeTabId: newActiveTabId,
      activeTabIds: newActiveTabIds,
    };
  }),

  // Filter actions
  addFilter: (tabId, filter) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? {
      ...t,
      filters: [...(t.filters || []), filter],
    } : t),
  })),

  removeFilter: (tabId, filterId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? {
      ...t,
      filters: (t.filters || []).filter(f => f.id !== filterId),
    } : t),
  })),

  updateFilter: (tabId, filterId, updates) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? {
      ...t,
      filters: (t.filters || []).map(f => f.id === filterId ? { ...f, ...updates } : f),
    } : t),
  })),

  toggleFilterBar: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? {
      ...t,
      isFilterVisible: !t.isFilterVisible,
    } : t),
  })),

  setFilters: (tabId, filters) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, filters } : t),
  })),

  // Sort actions
  setSortConfig: (tabId, config) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, sortConfig: config } : t),
  })),

  clearSort: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, sortConfig: undefined } : t),
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
          : [...hidden, column],
      };
    }),
  })),

  showAllColumns: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, hiddenColumns: [] } : t),
  })),

  hideAllColumns: (tabId, columns) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, hiddenColumns: columns } : t),
  })),

  toggleColumnsPopover: (tabId) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, isColumnsPopoverVisible: !t.isColumnsPopoverVisible } : t),
  })),

  setViewMode: (tabId, mode) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, viewMode: mode } : t),
  })),

  setTableStructure: (tabId, structure) => set((state) => ({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, tableStructure: structure } : t),
  })),
}));
