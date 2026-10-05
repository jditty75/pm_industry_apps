/**
 * Qualtrics pipeline adapter (validate → normalize → route).
 * @namespace QualtricsPipeline
 */
var QualtricsPipeline = (function () {
  'use strict';

  var PIPELINE_ID = 'qualtrics';

  /**
   * @param {string} csvText
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [routingConfig]
   * @return {EdmJobTypes.EdmValidationResult}
   */
  function validateSource(csvText, routingConfig) {
    try {
      var dataset = QualtricsTransform.buildCanonicalDataset(csvText);
      return QualtricsRoute.validateRoutableRows(dataset.rows, routingConfig);
    } catch (e) {
      return { ok: false, errors: [String(e.message || e)] };
    }
  }

  /**
   * Normalization only — canonical dataset, no HC/SLG/HENP branching.
   *
   * @param {string} csvText
   * @return {EdmJobTypes.EdmTransformationResult}
   */
  function transform(csvText) {
    try {
      var dataset = QualtricsTransform.buildCanonicalDataset(csvText);
      return {
        ok: true,
        payload: {
          rows: dataset.rows,
          sourceRowCount: dataset.sourceRowCount,
          contractVersion: dataset.contractVersion,
          ignoredSourceColumns: dataset.ignoredSourceColumns
        }
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * @param {Object} transformPayload output of transform()
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [routingConfig]
   * @return {{ canonicalRows: Object[], routing: Object }}
   */
  function route(transformPayload, routingConfig) {
    var routing = QualtricsRoute.routeCanonicalDataset(transformPayload.rows, routingConfig);
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
