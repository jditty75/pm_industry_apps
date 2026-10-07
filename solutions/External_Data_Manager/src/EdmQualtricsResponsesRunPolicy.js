/**
 * Invocation policy for Qualtrics Responses inbox entry points (testable).
 * @namespace EdmQualtricsResponsesRunPolicy
 */
var EdmQualtricsResponsesRunPolicy = (function () {
  'use strict';

  var MESSAGE_INGEST_DISABLED = 'RESPONSES_INGEST_DISABLED';
  var MESSAGE_NO_FILE = 'NO_ELIGIBLE_RESPONSES_FILE';
  var MESSAGE_DRY_RUN = 'DRY_RUN_COMPLETE';

  /**
   * @param {Object} options
   * @param {boolean} propertyIngestOn EDM_QUALTRICS_RESPONSES_INGEST_ENABLED === 'true'
   * @return {{ blocked: boolean, message?: string, dryRun?: boolean, ingestEnabled?: boolean, mode?: string }}
   */
  function resolveInvocation(options, propertyIngestOn) {
    options = options || {};
    var dryRun = options.dryRun !== false;
    var ingestEnabled = !!options.ingestEnabled && propertyIngestOn;

    if (!dryRun && !propertyIngestOn) {
      return {
        blocked: true,
        message: MESSAGE_INGEST_DISABLED,
        reason: MESSAGE_INGEST_DISABLED
      };
    }
    if (!dryRun && !options.ingestEnabled) {
      return {
        blocked: true,
        message: MESSAGE_INGEST_DISABLED,
        reason: 'RESPONSES_MANUAL_INGEST_FLAG_REQUIRED'
      };
    }

    return {
      blocked: false,
      dryRun: dryRun,
      ingestEnabled: ingestEnabled,
      mode: dryRun ? 'dry_run' : 'ingest'
    };
  }

  /**
   * @param {boolean} hasCandidate
   * @return {{ ok: boolean, message: string }}
   */
  function noCandidateResult(hasCandidate) {
    if (hasCandidate) {
      return { ok: true, message: '' };
    }
    return { ok: true, message: MESSAGE_NO_FILE, reason: MESSAGE_NO_FILE };
  }

  return {
    MESSAGE_INGEST_DISABLED: MESSAGE_INGEST_DISABLED,
    MESSAGE_NO_FILE: MESSAGE_NO_FILE,
    MESSAGE_DRY_RUN: MESSAGE_DRY_RUN,
    resolveInvocation: resolveInvocation,
    noCandidateResult: noCandidateResult
  };
})();
