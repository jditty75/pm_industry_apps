const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { loadEdmGlobals } = require('./loadGasSrc');

const FIXTURES = path.join(__dirname, 'fixtures');
const SYNTHETIC = path.join(FIXTURES, 'synthetic-qualtrics.csv');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const ka = a.survey_id + '|' + a.contact_id;
    const kb = b.survey_id + '|' + b.contact_id;
    return ka.localeCompare(kb);
  });
}

function rowSignature(row, order) {
  return order.map((c) => c + '=' + (row[c] == null ? '' : row[c])).join('|');
}

test('synthetic fixture exists and parses', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const result = g.QualtricsTransform.normalizeQualtricsCsv(csvText);
  assert.ok(result.rows.length > 0);
  assert.equal(result.sourceRowCount, 15);
});

test('routing healthcare vs sled populations', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const norm = g.QualtricsTransform.normalizeQualtricsCsv(csvText);
  const routed = g.QualtricsRoute.routePopulations(norm.rows);
  assert.equal(routed.healthcare.length + routed.sled.length, norm.rows.length);
  routed.healthcare.forEach((r) => assert.equal(r.app, 'US Healthcare'));
  routed.sled.forEach((r) => assert.equal(r.app, 'US SLED'));
});

test('dedup keeps later email send', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const norm = g.QualtricsTransform.normalizeQualtricsCsv(csvText);
  const dup = norm.rows.find((r) => r.survey_id === 'SRV-DUP');
  assert.ok(dup);
  assert.equal(dup.response_id, 'RSP-DUP-WIN');
  assert.equal(dup.tracking_status, 'Completed');
});

test('tracking status branches', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const norm = g.QualtricsTransform.normalizeQualtricsCsv(csvText);
  const bySurvey = Object.fromEntries(norm.rows.map((r) => [r.survey_id, r]));
  assert.equal(bySurvey['SRV-BOUNCE'].tracking_status, 'Bounced/Undeliverable');
  assert.equal(bySurvey['SRV-PARTIAL'].tracking_status, 'Partial');
  assert.equal(bySurvey['SRV-STARTED'].tracking_status, 'Started');
  assert.equal(bySurvey['SRV-OPENED'].tracking_status, 'Opened');
  assert.equal(bySurvey['SRV-SENT'].tracking_status, 'Sent');
  assert.equal(bySurvey['SRV-UNKNOWN'].tracking_status, 'Unknown');
});

test('negative: missing required column', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const broken = csvText.replace('Survey_ID', 'Survey_ID_Removed');
  assert.throws(() => g.QualtricsTransform.normalizeQualtricsCsv(broken), /Missing columns/);
});

test('negative: blank and unexpected Sub Region', () => {
  const g = loadEdmGlobals();
  let csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  csvText = csvText.replace('US Healthcare', '', 1);
  assert.throws(() => g.QualtricsTransform.normalizeQualtricsCsv(csvText), /Unexpected\/blank/);
  csvText = fs.readFileSync(SYNTHETIC, 'utf8').replace('US SLED', 'US Invalid', 1);
  assert.throws(() => g.QualtricsTransform.normalizeQualtricsCsv(csvText), /Unexpected\/blank/);
});

test('orchestrator stops at READY_FOR_INGESTION', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const outcome = g.EdmOrchestrator.processQualtricsCsvJob(csvText, {
    filename: 'synthetic-qualtrics.csv',
    skipDuplicateCheck: true,
    checksumFn: sha256
  });
  assert.equal(outcome.job.status, g.EdmJobTypes.JobStatus.READY_FOR_INGESTION);
  assert.ok(outcome.result.ok);
  assert.ok(outcome.job.healthcareCount > 0);
  assert.ok(outcome.job.sledCount > 0);
});

test('duplicate successful checksum rejected', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const checksum = sha256(csvText);
  const outcome = g.EdmOrchestrator.processQualtricsCsvJob(csvText, {
    checksumFn: sha256,
    priorJobs: [{ checksum, status: g.EdmJobTypes.JobStatus.SUCCESS }]
  });
  assert.equal(outcome.job.status, g.EdmJobTypes.JobStatus.FAILED);
  assert.equal(outcome.result.reason, 'DUPLICATE_SUCCESS_CHECKSUM');
});

test('python oracle equivalence on synthetic fixture', () => {
  const g = loadEdmGlobals();
  const csvText = fs.readFileSync(SYNTHETIC, 'utf8');
  const jsNorm = g.QualtricsTransform.normalizeQualtricsCsv(csvText);
  const oraclePath = path.join(__dirname, 'oracle', 'normalize_qualtrics_oracle.py');
  let pyOut;
  try {
    pyOut = execFileSync('python', [oraclePath, SYNTHETIC], { encoding: 'utf8' });
  } catch (e) {
    assert.fail('Python oracle failed (pandas required): ' + (e.stderr || e.message));
  }
  const oracle = JSON.parse(pyOut);
  assert.equal(jsNorm.rows.length, oracle.total);
  assert.equal(
    jsNorm.rows.filter((r) => r.app === 'US Healthcare').length,
    oracle.healthcare
  );
  assert.equal(
    jsNorm.rows.filter((r) => r.app === 'US SLED').length,
    oracle.sled
  );
  const order = g.QualtricsSchema.OUT_ORDER;
  const jsSorted = sortRows(jsNorm.rows);
  const pySorted = sortRows(oracle.rows);
  assert.equal(jsSorted.length, pySorted.length);
  for (let i = 0; i < jsSorted.length; i++) {
    assert.equal(rowSignature(jsSorted[i], order), rowSignature(pySorted[i], order));
  }
});
