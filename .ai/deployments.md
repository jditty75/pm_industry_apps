# Production deployment log

Append-only release records. Deployment IDs match per-app `gas.config.json` (not Script IDs).

### 2026-10-02 — SLED_Marketing — deploy

- Git source: `f9fe0aa` (`docs(sled-marketing): clarify runSelfTest is editor-only`)
- Deployment ID: `AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun`
- Previous GAS version: 4
- Live GAS version: 5
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun/exec
- Description: Production: docs(sled-marketing) runSelfTest JSDoc (git f9fe0aa)
- Verification: per user-authorized production deploy workflow
- Result: success
- Authorized by: User (explicit deploy request, 2026-10-02)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-02 — SLED_Marketing — rollback

- Git source: `f9fe0aa` (unchanged on `main`; rollback did not revert Git)
- Deployment ID: `AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun`
- Previous GAS version: 5 (production had served git `f9fe0aa` source at deployment @5)
- Live GAS version: 4
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbx00XznZNnEojwGBwgQoAAs6jJQE25LgCtEStqmVDeRffm25Q7jSyYCFSLwiKM-sRun/exec
- Description: Rollback: restore Apps Script version 4 (pre git f9fe0aa prod @5)
- Verification: per user-authorized rollback workflow
- Result: success
- Note: Apps Script **HEAD** / development source was not reverted by this rollback; only the configured production deployment was repointed.
- CLASP user: jeffrey.ditty@workday.com
