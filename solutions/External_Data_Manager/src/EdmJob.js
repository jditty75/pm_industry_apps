/**
 * Job identity, lifecycle transitions, and audit-friendly snapshots.
 * @namespace EdmJob
 */
var EdmJob = (function () {
  'use strict';

  /**
   * @param {string} pipelineId
   * @param {EdmJobTypes.EdmSourceMetadata} sourceMeta
   * @param {string} [nowIso]
   * @return {EdmJobTypes.EdmJobRecord}
   */
  function createJob(pipelineId, sourceMeta, nowIso) {
    var now = nowIso || new Date().toISOString();
    var id = buildJobId_(pipelineId, sourceMeta.checksum || '', now);
    return {
      jobId: id,
      pipelineId: pipelineId,
      status: EdmJobTypes.JobStatus.RECEIVED,
      source: Object.assign({ pipelineId: pipelineId }, sourceMeta),
      createdAt: now,
      updatedAt: now,
      destinations: []
    };
  }

  /**
   * @param {EdmJobTypes.EdmJobRecord} job
   * @param {string} nextStatus
   * @param {Object} [patch]
   * @return {EdmJobTypes.EdmJobRecord}
   */
  function transition(job, nextStatus, patch) {
    var copy = JSON.parse(JSON.stringify(job));
    copy.status = nextStatus;
    copy.updatedAt = new Date().toISOString();
    if (patch) {
      Object.keys(patch).forEach(function (k) {
        copy[k] = patch[k];
      });
    }
    return copy;
  }

  /**
   * @param {string} pipelineId
   * @param {string} checksum
   * @param {string} nowIso
   * @return {string}
   */
  function buildJobId_(pipelineId, checksum, nowIso) {
    var slug = (checksum || 'nochk').slice(0, 12);
    var ts = nowIso.replace(/[:.]/g, '').slice(0, 15);
    return pipelineId + '_' + ts + '_' + slug;
  }

  return {
    createJob: createJob,
    transition: transition,
    buildJobId: buildJobId_
  };
})();
