const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEdmGlobals } = require('./loadGasSrc');

test('production flag keys match runtime readers', () => {
  const g = loadEdmGlobals();
  assert.equal(g.EdmProperties.INGEST_ENABLED, 'EDM_QUALTRICS_INGEST_ENABLED');
  assert.equal(
    g.EdmProperties.DELETE_SUCCESSFUL_SOURCE,
    'EDM_DELETE_SUCCESSFUL_QUALTRICS_SOURCE'
  );
});

test('setProductionScriptProperties sets both flags with read-back', () => {
  const g = loadEdmGlobals();
  const store = {};
  const props = {
    setProperty: (k, v) => {
      store[k] = v;
    },
    getProperty: (k) => store[k]
  };
  const result = g.EdmProductionActivation.setProductionScriptProperties(props);
  assert.equal(result.ok, true);
  assert.equal(result.ingestEnabled, true);
  assert.equal(result.deleteSuccessfulSource, true);
  assert.equal(store[g.EdmProperties.INGEST_ENABLED], 'true');
  assert.equal(store[g.EdmProperties.DELETE_SUCCESSFUL_SOURCE], 'true');
});

test('verified source removal ok when synthetic csv remains in inbox inventory', () => {
  const g = loadEdmGlobals();
  const removal = g.EdmProductionActivation.verifiedSourceRemovalResult(
    'PGLandMDSSurveyDashboard-test.csv'
  );
  assert.equal(removal.ok, true);
  const inv = { csvCount: 1, csvNames: ['synthetic-qualtrics-dryrun.csv'] };
  const post = {
    ingestEnabled: true,
    deleteSuccessfulSource: true,
    triggerCount: 1,
    triggerHandlers: [g.EdmProductionActivation.SCHEDULE_HANDLER]
  };
  const ok = g.EdmProductionActivation.evaluateActivationSuccess(
    { ok: true, message: 'No CSV in Inbox' },
    post,
    { csvCount: 0 },
    { ok: true }
  );
  assert.equal(ok, true);
  assert.equal(
    g.EdmProductionActivation.evaluateActivationSuccess(
      { ok: true, message: 'No CSV in Inbox' },
      post,
      inv,
      { ok: true }
    ),
    false
  );
});

test('evaluateActivationSuccess requires ingest delete trigger and empty inbox', () => {
  const g = loadEdmGlobals();
  const handler = g.EdmProductionActivation.SCHEDULE_HANDLER;
  const emptyRun = { ok: true, message: 'No CSV in Inbox' };
  const trigger = { ok: true };
  const inboxEmpty = { csvCount: 0 };
  const postGood = {
    ingestEnabled: true,
    deleteSuccessfulSource: true,
    triggerCount: 1,
    triggerHandlers: [handler]
  };
  assert.equal(
    g.EdmProductionActivation.evaluateActivationSuccess(
      emptyRun,
      postGood,
      inboxEmpty,
      trigger
    ),
    true
  );
  assert.equal(
    g.EdmProductionActivation.evaluateActivationSuccess(
      emptyRun,
      Object.assign({}, postGood, { ingestEnabled: false }),
      inboxEmpty,
      trigger
    ),
    false
  );
});

test('buildLogSummary omits raw property values and ids', () => {
  const g = loadEdmGlobals();
  const line = g.EdmProductionActivation.buildLogSummary({
    ok: true,
    phase: 'complete',
    message: 'EDM QUALTRICS V1 PRODUCTION ACTIVATION COMPLETE',
    post: {
      ingestEnabled: true,
      deleteSuccessfulSource: true,
      triggerCount: 1,
      triggerHandlers: ['runQualtricsInboxScheduled']
    },
    postInbox: { csvCount: 0 }
  });
  assert.ok(line.includes('ingestEnabled=true'));
  assert.ok(line.includes('deleteSuccessfulSource=true'));
  assert.ok(!line.includes('8545'));
  assert.ok(!line.includes('SPREADSHEET'));
});

test('duplicate guard path does not imply destination ingest during activation', () => {
  const g = loadEdmGlobals();
  const chk = g.EdmChecksum.sha256Hex('a,b,c\n1,2,3');
  const outcome = g.EdmQualtricsProcessor.processCsvJob('a,b,c\n1,2,3', { filename: 'a.csv' }, {
    dryRun: true,
    priorJobs: [{ checksum: chk, status: g.EdmJobTypes.JobStatus.SUCCESS }],
    deps: { checksumFn: () => chk }
  });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.job.errorCategory, 'DUPLICATE_SUCCESS_CHECKSUM');
  assert.equal(outcome.deleteSourceAllowed, false);
});
