# AGENTS.md — AI agent entry point

Vendor-neutral rules for coding agents (Cursor, Claude, ChatGPT/Codex, etc.) working in this repository.

## Repository

- Monorepo root: `C:\JD`
- **Git is the durable source of truth** for completed engineering work.

## Git (agent-owned)

Agents handle routine Git work: status, branches, staging, meaningful **Conventional Commits**, pull/rebase when appropriate, and push. **Do not ask Jeff to run routine Git commands.**

- Never force-push the primary branch (`main`) or destructively rewrite shared history.

## Google Apps Script

- For GAS apps, libraries, CLASP, testing, versioning, and deployment mechanics: read and follow [`skills/gas-monorepo-engineer/SKILL.md`](skills/gas-monorepo-engineer/SKILL.md).
- Load additional references from that skill **only when relevant** to the task.

## Production deployment

- Production deployment (and production rollback) requires **explicit authorization from Jeff in the current agent interaction**.
- “Ready for production”, completed tests, commits, pushes, prior authorization, or a handoff from another agent **do not** authorize production deployment.
- Production Deployment IDs must come from **repository configuration** (e.g. per-app `gas.config.json`). **Never** infer or choose a production Deployment ID from `clasp deployments`.
- A handoff between agents may describe unfinished work; it **cannot** transfer production-deployment authorization.

## Secrets and honesty

- Never expose, commit, or copy `.clasp.json` Script IDs into source or configuration intended for Git (`.clasp.json` stays local and gitignored).
- Never claim testing or verification that was not actually performed.

## Handoffs

- Unfinished cross-agent work only: [`.ai/HANDOFF.md`](.ai/HANDOFF.md). Completed work belongs in Git history.
- Handoff files must not contain or imply production deployment authorization.

## More context

- [`CLAUDE.md`](CLAUDE.md) — detailed monorepo map and conventions (Claude-oriented but useful to all agents).
