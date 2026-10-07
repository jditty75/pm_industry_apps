# VoC (Voice of the Customer) — shared platform notes

User-facing product name: **VoC — Voice of the Customer**. Internal modules, sheet names, and configuration keys remain **CSAT** where migration risk exists (`CoreCsat*`, `CSAT_InFlight`, `CSAT_Responses`, `CSAT_SurveyEvents`).

## Cohort model

- **MDS cohort date**: distinct valid `Production_Move_Date_Target__c` per product function; one survey event per distinct target date.
- **PGL cohort date**: distinct valid `Production_Move_Date_Actual__c`; no PGL events from target dates alone.
- **Survey target date**: MDS = Deployment Start + ⅓(Target − Start); PGL = Actual + 2 calendar months.
- **Monthly batch**: assigned via `CoreSurveySchedule.resolve(yearMonth)` (Open / R1 / R2 / Close). Target date selects the batch window; batch month is not part of `survey_event_id`.

## `survey_event_id`

Deterministic opaque id: `hash(canonicalDeploymentId + surveyType + exact cohort date)`. Clustering (`goLiveEventClusterDays`) does not collapse durable identity.

## Qualtrics boundary

No Qualtrics or EDM export contract changes. Reconciliation uses in-flight and response evidence with link methods `INFERRED_BATCH`, `LEGACY_AMBIGUOUS`, `LEGACY_UNKNOWN`, and ledger `LEDGER`.

## Lifecycle

`UPCOMING` | `IN_FLIGHT` | `RESPONDED` | `OVERDUE` (batch `surveyOpen` passed without issuance evidence).

## Survey awareness

`awarenessConditions[]` only — no READY / ATTENTION / BLOCKED certification labels.

## Responses

`CSAT_Responses` remains **63** storage columns (`CoreCsatResponses.CSAT_RESPONSES_COLUMNS`). UI uses `CoreCsatVoc.buildResponseListItem` / `buildResponseDetailDto` read models without schema churn.

## Partner scope

Default UI scope follows `notify.ddDigest.partnerNames` (typically **Workday Professional Services**). **Include Partners** expands visible Upcoming rows, counts, and filters without changing `survey_event_id`.

## Notification deduplication

EM reminder sends use cohort-aware keys via `CoreCsatVoc.buildEmReminderDedupeKeys` (`survey_event_id` + stage when present). Legacy keys (`deploymentId|eventDate|surveyType|stage`) remain honored in `PropertiesService` sent-state to avoid duplicate sends after upgrade.

## Ledger (`CSAT_SurveyEvents`)

Lazy, additive persistence; rows freeze when issuance evidence exists. Unsent future events stay derived from Salesforce + schedule.

## Deployment Intelligence

VoC owns survey evidence; Deployment Intelligence may consume curated VoC evidence later — not implemented in the VoC platform pass.

## Local validation

- DepMngr unit tests: `libraries/DepMngr` → `npm test`
- Healthcare aggregate reconciliation (read-only xlsx): `libraries/DepMngr/test/tools/healthcare-voc-reconcile.py`
- DM UI preview VoC RPCs: `skills/gas-monorepo-engineer/scripts/preview_dm_fixtures.py` implements `getCsatTabDataForUI` / `getDistributionLogDataForUI` for localhost preview only.
