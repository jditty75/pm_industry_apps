# Git, release bookkeeping, and cross-agent handoff

## Agent-owned Git

Handle status, branch creation/switching, staging, Conventional Commits, safe sync/rebase, pushes, tags when useful, and routine conflicts. Preserve unrelated user/agent changes.

Never force-push the primary/shared branch or destructively reset/clean without explicit authorization for that action.

## Pre-push audit

Before every push:

1. Fetch remote state when possible.
2. Inspect branch/upstream and commits ahead/behind.
3. Identify ahead commits created by the current task versus pre-existing local commits.
4. If pushing would publish unrelated pre-existing commits, surface that consequence before pushing; do not silently publish them.
5. Stage only intended task paths.

## Deployment bookkeeping commits

When a production event appends `.ai/deployments.md`, keep that bookkeeping commit separate from the source commit when practical. This makes it clear which Git SHA produced source and which SHA merely records the deployment event.

Never change source solely to make Git "match" a rolled-back production version. Production state and development state may legitimately diverge after rollback.

## Completed vs unfinished state

Completed work belongs in Git history. `.ai/HANDOFF.md` is for unfinished work only.

Recommended shape:

```markdown
## Current Task
<goal>

## Status
<what is complete; use the release-state vocabulary when relevant>

## Changed
<paths/commits>

## Validation
<checks and results>

## Remaining
<next actions>
```

Never store production authorization, secrets, OAuth data, Script IDs, or an instruction for the next agent to auto-deploy. Clear/refresh stale handoff state after completion.
