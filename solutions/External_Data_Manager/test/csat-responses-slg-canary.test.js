const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEdmGlobalsInFileOrder } = require('./loadGasSrc');

const g = loadEdmGlobalsInFileOrder([
  'EdmCsatResponsesCanaryPhases.js'
]);
const P = g.EdmCsatResponsesCanaryPhases;

function fullDryRunResult() {
  return {
    ok: true,
    dryRun: true,
    destinationResults: [
      { appId: 'HC_DM', inputRows: 77 },
      { appId: 'SLG_DM', inputRows: 28 },
      { appId: 'HENP_DM', inputRows: 72 }
    ],
    outcome: {
      job: { sourceRowCount: 177, status: 'READY_FOR_INGESTION' },
      result: { ok: true }
    }
  };
}

test('dry-run phase accepts full processor result', () => {
  const step = P.evaluateDryRunPhase(fullDryRunResult());
  assert.equal(step.ok, true);
  assert.equal(step.message, 'dry_run_counts_ok');
});

test('dry-run phase fails loud when processor omits outcome (legacy line ~1049)', () => {
  const noOutcome = { ok: true, message: 'No CSV in Responses Inbox' };
  assert.throws(() => P.legacyUnsafeDryRunCountCheck(noOutcome));
  const step = P.evaluateDryRunPhase(noOutcome);
  assert.equal(step.ok, false);
  assert.match(step.message, /processor_missing_job_outcome/);
});

test('dry-run phase handles processor ok:false with job', () => {
  const dup = {
    ok: false,
    outcome: {
      job: { sourceRowCount: 177, status: 'FAILED', errorCategory: 'DUPLICATE_SUCCESS_CHECKSUM' },
      result: { ok: false }
    },
    destinationResults: []
  };
  const step = P.evaluateDryRunPhase(dup);
  assert.equal(step.ok, false);
  assert.equal(step.message, 'responses_dry_run: processor_not_ok');
});

test('dry-run phase handles count mismatch with valid shape', () => {
  const bad = fullDryRunResult();
  bad.outcome.job.sourceRowCount = 100;
  const step = P.evaluateDryRunPhase(bad);
  assert.equal(step.ok, false);
  assert.equal(step.message, 'dry_run_counts_mismatch');
});

test('first ingest phase stops on missing outcome before bootstrap semantics', () => {
  const step = P.evaluateFirstIngestPhase({ ok: false, message: 'Another Qualtrics job is running' }, 'SLG_DM', 'slg_first_ingest');
  assert.equal(step.ok, false);
  assert.match(step.message, /processor_missing_job_outcome/);
});

test('first ingest phase validates SLG destination metrics', () => {
  const run = {
    ok: true,
    destinationResults: [{
      appId: 'SLG_DM',
      status: 'success',
      inserted: 5,
      updated: 0,
      unchanged: 0,
      excludedCount: 0
    }],
    outcome: { job: { jobId: 'j1' }, result: { ok: true } }
  };
  const step = P.evaluateFirstIngestPhase(run, 'SLG_DM', 'slg_first_ingest');
  assert.equal(step.ok, true);
  assert.equal(step.slg.inserted, 5);
});

test('idempotency phase shape and counts', () => {
  const slg1 = { inserted: 5, unchanged: 0 };
  const run = {
    ok: true,
    destinationResults: [{
      appId: 'SLG_DM',
      inserted: 0,
      updated: 0,
      unchanged: 5
    }],
    outcome: { job: {}, result: { ok: true } }
  };
  const step = P.evaluateIdempotencyPhase(run, slg1, 'SLG_DM');
  assert.equal(step.ok, true);
});

test('eligibility preview rejects missing result', () => {
  const step = P.evaluateEligibilityPhase(null);
  assert.equal(step.ok, false);
  assert.match(step.message, /missing_preview_result/);
});

test('bootstrap requires zero data rows', () => {
  assert.equal(P.evaluateBootstrapPhase({ ok: true, dataRowCount: 0 }).ok, true);
  assert.equal(P.evaluateBootstrapPhase({ ok: true, dataRowCount: 3 }).ok, false);
});
