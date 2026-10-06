const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

function loadStewardship() {
  const sandbox = { CoreDeploymentDataStewardship: null };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentDataStewardship.js'), 'utf8'),
    sandbox);
  return sandbox.CoreDeploymentDataStewardship;
}

const S = loadStewardship();

function packet(overrides) {
  return Object.assign({
    metadata: { deployment_id: 'DEP_SANITIZED_001' },
    current_state: { current_health: 'Green', deployment_stage: 'Post Prod', current_mtp: '2026-12-01' },
    health_trajectory: { reconciliation: { health_current_matches_last_event_new_health: true } },
    schedule_trajectory: { parent_reconciliation_status: 'MATCH' },
    product_function: {
      product_function_count: 2,
      functions_completed: 2,
      functions_remaining: 0,
      product_function_rollup_reconciled: true,
      product_function_target_history_available: false
    },
    intervention: { has_open_health_plan: false },
    evidence_quality: { unavailable_evidence: ['product_function_target_date_history'] }
  }, overrides || {});
}

test('platform limitation separate from stewardship', () => {
  var p = packet();
  var plat = S.detectPlatformLimitations(p);
  var stew = S.detectStewardshipConditions(p);
  assert.ok(plat.some(function (r) { return r.lane === S.LANE_PLATFORM; }));
  assert.equal(stew.length, 0);
});

test('health reconciliation mismatch is stewardship', () => {
  var p = packet({
    health_trajectory: {
      reconciliation: { health_current_matches_last_event_new_health: false }
    }
  });
  var codes = S.detectStewardshipConditions(p).map(function (r) { return r.condition_code; });
  assert.ok(codes.includes('HEALTH_STATE_RECONCILIATION_MISMATCH'));
});

test('parent reconstruction limitation is platform not stewardship', () => {
  var p = packet({
    schedule_trajectory: { parent_reconciliation_status: 'RECONSTRUCTED_BLANK_CURRENT_POPULATED' }
  });
  var plat = S.detectPlatformLimitations(p).map(function (r) { return r.condition_code; });
  var stew = S.detectStewardshipConditions(p).map(function (r) { return r.condition_code; });
  assert.ok(plat.includes('PARENT_MTP_RECONSTRUCTION_LIMITATION'));
  assert.ok(!stew.includes('PARENT_MTP_RECONCILIATION_MISMATCH'));
});

test('PF rollup mismatch detected', () => {
  var p = packet({
    product_function: {
      product_function_count: 3,
      functions_completed: 0,
      functions_remaining: 0,
      product_function_rollup_reconciled: false
    }
  });
  var codes = S.detectStewardshipConditions(p).map(function (r) { return r.condition_code; });
  assert.ok(codes.includes('PF_ROLLUP_RECONCILIATION_MISMATCH'));
});
