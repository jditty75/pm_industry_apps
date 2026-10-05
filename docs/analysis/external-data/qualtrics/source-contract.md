# Qualtrics source data contract (schema only)

Derived from `Qualtrics.py` `COLMAP` and validation rules. **No sample cell values.**

## Raw export

| Attribute | Expectation |
|-----------|-------------|
| Format | Excel `.xlsx` |
| Sheet | Index `0` (first sheet) |
| Header row | Row 1, exact Qualtrics column names as keys in `COLMAP` |
| Grain (source) | One row per distribution/contact event before Python dedup |

## Required source columns

All keys in the Python `COLMAP` must exist or transform **throws** (`Export schema changed. Missing columns: …`).

| Source column (Qualtrics) | Normalized name | Role |
|---------------------------|-----------------|------|
| `Survey_ID` | `survey_id` | Survey identifier |
| `Program_Type` | `survey_type` | MDS/PGL/etc. |
| `Sub Region` | `app` | **Route discriminator** (`US Healthcare`, `US SLED`) |
| `Account_ID` | `account_id` | Account key |
| `Account_Name` | `account_name` | Account label |
| `Customer_Segment_[Persistent]` | `customer_segment` | Segment |
| `First_name` / `Last_name` | `first_name`, `last_name` | Contact |
| `Email` | `contact_email` | Contact email |
| `Contact_ID` | `contact_id` | Contact key (dedup key) |
| `Deployment_Contact_Role` | `contact_role` | Role |
| `Deployment_ID` | `deployment_id` | SFDC deployment id |
| `Deployment_Name` | `deployment_name` | Deployment label |
| `Deployment_Stage` | `deployment_stage` | Stage |
| `Normalized Deployment Type` | `deployment_type` | Type |
| `Normalized Services Approach` | `services_approach` | Services approach |
| `Priming_Partner` | `priming_partner` | Partner |
| `Partner Name` | `partner_name` | Partner |
| `Engagement Manager Name` | `engagement_manager` | EM name |
| `Deployment_Engagement_Manager_Email` | `engagement_manager_email` | EM email |
| `Distribution Type` | `last_send_type` | Send type |
| `Distribution Channel` | `channel` | Channel |
| `expiration_date` | `survey_expires` | Expiry |
| `Email Sent` / `Email Opened` / `Email Bounced` / `Survey Bounced` / `Survey Started` / `Survey Finished` / `Survey Partial Recorded` | `f_*` flags | Boolean flags |
| `Email Sent Time (+00:00 GMT)` etc. | `ts_*` | UTC timestamps |
| `Recorded Date (+00:00 GMT)` | `ts_response_recorded` | Response time |
| `Response ID` / `Recipient ID` | `response_id`, `recipient_id` | Response identifiers |
| `Post_Go-Live_NPS`, `Overall Satisfaction`, `#PGL Satisfaction`, `#MDS Satisfaction` | score columns | Numeric when present; often empty in distribution export |

Columns **not** in `COLMAP` are dropped at transform time.

## Discriminator: SLG vs HENP (today)

- Field: normalized `app` from `Sub Region`.
- Allowed values: exactly `US Healthcare` and `US SLED` (set `VALID_APPS`).
- Any other value or blank → **hard error** in Python.
- **Not** filtered by deployment_id in Python; tenant filter happens in GAS ingest.

## Row retention and deduplication (Python)

| Rule | Behavior |
|------|----------|
| `ROW_GRAIN` | Default `latest_per_contact` |
| Dedup keys | `survey_id` + `contact_id` |
| Keep row | Latest by `ts_email_sent` (nulls sort to epoch) |
| Alternative | `per_send_event` (comment only; not default) |

## Null / blank semantics

- Boolean flags: null → false; truthy strings `1`, `true`, `yes`, `y`.
- Timestamps: parsed with `errors="coerce"` → empty string in CSV output when missing.
- `response_received`: derived from `response_id` not null → `Yes`/`No` in CSV.

## Qualtrics schema drift risk

- **High:** Any rename/removal of `COLMAP` source headers breaks Python (explicit guard).
- **Medium:** New `Sub Region` values require `VALID_APPS` and routing table updates.
- **Medium:** Timezone suffix in column names (e.g. `(+00:00 GMT)`) — renames break import.
- **Low:** Extra columns ignored until added to `COLMAP`.

## Transformed CSV contract (handoff to GAS)

Fixed column order `OUT_ORDER` (37 columns): includes `app`, contact fields, deployment fields, `tracking_status`, `response_received`, timestamps (ISO `…Z` strings), score columns.

GAS ingest reads a **subset** of these fields when writing `CSAT_InFlight` (see [ingestion-contract.md](./ingestion-contract.md)).
