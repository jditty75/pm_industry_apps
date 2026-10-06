# CSAT navigation and Overview's job

## 1. Re-deriving the sections

The approved `Overview | Responses | Survey Operations` was derived from Monitor / Investigate / Operate. It assumed that **operating the survey process** belonged to CSAT programme owners, and that the main CSAT problem was interpreting historical results. The guidebook changes both assumptions:

- The **Engagement Manager** is the primary operator: preparing, chasing, acknowledging. The process is about each deployment's survey moving through a lifecycle, not about running batches.
- **Prepare** (pre-launch, irreversible) is the primary operational use case. Under Survey Operations it was a sub-tab ("Upcoming") two levels deep.
- Follow-up after a response is part of the same operational lifecycle, but V2 placed nothing about it anywhere (P9).

Options evaluated:

| Option | Assessment |
|---|---|
| Keep `Overview | Responses | Survey Operations` | "Operations" reads as admin and hides Prepare. Splits one EM journey (prepare → chase → acknowledge) from the response it ends in. **Superseded** |
| **`Overview | Surveys | Responses`** | **Recommended.** *Surveys* holds every deployment's MDS/PGL **as it moves through the lifecycle** (upcoming → in flight → responded / closed), including follow-up expectations. *Responses* holds the **customer evidence** and learning. This matches Jeff's objectives one-to-one: Prepare + Monitor → Surveys; Learn → Responses; Health → Overview (+ deployment history) |
| `Overview | Upcoming | In Flight | Responses` | Four sections. Upcoming and In Flight are adjacent states of the same object; separating them breaks the lifecycle and re-creates today's sub-tab sprawl |
| `Overview | Deployments | Responses` (CSAT by deployment) | Tempting given the deployment principle, but it would duplicate DM's Deployments tab and the future deployment-detail surface. The deployment is reached *through* every section, not as a section |
| Two sections (`Overview | Responses`, Surveys folded into Overview) | Overview would turn into a work queue and lose the executive message |

Section label "Surveys" follows the guidebook's usage ("which month your deployments are slated for a survey", "survey launches"). A **survey** is one deployment's MDS or PGL. An **invitation** is one contact's copy. This refines product-model vocabulary ([measurement-and-thresholds.md](measurement-and-thresholds.md)).

### Administration

Notification rules (EM reminders, DD digest), manual upload/import and import freshness are **set-up, not lifecycle**. They stay inside CSAT and become a secondary **Survey settings** area within Surveys, visible to ADMIN, rather than a section. They are a candidate for a future DM-wide settings affordance; whole-app review only.

## 2. Recommended structure

```
CSAT
├── Overview    What is the customer telling us about this portfolio, what is coming, and what needs someone?
├── Surveys     Every deployment's MDS / PGL through its lifecycle: upcoming · in flight · responded · closed
│                 └─ Survey settings (ADMIN): notification rules · import
└── Responses   Customer evidence and learning: verdicts, delivery ratings, journeys, comments (T2), themes

Deployment CSAT history — shared deployment-level record; opened from all three and from DM deployment detail.
```

| Section | Purpose | Primary users | Questions | Lifecycle stages | Source data | Actions (and where) | Drill-downs |
|---|---|---|---|---|---|---|---|
| **Overview** | Communicate CSAT health of the portfolio and point to what needs attention | All. Leadership reads Level 1; DS/DD and EM read Level 2 | PQ1–PQ6, PQ9 summary | All, summarised | Responses aggregates; lifecycle state counts; deployment context | None directly; links only | Surveys (pre-filtered to state), Responses (pre-filtered), deployment history |
| **Surveys** | Prepare and monitor each deployment's survey; show what each response requires | EM (own deployments), DS/DD (oversight), CSAT programme admin | PQ1, PQ2, PQ3, PQ9 in full | L1–L9 (`NOT_IN_SCOPE`… `CLOSED_NO_RESPONSE`, follow-up facets) | Batch engine (on programme rules), calendar, contacts, InFlight, Responses (alert class only) | Fix in SFDC; request in VoC Slack; act in Qualtrics. DM states what, where, by when | Deployment history; invitation detail (contacts, POWER_USER+) |
| **Responses** | Read and learn from what customers said | DS/DD, leadership, practice; EM for their customers | PQ4–PQ8, PQ10 | L7, L10 | `CSAT_Responses` + deployment context | Act in DM (Notable, Executive Watch, Health Plan) | Deployment history; response detail (T2) |

Per-app reduction (unchanged pattern): Responses disabled → Overview shows the operational horizon only, and Surveys is the working section; CSAT off → no tab; READ_ONLY → no CSAT.

**Overlap rule between Surveys and Responses:** a Detractor response appears in **Responses** as evidence and in **Surveys** as an action ("Detractor follow-up expected · in Qualtrics"). The two sections share the same fact, from the same derivation, with a different purpose. Neither section copies the other's content.

## 3. Overview's semantic job

> **"What are customers telling us about this portfolio, how much of the portfolio is that, what is coming up, and what needs someone now?"**

Overview balances three bodies of information. Each has a defined share of attention:

| Body | Questions | Contents (semantic) | Weight |
|---|---|---|---|
| **Customer outcomes** | What have customers told us? How much should we trust it? | Workday-led programme measure per survey (Top-2 Box, NPS at n≥10) with responses, deployments and estimated coverage; partner-led PGL reference | **Leads** (Level 1) |
| **Management attention** | Who told us something concerning? What requires follow-up or preparation now? | Deployments with Detractor responses (and declines); follow-up expected count (in Qualtrics); next round's preparation issues before the prepare-by date; surveys in flight needing chasing (all bounced, closing soon, no response yet) | **Second** (Level 2) |
| **Operational horizon** | What is coming? What is in motion? | Next round(s): count of deployments and date; in flight: responded / awaiting | **Context** (Level 1 one-line, Level 2 detail) |

What each role should learn from the **same** Overview:

| Role | Learns in seconds | Then |
|---|---|---|
| EM (scope "my deployments" where enabled) | "2 of my deployments launch on 4 Nov; prepare by 21 Oct; one lacks an Executive Sponsor. One MDS response awaits acknowledgement." | Opens Surveys pre-filtered |
| DS/DD | "One Detractor on a deployment I sponsor; follow-up expected. Next round: 9 deployments, 2 not ready." | Opens the deployment history; acts in Qualtrics |
| Industry leadership | "Workday-led PGL Top-2 Box 81% on 26 responses (21 of 27 due). 4 deployments raised concerns. Partner-led PGL reference 74%." | Opens Responses or the concerned deployments |

## 4. Executive vs operational hierarchy (progressive disclosure)

| Level | Purpose | Must be understandable | Contents |
|---|---|---|---|
| **LEVEL 1: Executive message** | The state in about 5 seconds | Without reading a table | (a) Workday-led customer satisfaction now, with its evidence base in the same statement. (b) How many customers raised concerns. (c) One line of horizon: "Next round 4 Nov · 9 deployments · 3 surveys in flight". At most three statements. Each is a sentence-level fact with n |
| **LEVEL 2: Management attention** | What requires preparation, follow-up or investigation | In under a minute | Named deployments only, grouped by **kind of attention**, never summed: **Customer concern** (Detractors, declines) · **Follow-up expected** (count by owner role, in Qualtrics) · **Prepare now** (next round, readiness issues, prepare-by date) · **Chase now** (in flight: all bounced, closing within 7 days without response) · **Evidence gaps** (closed without response; launch not seen; cannot forecast). Each item names its system of action |
| **LEVEL 3: Supporting evidence** | Why the message is what it is | On demand | Per-survey breakdown (MDS / PGL rows), band counts, direction (P5), delivery ratings (lowest/highest), MDS → PGL journey counts, partner-led reference detail, freshness, method notes. Then drill-down to Surveys, Responses or deployment history |

Disclosure rules:

1. Level 1 never contains a list. Level 2 never contains an aggregate without its deployments behind it. Level 3 never introduces a new kind of attention.
2. **Action states and analytical evidence are visually and semantically separate**: concern ≠ follow-up ≠ preparation ≠ evidence gap.
3. Nothing on Overview is an action control. Every item links to the place where its action happens, or to the DM section that explains it.
4. The Level 2 horizon covers **the next round only** by default (the irreversible deadline), with "+ following round" available. A six-month horizon belongs in Surveys.
5. Empty states are informative: "No customer concerns among 26 responses" plus "6 deployments due have not responded". Silence is never presented as satisfaction.
