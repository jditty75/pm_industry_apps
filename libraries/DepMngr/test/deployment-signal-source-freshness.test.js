const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function loadModules() {
  var props = { data: {} };
  var sandbox = {
    CoreConfig: {
      withDefaults: function (cfg) {
        return Object.assign({
          appId: 'SLG',
          freshness: { logSheet: 'Auto Refresh Execution Log' },
          deploymentSignal: {
            enabled: true,
            persistenceEnabled: true,
            signalEvidenceSourceSheets: [
              'SFDC_Deployments',
              'SFDC_DHP'
            ]
          }
        }, cfg || {});
      }
    },
    CoreDeploymentSignalPersistence: {
      isEnabled: function (cfg) {
        return cfg.appId === 'SLG' &&
          cfg.deploymentSignal &&
          cfg.deploymentSignal.enabled === true &&
          cfg.deploymentSignal.persistenceEnabled === true;
      }
    },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return props.data[k] || null; },
          setProperty: function (k, v) { props.data[k] = v; }
        };
      }
    },
    SpreadsheetApp: {},
    Logger: { log: function () {} },
    propsStore: props
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreFreshnessMonitor.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreDeploymentTrajectory.js'), 'utf8'), sandbox);
  sandbox.CoreDeploymentTrajectory.refresh = function () {
    return { trajectory_built_at: '2026-10-06T12:00:00.000Z' };
  };
  sandbox._propsApi = {
    getProperty: function (k) { return props.data[k] || null; },
    setProperty: function (k, v) { props.data[k] = v; }
  };
  return sandbox;
}

function mockLogSheet(rows) {
  return {
    getLastRow: function () { return rows.length; },
    getLastColumn: function () { return rows[0] ? rows[0].length : 0; },
    getRange: function (r1, c1, r2, c2) {
      if (r1 === 1 && r2 === 1) {
        return { getValues: function () { return [rows[0]]; } };
      }
      return { getValues: function () { return rows.slice(1); } };
    }
  };
}

test('Auto Refresh Execution Log sheet name default', () => {
  var S = loadModules();
  assert.equal(S.CoreFreshnessMonitor.DEFAULT_LOG_SHEET,
    'Auto Refresh Execution Log');
});

test('latest SUCCESS per source; failed refresh ignored', () => {
  var S = loadModules();
  var ss = {
    getSheetByName: function () {
      return mockLogSheet([
        ['Refresh Time', 'Sheet', 'Operation', 'Status', 'User'],
        [new Date('2026-10-06T10:00:00Z'), 'SFDC_Deployments', 'Refresh', 'Failed', 'x'],
        [new Date('2026-10-06T11:00:00Z'), 'SFDC_Deployments', 'Refresh', 'Success', 'x'],
        [new Date('2026-10-06T09:00:00Z'), 'SFDC_Deployments', 'Refresh', 'Success', 'x']
      ]);
    }
  };
  var state = S.CoreFreshnessMonitor.getLatestSuccessRefreshBySheet(ss, {});
  var dep = state.latestSuccessBySheet['SFDC_Deployments'];
  assert.ok(dep);
  assert.equal(dep.refreshIso, new Date('2026-10-06T11:00:00Z').toISOString());
});

test('missing required source → SOURCE_NOT_READY via evaluate', () => {
  var S = loadModules();
  var ss = {
    getSheetByName: function (name) {
      if (name === 'Auto Refresh Execution Log') {
        return mockLogSheet([
          ['Refresh Time', 'Sheet', 'Status'],
          [new Date('2026-10-06T11:00:00Z'), 'SFDC_Deployments', 'Success']
        ]);
      }
      return null;
    }
  };
  var cfg = S.CoreConfig.withDefaults({});
  var decision = S.CoreDeploymentTrajectory.evaluateSignalEvidenceRefreshDecision(cfg, ss, {
    properties: S._propsApi
  });
  assert.equal(decision.outcome, 'SIGNAL_REFRESH_BLOCKED');
  assert.equal(decision.source_not_ready.length, 1);
  assert.equal(decision.source_not_ready[0], 'SFDC_DHP');
});

test('NO_OP when sources unchanged; rebuild when advanced', () => {
  var S = loadModules();
  var ss = {
    getSheetByName: function () {
      return mockLogSheet([
        ['Refresh Time', 'Sheet', 'Status'],
        [new Date('2026-10-06T11:00:00Z'), 'SFDC_Deployments', 'Success'],
        [new Date('2026-10-06T11:00:00Z'), 'SFDC_DHP', 'Success']
      ]);
    }
  };
  var cfg = S.CoreConfig.withDefaults({});
  S.CoreDeploymentTrajectory.setConsumedSignalSourceMarkers(cfg, {
    'SFDC_Deployments': new Date('2026-10-06T11:00:00Z').toISOString(),
    'SFDC_DHP': new Date('2026-10-06T11:00:00Z').toISOString()
  }, { properties: S._propsApi });
  var noop = S.CoreDeploymentTrajectory.evaluateSignalEvidenceRefreshDecision(cfg, ss, {
    properties: S._propsApi
  });
  assert.equal(noop.outcome, 'SIGNAL_REFRESH_NO_OP');

  var rebuild = S.CoreDeploymentTrajectory.evaluateSignalEvidenceRefreshDecision(cfg, {
    getSheetByName: function () {
      return mockLogSheet([
        ['Refresh Time', 'Sheet', 'Status'],
        [new Date('2026-10-06T12:00:00Z'), 'SFDC_Deployments', 'Success'],
        [new Date('2026-10-06T11:00:00Z'), 'SFDC_DHP', 'Success']
      ]);
    }
  }, { properties: S._propsApi });
  assert.equal(rebuild.outcome, 'SIGNAL_REFRESH_REBUILD');
  assert.equal(rebuild.sources_changed.length, 1);
  assert.equal(rebuild.sources_changed[0], 'SFDC_Deployments');
});

test('markers updated only after successful refresh', () => {
  var S = loadModules();
  var ss = {
    getSheetByName: function () {
      return mockLogSheet([
        ['Refresh Time', 'Sheet', 'Status'],
        [new Date('2026-10-06T13:00:00Z'), 'SFDC_Deployments', 'Success'],
        [new Date('2026-10-06T13:00:00Z'), 'SFDC_DHP', 'Success']
      ]);
    }
  };
  var cfg = S.CoreConfig.withDefaults({});
  var res = S.CoreDeploymentTrajectory.refreshSignalEvidenceIfNeeded(cfg, {
    spreadsheet: ss,
    properties: S._propsApi
  });
  assert.equal(res.outcome, 'SIGNAL_REFRESH_COMPLETE');
  var markers = S.CoreDeploymentTrajectory.getConsumedSignalSourceMarkers(cfg, {
    properties: S._propsApi
  });
  assert.ok(markers['SFDC_Deployments']);
  assert.ok(markers['SFDC_DHP']);
});

test('non-SLG apps disabled for evidence refresh', () => {
  var S = loadModules();
  var res = S.CoreDeploymentTrajectory.refreshSignalEvidenceIfNeeded(
    S.CoreConfig.withDefaults({ appId: 'HC' }), {});
  assert.equal(res.outcome, 'SIGNAL_REFRESH_SKIPPED');
});
