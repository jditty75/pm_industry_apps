# CSAT Surveys: deployment-centric operational design (2026-10-06)

Status: **UX/interaction design — prototype implemented for visual review.** Localhost preview only (`.\preview.ps1 CSAT_SURVEYS`, default **Normal**). No production UI/CSS/JS, no CLASP, no deploy. Applies the product-approved [reconciled architecture](../csat-reconciled-architecture/README.md) (J1–J6) and the provisional [CSAT Overview V3](../csat-overview-v3/README.md) visual vocabulary to the **Surveys** section.

**Prototype:** `skills/gas-monorepo-engineer/dm-ux-csat-surveys/` · stable URLs `CSAT_SURVEYS_*.html` in `.preview-out/` · handoff [composer-preview-spec.md](composer-preview-spec.md).

Surveys owns the **operational survey lifecycle** for deployments: *Prepare → In Flight → Responded / Closed → follow-up context*. Overview is the executive lens; Surveys is where the Engagement Manager works. This document does not restate the architecture; it decides the Surveys surface.

## 1. The design in one paragraph

Surveys is **one lifecycle-ordered surface**, not a set of tabs. A sticky scope + filter bar and a single dense **horizon line** sit on top. Below them the deployments' surveys appear in three stacked groups in reading order — **Upcoming (prepare)**, **In Flight (survey)**, **Recent (responded / closed)** — each with a lifecycle eyebrow, so the page reads *Prepare → Survey → Respond* top to bottom without a diagram. The atomic unit is a **deployment × survey row** (one MDS or one PGL for one deployment), dense and two-line. A row carries an **attention marker only when something needs doing**, so exceptions stand out and normal surveys stay quiet. Within each group, attention rows sort to the top and time-critical ones first. Every count drills to the deployments behind it. The five operational problems — **Prepare now · Can't forecast · Chase now · Delivery problem · Follow-up expected** — stay visually and semantically distinct and are never summed into "needs attention". DM states *what* to fix, *where* (SFDC / customer / VoC Slack / Qualtrics) and *by when*; it never performs the action.

## 2. Navigation model — one surface, not tabs

**Recommendation: a single lifecycle surface, grouped by phase, with a sticky filter + phase-jump bar. No internal `Upcoming | In Flight | Recent` tabs.**

| Why | Detail |
|---|---|
| The architecture already rejected splitting the lifecycle | `navigation-and-overview.md` rejects `Overview \| Upcoming \| In Flight \| Responses` because "Upcoming and In Flight are adjacent states of the same object; separating them breaks the lifecycle". The same reasoning forbids tabs **inside** Surveys |
| The primary job is cross-phase awareness | An EM preparing next round must also see a bounce in the current round and an acknowledgement waiting on last round. One surface shows the whole operational state in one scan — the guidebook's "Monthly Checklist" mental model. Tabs hide the other phases |
| A tab is just a sticky phase filter | Exposing **phase** as a filter/jump chip gives the same orientation and quick narrowing, but composably (phase × type × attention × round) and with one URL/state/DOM. The phase-jump bar doubles as a scroll-spy |
| Density is handled by grouping, not hiding | Issue-first sort, `+k more` overflow, and a collapsible "Later" horizon keep a heavy portfolio legible without burying whole phases behind a tab |
| Simplicity and low-volume grace | One surface, one scope model shared with Overview, no tab-state and no empty-tab confusion when a phase has nothing in it |

**Trade-off acknowledged:** at a very heavy portfolio the page is long. Mitigated by the sticky phase-jump bar (scroll-spy), attention-first sort, `+k more` collapse, and a collapsed "Later (within horizon)" block. This is strictly stronger than tabs and keeps the interaction model minimal.

## 3. Page reading order

Order follows the brief's priority list (upcoming/preparation is primary):

| # | Band | Content | Answers |
|---|---|---|---|
| 0 | **Scope + filter bar** (sticky) | Scope menu (inherited "My deployments" · Workday-led · horizon ▾); phase-jump All · Upcoming · In Flight · Recent; filter chips Type (MDS/PGL), Attention, Round | *What am I looking at, and how do I narrow it?* |
| 1 | **Horizon line** (one dense row, no tiles) | "Next round Wed 4 Nov · prepare by 21 Oct (12 days) · **9** to prepare, **2** with issues · In flight **11**, **1** to chase · Recent **6** responded, **2** closed unanswered" — every count a filter-link | *What is the shape of my operational month?* |
| 2 | **Upcoming** group *(PREPARE)* | Rounds (Next → Following → Later), readiness issues first, then clean rows; a **Can't forecast** tail subgroup | *What's coming and what must I prepare/fix before launch?* |
| 3 | **In Flight** group *(SURVEY)* | Current round(s); chase/bounce exceptions first, then awaiting/opened, then responded-while-open | *What's in motion, and what needs chasing or has delivery problems?* |
| 4 | **Recent** group *(RESPOND · CLOSE · FOLLOW UP)* | Responded / closed in the recent window; follow-up expectation; links to Responses | *What happened to this survey, and where is follow-up expected?* |

The three group eyebrows spell the lifecycle **PREPARE → SURVEY → RESPOND · CLOSE · FOLLOW UP**, consistent with V3's eyebrow lifecycle.

## 4. The primary deployment-survey row

One row = **one deployment × one survey (MDS or PGL)**. Dense, two lines. The same anatomy in every group; only the "date that matters" and the facets change by phase.

```
 ┌── attention ──┬────────── deployment ──────────┬── type ──┬──── date that matters ────┐
 │ [⚠ Prepare]   │ Example Children's Hospital      │   MDS    │ Prepare by 21 Oct · 2 days │  line 1
 │               │   No Executive Sponsor contact · fix in SFDC                            │  line 2 (facets + where)
 └───────────────┴──────────────────────────────────┴──────────┴────────────────────────────┘
```

| Element | Rule |
|---|---|
| **Attention marker** (left, fixed col) | A `.status-pill` **only when an attention kind applies**; otherwise empty. Colour fill is rare (see §7). This is how exceptions are found without turning every survey into an alert |
| **Deployment** (name link, 14/600, truncate + `title`) | The core object. Links to **deployment CSAT history**. Account/context as a 12px muted sub where it aids scanning |
| **Survey tag** | Neutral `.survey-pill` MDS / PGL |
| **Date that matters** (right, tabular) | Upcoming → forecast round + prepare-by; In Flight → closes in N; Recent → responded / closed date. Exactly one dated emphasis per row |
| **Facet line** (line 2, 12–13px muted) | Phase-appropriate facets (readiness / invitation breakdown / follow-up), each ending in **where to act**: *fix in SFDC* · *with the customer* · *request in VoC Slack* · *in Qualtrics*. Never a DM action control |
| **Never on a row** | A "ready" claim, a "confirmed contact" claim, "overdue/completed/closed", respondent name/role, comment text, an averaged verdict |

The row makes the six required facts answerable at a glance: **which deployment · which survey · where in the lifecycle (group + facets) · what date matters · whether something needs attention · what to do next (and where).**

## 5. Preparation / readiness treatment (primary workflow)

Upcoming leads the page and carries the only dated deadline. Grouped by **round**; the prepare-by date (open − 14 days) is the real milestone, not the survey month.

- **Row date:** forecast round (MDS MM-YY / PGL MM-YY, the customer-slide value) + **Prepare by {weekday date} · {k} days**. ≤ 7 days with issues → ⚠ + `--color-status-yellow-fg`. After it passes → muted "Prepare-by passed · launches {date}" (correcting SFDC is still worth it; launch is the irreversible point, GB-15).
- **Readiness facets** name the *missing thing*, never a readiness verdict: "No Executive Sponsor contact", "No customer contact with email", "Missing First Target MTP date". Each ends "· fix in SFDC" (or "· Services Care case" where a contact needs raising). DM reports **presence, not correctness** — "present", never "confirmed" or "ready" (DG-05, DG-07).
- **Sort:** rows with readiness issues first, then clean rows ("dates and contacts present"). Clean rows stay visible but quiet — the EM still needs the customer MM-YY for the slide.
- **Horizon:** Next + Following round by default; a collapsed **Later (within the 6-month horizon)** block — Surveys may show a longer horizon than Overview (the architecture puts the six-month horizon here).
- **Can't forecast** is a **distinct tail subgroup**, not a Prepare-now row: "Can't forecast — missing dates" rows, neutral/muted, "fix dates in SFDC". It is a forecast limitation, never counted as preparation attention and never papered over.

## 6. In Flight treatment

Current round(s), grouped under a round header carrying **closes {date} · {k} days**. The survey is one lifecycle; the per-invitation detail is a facet.

- **Row date:** "Closes 28 Oct · 6 days".
- **Facet line:** deployment-level roll-up of invitations — "3 invitations · 1 opened · 2 awaiting" / "1 of 2 contacts responded, 1 awaiting". Delivery is **inferred** (no bounce + no finish = received and awaiting, GB-24); never labelled "delivered".
- **Per-contact invitation detail** (awaiting / opened / started / bounced, with EM mismatch where supported) sits behind a single collapsed `<details>` on the row and is **POWER_USER+ only** (contacts are gated, V1-4). This is the one interactive disclosure in Surveys.
- **Sort:** exceptions first (all-bounced → chase → some-bounced), then awaiting/opened, then responded-while-open at the bottom.

## 7. Attention states — five distinct kinds, never summed

Each kind has its own label, colour discipline, owner and system of action. They are never added into one "needs attention" total.

| Kind | Trigger | Marker | Colour | Where to act | Group |
|---|---|---|---|---|---|
| **Prepare now** | `UPCOMING` in the prepare window with a readiness issue (missing date, or missing PM/Exec-Sponsor contact with email) | `Prepare` | Neutral; **⚠ yellow** only when prepare-by ≤ 7 days | SFDC / Services Care case | Upcoming |
| **Can't forecast** | `CANNOT_FORECAST` — required dates missing, month uncomputable | `Can't forecast` | Muted (never alarm) | Fix dates in SFDC | Upcoming tail |
| **Chase now** | `IN_FLIGHT` closing ≤ 7 days with no response from any contact | `Chase` | **⚠ yellow** | With the customer | In Flight |
| **Delivery problem** | `IN_FLIGHT` with bounced invitations | `Some bounced` / **`All bounced`** | Some = neutral-warn; **All = red** (no customer voice possible without a resend) | Fix email in SFDC · request resend in VoC Slack | In Flight |
| **Follow-up expected** | `RESPONDED`, Workday-led, recent: every MDS response (acknowledgement) + every Detractor (MDS/PGL) | `Follow-up expected: {owner role}` | **Neutral, never urgent** | Qualtrics | Recent |
| **Launch not seen** | `LAUNCH_NOT_SEEN` — forecast said launched, no invitation after open + grace | `Launch not seen` | Muted | Ask VoC in Slack | In Flight (foot) |

Urgency (colour) appears **only where supported**: time-critical prepare/chase (≤ 7 days) and all-bounced. Follow-up expected is routine (every MDS response creates one) and is never coloured or called overdue. The **Attention** filter chips are these exact kinds, each selectable on its own — selecting one never implies a combined count.

## 8. Recent / closed treatment (lifecycle closure, not analysis)

Surveys gives **just enough closure** to answer *"what happened to this survey?"*; detailed scores/comments/themes live in **Responses**.

- **Window (proposed S1):** current + previous round (≈ 60 days). Responded and closed-without-response rows appear here.
- **Responded row:** "Responded 26 Sep · 1 of 2 contacts" + follow-up facet. Links to **Responses** (pre-filtered) for the verdict and to deployment history. Several respondents are never averaged.
- **Closed without response:** shown honestly — "Closed 24 Sep · no response · silence isn't a verdict". Never "completed" or "overdue".
- **Follow-up facet (proposed, inherits V3-D5):** response ≤ 30 days old and Workday-led → "Follow-up expected: {Deployment Sponsor / EM} · in Qualtrics"; older → "Follow-up status in Qualtrics". Partner-led → no facet (DG-13). Expectation only — never completion, owner or outcome.
- Beyond the InFlight window (~3 months) closed-without-response and bounces are **lost** (DG-08). Recent is bounded by it and says so in the method note; durable history is `FUTURE_DATA_REQUIRED`.

## 9. Follow-up treatment

DM shows the **expectation**, Qualtrics owns the **action and status**. On Recent rows (and summarised in the horizon line as "k with follow-up expected"), DM states "Acknowledgement expected · in Qualtrics" (every MDS response) or "Detractor follow-up expected: {owner role} · in Qualtrics" with "within ~5 business days of the response". It never shows a ticket state, owner after reassignment, reason or outcome (`QUALTRICS_INTEGRATION_REQUIRED`, DG-12 / DG-20 — `FUTURE_DATA_REQUIRED`). The same Detractor appears in Responses as evidence and here as an expectation; neither copies the other.

## 10. Filters / scope (progressive disclosure, not role dashboards)

| Control | Form | Serves |
|---|---|---|
| **Scope menu** (right of sub-nav, shared with Overview) | Delivery leadership (Workday-led *default* · Partner-led · All) · Window/Horizon · inherited "My deployments" prefix | All roles; EM defaults to *My deployments* where personalization is on (validate; off for HC/HENP) |
| **Phase jump** | All *(default)* · Upcoming · In Flight · Recent — scroll-spy that can also narrow | Orientation and quick focus |
| **Type** | MDS · PGL toggles | Narrowing |
| **Attention** | Prepare now · Can't forecast · Chase now · Delivery problem · Follow-up expected · Launch not seen (each independent) | The distinct exception kinds |
| **Round** | Rounds within the horizon | Focus on one launch |

One surface serves all three roles by **scope + reading depth**, not separate dashboards:

- **Engagement Manager** — default scope *My deployments*; lives in Upcoming + In Flight; attention chips are their worklist.
- **Delivery Director / Sponsor** — scope *their* deployments; reads readiness oversight across EMs and Detractor follow-up expectations; same surface.
- **Leadership** — broad scope; reads the horizon line and uses attention chips to see portfolio operational exposure; drills into rows.

## 11. Drill-down

| From | To |
|---|---|
| Deployment name (any row) | Deployment CSAT history (shared surface; also reached from Overview, Responses, DM deployment detail) |
| Responded row | Responses, pre-filtered to that deployment × survey |
| Horizon-line counts / group-header counts | The list, filtered (conceptual drill to deployments) |
| Readiness facet | Names the missing role/date; action "in SFDC" (no deep link; DM never edits SFDC) |
| In-flight row `<details>` | Per-contact invitation status (POWER_USER+) |
| Follow-up facet | Qualtrics ticket view (no per-ticket deep link; ticket key not in our data, DG-12) |

No deployment **drawer** is built in this pass (out of scope / whole-app work).

## 12. 1440 × 900 composition

Real DM shell: `.header`, `.tabs` (CSAT active), `.csat-subtab-nav` **Overview · Surveys · Responses** (Surveys active). Container `max-width:1400px`, content x = 44…1396. Sticky scope+filter bar and a one-line horizon strip, then the three stacked groups scroll beneath. This is an **operational** screen: denser than Overview, row rhythm 20–22px baselines, two-line rows ≈ 48px, no KPI tiles, no large cards.

```
 x=44                                                                                                 x=1396
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ y=24
 │▐W▌ Healthcare Deployment Health Manager                         ● Data as of Oct 9, 2026   Showing: All │ header
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘ y=102
   Deployments  Go Lives  Reporting  Portfolio Health  [CSAT]  Notable Deployments  Manage Overrides        tabs
 ──────────────────────────────────────────────────────────────────────────────────────────────────────── y=174
   Overview   [Surveys]   Responses                       My deployments · Workday-led · Next 6 months ▾    sub-nav + scope
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ y=218  (sticky)
 │ All · Upcoming · In Flight · Recent   │  MDS  PGL   │  Attention ▾   │  Round ▾                        │ filter + jump
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘ y=258
   Next round Wed 4 Nov · prepare by 21 Oct (12 days) · 9 to prepare, 2 with issues · In flight 11, 1 to    horizon line
   chase · Recent 6 responded, 2 closed unanswered                                                          y=258–290
 ┌ PREPARE ───────────────────────────────────────────────────────────────────────────────────────────┐ y=300
 │ Upcoming · Next round Wed 4 Nov · 9 deployments · 6 MDS · 3 PGL · Prepare by Wed 21 Oct · 12 days      │ eyebrow+hdr
 │ [⚠ Prepare] Example Children's Hospital          MDS   Prepare by 21 Oct · 12 days                     │ ← issue first
 │             No Executive Sponsor contact · fix in SFDC                                                 │
 │ [⚠ Prepare] Sample University Health             PGL   Prepare by 21 Oct · 12 days                     │
 │             No customer contact with email · fix in SFDC                                               │
 │             Example Health Network               MDS   Prepare by 21 Oct · 12 days                     │ ← clean rows
 │             Dates and contacts present · tell the customer MDS 11-26                                   │
 │  + 6 more in this round →         Following round Wed 2 Dec · 7 →      Later (within horizon) 14 ▸      │
 │ [Can't forecast] Northview Specialty Clinics     MDS   Missing First Target MTP · fix dates in SFDC    │ ← distinct tail
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ SURVEY ────────────────────────────────────────────────────────────────────────────────────────────┐
 │ In Flight · October round · closes 28 Oct · 11 surveys · 3 responded · 8 awaiting                      │ eyebrow+hdr
 │ [All bounced] Lakeside Community Health          PGL   Closes 28 Oct · 6 days                          │ ← urgent first
 │             2 invitations · all bounced · fix email in SFDC · request resend in VoC Slack              │
 │ [⚠ Chase]   Sample Regional Medical Center       MDS   Closes 28 Oct · 6 days                          │
 │             3 invitations · 1 opened · 2 awaiting · chase with the customer                            │
 │             Example Children's Hospital          PGL   Closes 28 Oct · 6 days ▸ invitation detail      │ ← normal
 │             2 invitations · 1 of 2 responded · 1 awaiting                                              │
 └──────────────────────────────── fold ≈ y=900 ──────────────────────────────────────────────────────┘
 ┌ RESPOND · CLOSE · FOLLOW UP ────────────────────────────────────────────────────────────────────────┐ (scroll)
 │ Recent · current + previous round · 6 responded · 2 closed without response                            │
 │             Example Valley Medical              MDS   Responded 26 Sep · 1 of 2 contacts               │
 │             Acknowledgement expected · in Qualtrics → Responses                                        │
 │ [Follow-up] Riverside Care Alliance             PGL   Responded 21 Sep · Detractor                     │
 │             Detractor follow-up expected: Deployment Sponsor · in Qualtrics → Responses                │
 │             Sample County Services              MDS   Closed 24 Sep · no response · silence isn't a verdict │
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Visual vocabulary (shared with V3):** `.trends-section` cards for group containers; `.trends-section-title` headers with 11px/600 uppercase eyebrows; `.status-pill` with `.status-yellow`/`.status-red` reserved for time-critical/all-bounced; neutral `.survey-pill` for MDS/PGL; `--color-primary` links with "→" on navigational links; `--color-text-muted` facets; tabular numerals on dates. Tokens only (`--space-*`, `--radius-*`, `--shadow-subtle`); no new colours, no bars/meters/charts, no banner. Reflow ≤ 1100px: filter chips wrap, the date column drops under the name, rows stay two-line.

## 13. Eight required states (same composition)

Only content, sort and which attention chips light up change. No region moves.

| # | State | Upcoming | In Flight | Recent | Lit chips |
|---|---|---|---|---|---|
| 1 | **Normal upcoming portfolio** | Next round, 2 issues then clean rows | Modest, nothing to chase | A few responded | Prepare |
| 2 | **Heavy upcoming month** | 14 in next round, ⚠ prepare-by ≤7d, issues first, `+k more`, Following + Later | Modest | Few | Prepare (⚠) |
| 3 | **Preparation issues** | Many Prepare rows + a Can't-forecast tail, each naming the missing thing + "in SFDC" | Quiet | Quiet | Prepare, Can't forecast |
| 4 | **Active in-flight** | Normal | Populated: awaiting/opened/responded, closes-in | Some responded | — |
| 5 | **Chase / bounce** | Normal | All-bounced (red) + Chase (⚠) first, then some-bounced, then normal | Some | Chase, Delivery problem |
| 6 | **Recently responded** | Normal | Winding down | Populated: responded with contact counts + follow-up facets; closed-no-response | Follow-up expected |
| 7 | **Cannot forecast** | Clean rows + prominent Can't-forecast tail (missing dates), neutral not alarm | Quiet | Quiet | Can't forecast |
| 8 | **Quiet / no immediate activity** | "No readiness issues found (dates and contacts present)" | "Nothing to chase" | Routine acknowledgements as a footer | — |

Every state is still a full, useful page; low volume (SLG-like) leans on the **named rows**, and empty groups carry an informative sentence, never a blank.

## 14. Future-data requirements

Marked where the ideal UX needs data DM does not reliably have today. Not silently designed as present.

| Area | Gap | Class | V1 treatment |
|---|---|---|---|
| Forecast accuracy / eligibility exclusions | DG-01/02/03 derivable but need DG-14 + `firstMtpDate` meaning confirmed | `DERIVABLE` (pending confirmation) | Label Upcoming a **forecast**; show `CANNOT_FORECAST` honestly; never claim certainty |
| Durable closed-without-response & bounce history | DG-08 beyond ~3-month InFlight window | **`FUTURE_DATA_REQUIRED`** (NEW_SOURCE) | Recent bounded by the window; method note states it |
| Follow-up status / owner / reason / outcome | DG-12 / DG-20 | **`FUTURE_DATA_REQUIRED`** (Qualtrics integration) | Expectation only; "~5 business days"; never overdue/completed |
| Exact survey-due denominator | DG-10 | `DERIVABLE` (approx) → exact needs Qualtrics | Horizon counts labelled *estimated* until validated |
| "Dates confirmed" (vs present) | DG-05 | `NEW_SOURCE` / NOT_NEEDED_V1 | "present" only |
| Pre-launch EM reassignment history | DG-09 | `NEW_SOURCE` | In-flight EM mismatch only |
| Prepare-by-anchored EM reminders | DG-06 | `DERIVABLE` (verify intent) | Not relied on in V1 |
| Partner-led MDS scope / Detractor ownership | DG-13 | `NEW_SOURCE` | Partner-led rows show no follow-up facet |

## 15. Proposed Surveys design rules (need Jeff's confirmation)

Analogous to V3-D rules; proposed defaults, labelled in the UI, changing no VoC rule.

| # | Rule | Default |
|---|---|---|
| S1 | **Recent window** | Current + previous round (≈ 60 days); follow-up facet only on responses ≤ 30 days (inherits V3-D5) |
| S2 | **Upcoming horizon** | Next + Following round shown; "Later (within 6-month horizon)" collapsed |
| S3 | **Within-group sort** | Attention rows before normal; among attention rows, time-critical (⚠ ≤ 7 days, all-bounced) first |
| S4 | **Time-critical** | Prepare/chase ≤ 7 days (inherits V3-D7); all-bounced always urgent regardless of days |
| S5 | **Quiet by default** | A row carries an attention marker only when a kind applies; normal rows carry none |

## 16. Documents

| Doc | Content |
|---|---|
| README.md (this) | The recommended Surveys experience: navigation decision, reading order, row, preparation / in-flight / recent / follow-up treatments, attention model, filters, drill-down, 1440×900 composition, eight states, future-data requirements, proposed rules |
| [composer-preview-spec.md](composer-preview-spec.md) | Narrow handoff for one isolated Surveys prototype: eight deterministic state pages, stable URLs, chrome limits, interactions, self-test, acceptance questions |

## 17. Verification stance

Design-only; no production, prototype, CLASP or deploy. Grounded in the product-approved reconciled architecture (commit `d31efef`, J1–J6) and the V3 visual vocabulary/tokens (production CoreUI CSS as extracted for the V3 prototype). All example values are **synthetic**, sized to real per-app volumes; fictional deployment names only. Nothing was queried from production.
