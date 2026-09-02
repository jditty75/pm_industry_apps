/**
 * CoreFreshnessMonitor.gs
 *
 * Centralized Salesforce Connector data-freshness monitoring for deployment
 * health apps. Reads Auto Refresh Execution Log tabs, evaluates per-sheet and
 * per-app status, supports the UI badge contract, and sends daily rollup emails.
 */
var CoreFreshnessMonitor = (function () {

  var DEFAULT_LOG_SHEET = 'Auto Refresh Execution Log';
  var DEFAULT_EXPECTED_SHEETS = [
    'SFDC_Deployments',
    'SFDC_DeploymentProductFunctions',
    'SFDC_DeploymentContacts',
    'SFDC_DeploymentHistory'
  ];

  var TIME_HEADERS = ['refresh time', 'timestamp', 'time', 'date'];
  var SHEET_HEADERS = ['sheet', 'sheet name', 'tab', 'tab name'];
  var STATUS_HEADERS = ['status', 'result'];
  var MESSAGE_HEADERS = ['error', 'message'];

  // ---------------------------------------------------------------------------
  // PUBLIC
  // ---------------------------------------------------------------------------

  /**
   * Resolves the primary freshness sheet for UI badge display.
   * ProductMode apps default to SFDC_DeploymentProductFunctions.
   *
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _resolvePrimarySheet_(cfg) {
    if (cfg.freshness && cfg.freshness.primarySheet) {
      return cfg.freshness.primarySheet;
    }
    if (cfg.freshness && cfg.freshness.watchSheet) {
      return cfg.freshness.watchSheet;
    }
    if (cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled) {
      return (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
        'SFDC_DeploymentProductFunctions';
    }
    return 'SFDC_Deployments';
  }

  /**
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _isProductModeApp_(cfg) {
    return !!(cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled);
  }

  /**
   * Finds a sheet freshness entry by name.
   *
   * @param {Array<Object>} sheets
   * @param {string} sheetName
   * @return {Object|null}
   * @private
   */
  function _findSheetFreshness_(sheets, sheetName) {
    if (!sheets || !sheetName) return null;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].sheetName === sheetName) return sheets[i];
    }
    return null;
  }

  /**
   * UI badge entry point — returns a simple freshness object for the header.
   *
   * @param {AppConfig} config
   * @return {{ status: string, ageHours: (number|null), lastRefresh: string, details: Array<Object> }}
   */
  function getFreshnessForUI(config) {
    var snapshot = getFreshnessSnapshot(config);
    return mapSnapshotToUiBadge_(snapshot, config);
  }

  /**
   * Full diagnostic snapshot for the active spreadsheet (or one passed in options).
   *
   * @param {AppConfig} config
   * @param {Object=} options
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} options.spreadsheet
   * @return {Object}
   */
  function getFreshnessSnapshot(config, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(config);
    var thresholds = resolveThresholds_(cfg.freshness, options, null);
    var ss = options.spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
    var appId = cfg.appId || 'UNKNOWN';
    var label = (cfg.ui && cfg.ui.appTitle) ? cfg.ui.appTitle : appId;

    return buildSnapshotForSpreadsheet_(
      ss,
      {
        appId: appId,
        label: label,
        logSheet: cfg.freshness.logSheet || DEFAULT_LOG_SHEET,
        expectedSheets: resolveExpectedSheets_(cfg, ss)
      },
      thresholds
    );
  }

  /**
   * Full diagnostic snapshot for one monitored app spreadsheet (rollup host).
   *
   * @param {Object} appEntry
   * @param {Object=} options
   * @return {Object}
   */
  function getFreshnessSnapshotForSpreadsheet(appEntry, options) {
    options = options || {};
    var thresholds = resolveThresholds_(null, options, appEntry);

    try {
      if (!appEntry || !appEntry.spreadsheetId) {
        return buildErrorSnapshot_(appEntry, 'Missing spreadsheetId', 'Critical');
      }

      var ss = SpreadsheetApp.openById(appEntry.spreadsheetId);
      return buildSnapshotForSpreadsheet_(ss, appEntry, thresholds);
    } catch (e) {
      Logger.log('CoreFreshnessMonitor.getFreshnessSnapshotForSpreadsheet: ' + e);
      return buildErrorSnapshot_(appEntry, String(e), 'Critical');
    }
  }

  /**
   * Evaluate all monitored apps and return a rollup snapshot.
   *
   * @param {Array<Object>} appRegistry
   * @param {Object=} options
   * @return {Object}
   */
  function getRollupSnapshot(appRegistry, options) {
    options = options || {};
    var now = new Date();
    var apps = [];
    var allIssues = [];

    (appRegistry || []).forEach(function (entry) {
      var snap = getFreshnessSnapshotForSpreadsheet(entry, options);
      apps.push(snap);
      if (snap.issues && snap.issues.length) {
        snap.issues.forEach(function (issue) {
          allIssues.push({
            appId: snap.appId,
            label: snap.label,
            severity: issue.severity,
            sheetName: issue.sheetName,
            message: issue.message
          });
        });
      }
    });

    var summary = { ok: 0, warning: 0, critical: 0, unknown: 0 };
    apps.forEach(function (snap) {
      var bucket = String(snap.status || 'Unknown').toLowerCase();
      if (bucket === 'ok') summary.ok++;
      else if (bucket === 'warning') summary.warning++;
      else if (bucket === 'critical') summary.critical++;
      else summary.unknown++;
    });

    return {
      checkedAt: now.toISOString(),
      checkedAtLabel: formatCheckedAtLabel_(now),
      status: aggregateStatus_(apps.map(function (a) { return a.status; })),
      apps: apps,
      issues: allIssues,
      summary: summary
    };
  }

  /**
   * Build rollup snapshot and send the daily summary email.
   *
   * @param {Array<Object>} appRegistry
   * @param {Object=} options
   * @return {Object}
   */
  function sendDailyRollup(appRegistry, options) {
    options = options || {};
    var rollup = getRollupSnapshot(appRegistry, options);
    var recipient = options.recipient || 'jeffrey.ditty@workday.com';
    var sendOkEmail = options.sendOkEmail !== false;
    var overall = rollup.status || 'Unknown';

    if (overall === 'OK' && !sendOkEmail) {
      Logger.log('CoreFreshnessMonitor.sendDailyRollup: OK status; sendOkEmail=false; skipped.');
      return { sent: false, rollup: rollup };
    }

    var subject = overall === 'OK'
      ? 'Daily Deployment Apps Data Freshness — OK'
      : 'Daily Deployment Apps Data Freshness — Action Required';

    var htmlBody = buildEmailHtml_(rollup);
    var textBody = buildEmailText_(rollup);

    try {
      MailApp.sendEmail({
        to: recipient,
        cc: options.cc || '',
        bcc: options.bcc || '',
        subject: subject,
        body: textBody,
        htmlBody: htmlBody
      });
      Logger.log('CoreFreshnessMonitor.sendDailyRollup: email sent to ' + recipient);
      return { sent: true, recipient: recipient, subject: subject, rollup: rollup };
    } catch (e) {
      Logger.log('CoreFreshnessMonitor.sendDailyRollup: ' + e);
      return { sent: false, error: String(e), rollup: rollup };
    }
  }

  /**
   * Install (or replace) a daily time-based trigger for the rollup handler.
   *
   * @param {string} handlerName
   * @param {number=} hourEt
   * @return {{ ok: boolean, handlerName: string, hour: number }}
   */
  function installDailyTrigger(handlerName, hourEt) {
    var hour = (hourEt === undefined || hourEt === null) ? 7 : hourEt;
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (t) {
      if (t.getHandlerFunction && t.getHandlerFunction() === handlerName) {
        ScriptApp.deleteTrigger(t);
      }
    });

    ScriptApp.newTrigger(handlerName)
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();

    Logger.log('CoreFreshnessMonitor.installDailyTrigger: installed ' + handlerName + ' at hour ' + hour);
    return { ok: true, handlerName: handlerName, hour: hour };
  }

  // ---------------------------------------------------------------------------
  // INTERNAL — snapshot builders
  // ---------------------------------------------------------------------------

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {Object} appEntry
   * @param {Object} thresholds
   * @return {Object}
   */
  function buildSnapshotForSpreadsheet_(ss, appEntry, thresholds) {
    var now = new Date();
    var appId = appEntry.appId || 'UNKNOWN';
    var label = appEntry.label || appId;
    var logSheetName = appEntry.logSheet || DEFAULT_LOG_SHEET;
    var expectedSheets = appEntry.expectedSheets && appEntry.expectedSheets.length
      ? appEntry.expectedSheets.slice()
      : DEFAULT_EXPECTED_SHEETS.slice();

    var base = {
      appId: appId,
      label: label,
      spreadsheetId: ss.getId(),
      checkedAt: now.toISOString(),
      checkedAtLabel: formatCheckedAtLabel_(now),
      logSheet: logSheetName,
      expectedSheets: expectedSheets,
      sheets: [],
      issues: [],
      maxAgeHours: null,
      latestRefresh: ''
    };

    var logSh = ss.getSheetByName(logSheetName);
    if (!logSh) {
      base.status = 'Unknown';
      base.issues.push({
        severity: 'Unknown',
        sheetName: '',
        message: 'Log sheet "' + logSheetName + '" not found'
      });
      return base;
    }

    var parsed = parseLogSheet_(logSh);
    if (!expectedSheets.length) {
      base.status = 'Unknown';
      base.issues.push({
        severity: 'Unknown',
        sheetName: '',
        message: 'No expected sheets configured'
      });
      return base;
    }

    var latestBySheet = parsed.latestBySheet;
    var sheetResults = [];
    var issues = [];
    var maxAge = null;
    var latestRefreshIso = '';

    expectedSheets.forEach(function (sheetName) {
      var entry = latestBySheet[sheetName];
      var evaluated = evaluateSheetFreshness_(sheetName, entry, thresholds, now);
      sheetResults.push(evaluated);

      if (evaluated.ageHours !== null && (maxAge === null || evaluated.ageHours > maxAge)) {
        maxAge = evaluated.ageHours;
      }
      if (entry && entry.refreshIso) {
        if (!latestRefreshIso || entry.refreshIso > latestRefreshIso) {
          latestRefreshIso = entry.refreshIso;
        }
      }
      if (evaluated.status !== 'OK') {
        issues.push({
          severity: evaluated.status,
          sheetName: sheetName,
          message: evaluated.message
        });
      }
    });

    if (parsed.parseFailures > 0) {
      issues.push({
        severity: 'Unknown',
        sheetName: '',
        message: parsed.parseFailures + ' log row(s) had unparseable timestamps'
      });
    }

    base.sheets = sheetResults;
    base.issues = issues;
    base.maxAgeHours = maxAge;
    base.latestRefresh = latestRefreshIso;
    base.status = aggregateStatus_(sheetResults.map(function (s) { return s.status; }));
  if (issues.some(function (i) { return i.severity === 'Unknown' && !i.sheetName; }) && base.status === 'OK') {
      base.status = 'Unknown';
    }
    return base;
  }

  /**
   * @param {Object|null} appEntry
   * @param {string} message
   * @param {string} status
   * @return {Object}
   */
  function buildErrorSnapshot_(appEntry, message, status) {
    var now = new Date();
    return {
      appId: (appEntry && appEntry.appId) || 'UNKNOWN',
      label: (appEntry && appEntry.label) || 'Unknown App',
      spreadsheetId: (appEntry && appEntry.spreadsheetId) || '',
      checkedAt: now.toISOString(),
      checkedAtLabel: formatCheckedAtLabel_(now),
      status: status || 'Critical',
      maxAgeHours: null,
      latestRefresh: '',
      logSheet: (appEntry && appEntry.logSheet) || DEFAULT_LOG_SHEET,
      expectedSheets: (appEntry && appEntry.expectedSheets) || [],
      sheets: [],
      issues: [{
        severity: status || 'Critical',
        sheetName: '',
        message: message
      }]
    };
  }

  // ---------------------------------------------------------------------------
  // INTERNAL — log parsing
  // ---------------------------------------------------------------------------

  /**
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
   * @return {{ latestBySheet: Object, parseFailures: number }}
   */
  function parseLogSheet_(sh) {
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      return { latestBySheet: {}, parseFailures: 0 };
    }

    var headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var cols = detectLogColumns_(headerRow);
    var dataStartRow = cols.hasHeader ? 2 : 1;
    if (lastRow < dataStartRow) {
      return { latestBySheet: {}, parseFailures: 0 };
    }

    var vals = sh.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastCol).getValues();
    var latestBySheet = {};
    var parseFailures = 0;

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      var parsedRow = parseLogRow_(row, cols);
      if (!parsedRow) {
        if (row[cols.timeCol] || row[cols.sheetCol]) parseFailures++;
        continue;
      }

      var sheetKey = parsedRow.sheetName;
      var existing = latestBySheet[sheetKey];
      if (!existing || parsedRow.refreshTime.getTime() > existing.refreshTime.getTime()) {
        latestBySheet[sheetKey] = parsedRow;
      }
    }

    return { latestBySheet: latestBySheet, parseFailures: parseFailures };
  }

  /**
   * @param {Array<*>} headerRow
   * @return {{ timeCol: number, sheetCol: number, statusCol: number, messageCol: number, hasHeader: boolean }}
   */
  function detectLogColumns_(headerRow) {
    var cols = {
      timeCol: -1,
      sheetCol: -1,
      statusCol: -1,
      messageCol: -1,
      hasHeader: false
    };

    if (!headerRow || !headerRow.length) {
      cols.timeCol = 0;
      cols.sheetCol = 1;
      return cols;
    }

    var normalized = headerRow.map(function (h) {
      return String(h || '').trim().toLowerCase();
    });

    var hasKnownHeader = false;
    normalized.forEach(function (h) {
      if (!h) return;
      if (TIME_HEADERS.indexOf(h) >= 0 || SHEET_HEADERS.indexOf(h) >= 0 ||
          STATUS_HEADERS.indexOf(h) >= 0 || MESSAGE_HEADERS.indexOf(h) >= 0) {
        hasKnownHeader = true;
      }
    });
    if (!hasKnownHeader) {
      cols.timeCol = 0;
      cols.sheetCol = 1;
      cols.statusCol = 3;
      return cols;
    }

    cols.hasHeader = true;
    for (var c = 0; c < normalized.length; c++) {
      var h = normalized[c];
      if (!h) continue;
      if (cols.timeCol < 0 && TIME_HEADERS.indexOf(h) >= 0) cols.timeCol = c;
      else if (cols.sheetCol < 0 && SHEET_HEADERS.indexOf(h) >= 0) cols.sheetCol = c;
      else if (cols.statusCol < 0 && STATUS_HEADERS.indexOf(h) >= 0) cols.statusCol = c;
      else if (cols.messageCol < 0 && MESSAGE_HEADERS.indexOf(h) >= 0) cols.messageCol = c;
    }

    if (cols.timeCol < 0) cols.timeCol = 0;
    if (cols.sheetCol < 0) cols.sheetCol = 1;
    if (cols.statusCol < 0 && normalized.length > 3) cols.statusCol = 3;
    return cols;
  }

  /**
   * @param {Array<*>} row
   * @param {Object} cols
   * @return {Object|null}
   */
  function parseLogRow_(row, cols) {
    var ts = row[cols.timeCol];
    if (!ts) return null;

    var sheetName = String(row[cols.sheetCol] || '').trim();
    if (!sheetName) return null;

    var date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) return null;

    var statusText = cols.statusCol >= 0 ? String(row[cols.statusCol] || '').trim() : '';
    var message = cols.messageCol >= 0 ? String(row[cols.messageCol] || '').trim() : '';

    return {
      refreshTime: date,
      refreshIso: date.toISOString(),
      sheetName: sheetName,
      statusText: statusText,
      message: message
    };
  }

  // ---------------------------------------------------------------------------
  // INTERNAL — evaluation
  // ---------------------------------------------------------------------------

  /**
   * @param {string} sheetName
   * @param {Object|null} entry
   * @param {Object} thresholds
   * @param {Date} now
   * @return {Object}
   */
  function evaluateSheetFreshness_(sheetName, entry, thresholds, now) {
    if (!entry) {
      return {
        sheetName: sheetName,
        status: 'Missing',
        lastRefresh: '',
        ageHours: null,
        message: 'no refresh log entry found'
      };
    }

    var ageHours = (now.getTime() - entry.refreshTime.getTime()) / 3600000;
    var okMax = thresholds.refreshCycleHours + thresholds.graceHours;
    var status;
    var message;

    if (entry.statusText && entry.statusText !== 'Success') {
      status = 'Critical';
      message = (entry.statusText + (entry.message ? ': ' + entry.message : '')).trim();
    } else if (ageHours > thresholds.criticalHours) {
      status = 'Critical';
      message = Math.round(ageHours) + 'h old; expected <= ' + thresholds.criticalHours + 'h';
    } else if (ageHours > okMax) {
      status = 'Warning';
      message = Math.round(ageHours) + 'h old; expected <= ' + okMax + 'h';
    } else {
      status = 'OK';
      message = Math.round(ageHours) + 'h old';
    }

    return {
      sheetName: sheetName,
      status: status,
      lastRefresh: entry.refreshIso,
      ageHours: ageHours,
      message: message
    };
  }

  /**
   * @param {AppConfig} cfg
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @return {Array<string>}
   */
  function resolveExpectedSheets_(cfg, ss) {
    if (cfg.freshness && Array.isArray(cfg.freshness.expectedSheets) && cfg.freshness.expectedSheets.length) {
      return cfg.freshness.expectedSheets.slice();
    }

    var fromConfig = discoverSfdcSheetsFromConfig_(cfg);
    if (fromConfig.length) return fromConfig;
    return DEFAULT_EXPECTED_SHEETS.slice();
  }

  /**
   * @param {AppConfig} cfg
   * @return {Array<string>}
   */
  function discoverSfdcSheetsFromConfig_(cfg) {
    var names = [];
    var sheets = cfg.sheets || {};
    var seen = {};

    Object.keys(sheets).forEach(function (key) {
      var name = String(sheets[key] || '').trim();
      if (!name || seen[name]) return;
      if (name.indexOf('SFDC_') === 0) {
        seen[name] = true;
        names.push(name);
      }
    });

    return names.length ? names : DEFAULT_EXPECTED_SHEETS.slice();
  }

  /**
   * @param {Object|null} cfgFreshness
   * @param {Object} options
   * @param {Object|null} appEntry
   * @return {Object}
   */
  function resolveThresholds_(cfgFreshness, options, appEntry) {
    var src = {};
    if (options) {
      src.refreshCycleHours = options.refreshCycleHours;
      src.graceHours = options.graceHours;
      src.warningHours = options.warningHours;
      src.criticalHours = options.criticalHours;
    }
    if (cfgFreshness) {
      if (cfgFreshness.refreshCycleHours !== undefined) src.refreshCycleHours = cfgFreshness.refreshCycleHours;
      if (cfgFreshness.graceHours !== undefined) src.graceHours = cfgFreshness.graceHours;
      if (cfgFreshness.warningHours !== undefined) src.warningHours = cfgFreshness.warningHours;
      if (cfgFreshness.criticalHours !== undefined) src.criticalHours = cfgFreshness.criticalHours;
      if (cfgFreshness.amberHours !== undefined && src.warningHours === undefined) {
        src.warningHours = cfgFreshness.amberHours;
      }
      if (cfgFreshness.redHours !== undefined && src.criticalHours === undefined) {
        src.criticalHours = cfgFreshness.redHours;
      }
    }
    if (appEntry) {
      if (appEntry.refreshCycleHours !== undefined) src.refreshCycleHours = appEntry.refreshCycleHours;
      if (appEntry.graceHours !== undefined) src.graceHours = appEntry.graceHours;
      if (appEntry.warningHours !== undefined) src.warningHours = appEntry.warningHours;
      if (appEntry.criticalHours !== undefined) src.criticalHours = appEntry.criticalHours;
    }

    return {
      refreshCycleHours: src.refreshCycleHours !== undefined ? src.refreshCycleHours : 8,
      graceHours: src.graceHours !== undefined ? src.graceHours : 1,
      warningHours: src.warningHours !== undefined ? src.warningHours : 12,
      criticalHours: src.criticalHours !== undefined ? src.criticalHours : 24
    };
  }

  /**
   * @param {Array<string>} statuses
   * @return {string}
   */
  function aggregateStatus_(statuses) {
    var hasCritical = false;
    var hasMissing = false;
    var hasWarning = false;
    var hasUnknown = false;

    (statuses || []).forEach(function (st) {
      if (st === 'Critical') hasCritical = true;
      else if (st === 'Missing') hasMissing = true;
      else if (st === 'Warning') hasWarning = true;
      else if (st === 'Unknown') hasUnknown = true;
    });

    if (hasCritical || hasMissing) return 'Critical';
    if (hasWarning) return 'Warning';
    if (hasUnknown) return 'Unknown';
    return 'OK';
  }

  /**
   * @param {Object} snapshot
   * @param {AppConfig} config
   * @return {Object}
   */
  function mapSnapshotToUiBadge_(snapshot, config) {
    var cfg = CoreConfig.withDefaults(config);
    var primarySheet = _resolvePrimarySheet_(cfg);
    var watchSheet = (cfg.freshness && cfg.freshness.watchSheet) || 'SFDC_Deployments';
    var target = null;
    var sourceSheet = '';

    if (snapshot.sheets && snapshot.sheets.length) {
      var lookupOrder = [primarySheet];
      if (watchSheet && watchSheet !== primarySheet) lookupOrder.push(watchSheet);

      for (var li = 0; li < lookupOrder.length; li++) {
        var candidate = _findSheetFreshness_(snapshot.sheets, lookupOrder[li]);
        if (candidate && candidate.lastRefresh) {
          target = candidate;
          sourceSheet = candidate.sheetName;
          break;
        }
      }

      // IndustryMode only: legacy fallback to the stalest expected sheet.
      if (!target && !_isProductModeApp_(cfg)) {
        snapshot.sheets.forEach(function (s) {
          if (!target || (s.ageHours !== null &&
              (target.ageHours === null || s.ageHours > target.ageHours))) {
            target = s;
            sourceSheet = s.sheetName;
          }
        });
      }
    }

    var uiStatus = 'unknown';
    if (target) {
      if (target.status === 'OK') uiStatus = 'fresh';
      else if (target.status === 'Warning') uiStatus = 'aging';
      else if (target.status === 'Critical' || target.status === 'Missing') uiStatus = 'stale';
      else uiStatus = 'unknown';
    } else if (snapshot.status) {
      uiStatus = monitorStatusToUi_(snapshot.status);
    }

    return {
      status: uiStatus,
      ageHours: target ? target.ageHours : snapshot.maxAgeHours,
      lastRefresh: target ? (target.lastRefresh || '') : (snapshot.latestRefresh || ''),
      sourceSheet: sourceSheet,
      details: snapshot.sheets || []
    };
  }

  /**
   * @param {string} monitorStatus
   * @return {string}
   */
  function monitorStatusToUi_(monitorStatus) {
    if (monitorStatus === 'OK') return 'fresh';
    if (monitorStatus === 'Warning') return 'aging';
    if (monitorStatus === 'Critical') return 'stale';
    return 'unknown';
  }

  // ---------------------------------------------------------------------------
  // INTERNAL — email formatting
  // ---------------------------------------------------------------------------

  /**
   * @param {Date} date
   * @return {string}
   */
  function formatCheckedAtLabel_(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd hh:mm a z');
  }

  /**
   * @param {Object} rollup
   * @return {string}
   */
  function buildEmailText_(rollup) {
    var lines = [
      'Daily Deployment Apps Data Freshness Check',
      'Checked: ' + rollup.checkedAtLabel,
      'Overall Status: ' + rollup.status,
      '',
      'App Summary:'
    ];

    (rollup.apps || []).forEach(function (app) {
      lines.push('- ' + formatAppSummaryLine_(app));
    });

    if (rollup.issues && rollup.issues.length) {
      lines.push('');
      lines.push('Issues:');
      rollup.issues.forEach(function (issue) {
        var prefix = issue.appId || issue.label || 'App';
        lines.push('- ' + prefix + (issue.sheetName ? ' / ' + issue.sheetName : '') + ': ' + issue.message);
      });
    }

    return lines.join('\n');
  }

  /**
   * @param {Object} rollup
   * @return {string}
   */
  function buildEmailHtml_(rollup) {
    var html = [
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;">',
      '<h2 style="margin:0 0 8px 0;">Daily Deployment Apps Data Freshness Check</h2>',
      '<p><strong>Checked:</strong> ' + escapeHtml_(rollup.checkedAtLabel) + '<br>',
      '<strong>Overall Status:</strong> ' + escapeHtml_(rollup.status) + '</p>',
      '<h3 style="margin:16px 0 8px 0;">App Summary</h3>',
      '<ul style="margin:0;padding-left:20px;">'
    ];

    (rollup.apps || []).forEach(function (app) {
      html.push('<li>' + escapeHtml_(formatAppSummaryLine_(app)) + '</li>');
    });
    html.push('</ul>');

    if (rollup.issues && rollup.issues.length) {
      html.push('<h3 style="margin:16px 0 8px 0;">Issues</h3><ul style="margin:0;padding-left:20px;">');
      rollup.issues.forEach(function (issue) {
        var prefix = issue.appId || issue.label || 'App';
        var line = prefix + (issue.sheetName ? ' / ' + issue.sheetName : '') + ': ' + issue.message;
        html.push('<li>' + escapeHtml_(line) + '</li>');
      });
      html.push('</ul>');
    }

    html.push('</div>');
    return html.join('');
  }

  /**
   * @param {Object} app
   * @return {string}
   */
  function formatAppSummaryLine_(app) {
    var agePart = '';
    if (app.maxAgeHours !== null && app.maxAgeHours !== undefined) {
      agePart = ' — latest refresh ' + Math.round(app.maxAgeHours) + 'h ago';
    } else if (app.latestRefresh) {
      agePart = ' — latest refresh recorded';
    }

    if (app.status === 'OK') {
      return app.appId + ': OK' + agePart;
    }

    var issueSheet = '';
    if (app.issues && app.issues.length) {
      var first = app.issues[0];
      issueSheet = first.sheetName ? ' — ' + first.sheetName + ' ' + first.message : ' — ' + first.message;
    }
    return app.appId + ': ' + app.status + issueSheet;
  }

  /**
   * @param {string} text
   * @return {string}
   */
  function escapeHtml_(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Diagnostic: freshness badge inputs and Auto Refresh Execution Log state.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugDataFreshness(config) {
    var cfg = CoreConfig.withDefaults(config);
    var snapshot = getFreshnessSnapshot(config);
    var uiBadge = mapSnapshotToUiBadge_(snapshot, config);
    var primarySheet = _resolvePrimarySheet_(cfg);
    var watchSheet = (cfg.freshness && cfg.freshness.watchSheet) || 'SFDC_Deployments';
    var logLatestBySheet = {};

    (snapshot.sheets || []).forEach(function (sheet) {
      logLatestBySheet[sheet.sheetName] = {
        lastRefresh: sheet.lastRefresh || '',
        ageHours: sheet.ageHours,
        status: sheet.status,
        message: sheet.message || ''
      };
    });

    return {
      appId: cfg.appId || 'UNKNOWN',
      productModeUnionEnabled: _isProductModeApp_(cfg),
      displayedFreshnessTimestamp: uiBadge.lastRefresh || '',
      displayedFreshnessSheet: uiBadge.sourceSheet || '',
      displayedStatus: uiBadge.status,
      displayedAgeHours: uiBadge.ageHours,
      autoRefreshLogLatestBySheet: logLatestBySheet,
      expectedSheets: snapshot.expectedSheets || [],
      primarySheet: primarySheet,
      watchSheet: watchSheet,
      fromCache: false,
      cacheKey: null,
      snapshotStatus: snapshot.status || 'Unknown',
      logSheet: snapshot.logSheet || (cfg.freshness && cfg.freshness.logSheet) || DEFAULT_LOG_SHEET
    };
  }

  return {
    getFreshnessForUI: getFreshnessForUI,
    getFreshnessSnapshot: getFreshnessSnapshot,
    getFreshnessSnapshotForSpreadsheet: getFreshnessSnapshotForSpreadsheet,
    getRollupSnapshot: getRollupSnapshot,
    sendDailyRollup: sendDailyRollup,
    installDailyTrigger: installDailyTrigger,
    _debugDataFreshness: _debugDataFreshness
  };
})();
