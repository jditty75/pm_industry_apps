/**
 * Pure CSAT in-flight ingest helpers (normalized rows → storage schema, safe replace planning).
 * Workbook I/O remains in CoreData; this module is testable in Node without SpreadsheetApp.
 * @namespace CoreCsatIngest
 */
var CoreCsatIngest = (function () {
  'use strict';

  /** @const {string[]} */
  var CSAT_INFLIGHT_COLUMNS = [
    'deployment_id', 'account_name', 'deployment_name',
    'survey_type', 'tracking_status', 'response_received',
    'contact_name', 'contact_email', 'contact_role',
    'engagement_manager', 'partner_name',
    'sent_date', 'opened_date', 'started_date', 'finished_date',
    'survey_expires'
  ];

  /**
   * Maps one Qualtrics canonical normalized row to parsed survey_normalized shape.
   * @param {Object.<string, string>} row
   * @return {Object}
   */
  function mapNormalizedQualtricsRowToParsed(row) {
    row = row || {};
    return {
      deployment_id: row.deployment_id || '',
      account_name: row.account_name || '',
      deployment_name: row.deployment_name || '',
      survey_type: row.survey_type || '',
      tracking_status: row.tracking_status || '',
      response_received: row.response_received || '',
      full_name: row.full_name || '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      contact_email: row.contact_email || '',
      contact_role: row.contact_role || '',
      engagement_manager: row.engagement_manager || '',
      partner_name: row.partner_name || '',
      ts_email_sent: row.ts_email_sent || '',
      ts_email_opened: row.ts_email_opened || '',
      ts_survey_started: row.ts_survey_started || '',
      ts_survey_finished: row.ts_survey_finished || '',
      survey_expires: row.survey_expires || ''
    };
  }

  /**
   * @param {Object.<string, string>[]} normalizedRows
   * @return {Object[]}
   */
  function mapNormalizedQualtricsRowsToParsed(normalizedRows) {
    return (normalizedRows || []).map(mapNormalizedQualtricsRowToParsed);
  }

  /**
   * @param {Object} parsedRow
   * @param {Object} deps
   * @param {function(string): string} deps.canonicalId
   * @param {function(string): string} deps.normalizeTrackingStatus
   * @param {function(*): string} deps.formatShortDate
   * @return {Object|null} storage row or null when deployment_id missing
   */
  function mapParsedRowToStorage(parsedRow, deps) {
    var canonId = deps.canonicalId(parsedRow.deployment_id);
    if (!canonId) {
      return null;
    }
    var contactName = parsedRow.full_name ||
      ((parsedRow.first_name || '') + ' ' + (parsedRow.last_name || '')).trim() ||
      '\u2014';
    return {
      deployment_id: canonId,
      account_name: parsedRow.account_name || '\u2014',
      deployment_name: parsedRow.deployment_name || '',
      survey_type: parsedRow.survey_type || '',
      tracking_status: deps.normalizeTrackingStatus(parsedRow.tracking_status),
      response_received: parsedRow.response_received || '',
      contact_name: contactName,
      contact_email: parsedRow.contact_email || '',
      contact_role: parsedRow.contact_role || '',
      engagement_manager: parsedRow.engagement_manager || '',
      partner_name: parsedRow.partner_name || '',
      sent_date: deps.formatShortDate(parsedRow.ts_email_sent),
      opened_date: deps.formatShortDate(parsedRow.ts_email_opened),
      started_date: deps.formatShortDate(parsedRow.ts_survey_started),
      finished_date: deps.formatShortDate(parsedRow.ts_survey_finished),
      survey_expires: deps.formatShortDate(parsedRow.survey_expires)
    };
  }

  /**
   * @param {Object[]} parsedRows
   * @param {Object<string, boolean>} allowedIds
   * @param {Object} deps
   * @return {{ storageRows: Object[], matched: number, discarded: number, totalInput: number }}
   */
  function buildStorageRowsFromParsed(parsedRows, allowedIds, deps) {
    var matched = [];
    var totalInput = (parsedRows || []).length;
    (parsedRows || []).forEach(function (row) {
      var canonId = deps.canonicalId(row.deployment_id);
      if (!canonId || !allowedIds[canonId]) {
        return;
      }
      var storage = mapParsedRowToStorage(row, deps);
      if (storage) {
        matched.push(storage);
      }
    });
    return {
      storageRows: matched,
      matched: matched.length,
      discarded: totalInput - matched.length,
      totalInput: totalInput
    };
  }

  /**
   * @param {Object[]} storageRows
   * @return {Array<Array<*>>}
   */
  function buildInFlightValueMatrix(storageRows) {
    return (storageRows || []).map(function (obj) {
      return CSAT_INFLIGHT_COLUMNS.map(function (col) {
        return obj[col] !== undefined && obj[col] !== null ? obj[col] : '';
      });
    });
  }

  /**
   * @param {string[]} headerRow
   * @param {number} dataRowCount
   * @return {{ ok: boolean, errors: string[] }}
   */
  function verifyInFlightHeaders(headerRow, dataRowCount) {
    var errors = [];
    if (!headerRow || headerRow.length < CSAT_INFLIGHT_COLUMNS.length) {
      errors.push('header width');
      return { ok: false, errors: errors };
    }
    for (var i = 0; i < CSAT_INFLIGHT_COLUMNS.length; i++) {
      if (String(headerRow[i] || '').trim() !== CSAT_INFLIGHT_COLUMNS[i]) {
        errors.push('header mismatch at ' + CSAT_INFLIGHT_COLUMNS[i]);
      }
    }
    if (dataRowCount < 0) {
      errors.push('negative row count');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /**
   * @param {number} priorLastRow
   * @param {number} newDataRowCount
   * @return {{ writeRows: number, clearFromRow: number|null }}
   */
  function planTrailingClear(priorLastRow, newDataRowCount) {
    var writeRows = 1 + newDataRowCount;
    var clearFrom = null;
    if (priorLastRow > writeRows) {
      clearFrom = writeRows + 1;
    }
    return { writeRows: writeRows, clearFromRow: clearFrom, clearThroughRow: priorLastRow };
  }

  return {
    CSAT_INFLIGHT_COLUMNS: CSAT_INFLIGHT_COLUMNS,
    mapNormalizedQualtricsRowToParsed: mapNormalizedQualtricsRowToParsed,
    mapNormalizedQualtricsRowsToParsed: mapNormalizedQualtricsRowsToParsed,
    mapParsedRowToStorage: mapParsedRowToStorage,
    buildStorageRowsFromParsed: buildStorageRowsFromParsed,
    buildInFlightValueMatrix: buildInFlightValueMatrix,
    verifyInFlightHeaders: verifyInFlightHeaders,
    planTrailingClear: planTrailingClear
  };
})();
