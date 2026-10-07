/**
 * Render sanitized Deployment Intelligence email HTML previews (Node; no GAS).
 */
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');
const OUT_DIR = path.join(__dirname, '..', '..', '..', '.ai', 'signal-exports',
  'deployment-intelligence-email-previews');

function loadStack() {
  var sandbox = {
    CoreUtils: { escapeHtml: function (s) { return String(s || ''); } },
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
    CoreData: {
      canonicalDeploymentId: function (id) { return String(id || '').trim(); },
      getActiveCountDeployments: function () { return []; },
      filterDeploymentsByStudent_: function (rows) { return rows; },
      readSfdcDeploymentsRaw: function () { return []; },
      getAllDeploymentsForUI: function () { return { rows: [] }; }
    },
    CoreDeploymentTrajectory: { _writeSheet_: function () {} },
    MailApp: { sendEmail: function () {} },
    PropertiesService: {
      getScriptProperties: function () {
        return { getProperty: function () { return null; }, setProperty: function () {} };
      }
    }
  };
  vm.createContext(sandbox);
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

function wrapHtml(title, body) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" ' +
    'content="width=device-width, initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="background:#f1f5f9;padding:24px;margin:0;">' + body + '</body></html>';
}

function tp(name, depId, why, question, sor) {
  return {
    deployment_display_name: name,
    deployment_id: depId,
    signal_id: 'SIG_' + depId,
    headline: why.split(/[.!?]/)[0] + '.',
    leadership_summary: why.indexOf('.') >= 0 ? why.replace(/^[^.!?]+[.!?]\s*/, '') : '',
    leadership_takeaway: why,
    leadership_question: question || '',
    system_of_record_note: sor || '',
    investigation_url: 'https://example.test/dm/exec?tab=signals&deploymentId=' + depId
  };
}

function baseArtifact(overrides) {
  return Object.assign({
    identity: {
      display_name: 'SLG Deployment Intelligence',
      is_baseline: false,
      week_character: 'active',
      as_of_date: '2026-10-07'
    },
    portfolioPulse: {
      totalActive: 120,
      green: 95,
      yellow: 17,
      red: 8,
      greenPct: 79,
      yellowPct: 14,
      redPct: 7,
      mtpWithin90Days: 18
    },
    portfolioMovement: {
      totalActiveDelta: 2,
      greenPctPointsDelta: 2,
      yellowPctPointsDelta: -1,
      redPctPointsDelta: -1,
      mtpWithin90DaysDelta: 1
    },
    signalMovement: {
      leadership: { new: 1, escalated: 1, deEscalated: 2, resolved: 0, continuing: 8 }
    },
    talkingPoints: [
      tp('Sanitized County A', 'DEP_A',
        'Customer readiness is putting the near-term delivery plan under additional pressure. ' +
        'Outstanding dependencies now intersect with a major milestone.',
        'Does the current evidence still support the recorded target?')
    ],
    currentAttention: { redDeployments: 8, yellowDeployments: 17, continuingSignals: 8 },
    dataConfidence: { deploymentsWithStewardshipCount: 0, leadershipVisibleDeploymentCount: 12 },
    links: { exploreDeploymentIntelligenceUrl: 'https://example.test/dm/exec?tab=signals' },
    distributionState: {
      intelligence_status: 'READY',
      email_status: 'PENDING',
      slack_status: 'PENDING'
    }
  }, overrides || {});
}

function main() {
  var S = loadStack();
  var cfg = S.CoreConfig.withDefaults({
    appId: 'SLG',
    deploymentIntelligence: { enabled: true, displayName: 'SLG Deployment Intelligence' },
    deploymentSignal: { persistenceEnabled: true },
    ui: { webApp: { baseUrl: 'https://example.test/dm', defaultEndpoint: 'exec' } }
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  var scenarios = [
    {
      file: '01-baseline.html',
      artifact: baseArtifact({
        identity: { display_name: 'SLG Deployment Intelligence', is_baseline: true, week_character: 'baseline' },
        portfolioMovement: null,
        portfolioMovementBaselineCopy: 'Initial Deployment Intelligence baseline established.',
        signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 0, resolved: 0, continuing: 16 } },
        talkingPoints: []
      })
    },
    {
      file: '02-new-and-escalated.html',
      artifact: baseArtifact({
        identity: { week_character: 'active' },
        signalMovement: { leadership: { new: 2, escalated: 2, deEscalated: 0, resolved: 0, continuing: 6 } },
        talkingPoints: [
          tp('Sanitized Customer B', 'DEP_B',
            'Escalated schedule compression now intersects with customer readiness gaps. ' +
            'Leadership should confirm whether recovery actions are funded.',
            'Is the recovery plan adequately resourced?'),
          tp('Sanitized Customer C', 'DEP_C',
            'A new intervention pattern suggests emerging delivery risk that was not present last week.',
            'What changed in the last seven days?')
        ]
      })
    },
    {
      file: '03-quiet-week.html',
      artifact: baseArtifact({
        identity: { week_character: 'quiet' },
        portfolioMovement: {
          totalActiveDelta: 0,
          greenPctPointsDelta: 0,
          yellowPctPointsDelta: 0,
          redPctPointsDelta: 0,
          mtpWithin90DaysDelta: 0
        },
        signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 2, resolved: 1, continuing: 8 } },
        talkingPoints: []
      })
    },
    {
      file: '04-improving-week.html',
      artifact: baseArtifact({
        identity: { week_character: 'improving' },
        portfolioMovement: {
          totalActiveDelta: 0,
          greenPctPointsDelta: 3,
          yellowPctPointsDelta: -2,
          redPctPointsDelta: -1,
          mtpWithin90DaysDelta: -2
        },
        signalMovement: { leadership: { new: 0, escalated: 0, deEscalated: 4, resolved: 2, continuing: 6 } },
        talkingPoints: [
          tp('Sanitized Customer E', 'DEP_E',
            'Prior escalation pressure is easing as customer readiness stabilizes and the schedule firms.',
            'Should we adjust leadership attention downward?')
        ]
      })
    },
    {
      file: '05-data-confidence.html',
      artifact: baseArtifact({
        dataConfidence: { deploymentsWithStewardshipCount: 2, leadershipVisibleDeploymentCount: 5 },
        talkingPoints: [
          tp('Sanitized Customer D', 'DEP_D',
            'MTP timing remains material for leadership discussion this week.',
            'Who owns system-of-record correction?',
            'System-of-record: Current MTP requires review.')
        ]
      })
    },
    {
      file: '06-heavy-week-cap.html',
      artifact: baseArtifact({
        talkingPoints: [
          tp('Sanitized Customer 1', 'D1', 'First priority condition for leadership awareness this week.'),
          tp('Sanitized Customer 2', 'D2', 'Second priority condition with sustained schedule pressure.'),
          tp('Sanitized Customer 3', 'D3', 'Third priority condition requiring cross-functional alignment.'),
          tp('Sanitized Customer 4', 'D4', 'Fourth priority condition with emerging customer risk.'),
          tp('Sanitized Customer 5', 'D5', 'Fifth priority condition at the weekly cap.')
        ]
      })
    }
  ];

  var written = [];
  scenarios.forEach(function (sc) {
    S.CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial(sc.artifact);
    var body = S.CoreNotify.buildDeploymentIntelligenceEmailHtml(sc.artifact, cfg);
    var full = wrapHtml(sc.file, body);
    var outPath = path.join(OUT_DIR, sc.file);
    fs.writeFileSync(outPath, full, 'utf8');
    written.push(outPath);
  });
  console.log('Wrote ' + written.length + ' previews to ' + OUT_DIR);
  written.forEach(function (p) { console.log(p); });
}

main();
