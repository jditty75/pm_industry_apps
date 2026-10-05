const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEdmGlobals } = require('./loadGasSrc');

const SYNTHETIC = path.join(__dirname, 'fixtures', 'synthetic-qualtrics.csv');

test('extra unconfigured Qualtrics columns are ignored', () => {
  const g = loadEdmGlobals();
  const base = fs.readFileSync(SYNTHETIC, 'utf8');
  const lines = base.split('\n').filter((l) => l.length > 0);
  const withExtra = [lines[0] + ',Future_Qualtrics_Field_Not_In_Contract']
    .concat(lines.slice(1).map((l) => l + ','))
    .join('\n') + '\n';
  const dataset = g.QualtricsTransform.buildCanonicalDataset(withExtra);
  assert.equal(dataset.ignoredSourceColumns.length, 1);
  assert.equal(String(dataset.ignoredSourceColumns[0]), 'Future_Qualtrics_Field_Not_In_Contract');
  const baseline = g.QualtricsTransform.buildCanonicalDataset(base);
  assert.equal(dataset.rows.length, baseline.rows.length);
});

test('routing is configuration-driven via population slices', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const dataset = g.QualtricsTransform.buildCanonicalDataset(csvText);
  const routed = g.QualtricsRoute.routeCanonicalDataset(dataset.rows);
  assert.ok(routed.slices.find((s) => s.populationId === 'healthcare'));
  assert.ok(routed.slices.find((s) => s.populationId === 'sled'));
  const sledSlice = routed.slices.find((s) => s.populationId === 'sled');
  const destIds = sledSlice.destinations.map((d) => String(d.appId)).sort();
  assert.equal(destIds.join(','), 'HENP_DM,SLG_DM');
});

test('future destination: extend config without changing normalizer', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const dataset = g.QualtricsTransform.buildCanonicalDataset(csvText);
  const extended = JSON.parse(JSON.stringify(g.QualtricsRoutingConfig.DEFAULT));
  extended.routes[0].destinations.push({
    appId: 'EXAMPLE_DM',
    ingestKind: 'csat_inflight',
    enabled: false
  });
  const routed = g.QualtricsRoute.routeCanonicalDataset(dataset.rows, extended);
  const hcPlan = routed.destinationPlan.find((p) => p.populationId === 'healthcare');
  assert.ok(hcPlan.destinations.includes('EXAMPLE_DM'));
});

test('routing validation rejects unconfigured source population', () => {
  const g = loadEdmGlobals();
  let csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  csvText = csvText.replace('US SLED', 'US Invalid', 1);
  const validation = g.QualtricsPipeline.validateSource(csvText);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /Unexpected\/blank/);
});
