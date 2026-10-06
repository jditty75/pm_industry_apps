# Structured signal contract (documentation only)

No storage, Sauna prompt, or UI in the pilot deterministic phase. Planned shape for trajectory-enriched executive signals.

## Attention

`HIGH` | `WATCH` | `INFORMATIONAL` | `POSITIVE`

## Category

`HEALTH` | `SCHEDULE` | `GO-LIVE` | `LIFECYCLE` | `INTERVENTION` | `COMPOUND` | `POSITIVE`

## Fields

| Field | Role |
|-------|------|
| **Deployment** | Identity and scope for drill-down. |
| **Observation** | Deterministic / current condition (fact). |
| **Historical Evidence** | Pointers to trajectory and trace rows (fact). |
| **Interpretation** | LLM reading of evidence (not fact). |
| **Leadership Question** | What to investigate or validate. |
| **Confidence** | `HIGH` \| `MEDIUM` \| `LOW` |

Stable deployments should often produce **no** signal. Avoid category-filling.
