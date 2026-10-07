const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEdmGlobals } = require('./loadGasSrc');

const g = loadEdmGlobals();
const fixturePath = path.join(__dirname, 'fixtures', 'synthetic-qualtrics-responses.csv');
if (!fs.existsSync(fixturePath)) {
  require('./fixtures/build-synthetic-responses-fixture');
}
const responsesCsv = fs.readFileSync(fixturePath, 'utf8');

test('Responses run policy: missing property blocks non-dry-run ingest', () => {
  const inv = g.EdmQualtricsResponsesRunPolicy.resolveInvocation(
    { dryRun: false, ingestEnabled: true },
    false
  );
  assert.equal(inv.blocked, true);
  assert.equal(inv.message, 'RESPONSES_INGEST_DISABLED');
});

test('Responses run policy: explicit disabled property blocks scheduled-style ingest', () => {
  const inv = g.EdmQualtricsResponsesRunPolicy.resolveInvocation(
    { dryRun: false, ingestEnabled: false },
    true
  );
  assert.equal(inv.blocked, true);
  assert.equal(inv.reason, 'RESPONSES_MANUAL_INGEST_FLAG_REQUIRED');
});

test('Responses run policy: enabled property + ingest flag allows ingest', () => {
  const inv = g.EdmQualtricsResponsesRunPolicy.resolveInvocation(
    { dryRun: false, ingestEnabled: true },
    true
  );
  assert.equal(inv.blocked, false);
  assert.equal(inv.ingestEnabled, true);
  assert.equal(inv.mode, 'ingest');
});

test('Responses run policy: default manual call is dry-run', () => {
  const inv = g.EdmQualtricsResponsesRunPolicy.resolveInvocation({}, false);
  assert.equal(inv.blocked, false);
  assert.equal(inv.dryRun, true);
  assert.equal(inv.ingestEnabled, false);
});

test('Responses run policy: no candidate message', () => {
  const noFile = g.EdmQualtricsResponsesRunPolicy.noCandidateResult(false);
  assert.equal(noFile.message, 'NO_ELIGIBLE_RESPONSES_FILE');
});

test('scheduled runner executes inflight and responses', () => {
  const calls = [];
  const result = g.EdmQualtricsScheduledRunner.runScheduledPipelines({
    runInFlight: () => {
      calls.push('inflight');
      return { ok: true, message: 'inflight_ok' };
    },
    runResponses: () => {
      calls.push('responses');
      return { ok: true, message: 'responses_ok' };
    }
  });
  assert.deepEqual(calls, ['inflight', 'responses']);
  assert.equal(result.ok, true);
  assert.equal(result.inflight.message, 'inflight_ok');
  assert.equal(result.responses.message, 'responses_ok');
});

test('inflight failure does not suppress responses', () => {
  const calls = [];
  const result = g.EdmQualtricsScheduledRunner.runScheduledPipelines({
    runInFlight: () => {
      calls.push('inflight');
      throw new Error('inflight_boom');
    },
    runResponses: () => {
      calls.push('responses');
      return { ok: true, jobId: 'r1' };
    }
  });
  assert.deepEqual(calls, ['inflight', 'responses']);
  assert.equal(result.ok, false);
  assert.equal(result.inflight.ok, false);
  assert.equal(result.responses.ok, true);
});

test('responses failure does not suppress inflight', () => {
  const result = g.EdmQualtricsScheduledRunner.runScheduledPipelines({
    runInFlight: () => ({ ok: true }),
    runResponses: () => {
      throw new Error('responses_boom');
    }
  });
  assert.equal(result.inflight.ok, true);
  assert.equal(result.responses.ok, false);
  assert.match(result.responses.message, /responses_boom/);
});

test('duplicate successful checksum on responses pipeline', () => {
  const chk = g.EdmChecksum.sha256Hex(responsesCsv);
  const outcome = g.EdmQualtricsResponsesProcessor.processCsvJob(
    responsesCsv,
    { filename: 'synthetic-responses.csv' },
    {
      dryRun: false,
      ingestEnabled: true,
      priorJobs: [{ checksum: chk, status: g.EdmJobTypes.JobStatus.SUCCESS }],
      deps: { checksumFn: () => chk }
    }
  );
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.job.errorCategory, 'DUPLICATE_SUCCESS_CHECKSUM');
});

test('responses processor ingest disabled skips destinations with ok true', () => {
  const outcome = g.EdmQualtricsResponsesProcessor.processCsvJob(
    responsesCsv,
    { filename: 'synthetic-responses.csv' },
    {
      dryRun: false,
      ingestEnabled: false,
      skipDuplicateCheck: true
    }
  );
  assert.equal(outcome.result.ok, true);
  const dests = outcome.result.destinationResults || [];
  assert.ok(dests.length >= 3);
  dests.forEach((d) => {
    assert.equal(d.status, 'skipped');
  });
});

test('responses dry-run routes HC SLG HENP without ingest', () => {
  const outcome = g.EdmQualtricsResponsesProcessor.processCsvJob(
    responsesCsv,
    { filename: 'synthetic-responses.csv' },
    { dryRun: true, skipDuplicateCheck: true }
  );
  assert.equal(outcome.result.ok, true);
  const byApp = {};
  (outcome.result.destinationResults || []).forEach((d) => {
    byApp[d.appId] = d.inputRows;
  });
  assert.ok(byApp.HC_DM >= 1);
  assert.ok(byApp.SLG_DM >= 1);
  assert.ok(byApp.HENP_DM >= 1);
});

test('delete source allowed only when option true and job success', () => {
  const chk = g.EdmChecksum.sha256Hex(responsesCsv);
  const mockIngest = {
    success: true,
    inserted: 1,
    updated: 0,
    unchanged: 0,
    eligible: 1,
    excluded: 0
  };
  const coreLib = {
    CoreConfig: {
      withDefaults: (cfg) => cfg
    },
    CoreData: {
      ingestCsatResponses: () => mockIngest
    }
  };
  const props = {
    getProperty: (k) => {
      if (k === g.EdmProperties.DEST_HC_DM_SPREADSHEET_ID) return 'hc';
      if (k === g.EdmProperties.DEST_SLG_DM_SPREADSHEET_ID) return 'slg';
      if (k === g.EdmProperties.DEST_HENP_DM_SPREADSHEET_ID) return 'henp';
      return null;
    }
  };
  const outcome = g.EdmQualtricsResponsesProcessor.processCsvJob(
    responsesCsv,
    { filename: 'synthetic-responses.csv' },
    {
      dryRun: false,
      ingestEnabled: true,
      deleteSuccessfulSource: true,
      skipDuplicateCheck: true,
      deps: { checksumFn: () => chk, coreLib: coreLib, properties: props }
    }
  );
  assert.equal(outcome.job.status, g.EdmJobTypes.JobStatus.SUCCESS);
  assert.equal(outcome.deleteSourceAllowed, true);
});
