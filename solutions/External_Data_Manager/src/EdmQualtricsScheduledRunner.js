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
   * @param {function(string)} [deps.log]
   * @return {{ ok: boolean, inflight: Object, responses: Object }}
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

    var inflightOk = inflightResult && inflightResult.ok !== false;
    var responsesOk = responsesResult && responsesResult.ok !== false;
    return {
      ok: inflightOk && responsesOk,
      inflight: inflightResult,
      responses: responsesResult
    };
  }

  return {
    runScheduledPipelines: runScheduledPipelines
  };
})();
