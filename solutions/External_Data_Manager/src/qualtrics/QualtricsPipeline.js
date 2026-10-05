/**
 * Qualtrics pipeline adapter (validate → transform → route).
 * @namespace QualtricsPipeline
 */
var QualtricsPipeline = (function () {
  'use strict';

  var PIPELINE_ID = 'qualtrics';

  /**
   * @param {string} csvText
   * @return {EdmJobTypes.EdmValidationResult}
   */
  function validateSource(csvText) {
    try {
      QualtricsTransform.normalizeQualtricsCsv(csvText);
      return { ok: true };
    } catch (e) {
      return { ok: false, errors: [String(e.message || e)] };
    }
  }

  /**
   * @param {string} csvText
   * @return {EdmJobTypes.EdmTransformationResult}
   */
  function transform(csvText) {
    try {
      var norm = QualtricsTransform.normalizeQualtricsCsv(csvText);
      var routed = QualtricsRoute.routePopulations(norm.rows);
      return {
        ok: true,
        payload: {
          rows: norm.rows,
          healthcare: routed.healthcare,
          sled: routed.sled,
          counts: routed.counts,
          sourceRowCount: norm.sourceRowCount
        }
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * @param {Object} transformPayload
   * @return {{ healthcare: Object[], sled: Object[], destinationPlan: Object[] }}
   */
  function route(transformPayload) {
    var plan = [];
    if (transformPayload.healthcare.length) {
      plan.push({
        population: QualtricsSchema.POPULATION_HEALTHCARE,
        destinations: QualtricsRoute.ROUTE_BY_APP['US Healthcare'].destinations,
        rowCount: transformPayload.healthcare.length,
        ingestEnabled: false
      });
    }
    if (transformPayload.sled.length) {
      plan.push({
        population: QualtricsSchema.POPULATION_SLED,
        destinations: QualtricsRoute.ROUTE_BY_APP['US SLED'].destinations,
        rowCount: transformPayload.sled.length,
        ingestEnabled: false
      });
    }
    return {
      healthcare: transformPayload.healthcare,
      sled: transformPayload.sled,
      destinationPlan: plan
    };
  }

  return {
    PIPELINE_ID: PIPELINE_ID,
    validateSource: validateSource,
    transform: transform,
    route: route
  };
})();
