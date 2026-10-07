const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');
const SLG_CODE = path.join(__dirname, '..', '..', '..', 'solutions', 'SLG_DM', 'src', 'Code.js');

function loadPlatform() {
  var sandbox = {
    CoreUtils: null,
    Logger: { log: function () {} },
    Utilities: {
      formatDate: function (d, tz, fmt) {
        if (fmt === 'u') return String(d.getDay() + 1);
        if (fmt === 'H') return String(d.getHours());
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
    LockService: {
      getDocumentLock: function () {
        return {
          tryLock: function () { return true; },
          releaseLock: function () {}
        };
      }
    },
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
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreConfig.js'), 'utf8'), sandbox);
  [
    'CoreDeploymentTrajectoryMetrics.js',
    'CoreDeploymentDataStewardship.js',
    'CoreDeploymentSignals.js',
    'CoreDeploymentSignalLifecycle.js',
    'CoreDeploymentSignalStore.js',
    'CorePortfolioHealth.js',
    'CoreDeploymentSignalPersistence.js',
    'CoreNotify.js'
  ].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox);
  });
  return sandbox;
}

function slgCfg(overrides) {
  return Object.assign({
    appId: 'SLG',
    ui: { webApp: { baseUrl: 'https://example.test/dm', defaultEndpoint: 'exec' } },
    deploymentSignal: { enabled: true, persistenceEnabled: true },
    deploymentIntelligence: {
      enabled: true,
      displayName: 'Test Deployment Intelligence',
      sendNotBeforeHourLocal: 8,
      autoSendBaseline: false
    },
    notify: { enabled: true, allowedFromAliases: ['sender@example.test'] }
  }, overrides || {});
}

function withSlgCfg(S, overrides) {
  return S.CoreConfig.withDefaults(slgCfg(overrides));
}

function pilotCfg(S) {
  return S.CoreConfig.withDefaults({
    appId: 'PILOT',
    ui: { webApp: { baseUrl: 'https://pilot.test/app', defaultEndpoint: 'exec' } },
    deploymentSignal: { enabled: true, persistenceEnabled: true },
    deploymentIntelligence: { enabled: true, sendNotBeforeHourLocal: 8 },
    notify: { enabled: true, allowedFromAliases: ['sender@example.test'] }
  });
}

function diNotificationRow(overrides) {
  return Object.assign({
    notificationKey: 'deployment_intelligence_weekly',
    enabled: true,
    type: 'deployment_intelligence',
    to: 'leader@example.test',
    cc: '',
    fromAlias: 'sender@example.test',
    sendDay: 4
  }, overrides || {});
}

function artifactJson(overrides) {
  return JSON.stringify(Object.assign({
    identity: { display_name: 'Test DI', is_baseline: false },
    portfolioPulse: { totalActive: 1, greenPct: 100, yellowPct: 0, redPct: 0, mtpWithin90Days: 0 },
    signalMovement: { leadership: { new: 0 } },
    talkingPoints: [],
    currentAttention: { redDeployments: 0, yellowDeployments: 0, continuingSignals: 0 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm' },
    distributionState: {
      intelligence_status: 'READY',
      email_status: 'PENDING'
    }
  }, overrides || {}));
}

function seedSignalRun(S, store, signalRunId) {
  S.CoreDeploymentSignalStore.appendRows(
    store,
    'Deployment_Signal_Runs',
    S.CoreDeploymentSignalStore.runHeaders(),
    [{
      signal_run_id: signalRunId,
      signal_as_of: '2026-10-05',
      run_status: S.CoreDeploymentSignalStore.RUN_STATUS_COMPLETE,
      persistence_status: 'COMPLETE'
    }]);
}

function seedIntelligenceRow(S, cfg, store, opts) {
  opts = opts || {};
  var signalRunId = opts.signalRunId || 'RUN-W1';
  var sheet = cfg.deploymentIntelligence.intelligenceRunsSheetName;
  var headers = S.CoreDeploymentSignalStore.intelligenceRunHeaders();
  if (opts.seedSignalRun) seedSignalRun(S, store, signalRunId);
  S.CoreDeploymentSignalStore.appendRows(store, sheet, headers, [{
    intelligence_run_id: 'INT-' + signalRunId,
    app_id: cfg.appId,
    signal_run_id: signalRunId,
    as_of_date: '2026-10-05',
    is_baseline: opts.is_baseline === true,
    intelligence_status: S.CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
    artifact_schema_version: 'deployment-intelligence-v1',
    artifact_json: artifactJson(opts.artifactOverrides),
    email_status: opts.email_status || S.CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
    email_sent_at: opts.email_sent_at || '',
    slack_status: opts.slack_status || S.CoreDeploymentSignalStore.SLACK_STATUS_PENDING,
    slack_sent_at: '',
    finalized_at: '2026-10-05T12:00:00Z',
    updated_at: '2026-10-05T12:00:00Z',
    email_last_error: opts.email_last_error || '',
    email_attempt_count: opts.email_attempt_count || ''
  }]);
}

/** Wednesday 2026-10-07 10:00 local (sendDay 4, hour before default not-before 8 is false at 10). */
function wednesdayMorning() {
  return new Date(2026, 9, 7, 10, 0, 0);
}

test('production send path honors schedule and sends once', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, { seedSignalRun: true, signalRunId: 'RUN-W1' });
  var sent = 0;
  S.GmailApp.sendEmail = function () { sent++; return true; };
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 1);
  assert.equal(sent, 1);
});

test('disabled NotificationConfig row prevents production send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, { seedSignalRun: true });
  var sent = 0;
  S.GmailApp.sendEmail = function () { sent++; return true; };
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow({ enabled: false }),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 0);
  assert.equal(sent, 0);
});

test('app capability disabled prevents production send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S, { deploymentIntelligence: { enabled: false } });
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, { seedSignalRun: true });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 0);
});

test('outside configured weekday does not send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, { seedSignalRun: true });
  var sent = 0;
  S.GmailApp.sendEmail = function () { sent++; return true; };
  var tuesday = new Date(2026, 9, 6, 10, 0, 0);
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow({ sendDay: 4 }),
    store: store,
    now: tuesday
  });
  assert.equal(outcome.sentCount, 0);
  assert.equal(sent, 0);
});

test('before not-before hour does not send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S, {
    deploymentIntelligence: { enabled: true, sendNotBeforeHourLocal: 14 }
  });
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, { seedSignalRun: true });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: new Date(2026, 9, 7, 9, 0, 0)
  });
  assert.equal(outcome.sentCount, 0);
});

test('baseline with autoSendBaseline false does not send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, {
    seedSignalRun: true,
    is_baseline: true,
    artifactOverrides: { identity: { display_name: 'Test DI', is_baseline: true } }
  });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 0);
});

test('baseline with autoSendBaseline true can send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S, {
    deploymentIntelligence: { enabled: true, autoSendBaseline: true }
  });
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, {
    seedSignalRun: true,
    is_baseline: true,
    artifactOverrides: { identity: { display_name: 'Test DI', is_baseline: true } }
  });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 1);
});

test('SENT status is a no-op', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, {
    seedSignalRun: true,
    email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_SENT
  });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 0);
});

test('does not send previous artifact when current expected artifact missing', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedSignalRun(S, store, 'RUN-NEW');
  seedIntelligenceRow(S, cfg, store, { signalRunId: 'RUN-OLD', seedSignalRun: false });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 0);
  assert.equal(outcome.results[0].reason, 'expected_artifact_missing');
});

test('delayed current artifact becomes sendable on later dispatch', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedSignalRun(S, store, 'RUN-NEW');
  var first = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(first.sentCount, 0);
  seedIntelligenceRow(S, cfg, store, { signalRunId: 'RUN-NEW', seedSignalRun: false });
  var second = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(second.sentCount, 1);
});

test('Gmail failure records FAILED metadata and attempt count', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, { seedSignalRun: true });
  S.GmailApp.sendEmail = function () { throw new Error('smtp down'); };
  S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  var row = S.CoreDeploymentSignalStore.readBody(
    store, cfg.deploymentIntelligence.intelligenceRunsSheetName)[0];
  assert.equal(row.email_status, S.CoreDeploymentSignalStore.EMAIL_STATUS_FAILED);
  assert.equal(row.email_attempt_count, 1);
  assert.ok(row.email_last_error);
});

test('retry cap stops further automatic sends', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  var max = S.CoreNotify.DEPLOYMENT_INTELLIGENCE_EMAIL_MAX_ATTEMPTS;
  seedIntelligenceRow(S, cfg, store, {
    seedSignalRun: true,
    email_status: S.CoreDeploymentSignalStore.EMAIL_STATUS_FAILED,
    email_attempt_count: max
  });
  var sent = 0;
  S.GmailApp.sendEmail = function () { sent++; return true; };
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 0);
  assert.equal(sent, 0);
});

test('slack status does not block email send', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  var store = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, cfg, store, {
    seedSignalRun: true,
    slack_status: S.CoreDeploymentSignalStore.SLACK_STATUS_SENT
  });
  var outcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(cfg, {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: store,
    now: wednesdayMorning()
  });
  assert.equal(outcome.sentCount, 1);
});

test('sanitized second app does not inherit SLG notification policy', () => {
  var S = loadPlatform();
  var slgStore = S.CoreDeploymentSignalStore.createMemoryStore();
  var pilotStore = S.CoreDeploymentSignalStore.createMemoryStore();
  seedIntelligenceRow(S, withSlgCfg(S), slgStore, { seedSignalRun: true, signalRunId: 'RUN-SLG' });
  seedIntelligenceRow(S, pilotCfg(S), pilotStore, { seedSignalRun: true, signalRunId: 'RUN-PILOT' });
  var sent = 0;
  S.GmailApp.sendEmail = function () { sent++; return true; };
  var pilotOutcome = S.CoreNotify.processDeploymentIntelligenceEmailQueue(pilotCfg(S), {
    productionSend: true,
    notificationRow: diNotificationRow(),
    store: pilotStore,
    now: wednesdayMorning()
  });
  assert.equal(pilotOutcome.sentCount, 0);
  assert.equal(sent, 0);
});

test('runScheduledNotificationDispatch respects notify master toggle under lock', () => {
  var S = loadPlatform();
  var cfg = withSlgCfg(S);
  cfg.notify.enabled = false;
  var outcome = S.CoreNotify.runScheduledNotificationDispatch(cfg, {});
  assert.equal(outcome.ok, true);
  assert.equal(outcome.skipped, true);
  assert.equal(outcome.reason, 'notify_master_disabled');
});

test('SLG installer defines exactly three operating-loop handlers', () => {
  var src = fs.readFileSync(SLG_CODE, 'utf8');
  assert.ok(src.includes('tickSlgDeploymentSignalEvidenceRefresh'));
  assert.ok(src.includes('tickSlgDeploymentSignalSubmittedProcessor'));
  assert.ok(src.includes('tickSlgScheduledNotificationDispatch'));
  var handlerMatches = src.match(/handlerName:\s*'tickSlg[^']+'/g) || [];
  assert.equal(handlerMatches.length, 3);
});

test('SLG installer idempotency keeps three handler specs', () => {
  var src = fs.readFileSync(SLG_CODE, 'utf8');
  var specsBlock = src.slice(
    src.indexOf('var specs = ['),
    src.indexOf('return specs.map'));
  assert.equal((specsBlock.match(/handlerName:/g) || []).length, 3);
  assert.ok(src.includes('deleteTrigger'));
  assert.ok(specsBlock.includes('everyHours: 1'));
});
