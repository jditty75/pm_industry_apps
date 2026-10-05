# Production deployment log

Append-only release records. Deployment IDs match per-app `gas.config.json` (not Script IDs).

### 2026-10-05 — SLG_DM — deploy

- Git source: `c96847d` (CoreLib v139 consumer pin baseline; staged manifest-only clasp push)
- Deployment ID: `AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA`
- Previous GAS version: 191
- Live GAS version: 192
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec
- Description: CoreLib v139 baseline pin normalization (immutable 139, exit developmentMode HEAD)
- Verification: staged push verified SLG Code.js without `_debugNotableDataPipeline`; production deploy completed
- Result: success
- Authorized by: User (execute DM CoreLib 139 baseline migration, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

### 2026-10-05 — EVI_DM — deploy

- Git source: `c96847d` (CoreLib v139 consumer pin baseline; staged manifest-only clasp push)
- Deployment ID: `AKfycbw1I6aXuRrWblrCnyMOMvpTULaDs_Ib_gPVwxiP4slmddTGXflY5BWqgMoZhaC3ltUfeA`
- Previous GAS version: 28
- Live GAS version: 29
- Production URL: https://script.google.com/a/macros/workday.com/s/AKfycbw1I6aXuRrWblrCnyMOMvpTULaDs_Ib_gPVwxiP4slmddTGXflY5BWqgMoZhaC3ltUfeA/exec
- Description: CoreLib v139 baseline pin normalization (EVI rollback CoreLib pin baseline remains 113)
- Verification: staged manifest-only push; production deploy completed
- Result: success
- Authorized by: User (execute DM CoreLib 139 baseline migration, 2026-10-05)
- CLASP user: jeffrey.ditty@workday.com

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
