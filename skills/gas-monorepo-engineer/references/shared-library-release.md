# Shared library release (DepMngr / GoLives)

Progressive reference. Production safety invariants remain in the GAS skill and `references/deployment.md`.

## Release graph

Shared libraries are **not** standalone web apps. Model one release as:

```
library source (Git)
  → validation
  → library HEAD push (authorized, production-impacting if HEAD consumers exist)
  → clasp version (immutable GAS library version)
  → consumer appsscript.json pin updates
  → consumer clasp push
  → consumer production deploy (per gas.config.json deploymentId, authorized)
  → verification
  → append .ai/library-releases/*.jsonl
```

## Two-stage authorization

| Stage | Who | What |
|-------|-----|------|
| **A — PLAN** | Agent | `.\release.ps1 DepMngr -Plan` (read-only). Report blast radius, pins, blockers, rollback. |
| **B — EXECUTE** | Jeff | Explicit phrase in the **current** interaction, e.g. `Execute the DepMngr release plan.` |

Generic "deploy when ready" does **not** authorize execution.

**Plan invalidation:** If `gitSha` or consumer manifest fingerprint differs from the plan, discard the plan and regenerate.

## HEAD consumers

Before any `libraries/DepMngr` or `libraries/GoLives` push:

1. Run release plan — list `consumesHead` consumers.
2. Treat library push as **production-impacting** while any HEAD consumer exists.
3. Target policy: one development canary on HEAD; production fleet on immutable versions (`docs/analysis/dm-family/corelib-pin-strategy.md`, `docs/analysis/golives-family/golives-pin-strategy.md`).

## Commands

```powershell
.\release.ps1 DepMngr -Plan
.\release.ps1 GoLives -Plan
.\release.ps1 DepMngr -Plan -Json
python skills/gas-monorepo-engineer/scripts/library_release_selftest.py
```

Implementation: `scripts/library_release/`, registry `config/library-registry.json`.

## Rollback (default)

- Git stays forward.
- Repoint consumer production deployments to prior known-good **app** GAS version after reverting manifest pins to ledger-recorded `consumerPinsBefore`.
- HEAD consumers: rollback is ambiguous — they may have been on live library HEAD before the release; pin to last known immutable version with `developmentMode: false` after authorized push/deploy.

## Ledger

Append-only JSONL under `.ai/library-releases/`. Do not fabricate historical version mappings.

## Normal app vs shared library (skill summary)

| Kind | Authorization | Workflow |
|------|---------------|----------|
| Normal solution app | Explicit deploy in current interaction | `deployment.md` deterministic deploy |
| Shared library | Explicit **plan** authorization, then execute | Plan → execute release graph |
