/**
 * Job audit ledger design (Sheet-backed in V1B+; no production sheet in V1A).
 * @namespace EdmAuditLedger
 */
var EdmAuditLedger = (function () {
  'use strict';

  /** @type {string[]} */
  var LEDGER_HEADERS = [
    'job_id',
    'pipeline',
    'source_filename',
    'source_checksum',
    'source_export_timestamp',
    'created_at',
    'updated_at',
    'transformer_version',
    'source_row_count',
    'healthcare_count',
    'sled_count',
    'hc_ingest_count',
    'slg_ingest_count',
    'henp_ingest_count',
    'destination_statuses',
    'overall_status',
    'error_category',
    'error_message'
  ];

  /**
   * @param {EdmJobTypes.EdmJobRecord} job
   * @return {string[]}
   */
  function jobToLedgerRow(job) {
    var dest = (job.destinations || []).map(function (d) {
      return d.destinationId + ':' + d.status;
    }).join(';');
    return [
      job.jobId,
      job.pipelineId,
      job.source.filename || '',
      job.source.checksum || '',
      job.source.exportTimestamp || '',
      job.createdAt,
      job.updatedAt || '',
      job.transformerVersion || '',
      job.sourceRowCount != null ? String(job.sourceRowCount) : '',
      job.healthcareCount != null ? String(job.healthcareCount) : '',
      job.sledCount != null ? String(job.sledCount) : '',
      '',
      '',
      '',
      dest,
      job.status,
      job.errorCategory || '',
      job.errorMessage || ''
    ];
  }

  return {
    LEDGER_HEADERS: LEDGER_HEADERS,
    jobToLedgerRow: jobToLedgerRow
  };
})();
