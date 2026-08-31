/**
 * DataFreshnessMonitorHost.js
 *
 * SLG-hosted daily rollup monitor for Salesforce Connector refresh freshness
 * across all deployment health manager apps.
 *
 * Spreadsheet IDs for remote apps are resolved from Script Properties:
 *   FRESHNESS_SPREADSHEET_SLG
 *   FRESHNESS_SPREADSHEET_HENP
 *   FRESHNESS_SPREADSHEET_HC
 *   FRESHNESS_SPREADSHEET_EVI
 *   FRESHNESS_SPREADSHEET_AI
 *
 * SLG defaults to the active spreadsheet when FRESHNESS_SPREADSHEET_SLG is unset.
 * Run configureDataFreshnessSpreadsheetIds() once to set the other four IDs before
 * installing the daily trigger.
 */

var DATA_FRESHNESS_APPS = [
  {
    appId: 'SLG',
    label: 'SLG Deployment Health Manager',
    spreadsheetId: '',
    logSheet: 'Auto Refresh Execution Log',
    expectedSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentContacts',
      'SFDC_DeploymentHistory'
    ]
  },
  {
    appId: 'HENP',
    label: 'HENP Deployment Health Manager',
    spreadsheetId: '',
    logSheet: 'Auto Refresh Execution Log',
    expectedSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentContacts',
      'SFDC_DeploymentHistory'
    ]
  },
  {
    appId: 'HC',
    label: 'Healthcare Deployment Health Manager',
    spreadsheetId: '',
    logSheet: 'Auto Refresh Execution Log',
    expectedSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentContacts',
      'SFDC_DeploymentHistory'
    ]
  },
  {
    appId: 'EVI',
    label: 'Evisort Deployment Health Manager',
    spreadsheetId: '',
    logSheet: 'Auto Refresh Execution Log',
    expectedSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentContacts',
      'SFDC_DeploymentHistory'
    ]
  },
  {
    appId: 'AI',
    label: 'AI Deployment Health Manager',
    spreadsheetId: '',
    logSheet: 'Auto Refresh Execution Log',
    expectedSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentContacts',
      'SFDC_DeploymentHistory'
    ]
  }
];

var FRESHNESS_SPREADSHEET_PROP_PREFIX_ = 'FRESHNESS_SPREADSHEET_';

/**
 * Resolve spreadsheet IDs from script properties / active spreadsheet.
 *
 * @return {Array<Object>}
 */
function resolveDataFreshnessApps_() {
  var props = PropertiesService.getScriptProperties();

  return DATA_FRESHNESS_APPS.map(function (entry) {
    var resolved = {
      appId: entry.appId,
      label: entry.label,
      logSheet: entry.logSheet,
      expectedSheets: entry.expectedSheets
    };

    var propKey = FRESHNESS_SPREADSHEET_PROP_PREFIX_ + entry.appId;
    var spreadsheetId = props.getProperty(propKey) || entry.spreadsheetId || '';

    if (!spreadsheetId && entry.appId === 'SLG') {
      try {
        spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
      } catch (e) {
        Logger.log('resolveDataFreshnessApps_: unable to resolve SLG active spreadsheet — ' + e);
      }
    }

    resolved.spreadsheetId = spreadsheetId;
    return resolved;
  });
}

/**
 * One-time helper to store monitored spreadsheet IDs in Script Properties.
 * Example:
 * configureDataFreshnessSpreadsheetIds({
 *   HENP: '...',
 *   HC: '...',
 *   EVI: '...',
 *   AI: '...'
 * });
 *
 * @param {Object<string,string>} idsByAppId
 * @return {Object<string,string>}
 */
function configureDataFreshnessSpreadsheetIds(idsByAppId) {
  var props = PropertiesService.getScriptProperties();
  var saved = {};

  Object.keys(idsByAppId || {}).forEach(function (appId) {
    var id = String(idsByAppId[appId] || '').trim();
    if (!id) return;
    var propKey = FRESHNESS_SPREADSHEET_PROP_PREFIX_ + appId;
    props.setProperty(propKey, id);
    saved[appId] = id;
    Logger.log('configureDataFreshnessSpreadsheetIds: saved ' + appId);
  });

  return saved;
}

/**
 * Daily rollup email entry point (trigger target).
 *
 * @return {Object}
 */
function sendDailyDataFreshnessRollup() {
  return CoreLib.CoreFreshnessMonitor.sendDailyRollup(resolveDataFreshnessApps_(), {
    recipient: 'jeffrey.ditty@workday.com',
    sendOkEmail: true,
    refreshCycleHours: 8,
    graceHours: 1,
    warningHours: 12,
    criticalHours: 24
  });
}

/**
 * Install the daily rollup trigger at 7 AM ET.
 *
 * @return {Object}
 */
function installDailyDataFreshnessRollupTrigger() {
  var missing = resolveDataFreshnessApps_().filter(function (entry) {
    return !entry.spreadsheetId;
  });
  if (missing.length) {
    var ids = missing.map(function (m) { return m.appId; }).join(', ');
    throw new Error(
      'Cannot install trigger — missing spreadsheet IDs for: ' + ids +
      '. Run configureDataFreshnessSpreadsheetIds() first.'
    );
  }

  return CoreLib.CoreFreshnessMonitor.installDailyTrigger(
    'sendDailyDataFreshnessRollup',
    7
  );
}

/**
 * Preview rollup snapshot without sending email.
 *
 * @return {Object}
 */
function previewDailyDataFreshnessRollup() {
  return CoreLib.CoreFreshnessMonitor.getRollupSnapshot(resolveDataFreshnessApps_(), {
    recipient: 'jeffrey.ditty@workday.com',
    refreshCycleHours: 8,
    graceHours: 1,
    warningHours: 12,
    criticalHours: 24
  });
}

/**
 * Manual test — logs rollup JSON and returns snapshot.
 *
 * @return {Object}
 */
function testDataFreshnessRollupPreview() {
  var snap = previewDailyDataFreshnessRollup();
  Logger.log(JSON.stringify(snap, null, 2));
  return snap;
}

/**
 * Manual test — sends the daily rollup email.
 *
 * @return {Object}
 */
function testSendDailyDataFreshnessRollup() {
  return sendDailyDataFreshnessRollup();
}
