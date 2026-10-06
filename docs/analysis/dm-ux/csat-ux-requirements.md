# CSAT UX requirements inventory (tasks, not screens)

Basis: `docs/analysis/csat-subsystem/` (esp. `csat-ui-architecture.md`, `canonical-response-model.md`, `csat-ai-future.md`), current CSAT tab (`CoreUI_Markup.js` `_buildCsatTab_`), `CoreCsatResponses.js`. Responses read APIs listed in the architecture are **not yet implemented**; R4/R5 are future.

## Tasks by question

**Portfolio**
| Task | Needs | Data tier |
|------|-------|-----------|
| How satisfied overall? | Overall satisfaction mean, % favorable (4-5), n | T1 aggregate |
| MDS vs PGL trend | monthly series, never blended; side-by-side tiles | T1 |
| NPS | PGL NPS with n and low-n flag | T1 |
| Strongest/weakest Product Area | per-area means; counts labelled "responses touching area" (non-additive) | T1, suppress n<5 |
| Which deployments have concerning responses? | table of response scores + flags, link to deployment | T1 (scores), identity via deployment only |
| Emerging feedback themes | topic/sentiment counts and trend | T2 (derived from comments; aggregate counts may be T1 with suppression, decision needed) |

**Operational** (today's In-Flight/Batches/Notify)
| Task | Needs |
|------|-------|
| Who has been sent a survey? | In-Flight table, sent date, type, status |
| Opened / started / completed? | status chips, filters |
| What's upcoming? | month-grouped batches 3/6-month horizon |
| What needs attention? | bounced/failed/stale, notification error badge, upload errors |

**Deployment**
| Task | Needs | Tier |
|------|-------|------|
| Responses this deployment received | chronological timeline MDS→PGL | T1 |
| MDS vs PGL comparison | paired score chips | T1 |
| What did the customer say? | expandable comments | T2 |
| Scores | Overall/NPS/aspect chips | T1 |
| Topics/sentiment | chips with provenance badges | T2 |

**Future**: AI summary across feedback (labelled AI-generated, model, generated-at, T2 + `aiInsights`).

## Cross-cutting requirements
- Scores and comments are different objects; comments, topics and AI output require separate permission and **must be absent from the response**, not hidden by CSS/JS (CSAT architecture §5; today's code hides UI only and the upload endpoint has no server guard).
- Three provenance labels never merged: *Customer comment*, *Qualtrics analysis*, *AI-generated*.
- Never fabricate denominators (response rate only where `response_id` join is reliable).
- Honour existing gates (`ui.csat.{enabled,tracking,responses,feedback,aiInsights}`) and family reduction (EVI/PDX/HS have no CSAT data yet).
- Deployment timeline must be reusable in Responses drill-in and deployment detail.

## Security → UI structure
Tiers (T1 aggregates, T2 comments/per-response detail, T3 respondent identity not stored in V1):
- **Separate surfaces, not collapsed panels**: aggregate views (Overview/Responses) and the Feedback area should be distinct destinations (tab/sub-tab/section) so the server can omit the whole feature for an unauthorized role; an "expand to see comments" inside a T1 view needs a **second server call** (`getCsatResponseDetailForUI`) rather than a client reveal.
- **Per-sub-area gating** should be the navigation unit (Feedback sub-tab absent when `feedback.enabled` or role fails, like existing `roleVisibility`).
- **Natural boundaries**: list rows carry scores/flags only; row action "view comments" is a distinct permission-checked call; export controls hidden **and** server-denied; AI Insights is a labelled, separate slot.
- **Personalization (DD/VP/PM view)** filters must be server-applied for T2 (client filtering is not a boundary).
- **Role not identity**: UI shows respondent role, never name/email in V1.
- Suppression: cells with n<5 render "n<5", not zero or hidden silently, to avoid inference.
- READ_ONLY and `viewAs=READ_ONLY` see no CSAT (current default `roleVisibility`); any change is a product decision.
