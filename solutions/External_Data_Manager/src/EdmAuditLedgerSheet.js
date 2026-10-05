/**
 * Sheet-backed job audit ledger (operational metadata only).
 * @namespace EdmAuditLedgerSheet
 */
var EdmAuditLedgerSheet = (function () {
  'use strict';

  var SHEET_NAME = 'EdmJobLedger';

  /** @type {string[]|null} */
  var extendedHeadersMemo_ = null;

  /**
   * Lazy: EdmAuditLedger must be initialized first (GAS file order is not guaranteed).
   * @return {string[]}
   */
  function extendedHeaders_() {
    if (!extendedHeadersMemo_) {
      extendedHeadersMemo_ = EdmAuditLedger.LEDGER_HEADERS.concat([
        'source_disposition',
        'git_sha',
        'override_flags',
        'hc_eligible',
        'slg_eligible',
        'henp_eligible'
      ]);
    }
    return extendedHeadersMemo_;
  }

  /**
   * @param {Object} spreadsheetApp
   * @return {string} spreadsheet id
   */
  function createLedgerSpreadsheet(spreadsheetApp) {
    var ss = spreadsheetApp.create('External Data Manager — Job Ledger');
    var sheet = ss.getSheets()[0].setName(SHEET_NAME);
    sheet.getRange(1, 1, 1, extendedHeaders_().length).setValues([extendedHeaders_()]);
    sheet.setFrozenRows(1);
    return ss.getId();
  }

  /**
   * @param {string} spreadsheetId
   * @param {Object} spreadsheetApp
   * @return {Object}
   */
  function openLedger(spreadsheetId, spreadsheetApp) {
    return spreadsheetApp.openById(spreadsheetId).getSheetByName(SHEET_NAME);
  }

  /**
   * @param {Object} sheet
   * @return {Object[]}
   */
  function readAllJobs(sheet) {
    if (!sheet) {
      return [];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }
    var width = extendedHeaders_().length;
    var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    return values.map(function (row) {
      var obj = {};
      extendedHeaders_().forEach(function (h, i) {
        obj[h] = row[i];
      });
      return obj;
    });
  }

  /**
   * @param {EdmJobTypes.EdmJobRecord} job
   * @param {Object} extras
   * @return {string[]}
   */
  function jobToExtendedRow(job, extras) {
    extras = extras || {};
    var base = EdmAuditLedger.jobToLedgerRow(job);
    while (base.length < EdmAuditLedger.LEDGER_HEADERS.length) {
      base.push('');
    }
    return base.concat([
      extras.sourceDisposition || '',
      extras.gitSha || '',
      extras.overrideFlags || '',
      extras.hcEligible != null ? String(extras.hcEligible) : '',
      extras.slgEligible != null ? String(extras.slgEligible) : '',
      extras.henpEligible != null ? String(extras.henpEligible) : ''
    ]);
  }

  /**
   * @param {Object} sheet
   * @param {EdmJobTypes.EdmJobRecord} job
   * @param {Object} extras
   */
  function appendJob(sheet, job, extras) {
    var row = jobToExtendedRow(job, extras);
    var next = sheet.getLastRow() + 1;
    var numCols = row.length;
    // SpreadsheetApp: getRange(row, column, numRows, numColumns) — not end row/column.
    sheet.getRange(next, 1, 1, numCols).setValues([row]);
  }

  return {
    SHEET_NAME: SHEET_NAME,
    get EXTENDED_HEADERS() {
      return extendedHeaders_();
    },
    createLedgerSpreadsheet: createLedgerSpreadsheet,
    openLedger: openLedger,
    readAllJobs: readAllJobs,
    appendJob: appendJob,
    jobToExtendedRow: jobToExtendedRow
  };
})();
