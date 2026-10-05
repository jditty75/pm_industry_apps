/**
 * External Data Manager job processor (V1A stops at READY_FOR_INGESTION).
 * @namespace EdmOrchestrator
 */
var EdmOrchestrator = (function () {
  'use strict';

  var TRANSFORMER_VERSION = 'qualtrics-v1a';

  /**
   * @typedef {Object} ProcessQualtricsOptions
   * @property {string} [filename]
   * @property {string} [exportTimestamp]
   * @property {EdmDuplicateGuard.PriorJobRef[]} [priorJobs]
   * @property {function(string): string} [checksumFn]
   * @property {boolean} [skipDuplicateCheck]
   */

  /**
   * @param {string} csvText
   * @param {ProcessQualtricsOptions} [options]
   * @return {Object}
   */
  function processQualtricsCsvJob(csvText, options) {
    options = options || {};
    var checksumFn = options.checksumFn;
    if (!checksumFn) {
      checksumFn = function (text) {
        if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
          return EdmChecksum.sha256Hex(text, { computeDigest: Utilities.computeDigest.bind(Utilities) });
        }
        throw new Error('EdmOrchestrator: provide checksumFn outside Apps Script');
      };
    }
    var checksum = checksumFn(csvText);
    var job = EdmJob.createJob(QualtricsPipeline.PIPELINE_ID, {
      filename: options.filename || '',
      checksum: checksum,
      exportTimestamp: options.exportTimestamp || ''
    });

    if (!options.skipDuplicateCheck && options.priorJobs) {
      var dup = EdmDuplicateGuard.checkDuplicateSuccessful(checksum, options.priorJobs);
      if (!dup.allow) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: dup.reason,
          errorMessage: 'Duplicate successful job for source checksum'
        });
        return { job: job, result: { ok: false, reason: dup.reason } };
      }
      var stale = EdmDuplicateGuard.checkStaleSource(options.exportTimestamp, options.priorJobs);
      if (!stale.allow) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: stale.reason,
          errorMessage: 'Source export timestamp is older than a newer successful job'
        });
        return { job: job, result: { ok: false, reason: stale.reason } };
      }
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.VALIDATING);
    var validation = QualtricsPipeline.validateSource(csvText);
    if (!validation.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'VALIDATION',
        errorMessage: (validation.errors || []).join('; ')
      });
      return { job: job, result: { ok: false, validation: validation } };
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.TRANSFORMING);
    var transformResult = QualtricsPipeline.transform(csvText);
    if (!transformResult.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'TRANSFORM',
        errorMessage: transformResult.error || 'Transform failed'
      });
      return { job: job, result: { ok: false, transform: transformResult } };
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.ROUTING);
    var routed = QualtricsPipeline.route(transformResult.payload);
    job = EdmJob.transition(job, EdmJobTypes.JobStatus.READY_FOR_INGESTION, {
      transformerVersion: TRANSFORMER_VERSION,
      sourceRowCount: transformResult.payload.sourceRowCount,
      healthcareCount: routed.healthcare.length,
      sledCount: routed.sled.length,
      destinations: (routed.destinationPlan || []).map(function (p) {
        return {
          destinationId: p.destinations.join('+'),
          status: 'pending',
          rowCount: p.rowCount,
          message: 'V1A: ingest not executed'
        };
      })
    });

    return {
      job: job,
      result: {
        ok: true,
        healthcare: routed.healthcare,
        sled: routed.sled,
        destinationPlan: routed.destinationPlan,
        normalizedRowCount: transformResult.payload.rows.length
      }
    };
  }

  return {
    TRANSFORMER_VERSION: TRANSFORMER_VERSION,
    processQualtricsCsvJob: processQualtricsCsvJob
  };
})();
