/**
 * CoreDeploymentSignalWorkbook.js
 *
 * Spreadsheet read/write for Deployment Signal sheets (SLG).
 */

var CoreDeploymentSignalWorkbook = {

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} sheetName
   * @param {Array<string>} headers
   */
  ensureSheetHeaders: function (ss, sheetName, headers) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    var merged = existing.slice();
    var changed = false;
    (headers || []).forEach(function (h) {
      if (merged.indexOf(h) < 0) {
        merged.push(h);
        changed = true;
      }
    });
    if (changed || !existing.length) {
      sheet.getRange(1, 1, 1, merged.length).setValues([merged]);
    }
    return sheet;
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Array<string>} headers
   * @return {Array<Object>}
   */
  readDataRows: function (sheet, headers) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var width = Math.max(headers.length, sheet.getLastColumn());
    var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    var hdr = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) {
      return String(h || '').trim();
    });
    return values.map(function (row) {
      return CoreDeploymentSignalStore.arrayToRow(row, hdr);
    });
  },

  /**
   * Replace current-signals body (full refresh of active state).
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Array<string>} headers
   * @param {Array<Object>} rows
   */
  replaceCurrentBody: function (sheet, headers, rows) {
    var dataArrays = (rows || []).map(function (r) {
      return CoreDeploymentSignalStore.rowToArray(r, headers);
    });
    CoreDeploymentTrajectory._writeSheet_(
      SpreadsheetApp.getActiveSpreadsheet(),
      sheet.getName(),
      headers,
      dataArrays);
  },

  /**
   * Append rows to history or runs sheet.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {Array<string>} headers
   * @param {Array<Object>} rows
   */
  appendBodyRows: function (sheet, headers, rows) {
    if (!rows || !rows.length) return;
    CoreDeploymentSignalWorkbook.ensureSheetHeaders(
      SpreadsheetApp.getActiveSpreadsheet(), sheet.getName(), headers);
    var start = Math.max(sheet.getLastRow(), 1) + 1;
    if (sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      start = 2;
    }
    var matrix = rows.map(function (r) {
      return CoreDeploymentSignalStore.rowToArray(r, headers);
    });
    sheet.getRange(start, 1, start + matrix.length - 1, headers.length).setValues(matrix);
  }
};
