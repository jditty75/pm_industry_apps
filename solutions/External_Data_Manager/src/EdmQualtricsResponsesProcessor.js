/**
 * Qualtrics Responses Inbox job processor (manual / future scheduled entry).
 * @namespace EdmQualtricsResponsesProcessor
 */
var EdmQualtricsResponsesProcessor = (function () {
  'use strict';

  var TRANSFORMER_VERSION = 'qualtrics-responses-v1';

  /**
   * @param {string} csvText
   * @param {Object} sourceMeta
   * @param {Object} options
   * @return {Object}
   */
  function processCsvJob(csvText, sourceMeta, options) {
    options = options || {};
    var deps = options.deps || {};
    var checksumFn = deps.checksumFn || function (text) {
      return EdmChecksum.sha256Hex(text, {
        computeDigest: Utilities.computeDigest.bind(Utilities)
      });
    };
    var checksum = checksumFn(csvText);
    var job = EdmJob.createJob(QualtricsResponsesPipeline.PIPELINE_ID, {
      filename: sourceMeta.filename || '',
      checksum: checksum,
      exportTimestamp: options.exportTimestamp || sourceMeta.exportTimestamp || ''
    });

    var overrideFlags = [];
    var priorJobs = options.priorJobs || [];
    if (!options.skipDuplicateCheck && priorJobs.length) {
      var dup = EdmDuplicateGuard.checkDuplicateSuccessful(checksum, priorJobs);
      if (!dup.allow && options.allowDuplicateOverride) {
        overrideFlags.push('DUPLICATE_OVERRIDE');
      } else if (!dup.allow) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: dup.reason,
          errorMessage: 'Duplicate successful job for source checksum'
        });
        return buildOutcome_(job, { ok: false, reason: dup.reason }, options);
      }
      var exportTs = options.exportTimestamp || sourceMeta.exportTimestamp;
      var stale = EdmDuplicateGuard.checkStaleSource(exportTs, priorJobs);
      if (!stale.allow && options.allowStaleOverride) {
        overrideFlags.push('STALE_OVERRIDE');
      } else if (!stale.allow) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: stale.reason,
          errorMessage: 'Source export watermark is older than a newer successful job'
        });
        return buildOutcome_(job, { ok: false, reason: stale.reason }, options);
      }
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.VALIDATING);
    var routingConfig = options.qualtricsResponsesRoutingConfig;
    var validation = QualtricsResponsesPipeline.validateSource(csvText, routingConfig);
    if (!validation.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'VALIDATION',
        errorMessage: (validation.errors || []).join('; ')
      });
      return buildOutcome_(job, { ok: false, validation: validation }, options);
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.TRANSFORMING);
    var transformResult = QualtricsResponsesPipeline.transform(csvText, options.transformOptions);
    if (!transformResult.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'TRANSFORM',
        errorMessage: transformResult.error || 'Transform failed'
      });
      return buildOutcome_(job, { ok: false, transform: transformResult }, options);
    }

    if (!options.exportTimestamp && transformResult.payload.exportWatermark) {
      options.exportTimestamp = transformResult.payload.exportWatermark;
      job.source.exportTimestamp = transformResult.payload.exportWatermark;
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.ROUTING);
    var routed = QualtricsResponsesPipeline.route(transformResult.payload, routingConfig);
    var routing = routed.routing;
    var popCounts = routing.countsByPopulationId || {};
    var slices = routing.slices || [];
    var destinationResults = EdmQualtricsProcessor.planDestinations_(slices, routing.destinationPlan);

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.READY_FOR_INGESTION, {
      transformerVersion: TRANSFORMER_VERSION,
      sourceRowCount: transformResult.payload.sourceRowCount,
      populationCounts: popCounts,
      healthcareCount: popCounts.healthcare || 0,
      sledCount: (popCounts.government || 0) + (popCounts.henp || 0),
      destinations: destinationResults.map(function (d) {
        return {
          destinationId: d.appId,
          status: 'pending',
          rowCount: d.inputRows,
          message: options.dryRun ? 'dry-run' : 'pending'
        };
      })
    });

    var diagnostics = buildDiagnostics_(job, destinationResults);

    if (options.dryRun || !options.ingestEnabled) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.READY_FOR_INGESTION, {
        errorMessage: options.dryRun ? 'DRY_RUN' : 'INGEST_DISABLED'
      });
      destinationResults.forEach(function (d) {
        d.status = 'skipped';
        d.message = options.dryRun ? 'dry-run' : 'ingest disabled';
      });
      job.destinations = destinationResults.map(toDestResult_);
      return buildOutcome_(job, {
        ok: true,
        dryRun: !!options.dryRun,
        destinationResults: destinationResults,
        diagnostics: diagnostics,
        warningCounts: transformResult.payload.warningCounts
      }, options, overrideFlags);
    }

    var props = deps.properties || PropertiesService.getScriptProperties();
    var coreLib = deps.coreLib || (typeof CoreLib !== 'undefined' ? CoreLib : null);
    var anyFail = false;

    destinationResults.forEach(function (plan) {
      if (!plan.enabled) {
        plan.status = 'skipped';
        return;
      }
      var spreadsheetId = EdmDestinationRegistry.resolveSpreadsheetId(plan.appId, props);
      if (!spreadsheetId) {
        plan.status = 'failed';
        plan.message = 'missing destination spreadsheet property';
        anyFail = true;
        return;
      }
      var ingestMeta = {
        source: 'edm',
        contractVersion: QualtricsResponsesSchema.CONTRACT_VERSION,
        jobId: job.jobId,
        transformerVersion: TRANSFORMER_VERSION,
        sourceRowCount: transformResult.payload.sourceRowCount,
        warningCounts: transformResult.payload.warningCounts || {},
        skipBackup: true
      };
      var ingest = EdmIngestAdapter.ingestCanonicalCsatResponses(
        plan.appId, plan.rows, ingestMeta, spreadsheetId, coreLib
      );
      plan.status = ingest.success ? 'success' : 'failed';
      plan.eligibleCount = ingest.eligible;
      plan.writtenCount = (ingest.inserted || 0) + (ingest.updated || 0);
      plan.excludedCount = ingest.excluded;
      plan.message = ingest.message || '';
      if (!ingest.success) {
        anyFail = true;
      }
    });

    job.destinations = destinationResults.map(toDestResult_);
    if (anyFail) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.PARTIAL_FAILURE, {
        errorCategory: 'DESTINATION_INGEST',
        errorMessage: 'One or more destinations failed'
      });
    } else {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.SUCCESS);
    }

    return buildOutcome_(job, {
      ok: !anyFail,
      destinationResults: destinationResults,
      diagnostics: diagnostics,
      warningCounts: transformResult.payload.warningCounts
    }, options, overrideFlags);
  }

  function toDestResult_(plan) {
    return {
      destinationId: plan.appId,
      status: plan.status,
      rowCount: plan.writtenCount != null ? plan.writtenCount : plan.inputRows,
      message: plan.message || ''
    };
  }

  function buildDiagnostics_(job, destinationResults) {
    var parts = [
      'job=' + job.jobId,
      'pipeline=' + QualtricsResponsesPipeline.PIPELINE_ID,
      'sourceRows=' + (job.sourceRowCount || 0)
    ];
    (destinationResults || []).forEach(function (d) {
      parts.push(d.appId + ' rows=' + d.inputRows);
    });
    parts.push('status=' + job.status);
    return parts.join(' ');
  }

  function buildOutcome_(job, result, options, overrideFlags) {
    return {
      job: job,
      result: result,
      overrideFlags: overrideFlags || [],
      deleteSourceAllowed: computeDeleteAllowed_(job, result, options)
    };
  }

  function computeDeleteAllowed_(job, result, options) {
    if (options.deleteSuccessfulSource !== true) {
      return false;
    }
    if (!result.ok || job.status !== EdmJobTypes.JobStatus.SUCCESS) {
      return false;
    }
    var dests = job.destinations || [];
    for (var i = 0; i < dests.length; i++) {
      if (dests[i].status !== 'success' && dests[i].status !== 'skipped') {
        return false;
      }
    }
    return true;
  }

  return {
    TRANSFORMER_VERSION: TRANSFORMER_VERSION,
    processCsvJob: processCsvJob
  };
})();
