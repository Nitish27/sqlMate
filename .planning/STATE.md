# Project State

## Current Phase
Feature Development — Appearance System Refresh

## Active Plans
| Plan | Status | Created |
|------|--------|---------|
| [text-to-sql](.planning/plans/text-to-sql.md) | ✅ Complete | 2026-02-28 |
| [theme-settings-foundation](.planning/plans/theme-settings-foundation.md) | ✅ Complete | 2026-04-13 |
| [theme-settings-migration](.planning/plans/theme-settings-migration.md) | 🚧 In Progress | 2026-04-13 |
| [appearance-preferences-shell](.planning/plans/appearance-preferences-shell.md) | ✅ Complete | 2026-04-14 |
| [appearance-preferences-runtime](.planning/plans/appearance-preferences-runtime.md) | 🆕 Planned | 2026-04-14 |
| [appearance-preferences-polish](.planning/plans/appearance-preferences-polish.md) | 🆕 Planned | 2026-04-14 |

## Recent Decisions
- Text-to-SQL: Tauri command (Rust → Gemini REST), .env for API key, full schema context, popover UI
- Theme settings: implement `dark` / `light` / `system` as a persisted preference, resolve system mode at runtime, expose the selector in both the welcome flow and the connected workspace, and migrate hardcoded dark surfaces in two phases
- Theme settings execution: foundation tasks are complete, and the first navigation-chrome migration pass has been applied to the sidebar, connection rail, sidebar tree, toolbar, and welcome sidebar
- Appearance-system direction changed after reviewing the TablePlus Fonts & Colors reference and current SqlMate screenshots: the inline appearance popover is now a stepping stone only, and the recommended path is a real preferences window with theme presets on the left, scoped appearance tabs (`SQL Editor`, `Data Table`, `Sidebars`) on the right, and live previews before users commit changes
- Appearance shell execution is complete: SqlMate now has persisted scoped appearance settings, a shared Fonts & Colors dialog opened from both the welcome flow and the toolbar, and live preview scaffolding for SQL editor, data table, and sidebar scopes
