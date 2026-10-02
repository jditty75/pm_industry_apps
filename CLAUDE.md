# CLAUDE.md — Claude entry point

Owner: Jeff Ditty (jeffrey.ditty@workday.com). Root: `C:\JD` (Windows / PowerShell). Runtime: Google Apps Script via `clasp`.

## Purpose

Workday Professional Services **Google Apps Script monorepo**: shared libraries (`libraries/`) and sheet-backed solutions (`solutions/`). This file is a **short router**; load detail only when the task needs it.

## Instruction hierarchy

1. **[AGENTS.md](AGENTS.md)** — vendor-neutral contract (Git ownership, secrets, production authorization).
2. **[skills/gas-monorepo-engineer/SKILL.md](skills/gas-monorepo-engineer/SKILL.md)** — GAS/CLASP development, deploy, rollback, and Git workflow for this repo.
3. **Progressive references** — e.g. [docs/agent/monorepo-reference.md](docs/agent/monorepo-reference.md), skill `references/workday-monorepo.md`, [config/apps.json](config/apps.json).

Do not duplicate the GAS skill in this file.

## Non-negotiables

- **Git is the durable source of truth** for completed work; agents own routine Git (never force-push `main`).
- **Local/Git source is authoritative** for GAS code; do not routinely `clasp pull`.
- **Production deploy and production-impacting CLASP mutation** require explicit authorization from Jeff in the **current** interaction. Prior commits, handoffs, and “ready” status do not authorize production.
- **Production Deployment IDs** come only from per-app **`gas.config.json`** — never infer from `clasp deployments`.
- **Never commit `.clasp.json`** or copy Script IDs into tracked files.

## Critical hazards (always remember)

- **`libraries/DepMngr` push** can change live behavior for every consumer on CoreLib HEAD (`"0"` + `developmentMode`). Treat as production-impacting; inspect consumer manifests first.
- **`PS_SPA`** may deploy from project root per CLASP `rootDir`, not `src/` — read local `.clasp.json` before editing.
- **DepMngr / GoLives** are function libraries (`*_DM` / `*_GoLives` families) — see skill `references/application-families.md`.
- Historical `snapshots/` trees belong in Git history only, not the working tree.

## Where to look next

| Need | Document |
|------|----------|
| App discovery / teams / portal names | `config/apps.json` |
| Local UI preview (before push) | `docs/agent/ui-preview.md` |
| Layout, commands, patterns, testing | `docs/agent/monorepo-reference.md` |
| Deploy ledger | `.ai/deployments.md` |
| Unfinished cross-agent work | `.ai/HANDOFF.md` |
| Global coding rules (Cursor legacy) | `.cursorrules` |

State plainly what was and was not verified; this repo has no universal automated test suite.
