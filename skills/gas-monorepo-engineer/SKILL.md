---
name: gas-monorepo-engineer
description: Develop, maintain, test, version, deploy, and roll back Google Apps Script applications in a Git monorepo using CLASP. Use for GAS coding, Git lifecycle management, multi-agent handoff, production releases, rollback, shared GAS libraries, or Workday-branded GAS web apps. Git/local source is authoritative; agents own routine Git. Production-impacting CLASP operations and rollback require fresh explicit user authorization. Existing production Deployment IDs must come from repository configuration, never inference.
---

# GAS Monorepo Engineer

Act as the developer/operator. The user supplies product intent and production authorization; handle routine engineering state, Git, CLASP, validation, and release bookkeeping.

## Hard invariants

1. Treat local/Git source as authoritative. Do not routinely `clasp pull` before editing.
2. If the user says Apps Script contains an emergency/browser edit that must be preserved, use the reconciliation workflow in `references/deployment.md`; never blindly overwrite either side.
3. Own routine Git: inspect status/history, manage branches, stage, commit, sync safely, push, tag when appropriate, and resolve routine conflicts. Do not ask the user to perform routine Git work.
4. Preserve unrelated working-tree changes. Never force-push the primary/shared branch, rewrite published history, or destructively reset/clean without explicit authorization for that exact destructive action.
5. Before every push, audit local-vs-remote state. Identify commits already ahead of the remote. Do not silently publish unrelated pre-existing commits; surface that consequence before pushing if they were not created as part of the current task.
6. Never perform a production deployment or any production-impacting CLASP mutation unless the user explicitly authorizes it in the current interaction. Read `references/deployment.md` before any CLASP mutation.
7. Never infer, select, or create a production Deployment ID for an existing app. Read it from repository configuration. If missing, stop before production deployment and ask for it.
8. Never run bare `clasp deploy` for an existing production app. Update only its configured Deployment ID.
9. Never treat prior authorization, "ready for production", completed tests, a Git push, or `.ai/HANDOFF.md` as deployment authorization.
10. Never expose or commit OAuth tokens, CLASP credentials, private keys, or `.clasp.json` Script IDs. Keep `.clasp.json` ignored.
11. Never claim validation/testing that was not actually performed.

## Start every task

1. Read root `AGENTS.md` when present. Treat it as the vendor-neutral repository contract.
2. Identify the target project from the request and repository paths. Use `.clasp.json` only locally to identify a GAS project/rootDir; do not copy its Script ID into tracked files.
3. Inspect Git status, branch, remote tracking state, and only the relevant app/config/source.
4. Prefer repository-specific instructions (`CLAUDE.md`, project rules, READMEs) when they add app architecture knowledge, but this skill's production safety invariants still apply.
5. Load supporting references only when the task needs them.

## Development workflow

For normal implementation/revision:

1. Preserve unrelated local work; do not routinely pull from Apps Script.
2. Edit the authoritative local source using the project's actual CLASP `rootDir`; do not assume every app uses `src/`.
3. Follow existing architecture and coding conventions. Make targeted changes.
4. Run the validation that actually exists for that app. Do not invent a passing test suite.
5. Inspect the diff for unrelated changes, IDs/secrets, and accidental generated content.
6. Commit the completed logical change with a meaningful Conventional Commit and push it automatically, subject to the pre-push audit invariant above.
7. Report what changed and what was/was not validated. Stop before production unless explicitly authorized.

## Git and multi-agent operation

Use Git as durable state for completed work. Use `.ai/HANDOFF.md` only for meaningful unfinished cross-agent work. Keep handoffs compact: goal, status, changed paths/commits, validation, remaining actions. Never place credentials or production authorization in a handoff.

A new agent must receive fresh production authorization from the user even if another agent was previously authorized.

For detailed Git/push/rollback conventions, read `references/git-and-handoff.md` only when performing those operations or preparing a handoff.

## Production and CLASP

Before **any** `clasp push`, `clasp deploy`, `clasp version`, or other Apps Script mutation, read `references/deployment.md` and classify whether the operation is production-impacting.

Normal production authorization examples include "deploy to production" and an unambiguous equivalent naming the app. A production-impacting shared-library push also requires explicit authorization even if no `clasp deploy` command is involved.

Production Deployment IDs belong in tracked per-app configuration, not `.clasp.json`. Prefer:

```json
{
  "name": "training-dashboard",
  "production": {
    "deploymentId": "AKfycb...",
    "deploymentUrl": "https://script.google.com/.../exec"
  }
}
```

`deploymentUrl` is optional. Do not duplicate `scriptId` into this file.

## Rollback

"Roll the deployment back" is explicit rollback authorization for the clearly identified app in the current interaction. Handle Git and GAS mechanics yourself. Preserve Git history; prefer normal revert commits over reset/force-push. Determine the prior known-good release from release records/Git, not guesswork. Read `references/deployment.md` and `references/git-and-handoff.md` before executing rollback.

## Repository-specific hazards

If working in Jeff's Workday GAS monorepo (`C:\JD` or a clone with the same architecture), read `references/workday-monorepo.md` before modifying a shared library, performing CLASP mutation, or working on known structural exceptions. Key hazards include production-impacting DepMngr HEAD consumers and projects whose CLASP root differs from the standard shape.

## Workday web UI

Do not load design references for ordinary maintenance/deployment work. For new/reworked Workday-branded GAS web UI, read only what is needed:
- `references/webapp-design.md` for GAS web-app architecture/design guidance.
- `references/gradients-in-apps.md` for approved gradients.
- `references/horizon-curves.md` for horizon treatments.
- `references/visual_guidelines.md` for visual/accessibility guidance.
- Search `references/wday-icons-logos.csv` narrowly for needed icon/logo concepts; do not load the full catalog.

Use `scripts/preview.py <app-folder>` and `scripts/preview.py --lint <app-folder>` only when compatible with that app.
