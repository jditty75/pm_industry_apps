# SETUP — forecastdashboard

> Descriptive only. **No setup, deployment, `clasp`, `npm`, or API action was executed.** Everything below is derived from static reading of tracked files.
> Label key: `[VERIFIED]` observed in code · `[INFERRED]` deduced · `[UNKNOWN]` not determinable from repo.

---

## 1. Prerequisites

| Requirement | Detail | Evidence |
|-------------|--------|----------|
| Google Workspace domain account | App access is `DOMAIN`-restricted | `appsscript.json` (dev & main) `access: "DOMAIN"` |
| A Google Sheet to bind the script to | Container-bound project; code uses `SpreadsheetApp.getActiveSpreadsheet()` | `Code.js:87,313,462` |
| Apps Script V8 runtime | `runtimeVersion: "V8"` | `appsscript.json` |
| Sheets Advanced Service (v4) enabled | `dev` manifest enables `Sheets` | `appsscript.json` (dev) `enabledAdvancedServices` |
| `clasp` (for push/deploy) `[INFERRED]` | `.clasp.json` + `.claspignore` present on `dev` | `.clasp.json`, `.claspignore` |
| **`dev` Gemini path:** Workday AI Hub Docker proxy on `localhost:5000` + Workday VPN | Browser calls the local proxy directly | `Gemini.js:12-20,442` |
| **`main` Gemini path:** a `GEMINI_API_KEY` Script Property | Gemini Developer API key | `Code.js:256-258` |

---

## 2. Required Google Workspace resources & spreadsheet assumptions

The backend looks up sheets by name (case-insensitive `find` for some). Missing the forecast sheet throws; others degrade to empty arrays `[VERIFIED]` `Code.js:322-377`.

| Tab name (expected) | Purpose | Evidence |
|---------------------|---------|----------|
| `Current Forecast` (matched by substring "Current Forecast") | Primary weekly hours forecast; **date columns become week headers** | `Code.js:322,344-350` |
| `Consulting Forecast - Skills HCM` | HCM skills | `Code.js:323` |
| `Consulting Forecast - Skills PATTS` | PATTS skills | `Code.js:324` |
| `Consulting Forecast - Skills FIN` | FIN skills | `Code.js:325` |
| `Consulting Forecast - Skills Student` | Student skills | `Code.js:326` |
| `Consulting Forecast - Skills Technical` | Tech skills | `Code.js:327` |
| `Consulting Forecast - Skills Modular` | Modular skills (Yes/No) | `Code.js:328` |
| `The Shield` (or substring "Shield") | Utilization; read from IMPORTRANGE source via Sheets API | `Code.js:329,88,180-224` |
| `Employee Manager Hierarchy` | Org hierarchy (People-Lead chain) | `Code.js:330` |
| `AppMetaData` | `LastUpdated` timestamp + user | `Code.js:445-456` |
| `ConsultantNotes` | Free-text notes (Worker, Note, Author, Timestamp) | `Code.js:1296,1343` |
| `SoftBookings` | Planning-only bookings (auto-pruned 45 days) | `Code.js:1374-1379` |
| `AppUsageAnalytics`, `SessionLog`, `FeatureUsageLog`, `GeminiQueryLog`, `PerfLog` | Auto-created analytics logs | `Code.js:463,510,531,559,595` |

**Range assumptions `[VERIFIED]`:** Utilization source is discovered by parsing an `IMPORTRANGE("<id-or-url>","Sheet!Range")` formula in the first two rows / first 10 columns of `The Shield` (`Code.js:102-119,184-201`). Week columns are any header cell parseable as a date, formatted `MM/dd/yy Qx` (`Code.js:344-350,387-395`).

**Drive resources `[VERIFIED]`:** folders `ForecastDashboard_SavedViews` (`Code.js:625`) and `Forecast Dashboard Exports` (`Code.js:736`) are auto-created.

---

## 3. Required Apps Script files & configuration

`.claspignore` pushes only `.js/.html/.json` (Apps Script's accepted types) and excludes `*.md`, `*.docx`, `node_modules`, `.git`, and a local `SOW reviewer app example/` reference folder `[VERIFIED]` `.claspignore`.

Core server file: `Code.js`. Client files are `*.js.html` fragments included into `Index.html`/`Admin.html`/`Analytics.html` via `<?!= include('X.js'); ?>` (e.g. `Index.html:921` includes `Gemini.js`). Manifest: `appsscript.json`. `clasp` pin: `.clasp.json` (contains a `scriptId` — **treat as sensitive**, see SECURITY_REVIEW §API-key handling).

---

## 4. Required Script Properties (names only — never values)

| Property name | Branch | Purpose | Evidence |
|---------------|--------|---------|----------|
| `GEMINI_API_KEY` | `main` only | Gemini Developer API key read at call time | `Code.js:256` |
| _(none)_ | `dev` | The `dev` Gemini path uses **no** Script Property; auth is delegated to the localhost CIS proxy | `Gemini.js:12-20` |

> **Do not print the value of `GEMINI_API_KEY`.** If present on a live script, verify it is not exposed to the client and rotate if it ever was.

---

## 5. Required OAuth scopes and why (auto-inferred; no explicit list)

Neither manifest declares `oauthScopes` `[VERIFIED]` (grep found none), so Apps Script infers them from API usage. Based on the APIs actually called:

| Inferred scope | Why needed | Evidence |
|----------------|-----------|----------|
| `.../auth/spreadsheets` (+ current spreadsheet) | Read/write bound sheet & log tabs | `Code.js:87,313,463,559` |
| `.../auth/drive` (or `drive.file`) | Create/move/trash export files, saved-view files, ownership transfer | `Code.js:625,687,831,844` |
| Sheets Advanced Service (Sheets API v4) | `Sheets.Spreadsheets.Values.get` on IMPORTRANGE source | `Code.js:203`, `appsscript.json` (dev) |
| `.../auth/script.external_request` | `UrlFetchApp.fetch` to Drive REST export (dev); Gemini Developer API (main) | `Code.js:878` (dev), `Code.js:322` (main) |
| `userinfo.email` / `Session.getActiveUser` | Identity for logs, notes, ownership transfer | `Code.js:368,464,832` |

> **Note:** In `dev`, the browser's `fetch()` to `localhost:5000` and to the CIS endpoint is a **browser** network call, **not** an Apps Script `UrlFetchApp` call, so it does **not** require `script.external_request` and is not subject to GAS URL allow-listing `[VERIFIED]` `Gemini.js:398,419`.

---

## 6. Required external APIs & cloud permissions

| Path | External dependency | Notes |
|------|--------------------|-------|
| `dev` | Workday CIS AI Hub proxy (`localhost:5000`) → Workday CIS → GCP `gemini-2.5-flash`; header `Wd-PCA-Feature-Key: sow-reviewer,developer-workstation` | Requires running the AI Hub Docker container + Workday VPN `[VERIFIED]` `Gemini.js:16-20,442` |
| `main` | Google Generative Language API (`generativelanguage.googleapis.com/v1beta`) | Requires an enabled API key project `[VERIFIED]` `Code.js:261` |
| both | Drive REST export endpoint `www.googleapis.com/drive/v3/files/{id}/export` with `ScriptApp.getOAuthToken()` | xlsx generation `[VERIFIED]` `Code.js:876-880` |

---

## 7. Local development & deployment observations (not executed)

- Monorepo convention (workspace `.cursorrules`): `npm run push` deploys to HEAD (DEV), `npm run deploy` cuts immutable versions. **Not run here.** `[INFERRED]`
- `.clasp.json` pins a single `scriptId`; `rootDir: "."` `[VERIFIED]`.
- `dev` deploys as `USER_DEPLOYING` (runs as script owner) with `DOMAIN` access; export functions include ownership-transfer logic precisely because the owner-context files must be handed to the requesting user (`Code.js:835-856`) `[VERIFIED]`.
- `main` deploys as `USER_ACCESSING` `[VERIFIED]` `appsscript.json` (main).
- AI sidebar is gated behind `?ai=1` in the app URL `[VERIFIED]` `Main.js:118-123`, `REFERENCE_GUIDE.md:426`.

---

## 8. Validation checklist (descriptive, NOT executable)

- [ ] Script is bound to a spreadsheet that contains all tabs in §2.
- [ ] `The Shield` row 1–2 contains an `IMPORTRANGE(...)` formula pointing at the utilization source.
- [ ] Sheets Advanced Service (v4) is enabled on the project (dev).
- [ ] Web app deployed with the intended `executeAs` / `access` for your governance model.
- [ ] For `dev`: Workday AI Hub proxy is running locally and VPN is connected (sidebar shows "AI proxy connected", `Gemini.js:400-406`).
- [ ] For `main`: `GEMINI_API_KEY` Script Property is set (value never logged/printed).
- [ ] Analytics log tabs auto-create on first use; confirm they are access-controlled like the rest of the sheet.
- [ ] Confirm end-user reference guide matches the deployed AI design (currently stale, §10).

---

## 9. Known unknowns (cannot be confirmed from source)

- Exact OAuth scopes granted on the live deployment.
- Whether `GEMINI_API_KEY` is currently set and whether it was ever exposed.
- The CIS proxy's internal endpoint URL, auth, quota, and data-retention behavior.
- Which branch/version is the production deployment.
- The bound spreadsheet's sharing scope and who can read the log tabs (which contain user emails + full prompts).
- Whether a Google Cloud project / Vertex AI is involved anywhere (no Vertex references found in code).

---

## 10. Documentation drift to fix during real setup

`REFERENCE_GUIDE.md:426` ("requires a configured API key") and `:432` ("anonymized snapshot") describe the **`main`** design. The **`dev`** code sends real names through the CIS proxy and uses no API key. Reconcile the guide with whichever design is deployed before onboarding users. `[VERIFIED]`

### Verified / Inferred / Unresolved summary
- `[VERIFIED]`: tab names, Drive folders, Script Property name (main), manifest settings, `?ai=1` gate, no explicit scopes, CIS proxy constants.
- `[INFERRED]`: clasp workflow, dev = active branch, enterprise rationale for dropping anonymization.
- `[UNKNOWN]`: live scopes, key state, CIS internals, deployed branch, sheet sharing.
