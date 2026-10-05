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
      priorJobs = EdmJobHistory.toPriorJobRefs(EdmAuditLedgerSheet.readAllJobs(sheet));
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
    if (!outcome.result.ok && !dryRun) {
      var failedId = props.getProperty(EdmProperties.QUALTRICS_FAILED_FOLDER_ID);
      if (failedId) {
        EdmQualtricsInbox.moveToFailed(candidate.file, failedId, DriveApp);
        disposition = 'FAILED';
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
 * V1A harness (CSV text, no Drive).
 * @param {string} [csvText]
 * @return {Object}
 */
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
