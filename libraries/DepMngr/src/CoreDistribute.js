/**
 * CoreDistribute.js
 *
 * N8: Native Gmail distribution for the V2 monthly report.
 * Reuses CoreReport.buildReportV2WithAnalytics and CoreNotify._gmailSend_.
 */

var CoreDistribute = (function () {

  var LOG_HEADERS_ = [
    'timestamp', 'appId', 'monthLabel', 'fromAlias', 'subject',
    'toCount', 'ccCount', 'toList', 'ccList', 'status', 'error',
    'messageId', 'threadId', 'sentBy', 'mode'
  ];

  /**
   * Builds the V2 monthly report HTML (with analytics refresh).
   *
   * @param {AppConfig} config
   * @return {string}
   */
  function buildReport(config) {
    return CoreReport.buildReportV2WithAnalytics(config);
  }

  /**
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _monthLabel_(config) {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM yyyy');
  }

  /**
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _appTitle_(config) {
    var cfg = CoreConfig.withDefaults(config);
    return (cfg.ui && cfg.ui.appTitle) || cfg.report.title || cfg.appId || 'Deployment Health';
  }

  /**
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _buildSubject_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var tpl = (cfg.report.distribution && cfg.report.distribution.subjectTemplate) ||
      '{{appTitle}} \u2014 Monthly Deployment Health Report \u2014 {{monthLabel}}';
    return tpl
      .replace(/\{\{appTitle\}\}/g, _appTitle_(cfg))
      .replace(/\{\{monthLabel\}\}/g, _monthLabel_(cfg));
  }

  /**
   * @return {string}
   * @private
   */
  function _executingUser_() {
    return Session.getActiveUser().getEmail() ||
           Session.getEffectiveUser().getEmail() || 'unknown';
  }

  /**
   * Idempotent ReportDistributionLog sheet creation.
   *
   * @param {AppConfig} config
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   * @private
   */
  function initReportDistributionLog_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var sheetName = (cfg.report.distribution && cfg.report.distribution.logSheet) ||
      'ReportDistributionLog';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, LOG_HEADERS_.length).setValues([LOG_HEADERS_]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, LOG_HEADERS_.length).setFontWeight('bold');
      Logger.log('CoreDistribute.initReportDistributionLog_: created ' + sheetName);
      return sheet;
    }

    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    var missing = LOG_HEADERS_.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      var startCol = existing.length + 1;
      sheet.getRange(1, startCol, 1, startCol + missing.length - 1).setValues([missing]);
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
      Logger.log('CoreDistribute.initReportDistributionLog_: added columns: ' + missing.join(', '));
    }
    return sheet;
  }

  /**
   * @param {AppConfig} config
   * @param {Object} row
   * @private
   */
  function appendDistributionLogRow_(config, row) {
    var sheet = initReportDistributionLog_(config);
    var values = LOG_HEADERS_.map(function (h) {
      return row[h] !== undefined && row[h] !== null ? row[h] : '';
    });
    sheet.appendRow(values);
    Logger.log('CoreDistribute.appendDistributionLogRow_: status=' + row.status +
      ', month=' + row.monthLabel);
  }

  /**
   * Best-effort capture of sent message/thread IDs via Gmail search.
   *
   * @param {string} subject
   * @param {string} fromAlias
   * @return {{messageId: string, threadId: string}}
   * @private
   */
  function _captureSentMessageIds_(subject, fromAlias) {
    var result = { messageId: '', threadId: '' };
    try {
      var q = 'in:sent newer_than:2m from:' + fromAlias + ' subject:"' +
        String(subject).replace(/"/g, '') + '"';
      var threads = GmailApp.search(q, 0, 1);
      if (!threads.length) return result;
      var thread = threads[0];
      result.threadId = thread.getId();
      var messages = thread.getMessages();
      if (messages.length) {
        result.messageId = messages[messages.length - 1].getId();
      }
    } catch (e) {
      Logger.log('CoreDistribute._captureSentMessageIds_: search failed: ' + e);
    }
    return result;
  }

  /**
   * @param {Array<string>} list
   * @return {string}
   * @private
   */
  function _joinRecipients_(list) {
    return (list || []).map(function (e) { return String(e || '').trim(); })
      .filter(function (e) { return e !== ''; })
      .join(', ');
  }

  /**
   * Sends the V2 monthly report via native Gmail send-as.
   *
   * @param {AppConfig} config
   * @param {Object=} opts
   * @return {{status: string, error?: string}}
   */
  function sendMonthlyReport(config, opts) {
    opts = opts || {};
    var cfg = CoreConfig.withDefaults(config);
    var dist = cfg.report.distribution || {};
    var monthLabel = _monthLabel_(cfg);
    var subject = _buildSubject_(cfg);
    var fromAlias = String(dist.fromAlias || '').trim();
    var toList = Array.isArray(dist.to) ? dist.to.slice() : [];
    var ccList = Array.isArray(dist.cc) ? dist.cc.slice() : [];
    var toStr = _joinRecipients_(toList);
    var ccStr = _joinRecipients_(ccList);
    var sentBy = _executingUser_();

    function logRow(status, error, ids, mode) {
      appendDistributionLogRow_(cfg, {
        timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
          'yyyy-MM-dd HH:mm:ss'),
        appId: cfg.appId || '',
        monthLabel: monthLabel,
        fromAlias: fromAlias,
        subject: subject,
        toCount: toList.length,
        ccCount: ccList.length,
        toList: toStr,
        ccList: ccStr,
        status: status,
        error: error || '',
        messageId: (ids && ids.messageId) || '',
        threadId: (ids && ids.threadId) || '',
        sentBy: sentBy,
        mode: mode || 'prod'
      });
    }

    if (!dist.enabled && !opts.force) {
      var disabledMsg = 'distribution disabled (cfg.report.distribution.enabled=false)';
      Logger.log('CoreDistribute.sendMonthlyReport: ' + disabledMsg);
      logRow('skipped', disabledMsg, null, 'prod');
      return { status: 'skipped', error: disabledMsg };
    }

    if (!toStr) {
      var emptyMsg = 'zero recipients';
      Logger.log('CoreDistribute.sendMonthlyReport: ' + emptyMsg);
      logRow('skipped', emptyMsg, null, 'prod');
      return { status: 'skipped', error: emptyMsg };
    }

    if (!fromAlias || cfg.notify.allowedFromAliases.indexOf(fromAlias) < 0) {
      var aliasMsg = 'fromAlias not in cfg.notify.allowedFromAliases: ' + fromAlias;
      Logger.log('CoreDistribute.sendMonthlyReport: ' + aliasMsg);
      logRow('skipped', aliasMsg, null, 'prod');
      return { status: 'skipped', error: aliasMsg };
    }

    var htmlBody;
    try {
      htmlBody = buildReport(cfg);
    } catch (e) {
      var buildErr = 'report build failed: ' + e;
      Logger.log('CoreDistribute.sendMonthlyReport: ' + buildErr);
      logRow('failed', buildErr, null, 'prod');
      return { status: 'failed', error: buildErr };
    }

    var sent = CoreNotify._gmailSend_(toStr, subject, htmlBody, fromAlias, ccStr,
      cfg.notify.allowedFromAliases);
    if (!sent) {
      var sendErr = 'GmailApp send failed or was blocked (see Logs)';
      logRow('failed', sendErr, null, 'prod');
      return { status: 'failed', error: sendErr };
    }

    var ids = _captureSentMessageIds_(subject, fromAlias);
    logRow('sent', '', ids, 'prod');
    Logger.log('CoreDistribute.sendMonthlyReport: sent to ' + toList.length +
      ' recipient(s), messageId=' + ids.messageId);
    return { status: 'sent', messageId: ids.messageId, threadId: ids.threadId };
  }

  /**
   * Test send: same build path, [TEST] prefix, routes to test recipient, NO log row.
   *
   * @param {AppConfig} config
   * @param {string=} testRecipient
   * @return {{status: string, error?: string}}
   */
  function sendMonthlyReportTest(config, testRecipient) {
    var cfg = CoreConfig.withDefaults(config);
    var dist = cfg.report.distribution || {};
    var to = String(testRecipient || cfg.notify.testDefaultRecipient || '').trim();
    var fromAlias = String(dist.fromAlias || '').trim();
    var subject = '[TEST] ' + _buildSubject_(cfg);

    if (!to) {
      Logger.log('CoreDistribute.sendMonthlyReportTest: empty test recipient; skipped.');
      return { status: 'skipped', error: 'empty test recipient' };
    }

    if (!fromAlias || cfg.notify.allowedFromAliases.indexOf(fromAlias) < 0) {
      var aliasMsg = 'fromAlias not in cfg.notify.allowedFromAliases: ' + fromAlias;
      Logger.log('CoreDistribute.sendMonthlyReportTest: ' + aliasMsg);
      return { status: 'skipped', error: aliasMsg };
    }

    var htmlBody;
    try {
      htmlBody = buildReport(cfg);
    } catch (e) {
      Logger.log('CoreDistribute.sendMonthlyReportTest: build failed: ' + e);
      return { status: 'failed', error: String(e) };
    }

    var prodTo = _joinRecipients_(dist.to || []);
    var prodCc = _joinRecipients_(dist.cc || []);
    var banner =
      '<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 14px; ' +
      'margin-bottom:16px;font-family:Arial,sans-serif;font-size:12px;">' +
      '<strong>[TEST]</strong> This is a test send of the N8 monthly report. ' +
      'Production <code>to</code>: ' + CoreUtils.escapeHtml(prodTo || '(none)') + '; ' +
      '<code>cc</code>: ' + CoreUtils.escapeHtml(prodCc || '(none)') +
      '</div>';
    htmlBody = htmlBody.replace(/<body([^>]*)>/i, function (match, attrs) {
      return '<body' + attrs + '>' + banner;
    });

    var sent = CoreNotify._gmailSend_(to, subject, htmlBody, fromAlias, '',
      cfg.notify.allowedFromAliases);
    if (!sent) {
      return { status: 'failed', error: 'GmailApp send failed (see Logs)' };
    }

    Logger.log('CoreDistribute.sendMonthlyReportTest: sent to ' + to + ' from ' + fromAlias);
    return { status: 'sent' };
  }

  return {
    buildReport: buildReport,
    sendMonthlyReport: sendMonthlyReport,
    sendMonthlyReportTest: sendMonthlyReportTest,
    initReportDistributionLog: initReportDistributionLog_
  };
})();
