# DepMngr (CoreLib) pin strategy — evidence-based recommendation

**Scope:** Six `*_DM` consumers. **No pin changes** in the M1 preview task; this document is analysis only.

**Evidence source:** `solutions/*/src/appsscript.json` (local) reflected in [`depmngr-consumer-usage.json`](./depmngr-consumer-usage.json) `manifestPins` (regenerated via `rationalization_analyze.py`).

## Current pins (as of analysis regeneration)

| App | `version` | `developmentMode` | Effective library |
|-----|-----------|-------------------|-------------------|
| SLG_DM | `139` | `true` | **HEAD** (live CoreLib dev) |
| HC_DM | `139` | `false` | Immutable **139** |
| HENP_DM | `139` | `false` | Immutable **139** |
| EVI_DM | `113` | `false` | Immutable **113** (stale vs family) |
| PDX_DM | `0` | `true` | **HEAD** |
| HS_DM | `0` | `true` | **HEAD** |

Extra OAuth scopes diverge: SLG (`send_mail`), EVI/PDX/HS (`presentations`).

## Who consumes HEAD

- **SLG_DM**, **PDX_DM**, **HS_DM** with `developmentMode: true` and version `139` or `0` (both resolve to HEAD in practice for this monorepo workflow).
- Any `npm run push` to `libraries/DepMngr` immediately changes runtime for these three without a version cut.

## Risks from divergent pins

1. **Behavioral drift:** EVI on **113** while HC/HENP on **139** and three apps on **HEAD** — UI contracts in CoreUI_Js may assume symbols only present on newer CoreLib builds.
2. **Accidental multi-app blast radius:** A DepMngr push is a **production-impacting** change for HEAD consumers; pinned apps are insulated until manifest bump.
3. **Test matrix explosion:** A fix validated on SLG HEAD does not prove EVI 113 or HC 139.
4. **WIP coupling:** SLG_DM shell + DepMngr WIP must not be treated as fleet-wide ready while pins differ.

## Proposed target strategy

### Development (daily agent / Jeff workflow)

- **One HEAD canary:** Keep **SLG_DM** on HEAD (`developmentMode: true`) for integrated DepMngr + shell iteration.
- **Other HEAD apps (PDX, HS):** Pin to **numbered** CoreLib for routine work; switch to HEAD only during explicit cross-app ProductMode work, then revert manifest.
- **Industry stable pair:** HC_DM + HENP_DM stay on the **same numbered** version, bumped together after `npm run version` in DepMngr.
- **EVI_DM:** Bring to the same numbered line as HC/HENP before large CoreLib refactors (close the 113 → 139 gap deliberately, with EVI-specific smoke).

### Production

- **No `developmentMode: true`** on production deployments.
- **Immutable version** on every consumer; version ID recorded in Git when cutting releases.
- DepMngr changes: `version` in library → bump all consumer manifests in one logical release (or staged with documented exceptions).

## Migration sequence (avoid accidental multi-app impact)

1. **Freeze manifest policy** in docs/skills (this file + GAS skill hazard section) — no drive-by HEAD toggles.
2. **Cut DepMngr version** from current HEAD only after SLG canary preview + authorized SLG push/smoke.
3. **Bump HC_DM + HENP_DM** to new number (no `developmentMode`).
4. **Bump EVI_DM** from 113 → new number in a **dedicated** change with EVI diagnostics smoke.
5. **Bump PDX_DM + HS_DM** off HEAD to the same number; set `developmentMode: false`.
6. **Re-establish single HEAD canary** (SLG only) for the next development cycle.

## Authorization reminder

Changing `appsscript.json` pins does not deploy by itself, but the next `clasp push` per app does. Fleet-wide pin alignment should be scheduled with explicit production authorization per app or a named batch.
