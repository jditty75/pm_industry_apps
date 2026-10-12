/**
 * SLG Capacity four-file inbox processor.
 * @namespace EdmSlgCapacityProcessor
 */
var EdmSlgCapacityProcessor = (function () {
  'use strict';

  var TRANSFORMER_VERSION = 'slg-capacity-wow-v4';

  /**
   * @param {Object.<string, string>} batchTexts slot -> csv text
   * @param {Object} sourceMeta filenames, file ids
   * @param {Object} options
   * @return {Object}
   */
  function processBatchJob(batchTexts, sourceMeta, options) {
    options = options || {};
    var deps = options.deps || {};
    var checksumFn = deps.checksumFn || function () {
      return SlgCapacityPipeline.combinedChecksum(batchTexts);
    };
    var checksum = checksumFn(batchTexts);
    var job = EdmJob.createJob(SlgCapacityPipeline.PIPELINE_ID, {
      filename: sourceMeta.batchLabel || 'slg_capacity_batch',
      checksum: checksum,
      exportTimestamp: options.exportTimestamp || sourceMeta.exportTimestamp || ''
    });

    if (!options.skipDuplicateCheck && options.priorJobs) {
      var dup = EdmDuplicateGuard.checkDuplicateSuccessful(checksum, options.priorJobs);
      if (!dup.allow && !options.allowDuplicateOverride) {
        job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
          errorCategory: dup.reason,
          errorMessage: 'Duplicate successful batch checksum'
        });
        return buildOutcome_(job, { ok: false, reason: dup.reason }, options);
      }
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.VALIDATING);
    var validation = SlgCapacityPipeline.validateBatch(sourceMeta.batchFiles || {}, batchTexts);
    if (!validation.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'VALIDATION',
        errorMessage: (validation.errors || []).join('; ')
      });
      return buildOutcome_(job, { ok: false, validation: validation }, options);
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.TRANSFORMING);
    var transformResult = SlgCapacityPipeline.transformBatch(batchTexts, options.runDate);
    if (!transformResult.ok) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'TRANSFORM',
        errorMessage: transformResult.error || 'Transform failed'
      });
      return buildOutcome_(job, { ok: false, transform: transformResult }, options);
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.READY_FOR_INGESTION, {
      transformerVersion: TRANSFORMER_VERSION,
      destinations: [{
        destinationId: 'SLG_CAPACITY',
        status: 'pending',
        message: options.dryRun ? 'dry-run' : 'pending'
      }]
    });

    if (options.dryRun || !options.ingestEnabled) {
      job.destinations[0].status = 'skipped';
      job.destinations[0].message = options.dryRun ? 'dry-run' : 'ingest disabled';
      return buildOutcome_(job, {
        ok: true,
        dryRun: !!options.dryRun,
        sheets: transformResult.payload.sheets,
        log: transformResult.payload.log
      }, options);
    }

    var props = deps.properties || PropertiesService.getScriptProperties();
    var handoffId = props.getProperty(EdmProperties.SLG_CAPACITY_HANDOFF_FOLDER_ID);
    if (!handoffId) {
      job = EdmJob.transition(job, EdmJobTypes.JobStatus.FAILED, {
        errorCategory: 'CONFIG',
        errorMessage: 'SLG_CAPACITY_HANDOFF_FOLDER_ID not configured'
      });
      return buildOutcome_(job, { ok: false, message: 'missing handoff folder' }, options);
    }

    job = EdmJob.transition(job, EdmJobTypes.JobStatus.VERIFYING);
    var title = 'WoW_Consolidated_' + job.jobId + '.xlsx';
    var handoff = EdmSlgCapacityHandoff.writeConsolidatedSpreadsheet(
      transformResult.payload.sheets,
      handoffId,
      title,
      deps.handoffDeps
    );

    job.destinations[0].status = 'success';
    job.destinations[0].message = handoff.spreadsheetId;
    job.destinations[0].rowCount = transformResult.payload.sheets.Forecast_Staged.length;
    job = EdmJob.transition(job, EdmJobTypes.JobStatus.SUCCESS);

    return buildOutcome_(job, {
      ok: true,
      handoff: handoff,
      sheets: transformResult.payload.sheets,
      log: transformResult.payload.log
    }, options);
  }

  /**
   * @param {Object} job
   * @param {Object} body
   * @param {Object} options
   * @param {string[]} [overrideFlags]
   * @return {Object}
   */
  function buildOutcome_(job, body, options, overrideFlags) {
    return {
      ok: body.ok !== false,
      job: job,
      dryRun: body.dryRun != null ? !!body.dryRun : !!(options && options.dryRun),
      reason: body.reason,
      validation: body.validation,
      transform: body.transform,
      handoff: body.handoff,
      sheets: body.sheets,
      log: body.log,
      overrideFlags: overrideFlags || []
    };
  }

  return {
    processBatchJob: processBatchJob,
    TRANSFORMER_VERSION: TRANSFORMER_VERSION
  };
})();
