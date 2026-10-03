# GoLives pin strategy — evidence-based recommendation

**Scope:** Three `*_GoLives` consumers. **No pin changes** in this document; analysis and target policy only.

**Evidence source:** `solutions/*/src/appsscript.json` (discovered dynamically by `.\release.ps1 <Library> -Plan`).

## Current pins (discover at plan time)

Run:

```powershell
.\release.ps1 GoLives -Plan
```

The plan lists each consumer `version`, `developmentMode`, and whether it consumes **HEAD**.

As of initial tooling authoring, manifests showed:

| App | Typical pin pattern |
|-----|---------------------|
| SLG_GoLives | numbered version |
| HC_GoLives | numbered version (may lag SLG) |
| HENP_GoLives | numbered version (may lead HC) |

Do not treat these numbers as permanent policy — always regenerate the plan.

## Risks (parallel to DepMngr)

1. **Divergent pins:** HC/SLG/HENP on different numbers mean the same Git library change does not reach all users until each manifest is bumped and pushed/deployed.
2. **HEAD consumers:** If any consumer uses `developmentMode: true` or version `"0"`, `libraries/GoLives` clasp push is **production-impacting** for that consumer immediately.
3. **No standalone UI:** Validate via a consumer (`.\preview.ps1 SLG_GoLives`) and family selftests.

## Proposed target strategy

### Development

- **One HEAD canary (optional):** e.g. SLG_GoLives on HEAD for integrated iteration; others on numbered pins unless doing cross-app work.
- **Temporary HEAD:** Switch manifest only for explicit testing; revert before fleet pin alignment.

### Production

- **Immutable numbered pins** on every consumer; `developmentMode: false`.
- Library release: `npm run version` in `libraries/GoLives` → bump all consumer manifests in one logical release graph → push consumers → authorized production deploy per `gas.config.json`.

## Migration sequence

1. Document policy (this file + GAS skill shared-library release reference).
2. Cut GoLives version from tested HEAD.
3. Bump all `*_GoLives` manifests to the new number together (or staged with documented exceptions).
4. Authorized push + production deploy per consumer.
5. Append `.ai/library-releases/golives.jsonl`.

## Authorization

Consumer pin changes do not deploy alone; the next authorized `clasp push` and production `clasp deploy` per app does. Batch releases need explicit plan authorization (`Execute the GoLives release plan.`).
