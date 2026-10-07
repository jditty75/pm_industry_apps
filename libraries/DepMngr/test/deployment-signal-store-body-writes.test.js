const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

/**
 * Mock sheet using GAS getRange(row, column, numRows, numColumns) semantics.
 */
function createGasSheet(name) {
  const cells = {};
  const calls = { setValues: [], getRange: [] };

  function cellKey(r, c) {
    return r + ',' + c;
  }

  return {
    calls: calls,
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
    getLastColumn: function () { return 25; },
    getRange: function (row, column, numRows, numColumns) {
      calls.getRange.push({
        row: row, column: column, numRows: numRows, numColumns: numColumns
      });
      return {
        getValues: function () {
          var out = [];
          for (var r = row; r < row + numRows; r++) {
            var line = [];
            for (var c = column; c < column + numColumns; c++) {
              line.push(cells[cellKey(r, c)] || '');
            }
            out.push(line);
          }
          return out;
        },
        setValues: function (matrix) {
          assert.equal(matrix.length, numRows,
            'setValues row count must match getRange numRows');
          matrix.forEach(function (line, ri) {
            assert.equal(line.length, numColumns,
              'setValues col count must match getRange numColumns');
          });
          calls.setValues.push({
            row: row, column: column, numRows: numRows, numColumns: numColumns,
            matrix: matrix
          });
          matrix.forEach(function (line, ri) {
            line.forEach(function (val, ci) {
              cells[cellKey(row + ri, column + ci)] = val;
            });
          });
        }
      };
    },
    _cells: cells
  };
}

let workbook;

function loadStore() {
  const sandbox = {
    Logger: { log: function () {} },
    CoreDeploymentTrajectory: {
      _writeSheet_: function (ss, sheetName, headers, dataRows) {
        var sh = ss.getSheetByName(sheetName);
        if (!sh) throw new Error('missing sheet ' + sheetName);
        if (!dataRows || !dataRows.length) return;
        sh.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return workbook; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(SRC, 'CoreDeploymentSignalStore.js'), 'utf8'),
    sandbox);
  return sandbox.CoreDeploymentSignalStore;
}

const Store = loadStore();
const CURRENT = Store.currentHeaders();
const RUNS = Store.runHeaders();

test('appendBodyRows: 1-row body write uses numRows=1', () => {
  workbook = {
    getSheetByName: function (n) { return workbook.sheets[n]; },
    insertSheet: function (n) {
      workbook.sheets[n] = createGasSheet(n);
      return workbook.sheets[n];
    },
    sheets: {}
  };
  var sh = workbook.insertSheet('Deployment_Signal_History');
  Store.ensureSheetHeaders(workbook, 'Deployment_Signal_History', Store.historyHeaders());
  Store.appendBodyRows(sh, Store.historyHeaders(), [{ signal_run_id: 'R1' }]);
  var w = sh.calls.setValues[sh.calls.setValues.length - 1];
  assert.equal(w.numRows, 1);
  assert.equal(w.matrix.length, 1);
});

test('appendBodyRows: 16-row history append matches range dimensions', () => {
  workbook = {
    getSheetByName: function (n) { return workbook.sheets[n]; },
    insertSheet: function (n) {
      workbook.sheets[n] = createGasSheet(n);
      return workbook.sheets[n];
    },
    sheets: {}
  };
  var sh = workbook.insertSheet('Deployment_Signal_History');
  Store.ensureSheetHeaders(workbook, 'Deployment_Signal_History', Store.historyHeaders());
  var rows = [];
  for (var i = 0; i < 16; i++) {
    rows.push({ signal_run_id: 'SLG-2026-10-05', deployment_id: 'D' + i });
  }
  Store.appendBodyRows(sh, Store.historyHeaders(), rows);
  var w = sh.calls.setValues[sh.calls.setValues.length - 1];
  assert.equal(w.numRows, 16);
  assert.equal(w.matrix.length, 16);
  assert.equal(w.row, 2);
});

test('appendBodyRows: N-row append at tail', () => {
  workbook = {
    getSheetByName: function (n) { return workbook.sheets[n]; },
    insertSheet: function (n) {
      workbook.sheets[n] = createGasSheet(n);
      return workbook.sheets[n];
    },
    sheets: {}
  };
  var sh = workbook.insertSheet('H');
  Store.ensureSheetHeaders(workbook, 'H', Store.historyHeaders());
  Store.appendBodyRows(sh, Store.historyHeaders(), [{ signal_run_id: 'a' }]);
  Store.appendBodyRows(sh, Store.historyHeaders(), [
    { signal_run_id: 'b' },
    { signal_run_id: 'c' }
  ]);
  var w = sh.calls.setValues[sh.calls.setValues.length - 1];
  assert.equal(w.row, 3);
  assert.equal(w.numRows, 2);
});

test('appendBodyRows: zero rows does not call setValues', () => {
  var sh = createGasSheet('X');
  Store.appendBodyRows(sh, CURRENT, []);
  assert.equal(sh.calls.setValues.length, 0);
});

test('updateRunRowBySignalRunId: single run-row patch uses numRows=1', () => {
  var sh = createGasSheet('Deployment_Signal_Runs');
  Store.ensureSheetHeaders(
    { getSheetByName: function () { return sh; }, insertSheet: function () { return sh; } },
    'Deployment_Signal_Runs',
    RUNS);
  Store.appendBodyRows(sh, RUNS, [{
    signal_run_id: 'SLG-2026-10-05',
    run_status: 'SUBMITTED',
    persistence_status: 'SUBMITTED'
  }]);
  sh.calls.setValues.length = 0;
  var ok = Store.updateRunRowBySignalRunId(sh, RUNS, 'SLG-2026-10-05', {
    run_status: 'FAILED',
    error_message: 'original error'
  });
  assert.equal(ok, true);
  assert.equal(sh.calls.setValues.length, 1);
  assert.equal(sh.calls.setValues[0].numRows, 1);
  assert.equal(sh.calls.setValues[0].matrix.length, 1);
});

test('replaceCurrentBody: 16-row replacement matches numRows', () => {
  workbook = {
    getSheetByName: function (n) { return workbook.sheets[n]; },
    insertSheet: function (n) {
      workbook.sheets[n] = createGasSheet(n);
      return workbook.sheets[n];
    },
    sheets: {}
  };
  var sh = workbook.insertSheet('Deployment_Signals');
  Store.ensureSheetHeaders(workbook, 'Deployment_Signals', CURRENT);
  var body = [];
  for (var j = 0; j < 16; j++) {
    body.push({ signal_run_id: 'SLG-2026-10-05', deployment_id: 'D' + j, signal_status: 'ACTIVE' });
  }
  Store.replaceCurrentBody(sh, CURRENT, body);
  var w = sh.calls.setValues[sh.calls.setValues.length - 1];
  assert.equal(w.numRows, 16);
  assert.equal(w.row, 2);
});

function loadPersistencePlatform(wb) {
  const crypto = require('crypto');
  const sandbox = {
    CoreConfig: {
      withDefaults: function (cfg) {
        return Object.assign({
          appId: 'SLG',
          deploymentSignal: {
            enabled: true,
            persistenceEnabled: true,
            signalsSheetName: 'Deployment_Signals',
            signalHistorySheetName: 'Deployment_Signal_History',
            signalRunsSheetName: 'Deployment_Signal_Runs'
          },
          salesforce: { statusValues: { active: 'Active' } }
        }, cfg || {});
      }
    },
    CoreData: {
      canonicalDeploymentId: function (id) { return String(id || '').trim(); },
      readSfdcDeploymentsRaw: function () { return []; }
    },
    Logger: { log: function () {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: function (algo, str) {
        return crypto.createHash('sha256').update(str).digest();
      },
      base64EncodeWebSafe: function (bytes) {
        return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      }
    },
    CoreDeploymentTrajectory: {
      _writeSheet_: function (ss, sheetName, headers, dataRows) {
        var sh = ss.getSheetByName(sheetName);
        if (!dataRows || !dataRows.length) return;
        sh.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
      }
    },
    CoreNotify: {
      applyDeploymentSignalPostCompleteHandoff: function () {
        return { email_status: 'NOT_REQUIRED', payload: null, sent: false };
      }
    },
    SpreadsheetApp: { getActiveSpreadsheet: function () { return wb; } },
    LockService: {
      getDocumentLock: function () {
        return { tryLock: function () { return true; }, releaseLock: function () {} };
      }
    }
  };
  vm.createContext(sandbox);
  [
    'CoreDeploymentSignals.js',
    'CoreDeploymentSignalLifecycle.js',
    'CoreDeploymentSignalStore.js',
    'CoreDeploymentSignalPersistence.js'
  ].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox);
  });
  return sandbox;
}

test('sheet processor: 16 submitted signals complete once; retry does not duplicate history', () => {
  workbook = {
    getSheetByName: function (n) { return workbook.sheets[n]; },
    insertSheet: function (n) {
      workbook.sheets[n] = createGasSheet(n);
      return workbook.sheets[n];
    },
    sheets: {}
  };
  var P = loadPersistencePlatform(workbook);
  var CFG = P.CoreConfig.withDefaults({});
  var runId = 'SLG-2026-10-05';
  var valid = {};
  var signalRows = [];
  for (var i = 0; i < 16; i++) {
    var dep = 'DEP_SHEET_' + i;
    valid[dep] = true;
    signalRows.push({
      schema_version: 'deployment-signal-v1',
      signal_id: '',
      deployment_id: dep,
      signal_run_id: runId,
      signal_as_of: '2026-10-05',
      lifecycle_state: '',
      attention: 'WATCH',
      signal_type: 'COMPOUND',
      observation: 'Obs',
      interpretation: 'Interp',
      why_it_matters: 'Why',
      leadership_question: 'Q?',
      confidence: 'MEDIUM',
      evidence_limitations: 'Lim',
      current_health: 'Yellow',
      stage: 'Build',
      signal_status: 'SUBMITTED',
      context_ref: '',
      source_reasoning_run_ref: 'sana-ref',
      prior_signal_id: '',
      normalization_version: '',
      reasoning_prose_original: 'prose',
      first_active_at: '',
      last_updated_at: '',
      persisted_at: ''
    });
  }
  var runRow = {
    signal_run_id: runId,
    signal_as_of: '2026-10-05',
    started_at: '2026-10-05T07:00:00Z',
    received_at: '2026-10-05T07:00:00Z',
    persisted_at: '',
    deployments_evaluated: '16',
    signals_proposed: '16',
    signals_persisted: 0,
    no_signal_count: '0',
    lifecycle_new_count: 0,
    lifecycle_continuing_count: 0,
    lifecycle_escalated_count: 0,
    lifecycle_de_escalated_count: 0,
    lifecycle_resolved_count: 0,
    run_status: 'SUBMITTED',
    persistence_status: 'SUBMITTED',
    context_schema_version: 'deployment-signal-context-v1',
    signal_schema_version: 'deployment-signal-v1',
    normalization_version: '',
    agent_reference: 'sana',
    source_reasoning_run_ref: 'sana-ref',
    error_message: '',
    email_status: ''
  };
  P.CoreDeploymentSignalPersistence.initializeSignalSheets(CFG);
  P.CoreDeploymentSignalStore.appendBodyRows(
    workbook.sheets.Deployment_Signal_Runs, RUNS, [runRow]);
  P.CoreDeploymentSignalStore.appendBodyRows(
    workbook.sheets.Deployment_Signals, CURRENT, signalRows);
  var res = P.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { validDeploymentIds: valid });
  assert.equal(res.ok, true, res.error || JSON.stringify(res));
  var hist = P.CoreDeploymentSignalStore.readDataRows(
    workbook.sheets.Deployment_Signal_History, Store.historyHeaders());
  assert.equal(hist.length, 16);
  var res2 = P.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { validDeploymentIds: valid });
  assert.equal(res2.outcome, 'NO_SUBMITTED_RUNS');
  var hist2 = P.CoreDeploymentSignalStore.readDataRows(
    workbook.sheets.Deployment_Signal_History, Store.historyHeaders());
  assert.equal(hist2.length, 16);
});

test('readDataRows returns all body rows after 16-row write', () => {
  workbook = {
    getSheetByName: function (n) { return workbook.sheets[n]; },
    insertSheet: function (n) {
      workbook.sheets[n] = createGasSheet(n);
      return workbook.sheets[n];
    },
    sheets: {}
  };
  var sh = workbook.insertSheet('Deployment_Signals');
  Store.ensureSheetHeaders(workbook, 'Deployment_Signals', CURRENT);
  var body = [];
  for (var k = 0; k < 16; k++) {
    body.push({
      signal_run_id: 'SLG-2026-10-05',
      deployment_id: 'DEP_' + k,
      signal_status: 'SUBMITTED'
    });
  }
  Store.appendBodyRows(sh, CURRENT, body);
  var read = Store.readDataRows(sh, CURRENT);
  assert.equal(read.length, 16);
});
