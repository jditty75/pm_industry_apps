/**
 * Qualtrics CSV normalizer (GAS-compatible pure transform).
 * @namespace QualtricsTransform
 */
var QualtricsTransform = (function () {
  'use strict';

  /** @return {typeof QualtricsSchema} */
  function schema_() {
    return QualtricsSchema;
  }

  /** @return {typeof QualtricsCsv} */
  function csv_() {
    return QualtricsCsv;
  }

  var EPOCH_MS = Date.UTC(1970, 0, 1, 0, 0, 0, 0);

  /**
   * @param {*} v
   * @return {boolean}
   */
  function toBool(v) {
    if (v == null || v === '') {
      return false;
    }
    var s = String(v).trim().toLowerCase();
    return s === '1' || s === '1.0' || s === 'true' || s === 'yes' || s === 'y';
  }

  /**
   * @param {*} v
   * @return {Date|null}
   */
  function parseUtcTimestamp(v) {
    if (v == null || String(v).trim() === '') {
      return null;
    }
    var s = String(v).trim();
    // Match pandas to_datetime(..., utc=True) on naive Qualtrics strings (not local TZ).
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
      s = s.replace(' ', 'T') + 'Z';
    }
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      return null;
    }
    return d;
  }

  /**
   * @param {Date|null} d
   * @return {string}
   */
  function formatUtcZ(d) {
    if (!d) {
      return '';
    }
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * @param {*} v
   * @return {number|null}
   */
  function toScore(v) {
    if (v == null || String(v).trim() === '') {
      return null;
    }
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  /**
   * @param {number|null} n
   * @return {string}
   */
  function formatScore_(n) {
    if (n == null) {
      return '';
    }
    var s = String(n);
    return s.indexOf('.') >= 0 ? s : s + '.0';
  }

  /**
   * @param {Object} r row with boolean flags
   * @return {string}
   */
  function trackingStatus(r) {
    if (r.f_survey_bounced || r.f_email_bounced) {
      return 'Bounced/Undeliverable';
    }
    if (r.f_survey_finished) {
      return 'Completed';
    }
    if (r.f_survey_partial) {
      return 'Partial';
    }
    if (r.f_survey_started) {
      return 'Started';
    }
    if (r.f_email_opened) {
      return 'Opened';
    }
    if (r.f_email_sent) {
      return 'Sent';
    }
    return 'Unknown';
  }

  /**
   * @param {string[][]} matrix
   * @return {Object[]}
   */
  function matrixToRawRows(matrix) {
    if (!matrix || matrix.length < 2) {
      return [];
    }
    var headers = matrix[0];
    var rows = [];
    for (var r = 1; r < matrix.length; r++) {
      var line = matrix[r];
      if (!line || line.length === 0) {
        continue;
      }
      var allBlank = true;
      for (var c = 0; c < line.length; c++) {
        if (String(line[c] || '').trim() !== '') {
          allBlank = false;
          break;
        }
      }
      if (allBlank) {
        continue;
      }
      var obj = {};
      for (var h = 0; h < headers.length; h++) {
        obj[headers[h]] = line[h] != null ? line[h] : '';
      }
      rows.push(obj);
    }
    return rows;
  }

  /**
   * @param {string[]} headers
   * @return {string[]}
   */
  function validateSchema(headers) {
    var headerSet = {};
    headers.forEach(function (h) {
      headerSet[h] = true;
    });
    var missing = schema_().SOURCE_COLUMNS.filter(function (col) {
      return !headerSet[col];
    });
    return missing;
  }

  /**
   * @param {string[]} headers
   * @return {string[]}
   */
  function findIgnoredSourceColumns(headers) {
    var headerSet = {};
    headers.forEach(function (h) {
      headerSet[h] = true;
    });
    return headers.filter(function (h) {
      return schema_().SOURCE_COLUMNS.indexOf(h) < 0;
    });
  }

  /**
   * @param {Object} raw
   * @return {Object}
   */
  function mapRawRow(raw) {
    var out = {};
    schema_().SOURCE_COLUMNS.forEach(function (src) {
      out[schema_().COLMAP[src]] = raw[src] != null ? raw[src] : '';
    });
    return out;
  }

  /**
   * @param {Object} row mapped + standardized row (pre-serialize)
   * @return {Object}
   */
  function standardizeRow(row) {
    schema_().FLAG_COLS.forEach(function (c) {
      row[c] = toBool(row[c]);
    });
    schema_().TS_COLS.forEach(function (c) {
      row[c] = parseUtcTimestamp(row[c]);
    });
    schema_().SCORE_COLS.forEach(function (c) {
      row[c] = toScore(row[c]);
    });
    row.tracking_status = trackingStatus(row);
    row.response_received = row.response_id != null && String(row.response_id).trim() !== '';
    var first = row.first_name != null ? String(row.first_name).trim() : '';
    var last = row.last_name != null ? String(row.last_name).trim() : '';
    row.full_name = (first + ' ' + last).trim();
    return row;
  }

  /**
   * @param {Object[]} rows
   * @return {Object[]}
   */
  function dedupeLatestPerContact(rows) {
    if (schema_().ROW_GRAIN !== 'latest_per_contact') {
      return rows;
    }
    var sorted = rows.slice().sort(function (a, b) {
      var ta = a.ts_email_sent ? a.ts_email_sent.getTime() : EPOCH_MS;
      var tb = b.ts_email_sent ? b.ts_email_sent.getTime() : EPOCH_MS;
      return ta - tb;
    });
    var lastIndexByKey = {};
    for (var i = 0; i < sorted.length; i++) {
      var key = sorted[i].survey_id + '\u0001' + sorted[i].contact_id;
      lastIndexByKey[key] = i;
    }
    var indices = Object.keys(lastIndexByKey).map(function (k) {
      return lastIndexByKey[k];
    }).sort(function (a, b) {
      return a - b;
    });
    return indices.map(function (idx) {
      return sorted[idx];
    });
  }

  /**
   * @param {Object} row
   * @return {Object.<string, string>}
   */
  function serializeRow(row) {
    var out = {};
    schema_().OUT_ORDER.forEach(function (col) {
      if (schema_().TS_COLS.indexOf(col) >= 0) {
        out[col] = formatUtcZ(row[col]);
      } else if (col === 'response_received') {
        out[col] = row.response_received ? 'Yes' : 'No';
      } else if (schema_().SCORE_COLS.indexOf(col) >= 0) {
        out[col] = formatScore_(row[col]);
      } else {
        out[col] = row[col] == null ? '' : String(row[col]);
      }
    });
    return out;
  }

  /**
   * Build canonical normalized Qualtrics dataset (no destination / population routing).
   * Extra source columns not in COLMAP are ignored; required COLMAP headers must be present.
   *
   * @param {string} csvText
   * @return {{
   *   rows: Object.<string, string>[],
   *   sourceRowCount: number,
   *   contractVersion: string,
   *   ignoredSourceColumns: string[]
   * }}
   */
  function buildCanonicalDataset(csvText) {
    var matrix = csv_().parseCsvText(csvText);
    if (!matrix.length) {
      throw new Error('Export schema changed. Missing columns: ' + schema_().SOURCE_COLUMNS.join(', '));
    }
    var headers = matrix[0];
    var missing = validateSchema(headers);
    if (missing.length) {
      throw new Error('Export schema changed. Missing columns: ' + missing.join(', '));
    }
    var ignoredSourceColumns = findIgnoredSourceColumns(headers);
    var rawRows = matrixToRawRows(matrix);
    var mapped = rawRows.map(mapRawRow).map(standardizeRow);
    var deduped = dedupeLatestPerContact(mapped);
    var rows = deduped.map(serializeRow);
    return {
      rows: rows,
      sourceRowCount: rawRows.length,
      contractVersion: schema_().NORMALIZED_CONTRACT_VERSION,
      ignoredSourceColumns: ignoredSourceColumns
    };
  }

  /**
   * @deprecated Use buildCanonicalDataset — routing validation is separate.
   * @param {string} csvText
   * @return {Object}
   */
  function normalizeQualtricsCsv(csvText) {
    return buildCanonicalDataset(csvText);
  }

  return {
    buildCanonicalDataset: buildCanonicalDataset,
    normalizeQualtricsCsv: normalizeQualtricsCsv,
    toBool: toBool,
    trackingStatus: trackingStatus,
    formatUtcZ: formatUtcZ,
    validateSchema: validateSchema,
    findIgnoredSourceColumns: findIgnoredSourceColumns,
    matrixToRawRows: matrixToRawRows
  };
})();
