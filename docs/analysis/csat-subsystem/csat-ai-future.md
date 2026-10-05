# Future AI Layer — `CSAT_AI_Insights` (design only; nothing built or called)

## Rules
1. `CSAT_Responses` (customer + Qualtrics-derived) is source of truth; AI output never writes into it.
2. Three provenance classes, always separate columns/labels/sheets: `CUSTOMER_SOURCE`, `QUALTRICS_DERIVED`, `AI_DERIVED`.
3. Insights are append-only; regeneration supersedes, never overwrites.
4. Sending comments to any model is a data-egress decision (decision D6): use only an approved Workday-internal model endpoint; never a public service.

## Single store, multiple scopes
One sheet `CSAT_AI_Insights` per workbook (portfolio insights are per-app because each workbook holds only its own responses).

| Field | Notes |
|---|---|
| insight_id (PK) | `INS_<ts>_<rand>` |
| scope_type | `DEPLOYMENT`, `ACCOUNT`, `PRODUCT_AREA`, `PORTFOLIO`, `PERIOD` |
| scope_id | deployment_id / account_id / area group / `ALL` |
| period_start, period_end | ISO dates (nullable for DEPLOYMENT lifetime) |
| filter_spec_json | exact filter used (survey type, areas, …) |
| source_response_count | int |
| source_fingerprint | sha256 over sorted `response_id:row_hash` of inputs → reproducibility + staleness detection (a changed/new response makes the fingerprint differ → insight flagged stale) |
| source_response_ids_json | only for scopes ≤ ~500 ids; larger scopes rely on filter_spec + fingerprint |
| generated_at, generated_by | timestamp, `agent` or user |
| model_id, model_version, prompt_template_id, prompt_template_version | reproducibility |
| summary_text | AI-written |
| positive_themes_json, risk_themes_json | arrays of `{theme, evidence_count}` |
| recommended_attention | short text |
| confidence_note | model-stated limits (n too low, etc.) |
| status | `ACTIVE`, `SUPERSEDED`, `REJECTED` |
| supersedes_insight_id / superseded_by | chain |
| review_state, reviewed_by, reviewed_at | optional human review |
| provenance | constant `AI_DERIVED` |
| contract_version | `csat-ai-insight-v1` |

Latest ACTIVE per `(scope_type, scope_id, period, filter hash)` is what the UI shows; staleness = stored fingerprint ≠ current fingerprint. A single table supports deployment, portfolio and time-period insights because scope and period are first-class columns.

## Execution model (future)
Scheduled or on-demand agent (GAS-triggered or external) reads T2-gated comment data, writes via a DepMngr server function `appendCsatAiInsight` (validates scope, size ≤ 45k chars/cell, provenance constant, gate `csat.aiInsights.enabled`). Output is displayed with an "AI-generated" badge, generated-at and model. No AI call is made in R1–R5.
