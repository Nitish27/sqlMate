// Schema store: per-connection sidebar items and schema cache.
// Minimal in Phase 1 -- grows significantly in Phase 3 when schema introspection is added.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SidebarItem, SidebarSettings } from './types';

interface SchemaState {
  sidebarItems: Record<string, SidebarItem[]>;
  sidebarSettings: Record<string, SidebarSettings>;
  pinnedItems: Record<string, string[]>;
  sidebarSearchTerm: string;

  // Actions
  fetchSidebarItems: (connectionId: string) => Promise<void>;
  toggleSidebarSetting: (connId: string, setting: keyof SidebarSettings) => void;
  togglePinnedItem: (connId: string, itemName: string) => void;
  setSidebarSearchTerm: (term: string) => void;
}

export const useSchemaStore = create<SchemaState>((set) => ({
  sidebarItems: {},
  sidebarSettings: {},
  pinnedItems: {},
  sidebarSearchTerm: '',

  fetchSidebarItems: async (connectionId) => {
    try {
      const items = await invoke('get_sidebar_items', { connectionId }) as SidebarItem[];
      set((state) => ({
        sidebarItems: { ...state.sidebarItems, [connectionId]: items },
        sidebarSettings: {
          ...state.sidebarSettings,
          [connectionId]: state.sidebarSettings[connectionId] || { showFunctions: true, showRecent: true, showSystem: false },
        },
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
        [setting]: !state.sidebarSettings[connId][setting],
      },
    },
  })),

  togglePinnedItem: (connId, itemName) => set((state) => {
    const currentPinned = state.pinnedItems[connId] || [];
    const newPinned = currentPinned.includes(itemName)
      ? currentPinned.filter(i => i !== itemName)
      : [...currentPinned, itemName];
    return {
      pinnedItems: { ...state.pinnedItems, [connId]: newPinned },
    };
  }),

  setSidebarSearchTerm: (term) => set({ sidebarSearchTerm: term }),
}));
