# State model — one composition, seven states

All seven states use the same layout ([overview-information-design.md §5](overview-information-design.md)). Only values, sentences and the reference-row/MDS-row variants change. No region appears or disappears between states. A region that has nothing to say shows its sentence state instead.

## Synthetic portfolio basis

Values are synthetic and sized to real per-app volume. They contain no production names, comments or IDs. Deployment names are obviously fictional.

| Portfolio | Window responses | Workday-led MDS | Workday-led PGL | Partner-led PGL |
|---|---|---|---|---|
| **HC-like** (states 1–6; HENP-like volume is equivalent) | 75 | 20 responses / 17 deployments | 32 / 25 | 23 / 19 |
| **SLG-like** (state 7) | 25 | 4 / 4 | 12 / 10 | 9 / 8 |

Window: rolling 12 months, Oct 2025 – Sep 2026. Direction halves: Oct 2025 – Mar 2026 vs Apr – Sep 2026. Responses imported 5 Oct 2026 07:12 (fresh) unless stated.

Bands are written Satisfied · Neutral · Dissatisfied (response counts).

---

## State 1 — Workday-led · healthy · adequate evidence (`CSAT_OVERVIEW_HEALTHY`)

| Region | Content |
|---|---|
| OV-0 | Workday-led active · Rolling 12 months · fresh |
| OV-1 headline | **4.3** / 5 · 52 responses · 40 deployments · ▬ Stable · 4.2 → 4.3 (24 · 28 responses) |
| MDS | 4.4 · 17·2·1 · 20 responses · 17 deployments · 17 of 20 due · ▬ Stable 4.3 → 4.4 (10 · 10) · Not asked |
| PGL | 4.2 · 27·4·1 · 32 · 25 · 25 of 29 due · ▬ Stable 4.2 → 4.2 (15 · 17) · +41 (n 31) |
| Partner-led PGL (reference) | 4.0 · 17·4·2 · 23 · 19 · *Comparison context: observed values only* |
| Qualifier | ⓘ Based on most deployments due for a survey. 7 due surveys have no response yet. · View 7 evidence gaps → |
| OV-2 | **2** deployments with a low verdict · **1** early warning. Rows: [Dissatisfied] Example Health Network · PGL · Overall Satisfaction 2 of 5 · 14 Aug 2026 — [Dissatisfied] Sample Regional Medical Center · MDS · Overall Satisfaction 2 of 5 · 2 Sep 2026 — [Low rating] Example Children's Hospital · MDS · Communications rated 1 · Overall 4 · 3 Jul 2026 |
| OV-3 | Lowest: Schedule management 3.8 (n 30) · Communications 4.0 (n 30) · Highest: Technical competence 4.6 (n 50) |
| OV-4 | 7 deployments: Held 5 · Higher 1 · Lower 1. (The "Lower" pair went 5 → 4. It is still satisfied, so it is not a "Declined" risk) |
| OV-5 | ⚠ 2 bounced invitations · ⚠ 3 invitations expire within 7 days · Invitations imported 5 Oct 2026 |

**Reads as:** reliable good news, two named verdicts to follow up.

## State 2 — Workday-led · concerning satisfaction (`CSAT_OVERVIEW_RISK`)

| Region | Content |
|---|---|
| OV-1 headline | **3.6** / 5 · 52 · 40 · ▬ Stable · 3.7 → 3.6 (24 · 28) |
| MDS | 3.9 · 13·4·3 · 20 · 17 · 18 of 20 due · ▬ Stable 4.0 → 3.9 (10 · 10) · Not asked |
| PGL | 3.4 · 17·7·8 · 32 · 25 · 26 of 29 due · ▬ Stable 3.5 → 3.4 (15 · 17) · −6 (n 31) |
| Partner-led PGL (reference) | 3.9 · 16·4·3 · 23 · 19 |
| Qualifier | ⓘ Based on most deployments due for a survey. 5 due surveys have no response yet. Second line (weighting note): "Each deployment counts once. Counting every response gives 3.4: 3 deployments with several respondents rated lower." |
| OV-2 | **9** deployments with a low verdict · **2** early warnings. 5 rows shown (4 × Dissatisfied, 1 × Declined "MDS 4 → PGL 3 · 11 Sep 2026"), ordered by recency within the low-verdict group · View all 11 in Responses → |
| OV-3 | Lowest: Prepared for go-live (PGL) 2.9 (n 30) · Schedule management 3.1 (n 30) · Highest: Technical competence 4.1 (n 50) |
| OV-4 | 7 deployments: Held 3 · Higher 1 · Lower 3 |
| OV-5 | ⚠ 1 bounced invitation · Invitations imported 5 Oct 2026 |

**Reads as:** reliable bad news. Coverage is good, so the low score is representative. The stable direction shows this is not a sudden drop. The risk list is long but capped. The weighting note appears because multi-respondent deployments diverge.

## State 3 — Workday-led · inadequate evidence (`CSAT_OVERVIEW_LOW_EVIDENCE`)

| Region | Content |
|---|---|
| OV-1 headline | **4.5** / 5 · 23 responses · 20 deployments · Too few responses to determine direction (9 · 14; 10 needed in each) |
| MDS | 4.6 · 8·1·0 · 9 · 8 · **8 of 21 due** · Too few (4 · 5) · Not asked |
| PGL | 4.4 · 12·2·0 · 14 · 12 · **12 of 30 due** · Too few (5 · 9) · +50 (n 12) |
| Partner-led PGL (reference) | 4.0 · 15·5·2 · 22 · 18 |
| Qualifier | ⚠ **Read with caution:** we have heard from fewer than half of the deployments due at MDS (8 of 21) and PGL (12 of 30). 31 due surveys have no response yet. · View 31 evidence gaps → |
| OV-2 | Empty state: "No Customer Satisfaction risk among the 23 responses received in this window." / "Deployments not yet heard from aren't included. See evidence gaps." |
| OV-3 | Lowest: Schedule management 4.0 (n 12) · Methodology 4.2 (n 12) · Highest: Responsiveness 4.8 (n 21) |
| OV-4 | 3 deployments have both surveys: too few to summarise (5 needed). View their histories → |
| OV-5 | ⚠ 6 bounced invitations · ⚠ 9 invitations expire within 7 days · ⚠ 1 notification rule invalid · Invitations imported 5 Oct 2026 |

**Reads as:** good news from a minority. The highest score of the seven states carries the weakest evidence, and the page says so in words next to the score. Survey Operations issues sit in their own strip. The page does not claim they caused the gaps.

## State 4 — Workday-led · meaningful decline (`CSAT_OVERVIEW_DECLINE`)

| Region | Content |
|---|---|
| OV-1 headline | **3.9** / 5 · 52 · 40 · ▼ **Declining** · 4.2 → 3.7 (24 · 28) |
| MDS | 4.3 · 16·3·1 · 20 · 17 · 17 of 20 due · ▬ Stable 4.3 → 4.3 (10 · 10) · Not asked |
| PGL | 3.7 · 21·5·6 · 32 · 25 · 25 of 29 due · ▼ **Declining** 4.2 → 3.3 (15 · 17) · +9 (n 31) |
| Partner-led PGL (reference) | 4.0 · 17·4·2 · 23 · 19 |
| Qualifier | ⓘ Based on most deployments due for a survey. 7 due surveys have no response yet. |
| OV-2 | **6** deployments with a low verdict · **1** early warning. Rows: 4 × Dissatisfied (PGL, Jul–Sep 2026), 1 × Declined "MDS 4 → PGL 2 · 22 Aug 2026" · View all 7 in Responses → |
| OV-3 | Lowest: Prepared for go-live (PGL) 3.2 (n 31) · Schedule management 3.5 (n 30) · Highest: Technical competence 4.4 (n 50) |
| OV-4 | 7 deployments: Held 3 · Higher 0 · Lower 4 |
| OV-5 | ⚠ 2 bounced invitations · Invitations imported 5 Oct 2026 |

**Reads as:** the decline is at PGL, not MDS, with adequate evidence in both halves. The partner-led reference is unchanged; the page shows that without comment. The lowest delivery rating is "Prepared for go-live", described only as "lowest-rated". The declines are named in the risk list. "Declining" is the only red direction word in the seven states.

## State 5 — Partner-led scope (`CSAT_OVERVIEW_PARTNER`)

| Region | Content |
|---|---|
| OV-1 title | Customer Satisfaction · **Partner-led deployments** |
| OV-1 headline | **4.0** / 5 · PGL survey only · 23 responses · 19 deployments · ▬ Stable 4.1 → 4.0 (11 · 12) |
| MDS | Muted single line: "MDS: partner-led deployments aren't surveyed at mid-deployment." |
| PGL | 4.0 · 17·4·2 · 23 · 19 · 19 of 26 due · ▬ Stable 4.1 → 4.0 (11 · 12) · +22 (n 21) |
| Workday-led PGL (reference) | 4.2 · 27·4·1 · 32 · 25 |
| Stage note | Hidden |
| Qualifier | ⓘ Based on most deployments due for a survey. 7 due surveys have no response yet. *(If V2 fails: "Coverage can't be shown for partner-led deployments: no survey-due schedule." The Heard-from cell shows "Not available")* |
| OV-2 | **2** deployments with a low verdict · no early warnings. [Dissatisfied] Synthetic Community Hospital · PGL · Overall 1 of 5 · 28 Aug 2026 — [Dissatisfied] Demo University Health · PGL · Overall 2 of 5 · 10 May 2026 |
| OV-3 | Lowest: Prepared for go-live (PGL) 3.5 (n 22) · Communications 3.7 (n 13) · Highest: Collaboration 4.3 (n 22) |
| OV-4 | Not applicable: partner-led deployments are not surveyed at MDS. |
| OV-5 | ⚠ 1 bounced invitation · Invitations imported 5 Oct 2026 |

**Reads as:** a full, honest partner-led view, structurally different because the data is.

## State 6 — All deployments scope (`CSAT_OVERVIEW_ALL`)

| Region | Content |
|---|---|
| OV-1 title | Customer Satisfaction · **All deployments** |
| OV-1 headline | **4.2** / 5 · 75 responses · 59 deployments · "52 Workday-led · 23 partner-led responses" · ▬ Stable 4.2 → 4.2 (35 · 40) |
| MDS `WORKDAY-LED ONLY` | 4.4 · 17·2·1 · 20 · 17 · 17 of 20 due · ▬ Stable 4.3 → 4.4 (10 · 10) · Not asked |
| PGL | 4.1 · 44·8·3 · 55 · 44 · stage cell line 2 "32 Workday-led · 23 partner-led" · 44 of 55 due · ▬ Stable 4.1 → 4.1 (26 · 29) · +33 (n 52) |
| Composition note (under PGL) | "Partner-led share of PGL responses rose from 35% to 48%: part of any change may reflect the mix." |
| Reference row | None |
| Stage note | "MDS is Workday-led only, so MDS vs PGL here is not a like-for-like comparison. Use Workday-led for stage context." |
| Qualifier | ⓘ Based on most deployments due for a survey. 14 due surveys have no response yet. |
| OV-2 | **4** deployments with a low verdict · **1** early warning. Each row's fact line ends "· Workday-led" or "· Partner-led" |
| OV-3 | Lowest: Prepared for go-live (PGL) 3.8 (n 53) · Schedule management 3.9 (n 43) · Highest: Technical competence 4.5 (n 73) |
| OV-4 | Subtitle "Workday-led only: partner-led deployments have no MDS survey" · 7 deployments: Held 5 · Higher 1 · Lower 1 |
| OV-5 | ⚠ 3 bounced invitations · ⚠ 4 invitations expire within 7 days · Invitations imported 5 Oct 2026 |

**Reads as:** the complete picture, chosen on purpose, with its mix stated and the non-like-for-like stage reading called out.

## State 7 — SLG-like low volume, direction undeterminable (`CSAT_OVERVIEW_LOW_VOLUME`)

SLG-like shell.

| Region | Content |
|---|---|
| OV-1 headline | **4.1** / 5 · 16 responses · 13 deployments · Too few responses to determine direction (7 · 9; 10 needed in each) |
| MDS | **n<5** · "4 responses: too few to summarise" (no bar) · 4 responses · 4 deployments · **4 of 9 due** · Too few (1 · 3) · Not asked |
| PGL | 4.0 · 9·2·1 · 12 · 10 · 10 of 13 due · Too few (6 · 6) · **n<10** (9 NPS responses) |
| Partner-led PGL (reference) | 3.8 · 6·2·1 · 9 · 8 |
| Qualifier | ⚠ **Read with caution:** we have heard from fewer than half of the deployments due at MDS (4 of 9). 8 due surveys have no response yet. · View 8 evidence gaps → |
| OV-2 | **1** deployment with a low verdict · no early warnings. [Dissatisfied] Example County · PGL · Overall Satisfaction 2 of 5 · 19 Jun 2026 |
| OV-3 | Lowest: Schedule management 3.6 (n 8) · Highest: Responsiveness 4.5 (n 16). Only one "lowest" qualifies under the ≥0.3 rule |
| OV-4 | 1 deployment has both surveys: too few to summarise (5 needed). View its history → |
| OV-5 | ✓ No survey operation issues · Invitations imported 5 Oct 2026 |

**Reads as:** small, honest and still useful. One score with its evidence, one named customer to call, one rating to look at, and a clear statement of what cannot be concluded. Suppressed cells and "too few" sentences are normal muted text in the layout, not error styling.

Note: when a stage row is suppressed but the scope headline is shown, a T1 user could approximately back out the suppressed stage mean from the headline and the other stage. At internal-DM T1 this is accepted. It is logged for the R3 re-identification/API work, not solved visually.

---

## Behaviour rules covering the product model's older edge states

| Condition | Behaviour on this composition |
|---|---|
| No responses in window | OV-1 headline "No responses in this window"; rows show 0 responses and their Heard-from counts; qualifier "<50%" variant; OV-2/OV-3/OV-4 use their empty sentences |
| Stale Responses import | OV-0 freshness pill turns stale; OV-5 adds "⚠ Responses not imported for 18 days"; numbers still render |
| No risks | OV-2 empty sentence (state 3) |
| Below-threshold aggregates | `n<5` / `n<10` treatments (state 7) |
| Responses not enabled for the app | Overview absent; CSAT opens on Survey Operations ([navigation-model.md §9](../csat-product-model/navigation-model.md)) |
