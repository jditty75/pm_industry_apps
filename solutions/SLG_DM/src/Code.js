/**
 * SLG Deployment Health – Top-level code wired to CoreLib.
 *
 * Responsibilities:
 * - UI menu and "Open Web App" entry.
 * - SLG-specific TABLES + BAR_CONFIG configuration.
 * - Thin wrappers to CoreLib for:
 *   - updateHealthAnalytics_ (snapshot-based analytics)
 *   - previewHtml (inline HTML preview)
 *   - exportHtmlToDrive (inline + Outlook HTML export)
 * - Optional debug helpers for table detection.
 *
 * NOTE:
 * - Requires APP_CONFIG from Config_SLG.gs
 * - Requires CoreLib library added to project.
 */

// ============================================================================
// 1. CONFIG-LIKE CONSTANTS (TABLES, BAR_CONFIG, WEB_APP_URL)
// ============================================================================

// Set this to your deployed Web App URL for SLG
var WEB_APP_URL =
  'https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA/exec';

/**
 * TABLES:
 *  - sheetName : Sheet tab the table lives on.
 *  - title     : Legacy text label for fallback dynamic search/debug.
 *  - namedRange: Named range with the full table (header + data).
 *  - heading   : Section heading in the HTML report (purely presentational).
 *  - description: Optional subtitle under the heading.
 */
var TABLES = [
  {
    sheetName:   'Dashboard',
    title:       'Executive Summary',
    namedRange:  'ExecSummary_Tbl',
    heading:     'Executive Summary',
    description: 'High-level summary of deployment health and key highlights.'
  },
  {
    sheetName:   'Dashboard',
    title:       'HealthTotal',
    namedRange:  'HealthTotal',
    heading:     'Deployment Health Breakdown',
    description: 'Overall health totals by metric.'
  },
  {
    sheetName:   'RedYellow_TBL',
    title:       'RedYellow',
    namedRange:  'RedYellow',
    heading:     'Red / Yellow Deployments',
    description: 'Listing of all deployments in Red or Yellow Status.'
  },
  {
    sheetName:   'Dashboard',
    title:       'PartnerTotal',
    namedRange:  'PartnerTotal',
    heading:     'Partner Breakdown',
    description: 'Metrics and performance broken down by partner.'
  },
  {
    sheetName:   'Dashboard',
    title:       'ApproachTotal',
    namedRange:  'ApproachTotal',
    heading:     'Approach Breakdown',
    description: 'Deployment approaches and their distribution.'
  },
  {
    sheetName:   'RecentGL_TBL',
    title:       'RecentGoLives',
    heading:     'Recent Go Lives',
    description: 'Deployments that have gone live in the last 60 days.'
  },
  {
    sheetName:   'FutureGL_TBL',
    title:       'FutureGoLives',
    heading:     'Upcoming Go Lives',
    description: 'Deployments scheduled to go live in the next 90 days.'
  }
];

/**
 * BAR_CONFIG:
 *  - Keyed by namedRange (NOT by heading).
 *  - Columns property is an array of 1-based column indices that should be
 *    rendered as percentage bars rather than plain text.
 */
var BAR_CONFIG = {
  HealthTotal: {
    columns: [2], // typically % column
    mode: 'solid',
    colors: { solid: '#0f4c81' }
  },
  PartnerTotal: {
    columns: [2],
    mode: 'solid',
    colors: { solid: '#0f4c81' }
  },
  ApproachTotal: {
    columns: [2],
    mode: 'solid',
    colors: { solid: '#0f4c81' }
  }
  // RedYellow, RecentGoLives, FutureGoLives use custom builders via CoreLib
};

// ============================================================================
// 2. MENU + OPEN WEB APP
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 SLG Deployment Health Tools')
    .addItem('🌐 Open Web App', 'openWebApp')
    .addSeparator()
    .addItem('▶ Preview HTML report', 'previewHtml')
    .addItem('💾 Export HTML to My Drive', 'exportHtmlToDrive')
    .addSeparator()
    .addItem('📧 Send Monthly Report (New)', 'sendMonthlyReportNew')
    .addItem('🧪 Send Test Monthly Report (New)', 'sendMonthlyReportTestNew')
    .addSeparator()
    .addItem('🔍 Debug: Show detected table ranges', 'debugShowTableRanges')
    .addItem('🔍 Debug: Show all cell values', 'debugShowCellValues')
    .addToUi();
}

/**
 * Opens the deployed Web App in a new tab and shows a quick link.
 */
function openWebApp() {
  var url = WEB_APP_URL || '';
  if (!url) {
    SpreadsheetApp.getActive().toast('WEB_APP_URL is not configured', 'Error', 5);
    return;
  }

  var html =
    '<html><body style="font-family:Arial,sans-serif; font-size:12px; padding:16px;">' +
    '<p>The SLG Deployment Health Web App will open in a new tab.</p>' +
    '<p><a href="' + url + '" target="_blank">Open Web App</a></p>' +
    '<script>' +
    'try { window.open("' + url + '", "_blank"); } catch (e) {}' +
    'google.script.host.close();' +
    '</script>' +
    '</body></html>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(420).setHeight(140),
    'Open Web App'
  );
}

// ============================================================================
// 3. ANALYTICS + REPORT (WIRED TO CORELIB)
// ============================================================================

/**
 * Master pipeline (snapshot-based) for ALL apps:
 *  - Take Health snapshot from ActiveDeployments into HealthReportSnapshots
 *  - Populate Dashboard!HealthTotal (E/F/I/J) from snapshots
 */
function updateHealthAnalytics_() {
  CoreLib.CoreAnalytics.update(APP_CONFIG);
}

/**
 * Preview HTML report in a modal window (inline HTML version).
 * Runs analytics first, then builds inline report via CoreLib.
 */
function previewHtml() {
  var html = CoreLib.CoreReport.buildInlineHtmlWithAnalytics(APP_CONFIG);
  var output = HtmlService.createHtmlOutput(html)
    .setWidth(1020)
    .setHeight(680);

  SpreadsheetApp.getUi()
    .showModalDialog(output, APP_CONFIG.report.title + ' – Preview');
}

/**
 * Export inline (pure HTML) + Outlook-optimized HTML into My Drive root.
 */
function exportHtmlToDrive() {
  CoreLib.CoreReport.exportInlineAndOutlookToDrive(APP_CONFIG);
}

/**
 * N8: menu wrapper — native Gmail production send (V2 report).
 */
function sendMonthlyReportNew() {
  var result = sendMonthlyReport();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    result.status + (result.error ? ': ' + result.error : ''),
    'Send Monthly Report (New)',
    10
  );
}

/**
 * N8: menu wrapper — test send to self, no distribution log.
 */
function sendMonthlyReportTestNew() {
  var result = sendMonthlyReportTest();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    result.status + (result.error ? ': ' + result.error : ''),
    'Send Test Monthly Report (New)',
    10
  );
}

// ============================================================================
// 4. DEBUG HELPERS (OPTIONAL, LOCAL IMPLEMENTATIONS)
// ============================================================================

/**
 * Debug: Show which ranges are detected for each TABLES config entry,
 * using named ranges and a dynamic fallback finder.
 */
function debugShowTableRanges() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = TABLES.map(function (tableCfg) {
    var sheet = ss.getSheetByName(tableCfg.sheetName);
    var range = null;
    var address = '';
    var color = '';
    var status = '';

    if (!sheet) {
      address = '(sheet missing)';
      color = '#cc0000';
      status = '✗ Sheet not found';
    } else if (tableCfg.namedRange) {
      var nr = ss.getRangeByName(tableCfg.namedRange);
      if (nr) {
        range = nr;
        address = nr.getA1Notation() + ' (named: ' + tableCfg.namedRange + ')';
        color = '#1a7a1a';
        status = '✅ Found via named range';
      } else {
        var dynRange = findTableDynamicDebug_(sheet, tableCfg.title);
        if (dynRange) {
          range = dynRange;
          address =
            dynRange.getA1Notation() +
            ' (fallback: dynamic "' + tableCfg.title + '")';
          color = '#e67e22';
          status = '⚠ Named range missing; used dynamic';
        } else {
          address = '(named range & title not found)';
          color = '#cc0000';
          status = '✗ Named range and title not found';
        }
      }
    } else {
      var dyn = findTableDynamicDebug_(sheet, tableCfg.title);
      if (dyn) {
        range = dyn;
        address = dyn.getA1Notation() + ' (dynamic)';
        color = '#1a7a1a';
        status = '✅ Found via dynamic title';
      } else {
        address = '(not found)';
        color = '#cc0000';
        status = '✗ Title not found';
      }
    }

    return (
      '<tr>' +
      '<td style="border:1px solid #ccc; padding:5px 8px;">' +
      escapeHtmlDebug_(tableCfg.sheetName) +
      '</td>' +
      '<td style="border:1px solid #ccc; padding:5px 8px;">' +
      escapeHtmlDebug_(tableCfg.title || '') +
      '</td>' +
      '<td style="border:1px solid #ccc; padding:5px 8px;">' +
      escapeHtmlDebug_(tableCfg.namedRange || '') +
      '</td>' +
      '<td style="border:1px solid #ccc; padding:5px 8px; color:' + color + ';">' +
      status +
      '</td>' +
      '<td style="border:1px solid #ccc; padding:5px 8px; color:' + color + ';">' +
      escapeHtmlDebug_(address) +
      '</td>' +
      '</tr>'
    );
  }).join('');

  var bodyHtml =
    '<table style="border-collapse:collapse; font-size:12px; width:100%;">' +
    '<thead><tr>' +
    '<th style="border:1px solid #ccc; padding:5px 8px; background:#f3f3f3;">Sheet</th>' +
    '<th style="border:1px solid #ccc; padding:5px 8px; background:#f3f3f3;">Title in Config</th>' +
    '<th style="border:1px solid #ccc; padding:5px 8px; background:#f3f3f3;">Named Range</th>' +
    '<th style="border:1px solid #ccc; padding:5px 8px; background:#f3f3f3;">Status</th>' +
    '<th style="border:1px solid #ccc; padding:5px 8px; background:#f3f3f3;">Detected Range</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<html><body style="font-family:Arial,sans-serif; font-size:12px; padding:12px;">' +
      '<p style="font-weight:bold; margin-bottom:10px;">' +
      'Dynamic / Named-Range Table Scan Results' +
      '</p>' +
      bodyHtml +
      '</body></html>'
    ).setWidth(780).setHeight(480),
    'Debug – Table Ranges'
  );
}

/**
 * Debug: Show sample cell values for sheets in TABLES list (first 10 columns).
 */
function debugShowCellValues() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetFlags = {};
  TABLES.forEach(function (t) {
    sheetFlags[t.sheetName] = true;
  });

  var sheetNames = Object.keys(sheetFlags);
  var sections = sheetNames.map(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return '<h3 style="color:#cc0000;">Sheet "' +
        escapeHtmlDebug_(sheetName) +
        '" not found.</h3>';
    }

    var data = sheet.getDataRange().getDisplayValues();
    var numRows = data.length;
    var numCols = Math.min(data[0] ? data[0].length : 0, 10);

    var rows = [];
    for (var r = 0; r < numRows; r++) {
      for (var c = 0; c < numCols; c++) {
        var val = data[r][c];
        if (val.toString().trim() === '') continue;
        var address = sheet.getRange(r + 1, c + 1).getA1Notation();
        rows.push(
          '<tr>' +
          '<td style="border:1px solid #ccc; padding:4px 8px; ' +
          'white-space:nowrap; font-weight:bold; color:#0f4c81;">' +
          escapeHtmlDebug_(address) +
          '</td>' +
          '<td style="border:1px solid #ccc; padding:4px 8px;">' +
          escapeHtmlDebug_(val.toString()) +
          '</td>' +
          '</tr>'
        );
      }
    }

    return (
      '<h3 style="margin-top:16px;">Sheet: ' +
      escapeHtmlDebug_(sheetName) +
      '</h3>' +
      '<table style="border-collapse:collapse; font-size:11px; width:100%;">' +
      '<thead><tr>' +
      '<th style="border:1px solid #ccc; padding:4px 8px; background:#f3f3f3;">Cell</th>' +
      '<th style="border:1px solid #ccc; padding:4px 8px; background:#f3f3f3;">Value</th>' +
      '</tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
      '</table>'
    );
  }).join('<hr style="margin:12px 0;">');

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<html><body style="font-family:Arial,sans-serif; font-size:12px; padding:12px;">' +
      '<p style="font-weight:bold; margin-bottom:10px;">' +
      'Cell Values (first 10 columns) for all table sheets' +
      '</p>' +
      sections +
      '</body></html>'
    ).setWidth(720).setHeight(520),
    'Debug – Cell Values'
  );
}

// ============================================================================
// 5. LOCAL DEBUG HELPERS
// ============================================================================

function escapeHtmlDebug_(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function normalizeTextDebug_(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Minimal dynamic table finder used only for debugShowTableRanges.
 */
function findTableDynamicDebug_(sheet, title) {
  if (!title) return null;

  var data = sheet.getDataRange().getDisplayValues();
  var numRows = data.length;
  if (!numRows) return null;
  var numCols = data[0].length;

  var needle = normalizeTextDebug_(title);
  var candidates = [];

  for (var r = 0; r < numRows; r++) {
    for (var c = 0; c < numCols; c++) {
      if (normalizeTextDebug_(data[r][c]) === needle) {
        candidates.push({ row: r, col: c });
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  var match = candidates[0];
  var titleR = match.row;
  var titleC = match.col;

  var headerRow;
  var titleRowNonEmpty = data[titleR].slice(titleC).filter(function (cell) {
    return cell.toString().trim() !== '';
  }).length;

  if (titleRowNonEmpty <= 1 && titleR + 1 < numRows) {
    var nextRowNonEmpty = data[titleR + 1].slice(titleC).filter(function (cell) {
      return cell.toString().trim() !== '';
    }).length;
    if (nextRowNonEmpty > 1) {
      headerRow = titleR + 1;
    } else {
      headerRow = titleR;
    }
  } else {
    headerRow = titleR;
  }

  var endCol = titleC;
  for (var col = titleC; col < numCols; col++) {
    if (data[headerRow][col].toString().trim() === '') break;
    endCol = col;
  }

  var endRow = headerRow;
  for (var row = headerRow + 1; row < numRows; row++) {
    var slice = data[row].slice(titleC, endCol + 1);
    var isEmpty = slice.every(function (cell) {
      return cell.toString().trim() === '';
    });
    if (isEmpty) break;
    endRow = row;
  }

  var startR = headerRow + 1;
  var startC = titleC + 1;
  var numR = endRow - headerRow + 1;
  var numC = endCol - titleC + 1;

  if (numR <= 0 || numC <= 0) {
    return null;
  }
  return sheet.getRange(startR, startC, numR, numC);
}

function fixExecSummaryBullets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ExecSummary');
  var cell = sheet.getRange('B2');
  var html = cell.getValue();

  if (!html) {
    Logger.log('B2 is empty — nothing to fix');
    return;
  }

  Logger.log('Before (first 500 chars): ' + html.substring(0, 500));

  // Strip leading Word bullets from <li> content:
  //   - After <li> opening tag: any whitespace/nbsp, then bullet char, then whitespace/nbsp
  //   - Bullet chars: · • ◦ ▪ ● ○ – — - *
  var bulletChars = '\u00B7\u2022\u25E6\u25AA\u25CF\u25CB\u2013\u2014\\-\\*';
  var re = new RegExp('(<li[^>]*>)[\\s\\u00A0]*[' + bulletChars + '][\\s\\u00A0]+', 'gi');
  var cleaned = html.replace(re, '$1');

  // Also handle the case where the <li> immediately opens with <strong>
  // and the bullet is sitting outside/before it (defensive)
  var re2 = new RegExp('(<li[^>]*>)[\\s\\u00A0]*[' + bulletChars + '][\\s\\u00A0]*(<)', 'gi');
  cleaned = cleaned.replace(re2, '$1$2');

  Logger.log('After (first 500 chars): ' + cleaned.substring(0, 500));

  cell.setValue(cleaned);
  Logger.log('Done. B2 updated.');
}