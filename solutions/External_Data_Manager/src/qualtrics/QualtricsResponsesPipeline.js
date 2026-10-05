/**
 * Qualtrics Responses pipeline adapter (validate → transform → route).
 * @namespace QualtricsResponsesPipeline
 */
var QualtricsResponsesPipeline = (function () {
  'use strict';

  var PIPELINE_ID = 'qualtrics_responses';

  /**
   * @param {string} csvText
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [routingConfig]
   * @return {EdmJobTypes.EdmValidationResult}
   */
  function validateSource(csvText, routingConfig) {
    var kindCheck = QualtricsSourceClassifier.assertExpectedKind(
      QualtricsSourceClassifier.SourceKind.QUALTRICS_RESPONSES,
      csvText
    );
    if (!kindCheck.ok) {
      return kindCheck;
    }
    var matrix = QualtricsCsv.parseCsvText(csvText);
    var shape = QualtricsResponsesTransform.validateHeaderShape(matrix[0] || []);
    if (!shape.ok) {
      return shape;
    }
    var built = QualtricsResponsesTransform.buildCanonicalRows(matrix);
    if (!built.ok) {
      return { ok: false, errors: built.errors || ['transform_failed'] };
    }
    return QualtricsRoute.validateRoutableRows(built.rows, routingConfig ||
      QualtricsResponsesRoutingConfig.getActiveConfig());
  }

  /**
   * @param {string} csvText
   * @param {Object} [options]
   * @return {EdmJobTypes.EdmTransformationResult}
   */
  function transform(csvText, options) {
    try {
      var built = QualtricsResponsesTransform.transformCsvText(csvText, options);
      if (!built.ok) {
        return { ok: false, error: (built.errors || []).join('; ') };
      }
      return {
        ok: true,
        payload: {
          rows: built.rows,
          sourceRowCount: built.sourceRowCount,
          contractVersion: QualtricsResponsesSchema.CONTRACT_VERSION,
          warningCounts: built.warningCounts,
          exportWatermark: built.exportWatermark
        }
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * @param {Object} transformPayload
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [routingConfig]
   * @return {{ canonicalRows: Object[], routing: Object }}
   */
  function route(transformPayload, routingConfig) {
    var cfg = QualtricsResponsesRoutingConfig.getActiveConfig(routingConfig);
    var routing = QualtricsRoute.routeCanonicalDataset(transformPayload.rows, cfg);
    return {
      canonicalRows: transformPayload.rows,
      routing: routing
    };
  }

  return {
    PIPELINE_ID: PIPELINE_ID,
    validateSource: validateSource,
    transform: transform,
    route: route
  };
})();
