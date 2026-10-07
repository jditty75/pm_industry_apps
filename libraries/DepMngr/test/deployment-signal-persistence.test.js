const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

function loadSignalPlatform() {
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
      canonicalDeploymentId: function (id) {
        return String(id || '').trim();
      },
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
    CoreDeploymentSignalStage1Ingest: null,
    CoreDeploymentTrajectory: { _writeSheet_: function () {} },
    SpreadsheetApp: null,
    LockService: null
  };
  vm.createContext(sandbox);
  const files = [
    'CoreDeploymentSignalSchema.js',
    'CoreDeploymentSignalNormalize.js',
    'CoreDeploymentSignalLifecycle.js',
    'CoreDeploymentSignalStore.js',
    'CoreDeploymentSignalWorkbook.js',
    'CoreDeploymentSignalPersistence.js',
    'CoreDeploymentSignalStage1Ingest.js'
  ];
  files.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox);
  });
  return sandbox;
}

const S = loadSignalPlatform();
const SLG_CFG = S.CoreConfig.withDefaults({});
const HC_CFG = S.CoreConfig.withDefaults({
  appId: 'HC',
  deploymentSignal: { enabled: false, persistenceEnabled: false }
});

const DEP_A = 'DEP_SANITIZED_A';
const DEP_B = 'DEP_SANITIZED_B';
const VALID = [DEP_A, DEP_B];

function baseRecord(dep, type, attention, extra) {
  return Object.assign({
    deployment_id: dep,
    attention: attention,
    signal_type: type,
    observation: 'Sanitized observation for ' + dep,
    interpretation: 'Sanitized interpretation',
    why_it_matters: 'Sanitized why',
    leadership_question: 'Sanitized question?',
    confidence: 'MEDIUM',
    evidence_limitations: 'Synthetic test fixture'
  }, extra || {});
}

function persist(runId, records, store, prior) {
  if (prior) {
    S.CoreDeploymentSignalStore.replaceBody(
      store, 'Deployment_Signals',
      S.CoreDeploymentSignalSchema.currentHeaders(), prior);
  }
  return S.CoreDeploymentSignalPersistence.persistApprovedSlgSignalRun(
    SLG_CFG,
    {
      signal_run_id: runId,
      signal_as_of: '2026-10-01',
      deployments_evaluated: 2,
      records: records
    },
    { store: store, validDeploymentIds: VALID }
  );
}

test('schema headers are stable contracts', () => {
  var cur = S.CoreDeploymentSignalSchema.currentHeaders();
  assert.ok(cur.includes('signal_id'));
  assert.ok(cur.includes('lifecycle_state'));
  assert.equal(S.CoreDeploymentSignalSchema.historyHeaders().length, cur.length + 2);
});

test('SLG-only persistence gating', () => {
  assert.equal(S.CoreDeploymentSignalPersistence.isEnabled(SLG_CFG), true);
  assert.equal(S.CoreDeploymentSignalPersistence.isEnabled(HC_CFG), false);
});

test('unknown deployment rejected', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var res = persist('RUN-UNK', [baseRecord('UNKNOWN_DEP', 'HEALTH', 'WATCH')], store);
  assert.equal(res.ok, false);
  assert.match(res.error, /unknown deployment/i);
});

test('NEW persistence and idempotent replay', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var recs = [baseRecord(DEP_A, 'COMPOUND', 'WATCH')];
  var r1 = persist('RUN-001', recs, store);
  assert.equal(r1.ok, true);
  assert.equal(r1.signals_persisted, 1);
  assert.equal(r1.lifecycle_counts.NEW, 1);
  var current = S.CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(
    SLG_CFG, { store: store });
  assert.equal(current.length, 1);
  assert.equal(current[0].lifecycle_state, 'NEW');
  var r2 = persist('RUN-001', recs, store);
  assert.equal(r2.idempotentReplay, true);
  var hist = S.CoreDeploymentSignalPersistence.getSlgDeploymentSignalHistory(
    SLG_CFG, { store: store });
  assert.equal(hist.length, 1);
});

test('CONTINUING and ESCALATED lifecycle', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persist('RUN-010', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  var r2 = persist('RUN-011', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  assert.equal(r2.lifecycle_counts.ESCALATED, 1);
  var cur = S.CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(
    SLG_CFG, { store: store })[0];
  assert.equal(cur.lifecycle_state, 'ESCALATED');
  assert.equal(cur.attention, 'HIGH');
  var r3 = persist('RUN-012', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  assert.equal(r3.lifecycle_counts.CONTINUING, 1);
});

test('DE_ESCALATED lifecycle', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persist('RUN-020', [baseRecord(DEP_A, 'SCHEDULE', 'HIGH')], store);
  var r = persist('RUN-021', [baseRecord(DEP_A, 'SCHEDULE', 'WATCH')], store);
  assert.equal(r.lifecycle_counts.DE_ESCALATED, 1);
});

test('RESOLVED when absent from approved set', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persist('RUN-030', [
    baseRecord(DEP_A, 'COMPOUND', 'WATCH'),
    baseRecord(DEP_B, 'INTERVENTION', 'HIGH')
  ], store);
  var r = persist('RUN-031', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  assert.equal(r.lifecycle_counts.RESOLVED, 1);
  var current = S.CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(
    SLG_CFG, { store: store });
  assert.equal(current.length, 1);
  assert.equal(current[0].deployment_id, DEP_A);
  var hist = S.CoreDeploymentSignalPersistence.getSlgDeploymentSignalHistory(
    SLG_CFG, { store: store, deploymentId: DEP_B });
  assert.ok(hist.some(function (h) {
    return h.lifecycle_state === 'RESOLVED';
  }));
});

test('stable signal identity across weeks', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persist('RUN-040', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  var id1 = S.CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(
    SLG_CFG, { store: store })[0].signal_id;
  persist('RUN-041', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  var id2 = S.CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(
    SLG_CFG, { store: store })[0].signal_id;
  assert.equal(id1, id2);
});

test('POSITIVE modeled as attention not lifecycle', () => {
  var norm = S.CoreDeploymentSignalNormalize.normalizeSubstantiveRecord(
    baseRecord(DEP_A, 'POSITIVE', 'POSITIVE'));
  assert.equal(norm.record.attention, 'POSITIVE');
  var lc = S.CoreDeploymentSignalLifecycle.determineLifecycle(null, norm.record);
  assert.equal(lc, 'NEW');
});

test('latest approved run lookup', () => {
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persist('RUN-050', [baseRecord(DEP_A, 'HEALTH', 'WATCH')], store);
  persist('RUN-051', [baseRecord(DEP_A, 'HEALTH', 'WATCH')], store);
  var latest = S.CoreDeploymentSignalPersistence.getLatestApprovedSlgSignalRun(
    SLG_CFG, { store: store });
  assert.equal(latest.signal_run_id, 'RUN-051');
});

test('normalization preserves original prose field', () => {
  var norm = S.CoreDeploymentSignalNormalize.normalizeSubstantiveRecord({
    deployment_id: DEP_A,
    attention: 'watch',
    signal_type: 'compound',
    observation: '  spaced  prose  ',
    interpretation: 'interp',
    reasoning_prose_original: 'full block'
  });
  assert.equal(norm.record.observation, 'spaced prose');
  assert.equal(norm.record.reasoning_prose_original, 'full block');
});

test('enum normalization for unknown-but-valid signal type', () => {
  var norm = S.CoreDeploymentSignalNormalize.normalizeSubstantiveRecord(
    baseRecord(DEP_A, 'CUSTOM_FAMILY', 'WATCH'));
  assert.equal(norm.record.signal_type, 'CUSTOM_FAMILY');
});
