# CSAT Overview V3: executive-first visual design (2026-10-06)

Status: **design specification + localhost visual prototype for executive review.** Production DepMngr UI/CSS/JS is unchanged. The V3 prototype lives under `skills/gas-monorepo-engineer/dm-ux-csat-overview-v3/` and builds to gitignored `.preview-out/CSAT_OVERVIEW_V3_*.html`.

This folder specifies **one** CSAT → Overview. It applies the product-approved [reconciled architecture](../csat-reconciled-architecture/README.md) (commit `d31efef`, J1–J6 approved) to a calmer, executive-first composition. It replaces the V2 visual design ([../csat-overview-v2/](../csat-overview-v2/README.md)), which is kept for history.

## The design in one paragraph

Overview opens with **one plain-language message**: a single Top-2 Box figure and up to three deterministic sentences. They say how satisfied Workday-led customers are, on what evidence, which way it is moving (when the data can show it), how many deployments raised concerns recently, and what the next survey round requires. Below the message are **two side-by-side regions**. The first names the **deployments whose customers raised concerns**. The second shows the **survey horizon**: the next round with its preparation deadline and readiness issues, then a short summary of what is in flight and what needs chasing. A quiet **learning row** at the bottom carries one fact each for delivery ratings, NPS, partner-led context and the evidence base. It also holds a collapsed *Breakdown and method* disclosure. The page has four regions, one large number, and no tables. The scope controls sit in one compact menu.

## Documents

| Doc | Content |
|---|---|
| [v2-visual-diagnosis.md](v2-visual-diagnosis.md) | What made V2 busy, measured on the rendered page. What to keep |
| [executive-message.md](executive-message.md) | Level 1: the message, the deterministic interpretation vocabulary and sentence rules, the five-second reading |
| [information-hierarchy.md](information-hierarchy.md) | Levels 1–3, the four regions, eye path, **1440×900 composition with layout diagram**, typography, surfaces, controls, T1/T2, accessibility |
| [attention-model.md](attention-model.md) | The five attention categories: definitions, which are visible immediately, and how each one is treated. Upcoming, In Flight, learning, partner-led context and evidence strength |
| [state-model.md](state-model.md) | Eight states on one composition, with synthetic values and how priority shifts between them |
| [drilldown-map.md](drilldown-map.md) | Every signal → its deployments → its destination. Everything that left the V2 Overview, and where it went |
| [composer-preview-spec.md](composer-preview-spec.md) | Narrow prototype handoff: one composition, eight static state pages, stable URLs, self-test, visual acceptance questions |
| [whole-app-lessons.md](whole-app-lessons.md) | What this Overview teaches about the rest of DM (recorded, not acted on) |

## Approved inputs applied

| Decision | Applied as |
|---|---|
| J1 Top-2 Box is the programme measure | The only large figure is Top-2 Box (% of responses scoring 4–5). Mean appears only in the disclosure |
| J2 Programme measure + deployment counts | The figure is response-weighted. Deployments appear as counts beside it and as named lists. No deployment-weighted measure |
| J3 Overview · Surveys · Responses | Sub-navigation, Overview selected |
| J4 Upcoming follows VoC rules | Designed on programme rules (one MDS, one PGL per deployment; eligibility exclusions). No implementation is authorised |
| J5 Follow-up expected (refined) | "Follow-up expected" appears only where the rules and data support it: Workday-led responses, recent only. Never "completed", "overdue" or "closed". Not shown for partner-led |
| J6 CLFU export is V1.1 | Not used. The design leaves no empty slot for it |

## New DM product rules proposed here (need Jeff's confirmation)

The guidebook sets **no satisfaction target, no direction method and no display windows**. The executive message needs all three, so they are DM product rules. They are proposed defaults, labelled in the UI method note, and they do not change any VoC rule.

| # | Rule | Proposed default | Where |
|---|---|---|---|
| V3-D1 | Satisfaction words | **strong** ≥ 80% · **mixed** 65–79% · **concerning** < 65% (on the displayed whole-number Top-2 Box) | [executive-message.md §3](executive-message.md) |
| V3-D2 | Evidence tiers | n < 5 no figure · 5–9 counts only, no word · ≥ 10 % plus word | §3 |
| V3-D3 | Direction | Last 6 months vs previous 6, ≥ 10 responses in each, ±10 Top-2 Box points (restates M9/V5) | §3 |
| V3-D4 | "Recent" customer concern | Detractor response received in the **last 90 days** | [attention-model.md](attention-model.md) |
| V3-D5 | "Follow-up expected" display window | Responses received in the **last 30 days**. Older ones show "status in Qualtrics" | attention-model.md |
| V3-D6 | Lowest delivery rating shown | n ≥ 10 for the item, and ≥ 10 points below the median of eligible items on that survey | attention-model.md |
| V3-D7 | Time-critical lead clause | Preparation closes within 7 days with readiness issues, or a round closes within 7 days with surveys to chase | executive-message.md §4 |

## Contradiction check

Nothing in this brief contradicts the guidebook as extracted in [guidebook-requirements.md](../csat-reconciled-architecture/guidebook-requirements.md). Three points are refinements, not contradictions:

1. "Next 30/60 days" is expressed as **survey rounds**. Rounds are monthly (first Wednesday, GB-08), so "next round" and "following round" are the 30- and 60-day horizon, and the round carries the real deadline (open − 14 days, GB-17/18).
2. The words "strong / mixed / concerning" rest on DM thresholds (V3-D1), because the guidebook defines none (guidebook-requirements §8).
3. A Top-2 Box of 85% means 15% of responses scored 3 or lower, and every one of those is a Detractor (GB-30). In a healthy portfolio, a 12-month concern list is therefore long. Overview separates **recent** concerns (V3-D4, named) from the 12-month count (evidence) so that "needs someone now" stays true.

## Verification stance

- **Guidebook:** not attached in this session. The guidebook content used is the rule extraction already in the repository (GB-01…GB-51, from the August 2026 PDF supplied on 2026-10-06).
- **V2 screenshot:** not attached either. The V2 diagnosis is based on the V2 prototype pages built locally (`.preview-out/CSAT_OVERVIEW_HEALTHY.html`, `…_RISK.html`), captured at 1440×900 with headless Chrome. These are the pages Jeff reviewed.
- **Visual baseline:** the DM design-system analysis ([../current-design-system.md](../current-design-system.md)) and the production CSS inlined into those pages.
- **Synthetic values:** all values are synthetic and sized to real per-app volumes. Nothing was queried from production.

## Visual review sequence (Jeff)

Review **one state at a time** in this order. Do not open the full index until Healthy has been judged.

1. **Healthy only** (`.\preview.ps1 CSAT_OVERVIEW_V3` opens this by default). Ask:
   - Can I understand the message in five seconds?
   - Does my eye go outcome → concerns → survey horizon → learning?
   - Is Upcoming prominent enough?
   - Does this feel materially calmer than V2?
   - Does it still feel like Deployment Manager?
2. Only if Healthy passes: **Customer concerns** → **Heavy upcoming** → **Chase** → **Weak evidence** → **SLG-like low volume** → **Partner-led** → **No immediate actions**.
3. Return to **Healthy** for a final pass.

Use the acceptance questions in [composer-preview-spec.md §8](composer-preview-spec.md). Approval phrase: **CSAT OVERVIEW V3 VISUALLY APPROVED**.
