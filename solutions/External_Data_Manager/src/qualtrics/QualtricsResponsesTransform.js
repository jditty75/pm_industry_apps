/**
 * Qualtrics Responses CSV → canonical csat-response-v1 DTOs (no raw Qualtrics names across boundary).
 * @namespace QualtricsResponsesTransform
 */
var QualtricsResponsesTransform = (function () {
  'use strict';

  function schema_() {
    return QualtricsResponsesSchema;
  }

  function csv_() {
    return QualtricsCsv;
  }

  /**
   * @param {string[]} headers
   * @return {Object.<string, number[]>}
   */
  function buildHeaderIndexMap(headers) {
    var map = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').trim();
      if (!h) {
        continue;
      }
      if (!map[h]) {
        map[h] = [];
      }
      map[h].push(i);
    }
    return map;
  }

  /**
   * Coalesce duplicate headers: scan indices left-to-right, return first non-empty cell.
   * @param {string[]} row
   * @param {number[]} indices
   * @return {string}
   */
  function coalesceCells(row, indices) {
    if (!indices || !indices.length) {
      return '';
    }
    for (var i = 0; i < indices.length; i++) {
      var v = row[indices[i]];
      if (v != null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  }

  /**
   * Duplicate Qualtrics analytics headers: prefer the last populated twin (cols 95–135).
   * @param {string[]} row
   * @param {number[]} indices
   * @return {string}
   */
  function coalesceCellsLast(row, indices) {
    if (!indices || !indices.length) {
      return '';
    }
    for (var i = indices.length - 1; i >= 0; i--) {
      var v = row[indices[i]];
      if (v != null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  }

  /**
   * @param {string[]} headers
   * @return {{ ok: boolean, errors: string[] }}
   */
  function validateHeaderShape(headers) {
    var errors = [];
    if (!headers || headers.length !== schema_().EXPECTED_COLUMN_COUNT) {
      errors.push('Expected ' + schema_().EXPECTED_COLUMN_COUNT + ' columns, got ' +
        (headers ? headers.length : 0));
    }
    schema_().POSITION_CHECKS.forEach(function (chk) {
      if (!headers || headers[chk.index] !== chk.header) {
        errors.push('Header mismatch at index ' + chk.index + ': expected ' + chk.header);
      }
    });
    return errors.length ? { ok: false, errors: errors } : { ok: true };
  }

  /**
   * @param {*} v
   * @return {string}
   */
  function parseUtcIso(v) {
    if (v == null || String(v).trim() === '') {
      return '';
    }
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
      return s.replace(' ', 'T') + 'Z';
    }
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      return '';
    }
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * @param {*} v
   * @return {string}
   */
  function datePartOnly(v) {
    if (v == null || String(v).trim() === '') {
      return '';
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  /**
   * @param {*} v
   * @param {number} min
   * @param {number} max
   * @return {{ value: number|null, warn: boolean }}
   */
  function parseIntScore(v, min, max) {
    if (v == null || String(v).trim() === '') {
      return { value: null, warn: false };
    }
    var n = Number(v);
    if (isNaN(n) || n < min || n > max) {
      return { value: null, warn: true };
    }
    return { value: Math.round(n), warn: false };
  }

  /**
   * @param {string} programType
   * @return {string}
   */
  function mapSurveyType(programType) {
    var s = String(programType || '').trim();
    if (s === 'Post Go-Live Survey') {
      return 'PGL';
    }
    if (s === 'Mid-Deployment Survey') {
      return 'MDS';
    }
    return '';
  }

  /**
   * @param {string} raw
   * @param {Object} productAreaConfig
   * @return {{ product_areas: string, product_area_groups: string, warnings: number }}
   */
  function normalizeProductAreas(raw, productAreaConfig) {
    productAreaConfig = productAreaConfig ||
      QualtricsResponsesRoutingConfig.getProductAreaConfig();
    var tokens = String(raw || '').split(',');
    var seen = {};
    var ordered = [];
    tokens.forEach(function (t) {
      var x = String(t || '').trim();
      if (!x || seen[x]) {
        return;
      }
      seen[x] = true;
      ordered.push(x);
    });
    var groupsSeen = {};
    var groups = [];
    ordered.forEach(function (token) {
      var g = productAreaConfig.aliases[token] || productAreaConfig.unknownTokenGroup || 'OTHER';
      if (!groupsSeen[g]) {
        groupsSeen[g] = true;
        groups.push(g);
      }
    });
    return {
      product_areas: ordered.join('|'),
      product_area_groups: groups.join('|'),
      warnings: 0
    };
  }

  /**
   * @param {string} text
   * @param {number} maxLen
   * @return {{ text: string, truncated: boolean }}
   */
  function sanitizeFreeText(text, maxLen) {
    maxLen = maxLen || 49000;
    var s = String(text || '');
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    s = s.trim();
    var truncated = false;
    if (s.length > maxLen) {
      s = s.slice(0, maxLen);
      truncated = true;
    }
    if (s.length && /^[=+\-@]/.test(s.charAt(0))) {
      s = "'" + s;
    }
    return { text: s, truncated: truncated };
  }

  /**
   * @param {string} row
   * @param {Object.<string, number[]>} headerMap
   * @param {string} headerName
   * @return {string}
   */
  /**
   * @param {string[]} row
   * @param {Object.<string, number[]>} headerMap
   * @param {string} headerName
   * @param {boolean} [preferLast]
   * @return {string}
   */
  function readField(row, headerMap, headerName, preferLast) {
    var indices = headerMap[headerName];
    return preferLast ? coalesceCellsLast(row, indices) : coalesceCells(row, indices);
  }

  /**
   * @param {string[][]} matrix
   * @param {Object} [options]
   * @return {{
   *   ok: boolean,
   *   errors?: string[],
   *   rows?: Object[],
   *   sourceRowCount?: number,
   *   warningCounts?: Object,
   *   exportWatermark?: string
   * }}
   */
  function buildCanonicalRows(matrix, options) {
    options = options || {};
    if (!matrix || !matrix.length) {
      return { ok: false, errors: ['empty_csv'] };
    }
    var headerValidation = validateHeaderShape(matrix[0]);
    if (!headerValidation.ok) {
      return { ok: false, errors: headerValidation.errors };
    }

    var headerMap = buildHeaderIndexMap(matrix[0]);
    var warnings = {
      scoreOutOfRange: 0,
      surveyTypeMismatch: 0,
      textTruncated: 0,
      rowRejected: 0,
      duplicateResponseId: 0
    };
    var productAreaConfig = options.productAreaConfig ||
      QualtricsResponsesRoutingConfig.getProductAreaConfig();
    var rawRows = [];
    var maxWatermark = '';

    for (var r = 1; r < matrix.length; r++) {
      var row = matrix[r];
      if (!row || !row.length) {
        continue;
      }
      var testFlag = readField(row, headerMap, 'Test Data Flag').toLowerCase();
      if (testFlag === 'yes' || testFlag === 'true' || testFlag === '1') {
        warnings.rowRejected++;
        continue;
      }
      var responseId = readField(row, headerMap, 'Survey_ID');
      if (!/^R_[A-Za-z0-9]+$/.test(responseId)) {
        warnings.rowRejected++;
        continue;
      }
      var surveyType = mapSurveyType(readField(row, headerMap, 'Program_Type'));
      if (!surveyType) {
        warnings.rowRejected++;
        continue;
      }
      var deploymentId = readField(row, headerMap, 'Deployment_ID').slice(0, 18);
      var responseTs = parseUtcIso(readField(row, headerMap, 'Responsedate (+00:00 GMT)'));
      if (!deploymentId || !responseTs) {
        warnings.rowRejected++;
        continue;
      }
      var wm = parseUtcIso(readField(row, headerMap, '_cachedDate (+00:00 GMT)'));
      if (wm && (!maxWatermark || wm > maxWatermark)) {
        maxWatermark = wm;
      }

      var overall = parseIntScore(readField(row, headerMap, 'Overall Satisfaction'), 1, 5);
      var pgl = parseIntScore(readField(row, headerMap, '#PGL Satisfaction'), 1, 5);
      var mds = parseIntScore(readField(row, headerMap, '#MDS Satisfaction'), 1, 5);
      var nps = parseIntScore(readField(row, headerMap, 'Post_Go-Live_NPS'), 0, 10);
      if (overall.warn || pgl.warn || mds.warn || nps.warn) {
        warnings.scoreOutOfRange++;
      }
      if (surveyType === 'MDS' && pgl.value != null) {
        pgl.value = null;
        warnings.surveyTypeMismatch++;
      }
      if (surveyType === 'PGL' && mds.value != null) {
        mds.value = null;
        warnings.surveyTypeMismatch++;
      }
      if (surveyType === 'MDS' && nps.value != null) {
        nps.value = null;
        warnings.surveyTypeMismatch++;
      }

      var pa = normalizeProductAreas(readField(row, headerMap, 'Product Area'), productAreaConfig);
      var comments = {};
      ['comment_reasons', 'comment_improve', 'comment_working_well', 'comment_additional'].forEach(function (k) {
        var spec = schema_().CANONICAL_SOURCE_HEADERS[k];
        var rawText = readField(row, headerMap, spec.header);
        var san = sanitizeFreeText(rawText);
        if (san.truncated) {
          warnings.textTruncated++;
        }
        comments[k] = san.text;
      });

      var analytics = {};
      schema_().SENTIMENT_BLOCKS.forEach(function (block) {
        var sent = readField(row, headerMap, block.sentimentHeader, true);
        var sentScore = parseIntScore(readField(row, headerMap, block.sentimentScoreHeader, true), -2, 2);
        var parents = readField(row, headerMap, block.parentTopicsHeader, true);
        var parentList = parents ? parents.split(',').map(function (p) {
          return String(p || '').trim();
        }).filter(Boolean) : [];
        analytics[block.prefix] = {
          sentiment: sent || null,
          sentiment_score: sentScore.value,
          parent_topics: parentList.join('|')
        };
      });

      var dto = {
        response_id: responseId,
        survey_id: readField(row, headerMap, '_sourceId'),
        survey_type: surveyType,
        response_ts_utc: responseTs,
        deployment_id: deploymentId,
        deployment_name: readField(row, headerMap, 'Deployment_Name'),
        account_id: readField(row, headerMap, 'Account_ID'),
        account_name: readField(row, headerMap, 'Account_Name'),
        sub_region: readField(row, headerMap, 'Sub Region'),
        deployment_stage_at_response: readField(row, headerMap, 'Deployment_Stage'),
        deployment_type: readField(row, headerMap, 'Normalized Deployment Type'),
        services_approach: readField(row, headerMap, 'Services_Approach'),
        priming_partner_type: readField(row, headerMap, 'Priming_Partner'),
        partner_name: readField(row, headerMap, 'Deployment_Partner_Name'),
        engagement_manager: readField(row, headerMap, 'Deployment_Engagement_Manager'),
        deployment_start_date: datePartOnly(readField(row, headerMap, 'Deployment_Start_Date (+00:00 GMT)')),
        target_go_live_date: datePartOnly(readField(row, headerMap, 'Deployment_First_Target_MTP (+00:00 GMT)')),
        product_areas: pa.product_areas,
        product_area_groups: pa.product_area_groups,
        respondent_role: readField(row, headerMap, 'Deployment_Contact_Role'),
        respondent_key: '',
        score_scale_version: 'v2_1to5',
        overall_satisfaction: overall.value,
        pgl_satisfaction: pgl.value,
        mds_satisfaction: mds.value,
        nps_score: nps.value,
        aspect_methodology: parseIntScore(readField(row, headerMap, 'Aspect Workday Methodology'), 1, 5).value,
        aspect_schedule: parseIntScore(readField(row, headerMap, 'Aspect Schedule Management'), 1, 5).value,
        aspect_communications: parseIntScore(readField(row, headerMap, 'Aspect Communications'), 1, 5).value,
        aspect_value: parseIntScore(readField(row, headerMap, 'Aspect Value Delivered'), 1, 5).value,
        team_understanding: parseIntScore(readField(row, headerMap, 'Team Understanding Business Needs'), 1, 5).value,
        team_collaboration: parseIntScore(readField(row, headerMap, 'Team Collaboration'), 1, 5).value,
        team_responsiveness: parseIntScore(readField(row, headerMap, 'Team Responsiveness'), 1, 5).value,
        team_technical_competence: parseIntScore(readField(row, headerMap, 'Team Technical Competence'), 1, 5).value,
        team_guidance: parseIntScore(readField(row, headerMap, 'Team Guidance'), 1, 5).value,
        agree_sales_expectations: parseIntScore(
          readField(row, headerMap, 'Agreement Set Appropriate Expectations in Sales'), 1, 5).value,
        agree_prepared_go_live: parseIntScore(
          readField(row, headerMap, 'Agreement Prepared to go live'), 1, 5).value,
        agree_met_business_case: parseIntScore(
          readField(row, headerMap, 'Agreement Met Objectives of Business Case'), 1, 5).value,
        agree_sales_transition: parseIntScore(
          readField(row, headerMap, 'Agreement Transition from Sales'), 1, 5).value,
        reasons_sentiment: analytics.reasons.sentiment,
        reasons_sentiment_score: analytics.reasons.sentiment_score,
        reasons_parent_topics: analytics.reasons.parent_topics,
        improve_sentiment: analytics.improve.sentiment,
        improve_sentiment_score: analytics.improve.sentiment_score,
        improve_parent_topics: analytics.improve.parent_topics,
        working_well_sentiment: analytics.working_well.sentiment,
        working_well_sentiment_score: analytics.working_well.sentiment_score,
        working_well_parent_topics: analytics.working_well.parent_topics,
        additional_sentiment: analytics.additional.sentiment,
        additional_sentiment_score: analytics.additional.sentiment_score,
        additional_parent_topics: analytics.additional.parent_topics,
        qx_analytics_json: JSON.stringify(analytics),
        comment_reasons: comments.comment_reasons,
        comment_improve: comments.comment_improve,
        comment_working_well: comments.comment_working_well,
        comment_additional: comments.comment_additional,
        contract_version: schema_().CONTRACT_VERSION,
        _sourceRowIndex: r
      };
      rawRows.push(dto);
    }

    var deduped = dedupeByResponseId_(rawRows, warnings);
    return {
      ok: true,
      rows: deduped,
      sourceRowCount: matrix.length - 1,
      warningCounts: warnings,
      exportWatermark: maxWatermark
    };
  }

  /**
   * @param {Object[]} rows
   * @param {Object} warnings
   * @return {Object[]}
   */
  function dedupeByResponseId_(rows, warnings) {
    var byId = {};
    rows.forEach(function (row) {
      var id = row.response_id;
      var prev = byId[id];
      if (!prev) {
        byId[id] = row;
        return;
      }
      warnings.duplicateResponseId++;
      var keep = prev;
      var drop = row;
      if (row.response_ts_utc > prev.response_ts_utc) {
        keep = row;
        drop = prev;
      } else if (row.response_ts_utc === prev.response_ts_utc &&
        row._sourceRowIndex > prev._sourceRowIndex) {
        keep = row;
        drop = prev;
      }
      byId[id] = keep;
    });
    return Object.keys(byId).map(function (k) {
      var o = byId[k];
      delete o._sourceRowIndex;
      return o;
    });
  }

  /**
   * @param {string} csvText
   * @param {Object} [options]
   * @return {Object}
   */
  function transformCsvText(csvText, options) {
    var matrix = csv_().parseCsvText(csvText);
    return buildCanonicalRows(matrix, options);
  }

  return {
    validateHeaderShape: validateHeaderShape,
    buildCanonicalRows: buildCanonicalRows,
    transformCsvText: transformCsvText,
    normalizeProductAreas: normalizeProductAreas,
    sanitizeFreeText: sanitizeFreeText,
    buildHeaderIndexMap: buildHeaderIndexMap,
    coalesceCells: coalesceCells
  };
})();
