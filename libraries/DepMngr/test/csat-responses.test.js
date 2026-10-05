const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreCsatResponses.js'), 'utf8');
const sandbox = { CoreCsatResponses: null };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const C = sandbox.CoreCsatResponses;

const hashFn = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

function sampleRow(overrides) {
  return Object.assign({
    response_id: 'R_TEST_001',
    survey_id: 'SV_TEST',
    survey_type: 'PGL',
    response_ts_utc: '2026-01-01T12:00:00Z',
    deployment_id: '001DEP000000001AA',
    deployment_name: 'Synthetic Deployment',
    account_id: '001ACC000000001AA',
    account_name: 'Synthetic Account',
    sub_region: 'US Healthcare',
    product_areas: 'Core HCM',
    product_area_groups: 'HCM',
    contract_version: 'csat-response-v1',
    comment_reasons: 'Synthetic comment only.'
  }, overrides || {});
}

test('contract validation rejects missing required fields', () => {
  assert.ok(C.validationErrors({}).length > 0);
});

test('deterministic hash stable for same business content', () => {
  const row = sampleRow();
  const h1 = C.computeRowHash(row, hashFn);
  const h2 = C.computeRowHash(row, hashFn);
  assert.equal(h1, h2);
});

test('hash changes when score changes', () => {
  const a = sampleRow({ overall_satisfaction: 4 });
  const b = sampleRow({ overall_satisfaction: 5 });
  assert.notEqual(C.computeRowHash(a, hashFn), C.computeRowHash(b, hashFn));
});

test('eligible filter excludes unknown deployment', () => {
  const prepared = C.filterAndPrepareInbound(
    [sampleRow()],
    {},
    { canonicalId: (id) => id, hashFn, jobId: 'job1', nowIso: '2026-01-01T00:00:00Z' }
  );
  assert.equal(prepared.excluded, 1);
  assert.equal(prepared.eligible.length, 0);
});

test('upsert plan insert vs unchanged vs update', () => {
  const row = sampleRow();
  const hash = C.computeRowHash(row, hashFn);
  const existing = C.indexExistingByResponseId([{
    response_id: 'R_TEST_001',
    row_hash: hash,
    revision: 1,
    first_job_id: 'job0'
  }]);
  const unchangedPlan = C.planUpsert([Object.assign({}, row, {
    row_hash: hash,
    revision: 1,
    first_job_id: 'job0',
    updated_job_id: 'job1'
  })], existing, { jobId: 'job1', nowIso: '2026-01-02T00:00:00Z', hashFn });
  assert.equal(unchangedPlan.unchanged, 1);
  assert.equal(unchangedPlan.updated, 0);

  const changed = sampleRow({ overall_satisfaction: 3 });
  const plan2 = C.planUpsert([changed], existing, {
    jobId: 'job2',
    nowIso: '2026-01-03T00:00:00Z',
    hashFn
  });
  assert.equal(plan2.updated, 1);
  assert.equal(plan2.inserts.length, 0);
});

test('formula-like comment prefixed on sheet write', () => {
  const t = C.prepareTextForSheetWrite('=1+1');
  assert.equal(t.charAt(0), "'");
});
