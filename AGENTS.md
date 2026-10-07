# AGENTS.md — AI agent entry point

Vendor-neutral rules for coding agents (Cursor, Claude, ChatGPT/Codex, etc.) working in this repository.

## Repository

- Monorepo root: `C:\JD`
- **Git is the durable source of truth** for completed engineering work.

## Git (agent-owned)

Agents handle routine Git work: status, branches, staging, meaningful **Conventional Commits**, pull/rebase when appropriate, and push. **Do not ask Jeff to run routine Git commands.**

- Never force-push the primary branch (`main`) or destructively rewrite shared history.

## Instruction hierarchy

1. **This file (`AGENTS.md`)** — vendor-neutral repository contract for all agents.
2. **[`skills/gas-monorepo-engineer/SKILL.md`](skills/gas-monorepo-engineer/SKILL.md)** — Google Apps Script development, CLASP, testing, versioning, deployment, and rollback for this monorepo.
3. **Progressive repository references** when relevant — e.g. [`docs/agent/monorepo-reference.md`](docs/agent/monorepo-reference.md), [`config/apps.json`](config/apps.json), and references linked from the GAS skill.

## Google Apps Script

- Follow the GAS skill for all Apps Script work in this repository.
- Load skill references and monorepo docs **only when the task needs them**; do not duplicate skill content into other entry-point files.
- **Runtime validation:** Do not default to `scripts.run` or `clasp run` here—they are often unavailable (`403`). Use local tests and read-only API inspection first; for GAS runtime proof, hand off named editor functions per [`skills/gas-monorepo-engineer/references/gas-runtime-execution.md`](skills/gas-monorepo-engineer/references/gas-runtime-execution.md).

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

- [`CLAUDE.md`](CLAUDE.md) — concise Claude-oriented entry point (points back to this hierarchy).

Deployment Intelligence is shared across Deployment Manager applications: source/history evidence and configuration may be app-specific, but Signal, lifecycle, persistence, intelligence, distribution, and investigation capabilities must not be forked by app.
