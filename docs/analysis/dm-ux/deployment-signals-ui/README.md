# Deployment Signals UI (SLG)

Isolated visual prototype and design notes for the SLG Deployment Manager **Signals** landing page. Production implementation lives in `libraries/DepMngr` (`CoreUI_*`) and `solutions/SLG_DM` (`Config_SLG.js`, `WebAppCode.js`).

## Prototype

Open `prototype.html` in a browser (or serve locally). Scenarios are switched via `?scenario=`:

| Scenario | Purpose |
|----------|---------|
| `portfolio-16` | ~16 active Signals (dense worklist) |
| `new-escalated` | NEW + ESCALATED emphasis |
| `continuing` | Mostly CONTINUING |
| `improving` | DE_ESCALATED / positive attention |
| `evidence-limited` | Evidence limitation copy in detail |
| `quiet` | No active Signals |
| `expanded` | One expanded detail panel |
| `history` | Deployment Signal history timeline |

## Making Signals the default landing (future)

Today Signals is spliced after **Deployments** when `deploymentSignal` persistence is enabled and `ui.signalsTab.enabled !== false` (`Config_SLG.js`).

To make Signals the first experience later (SLG only):

1. Enable `ui.overviewTab` only if Overview should remain; otherwise set `overviewTab.enabled: false`.
2. On first paint in `CoreUI_Js`, call `switchTab('signals')` when `ui.signalsTab.defaultLanding === true` (config flag to add).
3. Keep `ui.signalsTab.insertAfter` or move tab order explicitly in config.

Do not enable default landing for other `*_DM` apps until Signal data exists.

## Screenshots

Captured under `screenshots/` at 1440×900 and 1280×900 via `capture-screenshots.mjs` after opening the prototype.
