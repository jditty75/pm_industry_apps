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
    var maxAc = maxWeekEnd_(ac, 'Week End Transaction Date');
    if (!maxAc) {
      return {
        ok: false,
        error: 'Could not determine reporting week from Actuals Prev/Current file'
      };
    }
    var maxFc = maxWeekEnd_(fc, 'Week End Transaction Date');
    if (!maxFc) {
      return { ok: false, error: 'Could not determine reporting week from Forecast file' };
    }
    if (maxFc.getTime() < maxAc.getTime()) {
      return {
        ok: false,
        error: 'Mixed reporting cycle: Forecast latest week end ' +
          SlgCapacityTransform.weekKeyYmd(maxFc) + ' precedes Actuals latest ' +
          SlgCapacityTransform.weekKeyYmd(maxAc)
      };
    }
    var anchorKey = SlgCapacityTransform.weekKeyYmd(maxAc);
    var forecastCoversAnchor = false;
    fc.forEach(function (row) {
      var d = SlgCapacityTransform.parseDate(row['Week End Transaction Date']);
      if (d && SlgCapacityTransform.weekKeyYmd(d) === anchorKey) {
        forecastCoversAnchor = true;
      }
    });
    if (!forecastCoversAnchor) {
      return {
        ok: false,
        error: 'Mixed reporting cycle: Forecast has no rows for Actuals latest week end ' + anchorKey
      };
    }
    return {
      ok: true,
      warnings: [
        'Reporting-cycle check aligns Forecast to Actuals latest week end (' + anchorKey +
          '); forecast weeks beyond actuals are allowed and export timestamps are not validated.'
      ]
    };
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
