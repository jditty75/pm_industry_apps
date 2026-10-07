const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

function loadContext() {
  const sandbox = {
    TrajectoryMetrics: null,
    CoreDeploymentTrajectory: {
      isEnabled: function () { return true; },
      _buildContext_: function () { return { deployments: [], actionHistoryIndex: [] }; }
    },
    CoreConfig: { withDefaults: function (c) { return c; } },
    Logger: { log: function () {} },
    CoreDeploymentSignalContext: null
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentTrajectoryMetrics.js'), 'utf8'),
    sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentSignals.js'), 'utf8'),
    sandbox);
  return sandbox.CoreDeploymentSignalContext;
}

const C = loadContext();
const TODAY = '2026-10-06';

test('schema version is deployment-signal-context-v1', () => {
  assert.equal(C.SCHEMA_VERSION, 'deployment-signal-context-v1');
});

test('health reconciliation flags current vs last event mismatch', () => {
  var row = {
    current_health: 'Green',
    previous_health: 'Red',
    health_last_change_date: '2025-09-22',
    days_at_current_health: 14
  };
  var events = [{ new_health: 'Yellow', old_health: 'Red', event_date: '2025-09-22' }];
  var c = C.healthReconciliationContract(row, events);
  assert.equal(c.health_current_matches_last_event_new_health, false);
  assert.equal(c.verified_days_at_current_health, null);
  assert.ok(c.caveats.length > 0);
});

test('PF rollup detects count mismatch', () => {
  var pf = C.productFunctionRollupReconciliation({
    product_function_count: 3,
    functions_actual_mtp_count: 0,
    functions_remaining_count: 0
  });
  assert.equal(pf.product_function_rollup_reconciled, false);
  assert.equal(pf.product_function_target_history_available, false);
});

test('schedule contract distinguishes initial population', () => {
  var row = {
    mtp_gross_movement_days: 120,
    mtp_net_movement_days: 0,
    mtp_net_movement_comparison: 'earliest_recorded_current_mtp',
    earliest_recorded_mtp: '2026-01-01',
    current_mtp: '2026-01-01',
    baseline_mtp: '2025-06-01'
  };
  var mtp = [{
    event_type: 'PARENT_TARGET_CHANGE',
    old_date: '',
    new_date: '2025-06-01',
    movement_days: 0
  }, {
    event_type: 'PARENT_TARGET_CHANGE',
    old_date: '2025-06-01',
    new_date: '2026-06-01',
    movement_days: 120
  }];
  var contract = C.scheduleMovementContract(row, mtp);
  assert.equal(contract.initial_target_population_event_count, 1);
  assert.ok(contract.valid_parent_target_change_event_count >= 1);
});

test('packet includes explicit temporal schedule windows', () => {
  var item = {
    row: {
      deployment_id: 'DEP_TEST_001',
      current_health: 'Green',
      current_stage: 'Build',
      current_mtp: '2026-12-01',
      days_until_current_mtp: 56,
      mtp_analysis_grain: 'DEPLOYMENT',
      health_event_count: 0,
      mtp_changes_90d: 0,
      mtp_changes_30d: 0,
      mtp_gross_movement_days: 0,
      mtp_net_movement_days: 0,
      trajectory_schema_version: 2
    },
    healthEvents: [],
    mtpEvents: []
  };
  var pkt = C.buildFromTrajectoryItem(item, { todayStr: TODAY, logicalApp: 'SLG_DM' });
  assert.equal(pkt.schema_version, 'deployment-signal-context-v1');
  assert.ok(pkt.schedule_trajectory.recent_90d);
  assert.ok(pkt.schedule_trajectory.lifetime);
  assert.ok(pkt.metadata.evidence_windows.recent_90d.start);
});

test('narrative selection is deterministic and capped', () => {
  var narratives = [
    { CreatedDate: '2026-01-01', Health_Status__c: 'Yellow', Action_Description__c: 'A' },
    { CreatedDate: '2026-09-20', Health_Status__c: 'Green', Action_Description__c: 'B recent' },
    { CreatedDate: '2026-09-25', Health_Status__c: 'Green', Action_Description__c: 'C recent' }
  ];
  var a = C.selectActionNarratives(narratives, TODAY, 2);
  var b = C.selectActionNarratives(narratives, TODAY, 2);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
});

test('isEnabled follows deploymentSignal gate', () => {
  const sandbox = {
    TrajectoryMetrics: null,
    CoreDeploymentTrajectory: { isEnabled: function () { return false; } },
    CoreConfig: { withDefaults: function (c) { return c; } },
    Logger: { log: function () {} },
    CoreDeploymentSignalContext: null
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentTrajectoryMetrics.js'), 'utf8'),
    sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentSignals.js'), 'utf8'),
    sandbox);
  assert.equal(sandbox.CoreDeploymentSignalContext.isEnabled({ deploymentSignal: { enabled: false } }), false);
});
