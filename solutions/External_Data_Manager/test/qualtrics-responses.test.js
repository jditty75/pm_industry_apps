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
const csv = fs.readFileSync(fixturePath, 'utf8');

test('Responses transform produces canonical DTOs without Qualtrics header names', () => {
  const out = g.QualtricsResponsesTransform.transformCsvText(csv);
  assert.equal(out.ok, true);
  assert.ok(out.rows.length >= 4);
  const row = out.rows[0];
  assert.match(row.response_id, /^R_/);
  assert.ok(row.survey_id);
  assert.equal(row.survey_type, 'PGL');
  assert.ok(row.response_ts_utc);
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'Survey_ID'));
  assert.ok(!row.respondent_email);
});

test('duplicate response_id keeps latest response_ts', () => {
  const out = g.QualtricsResponsesTransform.transformCsvText(csv);
  const dup = out.rows.find((r) => r.response_id === 'R_SYNDUPA00001');
  assert.ok(dup);
  assert.equal(dup.overall_satisfaction, 4);
});

test('Product Area normalization and alias groups', () => {
  const pa = g.QualtricsResponsesTransform.normalizeProductAreas(
    'Financials, Planning, Unknown Area Token',
    g.QualtricsResponsesRoutingConfig.getProductAreaConfig()
  );
  assert.equal(pa.product_areas, 'Financials|Planning|Unknown Area Token');
  assert.ok(pa.product_area_groups.indexOf('FINANCIALS') >= 0);
  assert.ok(pa.product_area_groups.indexOf('OTHER') >= 0);
});

test('free text formula injection neutralized', () => {
  const out = g.QualtricsResponsesTransform.transformCsvText(csv);
  const slg = out.rows.find((r) => r.sub_region === 'Government');
  assert.ok(slg.comment_improve.startsWith("'"));
});

test('Responses dry-run processor routes HC/SLG/HENP counts', () => {
  const outcome = g.EdmQualtricsResponsesProcessor.processCsvJob(csv, {
    filename: 'synthetic-responses.csv'
  }, {
    dryRun: true,
    skipDuplicateCheck: true
  });
  assert.equal(outcome.result.ok, true);
  const dests = outcome.result.destinationResults || [];
  const byApp = {};
  dests.forEach((d) => {
    byApp[d.appId] = d.inputRows;
  });
  assert.ok(byApp.HC_DM >= 1);
  assert.ok(byApp.SLG_DM >= 1);
  assert.ok(byApp.HENP_DM >= 1);
});

test('pipeline-scoped prior jobs do not cross-contaminate', () => {
  const refs = g.EdmJobHistory.toPriorJobRefs([
    { pipeline: 'qualtrics', source_checksum: 'a', overall_status: 'SUCCESS' },
    { pipeline: 'qualtrics_responses', source_checksum: 'b', overall_status: 'SUCCESS' }
  ], 'qualtrics_responses');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].checksum, 'b');
});
