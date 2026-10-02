# Git and cross-agent handoff

## Agent-owned Git

Handle status, branch creation/switching, staging, Conventional Commits, safe sync/rebase, pushes, tags when useful, and routine conflicts. Preserve unrelated user/agent changes.

Never force-push the primary/shared branch or destructively reset/clean without explicit authorization for that action.

## Pre-push audit

Before every push:

1. Fetch remote state when possible.
2. Inspect branch/upstream and commits ahead/behind (for example, compare `HEAD` with the upstream tracking branch).
3. Identify which ahead commits were created by the current task versus pre-existing local commits.
4. If pushing would publish unrelated pre-existing commits, surface that consequence before pushing. Do not silently publish them as if they were part of the current task.
5. If the user has already established a standing policy that such commits may be published, follow it; otherwise get the minimal clarification needed.

## Completed vs unfinished state

Completed work belongs in Git history. `.ai/HANDOFF.md` is for unfinished work only.

Recommended shape:

```markdown
## Current Task
<goal>

## Status
<what is complete; say NOT DEPLOYED when relevant>

## Changed
<paths/commits>

## Validation
<checks and results>

## Remaining
<next actions>
```

Never store production authorization, secrets, OAuth data, Script IDs, or an instruction for the next agent to auto-deploy. Clear/refresh stale handoff state after completion.
