# Measurement methodology and thresholds (authoritative)

This table replaces every satisfaction threshold and band definition in earlier CSAT documents where they differ. Source of truth: the VoC guidebook ([guidebook-requirements.md](guidebook-requirements.md) GB-30, 40–46). Where DM needs a rule the guidebook does not provide (n-suppression, direction), the rule is marked **DM product rule**.

## 1. Authoritative table — current rules (survey responses from Feb 2026, and historical data as retroactively restated)

| # | Source | Metric | Scale | Programme interpretation | Operational consequence | DM usage |
|---|---|---|---|---|---|---|
| M1 | VoC (GB-41, 47, 57) | **Deployment Satisfaction (DSAT)** = `overall_satisfaction` ("How satisfied are you with your Workday deployment [so far]?") | 1–5 | **Top-2 Box**: % of responses scoring 4–5 | Feeds the CLFU alert class (M5) | **Primary outcome.** Headline expression: Top-2 Box with counts ("21 of 26 responses 4–5") — pending Jeff's decision J1 to reverse P1 |
| M2 | VoC (GB-46) | Display bands for any 1–5 item | 1–5 | 1–2 dissatisfied/disagree (red) · 3 neutral (yellow) · 4–5 satisfied/agree (green) | None by itself | Band counts beside any 1–5 aggregate. **Display only**; a 3 is "neutral" in a distribution |
| M3 | VoC (GB-41, 57) | **NPS** = `nps_score` ("…how likely are you to recommend Workday…") | 0–10, **PGL only** | Promoter 9–10 · Passive 7–8 · Detractor 0–6; NPS = %Promoters − %Detractors (−100…+100) | Feeds the CLFU alert class (M5) | Secondary PGL outcome. Shown with n. **DM product rule:** NPS figure only at n ≥ 10 |
| M4 | VoC (GB-41, 57 footnote) | All other 1–5 items (aspects, team, agreement) | 1–5 | Top-2 Box | None | **Delivery ratings**: Top-2 Box with n per item (mean allowed in detail) |
| M5 | VoC CLFU (GB-29–33, 47) | **Alert class** per response | derived | **Detractor**: DSAT ≤ 3 **or** NPS ≤ 6. **Passive or Promoter**: DSAT ≥ 4 **and** (MDS: no NPS; PGL: NPS ≥ 7) | MDS any → acknowledgement; Detractor (MDS/PGL) → Sponsor/DD alert, conversation, manual close; PGL Passive/Promoter → no action, auto-close | **Primary attention signal.** Every Detractor response is a deployment-level customer-attention item. Replaces prior R1 (≤2) and the R2 "NPS secondary" rule |
| M6 | VoC (GB-29) | Follow-up expectation | derived | MDS: 100% of responses; PGL: 100% of Detractors; within 5 business days **of ticket assignment** | Qualtrics ticket | DM shows *expected* follow-up and its expected owner role. Due date is approximate (assignment time is not in our data) |
| M7 | Qualtrics data (contract §3) | `pgl_satisfaction` / `mds_satisfaction` | 1–5 | Survey-specific copies; ≈95% equal to Overall | – | Detail only (unchanged) |
| M8 | DM product rule | Small-n suppression | – | – | – | Aggregate cells n < 5 → "n<5" (unchanged). Records (one deployment's responses, one Detractor) are never suppressed |
| M9 | DM product rule (P5) | Direction | – | VoC reports QoQ; no method given | – | ≥10 responses per compared window per stage (unchanged). Magnitude threshold must be restated in **Top-2 Box points** if J1 is accepted (proposed: ≥10 points). V5 is reopened |

### Terminology (guidebook wording kept)

| Use | Meaning | Do not use |
|---|---|---|
| **Detractor** / **Passive or Promoter** | The CLFU alert class of a response (M5) | "At risk", "unhappy", "low score" as a class name |
| **Satisfied (4–5) · Neutral (3) · Dissatisfied (1–2)** | Display bands of a distribution (M2) | Using "Detractor" for a DSAT 1–2 band |
| **Top-2 Box** | % 4–5 | "% favourable" (synonym; pick one: Top-2 Box) |
| **Deployment Satisfaction (DSAT)** | `overall_satisfaction` | "CSAT score" for the survey-specific fields |
| **Acknowledgement** | MDS thank-you / detractor email from Qualtrics | "Response" (collides with customer response) |
| **Follow-up** / **closing the loop** | The CLFU process | "Case management" |
| **Survey** | One deployment's MDS or PGL (the event). Plural = the deployment's survey events | – (refines product-model vocabulary, which reserved "survey" for the instrument) |
| **Invitation** | One survey sent to one contact | – |

Note the deliberate double meaning of a **3**: in a distribution it is *Neutral*; for follow-up it makes the response a *Detractor*. DM must show both truthfully. A neutral MDS response still triggers Detractor follow-up. The guidebook is internally consistent on this (p.18 display, p.26/47 CLFU).

## 2. Historical / pre-update rules (for interpreting older data only)

| Period | Rule | DM handling |
|---|---|---|
| Before Feb 2026 | Satisfaction items 0–10; Top-2 Box = 9–10; FY26 questions included Budget Management; aspect block required for PM only | `csat-response-v1` stores only current 1–5 fields; legacy rows (2025-11 → 2026-01) carry restated 1–5 values (contract §3). **Keep.** Show a one-time note on windows that include pre-Feb-2026 responses: "Earlier responses were restated by VoC to the 1–5 scale" |
| Before Feb 2026 CLFU | Detractor thresholds on 0–10 | Not used. DM re-derives the alert class from the restated 1–5 values with current rules |
| Before May 2025 | Medallia platform | Out of DM's data range (Responses start 2025-11) |

## 3. Question-mapping corrections (affect delivery ratings and stage comparison)

| Canonical field | MDS wording (GB p.37) | PGL wording (GB p.42) | Correction |
|---|---|---|---|
| `aspect_value` | "Scope as defined by Statement of Work" | "Value delivered considering the defined scope" | **Different questions.** Not comparable across stages. Label per stage; never pool MDS+PGL. Validate which Qualtrics field carries each |
| `agree_sales_expectations` | "Deployment so far is meeting the expectations set during the sales cycle" | "**Project team** set appropriate expectations for the effort required to deploy Workday" | The PGL item is about the **delivery team**, not sales. Prior "CONTEXT (sales)" classification holds for MDS only. For PGL it is a delivery rating. **Validate field mapping before use** (DG-15) |
| `agree_sales_transition` | "Transition from Sales to Deployment team was managed well" | – | MDS-only context (unchanged) |
| `agree_met_business_case` | – | ES only | Resolves prior UNRESOLVED: an **Executive-Sponsor-only PGL outcome**; n is structurally small. Show in detail and ES-filtered views only |
| `aspect_methodology` | Plan, Architect/Configure | Plan, Architect/Configure, Test, Deploy | Same label, different scope. Do not compare across stages |
| `team_*` | "Workday project team" | "Workday **and/or Partner** project team" | For partner-led PGL the team ratings may describe the partner team. Partner-led vs Workday-led team ratings are therefore ratings of different teams. Juxtapose only, never as "our team vs theirs" |
| `team_guidance` | "Workday recommended guidance" | Same (current version) | Sparse on PGL because of the older version (unchanged) |

## 4. Cohort comparability (MDS vs PGL, Workday-led vs partner-led)

Eligibility differences from the guidebook (GB-03/04) make cohorts differ beyond leadership:

| Difference | MDS | PGL | Consequence |
|---|---|---|---|
| Duration | > 16 weeks only | Any | PGL includes short deployments MDS never sees |
| Launch Now | Excluded | Included | PGL includes Launch Now; MDS cannot |
| Partner-primed | Not observed in data (GB-05, confirm) | Included | Partner-led only visible at PGL |
| Questions | Methodology Plan/A&C; scope-per-SOW; sales transition | Methodology incl. Test/Deploy; value delivered; prepared to go live; NPS | Only DSAT and the five team items are the same question at both stages |

**Like-for-like rules:**

- **Stage comparison (MDS vs PGL), portfolio level:** Workday-led only, **and** exclude PGL responses from deployments that would have been MDS-ineligible (≤16 weeks or Launch Now). Requires services approach and duration on each response (both present in `csat-response-v1`: `services_approach`, start/target dates). The mapping of the guidebook's "Launch Now" onto SFDC services-approach values (`Launch`, `Launch Express`, `Launch Flex`…) must be confirmed (DG-14). Until then the stage comparison carries the note "PGL includes deployment types not surveyed at MDS".
- **Leadership comparison (Workday-led vs partner-led):** PGL only, DSAT and NPS. Team ratings compared only with the "different teams" note. No delta figures, no ranking (unchanged from V2).
- **Journey (same deployment MDS → PGL):** inherently like-for-like on eligibility; still often different respondents (unchanged).
