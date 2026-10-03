# DHM / CoreLib Configuration Inventory & Specification

Scope: `libraries/DepMngr` (CoreLib) and its five consumers — `SLG_DM`, `HC_DM`,
`HENP_DM`, `AI_DM`, `EVI_DM`. Produced by static, read-only discovery across
`CoreConfig.js`, `CoreData.js`, `CoreReport.js`, `CoreUI_Markup.js`, `CoreUI_Js.js`,
`CoreDistribute.js`, `CoreUsers.js`, `CoreSalesforce.js`, `CoreFreshnessMonitor.js`,
`CoreNotify.js`, `CoreTrends.js`, `CoreNotable.js`, `CorePortfolioHealth.js`,
`CorePortfolioMomentum.js`, `CoreAnalytics.js`, `CoreExecSummary.js`, `CoreUtils.js`,
and each app's `Config_*.js` / `WebAppCode.js` / `Code.js`.

No files were modified, staged, or committed to produce this report. All line numbers
refer to the current working-tree state (some files have uncommitted local edits per
`git status`; those are still the authoritative current behavior).

---

## 1. Executive Summary

### How `APP_CONFIG` drives behavior

Each `*_DM` app declares one global `APP_CONFIG` object (matching the `AppConfig`
typedef documented at the top of `CoreConfig.js`). Every CoreLib entry point takes
`APP_CONFIG` (or a `CoreConfig.withDefaults(APP_CONFIG)`-normalized copy) as an
explicit argument — there is no per-app branching inside CoreLib (`if (appId ===
'HC')`); all behavioral differences are supposed to live in config. In practice this
holds well for report/UI cosmetics and is nearly perfect for the ProductMode vs
IndustryMode split, but two structural exceptions exist:

- `CoreConfig.withDefaults()` deep-clones the app's config and fills in defaults for
  most blocks — but **not for `student.*`**. The `StudentConfig` typedef says "absent
  = off," and that is enforced by every consumer checking `cfg.student.enabled ===
  true` explicitly — but nothing normalizes or validates the shape underneath, so a
  malformed `student.*` sub-key fails silently or throws deep inside a consumer rather
  than being caught by config validation.
- A handful of keys are declared and read by app configs (`report.portfolioHealth.
  exportSlidesEnabled`, `momentum.dataSource`, `momentum.timeRange`,
  `momentum.growthMetricSeries`, `momentum.dateStrategy`, `momentum.periodView`,
  `momentum.industryGrowthStrategy`) but are **not seeded by `withDefaults()`** — they
  work today only because consumers have inline `||` fallbacks, but they bypass the
  central config contract.

### Major configuration categories

| Category | Blocks | What it controls |
|---|---|---|
| Identity & data location | `appId`, `sheets`, `namedRanges`, `columns` | Which spreadsheet tabs/columns are read. `columns.deployments`/`columns.goLives` are largely superseded by a header-name resolver (see §5) but still exist. |
| Data shaping / source resolution | `activeDeployments.*` (ProductMode), `salesforce.*`, `freshness.*`, `notify.*`, `deploymentHealthPlan.*`, `executiveWatch.*` | What rows exist, how they're filtered/grouped, and whether the pipeline surfaces staleness/notification signals. |
| UI shell & tabs | `ui.appTitle/headerTitle/headerSubtitle/tabs`, `ui.roleVisibility`, `ui.deploymentsTable`, `ui.goLivesTable`, `ui.goLivesTab`, `ui.mgmPglTab`/`csatTab`, `ui.manageOverrides`, `ui.editModal`, `ui.personalization`, `ui.productFilter`, `ui.notable` | What the web app looks like and which tabs/rows/columns a given role sees. |
| Feature module: Student (HENP only) | `student.*` | HENP's separate Student-deployment tab, its own sheet, edit modal, and cross-tab banner. |
| Monthly report | `report.*` (title/logos/tables/barConfig/windows/topMessage/productScope/sections/portfolioHealth/distribution) | The emailed/exported Monthly Report — three separate render paths (inline, Outlook, V2/Gmail) with inconsistent config coverage (see §5). |
| Analytics | `trends.*`, `momentum.*`, `CorePortfolioHealth` (via `report.portfolioHealth`) | Trends tab benchmarks/outliers, Portfolio Momentum chart (platform-mode vs product-mode), Portfolio Health snapshot + Slides export. |
| Peer feature: Notable Deployments | `notable.*`, `ui.notable.enabled` | Mariah's curated "Notable Deployments" peer-sheet integration. |

### Power User menu suitability, at a glance

- **Safe (cosmetic / low blast-radius):** report title/logos/footer text, `report.
  topMessage`, `redYellowOwnerLabel`, `ui.headerSubtitle`, `ui.editModal.ownerOptions`.
- **Advanced/Admin (changes what data appears or who receives what, but no data-loss
  risk if wrong):** report windows (with the caveat in §5 that there are four
  similarly-named window settings), `report.distribution.to/cc/bcc/subjectTemplate`,
  `ui.mgmPglTab.goLiveEventClusterDays`, `ui.roleVisibility`, `report.portfolioHealth.
  industryBuckets`, `ui.personalization.*`.
- **Developer-only (deep coupling to the Salesforce schema / ingest pipeline; wrong
  values silently drop or misclassify data):** `sheets.*`, `columns.*`,
  `activeDeployments.productMode*`, `salesforce.statusValues`, `momentum.platforms` /
  `productAreaMapping` / `dataSource`, `report.productScope`.
- **Not wired / do not expose:** see the full list in §5 — several config keys are
  pure dead weight (typedef-only or superseded), and exposing them would train users
  to expect an effect that never happens.

---

## 2. Global Config Inventory

Legend for **PU suitability**: `Safe` / `Advanced` / `Dev-only` / `Dead`.

### 2.1 `appId`

| | |
|---|---|
| Type | string |
| Default | none (required) |
| Consumers | Everywhere — report titles, log prefixes, Script Properties keys (`freshnessAlertState:<appId>`), diagnostic gates (e.g. `cfg.appId === 'HENP'`) |
| Behavior when changed | Changing it after go-live breaks any Script-Properties state keyed by the old id (freshness alert anti-spam state) and any hardcoded `appId ===` checks (HENP student diagnostics) |
| Apps | All (`SLG`, `HC`, `HENP`, `AI`, `EVI_DM` — note EVI's literal value is `'EVI_DM'`, not `'EVI'`, an inconsistency vs the other four) |
| PU suitability | **Dev-only** |
| Risk | High — effectively an identity key baked into diagnostics and persisted state |

### 2.2 `sheets.*`

| Key | Default | Consumer | Effect | PU suitability | Risk |
|---|---|---|---|---|---|
| `activeDeployments` | none (app-declared) | Legacy `ActiveDeployments` tab reads | Source tab name | Dev-only | Wrong name → empty dataset, mostly silent |
| `goLives` | none | Legacy `Go Lives` tab reads | Source tab name | Dev-only | Same |
| `deploymentOverrides` | `'DeploymentOverrides'` | `getDeploymentOverridesMap_` (CoreData.js:749) | Sheet backing per-deployment overrides | Dev-only | **Wrong/missing name → function returns `{}` silently, no error, no log** — overrides silently stop applying |
| `goLivesOverrides` | `'GoLivesOverrides'` | `getGoLivesOverridesMap_` (CoreData.js:826) | Same, for go-live-level overrides | Dev-only | Same silent-empty-map risk |
| `deploymentsMeta` | `'DeploymentsMeta'` | `getDeploymentsMetaMap_` | Meta/notes overlay | Dev-only | Low-moderate |
| `changeLog`, `execSummary`, `healthReportSnapshots`, `healthMonthlySummary`, `healthYtdSummary`, `dashboard` | per-key defaults | Report/analytics tab lookups | Tab names for legacy report sections | Dev-only | Low |
| `appUsers` | `'AppUsers'` | `CoreUsers` role lookups | Source of truth for role assignment | Dev-only | **High** — wrong name breaks all role resolution (defaults everyone to READ_ONLY) |
| `ddAssignment` | `'DD Assignment'` | DD-assignment lookups | Delivery Director source | Dev-only | Medium. **Note:** HC_DM, HENP_DM (and likely SLG) declare this as `'DD'`, not the CoreConfig default `'DD Assignment'` — confirm the literal tab name matches the sheet before ever "resetting to default" |
| `sfdcDeploymentProductFunctions` | `'SFDC_DeploymentProductFunctions'` | ProductMode PF reads, Student matching, Momentum PF source | Source tab for per-product-function rows | Dev-only | High for ProductMode apps |
| `deployments` | `'SFDC_Deployments'` | `readSfdcDeploymentsRaw_`, freshness primary sheet | The core deployment source-of-truth tab | Dev-only | **High** |
| `deploymentContacts` | `'SFDC_DeploymentContacts'` | `getDeploymentContactsMap_` | Contacts overlay | Dev-only | Medium |
| `sfdcContacts` | **no default in `withDefaults()`** despite being in the typedef | `getDdAssignmentsFromContacts_` (CoreSalesforce.js:271) | DD-from-Contacts resolution | Dev-only | **High / silent** — if an app never sets this explicitly, the function fails open to `{}` with only a log warning; DD-from-Contacts (and anything downstream, e.g. notification recipient resolution) silently returns nothing |
| `wellness`, `csatInFlight` | `'SFDC_Wellness'`, `'CSAT_InFlight'` | Executive Watch, CSAT-in-flight upload | Source tabs | Dev-only | Medium |
| `deploymentHistory` | **not in the `AppSheetsConfig` typedef, no default** | Trends history queries | Custom key every app declares as `'SFDC_DeploymentHistory'` | Dev-only | Low (all 5 apps declare it consistently) |

**Not read anywhere in the data layer:** `execSummary`, `healthReportSnapshots`,
`dashboard`, `appUsers`, `ddAssignment` are not touched by `CoreData.js` /
`CoreSalesforce.js` / `CoreFreshnessMonitor.js` / `CoreNotify.js` — they're consumed
in `CoreReport.js`/`CoreUsers.js`/`CoreUI_*` instead (not dead, just outside the data
layer).

### 2.3 `namedRanges.healthTotal`

Default `'HealthTotal'`. Locates the Health-total bar table in the legacy report.
Every app uses the default. **PU suitability: Dev-only.** Risk: low but a wrong name
breaks the legacy (non-V2) report's Health bar table silently (falls through to
"table not found").

### 2.4 `columns.deployments` / `columns.goLives`

- **Structural note:** none of the five apps actually nest a `columns.deployments`
  object — all five declare the deployment column map as **flat keys directly under
  `columns`** (24 keys: `DEPLOYMENT_ID`…`CURRENT_DEPLOYMENT_UPDATE`), with only
  `columns.goLives` nested. This differs from the shape implied by the
  `ColumnsConfig` typedef in `CoreConfig.js` (which documents `columns.deployments`
  as a sub-object) — worth reconciling before any tooling assumes the typedef shape.
- **`columns.goLives` is confirmed fully dead library-wide** — a whole-repo grep found
  no reader beyond its own default assignment in `CoreConfig.js`. All current Go-Lives
  logic sources from the Salesforce enrichment map and header-first readers, not this
  10-key hardcoded index block.
- **`columns.deployments`** (or the flat top-level `columns.*` in practice) is used
  only as a **secondary fallback/validation** input to the SFDC_Deployments
  header-first resolver (`_resolveSfdcDeploymentsColumnIndices_`, CoreData.js:5923),
  and as a rejected-fallback/diagnostic value — the header-first resolver is what
  actually runs in production for any sheet with recognizable Salesforce Connector
  export headers (which is all of them today). A stale/wrong value here is logged and
  ignored, not fatal.
- **PU suitability: Dev-only** (both). **Do not expose `columns.goLives`** at all — it
  is dead. **Risk:** low in practice (superseded), but conceptually confusing since the
  typedef/comments suggest it's load-bearing.

### 2.5 `report.*`

| Key | Default | Consumer(s) | Effect | Valid values / boundaries | Apps using non-default | PU suitability | Risk |
|---|---|---|---|---|---|---|---|
| `report.title` | `'Deployment Health Report'` | All 3 report shells | `<title>`/header text | Any string | All 5 (all override) | **Safe** | None |
| `report.headerLogoUrl` | none | Outlook + V2 shells only — **inline shell hardcodes its own SVG and never reads this key** | Header logo image | Must be a reachable image URL | All 5 (brandfetch CDN URL) | Advanced | Broken URL → blank/broken image in 2 of 3 renderers, none in the third — inconsistent by design |
| `report.sanaLogoUrl` | none | All 3 shells' footers | Footer logo | Any URL; falsy → `<img>` omitted, no broken-image risk | All 5 | Safe | None |
| `report.footerAttribution` | `''` | All 3 shells' footers | Footer text | Any string; blank → empty `<strong>` | All 5 (all set a value) | Safe | None |
| `report.tables` | none (app-supplied array, backed by `TABLES` constant in each app's `Code.js`) | `CoreReport.js` table dispatch | Which sections render, in what order | Array of `{title/heading, namedRange, ...}` | All 5 declare 7 entries | **Dev-only** | High — malformed entries silently produce "table not found" |
| `report.barConfig` | none (backed by `BAR_CONFIG` in `Code.js`) | Bar-chart rendering for Health/Partner/Approach tables | Bar colors/mode/thresholds | `{columns, mode:'solid'\|'threshold', colors}` | All 5 declare 3 entries | Dev-only | Low-medium |
| `report.goLivesWindowDays` | `30` | **Only** `CorePortfolioHealth.js` (recent-go-lives window) and it seeds the default of `report.portfolioHealth.recentGoLivesWindowDays` | Portfolio Health "recent" window | Non-negative integer (days) | All 5 override to `60` | Advanced | See the four-windows confusion note below |
| `report.recentWindowDays` / `report.upcomingWindowDays` | `30` / `60` | **Only** the V2 (Gmail) report's Recent/Upcoming Go-Lives re-filter | Re-filters the already-fetched rows for the emailed report only | Non-negative integer | Not overridden by any app (all use the 30/60 default) | Advanced | See below |
| `report.redYellowPartnerFilter` | `null` | `getActiveDeployments`/Red-Yellow export | Restricts Red/Yellow section to one exact partner name | `null` (off) or exact case-sensitive partner string | All 5 = `null` | Advanced | A typo silently empties the section, no error |
| `report.includeIndustryRedYellow` | `false` | All 3 report shells | Adds an Industry column/chip to Red/Yellow tables | boolean | All 5 = `false` | Safe | None |
| `report.includeIndustryGoLives` | `false` | **Nowhere — confirmed dead, repo-wide** | n/a | n/a | n/a | **Dead** | n/a |
| `report.redYellowOwnerLabel` | `'Owner'` | Inline/Outlook (`|| 'Owner'`) and V2 (`|| 'EM'`) headers | Column header label | Any string | 4 of 5 override (`'Delivery Director'`, `'EM'`); HC uses `'EM'` | **Safe** | If explicitly set to `''`, inline/Outlook fall back to "Owner" while V2 falls back to "EM" — a cosmetic 2-vs-1 renderer inconsistency, only at the empty-string edge case |
| `report.sections.approach` | `true` | **V2 report only** — legacy inline/Outlook always render Approach unconditionally | Toggles the Approach breakdown section in the V2 email | boolean | All 5 declare `true` (no-op vs default) | Advanced | Setting `false` will NOT hide it from the inline/Outlook report — scope gap |
| `report.portfolioHealth.*` | see §2.6 | `CorePortfolioHealth.js` | Portfolio Health snapshot + Slides export | — | — | — | — |
| `report.distribution.*` | see §2.7 | `CoreDistribute.js` | Monthly-report email send | — | — | — | — |
| `report.productScope.*` | see §2.8 | V2 report + `CoreAnalytics` (opt-in) | Product-line filtering of report data | — | — | — | — |
| `report.topMessage.*` | see §2.9 | Emailed report banner (all 3 shells) | Monthly report banner | — | — | — | — |

**The "four windows" risk (important, flag prominently in any admin UI):** there are
four different, similarly-named "go-live window" settings living in three different
namespaces, with **different defaults** and **different consumers**:

| Key | Default | What it actually windows |
|---|---|---|
| `salesforce.recentWindowDays` / `.upcomingWindowDays` | 60 / 90 | The underlying data *fetch* — `CoreData.getRecentGoLives`/`getUpcomingGoLives` themselves |
| `ui.goLivesTab.recentWindowDays` / `.upcomingWindowDays` | 60 / 90 | Fallback for the above when `salesforce.*` unset, **and** the in-sheet Go Lives tab's own KPI window |
| `report.recentWindowDays` / `.upcomingWindowDays` | 30 / 60 | A **second, report-only re-filter** applied on top of already-fetched rows, **V2 email only** |
| `report.goLivesWindowDays` | 30 | A **fourth, separate** key, consumed only by Portfolio Health |

None of these cross-reference each other at runtime. The V2 emailed report's "Recent
Go-Lives" panel can show a materially different date range than the sheet's own Go
Lives tab purely from config drift, with no warning. **Any admin UI must either unify
these or label them with very explicit, distinct names** — do not expose all four
under a generic "Go-Live Window (days)" label.

### 2.6 `report.portfolioHealth.*`

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `title`, `workdayPartner`, `workdayLabel`, `otherLabel` | strings | Snapshot labels / Workday-vs-partner split labels | Safe | None |
| `industryMode` / `industryDisplayMode` | `'bucketed'` / `'bucketed'` | `'bucketed'` uses `industryBuckets`; `'all'` shows every raw industry; `'topNWithOther'` (display) caps + folds the rest into "Other" | Advanced | Wrong combination can produce an unreadable table (dozens of raw industries) |
| `industryTopN` | `10` | Cap when display mode is `topNWithOther` | Advanced | Low |
| `industryBuckets` | `[]` | Array of `{label, match:[...]}` — buckets raw industry/region values into named groups | Advanced | Low-medium — an unmatched value silently falls into an implicit "everything else" bucket |
| `recentGoLivesWindowDays` | derived from `report.goLivesWindowDays` (effectively 30 under current defaults, **not** 60 as the code comment implies — the `||60` fallback is dead under default config since `goLivesWindowDays` is already truthy by the time it's consulted) | Portfolio Health's own "recent go-lives" window | Advanced | See "four windows" note above |
| `historyWindowMonths` | `6` | Sparkline/trend trailing-months window | Advanced | Low |
| `slideExportEnabled` | `true` | **Not read in `CorePortfolioHealth.js` itself** — only read in `CoreUI_Markup.js`, combined there with an **undeclared sibling key `exportSlidesEnabled`** that doesn't exist anywhere in `CoreConfig.withDefaults()`. EVI_DM and AI_DM both declare `exportSlidesEnabled: true` explicitly — i.e., this is a real, load-bearing "off the books" key not documented in the central contract. | Dev-only (until reconciled) | Confusing — two similarly-named keys, only one of which is defaulted |
| `slidesExport.destinationMode` / `.folderId` | `'root'` / `''` | Where the exported Google Slides deck lands | Advanced | **Fails open silently** — a bad/inaccessible `folderId` just leaves the deck in Drive root (`{applied:false}`), no exception, easy to miss if the UI doesn't surface `destination.applied` |
| `slidesExport.shareMode` | `'inherit'` | **Reserved for future sharing — genuinely unimplemented by design, not a bug** | **Dead (by design)** | n/a |
| `slidesExport.filename` | template string | Deck title | Safe-ish (Advanced) | All 6 documented tokens (`{appName}`,`{appId}`,`{userEmail}`,`{date}`,`{timestamp}`,`{deckType}`) are implemented; unknown tokens pass through verbatim into the filename (sanitized for illegal filename characters, truncated to 180 chars) |

**Scoping caveat:** Slides export currently only functions for ProductMode apps in
"vNext" layout (`snapshot.vNext === true && snapshot.layoutMode === 'product'`) — the
classic SLG/HC/HENP portfolio-health path returns `NOT_VNEXT_PRODUCT` regardless of
`slideExportEnabled`.

### 2.7 `report.distribution.*`

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `enabled` | `false` | Master on/off for `sendMonthlyReport()` | Advanced | **`opts.force` (an internal call parameter) bypasses this gate entirely.** Also, `sendMonthlyReportTest()` never checks this flag at all — test sends work even when distribution is "disabled." |
| `fromAlias` | `''` | Which Gmail send-as alias is used | Advanced | Must be in `notify.allowedFromAliases` (a **different namespace**) or the send is skipped silently |
| `to` / `cc` / `bcc` | `[]` / `[]` / `''` | Recipients | **Advanced** | **Fully overridable at call time** via `opts.envelope.{to,cc,bcc}` with **zero allowlist validation** — any caller can redirect the report to arbitrary recipients. Empty `to` after resolution → silent skip, not an error. |
| `allowedSenders` | `['jeffrey.ditty@workday.com']` | *Intended* to restrict who may trigger a send | **Advanced (but see risk)** | **Not enforced anywhere inside `CoreDistribute.js`/CoreLib** — confirmed by whole-repo grep, zero consumers besides its own default. **Each app's `WebAppCode.js` independently re-implements this check** in `getReportSendConfigForUI`/`sendMonthlyReportFromUI`/`sendMonthlyReportTestFromUI` (duplicated boilerplate, not a CoreLib guarantee) — but the plain, menu-triggered `sendMonthlyReport()`/`sendMonthlyReportTest()` (reachable from the Sheets `onOpen()` menu in every app) call `CoreDistribute` directly with **no check at all**. **If this is ever surfaced in an admin UI as "who can send," it must be paired with fixing the menu-path gap — today it only restricts the web-app send buttons, not the spreadsheet menu item.** |
| `subjectTemplate` | `'{{appTitle}} — Monthly Deployment Health Report — {{monthLabel}}'` | Email subject | Safe | Only `{{appTitle}}` and `{{monthLabel}}` are implemented; unmatched `{{...}}` tokens pass through verbatim. **All 5 apps currently override this to a hardcoded literal app name instead of using the `{{appTitle}}` token** — functionally fine today, but means the token can't be validated against real app behavior without checking each app individually. |
| `logSheet` | `'ReportDistributionLog'` | Audit log tab (self-healing schema) | Dev-only | Every `sendMonthlyReport()` call writes one row (skipped/failed/sent); **`sendMonthlyReportTest()` never logs**, by design — an admin auditing this sheet will never see test sends |

**No true dry-run exists inside `CoreDistribute.js`.** `sendMonthlyReportTest()` is a
real live send (via `CoreNotify._gmailSend_`) to a single recipient with a `[TEST]`
banner — not a zero-send preview. A genuine preview uses `CoreReport.buildReportV2WithAnalytics`/`buildReport` directly.

### 2.8 `report.productScope.*`

| Key | Default | Effect |
|---|---|---|
| `enabled` | `false` (must be exactly boolean `true` to activate) | Master gate |
| `includeAreas` | `[]` | Product-area allow-list |
| `nameTokens` | `[]` | Case-insensitive substring tokens against deployment name |
| `aliases` | `{}` | Synonym map — both keys and values folded into the allow-set |

**Algorithm:** inclusion is a **three-way OR** — a row is in-scope if (a) a linked
product-function row's area is in the allow-set, OR (b) the row's own product-area
field matches, OR (c) the deployment name contains any `nameTokens` entry.
`includeAreas` and `nameTokens` are **unioned, not intersected**.

**Scope gap (important):** this filter is applied **only in the V2 (Gmail) monthly
report path**, plus opt-in call sites in `CoreAnalytics` (`opts.applyReportProductScope
=== true`). The legacy inline/Outlook report's Red/Yellow, Recent/Future Go-Lives
tables, and the default (no-opts) code-computed breakdown tables **never apply it**.
If an admin enables `productScope` expecting it to scope every export, the
inline/Outlook exports will silently ignore it. Currently used by EVI_DM (Evisort/CLM
tokens) and AI_DM (HiredScore/Paradox tokens) only.

**PU suitability: Dev-only** (requires understanding of the Salesforce
Product-Function schema and the OR-not-AND semantics to configure safely). **Risk:
high if misunderstood** — can silently over- or under-include deployments in the
monthly report.

### 2.9 `report.topMessage.*`

| Key | Default | Effect |
|---|---|---|
| `text` | absent | Blank/absent → **no banner at all**, confirmed (`msg = String(topMsg.text||'').trim(); if (!msg) return '';`) |
| `linkText` / `linkUrl` | absent | Both must be set **and** `linkUrl` must start with the literal string `https://` (case-sensitive, exact prefix) for the link to render. A partial config (only one of the two set, or a non-`https://` URL) silently drops the link — the plain-text banner still shows. |

Both `text` and `linkText`/`linkUrl` are HTML-escaped before insertion — **no XSS
risk** from a malicious/careless config value. Rendered identically in all three
report shells (inline, Outlook, V2). **Not rendered anywhere in the web app UI** —
purely an emailed-report feature. Currently used only by HENP_DM (Student-deployment
disclosure banner).

**PU suitability: Safe.** This is close to an ideal first Power-User-menu field —
plain text + a validated URL, fully escaped, fails closed to "no banner" on any
malformed input.

### 2.10 `salesforce.*`

| Key | Default | Consumer | Effect | PU suitability | Risk |
|---|---|---|---|---|---|
| `upcomingWindowDays` | `90` | `getUpcomingGoLives` and ProductMode go-live builders | Underlying fetch window for "upcoming" | Advanced (see four-windows note) | No validation of 0/negative — a 0-day window is technically valid but nearly useless |
| `recentWindowDays` | `60` | `getRecentGoLives` and ProductMode equivalents | Underlying fetch window for "recent" | Advanced | Same |
| `statusValues.active` / `.complete` | `'Active'` / `'Complete'` | ProductMode eligibility checks throughout `CoreData.js` | The literal Salesforce picklist string values that mean "active"/"complete" | **Dev-only** | **High** — if Salesforce ever renames the `Overall_Status__c` picklist values, every app must update this in lockstep or ProductMode counting silently breaks; all 5 apps currently use the defaults |

### 2.11 `ui.*`

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `appTitle` / `headerTitle` / `headerSubtitle` | computed / mirrors appTitle / fixed string | Browser tab title (via `doGet().setTitle(...)`), header `<h1>`/`<p>` text | Safe | None — pure display strings, escaped |
| `tabs` (array of `{id,label}`) | 6-tab default | Which tabs exist and in what order; `id` is matched literally against a fixed set of known ids in `CoreUI_Markup.js`/`CoreUI_Js.js` — **an unrecognized `id` produces a dead tab button with no content and no validation anywhere** | Advanced (label text is Safe; adding/removing/reordering ids is Advanced/Dev, since there's no id-enum validation) | Medium — typo in an id silently produces a broken tab |
| `roleVisibility.{READ_ONLY,POWER_USER,ADMIN}` | see below | Server-side filters which tab **markup** is emitted for a given role | **Advanced/Admin** | **Important security nuance — see §5.** Gates markup only, not the underlying `google.script.run` data-fetch RPCs for several tabs (Notable, Student). |
| `deploymentsTable.*` | see CoreConfig defaults | Column visibility, missing-DD highlight, expandable rows, default health filter chips | Advanced | Low — cosmetic, but `defaultHealthFilter` changes what's shown by default (not what's fetched) |
| `goLivesTable.*` | see defaults | Column visibility on Go Lives table | Advanced | Low |
| `goLivesTab.mode` (`'legacy'`\|`'explorer'`) | `'legacy'` | Switches the **entire client control-flow** for the Go Lives tab (different data loader, different renderer) — not just a markup toggle | **Dev-only** (behaviorally large; test both modes before flipping) | Medium |
| `mgmPglTab` / `csatTab` | see §2.12 | MDS/PGL tab | — | — |
| `manageOverrides.showAuditTrail` | `true` | Whether the Audit Trail section renders **server-side** (fully omitted, not CSS-hidden) | Advanced | Low |
| `manageOverrides.bulkClearScopes` | `['monthly','all']` | **Confirmed dead** — the two bulk-clear buttons are hardcoded literals in markup, not generated from this array | **Dead** | n/a |
| `editModal.ownerFieldLabel` / `.ownerInputType` / `.ownerOptions` | `'Delivery Director'` / `'text'` / `[]` | Owner field label + control type (`text`\|`dropdown`\|`datalist`) + option list on the edit/meta modals | **Safe** (label/options) / Advanced (input type — literally swaps the HTML control type) | Low |
| `personalization.enabled` | `false` | Master gate for "My Portfolio vs All" default-view logic, welcome banner, and portfolio-size indicators | Advanced | Low-medium |
| `personalization.defaultViewMode` | `'myPortfolio'` | Initial view for role `DD` only — VP/PM always default to "all" regardless | Advanced | Low |
| `personalization.affectsTabs` | `['deployments','golives','overrides']` | **Confirmed dead** — every wired tab is filtered uniformly; there's no per-tab opt-out driven by this array | **Dead** | n/a |
| `personalization.welcomeMessageEnabled` / `.showFullPortfolioIndicator` | `true` / `true` | Secondary toggles under `personalization.enabled` | Safe | None |
| `productFilter.enabled` / `.hidden` | `false` / `false` | Whether the product-scope dropdown control is mounted at all (ProductMode apps) | Advanced | Low |
| `productFilter.areas` / `.aliases` | `[]` / `{}` | Dropdown option list + display-label overrides | Advanced | Low |
| `productFilter.nameTokens` | `{}` | **Not read in the UI layer** — confirmed live **server-side** (`CoreData.js`) for text-based product classification when structured PF data is unavailable | Dev-only | Medium |
| `productFilter.affectsTabs` | default array | **Confirmed dead**, same pattern as `personalization.affectsTabs` | **Dead** | n/a |
| `productFilter.defaultProduct` | `'all'` | **Confirmed dead** — client always initializes to `'all'` literally, ignoring this key | **Dead** | n/a |
| `notable.enabled` (`ui.notable.enabled`) | `true` | Whether the Notable tab id survives the role-filtered tab list at all | Safe | See §5 for the "markup-only gate" caveat |

### 2.12 `ui.mgmPglTab` / `ui.csatTab` (MDS/PGL — aliased pair, V2.8 renamed to CSAT internally)

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `enabled` | `true` | Whether the whole tab's markup is built at all | Advanced | Low |
| `defaultHorizon` | `3` | **Confirmed dead** — client hardcodes `horizonMonths: 3` regardless | **Dead** | n/a |
| `horizonOptions` | `[3,6]` | **Confirmed dead** — the two horizon toggle buttons ("3 Months"/"6 Months") are hardcoded literals in markup, not generated from this array | **Dead** | n/a |
| `goLiveEventClusterDays` | `0` (normalized via `CoreConfig.normalizeMgmPglGoLiveEventClusterDays_` — blank/negative/non-numeric all coerce to `0`) | **Server-side only** — consumed exclusively in `CoreData.js` (`_buildGoLiveEvents_` → `_clusterMdsPglGoLiveEvents_`); **never read by the front-end (`CoreUI_Js.js`) at all**. Merges a deployment's multiple MDS (target-date) or PGL (actual-date) go-live events into one row when their calendar dates fall within N days of each other, using a **chained/greedy** algorithm (compares each new date to the *last* date already in the open cluster, not the cluster's first date, so total cluster span can exceed N for closely-chained dates). MDS and PGL are clustered **independently** — never merged with each other. | **Advanced** — this is the single best-documented, most self-contained candidate for an admin-editable numeric field | Medium — a large value can silently merge unrelated events into one row; a value of `0` (default) disables clustering entirely (exact-date matching only) |

Current declared values: **HC_DM = `2`**; all other four apps leave it undeclared →
normalizes to `0`.

### 2.13 `student.*` (HENP_DM only)

`student` is **not defaulted by `CoreConfig.withDefaults()`** at all — every sub-key
below is used exactly as declared, with zero central validation/normalization.

| Key | HENP's declared value | Consumer | Effect | PU suitability | Risk |
|---|---|---|---|---|---|
| `enabled` | `true` | Every Student-aware function (`filterDeploymentsByStudent_`, `buildStudentTabData_`, `saveStudentDeploymentFields`, `CoreUI_Markup`/`CoreUI_Js` tab injection) checks this explicitly; absent/false = a documented "SLG/HC safety guarantee" no-op | Advanced | High if flipped carelessly on a non-HENP app — Student behavior is entirely gated on this one boolean, so it's cheap to test but changes a lot at once |
| `productAreaMatch` | `'Student'` | `CoreSalesforce.getStudentDeploymentIds_`/`getStudentProductFunctionsMap_` — exact, case-sensitive match against `Product_Area__c` | **Dev-only** | High — a typo silently produces zero (or wrong) Student deployments |
| `sheets.studentData` | `'StudentDeploymentData'` | `ensureStudentDataSheet_` | Custom Student notes/registration-date sheet | Dev-only | Medium |
| `tab.id` / `.label` / `.insertAfter` | `'student'` / `'Student'` / `'deployments'` | Splices the Student tab into the filtered tab list **after** role-based filtering runs — i.e., **independent of `ui.roleVisibility`** | Advanced (label) / Dev-only (id/insertAfter) | Low |
| `table.columns`, `.defaultStatusFilter`, `.defaultHealthFilter`, `.expandableRows` | declared (6 column tokens, `'active'`, `null`, `true`) | **Confirmed dead in the UI layer** — column list, order, and default filters are all hardcoded in `CoreUI_Markup.js`/`CoreUI_Js.js` | **Dead** | n/a |
| `table.searchPlaceholder` | `'Search Student deployments…'` | The **only** `student.table.*` key actually read | Safe | None |
| `editModal.notesMaxChars` | `2000` | Read **both** client-side (char counter) and server-side (`saveStudentDeploymentFields`, throws if exceeded) | Advanced | Low |
| **`editModal.allowedRoles`** | `['POWER_USER','ADMIN']` (declared) | **Confirmed dead, repo-wide.** The only occurrence anywhere in `libraries/DepMngr/src` is the JSDoc typedef comment in `CoreConfig.js:51`. No function reads it. | **Dead / do-not-expose** | **This is the specific item flagged for verification — confirmed dead by two independent agents.** The actual gate is the generic `CoreUsers.requirePowerUser_` (blanket "not read-only") check inside `saveStudentDeploymentFields` — **any** POWER_USER or ADMIN can edit Student rows today; there is no Student-specific role restriction despite the config field's name and declared value implying one exists. |
| `banner.enabled` / `.showOnTabs` / `.copy` / `.linkToken` | `true` / 6 tab names incl. `'reporting'` / disclosure text / `'{Student}'` | Cross-tab "Student deployments are tracked separately" banner | Safe (copy text) / Advanced (showOnTabs) | **`showOnTabs` includes `'reporting'`, which does not match any actual `ui.tabs` id (`'report'`) anywhere in the app — likely a naming typo; the banner probably never shows on the intended report-preview tab** |

### 2.14 `freshness.*` — two independent implementations (important)

There are **two separate, non-communicating freshness subsystems**:

**A. `CoreFreshnessMonitor.js`** (UI badge + multi-app daily rollup email) reads:
`primarySheet`/`watchSheet` (badge source), `logSheet`, `expectedSheets` (auto-derived
from `sheets.*` starting with `"SFDC_"` if unset), `refreshCycleHours`/`graceHours`/
`warningHours`/`criticalHours`/`amberHours`(alias)/`redHours`(alias) via its own
`resolveThresholds_`. **Does NOT read `freshness.enabled`, `freshness.alertRecipient`,
or `freshness.alertHours` at all** — the rollup email's recipient is a hardcoded
function parameter, not `cfg.freshness.alertRecipient`.

**B. `CoreData.js`** (`getDataFreshness`/`checkDataFreshnessAndAlert_`) — a completely
separate, single-app time-triggered stale-data alert with its **own** threshold math
(different variable names, different derivation) reading the **same** raw keys plus
the three the other subsystem ignores: `enabled` (master on/off for this alert path
only), `alertRecipient` (no fallback — if unset, silently skips sending), `alertHours`.
Maintains anti-spam state in `PropertiesService` keyed by `'freshnessAlertState:' +
appId`.

**Risk:** a change to threshold semantics in one implementation doesn't propagate to
the other. The UI badge can show "OK" while the separate per-app alert email is
silently disabled (missing `alertRecipient`) or vice versa, with no cross-check.

**PU suitability: Dev-only** for all of `freshness.*` — the two-implementation split
alone makes this unsafe to expose without first reconciling the code.

### 2.15 `notify.*` (generic notification-config sheet, distinct from `notable.notify`)

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `enabled` | `true` | Master gate for the entire daily `runNotifications` run (both EM-reminder and DD-digest types) | Advanced | Low |
| `configSheet` | `'NotificationConfig'` | Sheet backing per-notification-rule config | Dev-only | Medium |
| `testDefaultRecipient` | `'jeffrey.ditty@workday.com'` | Fallback recipient for `sendTestNotification` when no explicit recipient given | Safe | Low |
| `allowedFromAliases` | `['jeffrey.ditty@workday.com']` | **A `From:`-address allowlist, not a "who can send" gate.** Enforced in `_gmailSend_` and at config-validation time — a row/test whose `fromAlias` isn't in this list silently fails (no throw). Also gates which alias `report.distribution.fromAlias` may use. | **Advanced** | Low-medium — misconfigured alias silently blocks sends rather than erroring loudly |

Note: there is **no role-based gate** on who may call `sendTestNotification` inside
CoreNotify.js — that would need to live in each app's `Code.js`/`WebAppCode.js`
wrapper if desired.

### 2.16 `deploymentHealthPlan.*`

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `enabled` | `false` | Master opt-in — when off, DHP reads return `[]`/`hasHealthPlan:false` immediately | Advanced | Low — clean opt-in/opt-out |
| `sheetName` | `'SFDC_DHP'` | Source tab, own header-first keyword resolver | Dev-only | Medium |
| `issueCategoryDelimiter` | `';'` | Splits the multi-value `Issue_Category__c` cell | Dev-only | Low |
| `chipEnabled` | `true` | Read only in `CoreUI_Js.js` (UI chip visibility) | Advanced | Low |
| `expandedDetailsEnabled` | `true` | **No confirmed read found anywhere in the audited files** | **Unconfirmed — likely dead or UI-only elsewhere; do not expose until verified** | n/a |
| `metricsEnabled` | `false` | **No confirmed read found anywhere in the audited files** | **Unconfirmed — likely dead; do not expose until verified** | n/a |

Enabled for EVI_DM, AI_DM, SLG_DM; not declared (→ default `false`) for HC_DM,
HENP_DM.

### 2.17 `executiveWatch.enabled`

Default `true` — the classic "silent opt-in by omission" footgun. Only
`EVI_DM` explicitly sets `false`; **AI_DM, SLG_DM (explicit `true`, matches default),
HC_DM, HENP_DM all silently run with Executive Watch ON** because they never declare
the block. Gated exclusively through `CoreConfig.isExecutiveWatchEnabled()`; when off,
the entire Customer-Wellness ingestion/flagging subsystem behaves as if no wellness
data exists, without needing to touch the sheet. **PU suitability: Advanced** (a
single, well-isolated boolean with a clear on/off effect) — but flag AI_DM's silent
default as worth an explicit decision, since it's the one other ProductMode app and EVI
deliberately turned this off.

### 2.18 `overviewTab.*`

`enabled` is read (in `CoreUI_Markup.js`, gates the Overview tab markup).
**`topRedCount`, `upcomingGoLiveDays`, `recentGoLiveDays` are confirmed fully dead
library-wide** — grepped the entire `libraries/DepMngr/src` tree; the only hits for
each are their own default-assignment lines in `CoreConfig.js`. **PU suitability:
`enabled` = Advanced; the other three = Dead, do not expose.**

### 2.19 `trends.*` / `ui.trendsTab.*`

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `cacheTtlSeconds` | `3600` | `CacheService` TTL for 7 memoized Trends builders | Dev-only | Low (Apps Script caps effective TTL at 21600s regardless of a larger configured value) |
| `trendsWindowMonths` | `12` | Lookback for "recently completed" deployments feeding benchmarks | Advanced | Low |
| `timeInStageOutlierMultiple` | `2` | A deployment is an "outlier" if its stage duration ≥ multiple × benchmark median | Advanced | Low |
| `timeInStageMinSampleSize` | `10` | Minimum sample size before a stage's benchmark is usable for outlier flags | Advanced | Low |
| `byPartnerMinSampleSize` | `5` | Partners below this go-live count are **dropped entirely** (no caveat shown) from the By-Partner table | Advanced | Low-medium — could hide a legitimately small partner without explanation |
| `vNextEnabled` | `false` | Chooses the "v1 bundled" minimal shell vs the legacy five-tier layout | Advanced | Medium (large visual/behavioral difference) |
| `defaultWindow` | `'12m'` | **Confirmed dead in the UI layer** — neither markup nor client JS reads it | **Dead** | n/a |

### 2.20 `momentum.*`

**Mode is inferred, not configured** — `mode = platforms.length ? 'platform' :
'product'`. There is no explicit `momentum.mode` key. **Risk:** a platform app
(HC/SLG/HENP) with an accidentally-emptied `platforms` array silently flips into
product mode (wrong dataset, likely empty); a product app (EVI/AI) with a non-empty
`platforms` array silently flips into platform mode and ignores `productFilter`
entirely. **This mode-inference behavior itself should be flagged as the single
highest-risk footgun in the momentum config, worth fixing in code (adding an explicit
mode key) before ever exposing any momentum settings to a Power User.**

| Key | Default | Effect | PU suitability | Risk |
|---|---|---|---|---|
| `enabled` | `false` | Hard gate — `null` snapshot when off, no UI errors | Advanced | Low |
| `platforms` / `productAreaMapping` | `[]` / `{}` | Platform-mode series definitions | Dev-only | High per mode-inference risk above |
| `productFilter` / `chartLegend` | `{}` / `[]` | Product-mode row filter (OR of exact `Product_Area__c` match / `%wildcard%` deployment-name match) + series assignment (first-match-wins substring scan) | Dev-only | Medium-high |
| `dataSource` | not defaulted in `withDefaults()` (declared inline by every app) | Selects `SFDC_Deployments` vs `SFDC_DeploymentProductFunctions` as the source sheet; **also requires `activeDeployments.productModeUnionEnabled===true` together with the PF value** for the deployment-lookup path to actually use PF data — setting one without the other creates a partial mismatch | Dev-only | High |
| `timeRange` | not defaulted; parsed via `LAST_N_YEARS:(\d+)` regex, else falls back to `historicalYears` silently on any non-matching string | Historical window | Dev-only | Low-medium |
| `growthMetricSeries` | not defaulted; `'HCM'` if present else first series | KPI-3 series selection | Dev-only | Low |
| `kpiLabels` | `null` | Tile label templates (`{FY}` token only) | Safe | None |
| `chart.colors` / `.inProgressOpacity` | `{}` / `0.55` | Chart appearance, no validation of color format | Safe | Low |

---

## 3. Per-App Configuration Matrix

| | **SLG_DM** | **HC_DM** | **HENP_DM** | **AI_DM** | **EVI_DM** |
|---|---|---|---|---|---|
| `appId` (literal) | `'SLG'` | `'HC'` | `'HENP'` | `'AI'` | `'EVI_DM'` ⚠ inconsistent |
| App mode | IndustryMode | IndustryMode | IndustryMode + **Student-enabled** | **ProductMode** | **ProductMode** |
| `activeDeployments.productModeUnionEnabled` | absent (false) | absent (false) | absent (false) | `true` | `true` |
| ProductMode source/grain | — | — | — | `parentAndProductFunctionUnion` / parentDeployment grain | same |
| Configured sheets deviation | `ddAssignment='DD Assignment'`(default) | `ddAssignment='DD'` ⚠ | `ddAssignment='DD'` ⚠ | `ddAssignment='DD Assignment'`(default) | `ddAssignment='DD Assignment'`(default) |
| Report title | "State & Local Government Deployment Health Report" | "Healthcare Deployment Health Report" | "Higher Education & Non-Profit Deployment Health Report" | "HiredScore & Paradox Deployment Health Report" | "Evisort Deployment Health Report" |
| Report footer attribution | "Generated by the SLG Program Management team" | "Generated by the Healthcare Program Management team" | "Generated by the HENP Program Management team" | "Generated by the AI Program Management team" | "Generated by the Evisort Program Management team" |
| `report.productScope.enabled` | false (default) | false (default) | false (default) | **true** (HiredScore/Paradox) | **true** (Evisort/CLM) |
| Product include areas | — | — | — | `['Workday HiredScore','Workday Paradox']` | `['Contract Management and Document Intelligence']` |
| Product name tokens | — | — | — | `['HiredScore','Paradox']` | `['Evisort','CLM']` |
| `report.topMessage` configured? | No | No | **Yes** — "This report covers HENP Platform deployments only. Student deployments are tracked and reported separately." | No | No |
| `report.distribution.enabled` | false | false | false | false | false |
| `distribution.subjectTemplate` | custom, hardcoded app name (no `{{appTitle}}` token) | custom, same pattern | custom, same pattern | custom, same pattern | custom, same pattern |
| `distribution.allowedSenders` | `[jeffrey.ditty]` | `[jeffrey.ditty]` | `[jeffrey.ditty]` | `[jeffrey.ditty]` | `[sunil.wadhwa, earl.begonia, mridhula.raghupathy, jeffrey.ditty]` — the one app with a real multi-person sender list |
| `salesforce.upcoming/recentWindowDays` | 90/60 (default) | 90/60 (default) | 90/60 (default) | 90/60 (default) | 90/60 (default) |
| `ui.tabs` (count, notable additions) | 9 tabs: adds `trends`,`mgmPgl`,`notable` | 9 tabs: adds `mgmPgl`,`notable`,`trends` | 7 tabs: adds `notable` only (no `mgmPgl`, no `trends`, no `student` id — Student injected separately) | 8 tabs: adds `trends`,`notable` | 8 tabs: adds `trends`,`notable` |
| `ui.roleVisibility` declared? | No → default (10-entry POWER_USER/ADMIN, 3-entry READ_ONLY) | No → default | No → default | No → default | No → default |
| READ_ONLY visible tabs | default: deployments, golives, portfolio | same | same | same | same |
| POWER_USER / ADMIN visible tabs | default 10-id list (identical for both roles) | same | same | same | same |
| `ui.mgmPglTab.enabled` | `true` | `true` | **`false`** | **`false`** | **`false`** |
| `goLiveEventClusterDays` | not declared → **0** | **`2`** | not declared → **0** | not declared → **0** | not declared → **0** |
| Student enabled | No | No | **Yes** (only app) | No | No |
| Trends enabled (`ui.trendsTab.enabled`) | `true` (`vNextEnabled:true`) | **`false`** (yet `trends` tab is still listed in `ui.tabs` — harmless, properly filtered at render, but a confusing declared/enabled mismatch) | `false` (no `trends` tab id declared, consistent) | `true` | `true` |
| Notable enabled (`ui.notable.enabled`) | not declared → default `true` (and `notable` tab listed) | not declared → default `true` (and `notable` tab listed) | explicit `true` (and `notable` tab listed) | **explicit `false`** (yet `notable` **is** listed in `ui.tabs` — same harmless filtered-mismatch pattern) | **explicit `false`** (same pattern) |
| `ui.manageOverrides` | defaults (`showAuditTrail:true`, `bulkClearScopes` default) | defaults | defaults | defaults | defaults |
| `deploymentHealthPlan.enabled` | **true** | not declared → false | not declared → false | **true** | **true** |
| `executiveWatch.enabled` | explicit `true` (matches default — declared anyway) | not declared → silently `true` | not declared → silently `true` | not declared → silently `true` ⚠ (see note) | **explicit `false`** — the only app to opt out |
| `momentum.enabled` | `true` — platform mode: `['HCM','FIN','PAY']` | `true` — platform mode: `['HCM','FIN','PAY']` | `true` — platform mode: `['HCM','FIN','PAY','STU']` (includes a Student bucket) | `true` — product mode: `productFilter` on HiredScore/Paradox | `true` — product mode: `productFilter` on Evisort/CLM |
| `report.portfolioHealth.industryBuckets` | 2 buckets (SLG, Special Districts) | 5 buckets (Health Insurance, Acute Hospital, Ambulatory, Post Acute, Other Healthcare) | 2 buckets (Higher Education, Non-Profit) | `[]` (uses `industryMode:'all'`/`topNWithOther` instead) | `[]` (uses `industryMode:'all'`) |
| Most notable app-specific anomaly | `columns.deployments` and `columns.goLives` both fully custom 24/10-key overrides; duplicate `_debugSfdcColumns()` defined twice (Config_SLG.js **and** WebAppCode.js) — last-evaluated wins, latent bug | Config header comment ("HC has 14 columns, not 16") is **stale** vs. the actual 24-key columns block; `trends` tab listed while `trendsTab.enabled:false` | `banner.showOnTabs` includes `'reporting'`, which doesn't match any real tab id (`'report'`) — the Student cross-tab banner likely never shows on the report-preview tab | `appId:'AI'` doesn't opt out of Executive Watch even though it shares EVI's ProductMode/no-wellness shape — likely an oversight, not a deliberate choice | `appId` literal is `'EVI_DM'`, not `'EVI'` — the one app whose `appId` doesn't match the short-code convention used everywhere else (log prefixes, diagnostics) |

**Cross-app pattern findings (not app-specific, but visible only by comparing all
five):**

- **Three of five apps hardcode a live `WEB_APP_URL`** (SLG_DM, HC_DM, HENP_DM) in
  `Code.js`; AI_DM/EVI_DM leave it blank (`''`). CLAUDE.md §9 currently documents only
  `SLG_DM`'s instance as a known rule violation — **HC_DM and HENP_DM carry the same
  literal hardcoded exec URL and are not yet on that documented list.**
- **All five apps hardcode personal emails** (`jeffrey.ditty@workday.com`,
  `mariah.maxie@workday.com`) throughout `Config_*.js` (distribution defaults,
  freshness alert recipient, Notable notify target) rather than using
  `PropertiesService`. Consistent with the existing documented pattern, just more
  pervasive than the one example CLAUDE.md currently calls out.
- **`updateDeploymentWithMetaAndOverride(rowIndex, ...)` silently drops its
  `rowIndex` parameter** before calling into CoreLib, in every app that has this
  wrapper (confirmed in HC_DM, HENP_DM; same boilerplate pattern in the others) —
  likely dead/vestigial parameter, not app-specific.
- **Asymmetric send authorization**, present identically in every app: the plain
  menu-triggered `sendMonthlyReport()`/`sendMonthlyReportNew()` path does **no**
  `allowedSenders` check, while the web-app `*FromUI` variants (`sendMonthlyReportFromUI`,
  `sendMonthlyReportTestFromUI`) do their own re-check before calling CoreLib. This is
  boilerplate copy-pasted across all five `WebAppCode.js` files, not a per-app choice.
- None of the five apps declare `ui.roleVisibility` — all rely on the CoreConfig
  default, meaning any future change to the "safe default" role-visibility array in
  `CoreConfig.js` will silently ripple to every app simultaneously.

---

## 4. Power User Menu Candidate List

### A. Recommended Power User settings (safe, low blast-radius, easy to validate)

| Setting | Config path | Input type | Validation | Current values | Default | Expected output | Risk | Suggested role |
|---|---|---|---|---|---|---|---|---|
| Monthly Report Top Message | `report.topMessage.text` | Textarea | Plain text, HTML-escaped automatically | HENP: disclosure text; others: blank | absent = no banner | Blank → no banner; non-blank → banner appears in all 3 emailed-report renderers | Low | POWER_USER |
| Monthly Report Top Message Link | `report.topMessage.linkText` / `.linkUrl` | Text + URL | `linkUrl` must start with `https://`; both fields required together or link is dropped | None declared today | absent | Adds a clickable link inside the banner; malformed input silently degrades to plain-text banner (fails closed, safe) | Low | POWER_USER |
| Report Title | `report.title` | Text | Any string | Per-app custom | `'Deployment Health Report'` | `<title>`/header text everywhere | Low | POWER_USER |
| Report Footer Attribution | `report.footerAttribution` | Text | Any string | Per-app custom | `''` | Footer text | Low | POWER_USER |
| Red/Yellow Owner Column Label | `report.redYellowOwnerLabel` | Text | Any string | `'Delivery Director'`/`'EM'` per app | `'Owner'` | Column header text in Red/Yellow tables | Low (empty-string edge case creates a 2-vs-1 renderer inconsistency — validate non-blank) | POWER_USER |
| Owner Field Options (edit modal) | `ui.editModal.ownerOptions` | List of strings | Non-empty strings | SLG/AI: named roster; others `[]` | `[]` | Populates the dropdown/datalist for the DD/EM field | Low | POWER_USER |
| Header Subtitle | `ui.headerSubtitle` | Text | Any string | Mostly default text | fixed default | `<p>` under the header title | Low | POWER_USER |

### B. Advanced/Admin settings (change data inclusion/windows/recipients — needs a
trained operator and a preview step)

| Setting | Config path | Input type | Validation | Current per-app values | Default | Expected output | Risk | Suggested role |
|---|---|---|---|---|---|---|---|---|
| MDS/PGL Go-Live Event Cluster Days | `ui.mgmPglTab.goLiveEventClusterDays` | Number | Non-negative integer | HC: `2`; all others: not set (→0) | `0` | Merges same-deployment MDS/PGL dates within N calendar days into one clustered row/badge (chained/greedy algorithm — see §2.12) | Medium — large values over-merge distinct events | ADMIN |
| Report Distribution Recipients | `report.distribution.to` / `.cc` / `.bcc` | Email list | Valid email syntax; **must also fix the CoreDistribute-level non-enforcement of `allowedSenders` and the menu-path send gap before this is safe to expose (see §5)** | Mostly `[]`/self; EVI has a real multi-cc list | `[]`/`[]`/`''` | Determines actual send recipients once `report.distribution.enabled` is true | **High until the send-authorization gaps in §5 are closed** | ADMIN |
| Report Subject Template | `report.distribution.subjectTemplate` | Text with tokens | Only `{{appTitle}}`/`{{monthLabel}}` supported; anything else passes through literally | All 5 use custom hardcoded literals, not the token | default template | Email subject line | Low | ADMIN |
| Report Distribution Enabled | `report.distribution.enabled` | Boolean | — | `false` everywhere | `false` | Master on/off for the monthly send — **but `opts.force` bypasses it**, so this toggle alone is not a full safety guarantee | Medium | ADMIN |
| Portfolio Health Industry Buckets | `report.portfolioHealth.industryBuckets` | Repeatable {label, match[]} | Non-empty label; match values are matched via lowercase exact-string, not fuzzy | SLG (2), HC (5), HENP (2); AI/EVI use `'all'`/`'topNWithOther'` instead | `[]` | Groups raw industry/region values in the Portfolio Health snapshot | Medium — unmatched values silently fall into an implicit catch-all | ADMIN |
| Personalization Default View | `ui.personalization.defaultViewMode` | Enum (`myPortfolio`\|`allDeployments`) | — | SLG: `myPortfolio`; HC/HENP: `allDeployments` | `myPortfolio` | Initial "My Portfolio vs All" state for DD role | Low | ADMIN |
| Role Visibility | `ui.roleVisibility.{READ_ONLY,POWER_USER,ADMIN}` | Multi-select of tab ids | Must be one of the known tab ids implemented in `CoreUI_Markup.js`/`CoreUI_Js.js` (no enum validation exists in code today — **the admin UI must supply its own enum**) | None declared → all on default | see §2.11 | Filters tab **markup** only — see §5 for the read-RPC caveat | **Medium-high** — see §5 security note before exposing | ADMIN |
| Executive Watch Enabled | `executiveWatch.enabled` | Boolean | — | EVI: `false`; all others effectively `true` | `true` | Turns Customer-Wellness ingestion/flagging on or off entirely | Medium | ADMIN |
| Trends v1 Shell (`vNextEnabled`) | `trends.vNextEnabled` / `ui.trendsTab.vNextEnabled` | Boolean | — | SLG/HENP-config declares vs. `ui.trendsTab.enabled` gate | `false` | Switches between two structurally different Trends tab layouts | Medium | ADMIN |

### C. Developer-only settings (deep Salesforce/data-pipeline coupling)

`sheets.*`, `columns.*`, `activeDeployments.productMode*` (all), `salesforce.
statusValues`, `report.productScope.*`, `momentum.platforms` / `productAreaMapping` /
`dataSource` / `timeRange`, `student.productAreaMatch`, `student.sheets.studentData`,
`freshness.*` (pending reconciliation of the two-implementation split), `notify.
allowedFromAliases`. These require understanding of the live Salesforce schema, the
header-first resolver fallback semantics, and/or code-level algorithms (OR-not-AND
scope matching, mode inference by array-emptiness) that a UI cannot make safe by
itself. Changes here belong in a pull request reviewed against real data, not a
runtime settings panel.

### D. Not currently wired / do not expose

| Config path | Why |
|---|---|
| `columns.goLives.*` | Fully dead — superseded by the header-first resolver |
| `overviewTab.topRedCount`, `.upcomingGoLiveDays`, `.recentGoLiveDays` | Confirmed dead, repo-wide |
| `student.editModal.allowedRoles` | Confirmed dead — only exists as a JSDoc comment; actual gate is the generic not-read-only check |
| `student.table.columns`, `.defaultStatusFilter`, `.defaultHealthFilter`, `.expandableRows` | Confirmed dead in the UI layer — hardcoded in markup/client JS instead |
| `ui.mgmPglTab.defaultHorizon`, `.horizonOptions` | Confirmed dead — hardcoded client-side |
| `ui.personalization.affectsTabs`, `ui.productFilter.affectsTabs` | Confirmed dead |
| `ui.productFilter.defaultProduct` | Confirmed dead |
| `ui.manageOverrides.bulkClearScopes` | Confirmed dead — buttons are hardcoded |
| `trends.defaultWindow` / `ui.trendsTab.defaultWindow` | Confirmed dead in the UI layer |
| `notable.notify.slackWebhookUrl`, `.slackWebhookUrlTest` | Self-documented no-op in `CoreNotable.js` |
| `report.includeIndustryGoLives` | Confirmed dead, repo-wide |
| `report.portfolioHealth.slidesExport.shareMode` | Reserved/unimplemented by design |
| `report.distribution.allowedSenders` (as a CoreLib-level guarantee) | Not enforced inside CoreLib; only enforced ad hoc in each app's web-app wrapper, and not at all on the spreadsheet-menu send path — **do not expose this as "the" access control until the gap in §5 is fixed** |
| `deploymentHealthPlan.expandedDetailsEnabled`, `.metricsEnabled` | No confirmed reader found — verify before exposing |

---

## 5. Not Wired / Risky Config

**Fields present in config but not read anywhere (dead):** see the full list in §4.D.

**Fields read but only partially enforced:**

- `report.distribution.allowedSenders` — read and enforced independently by each
  app's `getReportSendConfigForUI`/`sendMonthlyReportFromUI`/`sendMonthlyReportTestFromUI`,
  but **not** by the plain `sendMonthlyReport()`/`sendMonthlyReportTest()` functions
  reachable from the Sheets `onOpen()` menu, and **not** by `CoreDistribute.js` itself.
  Anyone who can open the container-bound spreadsheet and use the menu can trigger a
  real send regardless of this list.
- `report.distribution.enabled` — the master send toggle, but `opts.force: true` (an
  internal call parameter every app's `*FromUI` wrapper actually passes) bypasses it
  unconditionally.
- `report.productScope.*` and `report.sections.approach` — both real and correctly
  implemented, but **only inside the V2 (Gmail-native) report path**; the legacy
  inline/Outlook renderers and the default (no-`opts`) analytics calls ignore them
  entirely. An admin enabling either expecting it to affect every export will be
  surprised.
- `report.portfolioHealth.slideExportEnabled` — declared/defaulted centrally but not
  actually read in `CorePortfolioHealth.js`; the real gate in `CoreUI_Markup.js` reads
  an **undeclared sibling key**, `exportSlidesEnabled`, that two apps (EVI, AI) already
  set explicitly. Treat `exportSlidesEnabled` as the real key and consider formalizing
  it in `CoreConfig.withDefaults()`.
- `ui.roleVisibility` — enforced for markup, **not** for the underlying data-fetch
  RPCs behind at least two tabs (see next point). Treat as "hide," not "protect."

**Fields that look editable but are dangerous:**

- **`ui.roleVisibility` — the most important finding of this review.** Role gating in
  this codebase is UI-shell-only for *reads*: the array controls which tab buttons and
  markup blocks are built server-side, not which `google.script.run` endpoints a
  client is allowed to call. Every *mutation* endpoint checked (`CoreNotable.
  updateNotableDeployment`/`addNotableDeployment`, `CoreData.saveStudentDeploymentFields`,
  `CoreExecSummary`, and the DeploymentOverrides/GoLivesOverrides mutators) is
  correctly gated server-side via `CoreUsers.requirePowerUser_`. But the corresponding
  **read** endpoints — `getNotableForApp`/`getNotableData()` and
  `buildStudentTabData_`/`getStudentTabData()` — have **no role check anywhere in the
  call chain**, and their container-bound wrappers in every `*_DM/WebAppCode.js` are
  bare pass-throughs. Any authenticated `@workday.com` user within the web app's
  `DOMAIN` access scope can retrieve Notable-deployment and Student-tab data via
  `google.script.run.getNotableData()`/`.getStudentTabData()` directly, regardless of
  role, even though the corresponding tab is invisible to them in the UI. **If a
  future admin UI lets someone toggle `ui.roleVisibility` expecting it to be an access
  control, that expectation is currently false for reads.** This should probably be
  fixed in code (add server-side role checks to the read endpoints) before — or
  alongside — exposing role visibility as an editable setting.
- `report.distribution.to`/`cc`/`bcc` — technically "just email lists," but because
  they're fully overridable per-call via `opts.envelope` with no allowlist check
  against the configured lists, a compromised or buggy caller (including a future
  admin-UI bug) can redirect the monthly report to arbitrary addresses.
- `report.redYellowPartnerFilter` — a strict, case-sensitive exact-match string. A
  typo silently produces an empty Red/Yellow section with no error, which could be
  mistaken for "there's no red/yellow data this month" rather than "the filter is
  broken."
- `momentum.platforms` (emptying it) — silently flips a platform-mode app into
  product mode (see §2.20). This is a config-shape footgun, not a value-range
  footgun, so form validation alone won't catch it without an explicit check.

**Dead/legacy config paths:** see §4.D in full.

**Mismatches between documentation/comments and runtime behavior:**

- `HC_DM/Config_HC.js`'s own header comment says "HC has 14 columns, not 16" — the
  actual `columns` block has 24 keys including both `PRIMING_PARTNER` and
  `IMPL_PARTNER`. Stale comment, not a behavioral bug, but worth fixing if anyone
  reads it as current guidance.
- `CorePortfolioHealth.js`'s header comment calls `recentGoLivesWindowDays`
  "informational," but it's a real, load-bearing window value (see §2.6).
- `student.banner.showOnTabs` in `HENP_DM` includes `'reporting'`, which matches no
  real `ui.tabs` id (the actual id is `'report'`) — the cross-tab Student banner
  likely never renders on the Monthly Report Preview tab as intended.
- `notable.restrictedHideEnabled` — naming vs. behavior mismatch: setting it to
  `false` does **not** mean "show restricted rows by default"; it **removes the
  toggle button entirely**, so restricted rows stay permanently hidden with no way
  for any user to reveal them. Only `true` (the default) gives users the ability to
  toggle visibility. Confirm intent before ever exposing this in an admin UI — its
  current name suggests the opposite of what it does.
- `SLG_DM` has `_debugSfdcColumns()` defined **twice** (once in `Config_SLG.js`, once
  in `WebAppCode.js`) — a global-namespace redeclaration; whichever file GAS evaluates
  last wins at runtime. Not config-related, but a latent bug worth a one-line fix
  separately from this spec.

---

## 6. Recommended Architecture for a Future Power User Menu

### Phased plan

- **Phase 1 — Read-only effective-config viewer.** Surface `CoreConfig.withDefaults
  (APP_CONFIG)` (the *effective* config, not the raw declared object) in a modal/tab,
  read-only, per app. This alone would have caught several of the findings in this
  report (e.g., "HC_DM has no `executiveWatch` block, so it's silently `true`") without
  writing any new mutation code. Low risk, high diagnostic value — build this first.
- **Phase 2 — Editable low-risk copy/report settings.** `report.title`,
  `report.footerAttribution`, `report.redYellowOwnerLabel`, `report.topMessage.*`,
  `ui.headerSubtitle`, `ui.editModal.ownerOptions`. All plain strings/short lists with
  fail-closed behavior on bad input (per §4.A).
- **Phase 3 — Editable report distribution settings.** `report.distribution.to/cc/bcc`,
  `subjectTemplate`, `enabled`. **Gate this phase on first closing the
  `allowedSenders`/menu-path authorization gap described in §5** — otherwise the admin
  UI would be teaching users to trust a control that doesn't actually restrict who can
  send.
- **Phase 4 — Editable MDS/PGL clustering and report windows.**
  `ui.mgmPglTab.goLiveEventClusterDays` (numeric, well-isolated, already the
  best-understood algorithm in this report) and, once unified/clearly labeled, the
  report-window family from §2.5's "four windows" table. Do not expose all four
  window keys under one generic label — either collapse them in code first, or give
  each its own clearly-scoped field ("V2 Email Report Window" vs "Go Lives Tab
  Window" vs "Portfolio Health Window").
- **Phase 5 — Advanced role/tab settings, if explicitly approved.** `ui.roleVisibility`,
  `ui.tabs` (add/remove/reorder). **Requires the server-side read-RPC gating fix from
  §5 first** — otherwise this phase would let an admin believe they've restricted a
  tab when the underlying data is still fetchable by anyone in the domain.
- **Developer-only, never in the Power User menu:** `sheets.*`, `columns.*`,
  `activeDeployments.productMode*`, `report.productScope.*`, `salesforce.
  statusValues`, `momentum.platforms`/`productAreaMapping`/`dataSource`.

### Where editable config should live

Recommend a **protected Google Sheet config tab** (e.g. `PowerUserConfig`), not
direct `APP_CONFIG` code edits, for these reasons specific to this codebase:

- `APP_CONFIG` lives in source pushed via `clasp push`, and per this repo's
  operating model every `*_DM` app is pinned to CoreLib **HEAD** — there's no
  concept of "safe to edit without redeploying" in the current code-based config
  story. A Sheet tab lets a Power User change a value without anyone touching
  `clasp`.
- A protected range/table (Sheets native protection, editable only by
  POWER_USER/ADMIN role per the existing `CoreUsers` role model) gives a natural
  audit trail for free (Sheets revision history) in addition to any app-level audit
  logging you add.
- CoreLib would read the Sheet tab at runtime and merge it over `APP_CONFIG.report`/
  `.ui` before calling `CoreConfig.withDefaults()` — additive, not a replacement for
  the existing `APP_CONFIG` object, so `sheets.*`/`columns.*`/`activeDeployments.*`
  (the Developer-only tier) stay code-only and out of reach of the Sheet-based
  override layer entirely, by construction.

### Audit logging

Reuse the existing `ReportDistributionLog`/OverrideAudit pattern already in this
codebase (`CoreData.js` writes audit rows for override mutations today) — add a
parallel `PowerUserConfigAudit` sheet logging `{timestamp, user, configPath, oldValue,
newValue}` for every Power-User-menu change. This is consistent with how the codebase
already treats mutations (a self-healing, header-validated log sheet), so it will feel
native rather than bolted-on.

### Validation rules

- Enforce the **fail-closed** behaviors already present in code rather than
  reinventing them: blank `topMessage.text` → no banner (already true); `linkUrl` not
  starting with `https://` → link dropped (already true). The UI should just surface
  these existing rules as inline hints, not re-implement stricter versions.
- For `goLiveEventClusterDays`: reject negative/non-integer input in the UI itself
  (code already coerces bad input to `0`, but the UI should not rely on that
  silently — show the coercion explicitly so a user doesn't think they set `-5` and
  got `-5`).
- For any email-list field (`report.distribution.to/cc/bcc`, future `allowedSenders`
  editor): validate email syntax and **cap list length** — nothing in CoreLib
  currently caps recipient count.
- For `ui.tabs`/`ui.roleVisibility` tab-id fields (Phase 5 only): validate against a
  hardcoded enum of known tab ids maintained in the admin tool itself, since **no such
  enum exists in CoreLib today** — an unrecognized id currently fails silently
  (dead tab button) rather than being rejected.

### Rollback strategy

- Because the effective config is computed fresh on every request via
  `CoreConfig.withDefaults()`, a "rollback" for the Sheet-tab overlay approach is just
  "restore the previous row/cell values" — Google Sheets version history already
  provides this for free. Encourage using **Sheet version history**, not a custom undo
  stack, as the primary rollback mechanism for Phase 2-4 settings.
- For anything that also requires an `APP_CONFIG` code change (Developer-only tier),
  rollback is the existing git/clasp workflow already documented in `CLAUDE.md` §6 —
  no new mechanism needed.

### Effective config preview before save

Before committing any Power-User-menu change, render the **post-change effective
config** (i.e., re-run `CoreConfig.withDefaults()` with the pending override applied)
and diff it against the current effective config, showing exactly which downstream
values will change (including any keys that only take effect through a fallback
chain, e.g. changing `report.goLivesWindowDays` also changes the *default* for
`report.portfolioHealth.recentGoLivesWindowDays` unless that's set explicitly). This
directly addresses the "four windows" and fallback-chain confusion identified in §2.5.

---

## 7. Validation Recommendations

Manual smoke tests (there is no automated test suite for this library — see CLAUDE.md
§5). Suggested checks, each phrased as "do X, confirm Y":

1. **Report top message — blank:** clear `report.topMessage.text` on an app that has
   one set (HENP); confirm the Monthly Report Preview and an exported/emailed report
   show no banner at all.
2. **Report top message — nonblank + link:** set `text`, `linkText`, and a
   `https://` `linkUrl`; confirm the banner renders with a clickable link in all
   three report shells (inline preview, Outlook export, V2/Gmail preview). Then set
   `linkUrl` to an `http://` (not `https://`) URL and confirm the link silently
   disappears while the text banner remains.
3. **MDS/PGL cluster days 0 vs 2:** on HC_DM (currently `2`), temporarily compare the
   CSAT/MDS-PGL tab's event rows against a scratch copy with `goLiveEventClusterDays:
   0` — confirm that with `0`, every distinct date is its own row, and with `2`, dates
   within 2 calendar days of each other (chained) collapse into one row with a
   "clustered from multiple dates" indicator.
4. **Report distribution preview/send:** with `report.distribution.enabled: false`,
   confirm `sendMonthlyReportTest()` still sends (by design) while
   `sendMonthlyReportFromUI()` returns a "denied" result for a non-allowed sender and
   a real send for an allowed one. Then confirm the Sheets-menu "Send Monthly Report
   (New)" item sends regardless of `allowedSenders` — this is the documented gap in
   §5, not a bug to "fix" by testing around it, but worth confirming it still behaves
   this way before this spec is acted on.
5. **Role visibility changes:** log in as a READ_ONLY test user; confirm
   POWER_USER-only tabs (Overrides, MDS/PGL, Notable) are absent from the tab bar.
   Then, from the browser console, call `google.script.run.getNotableData()` (or the
   app's equivalent) directly as that same READ_ONLY user and confirm it **still
   returns data** — this reproduces the §5 finding and should inform whether that gap
   gets fixed before Phase 5 of the admin UI.
6. **Student tab view/edit:** as a READ_ONLY HENP user, confirm the Student tab is
   absent from the tab bar. As a POWER_USER, confirm the tab appears (inserted after
   Deployments per `student.tab.insertAfter`), and that editing a Student row succeeds
   only for POWER_USER/ADMIN — note that today this is enforced by the generic
   "not read-only" check, not by the declared (but dead) `allowedRoles` array, so a
   test asserting "only POWER_USER and ADMIN, not e.g. a future third role, can edit"
   is really testing `CoreUsers.requirePowerUser_`, not `student.editModal.allowedRoles`.
7. **EVI product-mode counts:** confirm Active Deployments count for EVI_DM reflects
   only rows matching `productScope`/`productModeStructuredProductAreas` ("Contract
   Management and Document Intelligence") or the `Evisort`/`CLM` name tokens — spot
   check one deployment with a non-matching product area is correctly excluded and one
   with a matching name token but different structured area is correctly included
   (OR, not AND).
8. **HENP Student counts/sorting:** confirm the Student tab shows only deployments
   with `Product_Area__c === 'Student'` (exact match), and that clicking the two
   sortable date-column headers toggles ascending/descending order client-side (there
   is no server-side sort — verify large datasets still sort correctly client-side).
9. **HC MDS/PGL counts:** with `goLiveEventClusterDays: 2`, confirm the total MDS/PGL
   row count for a deployment with 3 go-live dates 1-2 days apart is fewer than the
   raw event count (clustered), and that a deployment with dates >2 days apart shows
   one row per date (unclustered).
10. **Monthly report date handling:** confirm a Sheets date cell entered as
    `2026-01-15` renders as Jan 15 (not Jan 14) in every report window/section, in
    the `America/New_York` script timezone — this validates the ISO-prefix
    calendar-date-key logic in `CoreUtils.toCalendarDateKey` that was specifically
    built to avoid the classic Apps Script UTC-midnight date-shift bug.
11. **Override behavior:** set a `DeploymentOverrides.Override_MTPDate` and a
    `GoLivesOverrides.Override_GoLiveDate`/`Exclude_From_Report` for the same
    deployment; confirm Upcoming Go Lives reflects the go-live override date/partner
    and the exclude flag (OR of all three exclude sources per the "Option B
    precedence" logic), and confirm `Override_Health`/`Override_Stage` do **not**
    leak into the Go Lives row (they only affect the Deployments tab). Then rename
    `sheets.deploymentOverrides` to a nonexistent tab temporarily and confirm
    overrides silently stop applying with no error surfaced anywhere — this
    reproduces the silent-empty-map risk noted in §2.2 and should inform whether
    louder failure is worth adding before this becomes admin-editable.

---

*This document reflects static code analysis only — it distinguishes declared
config (what's in `Config_*.js`) from effective config (after
`CoreConfig.withDefaults()`) and from config that is actually read by CoreLib versus
config that merely exists, per the request. No production data, live Salesforce
schema, or actual report/email sends were inspected or exercised — several "expected
behavior" statements above (especially in §7) should be confirmed against a real
sandbox/test send before being treated as verified fact.*
