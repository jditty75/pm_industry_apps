/**
 * Qualtrics Inbox job processor (shared by Process Now and future trigger).
 * @namespace EdmQualtricsProcessor
 */
var EdmQualtricsProcessor = (function () {
  'use strict';

  var TRANSFORMER_VERSION = 'qualtrics-v1b';

  /**
   * @typedef {Object} ProcessorOptions
   * @property {boolean} [dryRun]
   * @property {boolean} [ingestEnabled]
   * @property {boolean} [deleteSuccessfulSource]
   * @property {string} [sourceFileName]
   * @property {boolean} [skipDuplicateCheck]
   * @property {boolean} [allowStaleOverride]
   * @property {boolean} [allowDuplicateOverride]
   * @property {string} [exportTimestamp]
   * @property {EdmDuplicateGuard.PriorJobRef[]} [priorJobs]
   * @property {Object} [qualtricsRoutingConfig]
   * @property {Object} [deps] test doubles
   */

  /**
   * @param {string} csvText
   * @param {Object} sourceMeta filename, fileId, etc.
   * @param {ProcessorOptions} options
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
    var job = EdmJob.createJob(QualtricsPipeline.PIPELINE_ID, {
      filename: sourceMeta.filename || '',
      checksum: checksum,
      exportTimestamp: options.exportTimestamp || sourceMeta.exportTimestamp || ''
    });

    var overrideFlags = [];
    if (!options.skipDuplicateCheck && options.priorJobs) {
      var dup = EdmDuplicateGuard.checkDuplicateSuccessful(checksum, options.priorJobs);
      if (!dup.allow && options.allowDuplicateOverride) {
        overrideFlags.push('DUPLICATE_OVERRIDE');
      } else if (!dup.allow) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: dup.reason,
          errorMessage: 'Duplicate successful job for source checksum'
        });
        return buildOutcome_(job, { ok: false, reason: dup.reason }, options);
      }
      var stale = EdmDuplicateGuard.checkStaleSource(
        options.exportTimestamp || sourceMeta.exportTimestamp,
        options.priorJobs
      );
      if (!stale.allow && options.allowStaleOverride) {
        overrideFlags.push('STALE_OVERRIDE');
      } else if (!stale.allow) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: stale.reason,
          errorMessage: 'Source export timestamp is older than a newer successful job'
        });
        return buildOutcome_(job, { ok: false, reason: stale.reason }, options);
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
      return buildOutcome_(job, { ok: false, validation: validation }, options);
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.TRANSFORMING);
    var transformResult = QualtricsPipeline.transform(csvText);
    if (!transformResult.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'TRANSFORM',
        errorMessage: transformResult.error || 'Transform failed'
      });
      return buildOutcome_(job, { ok: false, transform: transformResult }, options);
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.ROUTING);
    var routed = QualtricsPipeline.route(transformResult.payload, routingConfig);
    var routing = routed.routing;
    var popCounts = routing.countsByPopulationId || {};
    var slices = routing.slices || [];

    var destinationResults = planDestinations_(slices, routing.destinationPlan);
    job = EdmJob.transition(job, EdmJobTypes.JobStatus.READY_FOR_INGESTION, {
      transformerVersion: TRANSFORMER_VERSION,
      sourceRowCount: transformResult.payload.sourceRowCount,
      populationCounts: popCounts,
      healthcareCount: popCounts.healthcare || 0,
      sledCount: popCounts.sled || 0,
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
        diagnostics: diagnostics
      }, options, overrideFlags);
    }

    var props = deps.properties || PropertiesService.getScriptProperties();
    var coreLib = deps.coreLib || (typeof CoreLib !== 'undefined' ? CoreLib : null);
    var ingestOutcomes = [];
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
      job = EdmJob.transition(job, ingestStatusForApp_(plan.appId));
      var ingestMeta = {
        source: 'edm',
        jobId: job.jobId,
        backupCsvText: csvText
      };
      var ingest = EdmIngestAdapter.ingestNormalizedRows(
        plan.appId, plan.rows, ingestMeta, spreadsheetId, coreLib
      );
      plan.status = ingest.success ? 'success' : 'failed';
      plan.eligibleCount = ingest.eligibleCount;
      plan.writtenCount = ingest.writtenCount || ingest.imported;
      plan.excludedCount = ingest.excludedCount || ingest.discarded;
      plan.message = ingest.message || '';
      if (!ingest.success) {
        anyFail = true;
      }
      ingestOutcomes.push(ingest);
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
      ingestOutcomes: ingestOutcomes,
      diagnostics: diagnostics
    }, options, overrideFlags);
  }

  /**
   * @param {Object[]} slices
   * @param {Object[]} destinationPlan
   * @return {Object[]}
   */
  function planDestinations_(slices, destinationPlan) {
    var plans = [];
    (destinationPlan || []).forEach(function (dp) {
      var slice = null;
      for (var i = 0; i < slices.length; i++) {
        if (slices[i].populationId === dp.populationId) {
          slice = slices[i];
          break;
        }
      }
      var rows = slice ? slice.rows : [];
      (dp.destinationRefs || []).forEach(function (ref) {
        if (!ref.enabled) {
          return;
        }
        plans.push({
          appId: ref.appId,
          enabled: ref.enabled,
          ingestKind: ref.ingestKind,
          populationId: dp.populationId,
          inputRows: rows.length,
          rows: rows,
          status: 'pending'
        });
      });
    });
    return plans;
  }

  /**
   * @param {string} appId
   * @return {string}
   */
  function ingestStatusForApp_(appId) {
    if (appId === EdmDestinationRegistry.APP_HC) {
      return EdmJobTypes.JobStatus.INGESTING_HC;
    }
    if (appId === EdmDestinationRegistry.APP_SLG) {
      return EdmJobTypes.JobStatus.INGESTING_SLG;
    }
    if (appId === EdmDestinationRegistry.APP_HENP) {
      return EdmJobTypes.JobStatus.INGESTING_HENP;
    }
    return EdmJobTypes.JobStatus.ROUTING;
  }

  /**
   * @param {Object} plan
   * @return {EdmJobTypes.EdmDestinationResult}
   */
  function toDestResult_(plan) {
    return {
      destinationId: plan.appId,
      status: plan.status,
      rowCount: plan.writtenCount != null ? plan.writtenCount : plan.inputRows,
      message: plan.message || ''
    };
  }

  /**
   * @param {EdmJobTypes.EdmJobRecord} job
   * @param {Object[]} destinationResults
   * @return {string}
   */
  function buildDiagnostics_(job, destinationResults) {
    var parts = [
      'job=' + job.jobId,
      'sourceRows=' + (job.sourceRowCount || 0),
      'healthcareRows=' + (job.healthcareCount || 0),
      'sledRows=' + (job.sledCount || 0)
    ];
    (destinationResults || []).forEach(function (d) {
      parts.push(d.appId + ' eligible=' + d.inputRows);
    });
    parts.push('status=' + job.status);
    return parts.join(' ');
  }

  /**
   * @param {EdmJobTypes.EdmJobRecord} job
   * @param {Object} result
   * @param {ProcessorOptions} options
   * @param {string[]} [overrideFlags]
   * @return {Object}
   */
  function buildOutcome_(job, result, options, overrideFlags) {
    return {
      job: job,
      result: result,
      overrideFlags: overrideFlags || [],
      deleteSourceAllowed: computeDeleteAllowed_(job, result, options)
    };
  }

  /**
   * @param {EdmJobTypes.EdmJobRecord} job
   * @param {Object} result
   * @param {ProcessorOptions} options
   * @return {boolean}
   */
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
    processCsvJob: processCsvJob,
    planDestinations_: planDestinations_
  };
})();
