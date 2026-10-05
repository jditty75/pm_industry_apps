# Qualtrics transform specification (tracked contract)

Tracked behavioral contract for the Qualtrics normalizer. **Oracle:** `Qualtrics.py` at `C:\Users\jeffrey.ditty\Documents\PY\Qualtrics.py` (not in monorepo). **V1A implementation:** `solutions/External_Data_Manager/src/qualtrics/`.

## Automated source format (V1A+)

- Export **CSV** from Qualtrics (not XLSX) for Apps Script ingestion.
- Header row must match all keys in `QualtricsSchema.COLMAP` / Python `COLMAP`.

## Pipeline steps

1. **Parse** — CSV to row objects (header keys exactly as Qualtrics export).
2. **Schema guard** — all `COLMAP` source columns present or fail with `Export schema changed. Missing columns: …`.
3. **App guard** — `Sub Region` → `app` ∈ `{US Healthcare, US SLED}`; no blanks.
4. **Standardize** — booleans, UTC timestamps (naive `YYYY-MM-DD HH:MM:SS` treated as UTC), numeric scores.
5. **Derive** — `tracking_status`, `response_received`, `full_name`.
6. **Dedup** — `latest_per_contact`: latest `ts_email_sent` per (`survey_id`, `contact_id`).
7. **Serialize** — ISO `…Z` timestamps; `response_received` Yes/No; scores as pandas-like strings (`9` → `9.0`).
8. **Route (separate step)** — `QualtricsRoute.routeCanonicalDataset` uses `QualtricsRoutingConfig` (not the normalizer) to map normalized rows to `populationId` slices and destination `appId` lists.

**Normalizer boundary:** `buildCanonicalDataset` does not validate routable `app` values; `QualtricsPipeline.validateSource` runs routing validation. Extra Qualtrics columns not in `COLMAP` are ignored until added to the normalized contract.

## `tracking_status` precedence

1. Bounced/Undeliverable (`f_survey_bounced` or `f_email_bounced`)
2. Completed
3. Partial
4. Started
5. Opened
6. Sent
7. Unknown

## Equivalence testing

- Synthetic fixture: `solutions/External_Data_Manager/test/fixtures/synthetic-qualtrics.csv`
- Node tests: `npm test` in `solutions/External_Data_Manager`
- Python CSV oracle: `test/oracle/normalize_qualtrics_oracle.py` (pandas; mirrors `Qualtrics.py` normalize path)
