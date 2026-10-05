# Preview: synthetic CSAT Responses canonical fixtures (R3 prep)

Local-only DTO fixtures for future `*_DM` preview scenarios. No production comments or PII.

## Location

- EDM synthetic 288-column Responses CSV: `solutions/External_Data_Manager/test/fixtures/synthetic-qualtrics-responses.csv` (regenerate via `node test/fixtures/build-synthetic-responses-fixture.js`).
- Canonical row shape: `docs/analysis/csat-subsystem/csat-response-v1.schema.json` and `libraries/DepMngr/src/CoreCsatResponses.js` (`CSAT_RESPONSES_COLUMNS`).

## Suggested preview scenario IDs (not wired in R2)

| Scenario | Intent |
|----------|--------|
| `csat-responses-overview-aggregates` | Aggregate KPIs only (no comment text) |
| `csat-responses-detail-synthetic` | One PGL + one MDS row with synthetic comments |
| `csat-responses-deployment-timeline` | Multiple `response_ts_utc` on one `deployment_id` |

## Future read API boundaries (architecture)

- Aggregate metrics DTO: counts/means/NPS — all roles with CSAT access.
- Per-response list DTO: scores/metadata — no comment bodies by default.
- Comment detail DTO: gated separately from aggregates (decision D6).
