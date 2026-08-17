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

    var cleaned = _sanitizeExecHtml_(html || '');
    sheet.getRange('B2').setValue(cleaned);

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

  /**
   * Allowlisted tag names for Executive Summary rich HTML.
   * @type {Object<string, boolean>}
   * @private
   */
  var EXEC_HTML_ALLOWED_TAGS_ = {
    h2: true, h3: true, h4: true, p: true,
    ul: true, ol: true, li: true,
    strong: true, b: true, em: true, i: true, u: true, br: true
  };

  /**
   * Regex/string sanitizer for Executive Summary HTML (server-side; no DOMParser).
   * Keeps allowlisted tags with attributes stripped; unwraps all other tags;
   * removes comments and Office cruft; drops empty list elements.
   *
   * @param {string} html
   * @return {string}
   * @private
   */
  function _sanitizeExecHtml_(html) {
    if (!html) return '';
    var s = String(html);

    // Remove HTML comments (incl. StartFragment/EndFragment).
    s = s.replace(/<!--[\s\S]*?-->/g, '');

    // Strip Office-specific tags and mso-* fragments.
    s = s.replace(/<\/?o:p[^>]*>/gi, '');
    s = s.replace(/\bmso-[^;:"\s>]+/gi, '');

    // Normalize tags: keep allowlisted (attributes stripped); unwrap others.
    var prev;
    do {
      prev = s;
      s = s.replace(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g, function (match, tagName, attrs) {
        var isClose = match.charAt(1) === '/';
        tagName = tagName.toLowerCase();
        if (tagName.indexOf(':') !== -1) return '';
        if (!EXEC_HTML_ALLOWED_TAGS_[tagName]) return '';
        if (isClose) return '</' + tagName + '>';
        if (tagName === 'br') return '<br>';
        return '<' + tagName + '>';
      });
    } while (s !== prev);

    // Drop empty list elements.
    var listPrev;
    do {
      listPrev = s;
      s = s.replace(/<ul>\s*<\/ul>/gi, '');
      s = s.replace(/<ol>\s*<\/ol>/gi, '');
      s = s.replace(/<li>\s*<\/li>/gi, '');
    } while (s !== listPrev);

    // Collapse redundant whitespace between tags and around text.
    s = s.replace(/>\s+</g, '><');
    s = s.replace(/\s+/g, ' ').trim();

    return s;
  }

  /**
   * Returns true when sanitized HTML has no visible text content.
   *
   * @param {string} html
   * @return {boolean}
   * @private
   */
  function isExecHtmlEmpty_(html) {
    if (!html || String(html).trim() === '') return true;
    var textOnly = String(html)
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return textOnly === '';
  }

  /**
   * N8 V2: reads plain bullet lines from ExecSummary!B2 (one per line).
   * Strips leading list markers; ignores empty lines.
   * Unused by buildSectionHtmlV2 after N8.2; retained for reference.
   *
   * @param {AppConfig} config
   * @return {Array<string>}
   * @private
   */
  function getBulletLinesV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var raw = '';
    try {
      raw = get(cfg) || '';
    } catch (err) {
      Logger.log('CoreExecSummary.getBulletLinesV2_: get() failed: ' + err);
      return [];
    }

    if (!raw || String(raw).trim() === '') return [];

    return String(raw)
      .split(/\r?\n/)
      .map(function (line) { return line.replace(/^[-*•]\s*/, '').trim(); })
      .filter(function (line) { return line !== ''; });
  }

  /**
   * N8 V2: Executive Summary — sanitized rich HTML passthrough from ExecSummary!B2.
   * Returns empty string when no content.
   *
   * @param {AppConfig} config
   * @return {string}
   */
  function buildSectionHtmlV2(config) {
    var cfg = CoreConfig.withDefaults(config);
    var raw = '';
    try {
      raw = get(cfg) || '';
    } catch (err) {
      Logger.log('CoreExecSummary.buildSectionHtmlV2: get() failed: ' + err);
      return '';
    }

    var bodyHtml = _sanitizeExecHtml_(raw);
    if (isExecHtmlEmpty_(bodyHtml)) {
      Logger.log('CoreExecSummary.buildSectionHtmlV2: no content; skipping section.');
      return '';
    }

    var headingHtml = renderSectionHeading_('Executive Summary');
    return (
      '<div style="margin-bottom:32px;">' +
      headingHtml +
      '<div style="font-family:Arial,sans-serif; font-size:12px; color:#333333; ' +
      'line-height:1.5; margin-top:6px;">' +
      bodyHtml +
      '</div>' +
      '</div>'
    );
  }

  // --- EXPORTS ---------------------------------------------------------------

  return {
    get: get,
    save: save,
    buildSectionHtml: buildSectionHtml,
    buildSectionHtmlV2: buildSectionHtmlV2
  };
})();