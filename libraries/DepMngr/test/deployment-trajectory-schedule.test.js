const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModules() {
  const sandbox = { TrajectoryMetrics: null, TrajectorySchedule: null };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentTrajectoryMetrics.js'), 'utf8'),
    sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentTrajectorySchedule.js'), 'utf8'),
    sandbox);
  return { M: sandbox.TrajectoryMetrics, S: sandbox.TrajectorySchedule };
}

const { M, S } = loadModules();
const TODAY = '2026-10-06';

function pf(id, dep, target, actual) {
  return {
    id: id,
    deploymentId: dep,
    productArea: 'HCM',
    functionName: 'Fn' + id,
    targetMtp: target || '',
    actualMtp: actual || ''
  };
}

test('1 Product Function joins parent Deployment via deploymentId', () => {
  var map = S.indexProductFunctionsByDeployment(
    [pf('PF1', 'DEP001', '2026-01-01', '')],
    function (id) { return id; });
  assert.equal(map.DEP001.length, 1);
});

test('2 Product Function History joins Product Function via ParentId', () => {
  var hist = [
    { parentId: 'PF1', field: S.PF_TARGET_FIELD, oldValue: '', newValue: '2026-02-01', createdDate: TODAY }
  ];
  var idx = S.indexHistoryByParentId(hist, function (id) { return id; });
  assert.equal(idx.PF1.length, 1);
});

test('3 identical function effective MTP dates => DEPLOYMENT grain', () => {
  var g = S.analyzeProductFunctionGrain([
    pf('a', 'd', '2026-06-01', ''),
    pf('b', 'd', '2026-06-01', '')
  ]);
  assert.equal(g.mtp_analysis_grain, S.GRAIN_DEPLOYMENT);
});

test('4 two distinct function effective MTP dates => PRODUCT_FUNCTION grain', () => {
  var g = S.analyzeProductFunctionGrain([
    pf('a', 'd', '2026-06-01', ''),
    pf('b', 'd', '2026-07-01', '')
  ]);
  assert.equal(g.mtp_analysis_grain, S.GRAIN_PRODUCT_FUNCTION);
});

test('5 no Product Functions => DEPLOYMENT_ONLY', () => {
  var g = S.analyzeProductFunctionGrain([]);
  assert.equal(g.mtp_analysis_grain, S.GRAIN_DEPLOYMENT_ONLY);
});

test('6 one blank among identical populated dates stays DEPLOYMENT grain', () => {
  var g = S.analyzeProductFunctionGrain([
    pf('a', 'd', '2026-06-01', ''),
    pf('b', 'd', '', '')
  ]);
  assert.equal(g.mtp_analysis_grain, S.GRAIN_DEPLOYMENT);
  assert.equal(g.product_function_without_mtp_count, 1);
});

test('7 target-only effective MTP', () => {
  assert.equal(S.functionEffectiveMtp(pf('x', 'd', '2026-03-01', '')), '2026-03-01');
});

test('8 actual overrides target for effective MTP', () => {
  assert.equal(S.functionEffectiveMtp(pf('x', 'd', '2026-03-01', '2026-04-01')), '2026-04-01');
});

test('9 target later movement = slip', () => {
  var t = [
    { atDate: TODAY, oldDate: '2026-01-01', newDate: '2026-02-01', movementDays: 31, validChange: true }
  ];
  var m = S.computeTargetScheduleMetrics(t, '2026-02-01', TODAY);
  assert.equal(m.target_slips_90d, 1);
});

test('10 target earlier movement = acceleration', () => {
  var t = [
    { atDate: TODAY, oldDate: '2026-03-01', newDate: '2026-02-01', movementDays: -28, validChange: true }
  ];
  var m = S.computeTargetScheduleMetrics(t, '2026-02-01', TODAY);
  assert.equal(m.target_accelerations_90d, 1);
});

test('11 blank to target retained not slip', () => {
  var t = [
    { atDate: TODAY, oldDate: '', newDate: '2026-02-01', movementDays: null, validChange: false }
  ];
  var m = S.computeTargetScheduleMetrics(t, '2026-02-01', TODAY);
  assert.equal(m.target_changes_total, 0);
  assert.equal(m.target_slips_90d, 0);
});

test('12 target to blank retained not acceleration', () => {
  var t = [
    { atDate: TODAY, oldDate: '2026-02-01', newDate: '', movementDays: null, validChange: false }
  ];
  var m = S.computeTargetScheduleMetrics(t, '', TODAY);
  assert.equal(m.target_accelerations_90d, 0);
});

test('13 target net movement', () => {
  var t = [
    { atDate: '2026-01-01', oldDate: '', newDate: '2026-06-01', movementDays: null, validChange: false },
    { atDate: '2026-02-01', oldDate: '2026-06-01', newDate: '2026-07-16', movementDays: 45, validChange: true }
  ];
  var m = S.computeTargetScheduleMetrics(t, '2026-07-16', TODAY);
  assert.equal(m.target_net_movement_days, 45);
});

test('14 target gross movement', () => {
  var t = [
    { atDate: '2026-01-01', oldDate: '2026-06-01', newDate: '2026-07-02', movementDays: 31, validChange: true },
    { atDate: '2026-02-01', oldDate: '2026-07-02', newDate: '2026-06-15', movementDays: -17, validChange: true },
    { atDate: '2026-03-01', oldDate: '2026-06-15', newDate: '2026-07-16', movementDays: 31, validChange: true }
  ];
  var m = S.computeTargetScheduleMetrics(t, '2026-07-16', TODAY);
  assert.equal(m.target_gross_movement_days, 79);
});

test('15 target slip days 90d', () => {
  var t = [
    { atDate: TODAY, oldDate: '2026-01-01', newDate: '2026-01-11', movementDays: 10, validChange: true },
    { atDate: TODAY, oldDate: '2026-01-11', newDate: '2026-01-21', movementDays: 10, validChange: true }
  ];
  var m = S.computeTargetScheduleMetrics(t, '2026-01-21', TODAY);
  assert.equal(m.target_slip_days_90d, 20);
});

test('16 actual population does not increment target change count', () => {
  var targetT = [];
  var actualT = [
    { atDate: TODAY, oldDate: '', newDate: '2026-05-01', movementDays: null, validChange: false }
  ];
  var fm = S.computeFunctionScheduleMetrics(targetT, actualT, '2026-04-01', '', TODAY);
  assert.equal(fm.target_changes_total, 0);
  assert.equal(fm.current_actual_mtp, '2026-05-01');
});

test('17 actual vs final target positive variance', () => {
  var fm = S.computeFunctionScheduleMetrics([], [], '2026-04-01', '2026-04-05', TODAY);
  assert.equal(fm.actual_vs_final_target_days, 4);
});

test('18 actual vs final target negative variance', () => {
  var fm = S.computeFunctionScheduleMetrics([], [], '2026-04-10', '2026-04-05', TODAY);
  assert.equal(fm.actual_vs_final_target_days, -5);
});

test('19 mixed completed and remaining functions rollup', () => {
  var list = [
    { current_actual_mtp: '2026-01-01', actual_vs_final_target_days: 0, target_changes_30d: 0 },
    { current_actual_mtp: '', current_target_mtp: '2026-06-01', target_changes_30d: 0 },
    { current_actual_mtp: '', current_target_mtp: '2026-08-01', target_changes_30d: 0 }
  ];
  var r = S.aggregateProductFunctionRollups(list, TODAY);
  assert.equal(r.functions_actual_mtp_count, 1);
  assert.equal(r.functions_remaining_count, 2);
});

test('20 remaining earliest and latest target', () => {
  var list = [
    { current_actual_mtp: '', current_target_mtp: '2026-08-01' },
    { current_actual_mtp: '', current_target_mtp: '2026-06-01' }
  ];
  var r = S.aggregateProductFunctionRollups(list, TODAY);
  assert.equal(r.remaining_earliest_target_mtp, '2026-06-01');
  assert.equal(r.remaining_latest_target_mtp, '2026-08-01');
});

test('21 function-level target change rollups', () => {
  var list = [
    { target_changes_30d: 2, target_changes_90d: 3, target_slips_90d: 1 },
    { target_changes_30d: 0, target_changes_90d: 1, target_slips_90d: 0 }
  ];
  var r = S.aggregateProductFunctionRollups(list, TODAY);
  assert.equal(r.function_target_changes_30d, 2);
  assert.equal(r.functions_with_target_changes_30d, 1);
});

test('22 parent target history reconstruction', () => {
  var events = [
    { field: S.PARENT_TARGET_FIELD, old: '', new: '2026-05-01', at: '2026-01-01T00:00:00Z' },
    { field: S.PARENT_TARGET_FIELD, old: '2026-05-01', new: '2026-06-01', at: '2026-02-01T00:00:00Z' }
  ];
  var norm = function (v) { return String(v || '').slice(0, 10); };
  var parent = S.buildParentSchedule(events, norm, TODAY, '2026-06-01', '2026-06-01', '');
  assert.equal(parent.targetTransitions.length, 2);
  assert.equal(parent.targetMetrics.target_changes_total, 1);
});

test('23 parent actual MTP handling', () => {
  var events = [
    { field: S.PARENT_TARGET_FIELD, old: '', new: '2026-05-01', at: '2026-01-01T00:00:00Z' },
    { field: S.PARENT_ACTUAL_FIELD, old: '', new: '2026-05-03', at: '2026-05-03T00:00:00Z' }
  ];
  var norm = function (v) { return String(v || '').slice(0, 10); };
  var parent = S.buildParentSchedule(events, norm, TODAY, '2026-05-01', '2026-05-01', '');
  assert.equal(parent.actualTransitions.length, 1);
  assert.equal(parent.actualOutcome.actual_vs_final_target_days, 2);
});

test('24 parent reconciliation MATCH', () => {
  assert.equal(
    S.reconcileParentMtp('2026-05-01', '2026-05-01', S.GRAIN_DEPLOYMENT_ONLY),
    S.RECON_MATCH);
});

test('25 parent reconciliation mismatch', () => {
  assert.equal(
    S.reconcileParentMtp('2026-05-01', '2026-06-01', S.GRAIN_DEPLOYMENT),
    S.RECON_MISMATCH);
});

test('26 PRODUCT_FUNCTION grain reconciliation NA', () => {
  assert.equal(
    S.reconcileParentMtp('2026-05-01', '2026-06-01', S.GRAIN_PRODUCT_FUNCTION),
    S.RECON_NA_PF);
});

test('27 stable schedule without history does not add reconstruction warning', () => {
  var bundle = S.buildForDeployment({
    deploymentId: 'D1',
    productFunctions: [],
    parentHistoryEvents: [],
    todayStr: TODAY,
    parentTargetFromRow: '',
    currentMtpReference: '2026-12-01',
    baselineMtp: '',
    normalizeDate: function (v) { return String(v || '').slice(0, 10); }
  });
  assert.ok(!(bundle.warnings || []).includes('parent_mtp_reconstruction_failed'));
});

test('28 health metrics unchanged (regression)', () => {
  var events = [{ atDate: TODAY, old: 'Green', new: 'Yellow' }];
  var m = M.computeHealthMetrics(events, 'Yellow', TODAY);
  assert.equal(m.health_changes_total, 1);
});

test('29 action history join key parser (regression)', () => {
  assert.equal(M.parseRelationshipIdField('a0rHu00000ABCDEF'), 'a0rHu00000ABCDEF');
});

const LIVE_HEADERS = [
  'Id',
  'Product_Area__c',
  'Function__c',
  'Production_Move_Date_Target__c',
  'Production_Move_Date_Actual__c',
  'Deployment__c'
];

function parsePfSheet(dataRows) {
  var values = [LIVE_HEADERS].concat(dataRows);
  return S.parseProductFunctionSheetValues(values, {
    parseRelationshipId: M.parseRelationshipIdField,
    canonicalId: function (id) {
      var s = String(id || '').trim();
      return s.length >= 18 ? s.slice(0, 18) : s;
    },
    normalizeDate: function (raw) {
      if (!raw) return '';
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      return String(raw).slice(0, 10);
    }
  });
}

test('30 live format: direct Deployment__c parses', () => {
  var out = parsePfSheet([[
    'a0p1B00000It8QGQAZ',
    'Human Capital Management',
    'Benefits',
    '2019-09-22',
    '2019-09-22',
    'a0r1B00000B1tMqQAJ'
  ]]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].deploymentId, 'a0r1B00000B1tMqQAJ');
});

test('31 blank target still parses', () => {
  var out = parsePfSheet([[
    'a0p1B00000It8QGQAZ', 'HCM', 'Benefits', '', '2019-09-22', 'a0r1B00000B1tMqQAJ'
  ]]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].targetMtp, '');
});

test('32 blank actual still parses', () => {
  var out = parsePfSheet([[
    'a0p1B00000It8QGQAZ', 'HCM', 'Benefits', '2019-09-22', '', 'a0r1B00000B1tMqQAJ'
  ]]);
  assert.equal(out.rows.length, 1);
});

test('33 both MTP blank still parses', () => {
  var out = parsePfSheet([[
    'a0p1B00000It8QGQAZ', 'HCM', 'Benefits', '', '', 'a0r1B00000B1tMqQAJ'
  ]]);
  assert.equal(out.rows.length, 1);
});

test('34 history ParentId matches parsed Product Function ID', () => {
  var pf = parsePfSheet([[
    'a0p1B00000It8QGQAZ', 'HCM', 'Benefits', '', '', 'a0r1B00000B1tMqQAJ'
  ]]);
  var hist = [{ parentId: 'a0p1B00000It8QGQAZ', field: S.PF_TARGET_FIELD }];
  var idx = S.indexHistoryByParentId(hist, function (id) {
    var s = String(id || '').trim();
    return s.length >= 18 ? s.slice(0, 18) : s;
  });
  assert.equal((idx[pf.rows[0].id] || []).length, 1);
});

test('35 Product Function maps to parent Deployment', () => {
  var out = parsePfSheet([[
    'a0p1B00000It8QGQAZ', 'HCM', 'Benefits', '', '', 'a0r1B00000B1tMqQAJ'
  ]]);
  var map = S.indexProductFunctionsByDeployment(out.rows, function (id) { return id; });
  assert.equal(map['a0r1B00000B1tMqQAJ'].length, 1);
});

test('36 column resolution for live headers', () => {
  var cols = S.resolveProductFunctionColumns(LIVE_HEADERS);
  assert.equal(cols.colId, 0);
  assert.equal(cols.colDepResolved, 5);
});
