const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEdmGlobals } = require('./loadGasSrc');

test('lock acquire and release', () => {
  const g = loadEdmGlobals();
  const lockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };
  const result = g.EdmLocking.tryAcquire(g.EdmLocking.QUALTRICS_INGEST_LOCK_KEY, lockService, 100);
  assert.equal(result.acquired, true);
  result.release();
});

test('audit ledger row has no row payload fields', () => {
  const g = loadEdmGlobals();
  const job = g.EdmJob.createJob('qualtrics', { filename: 'x.csv', checksum: 'abc' });
  const row = g.EdmAuditLedger.jobToLedgerRow(job);
  assert.equal(row.length, g.EdmAuditLedger.LEDGER_HEADERS.length);
  assert.ok(!row.join('|').includes('contact_email'));
});

test('source deletion policy documents V1A no-delete', () => {
  const g = loadEdmGlobals();
  const policy = g.EdmDriveFolders.sourceDeletionPolicy();
  assert.equal(policy.v1aDeletesFiles, false);
  assert.ok(policy.deleteSourceRequires.length >= 4);
});
