# Delivery leadership: scope and comparison

## 1. Requirement

> Workday-led CSAT is the primary management lens. Partner-led CSAT provides important comparative and portfolio context.

UI copy and design rationale describe this only in delivery terms: Workday-led is the default management lens, and partner-led is comparison and portfolio context. No other justification appears anywhere in the product.

## 2. Data facts that constrain the design

From the analysed source (177 responses, 2025-11 → 2026-09; aggregates only):

| | Workday-led | Partner-led |
|---|---|---|
| MDS responses | 47 | **0** |
| PGL responses | 76 | 54 |
| Share of all responses | ~70% | ~30% |

Consequences:

- **Partner-led deployments are only observed at PGL.** A partner-led view therefore has no MDS row, no stage comparison and no journey.
- **A mixed-leadership MDS vs PGL comparison is not like-for-like.** In All scope, the MDS row is entirely Workday-led and the PGL row is a mix of both models.
- **PGL is the one stage where the two leadership models can be observed side by side.** Comparison therefore happens at PGL.
- **True MDS → PGL journeys exist only for Workday-led deployments.**
- The survey-due schedule may cover Workday-led deployments only (README V2). If so, partner-led coverage cannot be shown.

## 3. Scope control

**Pattern:** the existing DM segmented control (`.seg-control`), labelled **Delivery leadership**, placed first in the OV-0 scope bar.

`[ Workday-led ] [ Partner-led ] [ All deployments ]`. Default: **Workday-led**.

Why a segmented control rather than a dropdown: there are exactly three mutually exclusive options, the active one must be visible without opening anything, and DM already uses this control for CSAT horizon and survey-type toggles. It needs no training.

**The active scope is shown in four places**, so it can't be missed:
1. The filled segment in the scope bar.
2. The OV-1 title: "Customer Satisfaction · Workday-led deployments" / "· Partner-led deployments" / "· All deployments".
3. Every other region subtitle: "Workday-led · rolling 12 months".
4. A live-region announcement on change (accessibility).

**Switching never silently changes what a metric means.** Each scope has its own row structure and explicit notes (§4). Numbers that do not exist in a scope are replaced by a sentence saying why, never by a blank or a dash. The default is not persisted across sessions in V1: every visit starts on Workday-led, so the management lens is consistent.

## 4. Behaviour per scope

| Element | Workday-led (default) | Partner-led | All deployments |
|---|---|---|---|
| OV-1 title | "· Workday-led deployments" | "· Partner-led deployments" | "· All deployments" |
| Scope headline | Workday-led, both stages | Partner-led (= PGL only). Sub-label "PGL survey only" | All responses, with composition text "52 Workday-led · 23 partner-led responses" |
| MDS row | Normal | Replaced by one muted line: "MDS: partner-led deployments aren't surveyed at mid-deployment." | Normal, with tag `WORKDAY-LED ONLY` beside the stage label |
| PGL row | Workday-led PGL | Partner-led PGL | All PGL. Second line in the stage cell: "32 Workday-led · 23 partner-led" |
| Reference row | **Partner-led PGL** (REFERENCE) | **Workday-led PGL** (REFERENCE) | None, because both models are already inside the PGL row |
| Stage note | "MDS and PGL rows are different deployments…" | Not shown | "MDS is Workday-led only, so MDS vs PGL here is not a like-for-like comparison. Use Workday-led for stage context." |
| Direction | Per row, Workday-led responses | Per row, partner-led | Per row. **Composition note** if the partner-led share of the row changes by ≥10 points between halves: "Partner-led share of PGL responses rose from 35% to 48%: part of any change may reflect the mix." |
| Heard from | Workday-led due | Partner-led due, or "Due schedule not available for partner-led deployments" (V2) | Combined due if both exist; otherwise "Workday-led only: 25 of 29 due", stated in the cell |
| OV-2 risk | Workday-led deployments | Partner-led deployments | All, each row tagged "· Workday-led" / "· Partner-led" |
| OV-3 ratings | Workday-led | Partner-led (PGL items only) | All |
| OV-4 journey | Workday-led pairs | "Not applicable: partner-led deployments are not surveyed at MDS." | Workday-led pairs, subtitle "Workday-led only" |
| OV-5 ops | Scoped if InFlight carries leadership (V9), otherwise labelled "all deployments" | Same | All |

The scope headline in All scope is acceptable because it is clearly labelled and its composition is printed. It is the "complete portfolio picture" a user chooses on purpose, not a default.

## 5. Comparison treatment (recommendation)

**One reference row in the OV-1 stage table, at PGL only.** No side-by-side dashboards, no delta figure, no "gap" metric, no comparison chart.

Options considered:

| Option | Verdict |
|---|---|
| No comparison until explicitly requested | Rejected. Partner context is part of the requirement, and hiding it entirely makes the Workday-led figure harder to interpret |
| Subtle annotation text ("Partner-led PGL: 4.0") | Close second. Rejected because free text cannot carry the band distribution and n in the same columns, so the reader can't compare evidence fairly |
| **Reference row in the same table** | **Recommended.** Same columns, same scale, same suppression rules. Observed values sit directly under the primary row they relate to, so the eye compares what differs without the page saying anything about why. Muted styling and the `REFERENCE` tag keep it subordinate |
| Expandable comparison panel | Rejected. Adds a control and a layout change for one row of data |
| Side-by-side Workday / Partner columns | Rejected. Two competing dashboards; turns the screen into a leaderboard |

**Reference-row rules:**
- Columns shown: Satisfaction, Bands, Evidence. Heard from / Direction / NPS are merged into one muted cell: "Comparison context: observed values only." This keeps the row from reading as a second scorecard.
- Same n<5 suppression as any row. If the reference n<5: "Partner-led PGL: fewer than 5 responses in this window."
- No computed difference anywhere. No "▲0.2 vs partner-led". No ranking language ("better", "outperforms", "leads", "lags").
- Tooltip on the `REFERENCE` tag: "Observed satisfaction among partner-led PGL responses in the same window. Differences between delivery models can reflect deployment mix, scope and timing. They don't show cause."

**Experience/delivery-rating comparison:** not on Overview. A leadership × rating comparison needs 8–10 rows × 2 columns at small n. That is the "giant matrix" the brief rules out, and it invites causal reading. OV-3 offers "Compare by delivery leadership →" into the Responses rating profile, which is where the comparison is investigated with n and suppression per cell.

## 6. Safe and unsafe language

| Safe (allowed in UI copy) | Unsafe (never) |
|---|---|
| "Observed satisfaction", "Partner-led PGL: 4.0 (23 responses · 19 deployments)" | "Workday performs better because…" |
| "Lowest-rated among partner-led PGL responses: Prepared for go-live" | "Partner-led delivery causes lower readiness" |
| "Different deployments, scope and timing" | "Gap", "underperforming", "league", "ranking" |
| "MDS is Workday-led only" | Any comparison of MDS (Workday) vs PGL (mixed) presented as a stage effect |
