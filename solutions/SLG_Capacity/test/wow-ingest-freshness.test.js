const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..', '..', '..');
const CAP_SRC = path.join(REPO, 'solutions', 'SLG_Capacity', 'src');

/**
 * @return {Object} GAS sandbox with Constants + Util + Ingest + Api freshness helpers
 */
function loadCapacityFreshnessSandbox() {
  const sheets = {};
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
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null
      })
    },
    DriveApp: {
      getFolderById: () => ({ getFilesByType: () => ({ hasNext: () => false }) })
    },
    SpreadsheetApp: {
      flush: () => {},
      getActiveSpreadsheet: () => sandbox._plannerSs,
      getActive: () => sandbox._plannerSs,
      openById: (id) => sandbox._handoffById[id]
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const pad = (n) => (n < 10 ? '0' : '') + n;
        if (fmt === 'yyyy-MM-dd') {
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        }
        return String(d);
      }
    },
    Session: { getActiveUser: () => ({ getEmail: () => 'test@example.com' }) },
    Drive: {},
    _plannerSs: null,
    _handoffById: {},
    _makeSs: function (id, label) {
      const ss = {
        _id: id,
        _label: label,
        _tabs: sheets,
        getId: () => id,
        getSheetByName: (name) => {
          const key = id + '::' + name;
          if (!sheets[key]) {
            sheets[key] = { name, rows: [[]] };
            sheets[key].api = makeSheetApi_(sheets[key]);
          }
          return sheets[key].api;
        },
        insertSheet: (name) => ss.getSheetByName(name)
      };
      return ss;
    }
  };

  function makeSheetApi_(sh) {
    return {
      getName: () => sh.name,
      getDataRange: () => ({
        getValues: () => sh.rows
      }),
      getLastRow: () => sh.rows.length,
      getLastColumn: () => (sh.rows[0] ? sh.rows[0].length : 0),
      clear: () => { sh.rows = []; },
      clearContent: () => {
        if (sh.rows.length > 1) sh.rows = [sh.rows[0]];
      },
      appendRow: (row) => {
        if (!sh.rows.length) sh.rows.push([]);
        sh.rows.push(row);
      },
      getRange: (r, c, nr, nc) => {
        const range = {
          getValues: () => {
            if (!sh.rows.length) return [[]];
            if (r === 1 && nr === 1) return [sh.rows[0] || []];
            return sh.rows;
          },
          setValues: (vals) => {
            if (r === 1 && nr === 1) {
              sh.rows[0] = vals[0];
            } else {
              sh.rows = vals;
            }
            return range;
          },
          setNumberFormat: () => range,
          setFontWeight: () => range,
          clearContent: () => {
            if (sh.rows.length > 1) sh.rows = [sh.rows[0]];
            return range;
          }
        };
        return range;
      },
      setFrozenRows: () => {}
    };
  }

  const ctx = vm.createContext(sandbox);

  ['Constants.js', 'Util.js', 'Ingest.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(CAP_SRC, f), 'utf8'), ctx, { filename: f });
  });

  vm.runInContext(`
    function _toIso_(d) {
      return d instanceof Date ? d.toISOString() : String(d);
    }
    function _dataFreshnessEvent_(when, detail) {
      return { when: _toIso_(when instanceof Date ? when : new Date(when)), detail: String(detail || '') };
    }
    function _dataFreshnessNullFeed_() {
      return { lastSuccess: null, lastFailure: null };
    }
    function _isWithin7Days_(when) {
      if (!when) return false;
      var d = when instanceof Date ? when : new Date(when);
      return (Date.now() - d.getTime()) <= 7 * 24 * 60 * 60 * 1000;
    }
    function _dataFreshnessWowIngest_() {
      var out = _dataFreshnessNullFeed_();
      var rows = (readTable_(REFRESH_LOG) || []).filter(function (r) {
        return String(r.source || '').trim() === 'staff';
      }).sort(function (a, b) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      rows.some(function (r) {
        if (Number(r.rows_out) > 0) {
          out.lastSuccess = _dataFreshnessEvent_(r.timestamp,
            String(Number(r.rows_out) || 0) + ' rows');
          return true;
        }
        return false;
      });
      rows.some(function (r) {
        var rowsOut = Number(r.rows_out) || 0;
        var warnings = String(r.warnings || '').trim();
        if (rowsOut === 0 || warnings) {
          if (_isWithin7Days_(r.timestamp)) {
            out.lastFailure = _dataFreshnessEvent_(r.timestamp,
              warnings || 'ingest produced 0 rows');
            return true;
          }
        }
        return false;
      });
      return out;
    }
  `, ctx, { filename: 'freshness-stub.js' });

  return sandbox;
}

function seedNormalizationLog_(ss, entries) {
  const sh = ss.getSheetByName('Normalization_Log');
  sh.getRange(1, 1, 1, 7).setValues([[
    'timestamp', 'source', 'rows_in', 'rows_out', 'weeks_detected', 'user', 'warnings'
  ]]);
  entries.forEach((e) => {
    sh.appendRow([
      e.timestamp,
      e.source,
      e.rows_in,
      e.rows_out,
      e.weeks_detected,
      e.user || '',
      e.warnings || ''
    ]);
  });
}

test('logRefresh_ with optSs writes Normalization_Log on planner, not handoff', () => {
  const g = loadCapacityFreshnessSandbox();
  g._plannerSs = g._makeSs('planner', 'planner');
  g._handoffById.handoff1 = g._makeSs('handoff1', 'handoff');

  g.logRefresh_('staff', 10, 500, 12, '', g._plannerSs);

  const plannerLog = g._plannerSs.getSheetByName('Normalization_Log');
  const handoffLog = g._handoffById.handoff1.getSheetByName('Normalization_Log');
  const plannerData = plannerLog.getDataRange().getValues().filter(function (r) {
    return r.some(function (c) { return c !== '' && c !== null && c !== undefined; });
  });
  const handoffData = handoffLog.getDataRange().getValues().filter(function (r) {
    return r.some(function (c) { return c !== '' && c !== null && c !== undefined; });
  });
  assert.equal(plannerData.length, 2);
  assert.equal(handoffData.length, 0);
});

test('_dataFreshnessWowIngest_ uses latest staff row with rows_out > 0', () => {
  const g = loadCapacityFreshnessSandbox();
  g._plannerSs = g._makeSs('planner', 'planner');
  seedNormalizationLog_(g._plannerSs, [
    {
      timestamp: new Date('2026-09-30T12:00:00Z'),
      source: 'staff',
      rows_in: 100,
      rows_out: 4000,
      weeks_detected: 10
    },
    {
      timestamp: new Date('2026-10-12T15:00:00Z'),
      source: 'staff',
      rows_in: 0,
      rows_out: 0,
      weeks_detected: 0,
      warnings: 'preflight failed'
    }
  ]);

  const origRead = g.readTable_;
  g.readTable_ = function (name, optSs) {
    return origRead.call(g, name, g._plannerSs);
  };

  const fresh = g._dataFreshnessWowIngest_();
  assert.ok(fresh.lastSuccess);
  assert.equal(new Date(fresh.lastSuccess.when).toISOString(), new Date('2026-09-30T12:00:00Z').toISOString());
  assert.match(fresh.lastSuccess.detail, /4000/);
});

test('writeConsolidatedWorkbook_ pins destSs so logRefresh lands on planner when getActive is handoff', () => {
  const g = loadCapacityFreshnessSandbox();
  g._plannerSs = g._makeSs('planner', 'planner');
  const handoff = g._makeSs('handoff1', 'handoff');
  g.SpreadsheetApp.getActiveSpreadsheet = () => handoff;
  g.SpreadsheetApp.getActive = () => handoff;

  const weekHdr = '10/17/2026';
  const forecast = [
    ['Employee ID', 'Worker', 'Project Role', 'Account', 'Region - Worker', "Worker's Manager", 'Project',
      'Customer Segment Practice', 'Specialty Practice', 'Job Profile', 'Project Role Category',
      'Resource Type', 'Engagement Manager', 'Customer Projects',
      'Internal Projects (Excludes Education)', 'Education Projects', weekHdr],
    ['1', 'Alice', 'Role', 'Acct', 'Government', 'Mgr', 'Proj', 'Seg', 'Spec', 'JP', 'Cat', 'Type',
      'EM', 'Y', '', '', 8]
  ];
  const data = {
    Forecast_Staged: forecast,
    Actuals_Current_Normalized: [
      ['employee_id', 'resource_name', 'week_start', 'actual_icp_hours', 'project', 'project_role_category']
    ],
    Utilization_Normalized: [
      ['employee_id', 'resource_name', 'fiscal_quarter', 'qtd_actual_icp', 'qtd_icp_plus_forecast', 'target_hours']
    ],
    History_Normalized: [
      ['employee_id', 'resource_name', 'fiscal_quarter', 'icp_hours', 'non_icp_hours',
        'workday_region_as_of_date_worked', 'specialty_practice', 'sub_specialty_practice']
    ]
  };

  g.writeConsolidatedWorkbook_(data, [], g._plannerSs);

  const plannerLog = g._plannerSs.getSheetByName('Normalization_Log');
  const handoffLog = handoff.getSheetByName('Normalization_Log');
  const plannerRows = plannerLog.getDataRange().getValues().filter(function (r) {
    return r.some(function (c) { return c !== '' && c !== null && c !== undefined; });
  });
  const handoffRows = handoffLog.getDataRange().getValues().filter(function (r) {
    return r.some(function (c) { return c !== '' && c !== null && c !== undefined; });
  });
  assert.ok(plannerRows.length >= 2, 'Normalization_Log on planner');
  assert.equal(handoffRows.length, 0, 'handoff must not receive freshness row');
  assert.equal(String(plannerRows[plannerRows.length - 1][1]), 'staff');
  assert.ok(Number(plannerRows[plannerRows.length - 1][3]) > 0);
});
