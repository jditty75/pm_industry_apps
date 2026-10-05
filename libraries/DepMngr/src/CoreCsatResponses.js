/**
 * Pure CSAT Responses canonical storage helpers (csat-response-v1).
 * Sheet I/O remains in CoreData; testable in Node without SpreadsheetApp.
 * @namespace CoreCsatResponses
 */
var CoreCsatResponses = (function () {
  'use strict';

  var CONTRACT_VERSION = 'csat-response-v1';
  var SHEET_NAME_DEFAULT = 'CSAT_Responses';
  var TEXT_MAX_LEN = 49000;

  /** @const {string[]} Storage column order (identity → scores → analytics → lineage → comments). */
  var CSAT_RESPONSES_COLUMNS = [
    'response_id', 'survey_id', 'survey_type', 'response_ts_utc',
    'deployment_id', 'deployment_name', 'account_id', 'account_name', 'sub_region',
    'deployment_stage_at_response', 'deployment_type', 'services_approach',
    'priming_partner_type', 'partner_name', 'engagement_manager',
    'deployment_start_date', 'target_go_live_date',
    'product_areas', 'product_area_groups', 'respondent_role', 'respondent_key',
    'score_scale_version',
    'overall_satisfaction', 'pgl_satisfaction', 'mds_satisfaction', 'nps_score',
    'aspect_methodology', 'aspect_schedule', 'aspect_communications', 'aspect_value',
    'team_understanding', 'team_collaboration', 'team_responsiveness',
    'team_technical_competence', 'team_guidance',
    'agree_sales_expectations', 'agree_prepared_go_live',
    'agree_met_business_case', 'agree_sales_transition',
    'reasons_sentiment', 'reasons_sentiment_score', 'reasons_parent_topics',
    'improve_sentiment', 'improve_sentiment_score', 'improve_parent_topics',
    'working_well_sentiment', 'working_well_sentiment_score', 'working_well_parent_topics',
    'additional_sentiment', 'additional_sentiment_score', 'additional_parent_topics',
    'qx_analytics_json',
    'first_job_id', 'updated_job_id', 'first_imported_at', 'updated_at',
    'revision', 'row_hash', 'contract_version',
    'comment_reasons', 'comment_improve', 'comment_working_well', 'comment_additional'
  ];

  /** Fields included in content hash (excludes lineage / revision / hash). */
  var HASH_FIELD_NAMES = CSAT_RESPONSES_COLUMNS.filter(function (c) {
    return [
      'first_job_id', 'updated_job_id', 'first_imported_at', 'updated_at',
      'revision', 'row_hash', 'contract_version'
    ].indexOf(c) < 0;
  });

  /**
   * @param {Object} row
   * @return {string[]}
   */
  function validationErrors(row) {
    var errors = [];
    if (!row || !row.response_id) {
      errors.push('missing_response_id');
    }
    if (!row.deployment_id) {
      errors.push('missing_deployment_id');
    }
    if (!row.survey_type) {
      errors.push('missing_survey_type');
    }
    if (!row.response_ts_utc) {
      errors.push('missing_response_ts_utc');
    }
    if (row.contract_version && row.contract_version !== CONTRACT_VERSION) {
      errors.push('wrong_contract_version');
    }
    return errors;
  }

  /**
   * @param {Object} row canonical inbound row from EDM
   * @param {function(string): string} canonicalId
   * @return {Object|null}
   */
  function normalizeInboundRow(row, canonicalId) {
    if (!row) {
      return null;
    }
    var errs = validationErrors(row);
    if (errs.length) {
      return null;
    }
    var out = {};
    CSAT_RESPONSES_COLUMNS.forEach(function (col) {
      if (row[col] !== undefined) {
        out[col] = row[col];
      }
    });
    out.response_id = String(row.response_id).trim();
    out.deployment_id = canonicalId(String(row.deployment_id).trim().slice(0, 18));
    out.contract_version = CONTRACT_VERSION;
    if (out.overall_satisfaction === '' || out.overall_satisfaction === undefined) {
      out.overall_satisfaction = null;
    }
    return out;
  }

  /**
   * @param {Object} row
   * @return {Object}
   */
  function canonicalizeForHash(row) {
    var o = {};
    HASH_FIELD_NAMES.forEach(function (k) {
      var v = row[k];
      if (v === undefined || v === null || v === '') {
        o[k] = null;
      } else if (typeof v === 'number') {
        o[k] = v;
      } else {
        o[k] = String(v);
      }
    });
    return o;
  }

  /**
   * @param {Object} row
   * @param {function(string): string} hashFn
   * @return {string}
   */
  function computeRowHash(row, hashFn) {
    var payload = JSON.stringify(canonicalizeForHash(row));
    return hashFn(payload);
  }

  /**
   * @param {string} text
   * @return {string}
   */
  function prepareTextForSheetWrite(text) {
    var s = String(text || '');
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (s.length > TEXT_MAX_LEN) {
      s = s.slice(0, TEXT_MAX_LEN);
    }
    if (s.length && /^[=+\-@]/.test(s.charAt(0))) {
      s = "'" + s;
    }
    return s;
  }

  /**
   * @param {Object[]} inboundRows
   * @param {Object<string, boolean>} eligibleDeploymentIds
   * @param {Object} deps
   * @param {function(string): string} deps.canonicalId
   * @param {function(string): string} deps.hashFn
   * @param {string} deps.jobId
   * @param {string} deps.nowIso
   * @return {{
   *   eligible: Object[],
   *   rejected: number,
   *   excluded: number,
   *   totalInput: number
   * }}
   */
  function filterAndPrepareInbound(inboundRows, eligibleDeploymentIds, deps) {
    var eligible = [];
    var rejected = 0;
    var excluded = 0;
    (inboundRows || []).forEach(function (row) {
      var normalized = normalizeInboundRow(row, deps.canonicalId);
      if (!normalized) {
        rejected++;
        return;
      }
      var depId = normalized.deployment_id;
      if (!depId || !eligibleDeploymentIds[depId]) {
        excluded++;
        return;
      }
      normalized.row_hash = computeRowHash(normalized, deps.hashFn);
      normalized.revision = 1;
      normalized.first_job_id = deps.jobId;
      normalized.updated_job_id = deps.jobId;
      normalized.first_imported_at = deps.nowIso;
      normalized.updated_at = deps.nowIso;
      eligible.push(normalized);
    });
    return {
      eligible: eligible,
      rejected: rejected,
      excluded: excluded,
      totalInput: (inboundRows || []).length
    };
  }

  /**
   * @param {Object[]} inboundEligible prepared rows with row_hash
   * @param {Object.<string, { rowIndex: number, row_hash: string, revision: number, row: Object }>} existingById
   * @param {Object} deps
   * @return {{
   *   inserts: Object[],
   *   updates: Object[],
   *   unchanged: number,
   *   inserted: number,
   *   updated: number
   * }}
   */
  function planUpsert(inboundEligible, existingById, deps) {
    var inserts = [];
    var updates = [];
    var unchanged = 0;
    existingById = existingById || {};

    inboundEligible.forEach(function (row) {
      var prev = existingById[row.response_id];
      if (!prev) {
        inserts.push(row);
        return;
      }
      if (prev.row_hash === row.row_hash) {
        unchanged++;
        return;
      }
      row.revision = (prev.revision || 1) + 1;
      row.first_job_id = prev.row.first_job_id || row.first_job_id;
      row.first_imported_at = prev.row.first_imported_at || row.first_imported_at;
      row.updated_job_id = deps.jobId;
      row.updated_at = deps.nowIso;
      row.row_hash = computeRowHash(row, deps.hashFn);
      updates.push({ rowIndex: prev.rowIndex, row: row });
    });

    return {
      inserts: inserts,
      updates: updates,
      unchanged: unchanged,
      inserted: inserts.length,
      updated: updates.length
    };
  }

  /**
   * @param {Object} row
   * @return {Array<*>}
   */
  function rowToStorageArray(row) {
    return CSAT_RESPONSES_COLUMNS.map(function (col) {
      var v = row[col];
      if (v === null || v === undefined) {
        return '';
      }
      if (typeof v === 'number') {
        return v;
      }
      if (col.indexOf('comment_') === 0) {
        return prepareTextForSheetWrite(v);
      }
      return String(v);
    });
  }

  /**
   * @param {string[]} headerRow
   * @return {{ ok: boolean, errors: string[] }}
   */
  function verifyHeaders(headerRow) {
    var errors = [];
    if (!headerRow || headerRow.length < CSAT_RESPONSES_COLUMNS.length) {
      errors.push('header_width');
      return { ok: false, errors: errors };
    }
    for (var i = 0; i < CSAT_RESPONSES_COLUMNS.length; i++) {
      if (String(headerRow[i] || '').trim() !== CSAT_RESPONSES_COLUMNS[i]) {
        errors.push('header_mismatch_' + CSAT_RESPONSES_COLUMNS[i]);
      }
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /**
   * @param {Object[]} existingRows sheet rows as objects
   * @return {Object.<string, { rowIndex: number, row_hash: string, revision: number, row: Object }>}
   */
  function indexExistingByResponseId(existingRows) {
    var map = {};
    (existingRows || []).forEach(function (row, idx) {
      var id = String(row.response_id || '').trim();
      if (!id) {
        return;
      }
      map[id] = {
        rowIndex: idx + 2,
        row_hash: String(row.row_hash || ''),
        revision: Number(row.revision) || 1,
        row: row
      };
    });
    return map;
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SHEET_NAME_DEFAULT: SHEET_NAME_DEFAULT,
    CSAT_RESPONSES_COLUMNS: CSAT_RESPONSES_COLUMNS,
    HASH_FIELD_NAMES: HASH_FIELD_NAMES,
    validationErrors: validationErrors,
    normalizeInboundRow: normalizeInboundRow,
    computeRowHash: computeRowHash,
    prepareTextForSheetWrite: prepareTextForSheetWrite,
    filterAndPrepareInbound: filterAndPrepareInbound,
    planUpsert: planUpsert,
    rowToStorageArray: rowToStorageArray,
    verifyHeaders: verifyHeaders,
    indexExistingByResponseId: indexExistingByResponseId
  };
})();
