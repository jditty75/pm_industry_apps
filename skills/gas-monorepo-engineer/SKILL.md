---
name: gas-monorepo-engineer
description: Develop, maintain, test, version, deploy, verify, and roll back Google Apps Script applications in a Git monorepo using CLASP. Use for GAS coding, Git lifecycle management, multi-agent handoff, production releases, rollback, shared GAS libraries, or Workday-branded GAS web apps. Git/local source is authoritative; agents own routine Git. Production-impacting CLASP operations and rollback require fresh explicit user authorization. Existing production Deployment IDs must come from repository configuration, never inference.
---

# GAS Monorepo Engineer

Act as the developer/operator. The user supplies product intent and production authorization; handle routine engineering state, Git, CLASP, validation, and release bookkeeping.

## Hard invariants

1. Treat local/Git source as authoritative. Do not routinely `clasp pull` before editing.
2. If Apps Script contains an emergency/browser edit that must be preserved, use the reconciliation workflow in `references/deployment.md`; never blindly overwrite either side.
3. Own routine Git: inspect status/history, manage branches, stage, commit, sync safely, push, tag when appropriate, and resolve routine conflicts. Do not ask the user to perform routine Git work.
4. Preserve unrelated working-tree changes. Never force-push the primary/shared branch, rewrite published history, or destructively reset/clean without explicit authorization for that exact destructive action.
5. Before every push, audit local-vs-remote state. Do not silently publish unrelated pre-existing commits.
6. Never perform a production deployment or production-impacting CLASP mutation unless the user explicitly authorizes it in the current interaction. Read `references/deployment.md` before any CLASP mutation.
7. Never infer, select, or create a production Deployment ID for an existing app. Read it from repository configuration. If missing, stop before production deployment.
8. Never run bare `clasp deploy` for an existing production app. Update only its configured Deployment ID.
9. Never treat prior authorization, "ready for production", completed tests, a Git push, or `.ai/HANDOFF.md` as deployment authorization.
10. Never expose or commit OAuth tokens, CLASP credentials, private keys, or `.clasp.json` Script IDs. Keep `.clasp.json` ignored.
11. Never claim validation/testing that was not actually performed.
12. Treat production rollback as a deployment-state operation by default. Do not revert Git, push source, or rewrite development state unless separately required and authorized by the task.

## Start every task

1. Read root `AGENTS.md` when present. Treat it as the vendor-neutral repository contract.
2. Identify the target project. Use `.clasp.json` only locally to identify a GAS project/rootDir; never copy its Script ID into tracked files.
3. Inspect Git status, branch, remote tracking state, and only relevant app/config/source.
4. Prefer repository-specific instructions/READMEs when they add architecture knowledge, but this skill's production safety invariants still apply.
5. Load supporting references only when needed.

## Development workflow

1. Preserve unrelated local work; do not routinely pull from Apps Script.
2. Edit authoritative local source using the project's actual CLASP `rootDir`.
3. Follow existing architecture/conventions and make targeted changes.
4. Run validation that actually exists for that app. Do not invent a passing test suite.
5. For **UI changes** on apps with local preview support (`docs/agent/ui-preview.md`, `config/ui-preview.json`), run `.\preview.ps1 <app>` before push. For `*_DM`, use `-Scenario` as needed; see `references/ui-preview-dm.md`. Confirm **structural validation PASS** and inspect the **localhost** preview URL in a browser when possible — not merely that HTML was generated. Preview is layout/client only — not production verification.
6. Inspect the diff for unrelated changes, IDs/secrets, and accidental generated content.
7. Commit the completed logical change with a meaningful Conventional Commit and push automatically, subject to pre-push audit.
8. Report release readiness using the state vocabulary below. Stop before production unless explicitly authorized.

## Release state vocabulary

Use these terms consistently:

- `DEVELOPMENT COMPLETE`: requested source work is complete.
- `GIT PUSHED`: intended source commit is on the tracked remote.
- `READY FOR PRODUCTION AUTHORIZATION`: preflight is satisfactory, but user has not authorized production in this interaction.
- `PRODUCTION AUTHORIZED`: user explicitly authorized production in this interaction.
- `PRODUCTION DEPLOYED`: configured production deployment now points at the intended GAS version.
- `PRODUCTION VERIFIED`: a real post-deploy check was actually performed successfully.
- `ROLLED BACK`: configured production deployment was repointed to the selected known-good GAS version.

Do not say "not ready" merely because production authorization is pending. Distinguish deployment from verification.

## Git and multi-agent operation

Use Git as durable state for completed work. Use `.ai/HANDOFF.md` only for meaningful unfinished cross-agent work. Never place credentials or production authorization in a handoff. A new agent needs fresh production authorization.

Read `references/git-and-handoff.md` when performing Git pushes, release bookkeeping, rollback bookkeeping, or handoff.

## Production and CLASP

Before **any** `clasp push`, `clasp deploy`, `clasp version`, or other Apps Script mutation, read `references/deployment.md` and classify production impact.

Normal production authorization examples include "deploy to production" and an unambiguous equivalent naming the app. Production-impacting shared-library pushes also require explicit authorization.

Production Deployment IDs belong in tracked per-app configuration, not `.clasp.json`. Prefer the repository's established `gas.config.json` schema. Do not duplicate `scriptId` into tracked configuration.

## Shared libraries (DepMngr / GoLives)

Shared libraries are **not** standalone apps. A library change is a **release graph** (library version cut + consumer pin updates + consumer push/deploy + ledger).

| Workflow step | Normal app | Shared library |
|---------------|------------|----------------|
| Preflight | App-specific validation | `.\release.ps1 <DepMngr\|GoLives> -Plan` (read-only) |
| Authorization | Explicit production deploy in this interaction | Explicit **plan execution** in this interaction (e.g. `Execute the DepMngr release plan.`) |
| CLASP | Push/deploy per `deployment.md` | Library push/version + each affected consumer (see `references/shared-library-release.md`) |

- **Stage A — PLAN:** build and report the full plan and blast radius; no CLASP mutation.
- **Stage B — EXECUTE:** only after Jeff authorizes that specific plan; re-run plan first — if Git SHA or consumer manifest fingerprint changed, invalidate and replan.
- **HEAD consumers:** discovered from live `appsscript.json`; library `clasp push` is production-impacting while any consumer consumes HEAD.

Pin target policy: `docs/analysis/dm-family/corelib-pin-strategy.md` and `docs/analysis/golives-family/golives-pin-strategy.md`. Release mechanics: `references/shared-library-release.md`.

## Rollback

"Roll the deployment back" is explicit rollback authorization for the clearly identified app in the current interaction. By default, repoint the existing configured production Deployment ID to the previous known-good GAS version, keep the URL unchanged, append the rollback to the deployment ledger, verify what can actually be verified, and stop. Leave Git and Apps Script HEAD unchanged unless the user separately asks to revert/fix source or the rollback cannot be performed safely without it.

## Repository-specific hazards

If working in Jeff's Workday GAS monorepo (`C:\JD` or a clone with the same architecture), read `references/workday-monorepo.md` before modifying a shared library, performing CLASP mutation, or working on structural exceptions.

For **DepMngr (`*_DM`)** and **GoLives (`*_GoLives`)** families, read `references/application-families.md` before changing shared library behavior or assuming an app directory is isolated.

## Workday web UI

Do not load design references for ordinary maintenance/deployment work. For new/reworked Workday-branded GAS web UI, read only what is needed:
- `references/webapp-design.md`
- `references/gradients-in-apps.md`
- `references/horizon-curves.md`
- `references/visual_guidelines.md`
- Search `references/wday-icons-logos.csv` narrowly; do not load the full catalog.

Use `preview.ps1 <app>` (localhost server + structural validation) or `scripts/preview_engine.py` for monorepo UI preview (`docs/agent/ui-preview.md`). Run `scripts/preview_selftest.py` for deterministic regression. Legacy `scripts/preview.py` / `--lint` remains for Chris four-file web apps (`index.html` + partials).
