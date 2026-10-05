/**
 * Semantic classification of Qualtrics dashboard CSV exports (InFlight vs Responses).
 * Shared 288-column envelope — classification must not rely on filenames alone.
 * @namespace QualtricsSourceClassifier
 */
var QualtricsSourceClassifier = (function () {
  'use strict';

  /** @enum {string} */
  var SourceKind = {
    QUALTRICS_INFLIGHT: 'QUALTRICS_INFLIGHT',
    QUALTRICS_RESPONSES: 'QUALTRICS_RESPONSES',
    UNKNOWN: 'UNKNOWN'
  };

  var MAX_SAMPLE_ROWS = 80;

  /**
   * @param {string[]} headers
   * @param {string} name
   * @return {number}
   */
  function indexOfHeader(headers, name) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === name) {
        return i;
      }
    }
    return -1;
  }

  /**
   * @param {string[][]} matrix
   * @return {{ kind: string, confidence: number, evidence: Object, reasons: string[] }}
   */
  function classifyMatrix(matrix) {
    var reasons = [];
    if (!matrix || matrix.length < 2) {
      return { kind: SourceKind.UNKNOWN, confidence: 0, evidence: {}, reasons: ['no_data_rows'] };
    }
    var headers = matrix[0].map(function (h) {
      return String(h || '').trim();
    });
    var sourceTypeIdx = indexOfHeader(headers, '_sourceType');
    var responseDateIdx = indexOfHeader(headers, 'Responsedate (+00:00 GMT)');
    var responseIdColIdx = indexOfHeader(headers, 'Response ID');
    var emailSentIdx = indexOfHeader(headers, 'Email Sent');

    if (headers[0] !== 'Survey_ID') {
      reasons.push('missing_survey_id_header_col0');
    }

    var sampleEnd = Math.min(matrix.length - 1, MAX_SAMPLE_ROWS);
    var stats = {
      rowsSampled: sampleEnd,
      col0R: 0,
      col0Sv: 0,
      col0Other: 0,
      sourceTypeSurvey: 0,
      sourceTypeDesQds: 0,
      sourceTypeOther: 0,
      sourceTypeBlank: 0,
      withResponseDate: 0,
      withEmailSent: 0,
      withResponseIdField: 0
    };

    for (var r = 1; r <= sampleEnd; r++) {
      var row = matrix[r] || [];
      var col0 = String(row[0] || '').trim();
      if (/^R_[A-Za-z0-9]+/.test(col0)) {
        stats.col0R++;
      } else if (/^SV_/.test(col0)) {
        stats.col0Sv++;
      } else if (col0) {
        stats.col0Other++;
      }
      if (sourceTypeIdx >= 0) {
        var st = String(row[sourceTypeIdx] || '').trim().toLowerCase();
        if (st === 'survey') {
          stats.sourceTypeSurvey++;
        } else if (st === 'des-qds') {
          stats.sourceTypeDesQds++;
        } else if (!st) {
          stats.sourceTypeBlank++;
        } else {
          stats.sourceTypeOther++;
        }
      }
      if (responseDateIdx >= 0 && String(row[responseDateIdx] || '').trim()) {
        stats.withResponseDate++;
      }
      if (emailSentIdx >= 0 && String(row[emailSentIdx] || '').trim()) {
        stats.withEmailSent++;
      }
      if (responseIdColIdx >= 0 && String(row[responseIdColIdx] || '').trim()) {
        stats.withResponseIdField++;
      }
    }

    var n = stats.rowsSampled || 1;
    var responsesScore = 0;
    var inflightScore = 0;

    if (stats.col0R / n >= 0.9) {
      responsesScore += 3;
    } else if (stats.col0R / n >= 0.5) {
      responsesScore += 1;
    }
    if (stats.col0Sv / n >= 0.9) {
      inflightScore += 3;
    } else if (stats.col0Sv / n >= 0.5) {
      inflightScore += 1;
    }
    if (stats.sourceTypeSurvey / n >= 0.9) {
      responsesScore += 3;
    }
    if (stats.sourceTypeDesQds / n >= 0.9) {
      inflightScore += 3;
    }
    if (stats.withResponseDate / n >= 0.8) {
      responsesScore += 1;
    }
    if (stats.withEmailSent / n >= 0.5 && stats.withResponseDate / n < 0.3) {
      inflightScore += 1;
    }
    if (stats.withResponseIdField / n >= 0.3 && stats.col0R / n < 0.5) {
      inflightScore += 1;
    }

    var kind = SourceKind.UNKNOWN;
    var confidence = 0;
    if (responsesScore >= 5 && inflightScore < 3) {
      kind = SourceKind.QUALTRICS_RESPONSES;
      confidence = Math.min(1, responsesScore / 7);
    } else if (inflightScore >= 5 && responsesScore < 3) {
      kind = SourceKind.QUALTRICS_INFLIGHT;
      confidence = Math.min(1, inflightScore / 7);
    } else if (responsesScore > inflightScore && responsesScore >= 4) {
      kind = SourceKind.QUALTRICS_RESPONSES;
      confidence = 0.6;
      reasons.push('ambiguous_responses_leaning');
    } else if (inflightScore > responsesScore && inflightScore >= 4) {
      kind = SourceKind.QUALTRICS_INFLIGHT;
      confidence = 0.6;
      reasons.push('ambiguous_inflight_leaning');
    } else {
      reasons.push('insufficient_semantic_evidence');
      if (stats.col0R > 0 && stats.col0Sv > 0) {
        reasons.push('mixed_col0_identity');
      }
    }

    if (kind === SourceKind.QUALTRICS_RESPONSES && stats.col0Sv / n >= 0.1) {
      kind = SourceKind.UNKNOWN;
      confidence = 0;
      reasons.push('responses_rejected_sv_in_col0');
    }
    if (kind === SourceKind.QUALTRICS_INFLIGHT && stats.col0R / n >= 0.1) {
      kind = SourceKind.UNKNOWN;
      confidence = 0;
      reasons.push('inflight_rejected_r_in_col0');
    }

    // V1A synthetic fixtures (~40 columns) predate full 288-column envelope metadata.
    if (kind === SourceKind.UNKNOWN && headers.length < 200) {
      if (stats.col0R / n < 0.05 && stats.withEmailSent / n >= 0.2 &&
          responseDateIdx < 0) {
        kind = SourceKind.QUALTRICS_INFLIGHT;
        confidence = 0.65;
        reasons.push('legacy_narrow_inflight_fixture');
      } else if (stats.col0R / n >= 0.9 && responseDateIdx >= 0) {
        kind = SourceKind.QUALTRICS_RESPONSES;
        confidence = 0.65;
        reasons.push('legacy_narrow_responses_fixture');
      }
    }

    return { kind: kind, confidence: confidence, evidence: stats, reasons: reasons };
  }

  /**
   * @param {string} csvText
   * @param {Object} [csvParser] QualtricsCsv or test double
   * @return {{ kind: string, confidence: number, evidence: Object, reasons: string[] }}
   */
  function classifyCsvText(csvText, csvParser) {
    var parser = csvParser || QualtricsCsv;
    var matrix = parser.parseCsvText(csvText);
    return classifyMatrix(matrix);
  }

  /**
   * @param {string} expectedKind SourceKind value
   * @param {string} csvText
   * @param {Object} [csvParser]
   * @return {{ ok: boolean, errors: string[] }}
   */
  function assertExpectedKind(expectedKind, csvText, csvParser) {
    var result = classifyCsvText(csvText, csvParser);
    if (result.kind !== expectedKind) {
      return {
        ok: false,
        errors: [
          'Wrong Qualtrics export type: expected ' + expectedKind + ' got ' + result.kind +
          (result.reasons.length ? ' (' + result.reasons.join(', ') + ')' : '')
        ]
      };
    }
    if (result.confidence < 0.5) {
      return {
        ok: false,
        errors: ['Qualtrics export classification confidence too low for ' + expectedKind]
      };
    }
    return { ok: true };
  }

  return {
    SourceKind: SourceKind,
    classifyMatrix: classifyMatrix,
    classifyCsvText: classifyCsvText,
    assertExpectedKind: assertExpectedKind
  };
})();
