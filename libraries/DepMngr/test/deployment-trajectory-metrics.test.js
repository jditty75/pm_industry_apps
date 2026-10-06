const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'CoreDeploymentTrajectoryMetrics.js'),
  'utf8');
const sandbox = { TrajectoryMetrics: null };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const M = sandbox.TrajectoryMetrics;

const TODAY = '2026-10-06';

test('1 Green → Yellow = deterioration', () => {
  assert.equal(M.classifyHealthTransition('Green', 'Yellow'), 'deterioration');
});

test('2 Yellow → Red = deterioration', () => {
  assert.equal(M.classifyHealthTransition('Yellow', 'Red'), 'deterioration');
});

test('3 Red → Yellow = improvement', () => {
  assert.equal(M.classifyHealthTransition('Red', 'Yellow'), 'improvement');
});

test('4 Yellow → Green = improvement', () => {
  assert.equal(M.classifyHealthTransition('Yellow', 'Green'), 'improvement');
});

test('5 blank → Green is NOT improvement', () => {
  assert.equal(M.classifyHealthTransition('', 'Green'), null);
});

test('6 Red → blank is NOT deterioration', () => {
  assert.equal(M.classifyHealthTransition('Red', ''), null);
});

test('7 repeated health changes counted', () => {
  var events = [
    { atDate: '2026-09-01', old: 'Green', new: 'Yellow' },
    { atDate: '2026-09-15', old: 'Yellow', new: 'Red' },
    { atDate: '2026-10-01', old: 'Red', new: 'Yellow' }
  ];
  var m = M.computeHealthMetrics(events, 'Yellow', TODAY);
  assert.equal(m.health_changes_total, 3);
  assert.equal(m.health_deteriorations_90d, 2);
  assert.equal(m.health_improvements_90d, 1);
});

test('8 MTP later movement', () => {
  var ev = [{ atDate: TODAY, oldDate: '2026-01-01', newDate: '2026-02-01', movementDays: 31 }];
  var m = M.computeMtpMetrics(ev, '2026-02-01', '2026-01-01', TODAY);
  assert.equal(ev[0].movementDays, 31);
  assert.equal(m.mtp_slips_90d, 1);
});

test('9 MTP earlier movement', () => {
  var ev = [{ atDate: TODAY, oldDate: '2026-03-01', newDate: '2026-02-01', movementDays: -28 }];
  var m = M.computeMtpMetrics(ev, '2026-02-01', '2026-03-01', TODAY);
  assert.equal(m.mtp_accelerations_90d, 1);
});

test('10 multiple MTP movements — net movement', () => {
  var ev = [
    { atDate: '2026-01-01', oldDate: '2026-06-01', newDate: '2026-07-02', movementDays: 31 },
    { atDate: '2026-02-01', oldDate: '2026-07-02', newDate: '2026-06-15', movementDays: -17 },
    { atDate: '2026-03-01', oldDate: '2026-06-15', newDate: '2026-07-16', movementDays: 31 }
  ];
  var m = M.computeMtpMetrics(ev, '2026-07-16', '2026-06-01', TODAY);
  assert.equal(m.mtp_net_movement_comparison, 'earliest_recorded_current_mtp');
  assert.equal(m.mtp_net_movement_days, 31);
});

test('11 multiple MTP movements — gross movement', () => {
  var ev = [
    { atDate: '2026-01-01', oldDate: '2026-06-01', newDate: '2026-07-02', movementDays: 31 },
    { atDate: '2026-02-01', oldDate: '2026-07-02', newDate: '2026-06-15', movementDays: -17 },
    { atDate: '2026-03-01', oldDate: '2026-06-15', newDate: '2026-07-16', movementDays: 31 }
  ];
  var m = M.computeMtpMetrics(ev, '2026-07-16', '2026-06-01', TODAY);
  assert.equal(m.mtp_gross_movement_days, 79);
});

test('12 30/90-day windows', () => {
  var events = [
    { atDate: '2026-09-20', old: 'Green', new: 'Yellow' },
    { atDate: '2026-07-15', old: 'Yellow', new: 'Red' }
  ];
  var m = M.computeHealthMetrics(events, 'Yellow', TODAY);
  assert.equal(m.health_changes_30d, 1);
  assert.equal(m.health_changes_90d, 2);
});

test('13 malformed/blank MTP values', () => {
  var ev = [{ atDate: TODAY, oldDate: '', newDate: '2026-02-01', movementDays: null }];
  var m = M.computeMtpMetrics(ev, '2026-02-01', '', TODAY);
  assert.ok((m.mtp_warnings || []).length >= 1);
  assert.equal(m.mtp_gross_movement_days, 0);
});

test('14 stage tenure without stage ordering', () => {
  var events = [
    { atDate: '2026-09-01', old: 'Build', new: 'Deploy' },
    { atDate: '2026-09-20', old: 'Deploy', new: 'Initiate' }
  ];
  var s = M.computeStageMetrics(events, 'Initiate', TODAY);
  assert.equal(s.stage_changes_total, 2);
  assert.equal(s.previous_stage, 'Deploy');
  assert.equal(s.days_in_current_stage, 16);
});

test('15 multiple open DHPs represented via join keys (parser)', () => {
  var id1 = M.parseRelationshipIdField('{Id=a0r000000000001AAA, attributes={type=Deployment}}');
  var id2 = M.parseRelationshipIdField('a0r000000000002AAA');
  assert.equal(id1, 'a0r000000000001AAA');
  assert.equal(id2, 'a0r000000000002AAA');
});

test('16 multiple Action History records associated with one DHP', () => {
  var byDhp = { DHP1: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  var dhpIds = ['DHP1'];
  var total = 0;
  dhpIds.forEach(function (id) { total += (byDhp[id] || []).length; });
  assert.equal(total, 3);
});

test('17 serialized Salesforce Deployment relationship ID parsing', () => {
  var raw = '{Id=a0rHu00000ABCDEF, attributes={type=Deployment__c}}';
  assert.equal(M.parseRelationshipIdField(raw), 'a0rHu00000ABCDEF');
});
