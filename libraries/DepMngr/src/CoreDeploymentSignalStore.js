/**
 * CoreDeploymentSignalStore.js
 *
 * Row mapping and in-memory store for tests (no SpreadsheetApp).
 */

var CoreDeploymentSignalStore = {

  /**
   * @param {Object} row
   * @param {Array<string>} headers
   * @return {Array}
   */
  rowToArray: function (row, headers) {
    return (headers || []).map(function (h) {
      var v = row[h];
      return v === undefined || v === null ? '' : v;
    });
  },

  /**
   * @param {Array} values
   * @param {Array<string>} headers
   * @return {Object}
   */
  arrayToRow: function (values, headers) {
    var obj = {};
    (headers || []).forEach(function (h, i) {
      if (h) obj[h] = values[i];
    });
    return obj;
  },

  /**
   * @return {Object} in-memory workbook store
   */
  createMemoryStore: function () {
    return {
      sheets: {}
    };
  },

  /**
   * @param {Object} store
   * @param {string} sheetName
   * @param {Array<string>} headers
   * @param {Array<Object>} rows append body rows
   */
  appendRows: function (store, sheetName, headers, rows) {
    store.sheets[sheetName] = store.sheets[sheetName] || { headers: headers, rows: [] };
    var sh = store.sheets[sheetName];
    sh.headers = headers;
    (rows || []).forEach(function (r) {
      sh.rows.push(r);
    });
  },

  /**
   * @param {Object} store
   * @param {string} sheetName
   * @param {Array<string>} headers
   * @param {Array<Object>} rows replace body
   */
  replaceBody: function (store, sheetName, headers, rows) {
    store.sheets[sheetName] = {
      headers: headers,
      rows: (rows || []).slice()
    };
  },

  /**
   * @param {Object} store
   * @param {string} sheetName
   * @return {Array<Object>}
   */
  readBody: function (store, sheetName) {
    var sh = store.sheets[sheetName];
    if (!sh) return [];
    return (sh.rows || []).slice();
  },

  /**
   * @param {Object} store
   * @param {string} sheetName
   * @param {string} runId
   * @return {Object|null}
   */
  findRunById: function (store, sheetName, runId) {
    var rows = CoreDeploymentSignalStore.readBody(store, sheetName);
    var target = String(runId || '').trim();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i].signal_run_id || '').trim() === target) {
        return rows[i];
      }
    }
    return null;
  }
};
