const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'CoreDeploymentTrajectorySheetWrite.js'),
  'utf8');
const sandbox = { TrajectorySheetWrite: null };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const W = sandbox.TrajectorySheetWrite;

test('bodySetValuesNumRows matches data length (184 rows => 184 numRows)', () => {
  assert.equal(W.bodySetValuesNumRows(184), 184);
  assert.notEqual(W.bodySetValuesNumRows(184), 185);
});

test('trailingBodyClearNumRows clears only stale tail after shrink', () => {
  assert.equal(W.trailingBodyClearNumRows(186, 184), 1);
  assert.equal(W.trailingBodyClearNumRows(2, 0), 1);
  assert.equal(W.trailingBodyClearNumRows(1, 10), 0);
  assert.equal(W.trailingBodyClearNumRows(500, 100), 399);
});

test('zero data rows — no body setValues rows', () => {
  assert.equal(W.bodySetValuesNumRows(0), 0);
  assert.equal(W.writeMatrixRowCount(0), 1);
  assert.equal(W.trailingBodyClearNumRows(50, 0), 49);
});

test('estimatePayload counts cells and chars', () => {
  var p = W.estimatePayload(['a', 'b'], [['1', '2'], ['3', '4']]);
  assert.equal(p.dataRows, 2);
  assert.equal(p.headerCols, 2);
  assert.equal(p.totalCells, 6);
  assert.equal(p.approxChars, 6);
});

test('normalizeRectangularRows pads and truncates', () => {
  var out = W.normalizeRectangularRows([['a', 'b', 'c'], ['x']], 3);
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows[1], ['x', '', '']);
  assert.equal(out.adjustedRowCount, 1);
});

test('one data row', () => {
  assert.equal(W.bodySetValuesNumRows(1), 1);
});
