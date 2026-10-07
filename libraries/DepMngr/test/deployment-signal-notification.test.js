const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function loadNotify() {
  var sandbox = {
    CoreConfig: { withDefaults: function (c) { return c || {}; } },
    CoreDeploymentSignalStore: null,
    Logger: { log: function () {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreDeploymentSignalStore.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreDeploymentSignalNotification.js'), 'utf8'), sandbox);
  return sandbox;
}

const N = loadNotify();

function runRow(overrides) {
  return Object.assign({
    signal_run_id: 'RUN-1',
    signal_as_of: '2026-10-05',
    run_status: 'COMPLETE',
    lifecycle_new_count: 0,
    lifecycle_escalated_count: 0,
    lifecycle_continuing_count: 0,
    lifecycle_de_escalated_count: 0,
    lifecycle_resolved_count: 0
  }, overrides || {});
}

test('NEW → notification eligible', () => {
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ lifecycle_new_count: 1 })), true);
});

test('ESCALATED → notification eligible', () => {
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ lifecycle_escalated_count: 2 })), true);
});

test('CONTINUING only → not eligible', () => {
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ lifecycle_continuing_count: 4 })), false);
});

test('DE_ESCALATED only → not eligible', () => {
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ lifecycle_de_escalated_count: 2 })), false);
});

test('RESOLVED only → not eligible', () => {
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ lifecycle_resolved_count: 3 })), false);
});

test('failed / incomplete run → not eligible', () => {
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ run_status: 'FAILED' })), false);
  assert.equal(N.CoreDeploymentSignalNotification.isNotificationEligible(
    runRow({ run_status: 'SUBMITTED' })), false);
});

test('handoff sets NOT_REQUIRED when ineligible', () => {
  var handoff = N.CoreDeploymentSignalNotification.applyPostCompleteHandoff(
    {}, runRow({ lifecycle_continuing_count: 1 }), [], { dryRun: true });
  assert.equal(handoff.email_status, 'NOT_REQUIRED');
});

test('handoff sets PENDING when eligible (no send in tests)', () => {
  var handoff = N.CoreDeploymentSignalNotification.applyPostCompleteHandoff(
    {}, runRow({ lifecycle_new_count: 1 }), [
      { signal_status: 'ACTIVE', lifecycle_state: 'NEW', deployment_id: 'D1' }
    ], { dryRun: true });
  assert.equal(handoff.email_status, 'PENDING');
  assert.ok(handoff.payload);
  assert.equal(handoff.sent, false);
});
