# Transformation analysis — Python Qualtrics normalizer

## Location and dependencies

| Item | Detail |
|------|--------|
| Path | `C:\Users\jeffrey.ditty\Documents\PY\Qualtrics.py` (not in monorepo) |
| Comment name | `qualtrics_normalize.py` |
| Invocation | `python Qualtrics.py <raw_export.xlsx>` |
| Python deps | `pandas` (implicit: `openpyxl` or equivalent for `read_excel`) |
| Version | Not pinned in file; modern pandas datetime UTC behavior assumed |
| Outputs | `survey_normalized_healthcare.csv`, `survey_normalized_sled.csv` (cwd) |

## Transformation behavior (business logic)

1. **Load** first sheet of raw `.xlsx`.
2. **Schema guard** — all `COLMAP` source columns must exist; subset + rename.
3. **App validation** — every row’s `app` must be in `{US Healthcare, US SLED}`; no nulls.
4. **Standardize flags** — string/boolean → bool for seven `f_*` columns.
5. **Standardize timestamps** — UTC `datetime` for five `ts_*` columns.
6. **Scores** — coerce numeric; may be empty in distribution exports.
7. **Derive `tracking_status`** — priority: bounced → completed → partial → started → opened → sent → unknown (see Python `tracking_status()`).
8. **Derive `response_received`** — boolean from `response_id`.
9. **Derive `full_name`** — trim concat first + last.
10. **Dedup** — `latest_per_contact`: max `ts_email_sent` per (`survey_id`, `contact_id`).
11. **Serialize** — ISO Zulu strings for timestamps; `response_received` as Yes/No; column order `OUT_ORDER`.
12. **Split** — filter `app == US Healthcare` vs `US SLED` to separate CSV files.

No joins to Salesforce, no aggregations, no external lookups. **Deterministic** for a given input file and code version.

## SLG / HENP split logic

Split is **only** on normalized `app`:

- `US SLED` → `survey_normalized_sled.csv` → **SLG_DM** upload (operational).
- `US Healthcare` → `survey_normalized_healthcare.csv` → **HENP_DM** upload (operational; filename says “healthcare” but HC_DM is not in source yet).

## Validation and errors

- Missing columns → `ValueError` with column list.
- Bad `app` values → `ValueError`.
- No row-level error collection; fail-fast on schema/app checks.
- Console summary: total row counts per segment.

## Logging

- `print()` summary only; no structured log file in script.

## Local filesystem assumptions

- Input path from argv or default `raw_export.xlsx`.
- Outputs written to process working directory.
- No incremental/state files for Qualtrics (unlike Capacity `wow_last_manifest.json`).

## Classification: **SIMPLE_PORTABLE**

| Criterion | Assessment |
|-----------|------------|
| Algorithmic complexity | Low: column map, bool/date coercion, row-wise status, single dedup, filter split |
| Data volume | Distribution export; fits GAS memory if row counts are typical survey volumes (thousands, not millions) |
| Libraries | pandas used for Excel + vector ops; logic is ~80 lines of business rules |
| Correctness risk if ported | **Medium-low** — must match dedup sort, UTC formatting, and `tracking_status` precedence; GAS ingest re-normalizes `tracking_status` with slightly different label set (see ingestion doc) |
| Excel | **Main platform gap** — GAS has no native XLSX parse; use Drive import-to-Sheet, Advanced Drive API, or require Qualtrics CSV export |

### Reproducing in Apps Script / JavaScript

Feasible as a pure function `normalizeQualtricsRows(matrix)`:

- Parse CSV if Qualtrics export switched to CSV, **or** read converted Sheet grid after `Drive.Files.insert` + `convert: true`.
- Implement `toBool`, `trackingStatus`, dedup with sort key on `ts_email_sent`.
- Emit two row arrays or two temporary CSV blobs for routing.

**Does not justify hosted Python** for algorithmic reasons alone.

### When Python might still be preferred

- Mandate to keep `.xlsx` without Drive conversion and without changing Qualtrics export settings.
- Need offline regression tooling already built around pandas (oracle stays local).

## Apps Script vs Python — capability gap summary

| Capability | Python today | Apps Script |
|------------|--------------|-------------|
| Read `.xlsx` | pandas `read_excel` | Needs conversion or different export format |
| CSV output | pandas `to_csv` | `Utilities.parseCsv` / manual join |
| UTC dates | pandas | `Utilities.formatDate` / manual ISO Z |
| Dedup/sort | pandas | In-memory arrays |
