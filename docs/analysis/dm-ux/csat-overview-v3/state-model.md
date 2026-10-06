# State model: eight states, one composition

Every state uses the **same four regions in the same positions**. Only three things change: the words chosen by the deterministic rules ([executive-message.md](executive-message.md)), the order of clauses in R1 C, and which items each region lists. No region appears, disappears or moves.

All values are **synthetic**, sized to real per-app volumes (HC/HENP ≈ 70 and SLG ≈ 25–30 responses a year, MDS Workday-led only on record). The window is rolling 12 months ending in the last full month. Survey rounds open on the first Wednesday of the month (4 Nov, 2 Dec 2026, 6 Jan 2027). Prepare-by is open − 14 days. Rounds close at open + 21 days.

Deployment names are fictional placeholders (`Example …`, `Sample …`, `Lakeside …`, `Northview …`) and must not resemble real customers.

## How priority shifts (summary)

| State | R1 anchor | R1 A word(s) | R1 C leads with | R2 | R3 emphasis | R4 note |
|---|---|---|---|---|---|---|
| 1 Healthy | 85% | strong and stable | concerns → horizon | 2 rows | Normal | All four facts |
| 2 Concerns | 73% | mixed and declining | concerns (with follow-up) → horizon | 4 rows + 1 more, decline tag | Normal | Lowest rating present |
| 3 Heavy upcoming | 85% | strong and stable | **preparation (time-critical)** → concerns | 1 row | ⚠ prepare-by in 2 days, 3 named + 2 more | – |
| 4 Chase | 85% | strong and stable | **chase (time-critical)** → concerns | 1 row | Chase line expanded; prepare-by passed | – |
| 5 Weak evidence | "8" responses | *Limited evidence* | concerns (none) → horizon | Empty state with gaps | Normal | "Too few" facts; gaps promoted into R1 B |
| 6 SLG-like | 86% | strong (no direction) | concerns → horizon | 1 row | Small counts, nothing to chase | Mostly "too few"; that is intentional |
| 7 Partner-led | 74% | mixed and stable | concerns (no follow-up clause) → horizon | 3 rows, no follow-up facet | Partner-led PGLs | Context flips to Workday-led |
| 8 No actions | 85% | strong and stable | concerns (none) → horizon (no issues) | Empty state | No issues, nothing to chase | All four facts |

---

## 1. Healthy · `CSAT_OVERVIEW_V3_HEALTHY` · HC shell · as of Fri 9 Oct 2026

**Primary visual-review page.**

| Region | Content |
|---|---|
| Scope menu | Workday-led · Rolling 12 months ▾ |
| R1 | **85%** rated 4 or 5 (Top-2 Box) · A "Workday-led customer satisfaction is strong and stable." · B "44 of 52 responses rated their deployment 4 or 5 · 40 deployments · Oct 2025 – Sep 2026" · C "**2 deployments** raised customer concerns in the last 90 days, 1 with follow-up expected. Next survey round 4 Nov: **9 deployments** to prepare by 21 Oct." |
| R2 | [Detractor·red] Example Health Network · PGL · "Satisfaction 2 · NPS 4 · 14 Sep · Follow-up expected: Deployment Sponsor · in Qualtrics" — [Detractor·yellow] Sample Regional Medical Center · MDS · "Satisfaction 3 · 5 Aug · Follow-up status in Qualtrics" · footer "Follow-up expected on 5 responses from the last 30 days (4 MDS acknowledgements, 1 Detractor) · tracked in Qualtrics" · "View all concerns in Responses →" |
| R3 | Next round · Wed 4 Nov · 9 deployments · 6 MDS · 3 PGL · Prepare by Wed 21 Oct · 12 days · 2 with readiness issues: Example Children's Hospital (MDS) "No Executive Sponsor contact"; Sample University Health (PGL) "No customer contact with email" · Following round · Wed 2 Dec · 7 deployments · "3 deployments can't be forecast: missing dates →" · In flight · October round · closes 28 Oct · "11 surveys · 3 responded · 8 without a response yet" · "1 to chase: all invitations bounced →" |
| R4 | Lowest delivery rating "Schedule management: 71% rated 4 or 5 (MDS, 21 responses)" · NPS "+41 · 31 responses" · Partner-led PGL for context "74% rated 4 or 5 · 23 responses" · Evidence "7 deployments with Detractor responses in 12 months · 4 surveys closed without a response →" |
| Disclosure | MDS 18 of 21 (86%), 17 deployments, stable (90% → 82%, 10 · 11), mean 4.4, bands 18 · 2 · 1 · PGL 26 of 31 (84%), 25 deployments, stable (79% → 88%, 14 · 17), mean 4.2, NPS +41 (31), bands 26 · 4 · 1 · Journey: 7 deployments answered both, held 5 · higher 1 · lower 1 · method notes · freshness |

Combined direction: 20 of 24 (83%) → 24 of 28 (86%), +3 points, so stable.

## 2. Customer concerns present · `CSAT_OVERVIEW_V3_CONCERNS` · HC · 9 Oct 2026

| Region | Content |
|---|---|
| R1 | **73%** · A "Workday-led customer satisfaction is mixed and declining." · B "36 of 49 responses rated their deployment 4 or 5 · 38 deployments · Oct 2025 – Sep 2026" · C "**5 deployments** raised customer concerns in the last 90 days, 3 with follow-up expected. Next survey round 4 Nov: **8 deployments** to prepare by 21 Oct." |
| R2 | [red] Example Health Network · PGL · tag "Declined from MDS 5" · "Satisfaction 2 · NPS 3 · 28 Sep · Follow-up expected: Deployment Sponsor · in Qualtrics" — [yellow] Lakeside Community Health · PGL · "Satisfaction 3 · NPS 6 · 21 Sep · Follow-up expected: Deployment Sponsor · in Qualtrics" — [red] Sample Regional Medical Center · MDS · "Satisfaction 2 · 16 Sep · +1 more response · Follow-up expected: Delivery Director · in Qualtrics" (no sponsor on record) — [yellow] Northview Specialty Clinics · PGL · "Satisfaction 4 · NPS 5 · 2 Aug · Follow-up status in Qualtrics" — "+1 more in the last 90 days →" · footer "Follow-up expected on 6 responses from the last 30 days (3 MDS acknowledgements, 3 Detractor)" |
| R3 | Next round 4 Nov · 8 deployments · 5 MDS · 3 PGL · prepare by 21 Oct · 12 days · 1 readiness issue (named) · Following 2 Dec · 6 · In flight: "10 surveys · 2 responded · 8 without a response yet" · "Nothing to chase." |
| R4 | Lowest "Communications: 58% rated 4 or 5 (PGL, 29 responses)" · NPS "+12 · 29 responses" · Partner-led "72% · 22 responses" · Evidence "11 deployments with Detractor responses in 12 months · 3 surveys closed without a response →" |

Direction: 19 of 23 (83%) → 17 of 26 (65%), −18 points. MDS 90% → 80% and PGL 77% → 56% move the same way, so the word is "declining". The word "mixed" comes from 73% alone. The five concerns do **not** influence it.

## 3. Heavy upcoming-survey month · `CSAT_OVERVIEW_V3_UPCOMING` · HC · Mon 19 Oct 2026

| Region | Content |
|---|---|
| R1 | **85%** · A "Workday-led customer satisfaction is strong and stable." · B "45 of 53 … · 41 deployments" · C "**Preparation closes in 2 days:** 14 deployments launch surveys on 4 Nov, **5 with readiness issues**. 1 deployment raised customer concerns in the last 90 days." |
| R2 | 1 row: [yellow] Example Health Network · PGL · "Satisfaction 3 · NPS 7 · 24 Jul · Follow-up status in Qualtrics" · footer "Follow-up expected on 4 responses from the last 30 days (4 MDS acknowledgements)" |
| R3 | Next round · Wed 4 Nov · 14 deployments · 9 MDS · 5 PGL · **⚠ Prepare by Wed 21 Oct · 2 days** (yellow-fg) · 5 with readiness issues: 3 named, then "+2 more →" · Following round · Wed 2 Dec · 11 deployments · "2 deployments can't be forecast: missing dates →" · In flight · October round · closes 28 Oct · "11 surveys · 6 responded · 5 without a response yet" · "Nothing to chase." |
| R4 | As Healthy (values vary slightly) |

## 4. Several surveys need chasing · `CSAT_OVERVIEW_V3_CHASE` · HC · Thu 22 Oct 2026

| Region | Content |
|---|---|
| R1 | **85%** · strong and stable · C "**9 open surveys** need chasing before the round closes on 28 Oct. 1 deployment raised customer concerns in the last 90 days." |
| R2 | 1 row (as state 3) |
| R3 | Next round · Wed 4 Nov · 10 deployments · "Prepare-by date passed · launches Wed 4 Nov (13 days)" (muted) · "2 still show readiness issues" (named) · Following round 2 Dec · 11 · In flight · October round · **closes 28 Oct · 6 days** · "13 surveys · 4 responded · 9 without a response yet" · "**9 to chase before 28 Oct:** 7 with no response · 2 all bounced →" |
| R4 | As Healthy |

Prepare-by has passed, so the preparation clause cannot be time-critical. The chase clause takes the lead (V3-D7).

## 5. Weak / insufficient evidence · `CSAT_OVERVIEW_V3_LOW_EVIDENCE` · HC · 9 Oct 2026

| Region | Content |
|---|---|
| R1 | Anchor **8** with caption "responses" (tier LIMITED, no %) · A "Limited Workday-led evidence so far: 8 responses from 7 deployments." · B "6 of 8 rated their deployment 4 or 5. Too few responses to describe satisfaction or its direction (10 needed). 11 surveys closed without a response in the last 3 months." · C "No customer concerns in the last 90 days. Next survey round 4 Nov: 6 deployments to prepare by 21 Oct." |
| R2 | Empty state: "No Detractor responses in the last 90 days among 3 responses received." · muted "2 deployments had Detractor responses earlier in the 12-month window →" · "11 surveys closed without a response: silence isn't a verdict →" |
| R3 | Next round 4 Nov · 6 deployments · 1 readiness issue · In flight "9 surveys · 1 responded · 8 without a response yet" · "Nothing to chase." |
| R4 | "Too few ratings to compare yet (10 per rating needed)" · "Not shown: fewer than 10 PGL responses (5)" · Partner-led "4 of 6 rated 4 or 5" (counts, n 5–9) · Evidence "2 deployments with Detractor responses in 12 months · 11 surveys closed without a response →" |

The page does not look broken. Every region carries a true sentence, and the evidence gap is now part of the message.

## 6. Low-volume SLG-like portfolio · `CSAT_OVERVIEW_V3_SLG` · SLG shell ("SLG Deployment Health Manager") · 9 Oct 2026

| Region | Content |
|---|---|
| R1 | **86%** · A "Workday-led customer satisfaction is strong." · B "12 of 14 responses rated their deployment 4 or 5 · 12 deployments · Oct 2025 – Sep 2026, too few responses to tell direction" · C "**1 deployment** raised customer concerns in the last 90 days, 1 with follow-up expected. Next survey round 4 Nov: 2 deployments, no readiness issues found." |
| R2 | 1 row: [yellow] Example County Services · PGL · "Satisfaction 3 · NPS 8 · 23 Sep · Follow-up expected: Deployment Sponsor · in Qualtrics" · footer "Follow-up expected on 2 responses from the last 30 days (1 MDS acknowledgement, 1 Detractor)" |
| R3 | Next round · Wed 4 Nov · 2 deployments · 1 MDS · 1 PGL · prepare by 21 Oct · 12 days · "No readiness issues found (dates and contacts present)." · Following 2 Dec · 1 deployment · In flight "3 surveys · 1 responded · 2 without a response yet" · "Nothing to chase." |
| R4 | "Too few ratings to compare yet" · "Not shown: fewer than 10 PGL responses (8)" · Partner-led "4 of 5 rated 4 or 5" · Evidence "2 deployments with Detractor responses in 12 months · 1 survey closed without a response →" |

At this volume the **named deployments in R2/R3** carry most of the value, and R4 says honestly what cannot yet be concluded. Halves are 6 · 8, so direction is suppressed.

## 7. Partner-led scope · `CSAT_OVERVIEW_V3_PARTNER` · HC · 9 Oct 2026

| Region | Content |
|---|---|
| Scope menu | Partner-led · Rolling 12 months ▾ |
| R1 | **74%** · A "Partner-led customer satisfaction is mixed and stable." · B "17 of 23 responses rated their deployment 4 or 5 · 19 deployments · Oct 2025 – Sep 2026 · No partner-led MDS responses on record" · C "**3 deployments** raised customer concerns in the last 90 days. Next survey round 4 Nov: 3 partner-led PGLs to prepare by 21 Oct." |
| R2 | 3 rows with **no follow-up facet**. Footer (replaces the follow-up line): "Programme follow-up expectations cover Workday-led deployments; partner-led follow-up ownership is being confirmed with VoC." |
| R3 | "Next round · Wed 4 Nov · 3 partner-led PGLs" · 1 readiness issue · In flight "4 surveys · 1 responded · 3 without a response yet" · "Nothing to chase." |
| R4 | Lowest "Schedule management: 57% rated 4 or 5 (PGL, 23) · may rate the partner team" · NPS "+22 · 23 responses" · **"Workday-led PGL, for context: 84% · 31 responses"** · Evidence "6 deployments with Detractor responses in 12 months · 2 surveys closed without a response →" |

Direction: 7 of 10 (70%) → 10 of 13 (77%), +7, so stable. No deltas, no "vs".

## 8. No immediate actions · `CSAT_OVERVIEW_V3_CLEAR` · HC · Thu 12 Nov 2026 (window Nov 2025 – Oct 2026)

| Region | Content |
|---|---|
| R1 | **85%** · strong and stable · B "46 of 54 … · 41 deployments · Nov 2025 – Oct 2026" · C "No customer concerns in the last 90 days. Next survey round 2 Dec: 6 deployments, no readiness issues found." |
| R2 | Empty state: "No Detractor responses in the last 90 days among 13 responses received." · muted "6 deployments had Detractor responses earlier in the 12-month window →" · footer "Follow-up expected on 3 responses from the last 30 days (3 MDS acknowledgements) · tracked in Qualtrics" |
| R3 | Next round · Wed 2 Dec · 6 deployments · 4 MDS · 2 PGL · prepare by Wed 18 Nov · 6 days · "No readiness issues found (dates and contacts present)." (no ⚠: it appears only with issues) · Following · Wed 6 Jan 2027 · 5 deployments · In flight · November round · closes 25 Nov · "9 surveys · 5 responded · 4 without a response yet" · "Nothing to chase." |
| R4 | All four facts |

"No immediate actions" is still a full page. Routine acknowledgements stay visible as a footer and are not promoted.

---

## Behaviour rules for other conditions (no extra pages)

| Condition | Behaviour |
|---|---|
| All deployments scope | A "Customer satisfaction across all deployments…"; B adds "41 Workday-led · 23 partner-led responses"; R2 rows tagged by leadership; follow-up facet on Workday-led rows only; R4 context fact shows the composition |
| "My deployments" (personalization) | Scope menu prefix "My deployments". Tiers apply as usual, so a 2-deployment EM scope usually lands in INSUFFICIENT/LIMITED and R2/R3 carry the page |
| Responses import disabled for the app | R1 anchor and A/B are replaced by "Customer responses aren't enabled for this app." C keeps the horizon clause. R2 shows "Responses not enabled". R3 is unchanged. R4 shows only Evidence (closed without response) |
| Stale responses import (> 14 days) | R1 B appends "⚠ Responses last imported {k} days ago." |
| No surveys forecast | R3 next-round block: "No surveys forecast for the next two rounds." |
| Window includes pre-Feb-2026 | Method note on the 1–5 restatement (disclosure only) |
