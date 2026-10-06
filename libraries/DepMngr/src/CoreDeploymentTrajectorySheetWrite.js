/**
 * CoreDeploymentTrajectorySheetWrite.js
 *
 * Pure helpers for derived-sheet rectangular writes (no SpreadsheetApp).
 * Sheet.getRange(row, column, numRows, numColumns) uses counts, not end indices.
 */

var TrajectorySheetWrite = {

  /** @return {number} */
  headerRow: function () {
    return 1;
  },

  /** @return {number} */
  bodyStartRow: function () {
    return 2;
  },

  /**
   * numRows for setValues on the data body (rows starting at bodyStartRow).
   * @param {number} dataRowCount
   * @return {number}
   */
  bodySetValuesNumRows: function (dataRowCount) {
    return Math.max(0, dataRowCount || 0);
  },

  /**
   * Data rows previously on sheet (excludes header row).
   * @param {number} previousSheetLastRow getLastRow() before write
   * @return {number}
   */
  previousBodyRowCount: function (previousSheetLastRow) {
    return previousSheetLastRow > 1 ? previousSheetLastRow - 1 : 0;
  },

  /**
   * Body rows to clear after setValues when the sheet shrinks (trailing stale rows only).
   * @param {number} previousSheetLastRow
   * @param {number} newDataRowCount
   * @return {number}
   */
  trailingBodyClearNumRows: function (previousSheetLastRow, newDataRowCount) {
    var prevBody = TrajectorySheetWrite.previousBodyRowCount(previousSheetLastRow);
    var newBody = TrajectorySheetWrite.bodySetValuesNumRows(newDataRowCount);
    if (prevBody <= newBody) return 0;
    return prevBody - newBody;
  },

  /**
   * Total rows in header+body matrix for one setValues call.
   * @param {number} dataRowCount
   * @return {number}
   */
  writeMatrixRowCount: function (dataRowCount) {
    return 1 + TrajectorySheetWrite.bodySetValuesNumRows(dataRowCount);
  },

  /**
   * @param {Array<string>} headers
   * @param {Array<Array>} dataRows
   * @return {{ headerCols: number, dataRows: number, totalRows: number, totalCells: number, approxChars: number }}
   */
  estimatePayload: function (headers, dataRows) {
    var cols = (headers || []).length;
    var body = (dataRows || []).length;
    var totalRows = 1 + body;
    var approxChars = 0;
    (headers || []).forEach(function (h) {
      approxChars += String(h || '').length;
    });
    (dataRows || []).forEach(function (row) {
      (row || []).forEach(function (cell) {
        approxChars += String(cell != null ? cell : '').length;
      });
    });
    return {
      headerCols: cols,
      dataRows: body,
      totalRows: totalRows,
      totalCells: totalRows * cols,
      approxChars: approxChars
    };
  },

  /**
   * Ensures each row has exactly columnCount cells (pad/truncate).
   * @param {Array<Array>} dataRows
   * @param {number} columnCount
   * @return {{ rows: Array<Array>, adjustedRowCount: number }}
   */
  normalizeRectangularRows: function (dataRows, columnCount) {
    var cols = Math.max(0, columnCount || 0);
    var adjusted = 0;
    var rows = (dataRows || []).map(function (row) {
      var r = row ? row.slice() : [];
      if (r.length !== cols) {
        adjusted++;
        if (r.length > cols) {
          return r.slice(0, cols);
        }
        while (r.length < cols) {
          r.push('');
        }
      }
      return r;
    });
    return { rows: rows, adjustedRowCount: adjusted };
  }
};
