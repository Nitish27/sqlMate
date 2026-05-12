import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useEffect } from "react";
import { useDatabaseStore } from "./store/databaseStore";
import { applyThemeToDocument, resolveThemePreference, subscribeToSystemTheme } from "./utils/theme";

const ThemeRuntime = () => {
  const themePreference = useDatabaseStore((state) => state.themePreference);
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const setResolvedTheme = useDatabaseStore((state) => state.setResolvedTheme);

  useEffect(() => {
    const nextTheme = resolveThemePreference(themePreference);
    if (resolvedTheme !== nextTheme) {
      setResolvedTheme(nextTheme);
      return;
    }

    applyThemeToDocument(nextTheme);
  }, [themePreference, resolvedTheme, setResolvedTheme]);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    return subscribeToSystemTheme((systemTheme) => {
      const { themePreference: currentPreference, resolvedTheme: currentTheme, setResolvedTheme: updateResolvedTheme } = useDatabaseStore.getState();

      if (currentPreference === "system" && currentTheme !== systemTheme) {
        updateResolvedTheme(systemTheme);
      }
    });
  }, []);

  return null;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeRuntime />
    <App />
  </React.StrictMode>,
);
