/**
 * External Data Manager — entry points.
 */

/**
 * Future time-driven trigger entry (do not install automatically).
 * @param {Object=} e Apps Script trigger event
 * @return {Object}
 */
function runQualtricsInboxScheduled(e) {
  return processQualtricsInboxNow({
    dryRun: false,
    ingestEnabled: isQualtricsIngestEnabled_(),
    deleteSuccessfulSource: isDeleteSuccessfulSourceEnabled_()
  });
}

/**
 * Manual Process Now — same processor as future scheduled trigger.
 *
 * @param {Object=} options
 * @param {boolean} [options.dryRun=true] default true for controlled validation
 * @param {boolean} [options.ingestEnabled] when true, requires EDM_QUALTRICS_INGEST_ENABLED
 * @param {boolean} [options.deleteSuccessfulSource] default false
 * @param {string} [options.sourceFileName] optional inbox CSV name
 * @param {boolean} [options.allowDuplicateOverride]
 * @param {boolean} [options.allowStaleOverride]
 * @param {string[]} [options.retryDestinationAppIds] ingest only these logical apps on retry
 * @return {Object}
 */
function processQualtricsInboxNow(options) {
  options = options || {};
  var dryRun = options.dryRun !== false;
  var ingestEnabled = !!options.ingestEnabled && isQualtricsIngestEnabled_();
  if (options.ingestEnabled && !dryRun && !ingestEnabled) {
    return {
      ok: false,
      message: 'Ingest requested but EDM_QUALTRICS_INGEST_ENABLED is not true'
    };
  }

  var lock = EdmLocking.tryAcquire(EdmLocking.QUALTRICS_INGEST_LOCK_KEY, LockService, 1000);
  if (!lock.acquired) {
    return { ok: false, message: 'Another Qualtrics job is running' };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    ensureEdmBootstrapFromDrive_(props);
    var inboxId = props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
    if (!inboxId) {
      return { ok: false, message: 'QUALTRICS_INBOX_FOLDER_ID not configured' };
    }

    var candidate = EdmQualtricsInbox.findCandidateCsv(
      inboxId,
      options.sourceFileName,
      DriveApp
    );
    if (!candidate) {
      return { ok: true, message: 'No CSV in Inbox' };
    }

    var csvText = EdmQualtricsInbox.readCsvText(candidate.file);
    var ledgerId = props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
    var priorJobs = [];
    if (ledgerId) {
      var sheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
      priorJobs = EdmJobHistory.toPriorJobRefs(
        EdmAuditLedgerSheet.readAllJobs(sheet),
        QualtricsPipeline.PIPELINE_ID
      );
    }

    var outcome = EdmQualtricsProcessor.processCsvJob(csvText, {
      filename: candidate.name,
      fileId: candidate.id
    }, {
      dryRun: dryRun,
      ingestEnabled: ingestEnabled,
      deleteSuccessfulSource: options.deleteSuccessfulSource === true,
      priorJobs: priorJobs,
      allowDuplicateOverride: options.allowDuplicateOverride,
      allowStaleOverride: options.allowStaleOverride,
      skipDuplicateCheck: false
    });

    var disposition = 'INBOX';
    var duplicateBlocked = outcome.job &&
      outcome.job.errorCategory === 'DUPLICATE_SUCCESS_CHECKSUM';
    if (!outcome.result.ok && !dryRun && !duplicateBlocked) {
      var failedId = props.getProperty(EdmProperties.QUALTRICS_FAILED_FOLDER_ID);
      if (failedId) {
        try {
          EdmQualtricsInbox.moveToFailed(candidate.file, failedId, DriveApp);
          disposition = 'FAILED';
        } catch (moveErr) {
          Logger.log('processQualtricsInboxNow: moveToFailed skipped, source kept in Inbox: ' + moveErr);
          disposition = 'INBOX';
        }
      }
    } else if (outcome.deleteSourceAllowed) {
      EdmQualtricsInbox.deleteFile(candidate.file);
      disposition = 'DELETED_AFTER_SUCCESS';
    } else if (outcome.result.ok) {
      disposition = dryRun ? 'INBOX' : 'INBOX_AFTER_SUCCESS';
    }

    if (ledgerId) {
      var ledgerSheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
      EdmAuditLedgerSheet.appendJob(ledgerSheet, outcome.job, {
        sourceDisposition: disposition,
        overrideFlags: (outcome.overrideFlags || []).join(','),
        hcEligible: countEligible_(outcome, EdmDestinationRegistry.APP_HC),
        slgEligible: countEligible_(outcome, EdmDestinationRegistry.APP_SLG),
        henpEligible: countEligible_(outcome, EdmDestinationRegistry.APP_HENP)
      });
    }

    Logger.log('processQualtricsInboxNow: ' + buildJobLogLine_(outcome));
    return {
      ok: outcome.result.ok,
      dryRun: dryRun,
      jobId: outcome.job.jobId,
      disposition: disposition,
      diagnostics: outcome.result.diagnostics,
      outcome: outcome
    };
  } finally {
    lock.release();
  }
}

/**
 * @param {Object} outcome
 * @return {string}
 */
function buildJobLogLine_(outcome) {
  var job = outcome.job || {};
  return [
    'job ' + job.jobId,
    'status=' + job.status,
    'healthcare=' + (job.healthcareCount || 0),
    'sled=' + (job.sledCount || 0)
  ].join(' ');
}

/**
 * @param {Object} outcome
 * @param {string} appId
 * @return {number}
 */
function countEligible_(outcome, appId) {
  var list = outcome.result.destinationResults || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].appId === appId) {
      return list[i].inputRows || 0;
    }
  }
  return 0;
}

/**
 * @return {boolean}
 */
function isQualtricsIngestEnabled_() {
  return PropertiesService.getScriptProperties()
    .getProperty(EdmProperties.INGEST_ENABLED) === 'true';
}

/**
 * @return {boolean}
 */
function isDeleteSuccessfulSourceEnabled_() {
  return PropertiesService.getScriptProperties()
    .getProperty(EdmProperties.DELETE_SUCCESSFUL_SOURCE) === 'true';
}

/**
 * @return {boolean}
 */
function isQualtricsResponsesIngestEnabled_() {
  return PropertiesService.getScriptProperties()
    .getProperty(EdmProperties.RESPONSES_INGEST_ENABLED) === 'true';
}

/**
 * Manual Responses inbox processor (dry-run default; does not alter InFlight trigger).
 *
 * @param {Object=} options
 * @param {string[]} [options.limitDestinationAppIds] ingest only these logical apps (HC_DM|SLG_DM|HENP_DM)
 * @param {string[]} [options.retryDestinationAppIds] alias for limitDestinationAppIds
 * @return {Object}
 */
function processQualtricsResponsesInboxNow(options) {
  options = options || {};
  var dryRun = options.dryRun !== false;
  var ingestEnabled = !!options.ingestEnabled && isQualtricsResponsesIngestEnabled_();
  if (options.ingestEnabled && !dryRun && !ingestEnabled) {
    return {
      ok: false,
      message: 'Ingest requested but EDM_QUALTRICS_RESPONSES_INGEST_ENABLED is not true'
    };
  }

  var lock = EdmLocking.tryAcquire(EdmLocking.QUALTRICS_INGEST_LOCK_KEY, LockService, 1000);
  if (!lock.acquired) {
    return { ok: false, message: 'Another Qualtrics job is running' };
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var inboxId = props.getProperty(EdmProperties.QUALTRICS_RESPONSES_INBOX_FOLDER_ID);
    if (!inboxId) {
      return { ok: false, message: 'QUALTRICS_RESPONSES_INBOX_FOLDER_ID not configured' };
    }

    var candidate = EdmQualtricsInbox.findCandidateCsv(
      inboxId,
      options.sourceFileName,
      DriveApp
    );
    if (!candidate) {
      return { ok: true, message: 'No CSV in Responses Inbox' };
    }

    var csvText = EdmQualtricsInbox.readCsvText(candidate.file);
    var ledgerId = props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
    var priorJobs = [];
    if (ledgerId) {
      var sheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
      priorJobs = EdmJobHistory.toPriorJobRefs(
        EdmAuditLedgerSheet.readAllJobs(sheet),
        QualtricsResponsesPipeline.PIPELINE_ID
      );
    }

    var outcome = EdmQualtricsResponsesProcessor.processCsvJob(csvText, {
      filename: candidate.name,
      fileId: candidate.id
    }, {
      dryRun: dryRun,
      ingestEnabled: ingestEnabled,
      deleteSuccessfulSource: options.deleteSuccessfulSource === true,
      priorJobs: priorJobs,
      allowDuplicateOverride: options.allowDuplicateOverride,
      allowStaleOverride: options.allowStaleOverride,
      skipDuplicateCheck: options.skipDuplicateCheck === true,
      limitDestinationAppIds: options.limitDestinationAppIds || options.retryDestinationAppIds
    });

    var disposition = 'INBOX';
    var duplicateBlocked = outcome.job &&
      outcome.job.errorCategory === 'DUPLICATE_SUCCESS_CHECKSUM';
    if (!outcome.result.ok && !dryRun && !duplicateBlocked) {
      var failedId = props.getProperty(EdmProperties.QUALTRICS_RESPONSES_FAILED_FOLDER_ID);
      if (failedId) {
        try {
          EdmQualtricsInbox.moveToFailed(candidate.file, failedId, DriveApp);
          disposition = 'FAILED';
        } catch (moveErr) {
          Logger.log('processQualtricsResponsesInboxNow: moveToFailed skipped: ' + moveErr);
        }
      }
    } else if (outcome.deleteSourceAllowed) {
      EdmQualtricsInbox.deleteFile(candidate.file);
      disposition = 'DELETED_AFTER_SUCCESS';
    } else if (outcome.result.ok) {
      disposition = dryRun ? 'INBOX' : 'INBOX_AFTER_SUCCESS';
    }

    if (ledgerId) {
      var ledgerSheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
      EdmAuditLedgerSheet.appendJob(ledgerSheet, outcome.job, {
        sourceDisposition: disposition,
        overrideFlags: (outcome.overrideFlags || []).join(','),
        hcEligible: countResponsesDestMetric_(outcome, EdmDestinationRegistry.APP_HC, 'eligibleCount'),
        slgEligible: countResponsesDestMetric_(outcome, EdmDestinationRegistry.APP_SLG, 'eligibleCount'),
        henpEligible: countResponsesDestMetric_(outcome, EdmDestinationRegistry.APP_HENP, 'eligibleCount')
      });
    }

    Logger.log('processQualtricsResponsesInboxNow: ' + buildResponsesJobLogLine_(outcome));
    return {
      ok: outcome.result.ok,
      dryRun: dryRun,
      jobId: outcome.job.jobId,
      disposition: disposition,
      diagnostics: outcome.result.diagnostics,
      warningCounts: outcome.result.warningCounts,
      destinationResults: summarizeResponsesDestinations_(outcome),
      outcome: outcome
    };
  } finally {
    lock.release();
  }
}

/**
 * @param {Object} outcome
 * @return {string}
 */
function buildResponsesJobLogLine_(outcome) {
  var job = outcome.job || {};
  return [
    'job ' + job.jobId,
    'pipeline=' + QualtricsResponsesPipeline.PIPELINE_ID,
    'status=' + job.status,
    'sourceRows=' + (job.sourceRowCount || 0)
  ].join(' ');
}

/**
 * @param {Object} outcome
 * @param {string} appId
 * @param {string} field
 * @return {number}
 */
function countResponsesDestMetric_(outcome, appId, field) {
  var list = outcome.result.destinationResults || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].appId === appId) {
      var val = list[i][field];
      if (val != null) {
        return val;
      }
      return list[i].inputRows || 0;
    }
  }
  return 0;
}

/**
 * @param {Object} outcome
 * @return {Object[]}
 */
function summarizeResponsesDestinations_(outcome) {
  var list = outcome.result.destinationResults || [];
  return list.map(function (d) {
    return {
      appId: d.appId,
      status: d.status,
      inputRows: d.inputRows,
      eligibleCount: d.eligibleCount,
      excludedCount: d.excludedCount,
      inserted: d.inserted,
      updated: d.updated,
      unchanged: d.unchanged,
      message: d.message
    };
  });
}

/**
 * V1A harness (CSV text, no Drive).
 * @param {string} [csvText]
 * @return {Object}
 */
/**
 * One-time import of Script Properties from Drive bootstrap JSON (shared-drive safe).
 * @param {Object} props
 */
function ensureEdmBootstrapFromDrive_(props) {
  if (props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID)) {
    return;
  }
  var iter = DriveApp.searchFiles(
    'title = "edm-v1b-bootstrap.json" and mimeType = "application/json" and trashed = false'
  );
  while (iter.hasNext()) {
    var file = iter.next();
    try {
      var config = JSON.parse(file.getBlob().getDataAsString('utf-8'));
      if (!config || !config.QUALTRICS_INBOX_FOLDER_ID) {
        continue;
      }
      props.setProperties(config, false);
      if (!props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID)) {
        EdmSetup.ensureAuditLedger();
      }
      file.setTrashed(true);
      Logger.log('ensureEdmBootstrapFromDrive_: imported bootstrap properties');
      return;
    } catch (e) {
      Logger.log('ensureEdmBootstrapFromDrive_: invalid bootstrap skipped');
    }
  }
}

function runQualtricsV1aHarness(csvText) {
  if (!csvText) {
    return {
      ok: false,
      message: 'Pass CSV text to runQualtricsV1aHarness(csvText).'
    };
  }
  var outcome = EdmOrchestrator.processQualtricsCsvJob(csvText, {
    filename: 'manual-harness.csv',
    skipDuplicateCheck: true,
    checksumFn: function (text) {
      return EdmChecksum.sha256Hex(text, { computeDigest: Utilities.computeDigest.bind(Utilities) });
    }
  });
  Logger.log('runQualtricsV1aHarness: status=' + outcome.job.status);
  return outcome;
}
