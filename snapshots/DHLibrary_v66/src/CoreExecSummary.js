/**
 * CoreExecSummary.gs
 *
 * Shared Executive Summary helpers.
 *
 * Responsibilities:
 * - Store and retrieve the rich HTML used at the top of the monthly report
 *   (WebApp editor uses this via google.script.run).
 * - Provide a fallback to list-style summary if no rich HTML is stored
 *   (used by CoreReport when building sections).
 */

var CoreExecSummary = (function () {

  /**
   * Returns the stored Executive Summary HTML string from ExecSummary!B2.
   *
   * @param {AppConfig} config
   * @return {string}
   */
  function get(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(cfg.sheets.execSummary);
    if (!sheet) return '';

    var cell = sheet.getRange('B2');
    var value = cell.getValue();
    return value ? String(value) : '';
  }

  /**
   * Saves the Executive Summary HTML into ExecSummary!B2 and writes
   * audit info to B3/B4:
   *   B3: "Last updated by: ..."
   *   B4: "Last updated at: yyyy-MM-dd HH:mm:ss"
   *
   * @param {AppConfig} config
   * @param {string} html
   * @return {{success:boolean}}
   */
  function save(config, html) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(cfg.sheets.execSummary);
    if (!sheet) {
      sheet = ss.insertSheet(cfg.sheets.execSummary);
    }

    sheet.getRange('B2').setValue(html || '');

    var user = Session.getActiveUser().getEmail() ||
               Session.getEffectiveUser().getEmail() || 'unknown';
    var now = new Date();

    sheet.getRange('B3').setValue('Last updated by: ' + user);
    sheet.getRange('B4').setValue(
      'Last updated at: ' +
      Utilities.formatDate(
        now,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd HH:mm:ss'
      )
    );

    return { success: true };
  }

  /**
   * Builds the Executive Summary HTML block for the report, including:
   * - Section heading "Executive Summary"
   * - Body content:
   *   - Stored rich HTML from ExecSummary!B2, OR
   *   - Fallback list from ExecSummary!A2:A30 (Gemini bullet-style summary)
   *
   * Returns an empty string if no content is available.
   *
   * @param {AppConfig} config
   * @return {string}
   */
  function buildSectionHtml(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1) Try stored rich HTML (used by WebApp editor)
    var manualHtml = '';
    try {
      manualHtml = get(cfg) || '';
    } catch (err) {
      Logger.log('CoreExecSummary.get() call failed: ' + err);
    }

    if (manualHtml && manualHtml.toString().trim() !== '') {
      var headingHtml = renderSectionHeading_('Executive Summary');
      return (
        '<div style="margin-bottom:32px;">' +
        headingHtml +
        '<div style="font-family:Arial,sans-serif; font-size:12px; color:#333333; ' +
        'line-height:1.5; margin-top:6px;">' +
        manualHtml +
        '</div>' +
        '</div>'
      );
    }

    // 2) Fallback: original Gemini-based summary from ExecSummary!A2:A30
    var sheet = ss.getSheetByName(cfg.sheets.execSummary);
    if (!sheet) {
      Logger.log(cfg.sheets.execSummary + ' sheet not found. Skipping Executive Summary.');
      return '';
    }

    var range = sheet.getRange('A2:A30');
    var values = range.getValues();
    var lines = values
      .map(function (row) { return (row[0] || '').toString().trim(); })
      .filter(function (line) { return line !== ''; });

    if (!lines.length) {
      Logger.log(cfg.sheets.execSummary + '!A2:A30 empty. Skipping Executive Summary.');
      return '';
    }

    var headingHtml2 = renderSectionHeading_('Executive Summary');
    var items = lines
      .map(function (line) {
        line = line.replace(/^[-*•]\s*/, '');
        return '<li>' + CoreUtils.escapeHtml(line) + '</li>';
      })
      .join('');

    var bodyHtml =
      '<ul style="font-family:Arial,sans-serif; font-size:12px; color:#333333; ' +
      'margin:0 0 10px 20px; padding:0;">' +
      items +
      '</ul>';

    return (
      '<div style="margin-bottom:32px;">' +
      headingHtml2 +
      bodyHtml +
      '</div>'
    );
  }

  /**
   * Local helper for section headings to keep style consistent with other sections.
   *
   * @param {string} text
   * @return {string}
   * @private
   */
  function renderSectionHeading_(text) {
    return (
      '<h2 style="font-family:Arial,sans-serif; color:#0f4c81; font-size:15px; ' +
      'border-bottom:2px solid #0f4c81; padding-bottom:4px; margin-bottom:6px;">' +
      CoreUtils.escapeHtml(text) +
      '</h2>'
    );
  }

  // --- EXPORTS ---------------------------------------------------------------

  return {
    get: get,
    save: save,
    buildSectionHtml: buildSectionHtml
  };
})();