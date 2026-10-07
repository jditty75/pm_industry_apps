const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreCsatVoc.js'), 'utf8');
const sandbox = { CoreCsatVoc: null };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const V = sandbox.CoreCsatVoc;

const hashFn = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

test('normalizeSurveyTypeKey handles long-form Qualtrics labels', () => {
  assert.equal(V.normalizeSurveyTypeKey('Mid-Deployment Survey'), 'MDS');
  assert.equal(V.normalizeSurveyTypeKey('Post Go-Live Survey'), 'PGL');
  assert.equal(V.normalizeSurveyTypeKey('MGM'), 'MDS');
  assert.equal(V.normalizeSurveyTypeKey('mds'), 'MDS');
});

test('survey_event_id is deterministic and cohort-sensitive', () => {
  const dep = '001DEP000000001AA';
  const d1 = V.computeSurveyEventId(dep, 'MDS', '2026-10-01', hashFn);
  const d2 = V.computeSurveyEventId(dep, 'MDS', '2026-10-01', hashFn);
  const d3 = V.computeSurveyEventId(dep, 'MDS', '2026-10-02', hashFn);
  const pgl = V.computeSurveyEventId(dep, 'PGL', '2026-10-01', hashFn);
  assert.equal(d1, d2);
  assert.notEqual(d1, d3);
  assert.notEqual(d1, pgl);
  assert.ok(d1.startsWith('SE_'));
  assert.ok(!d1.includes('Acme'));
});

test('partner and batch month do not change survey_event_id', () => {
  const dep = '001DEP000000002BB';
  const base = V.computeSurveyEventId(dep, 'PGL', '2026-01-15', hashFn);
  const again = V.computeSurveyEventId(dep, 'PGL', '2026-01-15', hashFn);
  assert.equal(base, again);
});

test('MDS cohorts — same target merges, distinct targets split', () => {
  const dep = { deploymentStartDate: '2026-01-01' };
  const oneCohort = V.buildExactCohortEvents(dep, [
    { targetGoLive: '2026-10-01', productArea: 'HCM' },
    { targetGoLive: '2026-10-01', productArea: 'Financials' }
  ]);
  assert.equal(oneCohort.filter((e) => e.kind === 'MDS').length, 1);

  const twoCohort = V.buildExactCohortEvents(dep, [
    { targetGoLive: '2026-10-01', productArea: 'HCM' },
    { targetGoLive: '2026-10-03', productArea: 'Financials' }
  ]);
  assert.equal(twoCohort.filter((e) => e.kind === 'MDS').length, 2);
});

test('cohorts 1–2 days apart remain distinct identities', () => {
  const dep = { deploymentStartDate: '2026-01-01' };
  const events = V.buildExactCohortEvents(dep, [
    { targetGoLive: '2026-10-01', productArea: 'A' },
    { targetGoLive: '2026-10-02', productArea: 'B' }
  ]);
  const ids = events.map((e) =>
    V.computeSurveyEventId('001DEP000000003CC', e.kind, e.cohortDate, hashFn));
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test('no parent-MTP fallback — empty PF yields no events', () => {
  const dep = { deploymentStartDate: '2026-01-01', mtpDate: '2026-12-01' };
  const events = V.buildExactCohortEvents(dep, []);
  assert.equal(events.length, 0);
});

test('PGL uses actual dates only and target +2 months', () => {
  const dep = { deploymentStartDate: '2026-01-01' };
  const events = V.buildExactCohortEvents(dep, [
    { targetGoLive: '2026-10-01', actualGoLive: '2026-09-15', productArea: 'HCM' }
  ]);
  const pgl = events.filter((e) => e.kind === 'PGL');
  assert.equal(pgl.length, 1);
  assert.equal(pgl[0].cohortDate, '2026-09-15');
  assert.equal(V.computeSurveyTargetDate('PGL', dep.deploymentStartDate, '2026-09-15'), '2026-11-15');
});

test('lifecycle states', () => {
  const sched = { surveyOpen: '2026-03-01', surveyClose: '2026-03-20' };
  assert.equal(V.computeSurveyState({}, '2026-02-01', sched, {}), V.SURVEY_STATE_UPCOMING);
  assert.equal(V.computeSurveyState({}, '2026-03-05', sched, {}), V.SURVEY_STATE_OVERDUE);
  assert.equal(V.computeSurveyState({}, '2026-03-05', sched, { sent: true }),
    V.SURVEY_STATE_IN_FLIGHT);
  assert.equal(V.computeSurveyState({}, '2026-03-05', sched, { responded: true }),
    V.SURVEY_STATE_RESPONDED);
});

test('multi-cohort awareness flag', () => {
  const counts = V.countDeploymentCohorts([
    { targetGoLive: '2026-10-01' },
    { targetGoLive: '2026-11-01' }
  ]);
  assert.ok(counts.mdsCohortCount > 1);
  const awareness = V.buildAwarenessConditions({ multiCohort: true });
  assert.ok(awareness.some((a) => a.code === 'MULTI_COHORT'));
  assert.ok(!awareness.some((a) => a.code === 'READY'));
});

test('in-flight reconciliation ambiguity', () => {
  const dep = '001DEP000000004DD';
  const candidates = [
    { deploymentId: dep, surveyType: 'MDS', surveyEventId: 'SE_A', cohortDate: '2026-10-01' },
    { deploymentId: dep, surveyType: 'MDS', surveyEventId: 'SE_B', cohortDate: '2026-11-01' }
  ];
  const link = V.reconcileInFlightToCohort({
    canonicalDeploymentId: dep,
    surveyType: 'Mid-Deployment Survey',
    candidateEvents: candidates
  });
  assert.equal(link.linkMethod, V.LINK_LEGACY_AMBIGUOUS);
  assert.ok(link.ambiguous);
});

test('partner scope default', () => {
  const cfg = { notify: { ddDigest: { partnerNames: ['Workday Professional Services'] } } };
  const names = V.getDefaultPartnerScopeNames(cfg);
  assert.ok(V.rowVisibleForPartnerScope({ partner: 'Workday Professional Services' }, false, names));
  assert.ok(!V.rowVisibleForPartnerScope({ partner: 'Partner Co' }, false, names));
  assert.ok(V.rowVisibleForPartnerScope({ partner: 'Partner Co' }, true, names));
});

test('EM reminder dedupe — cohort A vs B independent; replay idempotent; MDS vs PGL independent', () => {
  const tz = 'America/New_York';
  const dep = '001DEP000000006FF';
  const cohortA = {
    deploymentId: dep,
    surveyType: 'MDS',
    eventDate: '2026-05-01',
    cohortDate: '2026-10-01',
    surveyEventId: V.computeSurveyEventId(dep, 'MDS', '2026-10-01', hashFn)
  };
  const cohortB = {
    deploymentId: dep,
    surveyType: 'MDS',
    eventDate: '2026-06-01',
    cohortDate: '2026-11-01',
    surveyEventId: V.computeSurveyEventId(dep, 'MDS', '2026-11-01', hashFn)
  };
  const keysA = V.buildEmReminderDedupeKeys(cohortA, 'first', tz);
  const keysB = V.buildEmReminderDedupeKeys(cohortB, 'first', tz);
  assert.notEqual(keysA.canonical, keysB.canonical);

  const sent = {};
  V.markEmReminderSent(sent, keysA, '2026-01-01T00:00:00.000Z');
  assert.ok(V.emReminderAlreadySent(sent, keysA));
  assert.ok(!V.emReminderAlreadySent(sent, keysB));

  V.markEmReminderSent(sent, keysA, '2026-01-02T00:00:00.000Z');
  assert.equal(Object.keys(sent).filter((k) => k === keysA.canonical).length, 1);

  const pgl = {
    deploymentId: dep,
    surveyType: 'PGL',
    eventDate: '2026-05-01',
    cohortDate: '2026-10-01',
    surveyEventId: V.computeSurveyEventId(dep, 'PGL', '2026-10-01', hashFn)
  };
  const keysPgl = V.buildEmReminderDedupeKeys(pgl, 'first', tz);
  assert.notEqual(keysA.canonical, keysPgl.canonical);
  assert.ok(!V.emReminderAlreadySent(sent, keysPgl));
});

test('EM reminder dedupe honors legacy sent key without resend on canonical upgrade', () => {
  const tz = 'America/New_York';
  const row = {
    deploymentId: '001DEP000000007GG',
    surveyType: 'MDS',
    eventDate: '2026-04-15',
    cohortDate: '2026-09-01',
    surveyEventId: V.computeSurveyEventId('001DEP000000007GG', 'MDS', '2026-09-01', hashFn)
  };
  const keys = V.buildEmReminderDedupeKeys(row, 'first', tz);
  const sent = {};
  sent[keys.legacy] = '2025-12-01T00:00:00.000Z';
  assert.ok(V.emReminderAlreadySent(sent, keys));
});

test('legacy exception maps to awareness conditions (no READY/ATTENTION/BLOCKED)', () => {
  const prod = V.awarenessConditionsForLegacyException('ProductTargets');
  assert.ok(prod.some((a) => a.code === 'INVALID_PF_TARGET'));
  const end = V.awarenessConditionsForLegacyException('DeploymentTargetEnd');
  assert.ok(end.some((a) => a.code === 'NO_PF_COHORT'));
  assert.ok(!prod.some((a) => a.code === 'READY'));
});

test('response list item does not require cohort link', () => {
  const item = V.buildResponseListItem({
    response_id: 'R1',
    deployment_id: '001DEP000000005EE',
    account_name: 'Synthetic',
    deployment_name: 'Syn Dep',
    survey_type: 'PGL',
    response_ts_utc: '2026-01-01T00:00:00Z',
    overall_satisfaction: 4,
    nps_score: 8
  }, { linkMethod: V.LINK_LEGACY_UNKNOWN });
  assert.equal(item.responseId, 'R1');
  assert.equal(item.overallSatisfaction, 4);
});
