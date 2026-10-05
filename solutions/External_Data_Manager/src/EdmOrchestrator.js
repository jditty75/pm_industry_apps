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
   * @property {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [qualtricsRoutingConfig]
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
    var routingConfig = options.qualtricsRoutingConfig;
    var validation = QualtricsPipeline.validateSource(csvText, routingConfig);
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
    var routed = QualtricsPipeline.route(transformResult.payload, routingConfig);
    var routing = routed.routing;
    var popCounts = routing.countsByPopulationId || {};
    job = EdmJob.transition(job, EdmJobTypes.JobStatus.READY_FOR_INGESTION, {
      transformerVersion: TRANSFORMER_VERSION,
      sourceRowCount: transformResult.payload.sourceRowCount,
      populationCounts: popCounts,
      healthcareCount: popCounts.healthcare || 0,
      sledCount: popCounts.sled || 0,
      destinations: (routing.destinationPlan || []).map(function (p) {
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
        canonicalDataset: {
          rows: routed.canonicalRows,
          contractVersion: transformResult.payload.contractVersion,
          ignoredSourceColumns: transformResult.payload.ignoredSourceColumns
        },
        routeSlices: routing.slices,
        destinationPlan: routing.destinationPlan,
        populationCounts: popCounts,
        normalizedRowCount: transformResult.payload.rows.length
      }
    };
  }

  return {
    TRANSFORMER_VERSION: TRANSFORMER_VERSION,
    processQualtricsCsvJob: processQualtricsCsvJob
  };
})();
