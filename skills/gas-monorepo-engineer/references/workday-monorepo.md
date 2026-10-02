# Workday GAS monorepo hazards and conventions

Use this reference only for the Workday GAS monorepo currently rooted at `C:\JD` (or a clone retaining these structures). Root `AGENTS.md` and current repository files are authoritative if this reference becomes stale.

## Project families

- `libraries/DepMngr`: shared Deployment Health library consumed as `CoreLib`.
- `libraries/GoLives`: shared Go Lives library.
- `solutions/*`: deployable GAS solutions; not every directory under `solutions` is necessarily a CLASP project. Treat presence of local `.clasp.json` as the local project indicator.

## Critical DepMngr rule

Deployment Health consumers have historically referenced DepMngr/CoreLib at version `"0"` with `developmentMode: true`. When that remains true in current consumer manifests, a `clasp push` in `libraries/DepMngr` changes live behavior immediately across those consumers.

Therefore:
- inspect current consumer `appsscript.json` pins before pushing DepMngr;
- if any production consumer is still on HEAD/development mode, treat the push as a production deployment;
- require fresh explicit production authorization and name the affected consumers before executing it.

Do not assume the historical set/count of consumers; derive it from current manifests.

## CLASP root exceptions

Do not assume source is always `src/`. Read each project's `.clasp.json.rootDir` locally before editing/deploying.

`PS_SPA` has historically used `rootDir: ""` with deployable files at the project root and duplicate-looking files under `src/`. Until the repository is deliberately normalized, edit/deploy the files selected by the current `.clasp.json`, not the visually conventional path.

## Legacy/snapshot directories

Historical `snapshots/` and `DHLibrary_v52/` were intentionally removed from the working tree. Do not recreate them as a deployment mechanism. Use Git history for historical source.

## Testing reality

This monorepo historically has no universal root test framework. Use only real app-specific checks. Examples may include a GAS self-test function, diagnostic helpers, web/sheet smoke tests, and execution logs. Never translate "no test failed" into "tested" when no test actually ran.

## Source authority

The new operating model makes local/Git the sole routine source of truth. Do not perform routine `clasp pull`. Use the emergency reconciliation procedure only when the user explicitly reports a browser-side Apps Script edit that must be recovered.
