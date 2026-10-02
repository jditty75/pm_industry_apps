# Production deployment log

Append-only release records (no Script IDs). Deployment IDs match per-app `gas.config.json`.

## 2026-10-02 — SLED_Marketing

| Field | Value |
|-------|--------|
| App | `solutions/SLED_Marketing` |
| Git SHA | `f9fe0aa` |
| Commit | `docs(sled-marketing): clarify runSelfTest is editor-only` |
| Production deployment ID | `AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun` |
| Apps Script deployment | `@5` |
| Description | Production: docs(sled-marketing) runSelfTest JSDoc (git f9fe0aa) |
| URL | https://script.google.com/a/macros/workday.com/s/AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun/exec |
| Authorized by | User (explicit deploy request, 2026-10-02) |
| CLASP user | jeffrey.ditty@workday.com |

## 2026-10-02 — SLED_Marketing (rollback)

| Field | Value |
|-------|--------|
| App | `solutions/SLED_Marketing` |
| Action | Production rollback (user-authorized) |
| Failed / rolled back from | Apps Script deployment **@5** (script version **5**, git `f9fe0aa`) |
| Restored to | Script version **4** on same production deployment ID |
| Production deployment ID | `AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun` |
| Apps Script deployment (after) | **@4** — Rollback: restore Apps Script version 4 (pre git f9fe0aa prod @5) |
| URL | https://script.google.com/a/macros/workday.com/s/AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun/exec |
| Git note | `main` still contains `f9fe0aa`; only live deployment was repointed. Apps Script **HEAD** may still reflect version 5 source until a future push. |
| CLASP user | jeffrey.ditty@workday.com |
