# GAS runtime execution vs Execution API (Workday environment)

Jeff's Workday Google Workspace environment has been exercised repeatedly on this monorepo. Treat the following as a **tooling limitation**, not an application defect.

## What works reliably

| Mechanism | Typical use |
|-----------|-------------|
| **Apps Script editor** | One-off controlled ops, verification helpers, canary steps |
| **Installed time-driven / event triggers** | Production pipelines (e.g. EDM `runQualtricsInboxScheduled`) |
| **CLASP read/mutate when authorized** | `status`, `push`, `version`, `deploy` (per deployment.md authorization) |
| **Apps Script API (read)** | Project metadata, content drift checks, deployments list (where OAuth permits) |
| **Drive / Sheets API (read)** | Folder layout, metadata, parent resolution (where OAuth permits) |
| **Local Node/Python harnesses** | Deterministic transforms, contract tests, dry-run processors |

## What is not reliably available from agents / local automation

- **`scripts.run`** (Apps Script Execution API)
- **`clasp run`**

These often return **`403 PERMISSION_DENIED`** even when editor execution and production triggers work. **Do not** treat that as broken EDM/DM code.

**EDM production does not depend on Execution API.** Normal operation uses Apps Script runtime, installed triggers, Drive, Sheets, Script Properties, and immutable CoreLib versions—not a developer machine, Cursor, `scripts.run`, or `clasp run`.

Investigate or enable remote Execution API **only** if Jeff explicitly asks. Otherwise it is out of scope.

## Agent rule (default)

**Do not use `scripts.run` or `clasp run` as the default method for executing or validating GAS functions in this environment.**

When a task needs GAS runtime proof, use the validation hierarchy below and stop at an editor boundary with an explicit handoff.

## Preferred validation hierarchy

### A. Local deterministic validation

Node/Python/local test harnesses, preview selftests, contract/oracle tests—anywhere GAS runtime is unnecessary.

Examples: `solutions/External_Data_Manager` `npm test`, `validate-qualtrics-csv.js`, `responses-dry-run-local.js`, DepMngr `npm test`, `preview_selftest.py`.

### B. Read-only remote inspection

Apps Script API / Drive API / CLASP read operations when current credentials permit.

Examples: `clasp deployments`, `clasp show-authorized-user`, project `content` GET, Drive folder search, `verify.ps1` (`clasp status` only).

### C. Authorized CLASP mutations

`clasp push`, `version`, and `deploy` remain governed by [deployment.md](./deployment.md) and explicit production authorization. This policy does not weaken those controls.

### D. One-off GAS-runtime functions (editor)

When validation genuinely requires Apps Script runtime (Drive-bound properties, `CoreLib` in project context, live eligibility against SFDC sheets, etc.):

1. Agent completes A–C as far as possible.
2. Agent emits **GAS EDITOR ACTION REQUIRED** (see template below).
3. Jeff runs the named function once in the correct Apps Script project and returns **sanitized** execution output (counts, statuses, booleans—no IDs, PII, comments, or source rows).
4. Agent resumes from that evidence without repeating completed local/read-only work.

### E. Normal production automation

Production processing uses **installed triggers** and normal GAS runtime—not Execution API from a laptop.

## On `403 PERMISSION_DENIED` from Execution API

Record the limitation **once**, then move to editor fallback. **Do not** repeatedly:

- retry `scripts.run` or `clasp run`;
- re-login solely for Execution API;
- add OAuth scopes solely for Execution API;
- create/recreate API executable deployments;
- change Apps Script source, manifests, GCP project linkage, or production infrastructure;
- diagnose the **application** as broken because remote execution failed.

## GAS editor handoff template

Agents should stop with this shape (customize function and expectations):

```text
GAS EDITOR ACTION REQUIRED

Project: <e.g. External Data Manager>
Run: <exactFunctionName>(<args if any>)

Expected sanitized output:
- <field/count/status only>
- ...

Do not paste: script/sheet/folder IDs, PII, customer comments, or source row payloads.
```

## CSAT Responses and future EDM adapters

Controlled canaries (CSAT Responses storage, future **SLG Capacity** and other adapters) must **not** require Execution API for production. Design for:

- local preflight + authorized push/deploy;
- editor-run controlled ops for first-write proof;
- triggers or scheduled/manual GAS entry points for steady-state ops.

See [docs/agent/csat-responses-storage-canary.md](../../../docs/agent/csat-responses-storage-canary.md) for the SLG Responses canary split between agent and editor steps.

## EDM pointers

- Architecture and properties: [docs/agent/external-data-manager.md](../../../docs/agent/external-data-manager.md)
- Qualtrics V1 ops: [docs/agent/edm-qualtrics-v1-runbook.md](../../../docs/agent/edm-qualtrics-v1-runbook.md)

Optional API executable deployments in EDM are **developer convenience only**; they are not a runtime dependency and are not assumed available to agents.
