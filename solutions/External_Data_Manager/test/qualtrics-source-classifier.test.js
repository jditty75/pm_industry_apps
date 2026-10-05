const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEdmGlobals } = require('./loadGasSrc');

const g = loadEdmGlobals();
const C = g.QualtricsSourceClassifier;
const inflightFixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'synthetic-qualtrics.csv'),
  'utf8'
);

test('legacy narrow InFlight synthetic classifies as INFLIGHT', () => {
  const r = C.classifyCsvText(inflightFixture);
  assert.equal(r.kind, C.SourceKind.QUALTRICS_INFLIGHT);
});

test('288-column Responses fixture classifies as RESPONSES', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'synthetic-qualtrics-responses.csv');
  if (!fs.existsSync(fixturePath)) {
    require('./fixtures/build-synthetic-responses-fixture');
  }
  const csv = fs.readFileSync(fixturePath, 'utf8');
  const r = C.classifyCsvText(csv);
  assert.equal(r.kind, C.SourceKind.QUALTRICS_RESPONSES);
});

test('InFlight pipeline rejects Responses-shaped 288 export', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'synthetic-qualtrics-responses.csv');
  const csv = fs.readFileSync(fixturePath, 'utf8');
  const v = g.QualtricsPipeline.validateSource(csv);
  assert.equal(v.ok, false);
});

test('Responses pipeline rejects InFlight-shaped 288 export', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'synthetic-inflight-crossfeed-288.csv');
  if (!fs.existsSync(fixturePath)) {
    require('./fixtures/build-synthetic-responses-fixture');
  }
  const csv = fs.readFileSync(fixturePath, 'utf8');
  const v = g.QualtricsResponsesPipeline.validateSource(csv);
  assert.equal(v.ok, false);
});
