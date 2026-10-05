/**
 * Duplicate and stale-source protection (in-memory / ledger-backed in production).
 * @namespace EdmDuplicateGuard
 */
var EdmDuplicateGuard = (function () {
  'use strict';

  /**
   * @typedef {Object} PriorJobRef
   * @property {string} checksum
   * @property {string} status
   * @property {string} [errorMessage]
   * @property {string} [exportTimestamp]
   * @property {string} [completedAt]
   */

  /**
   * @param {PriorJobRef} prior
   * @return {boolean}
   */
  function isSuccessfulIngestion_(prior) {
    if (prior.status !== EdmJobTypes.JobStatus.SUCCESS) {
      return false;
    }
    var marker = String(prior.errorMessage || '');
    if (marker === 'DRY_RUN' || marker === 'INGEST_DISABLED') {
      return false;
    }
    return true;
  }

  /**
   * @param {string} checksum
   * @param {PriorJobRef[]} priorJobs
   * @return {{ allow: boolean, reason?: string }}
   */
  function checkDuplicateSuccessful(checksum, priorJobs) {
    for (var i = 0; i < priorJobs.length; i++) {
      var p = priorJobs[i];
      if (p.checksum === checksum && isSuccessfulIngestion_(p)) {
        return { allow: false, reason: 'DUPLICATE_SUCCESS_CHECKSUM' };
      }
    }
    return { allow: true };
  }

  /**
   * Reject when an older export timestamp succeeds after a newer one already succeeded.
   * Qualtrics CSV may lack a reliable export timestamp — callers must pass only trusted values.
   *
   * @param {string|null|undefined} exportTimestamp
   * @param {PriorJobRef[]} priorJobs
   * @return {{ allow: boolean, reason?: string }}
   */
  function checkStaleSource(exportTimestamp, priorJobs) {
    if (!exportTimestamp) {
      return { allow: true, reason: 'NO_EXPORT_TIMESTAMP' };
    }
    var incoming = Date.parse(exportTimestamp);
    if (isNaN(incoming)) {
      return { allow: true, reason: 'UNPARSEABLE_EXPORT_TIMESTAMP' };
    }
    for (var i = 0; i < priorJobs.length; i++) {
      var p = priorJobs[i];
      if (p.status !== EdmJobTypes.JobStatus.SUCCESS || !p.exportTimestamp) {
        continue;
      }
      var prior = Date.parse(p.exportTimestamp);
      if (!isNaN(prior) && incoming < prior) {
        return { allow: false, reason: 'STALE_AFTER_NEWER_SUCCESS' };
      }
    }
    return { allow: true };
  }

  return {
    checkDuplicateSuccessful: checkDuplicateSuccessful,
    checkStaleSource: checkStaleSource
  };
})();
