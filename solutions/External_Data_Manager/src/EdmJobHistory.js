/**
 * Prior-job lookups for duplicate/stale guards (ledger-backed in GAS).
 * @namespace EdmJobHistory
 */
var EdmJobHistory = (function () {
  'use strict';

  /**
   * @param {Object[]} ledgerRows from EdmAuditLedgerSheet.readPriorJobs
   * @return {EdmDuplicateGuard.PriorJobRef[]}
   */
  function toPriorJobRefs(ledgerRows) {
    return (ledgerRows || []).map(function (r) {
      return {
        checksum: r.source_checksum || r.checksum || '',
        status: r.overall_status || r.status || '',
        errorMessage: r.error_message || '',
        exportTimestamp: r.source_export_timestamp || '',
        completedAt: r.updated_at || r.completed_at || ''
      };
    });
  }

  /**
   * @param {string} appId
   * @param {Object[]} ledgerRows
   * @return {Object|null} last successful row for destination
   */
  function lastSuccessfulDestination(ledgerRows, appId) {
    var rows = (ledgerRows || []).slice().reverse();
    for (var i = 0; i < rows.length; i++) {
      var statuses = String(rows[i].destination_statuses || '');
      if (rows[i].overall_status === EdmJobTypes.JobStatus.SUCCESS &&
          statuses.indexOf(appId + ':success') >= 0) {
        return rows[i];
      }
    }
    return null;
  }

  return {
    toPriorJobRefs: toPriorJobRefs,
    lastSuccessfulDestination: lastSuccessfulDestination
  };
})();
