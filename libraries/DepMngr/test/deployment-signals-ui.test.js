const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function loadPlatform() {
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
          ui: { signalsTab: { enabled: true } }
        }, cfg || {});
      },
      isDeploymentSignalsUiEnabled: function (appConfig) {
        const cfg = sandbox.CoreConfig.withDefaults(appConfig || {});
        return sandbox.CoreDeploymentSignalPersistence.isEnabled(cfg) &&
          cfg.ui.signalsTab.enabled !== false;
      }
    },
    CoreData: {
      canonicalDeploymentId: function (id) {
        return String(id || '').trim();
      },
      getAllDeploymentsForUI: function () {
        return {
          rows: [
            {
              deploymentId: 'DEP_A',
              deploymentName: 'Preview Deployment',
              accountName: 'Example County'
            }
          ]
        };
      }
    },
    CoreFreshnessMonitor: null,
    Logger: { log: function () {} },
    SpreadsheetApp: null,
    LockService: null,
    Utilities: null,
    CoreDeploymentTrajectory: { _writeSheet_: function () {} }
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

const S = loadPlatform();
const Norm = S.CoreDeploymentSignalNormalize;
const Persist = S.CoreDeploymentSignalPersistence;
const Store = S.CoreDeploymentSignalStore;

const SLG_CFG = S.CoreConfig.withDefaults({});
const HC_CFG = S.CoreConfig.withDefaults({
  appId: 'HC',
  deploymentSignal: { enabled: false, persistenceEnabled: false }
});

function baseRow(dep, lifecycle, attention) {
  return {
    schema_version: 'deployment-signal-v1',
    signal_id: 'SIG-TEST-1',
    deployment_id: dep,
    signal_run_id: 'RUN-1',
    signal_as_of: '2026-10-05',
    lifecycle_state: lifecycle,
    attention: attention,
    signal_type: 'COMPOUND',
    observation: 'Evidence fact line.',
    interpretation: 'AI interpretation line.',
    why_it_matters: 'Leadership takeaway.',
    leadership_question: 'What should we do?',
    confidence: 'MEDIUM',
    evidence_limitations: '',
    current_health: 'Yellow',
    stage: 'Test',
    signal_status: 'ACTIVE',
    first_active_at: '2026-10-05',
    last_updated_at: '2026-10-05'
  };
}

test('SLG Signals UI gate on; HC off', () => {
  assert.equal(S.CoreConfig.isDeploymentSignalsUiEnabled(SLG_CFG), true);
  assert.equal(S.CoreConfig.isDeploymentSignalsUiEnabled(HC_CFG), false);
});

test('signal type human label', () => {
  assert.equal(
    Norm.formatSignalTypeLabel('CUSTOMER_DEPENDENCY_RISK'),
    'Customer Dependency Risk'
  );
});

test('confidence presentation avoids underscore enums in label', () => {
  const c1 = Norm.formatConfidenceForUi('HIGH', 'HIGH');
  assert.equal(c1.label, 'High');
  const c2 = Norm.formatConfidenceForUi('MEDIUM_CONFIDENCE_WITH_LIMITATIONS', '');
  assert.ok(c2.label);
  assert.equal(c2.label.includes('_'), false);
});

test('landing sort prioritizes NEW and HIGH', () => {
  const sorted = Norm.sortSignalsForLanding([
    baseRow('DEP_B', 'CONTINUING', 'WATCH'),
    baseRow('DEP_A', 'NEW', 'HIGH')
  ]);
  assert.equal(sorted[0].lifecycle_state, 'NEW');
  assert.equal(sorted[0].attention, 'HIGH');
});

test('landing payload disabled for non-SLG', () => {
  const off = Persist.getDeploymentSignalsLandingForUI(HC_CFG, {}, {}, {});
  assert.equal(off.enabled, false);
});

test('landing enriches deployment names from scope index', () => {
  const store = Store.createMemoryStore();
  Store.replaceBody(
    store, 'Deployment_Signals', Store.currentHeaders(), [baseRow('DEP_A', 'NEW', 'HIGH')]);
  Store.appendRows(store, 'Deployment_Signal_Runs', Store.runHeaders(), [{
    signal_run_id: 'RUN-1',
    signal_as_of: '2026-10-05',
    run_status: 'COMPLETE',
    lifecycle_new_count: 1
  }]);
  const payload = Persist.getDeploymentSignalsLandingForUI(
    SLG_CFG, {}, {}, { store: store });
  assert.equal(payload.enabled, true);
  assert.equal(payload.signals.length, 1);
  assert.equal(payload.signals[0].account_name, 'Example County');
  assert.equal(payload.signals[0].signal_type_label, 'Compound');
});

test('history ordering ascending', () => {
  const store = Store.createMemoryStore();
  const hist = Store.historyHeaders();
  Store.appendRows(store, 'Deployment_Signal_History', hist, [
    Object.assign(baseRow('DEP_A', 'NEW', 'HIGH'), {
      history_event_at: '2026-10-01T10:00:00Z',
      history_event_type: 'APPROVED_RUN'
    }),
    Object.assign(baseRow('DEP_A', 'ESCALATED', 'HIGH'), {
      history_event_at: '2026-10-08T10:00:00Z',
      history_event_type: 'APPROVED_RUN'
    })
  ]);
  const res = Persist.getDeploymentSignalHistoryForUI(
    SLG_CFG, 'DEP_A', { store: store, limit: 10 });
  assert.equal(res.events.length, 2);
  assert.ok(res.events[0].history_event_at <= res.events[1].history_event_at);
});

test('latest completed run excludes SUBMITTED', () => {
  const store = Store.createMemoryStore();
  Store.appendRows(store, 'Deployment_Signal_Runs', Store.runHeaders(), [
    { signal_run_id: 'SUB', signal_as_of: '2026-10-09', run_status: 'SUBMITTED' },
    { signal_run_id: 'OK', signal_as_of: '2026-10-05', run_status: 'COMPLETE' }
  ]);
  const latest = Persist.getLatestApprovedSlgSignalRun(SLG_CFG, { store: store });
  assert.equal(latest.signal_run_id, 'OK');
});

test('privacy: no email-like strings in empty landing payload', () => {
  const store = Store.createMemoryStore();
  const payload = Persist.getDeploymentSignalsLandingForUI(
    SLG_CFG, {}, {}, { store: store });
  assert.ok(!JSON.stringify(payload).match(/@[a-z]+\.com/i));
});
