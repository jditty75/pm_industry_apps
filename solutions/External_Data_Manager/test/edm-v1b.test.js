const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEdmGlobals } = require('./loadGasSrc');

const syntheticCsv = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'synthetic-qualtrics.csv'),
  'utf8'
);

test('dry-run processes synthetic CSV without ingest flags', () => {
  const g = loadEdmGlobals();
  const outcome = g.EdmQualtricsProcessor.processCsvJob(syntheticCsv, { filename: 'synthetic.csv' }, {
    dryRun: true,
    ingestEnabled: false,
    skipDuplicateCheck: true,
    deps: {
      checksumFn: (t) => g.EdmChecksum.sha256Hex(t)
    }
  });
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.dryRun, true);
  assert.ok(outcome.result.destinationResults.length >= 2);
  assert.equal(outcome.deleteSourceAllowed, false);
});

test('duplicate checksum rejected', () => {
  const g = loadEdmGlobals();
  const chk = g.EdmChecksum.sha256Hex(syntheticCsv);
  const outcome = g.EdmQualtricsProcessor.processCsvJob(syntheticCsv, { filename: 'a.csv' }, {
    dryRun: true,
    priorJobs: [{ checksum: chk, status: g.EdmJobTypes.JobStatus.SUCCESS }],
    deps: { checksumFn: () => chk }
  });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.job.errorCategory, 'DUPLICATE_SUCCESS_CHECKSUM');
});

test('duplicate override recorded', () => {
  const g = loadEdmGlobals();
  const chk = g.EdmChecksum.sha256Hex(syntheticCsv);
  const outcome = g.EdmQualtricsProcessor.processCsvJob(syntheticCsv, { filename: 'a.csv' }, {
    dryRun: true,
    allowDuplicateOverride: true,
    priorJobs: [{ checksum: chk, status: g.EdmJobTypes.JobStatus.SUCCESS }],
    deps: { checksumFn: () => chk }
  });
  assert.equal(outcome.result.ok, true);
  assert.ok(outcome.overrideFlags.includes('DUPLICATE_OVERRIDE'));
});

test('destination registry property keys', () => {
  const g = loadEdmGlobals();
  assert.equal(
    g.EdmDestinationRegistry.propertyKeyForApp('HC_DM'),
    g.EdmProperties.DEST_HC_DM_SPREADSHEET_ID
  );
});

test('ambiguous qualtrics folder fails safely', () => {
  const g = loadEdmGlobals();
  const parent = {
    getFoldersByName: () => ({
      hasNext: () => true,
      next: () => ({ getId: () => 'a' })
    }),
    createFolder: () => ({ getId: () => 'new' })
  };
  assert.throws(() => {
    g.EdmQualtricsDriveSetup.findUniqueChildByName_(parent, 'Inbox');
  }, /Ambiguous/);
});

test('diagnostics contain no email-like tokens from fixtures', () => {
  const g = loadEdmGlobals();
  const outcome = g.EdmQualtricsProcessor.processCsvJob(syntheticCsv, { filename: 's.csv' }, {
    dryRun: true,
    skipDuplicateCheck: true,
    deps: { checksumFn: (t) => g.EdmChecksum.sha256Hex(t) }
  });
  const diag = outcome.result.diagnostics || '';
  assert.ok(!diag.includes('@'));
});

test('deletion invariant requires explicit flag', () => {
  const g = loadEdmGlobals();
  const policy = g.EdmDriveFolders.sourceDeletionPolicy();
  assert.equal(policy.defaultDeleteSuccessfulSource, false);
});
