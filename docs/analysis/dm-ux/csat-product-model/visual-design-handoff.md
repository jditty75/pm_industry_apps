# Next visual-design task — handoff (do not start until Jeff approves this product model)

> **Superseded 2026-10-06** by [../csat-reconciled-architecture/visual-design-handoff.md](../csat-reconciled-architecture/visual-design-handoff.md). Retained for history.

## Task

Design **one** CSAT → Overview, in current production DM visual language, that expresses the semantic definition in [navigation-model.md §5](navigation-model.md). One composition, iterated. Not three alternatives.

The CSAT sub-navigation it sits in is **Overview | Responses | Survey Operations** (subject to P10). Responses, Survey Operations and deployment CSAT history are represented only as link targets.

## Inputs (binding)

1. This folder, especially [information-hierarchy.md §2](information-hierarchy.md) (primary → detail) and §5 (what not to show).
2. Jeff's answers to P1–P10 in [README.md](README.md). Use the recommendations where a decision is still open, and mark each one used in the design notes.
3. Visual baseline: current production DM screenshots and the observations in [../csat-overview-design/README.md](../csat-overview-design/README.md) "What makes current production DM polished". Only the visual-language observations carry over. The A/B/C compositions do not.
4. Vocabulary: [metric-semantics.md §8](metric-semantics.md). UI labels must use these terms.

## Must express

| Semantic unit | Requirement |
|---|---|
| Satisfaction by survey stage **with** its evidence base | One unit, never separate equal tiles. MDS and PGL each show bands/counts (P1), n, deployments, and coverage. State the window and scope |
| Direction | Per stage, using the language of rule P5, including the "not enough responses" state |
| Satisfaction risks | Deployment, stage, triggering fact (R1/R3 primary, R2/R4 secondary), date, role. Links to deployment CSAT history. No comment text |
| Journey line | Workday-led stage comparison; paired-decline count when available |
| Weakest dimension pointer | At most two drivers, linking to Responses |
| NPS | Secondary; n≥10 or the low-n treatment |
| Evidence gaps / operation issues | Two distinct counts, each linking to Survey Operations pre-filtered |
| Freshness | Responses import time (and InFlight import time if shown) |

## Must not include

Everything in [information-hierarchy.md §5](information-hierarchy.md), plus: a hero-sized single number, monthly charts, Product Area visuals, comment text or sentiment summaries, AI placeholders, and any figure without its n.

## States to design

1. Typical — SLG-like volume: ~26 responses / 12 months, MDS n≈8, PGL n≈18 (most MDS figures fall under the direction threshold).
2. Larger — HC/HENP-like volume: ~75 responses, MDS n≈20, PGL n≈55.
3. Low coverage with high satisfaction.
4. No risks in window.
5. No responses in window (Survey Operations still active).
6. Below-threshold aggregates (n<5 by stage).
7. Stale data.

Fixture requirement: synthetic, **sized to real per-app volume** (above). Rich fixtures sized beyond real volumes hid the small-numbers problem in earlier prototypes. No production-derived strings.

## Acceptance questions for Jeff

1. Can I tell how satisfied customers are at MDS and PGL, and how much to trust it, in one look?
2. Is it obvious which deployments need me, and why?
3. Are risks, evidence gaps and survey operation issues clearly different things?
4. Does anything appear that I would not act on or need?
5. Does it feel like Deployment Manager?

## Out of scope for that task

Responses design, Survey Operations redesign, deployment CSAT history/drawer design, production implementation, APIs, branding experiments. Each follows only after **CSAT OVERVIEW VISUALLY APPROVED**.

## Implementation notes for later (not for the visual task)

- New server DTOs implied: coverage (needs deployment master + due rule), risk signals (R1–R6), direction with n and composition note. Reuse `getCsatResponsesOverviewForUI` from [csat-ui-architecture.md §8](../../csat-subsystem/csat-ui-architecture.md), extended accordingly.
- Validate the survey-due rule against real invitations before showing coverage.
- Retire today's `coveragePct` meaning (see [metric-semantics.md §7](metric-semantics.md)).
