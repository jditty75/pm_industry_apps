const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

function loadPlatform() {
  var sandbox = {
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
    CoreDeploymentTrajectory: { _writeSheet_: function () {} },
    CoreNotify: {
      applyDeploymentSignalPostCompleteHandoff: function () {
        return { email_status: 'NOT_REQUIRED', payload: null, sent: false };
      }
    },
    SpreadsheetApp: null,
    LockService: null,
    PropertiesService: { getScriptProperties: function () {
      return { getProperty: function () { return null; }, setProperty: function () {} };
    } }
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
const CFG = S.CoreConfig.withDefaults({});
const DEP_A = 'DEP_SANITIZED_A';
const DEP_B = 'DEP_SANITIZED_B';
const VALID = { DEP_SANITIZED_A: true, DEP_SANITIZED_B: true };

function baseSignalRow(runId, dep, type, attention) {
  return {
    schema_version: 'deployment-signal-v1',
    signal_id: '',
    deployment_id: dep,
    signal_run_id: runId,
    signal_as_of: '2026-10-05',
    lifecycle_state: '',
    attention: attention,
    signal_type: type,
    observation: 'Obs',
    interpretation: 'Interp',
    why_it_matters: 'Why',
    leadership_question: 'Q?',
    confidence: 'MEDIUM',
    evidence_limitations: 'Fixture',
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
  };
}

function baseRunRow(runId, proposed, evaluated, noSignal) {
  return {
    signal_run_id: runId,
    signal_as_of: '2026-10-05',
    started_at: '2026-10-05T07:00:00Z',
    received_at: '2026-10-05T07:00:00Z',
    persisted_at: '',
    deployments_evaluated: evaluated,
    signals_proposed: proposed,
    signals_persisted: 0,
    no_signal_count: noSignal,
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
}

function seedSubmittedRun(store, runId, signalRows, runRow) {
  var sig = CFG.deploymentSignal;
  S.CoreDeploymentSignalStore.appendRows(
    store, sig.signalRunsSheetName,
    S.CoreDeploymentSignalStore.runHeaders(), [runRow]);
  S.CoreDeploymentSignalStore.appendRows(
    store, sig.signalsSheetName,
    S.CoreDeploymentSignalStore.currentHeaders(), signalRows);
}

test('valid submitted run processes to COMPLETE', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var runId = 'RUN-SUB-001';
  seedSubmittedRun(store, runId, [
    baseSignalRow(runId, DEP_A, 'COMPOUND', 'WATCH')
  ], baseRunRow(runId, 1, 2, 1));
  var res = S.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { store: store, validDeploymentIds: VALID });
  assert.equal(res.ok, true);
  assert.equal(res.processed.length, 1);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  assert.equal(runs[0].run_status, 'COMPLETE');
  var current = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signals');
  assert.equal(current.length, 1);
  assert.equal(current[0].signal_status, 'ACTIVE');
  assert.equal(current[0].lifecycle_state, 'NEW');
});

test('zero-signal submitted run', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var runId = 'RUN-ZERO';
  seedSubmittedRun(store, runId, [], baseRunRow(runId, 0, 5, 5));
  var res = S.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { store: store, validDeploymentIds: VALID });
  assert.equal(res.ok, true);
  assert.equal(S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signals').length, 0);
});

test('count reconciliation failure', () => {
  var runId = 'RUN-BAD-COUNT';
  var v = S.CoreDeploymentSignalPersistence.validateSubmittedSignalRunUnit(
    baseRunRow(runId, 2, 3, 1),
    [baseSignalRow(runId, DEP_A, 'HEALTH', 'WATCH')],
    VALID);
  assert.equal(v.ok, false);
});

test('invalid deployment rejected', () => {
  var runId = 'RUN-BAD-DEP';
  var v = S.CoreDeploymentSignalPersistence.validateSubmittedSignalRunUnit(
    baseRunRow(runId, 1, 1, 0),
    [baseSignalRow(runId, 'UNKNOWN', 'HEALTH', 'WATCH')],
    VALID);
  assert.equal(v.ok, false);
});

test('second processor pass does not duplicate history', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var runId = 'RUN-IDEM';
  seedSubmittedRun(store, runId, [
    baseSignalRow(runId, DEP_A, 'COMPOUND', 'WATCH')
  ], baseRunRow(runId, 1, 1, 0));
  S.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { store: store, validDeploymentIds: VALID });
  var histLen = S.CoreDeploymentSignalStore.readBody(
    store, 'Deployment_Signal_History').length;
  var res2 = S.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { store: store, validDeploymentIds: VALID });
  assert.equal(res2.outcome, 'NO_SUBMITTED_RUNS');
  var histLen2 = S.CoreDeploymentSignalStore.readBody(
    store, 'Deployment_Signal_History').length;
  assert.equal(histLen, histLen2);
});

test('CONTINUING and ESCALATED via submitted processor', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var r1 = 'RUN-C1';
  seedSubmittedRun(store, r1, [
    baseSignalRow(r1, DEP_A, 'COMPOUND', 'WATCH')
  ], baseRunRow(r1, 1, 1, 0));
  S.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { store: store, validDeploymentIds: VALID });
  var r2 = 'RUN-C2';
  seedSubmittedRun(store, r2, [
    baseSignalRow(r2, DEP_A, 'COMPOUND', 'HIGH')
  ], baseRunRow(r2, 1, 1, 0));
  var res = S.CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns(
    CFG, { store: store, validDeploymentIds: VALID });
  assert.equal(res.processed[0].lifecycle_counts.ESCALATED, 1);
});
