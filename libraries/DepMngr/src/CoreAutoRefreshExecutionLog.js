/**
 * CoreAutoRefreshExecutionLog.js
 *
 * Generic reader for Deployment Manager "Auto Refresh Execution Log" sheets.
 * App-specific required source lists live in configuration; this module only
 * parses log rows and resolves latest successful refresh timestamps per sheet.
 */

var CoreAutoRefreshExecutionLog = {

  DEFAULT_LOG_SHEET: 'Auto Refresh Execution Log',

  TIME_HEADERS: ['refresh time', 'timestamp', 'time', 'date'],
  SHEET_HEADERS: ['sheet', 'sheet name', 'tab', 'tab name'],
  STATUS_HEADERS: ['status', 'result'],

  /**
   * Latest successful refresh timestamp per sheet name (failed rows ignored).
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {Object=} options
   * @param {string=} options.logSheetName
   * @param {Array<string>=} options.requiredSheets when set, include SOURCE_NOT_READY entries
   * @return {{
   *   logSheetName: string,
   *   latestSuccessBySheet: Object<string, { refreshTime: Date, refreshIso: string }>,
   *   sourceNotReady: Array<string>
   * }}
   */
  getLatestSuccessRefreshBySheet: function (ss, options) {
    options = options || {};
    var logSheetName = options.logSheetName ||
      CoreAutoRefreshExecutionLog.DEFAULT_LOG_SHEET;
    var required = options.requiredSheets || [];
    var out = {
      logSheetName: logSheetName,
      latestSuccessBySheet: {},
      sourceNotReady: []
    };
    if (!ss) return out;

    var sh = ss.getSheetByName(logSheetName);
    if (!sh) {
      required.forEach(function (name) { out.sourceNotReady.push(name); });
      return out;
    }

    var parsed = CoreAutoRefreshExecutionLog._parseLogSheet_(sh);
    Object.keys(parsed.latestSuccessBySheet).forEach(function (key) {
      out.latestSuccessBySheet[key] = parsed.latestSuccessBySheet[key];
    });

    required.forEach(function (sheetName) {
      if (!out.latestSuccessBySheet[sheetName]) {
        out.sourceNotReady.push(sheetName);
      }
    });
    return out;
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
   * @return {{ latestSuccessBySheet: Object }}
   * @private
   */
  _parseLogSheet_: function (sh) {
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    var latestSuccessBySheet = {};
    if (lastRow < 2 || lastCol < 1) {
      return { latestSuccessBySheet: latestSuccessBySheet };
    }

    var headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var cols = CoreAutoRefreshExecutionLog._detectLogColumns_(headerRow);
    var dataStartRow = cols.hasHeader ? 2 : 1;
    if (lastRow < dataStartRow) {
      return { latestSuccessBySheet: latestSuccessBySheet };
    }

    var vals = sh.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var parsedRow = CoreAutoRefreshExecutionLog._parseLogRow_(vals[i], cols);
      if (!parsedRow) continue;
      if (!CoreAutoRefreshExecutionLog._isSuccessStatus_(parsedRow.statusText)) {
        continue;
      }
      var sheetKey = parsedRow.sheetName;
      var existing = latestSuccessBySheet[sheetKey];
      if (!existing || parsedRow.refreshTime.getTime() > existing.refreshTime.getTime()) {
        latestSuccessBySheet[sheetKey] = {
          refreshTime: parsedRow.refreshTime,
          refreshIso: parsedRow.refreshIso,
          sheetName: sheetKey
        };
      }
    }
    return { latestSuccessBySheet: latestSuccessBySheet };
  },

  /**
   * @param {string} statusText
   * @return {boolean}
   * @private
   */
  _isSuccessStatus_: function (statusText) {
    return String(statusText || '').trim().toLowerCase() === 'success';
  },

  /**
   * @param {Array<*>} headerRow
   * @return {Object}
   * @private
   */
  _detectLogColumns_: function (headerRow) {
    var cols = {
      timeCol: -1,
      sheetCol: -1,
      statusCol: -1,
      hasHeader: false
    };
    if (!headerRow || !headerRow.length) {
      cols.timeCol = 0;
      cols.sheetCol = 1;
      cols.statusCol = 3;
      return cols;
    }

    var normalized = headerRow.map(function (h) {
      return String(h || '').trim().toLowerCase();
    });
    var hasKnownHeader = false;
    normalized.forEach(function (h) {
      if (!h) return;
      if (CoreAutoRefreshExecutionLog.TIME_HEADERS.indexOf(h) >= 0 ||
          CoreAutoRefreshExecutionLog.SHEET_HEADERS.indexOf(h) >= 0 ||
          CoreAutoRefreshExecutionLog.STATUS_HEADERS.indexOf(h) >= 0) {
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
      if (cols.timeCol < 0 && CoreAutoRefreshExecutionLog.TIME_HEADERS.indexOf(h) >= 0) {
        cols.timeCol = c;
      } else if (cols.sheetCol < 0 && CoreAutoRefreshExecutionLog.SHEET_HEADERS.indexOf(h) >= 0) {
        cols.sheetCol = c;
      } else if (cols.statusCol < 0 && CoreAutoRefreshExecutionLog.STATUS_HEADERS.indexOf(h) >= 0) {
        cols.statusCol = c;
      }
    }
    if (cols.timeCol < 0) cols.timeCol = 0;
    if (cols.sheetCol < 0) cols.sheetCol = 1;
    if (cols.statusCol < 0 && normalized.length > 3) cols.statusCol = 3;
    return cols;
  },

  /**
   * @param {Array<*>} row
   * @param {Object} cols
   * @return {Object|null}
   * @private
   */
  _parseLogRow_: function (row, cols) {
    var ts = row[cols.timeCol];
    if (!ts) return null;
    var sheetName = String(row[cols.sheetCol] || '').trim();
    if (!sheetName) return null;
    var date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) return null;
    var statusText = cols.statusCol >= 0 ? String(row[cols.statusCol] || '').trim() : '';
    return {
      refreshTime: date,
      refreshIso: date.toISOString(),
      sheetName: sheetName,
      statusText: statusText
    };
  }
};
