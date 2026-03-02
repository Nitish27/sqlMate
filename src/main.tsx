import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { storeService } from "./services/StoreService";
import { useConnectionStore } from "./store/connectionStore";
import { useHistoryStore } from "./store/historyStore";
import { useSettingsStore } from "./store/settingsStore";

async function main() {
  await storeService.init(); // runs migration on first launch
  // Load persisted data into domain stores
  await useConnectionStore.getState().loadConnections();
  await useHistoryStore.getState().loadHistory();
  await useSettingsStore.getState().loadSettings();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

main();
