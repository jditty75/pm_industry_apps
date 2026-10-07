/**
 * CoreDeploymentSignalStore.js
 *
 * deployment-signal-v1 schema, spreadsheet IO, and in-memory test store.
 */

var CoreDeploymentSignalStore = {

  SIGNAL_SCHEMA_VERSION: 'deployment-signal-v1',
  NORMALIZATION_VERSION: 1,

  SIGNAL_STATUS_ACTIVE: 'ACTIVE',
  SIGNAL_STATUS_RESOLVED: 'RESOLVED',

  RUN_STATUS_COMPLETE: 'COMPLETE',
  RUN_STATUS_FAILED: 'FAILED',
  RUN_STATUS_IN_PROGRESS: 'IN_PROGRESS',

  /**
   * @return {Array<string>}
   */
  currentHeaders: function () {
    return [
      'schema_version',
      'signal_id',
      'deployment_id',
      'signal_run_id',
      'signal_as_of',
      'lifecycle_state',
      'attention',
      'signal_type',
      'observation',
      'interpretation',
      'why_it_matters',
      'leadership_question',
      'confidence',
      'evidence_limitations',
      'current_health',
      'stage',
      'signal_status',
      'context_ref',
      'source_reasoning_run_ref',
      'prior_signal_id',
      'normalization_version',
      'reasoning_prose_original',
      'first_active_at',
      'last_updated_at',
      'persisted_at'
    ];
  },

  /**
   * @return {Array<string>}
   */
  historyHeaders: function () {
    return CoreDeploymentSignalStore.currentHeaders().concat([
      'history_event_at',
      'history_event_type'
    ]);
  },

  /**
   * @return {Array<string>}
   */
  runHeaders: function () {
    return [
      'signal_run_id',
      'signal_as_of',
      'started_at',
      'received_at',
      'persisted_at',
      'deployments_evaluated',
      'signals_proposed',
      'signals_persisted',
      'no_signal_count',
      'lifecycle_new_count',
      'lifecycle_continuing_count',
      'lifecycle_escalated_count',
      'lifecycle_de_escalated_count',
      'lifecycle_resolved_count',
      'run_status',
      'persistence_status',
      'context_schema_version',
      'signal_schema_version',
      'normalization_version',
      'agent_reference',
      'source_reasoning_run_ref',
      'error_message',
      'email_status'
    ];
  },

  /**
   * @param {Array<string>} existing trimmed cells (canonical width)
   * @param {Array<string>} canonical
   * @return {boolean}
   * @private
   */
  _headersMatchCanonical_: function (existing, canonical) {
    if (!canonical || !canonical.length) return false;
    if (!existing || existing.length !== canonical.length) return false;
    for (var i = 0; i < canonical.length; i++) {
      if (existing[i] !== canonical[i]) return false;
    }
    return true;
  },

  /**
   * Idempotent header row for Signal sheets (bounded reads; no getLastColumn scan).
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} sheetName
   * @param {Array<string>} headers canonical ordered schema
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  ensureSheetHeaders: function (ss, sheetName, headers) {
    var canonical = (headers || []).slice();
    var schemaWidth = canonical.length;
    var logPrefix = 'CoreDeploymentSignalStore.ensureSheetHeaders: sheet="' +
      sheetName + '" schemaWidth=' + schemaWidth;
    if (!schemaWidth) {
      throw new Error(logPrefix + ' empty header schema');
    }

    var sheet = ss.getSheetByName(sheetName);
    var created = false;
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      created = true;
    }

    if (created) {
      Logger.log(logPrefix + ' created=true op=setValues_header');
      sheet.getRange(1, 1, 1, schemaWidth).setValues([canonical]);
      return sheet;
    }

    var existing = sheet.getRange(1, 1, 1, schemaWidth).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    if (CoreDeploymentSignalStore._headersMatchCanonical_(existing, canonical)) {
      Logger.log(logPrefix + ' created=false op=no-op');
      return sheet;
    }

    var lastRow = sheet.getLastRow();
    var hasBodyData = lastRow > 1;
    if (hasBodyData) {
      throw new Error(logPrefix + ' incompatible headers with existing signal data' +
        ' (lastRow=' + lastRow + '); manual remediation required');
    }

    Logger.log(logPrefix + ' created=false op=setValues_header partialOrEmpty=true' +
      ' lastRow=' + lastRow);
    sheet.getRange(1, 1, 1, schemaWidth).setValues([canonical]);
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
    CoreDeploymentSignalStore.ensureSheetHeaders(
      sheet.getParent(), sheet.getName(), headers);
    var start = Math.max(sheet.getLastRow(), 1) + 1;
    if (sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      start = 2;
    }
    var matrix = rows.map(function (r) {
      return CoreDeploymentSignalStore.rowToArray(r, headers);
    });
    sheet.getRange(start, 1, start + matrix.length - 1, headers.length).setValues(matrix);
  },

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
