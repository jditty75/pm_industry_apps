# HENP Student Reintegration — Implementation Spec

Scope: `libraries/DepMngr` (CoreLib) + `solutions/HENP_DM`. Produced by static,
read-only discovery. **No files were modified, staged, `clasp`-pushed, or
committed to produce this spec.**

Files inspected: `CoreConfig.js`, `CoreData.js`, `CoreSalesforce.js`,
`CoreReport.js`, `CoreUI_Markup.js`, `CoreUI_Js.js`, `CoreUI_Css.js`,
`CoreAnalytics.js`, `CorePortfolioHealth.js`, `CoreNotable.js`,
`Config_HENP.js`, `WebAppCode.js`.

---

## 1. Current architecture summary

HENP is the **only** app with `cfg.student` set (`Config_HENP.js:216-244`,
`enabled: true`). Every other app (`SLG_DM`, `HC_DM`, `AI_DM`, `EVI_DM`) has
`cfg.student` absent, and `CoreConfig.withDefaults()` does **not** seed a
default for `student.*` (confirmed: no `cfg.student` references in
`CoreConfig.js` outside the typedef comment block at lines 43-55, 287). This
means every Student-aware function must, and does, guard itself with
`cfg.student && cfg.student.enabled === true` before doing anything — that
guard is what makes Student a HENP-only feature today, and it's the exact
mechanism the new `mode` flag will extend.

The feature has three parts:

1. **A predicate**: "is this deployment linked to a Student product/function
   row" — computed once from Salesforce data, cached, and reused everywhere.
2. **An exclusion filter**: applied at ~20 call sites across `CoreData.js`,
   `CoreAnalytics.js`, `CorePortfolioHealth.js`, and `CoreNotable.js`, all of
   which funnel through one function, `filterDeploymentsByStudent_`.
3. **A parallel UI surface**: a dedicated "Student" tab, sheet
   (`StudentDeploymentData`), edit modal, and cross-tab banner, all
   config-driven and independent of the main Deployments/Go Lives tabs.

### 1.1 The predicate (identification)

`CoreSalesforce.getStudentDeploymentIds_(config)` (`CoreSalesforce.js:397-457`)
is the single source of truth for "is this a Student deployment":

- Reads `SFDC_DeploymentProductFunctions` (via `cfg.sheets.sfdcDeploymentProductFunctions`).
- Returns `{}` immediately if `cfg.student.enabled !== true` (the SLG/HC
  safety guarantee — this line is the reason the feature can never leak to
  other apps by accident).
- Otherwise, scans every row and builds `{ [Deployment_Id]: true }` for any
  row where `Product_Area__c` **exactly, case-sensitively** equals
  `cfg.student.productAreaMatch` (`'Student'`).
- A deployment with **both** Student and non-Student product-function rows
  (i.e. a mixed Platform + Student deployment) still lands in this map,
  because the match is "at least one qualifying row," not "every row." **This
  is exactly business rule #3/#4 — the existing predicate already implements
  the target semantics with zero changes needed.**
- Two-tier cached: in-memory (`_studentIdsCache`) for the current execution,
  `_PerfCache` (5-min TTL) across executions. Invalidated by
  `CoreSalesforce._clearStudentCache_()`, wired into `CoreData._clearCache`/
  `flushAppCaches` (`CoreData.js:107,530,547-548,582-583`).

A sibling function, `getStudentProductFunctionsMap_` (`CoreSalesforce.js:470-536`),
returns the actual Student product-function rows (function name, target/actual
go-live) per deployment — used today only by the Student tab's expanded-row
detail and MTP-date derivation (`_studentRecordsTargetDateFromPfMap_`,
`CoreData.js:12803`).

### 1.2 The exclusion filter (the single choke point)

`CoreData.filterDeploymentsByStudent_(rows, mode, cfg)` (`CoreData.js:12516-12524`):

```js
function filterDeploymentsByStudent_(rows, mode, cfg) {
  if (!cfg || !cfg.student || cfg.student.enabled !== true) return rows;
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  var studentIds = CoreSalesforce.getStudentDeploymentIds_(cfg) || {};
  if (mode === 'only') {
    return rows.filter(function (r) { return !!studentIds[r.deploymentId]; });
  }
  return rows.filter(function (r) { return !studentIds[r.deploymentId]; });
}
```

Works on any row shape with a `deploymentId` field (deployment rows, go-live
rows, count-grain rows). Called with `mode:'exclude'` at every non-Student
surface, and `mode:'only'` exactly once, inside `buildStudentTabData_`
(`CoreData.js:12844`) to build the Student tab's own row set.

**This single function is the entire architectural leverage point for this
project.** Because every exclusion call site is identical
(`filterDeploymentsByStudent_(rows, 'exclude', cfg)`) and none of them
special-case *why* they're excluding, switching the feature from
"exclude everywhere except the Student tab" to "include everywhere, tag
instead of exclude" is a **change inside one function**, not ~20 call-site
edits. See §4.

### 1.3 The UI surface (parallel, not integrated)

- **Tab**: spliced dynamically into the tab list after role filtering, based
  on `cfg.student.tab.insertAfter` (`CoreUI_Markup.js:86-110`, `_CoreUI_Markup_getAppShell`).
- **Cross-tab banner**: `#student-cross-tab-banner`, shown on
  `cfg.student.banner.showOnTabs` (`CoreUI_Markup.js:126-129`), populated
  client-side, carrying the message *"Student deployments are not included on
  this view. See the {Student} tab..."* (`Config_HENP.js:240`). Per the prior
  `CONFIG_SPEC.md` audit, `showOnTabs` includes `'reporting'`, which does not
  match any real `ui.tabs` id (the report tab's id is `'report'`) — a
  pre-existing typo, not something this project needs to fix, but worth not
  perpetuating if the banner copy/config is touched.
- **Data payload**: `buildStudentTabData_` (`CoreData.js:12839-12889`) — takes
  `filterDeploymentsByStudent_(allEffective, 'only', cfg)`, joins the
  `StudentDeploymentData` sheet (Registration Date, Notes) and the PF map
  (Student Records MTP Date), formats dates via
  `_studentTabCalendarDateField_` (calendar-safe, no timezone shift —
  **a recent fix, must be preserved**, `CoreData.js:12822`).
  Per the prior `CONFIG_SPEC.md` audit, `cfg.student.table.columns`,
  `.defaultStatusFilter`, `.defaultHealthFilter`, `.expandableRows` are
  **dead in the UI layer today** — the Student tab's actual columns/sort are
  hardcoded in `CoreUI_Markup.js`/`CoreUI_Js.js`, not config-driven, despite
  the typedef. Not a blocker for this project, just don't assume changing
  `cfg.student.table.*` will visibly change the Student tab.
- **Edit modal**: `saveStudentDeploymentFields` (`CoreData.js:12900-12934`) —
  writes Registration Date + Notes to `StudentDeploymentData`. Gated by the
  generic `CoreUsers` not-read-only check, **not** by
  `cfg.student.editModal.allowedRoles` (confirmed dead per prior audit —
  don't rely on it).
- **Report banner**: `cfg.report.topMessage.text` = *"This report covers HENP
  Platform deployments only. Student deployments are tracked and reported
  separately."* (`Config_HENP.js:109-112`). Rendered identically across all
  three report shells (inline/Outlook/V2) by `CoreReport.js:1484-1492`ish
  (`cfg.report.topMessage`). This is business rule #10's target.

---

## 2. Student data flow map

```
SFDC_DeploymentProductFunctions (sheet)
        │
        ▼
CoreSalesforce.getStudentDeploymentIds_(cfg)      ← THE predicate (exact-match set)
        │  { deploymentId: true, ... }
        ▼
CoreData.filterDeploymentsByStudent_(rows, mode, cfg)   ← THE choke point
        │
        ├─ mode:'exclude' ─→ every non-Student surface (≈20 call sites, §3)
        │                     Deployments tab, Go Lives (all variants),
        │                     Health/Partner/Approach breakdowns, Portfolio
        │                     Health, Notable, MDS/PGL, Overview snapshot,
        │                     monthly report (via the same CoreData getters)
        │
        └─ mode:'only'  ─→ CoreData.buildStudentTabData_(cfg)
                              │
                              ├─ StudentDeploymentData sheet (Registration
                              │   Date, Notes) via readAllStudentData_
                              └─ CoreSalesforce.getStudentProductFunctionsMap_(cfg)
                                  (Student Records MTP Date)
```

Everything downstream of `getAllEffectiveDeployments`/`getActiveCountDeployments`
(the base row builders — these do **not** filter Student; they return every
deployment) passes through `filterDeploymentsByStudent_` exactly once before
reaching a UI payload or report renderer. There is no second, independent
Student-filtering code path to find and fix — the earlier "search terms" list
in the task (`buildStudentTabData_`, `getStudentProductFunctionsMap_`,
`getStudentDeploymentIds_`) are all confirmed to be this one pipeline.

---

## 3. Exact exclusion points

All of these call `CoreData.filterDeploymentsByStudent_(rows, 'exclude', cfg)`
(or the `filterDeploymentsByStudent_` local alias inside `CoreData`'s own
IIFE). Grouped by file:

**`CoreData.js`** (the data layer — 17 of the ~20 sites):

| Line | Function | Surface |
|---|---|---|
| 6547 | `getActiveDeployments` | Red/Yellow list (legacy) |
| 6606 | `getAllDeployments` | **Deployments tab** main row set |
| 6669 | `getAllDeploymentsForUI` (ProductMode count-grain branch) | Deployments tab KPI count rows |
| 6840 | `getUpcomingGoLives` | **Go Lives tab** — Upcoming (IndustryMode) |
| 6980 | `getRecentGoLives` | **Go Lives tab** — Recent (IndustryMode) |
| 8164 | `getRecentGoLivesFromProductFunctions_` | Go Lives — Recent (ProductMode PF source) |
| 8188 | `getUpcomingGoLivesFromProductFunctions_` | Go Lives — Upcoming (ProductMode PF source) |
| 10408, 10424, 10430 | `_resolveMdsPglActiveRows_` (3 branches) | MDS/PGL survey base rows |
| 12132 | `_computeOverviewSnapshot_` | Overview tab KPI snapshot |
| 13709 | `_getIndustryModeCompletedGoLivesInRange_` | Go Lives Explorer (completed, IndustryMode) |
| 13805 | `_getIndustryModeUpcomingGoLivesInRange_` | Go Lives Explorer (upcoming, IndustryMode) |
| 13844-13845 | `_fetchGoLivesExplorerBaseRows_` (ProductMode branch) | Go Lives Explorer (ProductMode) |

**`CoreAnalytics.js`** (report breakdown tables, used by both the web-app
Monthly Report Preview tab and the emailed report):

| Line | Function | Surface |
|---|---|---|
| 389 | `getHealthBreakdown` | Health Breakdown table |
| 494 | `getPartnerBreakdown` | Partner Breakdown table |
| 555 | `getApproachBreakdown` | Services Approach Breakdown table |
| 640 | `getPsRegionBreakdown` | PS Region breakdown (ProductMode only — not used by HENP today, harmless) |

**`CorePortfolioHealth.js`**:

| Line | Function | Surface |
|---|---|---|
| 50 | `getSnapshot` (displayRows) | Portfolio Health red/yellow account lists |
| 55 | `getSnapshot` (countRows) | Portfolio Health totals/splits |

Line 145-146 documents that `phasedDeployments` count is Student-exclusive
*automatically*, because it derives from `getUpcomingGoLives`, which already
filters — i.e., **no direct filter call there, but an inherited one.** Any
audit of "where is Student excluded" must account for this kind of
inherited exclusion, not just direct call sites.

**`CoreNotable.js`**:

| Line | Function | Surface |
|---|---|---|
| 63 | (Notable view builder) | Notable Deployments tab candidate pool |

**Monthly report**: `CoreReport.js` itself has **zero** direct Student
references (confirmed by grep) — every report table (`RedYellow`,
`RecentGoLives`, `FutureGoLives`, code-computed breakdowns) sources its rows
from the `CoreData`/`CoreAnalytics` functions above, so Student exclusion in
the report is entirely inherited, not a separate mechanism. The only
report-native Student artifact is the static `cfg.report.topMessage.text`
banner (§1.3), which is copy, not a filter.

---

## 4. Target architecture

**Core idea: stop excluding, start tagging.** Do not touch the ~20 call
sites. Change what `filterDeploymentsByStudent_` does, and add one new
tagging function that every row-returning surface already funnels through.

1. **Config gains `cfg.student.mode`** (`'separate'` | `'integrated'`,
   default `'separate'` for backward compatibility — see §5).

2. **`filterDeploymentsByStudent_` becomes mode-aware**:
   - `mode === 'separate'` (or `cfg.student.mode` unset): **today's exact
     behavior, byte-for-byte** — `'exclude'` filters Student out,
     `'only'` (used by the Student tab) is unaffected either way.
   - `mode === 'integrated'`: the `'exclude'` call becomes a no-op (returns
     `rows` unchanged) — Student deployments flow through every surface that
     used to strip them. The `'only'` call (Student tab) is **unaffected** —
     it must keep returning the Student-only subset regardless of `mode`,
     because the Student tab is explicitly retained as a specialized view
     (business rule #7).

   This means **zero of the ~20 call sites change** — they keep calling
   `filterDeploymentsByStudent_(rows, 'exclude', cfg)` exactly as today. Only
   the function body branches on `cfg.student.mode`.

3. **New tagging step, added once, inside `filterDeploymentsByStudent_`
   itself** (or a small sibling called from the same choke point): when
   `mode === 'integrated'`, decorate every row with
   `isStudentDeployment: !!studentIds[row.deploymentId]` before returning it
   unfiltered. Because every downstream surface already receives rows through
   this one function, this single change makes `isStudentDeployment`
   available on Deployments rows, Go Lives rows (all variants — legacy,
   Explorer, ProductMode PF), and count-grain rows, with no per-surface work.
   (In `'separate'` mode, tagging is unnecessary since Student rows never
   reach these surfaces — but tagging unconditionally, in both modes, is
   simpler to implement and reason about, and costs nothing since the
   Student-tab-only `'only'` rows are naturally all `true`. Recommend
   tagging unconditionally.)

4. **Client-side filter chip**, mirroring the **already-existing**
   `productArea`/`funcArea` filter pattern in `CoreUI_Js.js`
   (`deploymentsFilters.productArea`, `rowMatchesProductAreaFilter_`,
   `CoreUI_Js.js:880,2502`) — see §7. No new server round-trip, no threading
   through `viewModeOpts`/`productOpts` parameters that appear on nearly
   every `CoreData` function signature. This is deliberately **not** built
   as a mirror of `cfg.ui.productFilter` (the EVI/AI product-scope filter),
   which re-fetches from the server on every change — that mechanism exists
   because ProductMode's "which grain of row" question requires a server
   round trip; Student inclusion does not, since `isStudentDeployment` rides
   along on rows already fetched.

5. **Student tab, sheet, edit modal, banner, and report topMessage config
   all remain** — only the topMessage *text* changes (business rule #10) and
   the cross-tab banner's *meaning* changes (see §10). No code path for these
   is deleted.

### Why this is the safest shape

- **Blast radius is one function** (`filterDeploymentsByStudent_`) plus one
  new client-side filter (additive, defaults to "All" = today's post-change
  behavior with Student included). Every other Student-aware function
  (`buildStudentTabData_`, `getStudentProductFunctionsMap_`,
  `saveStudentDeploymentFields`, the Student tab markup/JS) is **completely
  unaffected** — they don't call `filterDeploymentsByStudent_` with
  `mode:'exclude'`, so they don't change behavior at all.
- **SLG/HC/AI/EVI are provably unaffected**: `filterDeploymentsByStudent_`'s
  first line, `if (!cfg || !cfg.student || cfg.student.enabled !== true)
  return rows;`, is untouched — the mode branch only matters once you're
  already past that guard, which only HENP passes.
- **Reversible**: flipping `cfg.student.mode` back to `'separate'` (or
  deleting the key) restores today's behavior exactly, with no code changes
  needed on rollback (see §14).

---

## 5. Config changes

Extend `Config_HENP.js`'s existing `student` block — no new top-level key,
no new sheet, no new typedef object, just one new field plus a doc update:

```js
student: {
  enabled: true,
  mode: 'integrated',          // NEW — S2. 'separate' | 'integrated'. Default: 'separate'.
  productAreaMatch: 'Student', // unchanged — already implements "any Student PF row" (rule #3)
  sheets: { studentData: 'StudentDeploymentData' },  // unchanged
  tab: { id: 'student', label: 'Student', insertAfter: 'deployments' },  // unchanged — retained (rule #7)
  table: { /* unchanged */ },
  editModal: { /* unchanged */ },
  banner: {
    enabled: true,              // recommend flipping to false or repurposing copy — see §10
    copy: '...',                // must change — old copy is false once integrated (rule #10 analog for the in-app banner)
    showOnTabs: [ /* unchanged */ ],
    linkToken: '{Student}'
  }
}
```

**`CoreConfig.js` typedef + default additions:**

- `CoreConfig.js:43-55` (`StudentConfig` typedef): add
  `@property {string} [mode] 'separate'|'integrated'; absent = 'separate' (S1 legacy behavior)`.
- `CoreConfig.withDefaults()`: today `cfg.student` gets **no** defaulting at
  all (confirmed — no `cfg.student` references outside the typedef). Add a
  minimal, additive default block:
  ```js
  if (cfg.student && cfg.student.enabled === true && !cfg.student.mode) {
    cfg.student.mode = 'separate';
  }
  ```
  This is the "safest config model" per the task's recommendation — it does
  **not** invent a new defaulting pattern for the rest of `student.*` (which
  today relies entirely on literal declaration, per the existing
  `CONFIG_SPEC.md` finding that this is already a known, accepted gap), it
  only defaults the one new key, and only when Student is already enabled.
  This guarantees that if `mode` is ever omitted by mistake, HENP falls back
  to today's exact behavior rather than accidentally integrating.

**Do not** add a `student.filter.*` sub-block for the Deployments/Go Lives
filter UI — reuse the existing filter-state pattern (`deploymentsFilters.*`,
`goLivesFilters.*`) which has no config-driven option lists today (health,
owner, partner, etc. are all hardcoded three-way or derived from row data) —
a `studentFilter` fits that same shape with a hardcoded `['All','Student',
'Non-Student']` option set, no config needed.

---

## 6. Deployment row tagging design

Add tagging inside `CoreData.filterDeploymentsByStudent_` (or immediately
adjacent, called from the same spot), so it fires for **every** surface in
§3 with no per-surface changes:

```js
function filterDeploymentsByStudent_(rows, mode, cfg) {
  if (!cfg || !cfg.student || cfg.student.enabled !== true) return rows;
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  var studentIds = CoreSalesforce.getStudentDeploymentIds_(cfg) || {};

  if (mode === 'only') {
    return rows.filter(function (r) { return !!studentIds[r.deploymentId]; })
      .map(function (r) { return Object.assign({}, r, { isStudentDeployment: true }); });
  }

  var tagged = rows.map(function (r) {
    return Object.assign({}, r, { isStudentDeployment: !!studentIds[r.deploymentId] });
  });

  if (cfg.student.mode === 'integrated') return tagged;   // NEW — no exclusion
  return tagged.filter(function (r) { return !r.isStudentDeployment; }); // unchanged 'separate' behavior
}
```

- **Field name**: `isStudentDeployment` — chosen because it already exists in
  the codebase with this exact meaning, in the diagnostic function
  `debugTraceDeploymentInUiPipeline` (`CoreData.js:5849`). Reusing the name
  avoids inventing a second convention for the same concept.
- **Mixed Platform + Student deployments** (business rule #11): the
  underlying `getStudentDeploymentIds_` predicate already matches on "any
  qualifying PF row," so a mixed deployment's single deployment-level row
  gets `isStudentDeployment: true` — it appears once, tagged, in the
  Deployments tab, not duplicated. This satisfies rule #4 (mixed deployments
  included in Student filter results) with no additional logic, because
  there is exactly one deployment-level row per `deploymentId` in every
  surface in §3 (they are deployment-grain or go-live-event-grain, not
  product-function-grain — the one exception, ProductMode PF-sourced rows in
  `getRecentGoLivesFromProductFunctions_`/`getUpcomingGoLivesFromProductFunctions_`,
  is not used by HENP, which is IndustryMode).
- **Existing `Object.assign({}, row, {...})` pattern** is already used
  throughout `CoreData.js` (e.g. `getAllDeployments`'s enrichment merge,
  `CoreData.js:6597`) — this tagging follows the same non-mutating-copy
  convention.
- **Performance**: the `.map()` is O(n) per call, same order as the existing
  `.filter()` it replaces in `'integrated'` mode; `getStudentDeploymentIds_`
  is already cached (§1.1), so this adds no new Salesforce/sheet reads.

---

## 7. Go Lives row tagging design

Go Lives rows pass through the **same** `filterDeploymentsByStudent_`
function (§3: lines 6840, 6980, 8164, 8188, 13709, 13805, 13844-13845) — so
§6's change tags Go Lives rows identically, with `isStudentDeployment`
present on every row shape (`getRecentGoLives`, `getUpcomingGoLives`, the
Explorer variants, and the ProductMode PF variants). **No separate design is
needed for Go Lives tagging — it is the same code path.**

One nuance specific to Go Lives: `_enrichGoLiveRowsWithOverrides_` runs
**after** `filterDeploymentsByStudent_` in every call site (confirmed at
each of the 7 lines in §3) and returns new row objects via its own
enrichment step — verify (during implementation, not in this spec) that it
preserves unknown/pass-through fields like `isStudentDeployment` rather than
reconstructing a fixed field allowlist. If it does a fixed-shape rebuild,
`isStudentDeployment` must be added to that allowlist explicitly.

---

## 8. UI filter design

### 8.1 Deployments tab

Mirror the **existing** `productArea`/`funcArea` filter mechanism exactly
(`CoreUI_Js.js:868-890` `initializeDeploymentsFilters`, `2483-2515`
`deploymentRowMatchesFilters_`, `2521-2528` `applyDeploymentsFilters`) — this
is a client-side filter over rows already fetched via
`getAllDeploymentsForUI`, no new server endpoint:

1. `deploymentsFilters.studentFilter = 'All'` added to the filter-state
   object and to `initializeDeploymentsFilters()`'s reset block
   (`CoreUI_Js.js:868-890`).
2. In `deploymentRowMatchesFilters_` (`CoreUI_Js.js:2483-2515`), add:
   ```js
   if (f.studentFilter === 'Student' && !row.isStudentDeployment) return false;
   if (f.studentFilter === 'Non-Student' && row.isStudentDeployment) return false;
   ```
3. Markup: one new `<select>` (or 3-button `seg-control`, matching the
   existing "Health chips" visual style) in `_CoreUI_Markup_buildDeploymentsTab_`
   (`CoreUI_Markup.js`), gated by `cfg.student && cfg.student.enabled &&
   cfg.student.mode === 'integrated'` so it never renders for
   `'separate'` mode or for any other app.
4. Default value `'All'` — satisfies rule #1 (Student included in all counts
   by default) without requiring the user to opt in.

### 8.2 Go Lives tab

HENP's `ui.goLivesTab.mode` is `'legacy'` (`Config_HENP.js:183`), which
renders via `_CoreUI_Markup_buildGoLivesTabLegacy_` (`CoreUI_Markup.js:471-526`)
and filters client-side in `applyGoLivesView()`/`searchGoLives()`
(`CoreUI_Js.js:1557-1606`) over `allGoLivesRecent`/`allGoLivesUpcoming`
(fetched via `getRecentGoLivesData`/`getUpcomingGoLivesData`,
`WebAppCode.js:47-53`, which already receive tagged rows once §6 lands).

1. Add `goLivesLegacyFilters.studentFilter = 'All'` (a new small state object,
   since the legacy view doesn't currently have a `goLivesFilters`-style
   object beyond `currentGoLivesView`/`goLivesSearch` module-level vars —
   simplest to add one parallel variable, `goLivesStudentFilter`, rather than
   building a full filter-state object for a single control).
2. In `applyGoLivesView()` (`CoreUI_Js.js:1557-1594`), add the same two-line
   check as §8.1 step 2, applied to `source` alongside the existing search
   filter.
3. Markup: one 3-button `seg-control` (matching the existing
   Recent/Upcoming/All view toggle style at `CoreUI_Markup.js:502-506`)
   added to `_CoreUI_Markup_buildGoLivesTabLegacy_`, same gating condition
   as §8.1 step 3.
4. **Note for future-proofing, not required now**: if HENP is ever switched
   to `goLivesTab.mode: 'explorer'`, the Explorer's `goLivesFilters` object
   (`CoreUI_Js.js:181`) and `onGoLivesFilterChange_`/advanced-filter-drawer
   pattern (mirrors `productArea`, `CoreUI_Markup.js:655-658`) would need the
   same `studentFilter` addition — out of scope for this spec since HENP is
   on `'legacy'` today, but the pattern is directly transferable.

### 8.3 Cross-tab banner (existing, not requested but affected)

The existing `#student-cross-tab-banner` (§1.3) currently says Student rows
are excluded from the current view. Once `mode: 'integrated'`, this
statement becomes false everywhere it shows. See §10 for the recommended
resolution (repurpose or disable).

---

## 9. Monthly Report changes

Business rules #9/#10. Two independent things change:

1. **Data inclusion (rule #9)** — automatic, no report-code changes. Every
   report table sources rows from `CoreData`/`CoreAnalytics` functions in
   §3, all of which route through `filterDeploymentsByStudent_`. Once
   `cfg.student.mode = 'integrated'`, Student deployments appear in:
   Red/Yellow, Recent Go Lives, Future/Upcoming Go Lives, Health Breakdown,
   Partner Breakdown, Approach Breakdown, Executive Summary (via whichever
   `CoreData` getters it uses) — in **all three** report shells (inline,
   Outlook, V2/Gmail), since none of them have their own Student-filtering
   logic (confirmed §3, `CoreReport.js` has zero direct Student references).

2. **Top message copy (rule #10)** — `Config_HENP.js:109-112`,
   `cfg.report.topMessage.text`. Change from *"This report covers HENP
   Platform deployments only. Student deployments are tracked and reported
   separately."* to either:
   - **Remove the banner** (set `topMessage: {}` or delete the block) —
     `CoreReport.js`'s `msg = String(topMsg.text||'').trim(); if (!msg)
     return '';` (confirmed in the prior config audit) means an absent/blank
     `text` cleanly renders nothing, in all three shells, with no code
     change needed.
   - **Or replace with an accurate message**, e.g. *"Student deployments are
     included in all sections above. See the Student tab for
     Student-specific details (registration dates, notes, Student Records
     MTP)."* — recommended over removal, since it also signals *why* the
     Student tab still exists (ties into rule #7/§10 below) rather than
     leaving users to wonder.

   Either way this is a **pure config-value edit** in `Config_HENP.js` — no
   `CoreReport.js` code change, since `topMessage` rendering is already
   fully data-driven and HTML-escaped (confirmed, prior audit §2.9).

---

## 10. Student tab retention/deprecation plan

Business rules #7/#8: retain the Student tab as a specialized detail view.

- **Keep as-is, unconditionally**: `buildStudentTabData_`,
  `saveStudentDeploymentFields`, the `StudentDeploymentData` sheet, the edit
  modal, Registration Date / Notes / Student Products / Student Records MTP
  Date fields, and the Student-tab-specific date-sort logic in `CoreUI_Js.js`
  (`studentRowDateForSort_`, `compareStudentDateKeys_`,
  `updateStudentDateSortHeaders_`, ~lines 10443-10470 — **explicitly called
  out as a recent fix to preserve** in the task). None of these are touched
  by §4-§9. The `'only'` mode of `filterDeploymentsByStudent_` is unaffected
  by the `mode` flag (§4 point 2), so the Student tab's row set is identical
  before and after this project.
- **Cross-tab banner** (`cfg.student.banner`, §1.3/§8.3): its current copy
  is false once integrated. Two options, pick one during implementation
  (does not need to be decided in this spec, but must be decided before
  shipping):
  - **Disable it** (`banner.enabled: false`) — simplest, no code change,
    since the banner markup/JS is already gated on `banner.enabled !== false`
    (`CoreUI_Markup.js:127`, `CoreUI_Markup.js:173`-equivalent client check).
  - **Repurpose its copy** to something like *"This deployment set includes
    Student. Use the Student filter above to isolate Student-only rows, or
    see the Student tab for Student-specific fields."* — keeps a discovery
    affordance for the new filter, at the cost of updating `banner.copy` and
    re-verifying `showOnTabs` (and fixing the pre-existing `'reporting'`
    vs `'report'` typo while touching this key, since it's adjacent — not
    required, but a natural time to do it).
- **No functions become fully dead** from this change — `buildStudentTabData_`,
  the Student sheet I/O, and the edit modal stay load-bearing as long as the
  Student tab exists (rule #7 says "for now," implying this is Phase 1 of a
  longer arc, not the end state — see §11).

---

## 11. Implementation phases

**Phase A — Config + core filter (no visible UI change yet):**
1. Add `mode` to the `StudentConfig` typedef and the one-line default in
   `CoreConfig.withDefaults()` (§5).
2. Change `filterDeploymentsByStudent_` to tag + branch on `mode` (§6).
3. Set `Config_HENP.js`'s `student.mode = 'integrated'`.
4. Manually verify (Debug menu / `debugTraceDeploymentInUiPipeline`,
   `debugHenpStudentRowForUI`) that a known Student deployment now appears
   in `getAllDeployments`/`getRecentGoLives`/`getUpcomingGoLives` output with
   `isStudentDeployment: true`, and that counts (Deployments KPI cards,
   Portfolio Health totals, Health/Partner/Approach breakdowns) increased by
   the expected number of Student deployments.

**Phase B — UI filters:**
5. Deployments tab filter chip/dropdown (§8.1).
6. Go Lives (legacy) tab filter (§8.2).
7. Manually verify filter behavior in the browser: All/Student/Non-Student
   on both tabs, including a mixed Platform+Student deployment showing under
   both "All" and "Student" (rule #4).

**Phase C — Messaging cleanup:**
8. Update `cfg.report.topMessage.text` (§9).
9. Resolve the cross-tab banner (§10) — disable or repurpose.

**Phase D — Regression pass:**
10. Re-verify all four preserved-fix areas named in the task (§13/validation
    plan below) still behave correctly with Student rows now flowing
    through the same code paths they use.
11. Re-verify SLG_DM/HC_DM/AI_DM/EVI_DM are unaffected — none declare
    `cfg.student`, so `filterDeploymentsByStudent_`'s first-line guard
    (`!cfg.student || cfg.student.enabled !== true`) means the new `mode`
    branch is dead code for them; a smoke check (`npm run push` to HEAD
    already affects them per CLAUDE.md §4 — call this out explicitly when
    proposing the CoreLib push) is still worth doing since this is a
    library-wide file.

Each phase is independently shippable and revertable (flip `mode` back to
`'separate'` at any point without touching code).

---

## 12. Files/functions to change

| File | Function(s) | Change |
|---|---|---|
| `libraries/DepMngr/src/CoreConfig.js` | `StudentConfig` typedef (43-55), `withDefaults()` | Add `mode` field + one-line default |
| `libraries/DepMngr/src/CoreData.js` | `filterDeploymentsByStudent_` (12516-12524) | Add tagging + `mode` branch — **only function with a behavior change** |
| `libraries/DepMngr/src/CoreUI_Markup.js` | `_CoreUI_Markup_buildDeploymentsTab_`, `_CoreUI_Markup_buildGoLivesTabLegacy_` (471-526) | Add filter control markup, gated on `cfg.student.mode === 'integrated'` |
| `libraries/DepMngr/src/CoreUI_Js.js` | `initializeDeploymentsFilters` (868-890), `deploymentRowMatchesFilters_` (2483-2515), `applyGoLivesView`/`searchGoLives` (1557-1606) | Add `studentFilter` state + matching logic |
| `libraries/DepMngr/src/CoreUI_Css.js` | (none required) | Reuse existing `.filter-select`/`.seg-control` classes |
| `solutions/HENP_DM/src/Config_HENP.js` | `student` block (216-244), `report.topMessage` (109-112) | Add `mode: 'integrated'`; update/remove banner text |

**Unchanged, confirmed by this audit:**
- All ~20 `filterDeploymentsByStudent_(rows, 'exclude', cfg)` call sites
  (§3) — zero edits.
- `CoreSalesforce.getStudentDeploymentIds_`/`getStudentProductFunctionsMap_` —
  the predicate already implements rule #3 exactly.
- `buildStudentTabData_`, `saveStudentDeploymentFields`,
  `ensureStudentDataSheet_`, `readAllStudentData_`, `writeStudentDataRow_` —
  Student tab data layer, untouched.
- `WebAppCode.js` — no new endpoints needed; `getAllDeploymentsForUI`,
  `getRecentGoLivesData`, `getUpcomingGoLivesData` already pass through
  tagged rows once `CoreData` changes land, with no signature changes.
- `CoreReport.js`, `CoreNotable.js`, `CorePortfolioHealth.js`,
  `CoreAnalytics.js` — inherit the new behavior through their existing calls
  to `filterDeploymentsByStudent_`; no edits.

**Deprecated or repurposed (business rule #13):**
- Nothing is deprecated. `cfg.student.mode: 'separate'` remains a fully
  supported legacy path (for rollback, or if leadership ever reverses this
  decision for HENP specifically) — not dead code, just an alternate branch.
- `cfg.student.banner.*` is **repurposed** (§10), not deprecated —
  recommend against deleting it even if disabled, since re-enabling for a
  future need is then a one-line config flip instead of rewritten markup.

---

## 13. Validation plan

No test framework exists in this repo (`CLAUDE.md` §5) — verification is
manual, via the Apps Script editor / Debug menu / live web app, and must be
stated as such rather than claimed as "tested."

**Functional checks:**
1. `debugTraceDeploymentInUiPipeline(deploymentId)` for a known Student-only
   deployment — confirm `isStudentDeployment: true` (this diagnostic already
   computes this exact flag at `CoreData.js:5849`, so it's a ready-made
   before/after check) and confirm the row now survives into
   `getAllDeploymentsForUI` output (`includedInFinalUiRows: true`), where
   before this project it would have been excluded.
2. `debugHenpStudentRowForUI()` — confirm Student tab payload (registration
   date, Student Records MTP date, calendar-safe date fields) is byte-for-byte
   unchanged (this function only reads `'only'`-mode data, which §6
   deliberately does not alter).
3. Deployments tab: total count increases by the number of Student
   deployments; filter to "Student" shows only Student rows including any
   mixed Platform+Student deployment; filter to "Non-Student" excludes them;
   "All" (default) shows everything.
4. Go Lives tab (Recent + Upcoming + All sub-views): same three-way filter
   check; confirm a Student deployment's go-live date appears in the correct
   window.
5. Portfolio Health tab: Green/Yellow/Red totals, red/yellow account lists,
   and partner/industry splits all increase to include Student counts.
6. Monthly Report Preview (all three shells if reachable from the UI, or at
   minimum V2): Health/Partner/Approach Breakdown tables include Student
   rows in their counts; Red/Yellow and Go Lives tables list Student
   deployments; top-message banner shows the new/removed text.
7. Notable Deployments tab: confirm Student deployments are now eligible
   candidates in the add-picker (inherits via `CoreNotable.js:63`).

**Regression checks (explicitly called out in the task — preserve these):**
8. **Calendar-date handling**: `_studentTabCalendarDateField_` output for
   Student tab rows unchanged (check 2 above covers this, since `'only'`
   mode is untouched).
9. **View-as-read-only**: confirm `access.isViewAsReadOnly` banner
   (`CoreUsers.js:461-494`, `CoreUI_Markup.js:117-118,252`) still renders
   correctly and that the new Student filter control respects read-only DOM
   guards the same way existing filters do (it's a plain `<select>`/
   `seg-control`, same as `productArea`/health chips, so this should be
   automatic — verify, don't assume).
10. **Partner analysis exclusion**: `CoreConfig.filterRowsForPartnerAnalysis_`
    (`CoreConfig.js:1209`) still excludes the configured partners correctly
    now that its input rows (from `getActiveCountDeployments`) include
    Student rows — confirm a Student deployment with an excluded partner is
    still excluded from the Partner Breakdown, and one with a non-excluded
    partner now appears.
11. **MDS/PGL clustering**: `getMgmPglGoLiveEventClusterDays`
    (`CoreConfig.js:1061`) and `_resolveMdsPglActiveRows_`
    (`CoreData.js:10403-10436`) — HENP has `mgmPglTab.enabled: false`
    (`Config_HENP.js`, confirmed in prior audit §2.12/§3), so this surface
    is not user-visible for HENP today; verify no error is thrown by the
    now-tagged rows flowing through the (dormant) MDS/PGL code path anyway,
    since it still executes on the backend if ever queried directly.
12. **HENP Student date columns/sorting**: `studentRowDateForSort_`,
    `compareStudentDateKeys_`, `updateStudentDateSortHeaders_`
    (`CoreUI_Js.js` ~10443-10470) — confirm Student tab sort behavior is
    unchanged (again, `'only'`-mode data path, untouched by this project).
13. **Report top message config mechanism**: confirm the generic
    `cfg.report.topMessage` rendering (used only by HENP today) still works
    correctly for blank/removed text (no banner) and for new text (banner
    renders, escaped, in all three shells) — this is pure regression on
    existing, unmodified `CoreReport.js` code, but worth confirming since
    it's the literal deliverable of rule #10.

**Cross-app checks:**
14. `SLG_DM`, `HC_DM`, `AI_DM`, `EVI_DM` — spot-check (e.g. `getAllDeployments`
    row count via Debug menu) unaffected, since none declare `cfg.student`.

---

## 14. Rollback plan

Because the entire behavior change is gated by one config value
(`cfg.student.mode`) read at one call site
(`filterDeploymentsByStudent_`), rollback has two independent levels:

1. **Instant, code-free rollback**: set `Config_HENP.js`'s
   `student.mode = 'separate'` (or delete the `mode` key entirely — the
   `withDefaults()` addition in §5 defaults absent `mode` to `'separate'`)
   and push/deploy just that config file. This restores byte-for-byte
   pre-project behavior for every surface in §3, with the CoreLib code
   changes still in place but dormant. No `CoreLib` re-push needed for this
   level of rollback.
2. **Full code rollback**: revert the `CoreConfig.js`/`CoreData.js`/
   `CoreUI_Markup.js`/`CoreUI_Js.js` commits and re-push `libraries/DepMngr`
   to HEAD. Per CLAUDE.md §4, this is a five-app production change the
   moment it's pushed (all `*_DM` apps pin CoreLib at HEAD/`developmentMode:
   true`) — call this out explicitly if a rollback of this depth is ever
   needed, exactly as it must be called out for the forward push.

Because SLG/HC/AI/EVI never touch the changed code path (guarded by
`cfg.student.enabled !== true`), neither rollback level requires any
action or verification on those four apps beyond the "still unaffected"
smoke check in §13.14 — there is no forward-migration state (no new sheet
schema, no data written in a new shape) that would make rollback lossy.
The `StudentDeploymentData` sheet schema and content are completely
unaffected by this project in both directions.

---

## Summary of business-rule coverage

| Rule | Covered by |
|---|---|
| #1 All counts/lists/tabs/reports include Student | §4 (mode-aware filter), §9 |
| #2 Student is a tag, not a partition | §6 (`isStudentDeployment` flag, additive) |
| #3 Any Student PF association → tagged | §1.1 (predicate already implements this), §6 |
| #4 Mixed Platform+Student included in Student filter | §6 (single deployment-grain row, existing predicate) |
| #5 Deployments tab filter: All/Student/Non-Student | §8.1 |
| #6 Go Lives tab same filter | §8.2 |
| #7 Student tab remains | §10 |
| #8 Student-specific fields remain in Student tab | §10 (untouched, `'only'`-mode) |
| #9 Monthly Report includes Student in normal sections | §9.1 |
| #10 Report top message changed | §9.2 |
