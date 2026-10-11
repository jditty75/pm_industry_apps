const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');

function loadModule(filename, globalName) {
  const src = fs.readFileSync(path.join(srcDir, filename), 'utf8');
  const sandbox = { [globalName]: null };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox[globalName];
}

const V = loadModule('CoreCsatVoc.js', 'CoreCsatVoc');
const S = loadModule('CoreSurveySchedule.js', 'CoreSurveySchedule');

/**
 * Mirrors _buildMdsPglSurveyRowsFromActive_ schedule resolution for PGL.
 * @param {string} actualGoLive YYYY-MM-DD
 * @return {Object|null}
 */
function resolvePglBatchEntry(actualGoLive) {
  const surveyTargetDate = V.computeSurveyTargetDate('PGL', null, actualGoLive);
  const scheduleMatchDate = V.scheduleMatchDateForSurvey('PGL', actualGoLive, surveyTargetDate);
  const scheduleScanAnchor = V.scheduleScanAnchorYearMonth('PGL', actualGoLive, surveyTargetDate);
  const resolver = (ym) => S.resolve(ym);
  return V.resolveScheduleEntryWithScan(resolver, 'PGL', scheduleMatchDate, scheduleScanAnchor, 36);
}

/**
 * Legacy (defective) path: match and scan using +2-month survey target only.
 * @param {string} actualGoLive
 * @return {Object|null}
 */
function resolvePglBatchEntryLegacyDoubleOffset(actualGoLive) {
  const surveyTargetDate = V.computeSurveyTargetDate('PGL', null, actualGoLive);
  const resolver = (ym) => S.resolve(ym);
  return V.resolveScheduleEntryWithScan(
    resolver,
    'PGL',
    surveyTargetDate,
    V.scheduleScanStartYearMonth(surveyTargetDate),
    36
  );
}

test('PGL schedule match uses actual go-live; survey target stays +2 months for display', () => {
  const actual = '2026-09-15';
  assert.equal(V.computeSurveyTargetDate('PGL', null, actual), '2026-11-15');
  assert.equal(V.scheduleMatchDateForSurvey('PGL', actual, '2026-11-15'), actual);
  assert.equal(V.scheduleScanAnchorYearMonth('PGL', actual, '2026-11-15'), '2026-11');
});

test('PGL batch resolution — normal month (Sep actual → Nov FY27 batch)', () => {
  const entry = resolvePglBatchEntry('2026-09-15');
  assert.ok(entry);
  assert.equal(entry.yearMonth, '2026-11');
  assert.equal(entry.isProjected, false);
});

test('PGL batch resolution — year boundary (Nov actual → Jan FY27 batch)', () => {
  const entry = resolvePglBatchEntry('2026-11-20');
  assert.ok(entry);
  assert.equal(entry.yearMonth, '2027-01');
});

test('PGL batch resolution — month-end actual (Jan 31 → Mar batch)', () => {
  const actual = '2026-01-31';
  assert.equal(V.computeSurveyTargetDate('PGL', null, actual), '2026-03-31');
  const entry = resolvePglBatchEntry(actual);
  assert.ok(entry);
  assert.equal(entry.yearMonth, '2026-03');
});

test('PGL batch resolution — FY27 calendar exception (May actual → Jul batch)', () => {
  const entry = resolvePglBatchEntry('2026-05-15');
  assert.ok(entry);
  assert.equal(entry.yearMonth, '2026-07');
  const july = S.resolve('2026-07');
  assert.equal(july.pglFirstMtpWindow.start, '2026-05-01');
  assert.equal(july.pglFirstMtpWindow.end, '2026-05-31');
});

test('PGL double-offset legacy path assigns wrong batch for representative cohort', () => {
  const actual = '2026-09-15';
  const fixed = resolvePglBatchEntry(actual);
  const legacy = resolvePglBatchEntryLegacyDoubleOffset(actual);
  assert.equal(fixed.yearMonth, '2026-11');
  assert.ok(legacy);
  assert.notEqual(legacy.yearMonth, fixed.yearMonth);
});

test('MDS schedule anchor unchanged (target month − 2)', () => {
  const mdsTarget = '2026-08-15';
  assert.equal(V.scheduleScanAnchorYearMonth('MDS', '2026-10-01', mdsTarget), '2026-06');
  assert.equal(V.scheduleMatchDateForSurvey('MDS', '2026-10-01', mdsTarget), mdsTarget);
});

test('PGL horizon list match — resolveScheduleEntryForTarget with FY27 months', () => {
  const scheduleByMonth = ['2026-09', '2026-10', '2026-11'].map((ym) => S.resolve(ym));
  const actual = '2026-09-15';
  const target = V.computeSurveyTargetDate('PGL', null, actual);
  const match = V.scheduleMatchDateForSurvey('PGL', actual, target);
  const entry = V.resolveScheduleEntryForTarget(scheduleByMonth, 'PGL', match);
  assert.ok(entry);
  assert.equal(entry.yearMonth, '2026-11');
  const wrong = V.resolveScheduleEntryForTarget(scheduleByMonth, 'PGL', target);
  assert.notEqual(wrong && wrong.yearMonth, '2026-11');
});
