const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { Stage1CandidatePilot } = require('./helpers/stage1-candidate-pilot');

function loadNormalize() {
  const sandbox = {
    CoreConfig: { withDefaults: function (c) { return c; } },
    CoreDeploymentSignalNormalize: null
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreDeploymentSignals.js'), 'utf8'),
    sandbox);
  return sandbox.CoreDeploymentSignalNormalize;
}

const N = loadNormalize();
const I = Stage1CandidatePilot;
const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'stage1-sample-block.txt'), 'utf8');

test('normalize attention Watch to WATCH', () => {
  assert.equal(I.normalizeAttention('Watch').normalized, 'WATCH');
});

test('parse sanitized sample block', () => {
  var blocks = N._parseSanaBatchBlocks_(sample, 'batch-01');
  var signals = blocks.filter(function (b) { return b.is_signal; });
  assert.equal(signals.length, 1);
  assert.ok(signals[0].fields['Signal Type']);
});

test('build normalized candidate contract', () => {
  var blocks = N._parseSanaBatchBlocks_(sample, 'batch-01');
  var sig = blocks.filter(function (b) { return b.is_signal; })[0];
  var cand = I.buildNormalizedCandidate(sig, 'DEP_SANITIZED_001', 'ctx.json', 'sha');
  assert.equal(cand.schema_version, 'deployment-signal-candidate-v1');
  assert.equal(cand.stage1_assessment.attention, 'WATCH');
});
