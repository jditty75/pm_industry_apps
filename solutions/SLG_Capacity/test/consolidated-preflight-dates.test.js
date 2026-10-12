const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAP_SRC = path.join(__dirname, '..', 'src');

/**
 * @return {Object}
 */
function loadIngestSandbox() {
  const files = ['Constants.js', 'Util.js', 'Ingest.js'];
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    Error,
    RegExp,
    Logger: { log: () => {} },
    SpreadsheetApp: {},
    DriveApp: {},
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const pad = (n) => (n < 10 ? '0' : '') + n;
        if (fmt === 'yyyy-MM-dd') {
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        }
        return String(d);
      }
    },
    Session: { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) }
  };
  vm.createContext(sandbox);
  files.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(CAP_SRC, f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox;
}

test('getActualsPeriodRange_ normalizes native Date week_key cells', () => {
  const g = loadIngestSandbox();
  const may2 = new Date(2026, 4, 2);
  const sep26 = new Date(2026, 8, 26);
  const values = [
    [
      'employee_id', 'resource_name', 'week_start', 'week_key', 'project',
      'project_role_category', 'actual_icp_hours', 'source_row'
    ],
    ['1', 'Alice', may2, may2, 'P1', 'Role', 8, 2],
    ['1', 'Alice', sep26, sep26, 'P1', 'Role', 4, 3]
  ];
  const range = g.getActualsPeriodRange_(values);
  assert.equal(range.min, '2026-05-02');
  assert.equal(range.max, '2026-09-26');
});

test('validateConsolidatedWeekKeys_ accepts week_key as native Date matching week_start', () => {
  const g = loadIngestSandbox();
  const ws = new Date(2026, 8, 26);
  const values = [
    [
      'employee_id', 'resource_name', 'week_start', 'week_key', 'project',
      'project_role_category', 'actual_icp_hours', 'source_row'
    ],
    ['1', 'Alice', ws, ws, 'P1', 'Role', 8, 2]
  ];
  const checks = [];
  g.validateConsolidatedWeekKeys_(values, 'Actuals_Current_Normalized', function (name, passed, detail) {
    checks.push({ name, passed, detail });
  });
  const weekKeyCheck = checks.find((c) => c.name === 'week_key:Actuals_Current_Normalized');
  assert.ok(weekKeyCheck, 'expected week_key check');
  assert.equal(weekKeyCheck.passed, true, weekKeyCheck.detail);
});
