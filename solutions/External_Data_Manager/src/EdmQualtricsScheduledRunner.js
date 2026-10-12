/**
 * Shared Qualtrics scheduled runner: InFlight then Responses, isolated try/catch.
 * @namespace EdmQualtricsScheduledRunner
 */
var EdmQualtricsScheduledRunner = (function () {
  'use strict';

  /**
   * @param {Object} deps
   * @param {function(): Object} deps.runInFlight
   * @param {function(): Object} deps.runResponses
   * @param {function(): Object} [deps.runCapacity]
   * @param {function(string)} [deps.log]
   * @return {{ ok: boolean, inflight: Object, responses: Object, capacity?: Object }}
   */
  function runScheduledPipelines(deps) {
    var log = deps.log || function (msg) {
      Logger.log(msg);
    };
    var inflightResult;
    var responsesResult;

    try {
      inflightResult = deps.runInFlight();
    } catch (inflightErr) {
      log('EdmQualtricsScheduledRunner: inflight threw: ' + inflightErr);
      inflightResult = {
        ok: false,
        pipeline: 'qualtrics_inflight',
        message: String(inflightErr)
      };
    }

    try {
      responsesResult = deps.runResponses();
    } catch (responsesErr) {
      log('EdmQualtricsScheduledRunner: responses threw: ' + responsesErr);
      responsesResult = {
        ok: false,
        pipeline: 'qualtrics_responses',
        message: String(responsesErr)
      };
    }

    var capacityResult;
    if (deps.runCapacity) {
      try {
        capacityResult = deps.runCapacity();
      } catch (capacityErr) {
        log('EdmQualtricsScheduledRunner: capacity threw: ' + capacityErr);
        capacityResult = {
          ok: false,
          pipeline: 'slg_capacity_wow',
          message: String(capacityErr)
        };
      }
    }

    var inflightOk = inflightResult && inflightResult.ok !== false;
    var responsesOk = responsesResult && responsesResult.ok !== false;
    var capacityOk = !deps.runCapacity || (capacityResult && capacityResult.ok !== false);
    return {
      ok: inflightOk && responsesOk && capacityOk,
      inflight: inflightResult,
      responses: responsesResult,
      capacity: capacityResult
    };
  }

  return {
    runScheduledPipelines: runScheduledPipelines
  };
})();
