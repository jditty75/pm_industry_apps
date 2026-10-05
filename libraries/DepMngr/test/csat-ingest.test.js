const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreCsatIngest.js'), 'utf8');
const sandbox = { CoreCsatIngest: null };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const C = sandbox.CoreCsatIngest;

test('normalized qualtrics row maps to parsed shape', () => {
  const parsed = C.mapNormalizedQualtricsRowToParsed({
    deployment_id: '001ABC',
    tracking_status: 'Sent',
    full_name: 'A B',
    ts_email_sent: '2026-01-01T00:00:00Z'
  });
  assert.equal(parsed.deployment_id, '001ABC');
  assert.equal(parsed.full_name, 'A B');
});

test('tenant filter excludes unknown deployment', () => {
  const built = C.buildStorageRowsFromParsed(
    [{ deployment_id: '001', account_name: 'X', tracking_status: 'Sent' }],
    {},
    {
      canonicalId: (id) => id,
      normalizeTrackingStatus: (s) => s || 'Sent',
      formatShortDate: () => '—'
    }
  );
  assert.equal(built.matched, 0);
  assert.equal(built.discarded, 1);
});

test('safe replace plans trailing clear', () => {
  const plan = C.planTrailingClear(100, 10);
  assert.equal(plan.writeRows, 11);
  assert.equal(plan.clearFromRow, 12);
});

test('header verification catches mismatch', () => {
  const bad = C.verifyInFlightHeaders(['wrong'], 0);
  assert.equal(bad.ok, false);
});
