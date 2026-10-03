# AI_DM → HS_DM / PDX_DM ProductMode Split — Specification

Scope: `solutions/AI_DM` (to become `solutions/HS_DM`) and a new `solutions/PDX_DM`,
both consuming `libraries/DepMngr` (`CoreLib`). Produced by static, read-only
discovery across `Config_AI.js`, `Config_EVI.js` (comparison sibling), `Code.js`,
`WebAppCode.js`, `appsscript.json`, `CoreConfig.js`, `CoreData.js`,
`CorePortfolioHealth.js`, `CorePortfolioMomentum.js`, `CoreDistribute.js`,
`CoreReport.js`, `CoreAnalytics.js`, `CoreNotify.js`, `CoreNotable.js`,
`CoreTrends.js`, and the exported workbook `migrations/AI_DeploymentHealth_v1.xlsx`.

**No files were modified, staged, committed, or pushed to produce this document.
No `clasp` command was run. `.clasp.json` was not touched.** All line numbers refer
to the current working-tree state.

---

## 1. Executive summary

AI_DM is today a single ProductMode app that presents **both** HiredScore and
Paradox deployments out of one workbook, using `APP_CONFIG.activeDeployments.
productMode*` fields to union/scope rows from the shared `SFDC_Deployments` /
`SFDC_DeploymentProductFunctions` sheets. Jeff has decided to split it into two
sibling apps — **HS_DM** (HiredScore only) and **PDX_DM** (Paradox only, using
that spelling everywhere, never `PX_DM`) — each with its own fresh workbook that
will nonetheless **still receive both products' raw SOQL rows**. Separation must
happen entirely at the `APP_CONFIG` layer, exactly like the existing AI_DM/EVI_DM
ProductMode pattern.

**The good news:** CoreLib's *primary* data-scoping mechanism — call it
**Mechanism A**, the always-on, config-driven `activeDeployments.
productModeStructuredProductAreas` / `productModeDeploymentNameIncludes` /
`productModeDeploymentNameExcludes` matching baked into
`getProductModeCanonicalDeployments` (`CoreData.js:2340`) /
`getAllEffectiveDeployments` (`CoreData.js:2951`) — is applied unconditionally
(no runtime parameter required) to **every** surface that matters most: the
Deployments tab, Go Lives (recent/upcoming/explorer), and the Overview tab. A
correctly-configured `APP_CONFIG.activeDeployments` block is, by itself, enough
to make those three surfaces product-safe for HS_DM and PDX_DM.

**The bad news:** a second mechanism — **Mechanism B**, the request-scoped
`ui.productFilter` dropdown (`productOpts.product`) — is opt-in, and several
report/analytics/notification surfaces depend on it (or on `report.productScope`,
a *third*, independent config block) instead of Mechanism A, or don't scope at
all. Discovery found **six confirmed leakage gaps** that will show combined
HiredScore+Paradox data in both new apps unless fixed — most seriously **Manage
Overrides**, which applies *zero* product scoping today, and the **Dashboard /
CoreAnalytics snapshot pipeline**, which is the root cause feeding several of the
other leaks (see §5).

Fixing any of these gaps means editing shared `libraries/DepMngr/src/*.js` files.
Per this repo's operating model, **every `*_DM` app pins CoreLib at
`version:"0", developmentMode:true` (library HEAD)** — so any CoreLib fix lands
in `SLG_DM`, `HC_DM`, `HENP_DM`, and EVI_DM the instant it's pushed, in addition
to HS_DM/PDX_DM. This is a five-app (six once PDX_DM exists) production change,
not a two-app change, and must be scheduled and communicated as such (see §9,
§8 Phase 3).

This document is discovery/specification only. No renames, config edits, or
CoreLib changes have been made.

---

## 2. Current AI_DM architecture (question set A)

### A.1 — What makes AI_DM a ProductMode app

Three independent config blocks combine to make AI_DM ProductMode-aware. There is
**no cross-validation between them** — `CoreConfig.withDefaults()` defaults each
independently and never checks they agree (confirmed: no such check exists in
`CoreConfig.js`).

| Block | File:line (current AI_DM) | Purpose |
|---|---|---|
| `activeDeployments.productMode*` | `Config_AI.js:27-57` | **Portfolio membership** — which rows exist in this app's world at all. Always-on (Mechanism A) once `productModeUnionEnabled:true` and `productModeSourceMode:'parentAndProductFunctionUnion'`. |
| `report.productScope` | `Config_AI.js:151-161` | **Monthly-report-only** scoping; CoreConfig's own comment calls it "no-op unless enabled." `CoreData.js` also uses it as a *fallback* source for Mechanism A's area/token lists if `activeDeployments.*` is left blank (`CoreData.js:1161-1192`). |
| `ui.productFilter` | `Config_AI.js:268-282` | **In-app dropdown** (Mechanism B) — lets a user narrow an already-Mechanism-A-scoped portfolio further. Request-scoped via `productOpts`, not config-scoped. |

`appId` itself carries no ProductMode meaning, but is worth flagging here because
it matters for the split: AI_DM uses the bare code `'AI'` (`Config_AI.js:25`)
while EVI_DM uses the `_DM`-suffixed `'EVI_DM'` (`Config_EVI.js:11`) — the two
existing ProductMode siblings don't even agree on their own convention.
`CoreConfig.js` imposes no format rule (`appId` typedef, `CoreConfig.js:281`, has
no comment on format), but `CoreData.js` hardcodes literal `appId` string checks
elsewhere unrelated to ProductMode (`'EVI_DM'`/`'EVI'` at line 3975 for a
different feature, `'HC_DM'` at line 11158 for CSAT import tenancy). `appId` is
also the sole namespace segment for every tier-2 cache key and script-property key
(`_perfKey_`, `CoreData.js:195-199`; enumerated at `CoreData.js:558-595`) — so it
must be unique per app regardless of format.

### A.2 — Current product areas / name tokens

| | HiredScore | Paradox |
|---|---|---|
| Structured area (`activeDeployments.productModeStructuredProductAreas`, `report.productScope.includeAreas`, `ui.productFilter.areas`) | `'Workday HiredScore'` | `'Workday Paradox'` |
| Name-match token (`activeDeployments.productModeDeploymentNameIncludes`, `report.productScope.nameTokens`, `ui.productFilter.nameTokens`) | `'HiredScore'` | `'Paradox'` |
| `momentum.productFilter.Product_Area__c` | `'Workday HiredScore'` | `'Workday Paradox'` |
| `momentum.productFilter.Deployment_Name` LIKE-patterns | `'%HiredScore%'`, `'%Hiredscore%'` | `'%Paradox%'` |

Both lists currently sit **together** in every AI_DM config block (`Config_AI.js:
30-37, 154-160, 270-281, 344-345`) — the split is purely a matter of putting one
token in each new app's config instead of both.

### A.3 — Config paths that must diverge (summary; full values in §3/§4)

`appId`, `report.title/inlineFilename/outlookFilename/v2ExportFilename/
footerAttribution`, `report.productScope.{includeAreas,nameTokens}`,
`activeDeployments.{productModeStructuredProductAreas,
productModeDeploymentNameIncludes}`, `report.portfolioHealth.slidesExport.
{folderId,filename}`, `report.distribution.subjectTemplate`, `ui.{appTitle,
headerTitle,headerSubtitle}`, `ui.productFilter.*` (recommend disabling — see
§3), `momentum.productFilter`, `momentum.chartLegend`, `momentum.chart.colors`,
`momentum.kpiLabels.label3`.

### A.4 — Labels/titles needing rename

Report title, both HTML export filenames, the V2 export filename, footer
attribution, app title/header title/subtitle, the `onOpen()` menu label
(`'📊 AI Deployment Health Tools'`, `Code.js:110`), the "Open Web App" dialog copy
(`Code.js:207-208`), the distribution subject template, the Slides export
filename template, and the momentum KPI label `'AI Avg Annual Growth (%)'`
(`Config_AI.js:354`).

---

## 3. HS_DM target design (question set B)

Values below assume `appId: 'HS_DM'` (see §2 A.1 — recommended to resolve the
AI/EVI_DM inconsistency going forward; Jeff can override). Everything not listed
is a **verbatim carry-over** from `Config_AI.js` (sheets, namedRanges, columns,
salesforce, freshness, trends, deploymentHealthPlan, ui.tabs/mgmPglTab/
deploymentsTable/goLivesTable/goLivesTab/manageOverrides/editModal/
personalization).

```js
appId: 'HS_DM',

activeDeployments: {
  // ...unchanged except:
  productModeStructuredProductAreas: ['Workday HiredScore'],
  productModeDeploymentNameIncludes: ['HiredScore'],
  productModeDeploymentNameExcludes: ['Legacy'],   // unchanged
},

report: {
  inlineFilename:   'HS_DeploymentHealth_Dashboard.html',
  outlookFilename:  'HS_DeploymentHealth_Dashboard_Outlook.html',
  v2ExportFilename: 'HS_HiredScore_DeploymentHealth_Report_V2.html',
  title: 'HiredScore Deployment Health Report',
  footerAttribution: 'Generated by the HiredScore Program Management team',

  productScope: {
    enabled: true,
    includeAreas: ['Workday HiredScore'],
    nameTokens:   ['HiredScore']
  },

  portfolioHealth: {
    // ...unchanged except:
    slidesExport: {
      destinationMode: 'root',
      folderId: '<TBD — Jeff creates a Drive folder for HS_DM Slides exports>',
      shareMode: 'inherit',
      filename: 'HS Portfolio Health - {userEmail} - {timestamp}'
    }
    // Recommended addition (matches EVI_DM precedent, Config_EVI.js:154-157;
    // AI_DM does not currently have this block at all — Jeff's call):
    // partnerAnalysis: { excludePartners: ['Workday Professional Services'] }
  },

  distribution: {
    enabled: false,                 // decision #8 — starts disabled everywhere
    subjectTemplate: 'HiredScore — Monthly Deployment Health Report — {{monthLabel}}'
    // to/cc/bcc/allowedSenders/fromAlias: carry over, Jeff to review recipients
  }
},

ui: {
  appTitle:       'HiredScore Deployment Health Manager',
  headerTitle:    'HiredScore Deployment Health Manager',
  headerSubtitle: 'Review and manage HiredScore deployment data',

  // Recommended: disable the in-app product dropdown entirely, matching
  // EVI_DM's own single-product precedent (Config_EVI.js:269-275) — a
  // single-product app has nothing to toggle between.
  productFilter: { enabled: false, hidden: true, areas: [], aliases: {}, nameTokens: {} },

  // webApp: leave unset for now — AI_DM's Code.js uses a local WEB_APP_URL
  // constant (Code.js:19) instead of cfg.ui.webApp.baseUrl (which is EVI_DM's
  // pattern). Keep HS_DM on the AI_DM/Code.js pattern it inherits; fill in
  // WEB_APP_URL after Jeff deploys (see §8).
},

momentum: {
  // ...unchanged except:
  productFilter: {
    Product_Area__c: 'Workday HiredScore',       // single string, EVI_DM-style
    Deployment_Name: ['%HiredScore%', '%Hiredscore%']
  },
  kpiLabels: { /* ...unchanged except: */ label3: 'HiredScore Avg Annual Growth (%)' },
  chartLegend: ['HiredScore'],
  chart: { colors: { HiredScore: '#F46821' }, inProgressOpacity: 0.55 }
}
```

`topMessage`: not currently used by AI_DM; recommend leaving unset (decision #6 —
fresh start, no migration banner needed). If Jeff wants a short-lived orientation
note, add `report.topMessage` (or a `ui`-level banner if one exists elsewhere in
CoreUI) rather than inventing a new field.

`notable.notify.email`: carry over `mariah.maxie@workday.com` /
`useTestMode:true` unless Jeff wants per-product routing.

---

## 4. PDX_DM target design (question set C)

Mirror image of §3. Everything not listed is the same verbatim carry-over.

```js
appId: 'PDX_DM',

activeDeployments: {
  productModeStructuredProductAreas: ['Workday Paradox'],
  productModeDeploymentNameIncludes: ['Paradox'],
  productModeDeploymentNameExcludes: ['Legacy'],
},

report: {
  inlineFilename:   'PDX_DeploymentHealth_Dashboard.html',
  outlookFilename:  'PDX_DeploymentHealth_Dashboard_Outlook.html',
  v2ExportFilename: 'PDX_Paradox_DeploymentHealth_Report_V2.html',
  title: 'Paradox Deployment Health Report',
  footerAttribution: 'Generated by the Paradox Program Management team',

  productScope: {
    enabled: true,
    includeAreas: ['Workday Paradox'],
    nameTokens:   ['Paradox']
  },

  portfolioHealth: {
    slidesExport: {
      destinationMode: 'root',
      folderId: '<TBD — Jeff creates a Drive folder for PDX_DM Slides exports>',
      shareMode: 'inherit',
      filename: 'PDX Portfolio Health - {userEmail} - {timestamp}'
    }
    // partnerAnalysis: { excludePartners: ['Workday Professional Services'] } // optional, see §3
  },

  distribution: {
    enabled: false,
    subjectTemplate: 'Paradox — Monthly Deployment Health Report — {{monthLabel}}'
  }
},

ui: {
  appTitle:       'Paradox Deployment Health Manager',
  headerTitle:    'Paradox Deployment Health Manager',
  headerSubtitle: 'Review and manage Paradox deployment data',
  productFilter: { enabled: false, hidden: true, areas: [], aliases: {}, nameTokens: {} },
},

momentum: {
  productFilter: {
    Product_Area__c: 'Workday Paradox',
    Deployment_Name: ['%Paradox%']
  },
  kpiLabels: { label3: 'Paradox Avg Annual Growth (%)' },
  chartLegend: ['Paradox'],
  chart: { colors: { Paradox: '#0F4C81' }, inProgressOpacity: 0.55 }
}
```

`appId: 'PDX_DM'` — confirmed no collisions anywhere in the repo for `PDX`,
`PX_DM`, or `HS_DM` (repo-wide case-insensitive grep, clean).

---

## 5. Product scope / separation model — leakage risk (question set D)

### D.1 — Surface-by-surface scoping status

All findings below are from direct code reads of `CoreData.js`, `CorePortfolioHealth.js`,
`CorePortfolioMomentum.js`, `CoreDistribute.js`, `CoreReport.js`, `CoreAnalytics.js`,
`CoreNotify.js`, `CoreNotable.js`, `CoreTrends.js` — not inferred.

| Surface | Status | Why |
|---|---|---|
| **Overview** | ✅ Scoped | `getOverviewSnapshot(cfg, viewModeOpts, productOpts)` (`CoreData.js:12310`) routes KPIs and the Next-High-Risk/Upcoming widgets through Mechanism A regardless of `productOpts`. |
| **Deployments** | ✅ Scoped | `getAllDeployments` → `getAllEffectiveDeployments` → `getProductModeCanonicalDeployments` (`CoreData.js:2340`) always applies structured-area + name-token matching. |
| **Go Lives** (recent/upcoming/explorer) | ✅ Scoped | `getRecentGoLives`, `getUpcomingGoLives`, `getGoLivesExplorerData` all route through the same Mechanism-A pipeline (`CoreData.js:6896, 6709, 14386`). |
| **Monthly Report — V2/Gmail path** (`buildReportV2WithAnalytics`, `exportReportV2ToDrive`, `sendMonthlyReport`) | ✅ Scoped | Explicit `V2_REPORT_SCOPE_OPTS_ = {applyReportProductScope:true,...}` (`CoreReport.js:1761-1764`) is threaded into every V2 section builder and `filterRowsByReportProductScope_`. |
| **Monthly Report — V1/legacy path** (`buildInlineHtmlWithAnalytics`, `buildOutlookHtml`, `exportInlineAndOutlookToDrive` — still wired to AI_DM's "Report" tab and `onOpen()` menu, `Code.js:239,252`, `WebAppCode.js:238,247`) | ❌ **Not scoped** | `buildReportSections_` (`CoreReport.js:141`) calls `CoreData.getActiveDeployments(config)`, `getRecentGoLives(cfg,null)`, `getUpcomingGoLives(cfg,null)` with **no `productOpts`**, and `CoreAnalytics.getHealthBreakdown/getPartnerBreakdown/getApproachBreakdown(cfg)` with **no `opts`** — every V1 table (RedYellow, RecentGoLives, FutureGoLives, HealthTotal, PartnerTotal, ApproachTotal) is built from the full unfiltered portfolio. |
| **Portfolio Health — current KPIs** | ✅ Scoped | `getSnapshot(cfg, viewModeOpts, productOpts)` (`CorePortfolioHealth.js:39`) threads `productOpts` into every deployment/go-live fetch it makes. |
| **Portfolio Health — history/sparkline trend** | ❌ **Not scoped** | `buildHistory_(cfg, windowMonths)` (`CorePortfolioHealth.js:528`) reads `cfg.sheets.healthReportSnapshots` directly with no `productOpts`; only the current-month point is patched with the live scoped value (`CorePortfolioHealth.js:131-139`). Root cause: that sheet is populated unscoped (see next row). |
| **Dashboard / `CoreAnalytics.update`** | ❌ **Not scoped — root cause** | `updateSnapshotsFromActive` (`CoreAnalytics.js:32`) calls `CoreData.getActiveCountDeployments(cfg)` with **no `productOpts`** and writes the combined Green/Yellow/Red/Total straight to `HealthReportSnapshots`/`Dashboard!HealthTotal`. This feeds Portfolio Health history, Trends trajectory, and every V1 report breakdown table. |
| **Partner Analysis** | ✅ Scoped (correctly layered) | `filterRowsForPartnerAnalysis_` (`CoreConfig.js:1231-1237`) only *narrows* rows already product-scoped by `getSnapshot`; it never re-reads the unfiltered portfolio. Safe once the upstream KPI path is scoped (it is). |
| **Manage Overrides** | ❌ **Not scoped at all — biggest gap** | See D.4. |
| **Trends — completion-trend/history scope** | ✅ Scoped | `buildPortfolioHistoryParentIdSet_` (`CoreTrends.js:1941-1951`) branches on `isProductModeApp` and calls `getProductModeTrendsDeployments`/`getAllDeployments` with `productOpts`. |
| **Trends — 5 headline metrics** (Time-in-Red, Health Trajectory, Health-by-Partner, Health-by-DD, Time-in-Stage) | ❌ **Not scoped — not implemented at this layer** | `getTimeInRedMetrics`, `getHealthTrajectory`, `getHealthByPartner`, `getHealthByDeliveryDirector`, `getTimeInStageMetrics` have **no `productOpts` parameter in their signatures at all** (`CoreTrends.js:57,211,328,436,561`) — this isn't a missed wiring, the parameter doesn't exist. |
| **Notable Deployments** | ❌ **Not scoped** | `getNotableForApp` (`CoreNotable.js:56`) calls `getAllEffectiveDeployments(cfg)` with no `productOpts` before joining peer rows (`CoreNotable.js:61,67`). Low *current* impact since `ui.notable.enabled:false` in AI_DM today (`Config_AI.js:228`) — but must stay disabled, or be fixed, before either new app turns it on. |
| **Report distribution preview/send** | Gate present, intentionally bypassable | `if (!dist.enabled && !opts.force)` (`CoreDistribute.js:203`) correctly blocks auto-send when `enabled:false`. `sendMonthlyReportFromUI` (`WebAppCode.js:312-322`) explicitly passes `force:true`, gated by a server-side `allowedSenders` check — an intentional "admin can force-send" escape hatch, not a bug. Content scoping depends on which report path is used (V1 vs V2, see above). |
| **Portfolio Momentum** | ⚠️ Config-dependent only | `getMomentumSnapshot(cfg)` (`CorePortfolioMomentum.js:1554`) reads the shared sheet with **no query-level filter**; scoping happens entirely in-memory via `momentum.productFilter` (`CorePortfolioMomentum.js:308-327`). Safe only if that block is set to a single product per app (§3/§4) — there is no other backstop. |
| **Notifications** (`runNotifications` — em-reminders, DD digests) | ❌ **Not scoped** | `runNotifications` (`CoreNotify.js:1083`) calls `getMdsPglBatchView(cfg, null, 6)` with **no `productOpts`**, even though that function's signature supports a 4th `productOpts` parameter (`CoreData.js:10537`) — the plumbing exists but is unused here. |

### D.2 — Known gaps, summarized

1. **Manage Overrides** (`getAllActiveOverrides`) — no base scoping; the override sheets have no product column to filter on anyway (see D.4).
2. **Dashboard/`CoreAnalytics.update`** snapshot pipeline — unscoped by default; root cause for the Portfolio Health history and V1 report breakdown leaks.
3. **V1/legacy monthly report path** — fully unscoped, and still actively reachable from AI_DM's UI/menu today.
4. **Trends' five headline metrics** — product scoping was never implemented for these, not merely unwired.
5. **Notable Deployments** — unscoped join; currently masked by being disabled.
6. **Notifications** (`runNotifications`) — unscoped; available `productOpts` parameter simply not passed.
7. **Portfolio Momentum** — safe only if `momentum.productFilter` is configured correctly; no independent backstop.

None of these are AI_DM-specific bugs — they are latent in CoreLib today and would equally affect EVI_DM if it enabled the same features. The split doesn't create them; it exposes them, because AI_DM's current audience tolerates combined HiredScore+Paradox data by design, while HS_DM/PDX_DM's whole purpose is *not* tolerating it.

### D.3 — Recommended validation/debug helpers

Six ProductMode diagnostics already exist and are directly reusable for pre/post-split
validation (`CoreData.js`, exported ~14544-14646):

| Function | Line | What it proves |
|---|---|---|
| `_debugProductModeCanonicalUnionCounts(cfg, limit)` | 3818 | Structured-area vs name-token vs final-union ID counts, with excluded-ID detail — the most direct "did my `activeDeployments.*` config produce the right row set" check. |
| `_debugProductModeSources(cfg, limit)` | 4018 | One-call snapshot across union validation, raw PF read, Overview, Go Lives, and go-live events. |
| `_debugProductModeActiveDeploymentsUnion(cfg)` | 4008 | Parent-only vs union active-deployment count comparison. |
| `_debugProductModeCounts(cfg)` | 3522 | Count-grain vs display-grain totals cross-check. |
| `_debugProductModeDeploymentDisplayGrain(cfg)` | 3441 | Grain configuration + row-count cross-check against raw PF reads. |
| `_debugProductModeGoLiveEvents(cfg, productOpts)` | 8106 | Samples go-live events for a given product — useful to manually eyeball HS_DM/PDX_DM go-live event payloads for cross-product rows. |

**No equivalent diagnostic exists today** for Manage Overrides, Trends headline
metrics, Notable, Notifications, or the Dashboard snapshot pipeline. Recommend
adding a `_debugManageOverridesProductLeakage(cfg)`-style helper (list every
active override row's associated deployment ID, look it up in the
Mechanism-A-scoped `getAllEffectiveDeployments(cfg)` result, and flag any override
whose deployment ID is *not* in that scoped set) as the cheapest way to prove no
leakage there without first fixing the underlying CoreData function.

### D.4 — Manage Overrides scoping (confirmed, not just suspected)

The prior discovery mentioned in the brief is **confirmed by direct code reading**,
and the problem is worse than "the wrapper forgot to forward `productOpts`":

- `getAllActiveOverrides(config, viewModeOpts, productOpts)` (`CoreData.js:8660`)
  *does* accept a third `productOpts` parameter and *will* call
  `filterDeploymentsByProduct_(out, productOpts.product, cfg)` if one is passed
  (`CoreData.js:8797-8799`) — but that's Mechanism B only.
- It never routes through `getAllEffectiveDeployments`/
  `getProductModeCanonicalDeployments`, so **Mechanism A (the config-driven
  structured-area/name-token scoping used everywhere else) is never applied
  here at all.** `getDeploymentOverridesMap_`/`getGoLivesOverridesMap_`
  (`CoreData.js:747, 824`) read the entire `DeploymentOverrides`/
  `GoLivesOverrides` sheets with no filtering, and those sheets **have no
  product-area column in the first place** — there's nothing for Mechanism B
  to check even if it were wired up correctly.
- Both existing container-bound wrappers confirm the gap is live today:
  `AI_DM/src/WebAppCode.js:438-439` and `EVI_DM/src/WebAppCode.js:432-433` are
  byte-identical:
  ```js
  function getAllActiveOverridesForUI(viewModeOpts) {
    return CoreLib.CoreData.getAllActiveOverrides(APP_CONFIG, viewModeOpts);
  }
  ```
  Neither declares nor forwards a second argument — even though the client JS
  (`CoreUI_Js.js:1926`) already calls `.getAllActiveOverridesForUI(getViewModeOpts_(),
  getProductFilterOpts_())` with one. The `productOpts` the client computes is
  silently dropped before it reaches CoreData.
- **Fix shape (not implemented here):** forwarding `productOpts` through the
  wrapper is necessary but not sufficient. The real fix needs CoreData to
  intersect the override sheet rows against the Mechanism-A-scoped deployment/
  account-ID universe (`getAllEffectiveDeployments(cfg, productOpts)`), the same
  way every other surface establishes membership — not rely on a product column
  that doesn't exist on `DeploymentOverrides`/`GoLivesOverrides`.

### D.5 — Mixed/shared parent deployments (not a leak — an expected edge case)

Because matching is *inclusion*-based on `deploymentName`, a parent deployment
whose name mentions both products (e.g. "Acme — HiredScore + Paradox Bundle")
would legitimately match **both** HS_DM's and PDX_DM's name-token include list.
`productModeDisplayGrain:'parentDeployment'` means that parent would then
appear, correctly, in both apps' Deployments tab. **This is intentional dual
visibility, not cross-product leakage** — both delivery teams have a real stake
in that deployment. The validation plan (§10) should explicitly distinguish
"same parent ID appears in both apps because it's a genuinely shared/bundled
deployment" (expected) from "a HiredScore-only deployment appears in PDX_DM"
(a real leak).

---

## 6. Repo/file migration plan (question set E)

### E.1 — Folder strategy

**Recommend Option 1: rename + clone**, applied to the repo source tree only
(this has no automatic effect on any live Apps Script container/workbook binding
— see §8):

1. `git mv solutions/AI_DM solutions/HS_DM` — preserves file history/blame for
   the ~95%-shared shell code (`Code.js`, `WebAppCode.js`, `WebApp.html`,
   `appsscript.json`, `ChangeLog.js`).
2. Rename `HS_DM/src/Config_AI.js` → `HS_DM/src/Config_HS.js`, apply §3.
3. Copy `solutions/HS_DM` → `solutions/PDX_DM` (fresh folder, no shared git
   history — it's a new app), rename `Config_HS.js` → `Config_PDX.js`, apply §4.

Rationale: `Option 1` yields two folders that start byte-identical apart from
config, which matches the repo's own architectural rule ("app differences belong
in `APP_CONFIG`, not code"). `Option 2` (build both fresh, leave AI_DM alone)
gains nothing here — because `.clasp.json` is gitignored and per-machine, neither
option touches any live container automatically either way, and `Option 2` just
leaves a stale, drifting third copy of the shell code around during the
transition.

**Note — this is a repo-folder decision, not a production decision.** Whether
`HS_DM`'s local `.clasp.json` ends up bound to the *original* AI_DM Apps Script
container/workbook (i.e. HS_DM = AI_DM continuing in place, just HiredScore-only
and renamed) or to a **brand-new** container/workbook (leaving the original
AI_DM container dormant as a fallback) is Jeff's call per decision #7 and is
covered as an explicit decision point in §8 and §11 — not resolved by the repo
rename itself.

### E.2 — Files needed per app

| File | HS_DM | PDX_DM | Notes |
|---|---|---|---|
| `Config_HS.js` / `Config_PDX.js` | ✓ | ✓ | Per §3/§4. |
| `Code.js` | ✓ | ✓ | Menu labels, `WEB_APP_URL`, `TABLES`/`BAR_CONFIG` — see string list below. |
| `WebAppCode.js` | ✓ | ✓ | No product-specific strings inside; unchanged except any fix applied for D.2/D.4 (library-side, not per-app). |
| `WebApp.html` | ✓ | ✓ | Unchanged — it's a thin CoreUI-driven shell (`WebApp.html:1-31`); only `APP_CONFIG.ui.appTitle` (config, not markup) shows up in it. |
| `appsscript.json` | ✓ | ✓ | Unchanged (libraryId/timeZone/scopes identical); confirm `webapp.access`/`executeAs` per Jeff's production settings when deploying. |
| `ChangeLog.js` | ✓ | ✓ | Check header comment for "AI_DM" text; otherwise generic — read before renaming. |
| `DataFreshnessMonitorHost.js` | — | — | Not present in AI_DM today (only `SLG_DM` has it); not needed unless Jeff wants it. |

### E.3 — Exact string replacements

| In | AI_DM value | HS_DM value | PDX_DM value |
|---|---|---|---|
| `Config_*.js` header comment | "AI App configuration for CoreLib (HiredScore + Paradox)." | "HS_DM (HiredScore) App configuration for CoreLib." | "PDX_DM (Paradox) App configuration for CoreLib." |
| `Code.js:110` menu title | `'📊 AI Deployment Health Tools'` | `'📊 HS Deployment Health Tools'` | `'📊 PDX Deployment Health Tools'` |
| `Code.js:207-208` dialog copy | "The AI Deployment Health Web App…" | "The HS Deployment Health Web App…" | "The PDX Deployment Health Web App…" |
| `Code.js:18-19` `WEB_APP_URL` comment | "deployed AI_DM Web App URL" | "deployed HS_DM Web App URL" | "deployed PDX_DM Web App URL" |
| `report.inlineFilename` | `AI_DeploymentHealth_Dashboard.html` | `HS_DeploymentHealth_Dashboard.html` | `PDX_DeploymentHealth_Dashboard.html` |
| `report.outlookFilename` | `AI_DeploymentHealth_Dashboard_Outlook.html` | `HS_DeploymentHealth_Dashboard_Outlook.html` | `PDX_DeploymentHealth_Dashboard_Outlook.html` |
| `report.v2ExportFilename` | `AI_HiredScore_Paradox_DeploymentHealth_Report_V2.html` | `HS_HiredScore_DeploymentHealth_Report_V2.html` | `PDX_Paradox_DeploymentHealth_Report_V2.html` |
| `report.title` | "HiredScore & Paradox Deployment Health Report" | "HiredScore Deployment Health Report" | "Paradox Deployment Health Report" |
| `report.footerAttribution` | "Generated by the AI Program Management team" | "Generated by the HiredScore Program Management team" | "Generated by the Paradox Program Management team" |
| `ui.appTitle`/`headerTitle` | "AI Deployment Health Manager" | "HiredScore Deployment Health Manager" | "Paradox Deployment Health Manager" |
| `ui.headerSubtitle` | "Review and manage HiredScore and Paradox deployment data" | "Review and manage HiredScore deployment data" | "Review and manage Paradox deployment data" |
| `report.distribution.subjectTemplate` | "AI Products — Monthly Deployment Health Report — {{monthLabel}}" | "HiredScore — Monthly Deployment Health Report — {{monthLabel}}" | "Paradox — Monthly Deployment Health Report — {{monthLabel}}" |
| `slidesExport.filename` | "AI Portfolio Health - {userEmail} - {timestamp}" | "HS Portfolio Health - {userEmail} - {timestamp}" | "PDX Portfolio Health - {userEmail} - {timestamp}" |
| `momentum.kpiLabels.label3` | "AI Avg Annual Growth (%)" | "HiredScore Avg Annual Growth (%)" | "Paradox Avg Annual Growth (%)" |

---

## 7. Workbook setup checklist (question set F)

Tab inventory below is grounded in the actual exported workbook
(`migrations/AI_DeploymentHealth_v1.xlsx`, 35 sheets) cross-checked against
`Config_AI.js:68-87` (`sheets` block) and `Code.js:29-77` (`TABLES`).

### F.1 — Required sheets/tabs, by category

**SOQL/connector-populated (identical schema both apps; both receive both products):**
`SFDC_Deployments`, `SFDC_DeploymentProductFunctions`, `SFDC_DeploymentHistory`,
`SFDC_Wellness`, `SFDC_DHP`, `Contacts1`, `Contacts2`, `SFDC_DeploymentContacts`,
`Auto Refresh Execution Log`.

**App-managed, start empty but with header schema** (per the task brief's list,
all confirmed present in the source workbook): `DeploymentOverrides`,
`GoLivesOverrides`, `DeploymentsMeta`, `OverrideAudit`, `ReportDistributionLog`,
`AppUsers`, `DD Assignment`, `NotificationConfig`.

**Analytics-managed, start empty but with the named ranges CoreLib/Code.js
expects present** (`Code.js:29-77`): `Dashboard` (must contain named ranges
`ExecSummary_Tbl`, `HealthTotal`, `PartnerTotal`, `ApproachTotal`),
`RedYellow_TBL` (named range `RedYellow`), `RecentGL_TBL`, `FutureGL_TBL`
(both dynamic-detection, no named range required), `ExecSummary`,
`HealthReportSnapshots`, `HealthYtdSummary`.

### F.2 — Recommended: copy from the live AI_DM sheet, don't rebuild by hand

Rebuilding `Dashboard`'s named ranges/formulas and the `*_TBL` header layouts
from scratch is error-prone. Recommend Jeff **duplicate the current live AI_DM
Google Sheet** as the starting point for both new workbooks (fastest, safest way
to replicate exact named ranges, formulas, and formatting — matches decision #7,
"Jeff can manually create/copy workbooks… if easier"), then:

- Clear all data rows from every SOQL-populated tab (fresh SOQL sync repopulates them).
- Clear all rows from the app-managed override/audit/log/user tabs (decision #6 —
  fresh start, no data carry-over).
- Leave the `Dashboard`/`*_TBL`/named-range structure and any formulas intact.

### F.3 — Tabs to omit

All `DNU_*` tabs present in the source workbook (`DNU_Go Lives`, `DNU_DD_Debug`,
`DNU_PerfCache`, `DNU_ActiveDeployments`, `DNU_MetaIDMapping`, `DNU_ChangeLog`,
`DNU_DeploymentHealth_Snapshot`, `DNU_HealthMonthlySummary`,
`DNU_App_LandingConfig`) are explicitly marked "Do Not Use" — legacy, omit from
both new workbooks. `AI_ProductFunction` and `AI_Deployments` are pre-`SFDC_*`
legacy sheet names not referenced anywhere in current `Config_AI.js` — omit.
`CSAT_InFlight` is not referenced by AI_DM's config (no `csatTab` block) — omit
unless Jeff wants to enable the CSAT feature in one or both new apps.

---

## 8. Apps Script setup checklist for Jeff (production-sensitive — Jeff owns all of this)

Per decision #9, everything below is manual and production-sensitive; this repo
change (§6) only prepares source code, it doesn't perform any of these steps.

1. **Decide HS_DM's container fate** (open decision, §6 E.1): does the *existing*
   AI_DM Apps Script project/workbook become HS_DM in place (fastest, but removes
   AI_DM as a rollback fallback), or does HS_DM get a brand-new container/workbook
   alongside a brand-new PDX_DM (slower, but keeps AI_DM fully intact as insurance
   until both new apps are validated — recommended, see §11)?
2. Create (or repurpose) the Google Sheet workbook(s) per §7.
3. Create the Apps Script container(s), bind via `clasp create`/`clasp clone` +
   a new local `.clasp.json` for each — **not tracked by git, never commit it**.
4. Add the `CoreLib` library reference (same `libraryId` as today,
   `version:"0"`, `developmentMode:true`) to each new project's
   `appsscript.json` — already true in the copied source, just confirm after
   binding.
5. Wire the SOQL/Salesforce connector to populate `SFDC_*` tabs in **both** new
   workbooks (decision #4) — this is the one piece of net-new Salesforce-side
   setup, independent of the code split.
6. `clasp push` each project (dev/HEAD), smoke-test in the Apps Script editor.
7. `clasp deploy` to cut the initial production deployment for each, with
   `webapp: { executeAs: USER_DEPLOYING, access: DOMAIN }` per the existing
   convention.
8. Set each app's `WEB_APP_URL` (`Code.js`) once deployed.
9. Set up the manual time-based triggers each `*_DM` app relies on
   (`checkDataFreshness`, `runNotifications`, `_warmCaches`) — check AI_DM's
   current trigger configuration in the Apps Script editor before assuming
   defaults.
10. Leave `report.distribution.enabled: false` in both configs (decision #8)
    until Jeff manually flips it after validation (§10).
11. Create the two Drive folders for Slides exports (`portfolioHealth.
    slidesExport.folderId` placeholders in §3/§4) and paste the IDs into config.

---

## 9. Risks and edge cases

- **CoreLib blast radius.** Any fix to the D.2 gaps (Manage Overrides, Dashboard/
  CoreAnalytics, Trends headline metrics, Notable, Notify) is a shared-library
  change. Per this repo's operating model, it lands in `SLG_DM`, `HC_DM`,
  `HENP_DM`, and EVI_DM **immediately** alongside HS_DM/PDX_DM — there is no
  staging buffer. Treat any such fix as a five-to-six-app production change and
  call it out explicitly before pushing, exactly as the repo's own working
  agreements require.
- **`appId` collision surface.** Cache/property keys are namespaced by `appId`
  alone (`_perfKey_`, `CoreData.js:195-199`), with no spreadsheet/script
  differentiation baked into the library. Apps Script's own per-project
  `CacheService`/`PropertiesService` isolation is the real backstop, but
  distinct `appId` values (`'HS_DM'`/`'PDX_DM'`, never reused, never left as
  `'default'`) is cheap defense-in-depth.
- **Mixed/shared parent deployments** (§D.5) will legitimately appear in both
  apps by design — don't mistake that for leakage during validation.
- **`distribution.enabled:false` is not absolute.** `sendMonthlyReportFromUI`'s
  `force:true` bypass (`WebAppCode.js:321`) is gated by `allowedSenders`, so an
  authorized admin (Jeff) can still trigger a real send while `enabled:false`.
  Fine given decision #9, but worth knowing it's not a hard lock.
- **V1 vs V2 report path confusion.** AI_DM's menu and Report tab still call the
  unscoped V1 builders (`Code.js:239,252`, `WebAppCode.js:238,247`). If HS_DM/
  PDX_DM ship without addressing D.1's V1-path finding, previewing/exporting the
  "Monthly Report" from the menu will silently show combined-product data even
  though the Gmail-send path (V2) is correctly scoped — a confusing, easy-to-miss
  inconsistency for whoever reviews the report.
- **`ui.productFilter` dead config if left enabled.** Recommend disabling it
  (§3/§4) — a single-product app showing a "filter by product" dropdown with one
  option is confusing UI, not a functional risk.
- **No `.package.json`/`.claspignore` gaps to inherit.** AI_DM already has both
  (unlike `EVI_DM`... actually AI_DM has neither per CLAUDE.md §10.2 — confirm
  presence before relying on `npm run push`; may need direct `clasp push` calls
  for the new folders too until scaffolding is added).

---

## 10. Validation plan (question set I)

For **each** app (HS_DM validating HiredScore-only, PDX_DM validating
Paradox-only), after dev-push and before any production deployment:

| Check | Method |
|---|---|
| Deployments tab shows only the app's product | `_debugProductModeCanonicalUnionCounts` + manual scan; confirm zero rows whose `productArea`/name matches the *other* app's tokens, excluding shared-parent cases (§D.5) |
| Go Lives (recent/upcoming/explorer) scoped | `_debugProductModeGoLiveEvents(cfg, {product:'all'})` sampled against the app's own config |
| Overview KPIs scoped | Compare `getOverviewSnapshot` totals against a manual count of the sheet filtered by the app's product |
| Monthly Report (V2/Gmail preview) scoped | `getGmailReportPreview()` — confirm no other-product rows in any table |
| **Monthly Report (V1 preview/export) — known gap** | Either fix before enabling, or explicitly disable the V1 menu items/Report-tab path for HS_DM/PDX_DM until fixed — do not ship both apps with a user-facing report view known to leak |
| Portfolio Health current KPIs scoped | `debugPortfolioHealthVNext()` |
| Portfolio Health history/trend — **known gap** | Manually confirm whether the sparkline mixes products; flag as known-limitation to Jeff if unresolved, don't claim it's fixed |
| Partner Analysis scoped | Confirm it's layered on an already-scoped `getSnapshot` result (structural, low risk per D.1) |
| **Manage Overrides — known gap, priority fix** | `_debugManageOverridesProductLeakage`-style check (§D.3) before enabling this tab for end users in either app; do not treat a code-level fix as verified without it |
| Trends — completion/history metrics scoped | `debugTrendsReadiness`/`debugTrendsDashboardData` |
| Trends — **5 headline metrics, known gap** | Confirm to Jeff that these will show combined data until CoreTrends is extended; decide whether to hide them for HS_DM/PDX_DM in the interim |
| Report distribution disabled | `getReportSendConfigForUI().enabled === false` in both apps |
| Product filter dropdown absent/disabled | Visual check — `ui.productFilter.enabled:false` |

---

## 11. Rollback / deprecation plan (question sets G, J)

### Rollback (J)

Because decision #6 makes both new workbooks fresh (not a slice of AI_DM's
existing one), the cleanest rollback posture is: **leave the original AI_DM
Apps Script container and workbook running, untouched, exactly as it is today**,
for the entire transition — regardless of which repo-folder-to-container binding
Jeff picks in §8 step 1. It costs nothing to keep it live and dormant, and it's
the single biggest lever for rollback safety:

- If PDX_DM's rollout stalls or fails validation, HS_DM can continue serving
  HiredScore (either as its own new app, or — if Jeff chose to repurpose the
  original container — as literally the same production app end users already
  use), with **AI_DM's original combined app still available as a fallback**
  for Paradox users until PDX_DM is fixed.
- Don't delete or decommission the original AI_DM container/workbook, its
  triggers, or its deployment until **both** HS_DM and PDX_DM have passed the
  full §10 validation pass **and** run in production long enough to catch
  anything the validation checks didn't (Jeff's call on duration).
- Don't delete `migrations/AI_DeploymentHealth_v1.xlsx` — it's the only
  structural reference for rebuilding a workbook from scratch if something goes
  wrong with the "copy the live sheet" approach in §7.2.

### Deprecation (G)

1. **References needing rename:** the repo folder and its files (§6), plus
   `CLAUDE.md`'s app-map table (§3 "Solutions — Deployment Health family") once
   the split actually happens — confirmed via repo-wide grep that `AI_DM`/
   `Config_AI` appear **only** in `CLAUDE.md` and this document's sibling specs
   (`CONFIG_SPEC.md`, `STUDENT_REINTEGRATION_SPEC.md`); `README.md`,
   `.cursorrules`, `apps-script.code-workspace`, `pull_all.ps1`, `verify.ps1` do
   **not** mention AI_DM at all today (they predate it, per CLAUDE.md §10.1), so
   there's nothing stale to clean up there.
2. **Deprecation banner:** not recommended. Decision #6 explicitly frames both
   new apps as a fresh start with no historical baggage; a banner referencing
   AI_DM would contradict that framing for end users who never need to know the
   combined app used to exist. If Jeff wants a short internal-only orientation
   note during the transition window, that's a `report.topMessage`-style
   addition he can add and remove himself — not something to bake into the spec.
3. **Old references to search/remove:** once the rename actually happens, grep
   the new `HS_DM`/`PDX_DM` folders for any leftover literal `"AI_DM"`/`"AI "`/
   `"HiredScore & Paradox"` strings that a mechanical rename might miss (e.g.
   inside `ChangeLog.js`'s header comment, not yet read in this discovery pass —
   check it before finalizing).
4. **Git history/rename risk:** `git mv` preserves history for the moved
   `HS_DM` folder; the cloned `PDX_DM` folder starts with no history of its own
   (expected — it's a new app, not a rename). No risk of losing AI_DM's history
   as long as the move is a straight `git mv`, not a delete-then-recreate.
