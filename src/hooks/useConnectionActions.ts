// Cross-store coordination for connect/disconnect workflows.
// This hook is the ONLY place where multiple stores interact.
// Individual stores NEVER import from each other.

import { useConnectionStore } from '../store/connectionStore';
import { useSchemaStore } from '../store/schemaStore';
import { useUIStore } from '../store/uiStore';
import type { SavedConnection } from '../store/types';

export function useConnectionActions() {
  const storeConnect = useConnectionStore(s => s.connect);
  const selectConnection = useConnectionStore(s => s.selectConnection);
  const setActiveConnection = useConnectionStore(s => s.setActiveConnection);
  const fetchSidebarItems = useSchemaStore(s => s.fetchSidebarItems);
  const setShowConnectionSelector = useUIStore(s => s.setShowConnectionSelector);

  const connect = async (conn: SavedConnection, password?: string | null) => {
    await storeConnect(conn, password);
    // Close any connection selection modals
    setShowConnectionSelector(false);
    // Select the connection and restore context
    selectConnection(conn.id);
    // Fetch sidebar items for this connection
    await fetchSidebarItems(conn.id);
  };

  const switchConnection = (id: string) => {
    setActiveConnection(id);
    fetchSidebarItems(id);
  };

  const refreshSidebar = () => {
    const activeId = useConnectionStore.getState().activeConnectionId;
    if (activeId) {
      fetchSidebarItems(activeId);
    }
  };

  return { connect, switchConnection, refreshSidebar };
}
