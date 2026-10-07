const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

function loadPlatform() {
  var coreConfigSrc = fs.readFileSync(path.join(SRC, 'CoreConfig.js'), 'utf8');
  var sandbox = {
    CoreUtils: null,
    Logger: { log: function () {} },
    Utilities: {
      formatDate: function (d, tz, fmt) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return fmt === 'yyyy-MM-dd' ? y + '-' + m + '-' + day : d.toISOString();
      },
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: function (algo, str) {
        return crypto.createHash('sha256').update(str).digest();
      },
      base64EncodeWebSafe: function (bytes) {
        return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      }
    },
    Session: { getScriptTimeZone: function () { return 'America/Los_Angeles'; } },
    SpreadsheetApp: null,
    LockService: null,
    CoreData: {
      canonicalDeploymentId: function (id) { return String(id || '').trim(); },
      getActiveCountDeployments: function () { return []; },
      filterDeploymentsByStudent_: function (rows) { return rows; },
      readSfdcDeploymentsRaw: function () { return []; },
      getAllDeploymentsForUI: function () { return { rows: [] }; }
    },
    CoreDeploymentTrajectory: { _writeSheet_: function () {} },
    MailApp: { sendEmail: function () {} },
    GmailApp: { sendEmail: function () { return true; } },
    PropertiesService: {
      getScriptProperties: function () {
        return { getProperty: function () { return null; }, setProperty: function () {} };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreUtils.js'), 'utf8'), sandbox);
  vm.runInContext(coreConfigSrc, sandbox);
  var files = [
    'CoreDeploymentTrajectoryMetrics.js',
    'CoreDeploymentDataStewardship.js',
    'CoreDeploymentSignals.js',
    'CoreDeploymentSignalLifecycle.js',
    'CoreDeploymentSignalStore.js',
    'CorePortfolioHealth.js',
    'CoreDeploymentSignalPersistence.js',
    'CoreNotify.js'
  ];
  files.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox);
  });
  return sandbox;
}

function slgCfg(overrides) {
  return Object.assign({
    appId: 'SLG',
    ui: { webApp: { baseUrl: 'https://example.test/dm', defaultEndpoint: 'exec' } },
    deploymentSignal: { enabled: true, persistenceEnabled: true },
    deploymentIntelligence: { enabled: true, displayName: 'Test Deployment Intelligence' },
    notify: { enabled: true, allowedFromAliases: ['sender@example.test'] },
    salesforce: { statusValues: { active: 'Active' } }
  }, overrides || {});
}

function pilotCfg() {
  return {
    appId: 'PILOT',
    ui: { webApp: { baseUrl: 'https://pilot.test/app', defaultEndpoint: 'exec' } },
    deploymentSignal: { enabled: true, persistenceEnabled: true },
    deploymentIntelligence: { enabled: true }
  };
}

const DEP_A = 'DEP_SAN_A';
const DEP_B = 'DEP_SAN_B';
const VALID = [DEP_A, DEP_B];

function baseRecord(dep, type, attention, extra) {
  return Object.assign({
    deployment_id: dep,
    attention: attention,
    signal_type: type,
    observation: 'Observation ' + dep,
    interpretation: 'Interpretation',
    why_it_matters: 'Why ' + dep,
    leadership_question: 'Question?',
    confidence: 'MEDIUM',
    evidence_limitations: 'Fixture'
  }, extra || {});
}

function persistRun(S, cfg, runId, records, store, prior) {
  if (prior) {
    S.CoreDeploymentSignalStore.replaceBody(
      store, 'Deployment_Signals',
      S.CoreDeploymentSignalStore.currentHeaders(), prior);
  }
  return S.CoreDeploymentSignalPersistence.persistApprovedSlgSignalRun(
    cfg,
    {
      signal_run_id: runId,
      signal_as_of: '2026-10-01',
      deployments_evaluated: 2,
      records: records
    },
    { store: store, validDeploymentIds: VALID }
  );
}

test('portfolio pulse — active health MTP and zero denominator', () => {
  var S = loadPlatform();
  S.CoreData.getActiveCountDeployments = function () {
    return [
      { health: 'Green', excludeFromReport: false },
      { health: 'Yellow', excludeFromReport: false },
      { health: 'Red', excludeFromReport: false, currentMtp: '2026-11-01' }
    ];
  };
  var pulse = S.CorePortfolioHealth.buildDeploymentIntelligencePortfolioPulse(
    S.CoreConfig.withDefaults(slgCfg()), {}, {});
  assert.equal(pulse.totalActive, 3);
  assert.equal(pulse.green, 1);
  assert.equal(pulse.mtpWithin90Days, 1);
  assert.equal(pulse.greenPct, 33.3);

  S.CoreData.getActiveCountDeployments = function () { return []; };
  var empty = S.CorePortfolioHealth.buildDeploymentIntelligencePortfolioPulse(
    S.CoreConfig.withDefaults(slgCfg()), {}, {});
  assert.equal(empty.totalActive, 0);
  assert.equal(empty.greenPct, 0);
});

test('portfolio pulse — normalizes Date.toString MTP (SFDC cellStr parity)', () => {
  var S = loadPlatform();
  var decMtp = new Date('2026-12-01T12:00:00');
  S.CoreData.getActiveCountDeployments = function () {
    return [{
      health: 'Yellow',
      excludeFromReport: false,
      mtpDate: decMtp.toString()
    }];
  };
  var pulse = S.CorePortfolioHealth.buildDeploymentIntelligencePortfolioPulse(
    S.CoreConfig.withDefaults(slgCfg()), {}, {});
  assert.equal(pulse.mtpWithin90Days, 1);
});

test('baseline snapshot and NEW leadership suppression', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-BASE', [
    baseRecord(DEP_A, 'COMPOUND', 'WATCH'),
    baseRecord(DEP_B, 'COMPOUND', 'WATCH')
  ], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = runs[runs.length - 1];
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, { store: store });
  assert.equal(artifact.identity.is_baseline, true);
  assert.equal(artifact.identity.week_character, 'baseline');
  assert.equal(artifact.portfolioMovement, null);
  assert.equal(artifact.signalMovement.leadership.new, 0);
  assert.equal(artifact.signalMovement.raw.new, 2);
  assert.equal(artifact.talkingPoints.length, 0);
  assert.ok(artifact.editorial);
  assert.match(artifact.editorial.whatChanged.headline, /baseline/i);
});

test('movement percentage-point deltas and idempotency', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  S.CoreData.getActiveCountDeployments = function () {
    return [
      { health: 'Green', excludeFromReport: false },
      { health: 'Green', excludeFromReport: false }
    ];
  };
  persistRun(S, cfg, 'RUN-W1', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  var fin1 = S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-W1' });
  assert.equal(fin1.ok, true);

  S.CoreData.getActiveCountDeployments = function () {
    return [
      { health: 'Green', excludeFromReport: false },
      { health: 'Green', excludeFromReport: false },
      { health: 'Green', excludeFromReport: false },
      { health: 'Red', excludeFromReport: false }
    ];
  };
  persistRun(S, cfg, 'RUN-W2', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  var fin2 = S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-W2' });
  assert.equal(fin2.ok, true);
  assert.equal(fin2.artifact.identity.is_baseline, false);
  assert.ok(fin2.artifact.portfolioMovement);
  assert.equal(fin2.artifact.portfolioMovement.totalActiveDelta, 2);

  var replay = S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-W2' });
  assert.equal(replay.idempotentReplay, true);
});

test('SUBMITTED signal run rejected for intelligence', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  S.CoreDeploymentSignalStore.appendRows(
    store,
    cfg.deploymentSignal.signalRunsSheetName,
    S.CoreDeploymentSignalStore.runHeaders(),
    [{
      signal_run_id: 'RUN-SUB',
      run_status: S.CoreDeploymentSignalStore.RUN_STATUS_SUBMITTED,
      signal_as_of: '2026-10-01'
    }]
  );
  var res = S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-SUB' });
  assert.equal(res.ok, false);
  assert.match(res.error, /SUBMITTED/i);
});

test('talking-point ranking and cap', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  cfg.deploymentIntelligence.talkingPointMax = 3;
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var recs = [
    baseRecord(DEP_A, 'COMPOUND', 'WATCH'),
    baseRecord(DEP_B, 'SCHEDULE', 'HIGH')
  ];
  persistRun(S, cfg, 'RUN-TP', recs, store);
  S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-TP' });
  persistRun(S, cfg, 'RUN-TP2', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = S.CoreDeploymentSignalStore.findLatestRunRow(runs, 'RUN-TP2');
  assert.equal(String(runRow.run_status), S.CoreDeploymentSignalStore.RUN_STATUS_COMPLETE);
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, { store: store });
  assert.ok(artifact.talkingPoints.length <= 3);
  assert.ok(artifact.talkingPoints.length >= 1);
});

test('data confidence leadership intersection', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-DC', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = runs[runs.length - 1];
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, {
      store: store,
      getContextPacketForDeployment: function (depId) {
        if (depId === DEP_A) {
          return {
            metadata: { deployment_id: DEP_A },
            current_state: { current_health: 'Green', deployment_stage: 'Deploy', current_mtp: '' },
            health_trajectory: { reconciliation: { health_current_matches_last_event_new_health: true } },
            schedule_trajectory: { parent_reconciliation_status: 'MATCH' },
            product_function: { product_function_count: 0 },
            intervention: { has_open_health_plan: false }
          };
        }
        return {
          metadata: { deployment_id: depId },
          current_state: { current_health: 'Green', deployment_stage: 'Deploy', current_mtp: '2026-12-01' },
          product_function: { product_function_target_history_available: false },
          intervention: { has_open_health_plan: false }
        };
      }
    });
  assert.ok(artifact.dataConfidence);
  assert.equal(artifact.dataConfidence.deploymentsWithStewardshipCount, 1);
  assert.ok(artifact.editorial.dataRequiringAttention);
});

test('data confidence excludes non-leadership stewardship codes', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-DC-FILTER', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = runs[runs.length - 1];
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, {
      store: store,
      getContextPacketForDeployment: function (depId) {
        if (depId !== DEP_A) return null;
        return {
          metadata: { deployment_id: DEP_A },
          current_state: {
            current_health: 'Green', deployment_stage: 'Deploy', current_mtp: '2026-12-01'
          },
          health_trajectory: { reconciliation: { health_current_matches_last_event_new_health: true } },
          schedule_trajectory: { parent_reconciliation_status: 'MATCH' },
          product_function: {
            product_function_count: 3,
            functions_completed: 0,
            functions_remaining: 0,
            product_function_rollup_reconciled: false
          },
          intervention: { has_open_health_plan: false }
        };
      }
    });
  assert.equal(artifact.dataConfidence.deploymentsWithStewardshipCount, 0);
  assert.equal(artifact.editorial.dataRequiringAttention, null);
});

test('production context resolver uses single portfolio context build', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-BATCH', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = runs[runs.length - 1];
  var portfolioCalls = 0;
  var perDepCalls = 0;
  S.CoreDeploymentSignalContext.buildDeploymentSignalPortfolioContext = function () {
    portfolioCalls++;
    return {
      skipped: false,
      packets: [{
        metadata: { deployment_id: DEP_A },
        current_state: { current_health: 'Green', deployment_stage: 'Deploy', current_mtp: '' },
        health_trajectory: { reconciliation: { health_current_matches_last_event_new_health: true } },
        schedule_trajectory: { parent_reconciliation_status: 'MATCH' },
        product_function: { product_function_count: 0 },
        intervention: { has_open_health_plan: false }
      }]
    };
  };
  S.CoreDeploymentSignalContext.buildDeploymentSignalContext = function () {
    perDepCalls++;
    return null;
  };
  S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, { store: store });
  assert.equal(portfolioCalls, 1);
  assert.equal(perDepCalls, 0);
});

test('production context resolver wires stewardship without override', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-PROD-DC', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = runs[runs.length - 1];
  S.CoreDeploymentSignalContext.buildDeploymentSignalPortfolioContext = function () {
    return {
      skipped: false,
      packets: [{
        metadata: { deployment_id: DEP_A },
        current_state: { current_health: 'Green', deployment_stage: 'Deploy', current_mtp: '' },
        health_trajectory: { reconciliation: { health_current_matches_last_event_new_health: true } },
        schedule_trajectory: { parent_reconciliation_status: 'MATCH' },
        product_function: { product_function_count: 0 },
        intervention: { has_open_health_plan: false }
      }]
    };
  };
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, { store: store });
  assert.equal(artifact.dataConfidence.deploymentsWithStewardshipCount, 1);
});

test('leadership email copy avoids machine lifecycle formatting', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var artifact = S.CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial({
    identity: { display_name: 'Test DI', is_baseline: false, week_character: 'active' },
    portfolioPulse: { totalActive: 50, greenPct: 80, yellowPct: 12, redPct: 8, mtpWithin90Days: 4 },
    portfolioMovement: {
      greenPctPointsDelta: 2, yellowPctPointsDelta: -1, redPctPointsDelta: -1,
      totalActiveDelta: 1, mtpWithin90DaysDelta: 0
    },
    signalMovement: { leadership: { new: 2, escalated: 2, deEscalated: 0, resolved: 0 } },
    talkingPoints: [{
      headline: 'Schedule pressure is increasing.',
      leadership_takeaway: 'Schedule pressure is increasing.',
      investigation_url: 'https://example.test/dm/exec?tab=signals'
    }],
    currentAttention: { redDeployments: 2, yellowDeployments: 3, continuingSignals: 4 },
    dataConfidence: { deploymentsWithStewardshipCount: 0 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm/exec?tab=signals' }
  });
  var html = S.CoreNotify.buildDeploymentIntelligenceEmailHtml(artifact, cfg);
  assert.ok(html.indexOf('NEW:') < 0);
  assert.ok(html.indexOf('ESCALATED:') < 0);
  assert.ok(html.indexOf('warrant new attention') > 0);
  assert.ok(html.indexOf('2 pt') > 0 || html.indexOf('2 pts') > 0);
  assert.ok(html.indexOf('-1 pt') > 0);
});

test('improving week prioritizes de-escalated over high continuing', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  cfg.deploymentIntelligence.talkingPointMax = 2;
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-IM1', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store);
  S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-IM1' });
  persistRun(S, cfg, 'RUN-IM2', [baseRecord(DEP_A, 'COMPOUND', 'HIGH')], store, [
    {
      signal_id: 'SIG-A',
      deployment_id: DEP_A,
      signal_run_id: 'RUN-IM1',
      signal_status: 'ACTIVE',
      lifecycle_state: 'CONTINUING',
      attention: 'HIGH',
      signal_type: 'COMPOUND',
      why_it_matters: 'Continuing high attention.'
    }
  ]);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = S.CoreDeploymentSignalStore.findLatestRunRow(runs, 'RUN-IM2');
  runRow.lifecycle_new_count = 0;
  runRow.lifecycle_escalated_count = 0;
  runRow.lifecycle_de_escalated_count = 1;
  runRow.lifecycle_continuing_count = 1;
  var history = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_History');
  history.push({
    signal_id: 'SIG-A',
    deployment_id: DEP_A,
    signal_run_id: 'RUN-IM2',
    lifecycle_state: 'DE_ESCALATED',
    attention: 'WATCH',
    signal_type: 'COMPOUND',
    why_it_matters: 'Improving condition.',
    signal_status: 'ACTIVE'
  });
  S.CoreDeploymentSignalStore.replaceBody(
    store, 'Deployment_Signal_History',
    S.CoreDeploymentSignalStore.historyHeaders(), history);
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, {
      store: store,
      getContextPacketForDeployment: function () { return null; }
    });
  assert.equal(artifact.identity.week_character, 'improving');
  assert.ok(artifact.talkingPoints.length >= 1);
  assert.equal(artifact.talkingPoints[0].lifecycle_state, 'DE_ESCALATED');
});

test('quiet week has no forced talking points', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  persistRun(S, cfg, 'RUN-Q1', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(
    cfg, { store: store, signal_run_id: 'RUN-Q1' });
  persistRun(S, cfg, 'RUN-Q2', [baseRecord(DEP_A, 'COMPOUND', 'WATCH')], store);
  var runs = S.CoreDeploymentSignalStore.readBody(store, 'Deployment_Signal_Runs');
  var runRow = S.CoreDeploymentSignalStore.findLatestRunRow(runs, 'RUN-Q2');
  var artifact = S.CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
    cfg, runRow, { store: store });
  assert.equal(artifact.identity.week_character, 'quiet');
  assert.equal(artifact.talkingPoints.length, 0);
  assert.ok(artifact.editorial.quietWeek);
});

test('investigation links use app config not SLG hardcode', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(pilotCfg());
  var url = S.CoreConfig.buildDeploymentManagerInvestigationUrl(cfg, {
    tab: 'signals',
    deploymentId: 'D1',
    signalId: 'SIG-1'
  });
  assert.ok(url.indexOf('https://pilot.test/app/exec') >= 0);
  assert.ok(url.indexOf('deploymentId=D1') >= 0);
  assert.ok(url.indexOf('SLG') < 0);
});

test('weekly email eligible with zero NEW and independent slack status', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var row = {
    intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
    slack_status: S.CoreDeploymentSignalStore.SLACK_STATUS_PENDING,
    email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING
  };
  assert.equal(S.CoreNotify.isDeploymentIntelligenceEmailEligible(row, cfg), true);
  var artifact = {
    identity: { display_name: 'Test DI', is_baseline: false },
    portfolioPulse: { totalActive: 10, greenPct: 80, yellowPct: 10, redPct: 10, mtpWithin90Days: 2 },
    signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 1, resolved: 0 } },
    talkingPoints: [],
    currentAttention: { redDeployments: 1, yellowDeployments: 2, continuingSignals: 3 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm/exec?tab=signals' },
    distributionState: {
      intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
      email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
      slack_status: S.CoreDeploymentSignalStore.SLACK_STATUS_PENDING
    }
  };
  var html = S.CoreNotify.buildDeploymentIntelligenceEmailHtml(artifact, cfg);
  assert.ok(html.indexOf('talking points') > 0);
  var send = S.CoreNotify.sendDeploymentIntelligenceEmail(cfg, artifact, { dryRun: true });
  assert.equal(send.email_status, S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING);
  assert.equal(send.sent, false);
});

test('leadership email MTP pulse is a count without days unit', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var artifact = S.CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial({
    identity: { display_name: 'Test DI', is_baseline: false, week_character: 'active' },
    portfolioPulse: { totalActive: 50, greenPct: 80, yellowPct: 12, redPct: 8, mtpWithin90Days: 18 },
    signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 0, resolved: 0 } },
    talkingPoints: [],
    currentAttention: { redDeployments: 2, yellowDeployments: 3, continuingSignals: 4 },
    dataConfidence: { deploymentsWithStewardshipCount: 0 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm/exec?tab=signals' }
  });
  var html = S.CoreNotify.buildDeploymentIntelligenceEmailHtml(artifact, cfg);
  assert.ok(html.indexOf('approaching MTP (90 days)') > 0);
  assert.ok(!/MTP ≤90d[\s\S]{0,120}days<\/div>/.test(html));
});

test('improving week What Changed does not duplicate improving or resolved counts', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var artifact = S.CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial({
    identity: { display_name: 'Test DI', is_baseline: false, week_character: 'improving' },
    portfolioPulse: { totalActive: 50, greenPct: 80, yellowPct: 12, redPct: 8, mtpWithin90Days: 4 },
    portfolioMovement: {
      greenPctPointsDelta: 3, yellowPctPointsDelta: -2, redPctPointsDelta: -1,
      totalActiveDelta: 0, mtpWithin90DaysDelta: 0
    },
    signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 4, resolved: 2 } },
    talkingPoints: [],
    currentAttention: { redDeployments: 2, yellowDeployments: 3, continuingSignals: 4 },
    dataConfidence: { deploymentsWithStewardshipCount: 0 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm/exec?tab=signals' }
  });
  assert.equal(artifact.editorial.whatChanged.headline, 'Conditions are improving this week');
  assert.equal(artifact.editorial.whatChanged.sublines.length, 1);
  assert.equal(artifact.editorial.whatChanged.sublines[0], '4 improving · 2 resolved');
  var html = S.CoreNotify.buildDeploymentIntelligenceEmailHtml(artifact, cfg);
  var resolvedMatches = html.match(/2 resolved/g) || [];
  assert.equal(resolvedMatches.length, 1);
});

test('baseline email omits orphan establishing-the-baseline section heading', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var artifact = S.CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial({
    identity: {
      display_name: 'Test DI', is_baseline: true, week_character: 'baseline'
    },
    portfolioPulse: { totalActive: 50, greenPct: 80, yellowPct: 12, redPct: 8, mtpWithin90Days: 4 },
    portfolioMovement: null,
    portfolioMovementBaselineCopy: 'Initial Deployment Intelligence baseline established.',
    signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 0, resolved: 0 } },
    talkingPoints: [],
    currentAttention: { redDeployments: 2, yellowDeployments: 3, continuingSignals: 4 },
    dataConfidence: { deploymentsWithStewardshipCount: 0 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm/exec?tab=signals' }
  });
  assert.equal(artifact.editorial.talkingSectionTitle, '');
  var html = S.CoreNotify.buildDeploymentIntelligenceEmailHtml(artifact, cfg);
  assert.ok(html.toLowerCase().indexOf('establishing the baseline') < 0);
  assert.ok(html.indexOf('What changed') > 0);
  assert.match(artifact.editorial.whatChanged.headline, /baseline/i);
});

test('disabled app produces no intelligence', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  cfg.deploymentIntelligence.enabled = false;
  assert.equal(S.CoreConfig.isDeploymentIntelligenceEnabled(cfg), false);
  var res = S.CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun(cfg, {});
  assert.equal(res.ok, false);
});

test('app isolation on intelligence sheet', () => {
  var S = loadPlatform();
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var sheet = 'Deployment_Intelligence_Runs';
  var headers = S.CoreDeploymentSignalStore.intelligenceRunHeaders();
  S.CoreDeploymentSignalStore.appendRows(store, sheet, headers, [{
    intelligence_run_id: 'INT-OTHER',
    app_id: 'OTHER',
    signal_run_id: 'RUN-X',
    intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
    artifact_json: '{}'
  }]);
  var cfg = S.CoreConfig.withDefaults(pilotCfg());
  var latest = S.CoreDeploymentSignalPersistence.getLatestReadyDeploymentIntelligence(
    cfg, { store: store });
  assert.equal(latest, null);
});

test('baseline repair replaces artifact and preserves distribution state', () => {
  var S = loadPlatform();
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  var sheet = cfg.deploymentIntelligence.intelligenceRunsSheetName;
  var headers = S.CoreDeploymentSignalStore.intelligenceRunHeaders();
  var signalRunId = 'SLG-REPAIR-1';
  var intelligenceRunId = 'INT-' + signalRunId;
  S.CoreDeploymentSignalStore.appendRows(store, cfg.deploymentSignal.signalRunsSheetName,
    S.CoreDeploymentSignalStore.runHeaders(), [{
      signal_run_id: signalRunId,
      signal_as_of: '2026-10-05',
      run_status: S.CoreDeploymentSignalStore.RUN_STATUS_COMPLETE,
      persistence_status: 'COMPLETE'
    }]);
  S.CoreDeploymentSignalStore.appendRows(store, sheet, headers, [{
    intelligence_run_id: intelligenceRunId,
    app_id: 'SLG',
    signal_run_id: signalRunId,
    as_of_date: '2026-10-05',
    is_baseline: true,
    intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
    artifact_schema_version: 'deployment-intelligence-v1',
    artifact_json: JSON.stringify({
      identity: { is_baseline: true },
      portfolioPulse: { mtpWithin90Days: 0 }
    }),
    email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
    email_sent_at: '',
    slack_status: S.CoreDeploymentSignalStore.SLACK_STATUS_PENDING,
    slack_sent_at: '',
    finalized_at: '2026-10-05T12:00:00Z',
    updated_at: '2026-10-05T12:00:00Z'
  }]);
  var res = S.CoreDeploymentSignalPersistence.repairDeploymentIntelligenceBaselineRun(cfg, {
    intelligence_run_id: intelligenceRunId,
    signal_run_id: signalRunId,
    store: store,
    reasonCodes: ['MTP_DATE_NORMALIZATION_DEFECT']
  });
  assert.equal(res.ok, true);
  assert.equal(res.validation.portfolio_pulse.mtpWithin90Days >= 0, true);
  var rows = S.CoreDeploymentSignalStore.readBody(store, sheet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email_status, S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING);
  assert.notEqual(rows[0].artifact_json.indexOf('portfolioPulse'), -1);
});

test('explicit test email send targets test recipient only', () => {
  var S = loadPlatform();
  var cfg = S.CoreConfig.withDefaults(slgCfg());
  cfg.notable = { notify: { testEmail: 'test-recipient@example.test' } };
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var sheet = cfg.deploymentIntelligence.intelligenceRunsSheetName;
  var headers = S.CoreDeploymentSignalStore.intelligenceRunHeaders();
  var intelligenceRunId = 'INT-EMAIL-1';
  S.CoreDeploymentSignalStore.appendRows(store, sheet, headers, [{
    intelligence_run_id: intelligenceRunId,
    app_id: 'SLG',
    signal_run_id: 'EMAIL-1',
    as_of_date: '2026-10-05',
    is_baseline: true,
    intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
    artifact_schema_version: 'deployment-intelligence-v1',
    artifact_json: JSON.stringify({
      identity: { display_name: 'Test DI', is_baseline: true },
      portfolioPulse: { totalActive: 1, greenPct: 100, yellowPct: 0, redPct: 0, mtpWithin90Days: 0 },
      signalMovement: { leadership: { new: 0 } },
      talkingPoints: [],
      currentAttention: { redDeployments: 0, yellowDeployments: 0, continuingSignals: 0 },
      links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm' },
      distributionState: {
        intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
        email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING
      }
    }),
    email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
    slack_status: S.CoreDeploymentSignalStore.SLACK_STATUS_PENDING
  }]);
  var sentTo = '';
  S.GmailApp.sendEmail = function (to) { sentTo = to; };
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    explicitTestSend: true,
    intelligence_run_id: intelligenceRunId,
    store: store
  });
  assert.equal(outcome.sentCount, 1);
  assert.equal(sentTo, 'test-recipient@example.test');
  var row = S.CoreDeploymentSignalStore.readBody(store, sheet)[0];
  assert.equal(row.email_status, S.CoreDeploymentSignalStore.EMAIL_STATUS_SENT);
});

test('artifact parse from run row for Slack-ready consumption', () => {
  var S = loadPlatform();
  var artifact = { identity: { intelligence_run_id: 'INT-1' }, portfolioPulse: { totalActive: 5 } };
  var row = { artifact_json: JSON.stringify(artifact) };
  var parsed = S.CoreDeploymentSignalPersistence.parseArtifactFromRunRow(row);
  assert.equal(parsed.identity.intelligence_run_id, 'INT-1');
  assert.equal(parsed.portfolioPulse.totalActive, 5);
});
