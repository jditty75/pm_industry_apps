const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

function loadStore() {
  const sandbox = {
    Logger: { log: function () {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(SRC, 'CoreDeploymentSignalStore.js'), 'utf8'),
    sandbox);
  return sandbox.CoreDeploymentSignalStore;
}

function createMockWorkbook() {
  const sheets = {};
  const calls = {
    getLastColumn: 0,
    getRangeReads: [],
    setValues: []
  };

  function cellKey(r, c) {
    return r + ',' + c;
  }

  function createSheet(name) {
    const cells = {};
    let created = false;
    return {
      _cells: cells,
      _createdFlag: function () { return created; },
      _markCreated: function () { created = true; },
      getName: function () { return name; },
      getParent: function () { return workbook; },
      getLastRow: function () {
        var max = 0;
        Object.keys(cells).forEach(function (k) {
          var r = parseInt(k.split(',')[0], 10);
          if (r > max) max = r;
        });
        return max;
      },
      getLastColumn: function () {
        calls.getLastColumn++;
        return 8000;
      },
      getRange: function (r1, c1, r2, c2) {
        calls.getRangeReads.push({ r1: r1, c1: c1, r2: r2, c2: c2 });
        return {
          getValues: function () {
            var rows = [];
            for (var r = r1; r <= r2; r++) {
              var row = [];
              for (var c = c1; c <= c2; c++) {
                row.push(cells[cellKey(r, c)] || '');
              }
              rows.push(row);
            }
            return rows;
          },
          setValues: function (matrix) {
            calls.setValues.push({
              sheet: name,
              r1: r1,
              c1: c1,
              matrix: matrix
            });
            matrix.forEach(function (row, ri) {
              row.forEach(function (val, ci) {
                cells[cellKey(r1 + ri, c1 + ci)] = val;
              });
            });
          }
        };
      }
    };
  }

  const workbook = {
    calls: calls,
    sheets: sheets,
    getSheetByName: function (n) { return sheets[n] || null; },
    insertSheet: function (n) {
      var sh = createSheet(n);
      sh._markCreated();
      sheets[n] = sh;
      return sh;
    }
  };
  return workbook;
}

const Store = loadStore();
const CURRENT = Store.currentHeaders();
const HISTORY = Store.historyHeaders();
const RUNS = Store.runHeaders();

test('clean initialization creates all three sheets with one header setValues each', () => {
  var wb = createMockWorkbook();
  Store.ensureSheetHeaders(wb, 'Deployment_Signals', CURRENT);
  Store.ensureSheetHeaders(wb, 'Deployment_Signal_History', HISTORY);
  Store.ensureSheetHeaders(wb, 'Deployment_Signal_Runs', RUNS);
  assert.equal(Object.keys(wb.sheets).length, 3);
  assert.equal(wb.calls.getLastColumn, 0);
  assert.equal(wb.calls.setValues.length, 3);
  wb.calls.setValues.forEach(function (w) {
    assert.equal(w.r1, 1);
    assert.equal(w.c1, 1);
    assert.equal(w.matrix.length, 1);
  });
});

test('second run is no-op when canonical headers already present', () => {
  var wb = createMockWorkbook();
  Store.ensureSheetHeaders(wb, 'Deployment_Signals', CURRENT);
  var setsBefore = wb.calls.setValues.length;
  Store.ensureSheetHeaders(wb, 'Deployment_Signals', CURRENT);
  assert.equal(wb.calls.setValues.length, setsBefore);
  assert.equal(wb.calls.getLastColumn, 0);
});

test('partial empty header row is rewritten to canonical schema', () => {
  var wb = createMockWorkbook();
  var sh = wb.insertSheet('Deployment_Signals');
  sh.getRange(1, 1, 1, 3).setValues([['schema_version', 'signal_id', '']]);
  Store.ensureSheetHeaders(wb, 'Deployment_Signals', CURRENT);
  var headerRead = wb.calls.getRangeReads.filter(function (r) {
    return r.r2 === 1 && r.c2 === CURRENT.length;
  });
  assert.ok(headerRead.length >= 1);
  var lastWrite = wb.calls.setValues[wb.calls.setValues.length - 1];
  assert.deepEqual(lastWrite.matrix[0], CURRENT);
});

test('existing correct sheet is preserved (no header rewrite)', () => {
  var wb = createMockWorkbook();
  Store.ensureSheetHeaders(wb, 'Deployment_Signal_Runs', RUNS);
  wb.calls.setValues.length = 0;
  Store.ensureSheetHeaders(wb, 'Deployment_Signal_Runs', RUNS);
  assert.equal(wb.calls.setValues.length, 0);
});

test('populated incompatible schema rejects without overwriting body', () => {
  var wb = createMockWorkbook();
  var sh = wb.insertSheet('Deployment_Signals');
  sh.getRange(1, 1, 1, CURRENT.length).setValues([CURRENT.map(function (h, i) {
    return i === 0 ? 'wrong_version' : h;
  })]);
  sh.getRange(2, 1, 1, 2).setValues([['x', 'y']]);
  assert.throws(function () {
    Store.ensureSheetHeaders(wb, 'Deployment_Signals', CURRENT);
  }, /incompatible headers with existing signal data/i);
});

test('header reads are bounded to schema width (never getLastColumn)', () => {
  var wb = createMockWorkbook();
  var sh = wb.insertSheet('Deployment_Signals');
  sh.getRange(1, 1, 1, 2).setValues([['a', 'b']]);
  Store.ensureSheetHeaders(wb, 'Deployment_Signals', CURRENT);
  assert.equal(wb.calls.getLastColumn, 0);
  wb.calls.getRangeReads.forEach(function (r) {
    assert.ok(r.c2 <= CURRENT.length);
  });
});

test('workbook object is reused across three-sheet init (no openById)', () => {
  var wb = createMockWorkbook();
  var openCount = 0;
  var proxy = {
    getSheetByName: function (n) { openCount++; return wb.getSheetByName(n); },
    insertSheet: function (n) { openCount++; return wb.insertSheet(n); }
  };
  Store.ensureSheetHeaders(proxy, 'Deployment_Signals', CURRENT);
  Store.ensureSheetHeaders(proxy, 'Deployment_Signal_History', HISTORY);
  Store.ensureSheetHeaders(proxy, 'Deployment_Signal_Runs', RUNS);
  assert.ok(openCount >= 3);
  assert.equal(wb.calls.getLastColumn, 0);
});
