/**
 * SLG Capacity four-file batch validation and transform orchestration.
 * @namespace SlgCapacityPipeline
 */
var SlgCapacityPipeline = (function () {
  'use strict';

  var PIPELINE_ID = 'slg_capacity_wow_v4';

  /**
   * @param {Object.<string, string>} batchFiles slot -> file name
   * @param {Object.<string, string>} batchTexts slot -> file text (csv) or base64 marker for xlsx
   * @return {EdmJobTypes.EdmValidationResult}
   */
  function validateBatch(batchFiles, batchTexts) {
    var errors = [];
    var slots = ['forecast', 'actualsPrevCurrent', 'actualsHistorical', 'utilization'];
    slots.forEach(function (slot) {
      if (!batchFiles[slot]) {
        errors.push('Missing batch file for slot: ' + slot);
      }
    });
    if (errors.length) {
      return { ok: false, errors: errors };
    }
    var cycle = detectReportingCycle_(batchTexts);
    if (!cycle.ok) {
      errors.push(cycle.error);
      return { ok: false, errors: errors };
    }
    return { ok: true, warnings: cycle.warnings || [] };
  }

  /**
   * @param {Object.<string, string>} batchTexts
   * @return {{ ok: boolean, error?: string, warnings?: string[] }}
   */
  function detectReportingCycle_(batchTexts) {
    var fc = SlgCapacityCsv.gridToRecords(SlgCapacityCsv.parseCsvText(batchTexts.forecast));
    var ac = SlgCapacityCsv.gridToRecords(SlgCapacityCsv.parseCsvText(batchTexts.actualsPrevCurrent));
    var maxFc = maxWeekEnd_(fc, 'Week End Transaction Date');
    var maxAc = maxWeekEnd_(ac, 'Week End Transaction Date');
    if (!maxFc || !maxAc) {
      return { ok: false, error: 'Could not determine reporting week from Forecast or Actuals files' };
    }
    var fqFc = SlgCapacityTransform.fqFromWeekend(maxFc);
    var fqAc = SlgCapacityTransform.fqFromWeekend(maxAc);
    if (fqFc !== fqAc) {
      return {
        ok: false,
        error: 'Mixed reporting cycle: Forecast max week fiscal quarter ' + fqFc +
          ' vs Actuals ' + fqAc
      };
    }
    var diffDays = Math.abs(maxFc.getTime() - maxAc.getTime()) / (86400000);
    if (diffDays > 14) {
      return {
        ok: false,
        error: 'Mixed reporting cycle: Forecast and Actuals max week ends differ by ' +
          Math.round(diffDays) + ' days'
      };
    }
    return { ok: true, warnings: [] };
  }

  /**
   * @param {Object.<string, string>[]} records
   * @param {string} col
   * @return {Date|null}
   */
  function maxWeekEnd_(records, col) {
    var max = null;
    records.forEach(function (row) {
      var d = SlgCapacityTransform.parseDate(row[col]);
      if (d && (!max || d > max)) max = d;
    });
    return max;
  }

  /**
   * @param {Object.<string, string>} batchTexts
   * @param {Date|string} [runDate]
   * @return {EdmJobTypes.EdmTransformationResult}
   */
  function transformBatch(batchTexts, runDate) {
    var histGrid;
    if (batchTexts.actualsHistoricalFormat === 'xlsx') {
      return { ok: false, error: 'XLSX historical inputs must be converted to CSV for GAS transform' };
    }
    histGrid = SlgCapacityCsv.parseCsvText(batchTexts.actualsHistorical);
    var inputs = {
      forecast: SlgCapacityCsv.gridToRecords(SlgCapacityCsv.parseCsvText(batchTexts.forecast)),
      actualsPrevCurrent: SlgCapacityCsv.gridToRecords(
        SlgCapacityCsv.parseCsvText(batchTexts.actualsPrevCurrent)
      ),
      actualsHistorical: SlgCapacityCsv.gridToRecords(histGrid),
      utilizationGrid: SlgCapacityCsv.parseCsvText(batchTexts.utilization)
    };
    var result = SlgCapacityTransform.transform(inputs, runDate);
    if (!result.ok) {
      return { ok: false, error: result.error || 'Transform failed', payload: result };
    }
    return {
      ok: true,
      payload: {
        sheets: result.sheets,
        log: result.log,
        validation: result.validation,
        transformerVersion: SlgCapacitySchema.TRANSFORMER_VERSION
      }
    };
  }

  /**
   * @param {string[]} fileNames
   * @return {{ ok: boolean, batch?: Object.<string, string>, errors?: string[] }}
   */
  function resolveBatchFromFileNames(fileNames) {
    var patterns = SlgCapacitySchema.BATCH_FILE_PATTERNS;
    var batch = {};
    var errors = [];
    Object.keys(patterns).forEach(function (slot) {
      var pats = patterns[slot];
      var matches = [];
      fileNames.forEach(function (name) {
        for (var i = 0; i < pats.length; i++) {
          if (SlgCapacityCsv.fileNameMatches(pats[i], name)) {
            matches.push(name);
            break;
          }
        }
      });
      matches = matches.sort();
      if (matches.length > 1) {
        errors.push('Ambiguous ' + slot + ' file: ' + matches.join(', '));
      } else if (matches.length === 1) {
        batch[slot] = matches[0];
      }
    });
    if (errors.length) {
      return { ok: false, errors: errors };
    }
    var missing = Object.keys(patterns).filter(function (slot) { return !batch[slot]; });
    if (missing.length) {
      return { ok: false, errors: ['Incomplete batch; missing: ' + missing.join(', ')] };
    }
    return { ok: true, batch: batch };
  }

  /**
   * @param {Object.<string, string>} batchTexts keyed by slot
   * @return {string}
   */
  function combinedChecksum(batchTexts) {
    var parts = ['forecast', 'actualsPrevCurrent', 'actualsHistorical', 'utilization'].map(function (k) {
      return k + ':' + (batchTexts[k] || '');
    });
    return EdmChecksum.sha256Hex(parts.join('\n---\n'), {
      computeDigest: Utilities.computeDigest.bind(Utilities)
    });
  }

  return {
    PIPELINE_ID: PIPELINE_ID,
    validateBatch: validateBatch,
    transformBatch: transformBatch,
    resolveBatchFromFileNames: resolveBatchFromFileNames,
    combinedChecksum: combinedChecksum
  };
})();
