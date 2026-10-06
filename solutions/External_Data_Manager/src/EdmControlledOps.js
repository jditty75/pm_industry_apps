/**
 * Clasp-run entry points for controlled V1B setup and dry-run validation.
 * Never log or return full Drive/spreadsheet identifiers.
 */

/**
 * @param {string} parentFolderId External Data parent Drive folder
 * @return {Object}
 */
function runEdmV1bSetupQualtricsDrive(parentFolderId) {
  if (!parentFolderId) {
    return { ok: false, message: 'parentFolderId required' };
  }
  var ids = EdmSetup.setupQualtricsDriveFolders(parentFolderId);
  return {
    ok: true,
    inboxConfigured: !!ids.inboxId,
    failedConfigured: !!ids.failedId,
    qualtricsSegmentConfigured: !!ids.qualtricsFolderId
  };
}

/**
 * @return {Object}
 */
function runEdmV1bEnsureAuditLedger() {
  var ledgerId = EdmSetup.ensureAuditLedger();
  return {
    ok: !!ledgerId,
    ledgerConfigured: !!ledgerId,
    ledgerIdLength: ledgerId ? String(ledgerId).length : 0
  };
}

/**
 * @param {string} hcSpreadsheetId
 * @param {string} slgSpreadsheetId
 * @param {string} henpSpreadsheetId
 * @return {Object}
 */
function runEdmV1bSetDestinationSpreadsheetIds(hcSpreadsheetId, slgSpreadsheetId, henpSpreadsheetId) {
  if (!hcSpreadsheetId || !slgSpreadsheetId || !henpSpreadsheetId) {
    return { ok: false, message: 'hc, slg, and henp spreadsheet ids required' };
  }
  EdmSetup.setDestinationSpreadsheetId(EdmDestinationRegistry.APP_HC, hcSpreadsheetId);
  EdmSetup.setDestinationSpreadsheetId(EdmDestinationRegistry.APP_SLG, slgSpreadsheetId);
  EdmSetup.setDestinationSpreadsheetId(EdmDestinationRegistry.APP_HENP, henpSpreadsheetId);
  return { ok: true, destinationsConfigured: 3 };
}

/**
 * Read-only operational snapshot (no IDs, no PII).
 * @return {Object}
 */
function runEdmVerifyOperationalState() {
  var props = PropertiesService.getScriptProperties();
  var propReport = runEdmVerifyScriptProperties().properties;
  var triggers = ScriptApp.getProjectTriggers();
  var inboxConfigured = !!props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
  var failedConfigured = !!props.getProperty(EdmProperties.QUALTRICS_FAILED_FOLDER_ID);
  var ledgerConfigured = !!props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
  var destConfigured = [
    EdmDestinationRegistry.APP_HC,
    EdmDestinationRegistry.APP_SLG,
    EdmDestinationRegistry.APP_HENP
  ].filter(function (appId) {
    return !!EdmDestinationRegistry.resolveSpreadsheetId(appId, props);
  });
  return {
    ok: true,
    properties: propReport,
    ingestEnabled: props.getProperty(EdmProperties.INGEST_ENABLED) === 'true',
    deleteSuccessfulSource: props.getProperty(EdmProperties.DELETE_SUCCESSFUL_SOURCE) === 'true',
    qualtricsInboxConfigured: inboxConfigured,
    qualtricsFailedConfigured: failedConfigured,
    qualtricsResponsesInboxConfigured:
      !!props.getProperty(EdmProperties.QUALTRICS_RESPONSES_INBOX_FOLDER_ID),
    qualtricsResponsesFailedConfigured:
      !!props.getProperty(EdmProperties.QUALTRICS_RESPONSES_FAILED_FOLDER_ID),
    responsesIngestEnabled: props.getProperty(EdmProperties.RESPONSES_INGEST_ENABLED) === 'true',
    auditLedgerConfigured: ledgerConfigured,
    destinationsResolved: destConfigured,
    triggerCount: triggers.length,
    triggerHandlers: triggers.map(function (t) {
      return t.getHandlerFunction();
    })
  };
}

/**
 * @return {Object}
 */
function runEdmVerifyScriptProperties() {
  var props = PropertiesService.getScriptProperties();
  var keys = [
    EdmProperties.EXTERNAL_DATA_PARENT_FOLDER_ID,
    EdmProperties.QUALTRICS_INBOX_FOLDER_ID,
    EdmProperties.QUALTRICS_FAILED_FOLDER_ID,
    EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID,
    EdmProperties.DEST_HC_DM_SPREADSHEET_ID,
    EdmProperties.DEST_SLG_DM_SPREADSHEET_ID,
    EdmProperties.DEST_HENP_DM_SPREADSHEET_ID,
    EdmProperties.INGEST_ENABLED,
    EdmProperties.DELETE_SUCCESSFUL_SOURCE,
    EdmProperties.QUALTRICS_RESPONSES_INBOX_FOLDER_ID,
    EdmProperties.QUALTRICS_RESPONSES_FAILED_FOLDER_ID,
    EdmProperties.RESPONSES_INGEST_ENABLED,
    EdmProperties.DELETE_SUCCESSFUL_RESPONSES_SOURCE
  ];
  var status = {};
  keys.forEach(function (k) {
    var v = props.getProperty(k);
    status[k] = v ? 'set(len=' + String(v).length + ')' : 'missing';
  });
  return { ok: true, properties: status };
}

/**
 * Place or replace the tracked synthetic Qualtrics CSV in the configured Inbox.
 * @return {Object}
 */
function runEdmPlaceSyntheticQualtricsInbox() {
  var props = PropertiesService.getScriptProperties();
  var inboxId = props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
  if (!inboxId) {
    return { ok: false, message: 'QUALTRICS_INBOX_FOLDER_ID not configured' };
  }
  var folder = DriveApp.getFolderById(inboxId);
  var name = EdmSyntheticQualtricsFixture.FILENAME;
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  var file = folder.createFile(name, EdmSyntheticQualtricsFixture.getCsvText(), MimeType.CSV);
  return {
    ok: true,
    inboxFileName: name,
    inboxFileIdLength: file.getId().length
  };
}

/**
 * @param {Object} runResult from processQualtricsInboxNow
 * @return {Object}
 */
function sanitizeQualtricsRunSummary_(runResult) {
  var outcome = runResult.outcome || {};
  var job = outcome.job || {};
  var dests = (outcome.result && outcome.result.destinationResults) || [];
  return {
    ok: runResult.ok,
    dryRun: runResult.dryRun,
    jobId: job.jobId,
    status: job.status,
    errorCategory: job.errorCategory || '',
    errorMessage: job.errorMessage || '',
    healthcareCount: job.healthcareCount || 0,
    sledCount: job.sledCount || 0,
    sourceRowCount: job.sourceRowCount || 0,
    disposition: runResult.disposition,
    destinations: dests.map(function (d) {
      return {
        appId: d.appId,
        status: d.status,
        inputRows: d.inputRows,
        message: d.message
      };
    })
  };
}

/**
 * Sanitized dry-run against configured Qualtrics Inbox (no ingest, no delete).
 * @param {string=} sourceFileName optional inbox CSV name
 * @return {Object}
 */
/**
 * Read-only CSAT_InFlight row/header summary per destination (no PII, no spreadsheet ids).
 * @return {Object}
 */
function runEdmDestinationCsatBaselineSummary() {
  var props = PropertiesService.getScriptProperties();
  var expected = [
    'deployment_id',
    'account_name',
    'deployment_name',
    'survey_type',
    'tracking_status',
    'response_received',
    'contact_name',
    'contact_email',
    'contact_role',
    'engagement_manager',
    'partner_name',
    'sent_date',
    'opened_date',
    'started_date',
    'finished_date',
    'survey_expires'
  ];
  var apps = [
    EdmDestinationRegistry.APP_HC,
    EdmDestinationRegistry.APP_SLG,
    EdmDestinationRegistry.APP_HENP
  ];
  var summary = {};
  apps.forEach(function (appId) {
    var ssId = EdmDestinationRegistry.resolveSpreadsheetId(appId, props);
    if (!ssId) {
      summary[appId] = { ok: false, message: 'destination not configured' };
      return;
    }
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('CSAT_InFlight');
    if (!sheet) {
      summary[appId] = { ok: false, message: 'CSAT_InFlight missing' };
      return;
    }
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
      : [];
    summary[appId] = {
      ok: true,
      dataRowCount: Math.max(0, lastRow - 1),
      headerColumnCount: headers.length,
      headersMatchCanonical: headers.length === expected.length &&
        headers.every(function (h, i) {
          return h === expected[i];
        }),
      backupFolderName: 'DHM_CSAT_Imports'
    };
  });
  return { ok: true, apps: summary };
}

function runEdmQualtricsInboxDryRunSummary(sourceFileName) {
  var run = processQualtricsInboxNow({
    dryRun: true,
    sourceFileName: sourceFileName || undefined
  });
  return sanitizeQualtricsRunSummary_(run);
}

/**
 * Sanitized tail of the audit ledger (last job row, no PII).
 * @param {number} [limit]
 * @return {Object}
 */
function runEdmAuditLedgerTailSummary(limit) {
  var max = limit || 1;
  var props = PropertiesService.getScriptProperties();
  var ledgerId = props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
  if (!ledgerId) {
    return { ok: false, message: 'audit ledger not configured' };
  }
  var sheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
  var rows = EdmAuditLedgerSheet.readAllJobs(sheet);
  var tail = rows.slice(Math.max(0, rows.length - max));
  return {
    ok: true,
    rowCount: rows.length,
    tail: tail.map(function (r) {
      return {
        job_id: r.job_id,
        source_filename: r.source_filename,
        source_checksum: r.source_checksum ? String(r.source_checksum).slice(0, 16) + '…' : '',
        source_row_count: r.source_row_count,
        healthcare_count: r.healthcare_count,
        sled_count: r.sled_count,
        overall_status: r.overall_status,
        source_disposition: r.source_disposition,
        destination_statuses: r.destination_statuses
      };
    })
  };
}

/**
 * Single authorized first real Qualtrics ingest (editor or clasp run).
 * Enables ingest, runs one non–dry-run job, disables ingest again.
 *
 * @param {Object=} config
 * @param {string} [config.sourceFileName] optional inbox CSV basename
 * @param {number} [config.expectedSourceRows] default 596
 * @param {number} [config.expectedCanonicalRows] default 220
 * @param {number} [config.expectedHealthcare] default 86
 * @param {number} [config.expectedSled] default 134
 * @param {string} [config.expectedChecksumPrefix] optional sha256 hex prefix (16 chars)
 * @return {Object}
 */
function runEdmAuthorizedFirstRealIngestion(config) {
  config = config || {};
  var expectedSourceList = config.expectedSourceRows != null
    ? (Array.isArray(config.expectedSourceRows) ? config.expectedSourceRows : [config.expectedSourceRows])
    : [596, 597];
  var expectedCanonical = config.expectedCanonicalRows != null ? config.expectedCanonicalRows : 220;
  var expectedHc = config.expectedHealthcare != null ? config.expectedHealthcare : 86;
  var expectedSled = config.expectedSled != null ? config.expectedSled : 134;
  var sourceFileName = config.sourceFileName || undefined;

  var report = {
    ok: false,
    phase: 'preflight',
    preOperational: null,
    preCsatBaseline: null,
    dryRun: null,
    ingest: null,
    postOperational: null,
    postCsatBaseline: null,
    auditLedger: null
  };

  report.preOperational = runEdmVerifyOperationalState();
  if (!report.preOperational.ok) {
    report.message = 'operational verify failed';
    return report;
  }
  if (report.preOperational.ingestEnabled) {
    report.message = 'ingest already enabled; abort';
    return report;
  }
  if (report.preOperational.deleteSuccessfulSource) {
    report.message = 'delete flag enabled; abort';
    return report;
  }
  if (report.preOperational.triggerCount > 0) {
    report.message = 'scheduled trigger present; abort';
    return report;
  }

  report.preCsatBaseline = runEdmDestinationCsatBaselineSummary();
  report.phase = 'dry_run';

  var dryRunRaw = processQualtricsInboxNow({
    dryRun: true,
    sourceFileName: sourceFileName
  });
  report.dryRun = sanitizeQualtricsRunSummary_(dryRunRaw);
  var job = (dryRunRaw.outcome && dryRunRaw.outcome.job) || {};
  var checksumFull = (dryRunRaw.outcome && dryRunRaw.outcome.job && dryRunRaw.outcome.job.source &&
    dryRunRaw.outcome.job.source.checksum) || '';
  if (!checksumFull && dryRunRaw.outcome && dryRunRaw.outcome.job) {
    checksumFull = dryRunRaw.outcome.job.checksum || '';
  }
  report.dryRun.checksumPrefix = checksumFull ? String(checksumFull).slice(0, 16) : '';

  if (!dryRunRaw.ok) {
    report.message = 'dry-run failed';
    return report;
  }
  if (expectedSourceList.indexOf(job.sourceRowCount) === -1) {
    report.message = 'source row count mismatch: got ' + job.sourceRowCount +
      ' expected one of ' + expectedSourceList.join(',');
    return report;
  }
  if (job.healthcareCount !== expectedHc || job.sledCount !== expectedSled) {
    report.message = 'population count mismatch';
    return report;
  }
  var sledPlusHc = (job.healthcareCount || 0) + (job.sledCount || 0);
  if (sledPlusHc !== expectedCanonical) {
    report.message = 'normalized population total mismatch';
    return report;
  }
  if (config.expectedChecksumPrefix &&
    report.dryRun.checksumPrefix !== config.expectedChecksumPrefix) {
    report.message = 'checksum prefix mismatch';
    return report;
  }

  var props = PropertiesService.getScriptProperties();
  report.phase = 'ingest';
  props.setProperty(EdmProperties.INGEST_ENABLED, 'true');
  var ingestRaw;
  try {
    ingestRaw = processQualtricsInboxNow({
      dryRun: false,
      ingestEnabled: true,
      sourceFileName: sourceFileName
    });
  } finally {
    props.setProperty(EdmProperties.INGEST_ENABLED, 'false');
  }

  report.ingest = sanitizeQualtricsRunSummary_(ingestRaw);
  report.ingest.disposition = ingestRaw.disposition;

  report.postOperational = runEdmVerifyOperationalState();
  report.postCsatBaseline = runEdmDestinationCsatBaselineSummary();
  report.auditLedger = runEdmAuditLedgerTailSummary(1);
  report.phase = 'complete';

  var ingestOk = ingestRaw.ok && ingestRaw.outcome &&
    ingestRaw.outcome.job &&
    ingestRaw.outcome.job.status === EdmJobTypes.JobStatus.SUCCESS;
  var dests = report.ingest.destinations || [];
  var allDestOk = dests.length === 3 && dests.every(function (d) {
    return d.status === 'success';
  });
  report.ok = ingestOk && allDestOk &&
    !report.postOperational.ingestEnabled &&
    !report.postOperational.deleteSuccessfulSource &&
    report.postOperational.triggerCount === 0 &&
    (ingestRaw.disposition === 'INBOX_AFTER_SUCCESS' || ingestRaw.disposition === 'INBOX');

  if (!report.ok) {
    report.message = 'ingest or post-verify failed';
  } else {
    report.message = 'FIRST REAL INGESTION VERIFIED';
  }
  return report;
}

/**
 * Zero-arg editor entry for first authorized real ingest (inbox PGL full-dashboard export).
 * @return {Object}
 */
function runEdmAuthorizedFirstRealIngestionNow() {
  return runEdmAuthorizedFirstRealIngestion({
    expectedSourceRows: [596, 597],
    expectedCanonicalRows: 220,
    expectedHealthcare: 86,
    expectedSled: 134,
    expectedChecksumPrefix: '8545dbf0510b0d55'
  });
}

/**
 * Run two dry-run inbox passes for duplicate-behavior validation.
 * @return {Object}
 */
function runEdmQualtricsDryRunTwice() {
  var fileName = EdmSyntheticQualtricsFixture.FILENAME;
  var first = processQualtricsInboxNow({
    dryRun: true,
    sourceFileName: fileName
  });
  var second = processQualtricsInboxNow({
    dryRun: true,
    sourceFileName: fileName
  });
  return {
    ok: first.ok && second.ok,
    first: sanitizeQualtricsRunSummary_(first),
    second: sanitizeQualtricsRunSummary_(second),
    duplicateBlockedOnSecondRun: second.ok === false &&
      second.outcome &&
      second.outcome.job &&
      second.outcome.job.errorCategory === 'DUPLICATE_SUCCESS_CHECKSUM'
  };
}

/**
 * Full controlled setup except parent folder id (pass separately).
 * @param {string} parentFolderId
 * @param {string} hcSpreadsheetId
 * @param {string} slgSpreadsheetId
 * @param {string} henpSpreadsheetId
 * @return {Object}
 */
var EDM_QUALTRICS_SCHEDULE_HANDLER_ = 'runQualtricsInboxScheduled';
var EDM_DISALLOWED_TRIGGER_HANDLERS_ = [
  'runEdmPlaceSyntheticQualtricsInbox',
  'runQualtricsV1aHarness'
];

/**
 * Idempotent Qualtrics Inbox schedule (production cadence).
 * @param {number} [minutes] default 15
 * @return {Object}
 */
function runEdmInstallQualtricsInboxScheduleTrigger(minutes) {
  var cadence = minutes || 15;
  var triggers = ScriptApp.getProjectTriggers();
  var removed = [];
  triggers.forEach(function (t) {
    var handler = t.getHandlerFunction();
    if (handler === EDM_QUALTRICS_SCHEDULE_HANDLER_ ||
      EDM_DISALLOWED_TRIGGER_HANDLERS_.indexOf(handler) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed.push(handler);
    }
  });
  ScriptApp.newTrigger(EDM_QUALTRICS_SCHEDULE_HANDLER_)
    .timeBased()
    .everyMinutes(cadence)
    .create();
  var after = ScriptApp.getProjectTriggers();
  var qualtricsTriggers = after.filter(function (t) {
    return t.getHandlerFunction() === EDM_QUALTRICS_SCHEDULE_HANDLER_;
  });
  return {
    ok: qualtricsTriggers.length === 1 &&
      EDM_DISALLOWED_TRIGGER_HANDLERS_.every(function (h) {
        return !after.some(function (t) {
          return t.getHandlerFunction() === h;
        });
      }),
    handler: EDM_QUALTRICS_SCHEDULE_HANDLER_,
    cadenceMinutes: cadence,
    qualtricsTriggerCount: qualtricsTriggers.length,
    removedHandlers: removed
  };
}

/**
 * Inbox CSV names only (no ids, no content).
 * @return {Object}
 */
function runEdmQualtricsInboxInventory() {
  var props = PropertiesService.getScriptProperties();
  ensureEdmBootstrapFromDrive_(props);
  var inboxId = props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
  if (!inboxId) {
    return { ok: false, message: 'inbox not configured' };
  }
  var folder = DriveApp.getFolderById(inboxId);
  var files = folder.getFiles();
  var names = [];
  while (files.hasNext()) {
    var name = files.next().getName();
    if (/\.csv$/i.test(name)) {
      names.push(name);
    }
  }
  names.sort();
  return { ok: true, csvCount: names.length, csvNames: names };
}

/**
 * Verify inbox source checksum matches a prior successful ledger job; duplicate guard blocks re-ingest.
 * Does not write destinations or append ledger rows.
 *
 * @param {string} [expectedChecksumPrefix] default first real job prefix
 * @return {Object}
 */
function runEdmVerifyInboxSuccessfulSourceDuplicateGuard(expectedChecksumPrefix) {
  var prefix = expectedChecksumPrefix || '8545dbf0510b0d55';
  var props = PropertiesService.getScriptProperties();
  ensureEdmBootstrapFromDrive_(props);
  var inboxId = props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
  if (!inboxId) {
    return { ok: false, message: 'inbox not configured' };
  }
  var candidate = EdmQualtricsInbox.findCandidateCsv(inboxId, undefined, DriveApp);
  if (!candidate) {
    return { ok: false, message: 'no inbox csv' };
  }
  var csvText = EdmQualtricsInbox.readCsvText(candidate.file);
  var checksum = EdmChecksum.sha256Hex(csvText, {
    computeDigest: Utilities.computeDigest.bind(Utilities)
  });
  if (String(checksum).slice(0, prefix.length) !== prefix) {
    return {
      ok: false,
      message: 'checksum prefix mismatch',
      checksumPrefix: String(checksum).slice(0, 16),
      inboxFileName: candidate.name
    };
  }
  var ledgerId = props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
  if (!ledgerId) {
    return { ok: false, message: 'ledger not configured' };
  }
  var sheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
  var priorJobs = EdmJobHistory.toPriorJobRefs(EdmAuditLedgerSheet.readAllJobs(sheet));
  var ledgerSuccess = priorJobs.some(function (p) {
    return p.checksum === checksum && p.status === EdmJobTypes.JobStatus.SUCCESS;
  });
  var dup = EdmDuplicateGuard.checkDuplicateSuccessful(checksum, priorJobs);
  var blocked = !dup.allow && dup.reason === 'DUPLICATE_SUCCESS_CHECKSUM';
  return {
    ok: blocked && ledgerSuccess,
    checksumPrefix: String(checksum).slice(0, 16),
    inboxFileName: candidate.name,
    duplicateBlocked: blocked,
    ledgerSuccessMatch: ledgerSuccess,
    reason: dup.reason || ''
  };
}

/**
 * Trash inbox source when checksum matches a successful audited job (not a new ingestion).
 *
 * @param {string} [expectedChecksumPrefix]
 * @return {Object}
 */
function runEdmRemoveVerifiedProcessedInboxSource(expectedChecksumPrefix) {
  var verify = runEdmVerifyInboxSuccessfulSourceDuplicateGuard(expectedChecksumPrefix);
  if (!verify.ok) {
    return { ok: false, message: 'refusing cleanup: ' + (verify.message || 'verify failed'), verify: verify };
  }
  var props = PropertiesService.getScriptProperties();
  var inboxId = props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
  var candidate = EdmQualtricsInbox.findCandidateCsv(inboxId, verify.inboxFileName, DriveApp);
  if (!candidate) {
    return { ok: false, message: 'inbox file missing after verify' };
  }
  EdmQualtricsInbox.deleteFile(candidate.file);
  var inventory = runEdmQualtricsInboxInventory();
  var removal = EdmProductionActivation.verifiedSourceRemovalResult(verify.inboxFileName);
  return {
    ok: removal.ok,
    disposition: 'TRASHED_VERIFIED_PROCESSED_SOURCE',
    removedFileName: verify.inboxFileName,
    inbox: inventory
  };
}

/**
 * Remove tracked synthetic inbox fixture (never a production source).
 * @return {Object}
 */
function runEdmRemoveSyntheticQualtricsFromInbox() {
  var props = PropertiesService.getScriptProperties();
  var inboxId = props.getProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID);
  if (!inboxId) {
    return { ok: false, message: 'inbox not configured' };
  }
  var folder = DriveApp.getFolderById(inboxId);
  var it = folder.getFilesByName(EdmSyntheticQualtricsFixture.FILENAME);
  var removed = 0;
  while (it.hasNext()) {
    it.next().setTrashed(true);
    removed++;
  }
  return { ok: true, removedCount: removed, fileName: EdmSyntheticQualtricsFixture.FILENAME };
}

/**
 *
 * @param {Object=} config
 * @param {string} [config.expectedChecksumPrefix]
 * @param {number} [config.scheduleMinutes]
 * @return {Object}
 */
function runEdmQualtricsV1ProductionActivation(config) {
  config = config || {};
  var report = {
    ok: false,
    phase: 'preflight',
    pre: null,
    duplicateGuard: null,
    sourceCleanup: null,
    properties: null,
    trigger: null,
    emptyInboxRun: null,
    post: null,
    auditTail: null
  };

  report.pre = runEdmVerifyOperationalState();
  if (report.pre.triggerCount > 0) {
    var handlers = report.pre.triggerHandlers || [];
    var onlyQualtricsSchedule = report.pre.triggerCount === 1 &&
      handlers[0] === EDM_QUALTRICS_SCHEDULE_HANDLER_;
    if (!onlyQualtricsSchedule) {
      report.message = 'unexpected trigger before activation';
      return report;
    }
  }

  var inboxBefore = runEdmQualtricsInboxInventory();
  report.inboxBeforeSyntheticRemoval = inboxBefore;

  report.phase = 'synthetic_cleanup';
  report.syntheticCleanup = runEdmRemoveSyntheticQualtricsFromInbox();

  var inboxAfterSynthetic = runEdmQualtricsInboxInventory();
  report.inboxAfterSynthetic = inboxAfterSynthetic;

  report.phase = 'duplicate_guard';
  if (inboxAfterSynthetic.csvCount === 0) {
    report.duplicateGuard = runEdmVerifyFirstRealJobInLedger_(config.expectedChecksumPrefix);
    report.sourceCleanup = {
      ok: true,
      disposition: 'ALREADY_EMPTY',
      inbox: inboxAfterSynthetic
    };
  } else {
    report.duplicateGuard = runEdmVerifyInboxSuccessfulSourceDuplicateGuard(
      config.expectedChecksumPrefix
    );
    if (!report.duplicateGuard.ok) {
      report.message = 'duplicate guard preflight failed';
      return report;
    }
    report.phase = 'source_cleanup';
    report.sourceCleanup = runEdmRemoveVerifiedProcessedInboxSource(
      config.expectedChecksumPrefix
    );
    if (!report.sourceCleanup.ok) {
      report.message = 'verified source cleanup failed';
      return report;
    }
  }
  if (!report.duplicateGuard.ok) {
    report.message = 'first real job not confirmed in ledger';
    return report;
  }

  report.phase = 'properties';
  var props = PropertiesService.getScriptProperties();
  report.properties = EdmProductionActivation.setProductionScriptProperties(props);
  if (!report.properties.ok) {
    report.message = 'production script properties read-back failed';
    return report;
  }

  report.phase = 'trigger';
  report.trigger = runEdmInstallQualtricsInboxScheduleTrigger(config.scheduleMinutes || 15);
  if (!report.trigger.ok) {
    report.message = 'trigger install failed';
    return report;
  }

  report.phase = 'empty_inbox';
  report.emptyInboxRun = runQualtricsInboxScheduled();
  report.auditTail = runEdmAuditLedgerTailSummary(1);
  report.post = runEdmVerifyOperationalState();
  report.postInbox = runEdmQualtricsInboxInventory();

  report.ok = EdmProductionActivation.evaluateActivationSuccess(
    report.emptyInboxRun,
    report.post,
    report.postInbox,
    report.trigger
  );

  report.phase = 'complete';
  report.message = report.ok
    ? 'EDM QUALTRICS V1 PRODUCTION ACTIVATION COMPLETE'
    : 'activation post-verify failed';
  Logger.log(EdmProductionActivation.buildLogSummary(report));
  return report;
}

/**
 * Zero-arg editor entry for V1 production activation.
 * @return {Object}
 */
function runEdmQualtricsV1ProductionActivationNow() {
  var report = runEdmQualtricsV1ProductionActivation({
    expectedChecksumPrefix: '8545dbf0510b0d55',
    scheduleMinutes: 15
  });
  return EdmProductionActivation.finishEditorActivation(report);
}

/**
 * Read-only runtime snapshot for editor diagnosis (no mutations).
 * @return {{ ok: boolean, logLine: string }}
 */
function runEdmDebugProductionActivationState() {
  var props = PropertiesService.getScriptProperties();
  var triggers = ScriptApp.getProjectTriggers();
  var handlers = triggers.map(function (t) {
    return t.getHandlerFunction();
  });
  var inv = runEdmQualtricsInboxInventory();
  var ledgerFirst = runEdmVerifyFirstRealJobInLedger_('8545dbf0510b0d55');
  var duplicateGuardOk = true;
  var duplicateBlocked = null;
  if (inv.ok && inv.csvCount > 0) {
    var dup = runEdmVerifyInboxSuccessfulSourceDuplicateGuard('8545dbf0510b0d55');
    duplicateGuardOk = dup.ok;
    duplicateBlocked = dup.duplicateBlocked;
  }
  var syntheticInInbox = !!(inv.csvNames && inv.csvNames.indexOf(
    EdmSyntheticQualtricsFixture.FILENAME
  ) >= 0);
  var syntheticOnlyInbox = inv.ok && inv.csvCount === 1 && syntheticInInbox;
  var blockers = EdmProductionActivation.diagnoseActivationBlockers({
    triggerCount: triggers.length,
    triggerHandlers: handlers,
    inboxCsvCount: inv.ok ? inv.csvCount : -1,
    ledgerFirstJobSuccess: ledgerFirst.ok,
    duplicateGuardOk: duplicateGuardOk,
    syntheticOnlyInbox: syntheticOnlyInbox
  });
  var state = {
    ingestEnabled: props.getProperty(EdmProperties.INGEST_ENABLED) === 'true',
    deleteSuccessfulSource:
      props.getProperty(EdmProperties.DELETE_SUCCESSFUL_SOURCE) === 'true',
    triggerCount: triggers.length,
    triggerHandlers: handlers,
    inboxCsvCount: inv.ok ? inv.csvCount : -1,
    ledgerFirstJobSuccess: ledgerFirst.ok,
    duplicateBlockedOnInbox: duplicateBlocked,
    syntheticInInbox: syntheticInInbox,
    activationBlockers: blockers
  };
  var logLine = EdmProductionActivation.buildDebugStateLine(state);
  Logger.log(logLine);
  return { ok: true, logLine: logLine };
}

/**
 * @param {string} [expectedChecksumPrefix]
 * @return {Object}
 */
function runEdmVerifyFirstRealJobInLedger_(expectedChecksumPrefix) {
  var prefix = expectedChecksumPrefix || '8545dbf0510b0d55';
  var props = PropertiesService.getScriptProperties();
  var ledgerId = props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
  if (!ledgerId) {
    return { ok: false, message: 'ledger not configured' };
  }
  var sheet = EdmAuditLedgerSheet.openLedger(ledgerId, SpreadsheetApp);
  var rows = EdmAuditLedgerSheet.readAllJobs(sheet);
  var successes = rows.filter(function (r) {
    return r.overall_status === EdmJobTypes.JobStatus.SUCCESS &&
      String(r.source_checksum || '').slice(0, prefix.length) === prefix;
  });
  return {
    ok: successes.length >= 1,
    ledgerSuccessMatches: successes.length,
    checksumPrefix: prefix.slice(0, 16)
  };
}

/**
 * @param {Object[]} rows canonical csat-response rows
 * @param {string} logicalAppId
 * @return {Object[]}
 */
function filterCanonicalRowsForDestination_(rows, logicalAppId) {
  var cfg = QualtricsResponsesRoutingConfig.getActiveConfig();
  var route = null;
  for (var i = 0; i < cfg.routes.length; i++) {
    var r = cfg.routes[i];
    for (var j = 0; j < (r.destinations || []).length; j++) {
      if (r.destinations[j].appId === logicalAppId && r.destinations[j].enabled) {
        route = r;
        break;
      }
    }
    if (route) {
      break;
    }
  }
  if (!route) {
    return [];
  }
  var field = route.match.field;
  var value = route.match.value;
  return (rows || []).filter(function (row) {
    return row[field] === value;
  });
}

/**
 * Idempotent Responses Inbox/Failed under Qualtrics/Responses (does not touch InFlight folders).
 * @param {string} parentFolderId External Data parent folder
 * @return {Object}
 */
function runEdmSetupQualtricsResponsesDrive(parentFolderId) {
  if (!parentFolderId) {
    return { ok: false, message: 'parentFolderId required' };
  }
  var ids = EdmSetup.setupQualtricsResponsesDriveFolders(parentFolderId);
  return {
    ok: true,
    responsesInboxConfigured: !!ids.inboxId,
    responsesFailedConfigured: !!ids.failedId,
    responsesSegmentConfigured: !!ids.responsesFolderId
  };
}

/**
 * Bootstrap CSAT_Responses headers in one destination workbook (no row import).
 * @param {string} logicalAppId HC_DM|SLG_DM|HENP_DM
 * @return {Object}
 */
function runEdmBootstrapCsatResponsesStorage(logicalAppId) {
  if (!logicalAppId) {
    return { ok: false, message: 'logicalAppId required' };
  }
  var coreLib = typeof CoreLib !== 'undefined' ? CoreLib : null;
  if (!coreLib || !coreLib.CoreData || !coreLib.CoreData.bootstrapCsatResponsesStorage) {
    return { ok: false, message: 'CoreLib.bootstrapCsatResponsesStorage unavailable' };
  }
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = EdmDestinationRegistry.resolveSpreadsheetId(logicalAppId, props);
  if (!spreadsheetId) {
    return { ok: false, message: 'destination spreadsheet not configured' };
  }
  var rawCfg = EdmDmConfigResolver.resolve(logicalAppId);
  var cfg = coreLib.CoreConfig.withDefaults(rawCfg);
  var result = coreLib.CoreData.bootstrapCsatResponsesStorage(cfg, { spreadsheetId: spreadsheetId });
  return Object.assign({ ok: !!result.success, destinationId: logicalAppId }, result);
}

/**
 * Read-only eligibility counts for routed rows in the Responses Inbox (no writes).
 * @param {string} logicalAppId
 * @return {Object}
 */
function runEdmPreviewCsatResponsesEligibility(logicalAppId) {
  if (!logicalAppId) {
    return { ok: false, message: 'logicalAppId required' };
  }
  var props = PropertiesService.getScriptProperties();
  var inboxId = props.getProperty(EdmProperties.QUALTRICS_RESPONSES_INBOX_FOLDER_ID);
  if (!inboxId) {
    return { ok: false, message: 'Responses Inbox not configured' };
  }
  var candidate = EdmQualtricsInbox.findCandidateCsv(inboxId, null, DriveApp);
  if (!candidate) {
    return { ok: false, message: 'No CSV in Responses Inbox' };
  }
  var csvText = EdmQualtricsInbox.readCsvText(candidate.file);
  var built = QualtricsResponsesTransform.transformCsvText(csvText);
  if (!built.ok) {
    return { ok: false, message: 'transform_failed' };
  }
  var sliceRows = filterCanonicalRowsForDestination_(built.rows, logicalAppId);
  var coreLib = typeof CoreLib !== 'undefined' ? CoreLib : null;
  if (!coreLib || !coreLib.CoreData || !coreLib.CoreData.previewCsatResponsesEligibility) {
    return { ok: false, message: 'CoreLib.previewCsatResponsesEligibility unavailable' };
  }
  var spreadsheetId = EdmDestinationRegistry.resolveSpreadsheetId(logicalAppId, props);
  var rawCfg = EdmDmConfigResolver.resolve(logicalAppId);
  var cfg = coreLib.CoreConfig.withDefaults(rawCfg);
  var preview = coreLib.CoreData.previewCsatResponsesEligibility(cfg, sliceRows, {
    spreadsheetId: spreadsheetId
  });
  return Object.assign({
    ok: !!preview.success,
    destinationId: logicalAppId,
    routedCandidateRows: sliceRows.length,
    sourceRowCount: built.sourceRowCount,
    canonicalRowCount: built.rows.length
  }, preview);
}

/**
 * Enable or disable Responses ingest flag only (does not install triggers).
 * @param {boolean} enable
 * @return {Object}
 */
function runEdmSetQualtricsResponsesIngestEnabled(enable) {
  var props = PropertiesService.getScriptProperties();
  if (enable === true) {
    props.setProperty(EdmProperties.RESPONSES_INGEST_ENABLED, 'true');
  } else {
    props.deleteProperty(EdmProperties.RESPONSES_INGEST_ENABLED);
  }
  return {
    ok: true,
    responsesIngestEnabled: props.getProperty(EdmProperties.RESPONSES_INGEST_ENABLED) === 'true'
  };
}

/**
 * Sanitized CSAT_Responses verification for one destination (counts/metadata only).
 * @param {string} logicalAppId
 * @return {Object}
 */
function runEdmVerifyCsatResponsesStorage(logicalAppId) {
  if (!logicalAppId) {
    return { ok: false, message: 'logicalAppId required' };
  }
  var coreLib = typeof CoreLib !== 'undefined' ? CoreLib : null;
  if (!coreLib || !coreLib.CoreData || !coreLib.CoreData.verifyCsatResponsesStorage) {
    return { ok: false, message: 'CoreLib.verifyCsatResponsesStorage unavailable' };
  }
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = EdmDestinationRegistry.resolveSpreadsheetId(logicalAppId, props);
  if (!spreadsheetId) {
    return { ok: false, message: 'destination spreadsheet not configured' };
  }
  var rawCfg = EdmDmConfigResolver.resolve(logicalAppId);
  var cfg = coreLib.CoreConfig.withDefaults(rawCfg);
  var result = coreLib.CoreData.verifyCsatResponsesStorage(cfg, { spreadsheetId: spreadsheetId });
  return Object.assign({ ok: !!result.success, destinationId: logicalAppId }, result);
}

/**
 * Idempotent Responses Drive setup using EXTERNAL_DATA_PARENT_FOLDER_ID property.
 * @return {Object}
 */
function runEdmEnsureQualtricsResponsesDriveFromProperties() {
  var props = PropertiesService.getScriptProperties();
  var parentId = props.getProperty(EdmProperties.EXTERNAL_DATA_PARENT_FOLDER_ID);
  if (!parentId) {
    return { ok: false, message: 'EXTERNAL_DATA_PARENT_FOLDER_ID not configured' };
  }
  if (props.getProperty(EdmProperties.QUALTRICS_RESPONSES_INBOX_FOLDER_ID)) {
    return { ok: true, message: 'responses_folders_already_configured' };
  }
  return runEdmSetupQualtricsResponsesDrive(parentId);
}

/**
 * Authorized SLG CSAT Responses storage canary (editor / API executable).
 * Expects validated Responses CSV already in Responses/Inbox. Counts only in output.
 *
 * @param {Object=} options
 * @param {boolean} [options.skipIngest=false] dry-run + eligibility + bootstrap only
 * @return {Object}
 */
function runEdmCsatResponsesSlgStorageCanaryNow(options) {
  options = options || {};
  var SLG = EdmDestinationRegistry.APP_SLG;
  var report = { ok: false, phase: 'start', steps: [] };

  function record_(name, result) {
    report.steps.push({
      step: name,
      ok: !!result.ok,
      summary: result.summary || result.message || ''
    });
    if (!result.ok) {
      report.phase = name;
      report.message = result.message || 'step_failed';
      report.detail = result;
    }
    return !!result.ok;
  }

  var pre = runEdmVerifyOperationalState();
  var propsPre = PropertiesService.getScriptProperties();
  var responsesDeleteOn = propsPre.getProperty(EdmProperties.DELETE_SUCCESSFUL_RESPONSES_SOURCE) === 'true';
  if (!record_('operational_state', {
    ok: pre.ok && pre.triggerCount > 0 &&
      pre.triggerHandlers.indexOf('runQualtricsInboxScheduled') >= 0 &&
      !pre.responsesIngestEnabled && !responsesDeleteOn,
    message: pre.ok ? 'inflight_trigger_ok' : 'operational_read_failed',
    summary: 'triggers=' + pre.triggerCount + ' responsesIngest=' + pre.responsesIngestEnabled
  })) {
    return report;
  }

  var drive = runEdmEnsureQualtricsResponsesDriveFromProperties();
  if (!record_('responses_drive', Object.assign({ summary: drive.message || '' }, drive))) {
    return report;
  }

  var dry = processQualtricsResponsesInboxNow({ dryRun: true });
  var pop = (dry.outcome && dry.outcome.job && dry.outcome.job.populationCounts) || {};
  var destMap = {};
  (dry.destinationResults || []).forEach(function (d) {
    destMap[d.appId] = d.inputRows;
  });
  var dryOk = dry.ok &&
    (dry.outcome.job.sourceRowCount === 177) &&
    destMap.HC_DM === 77 && destMap.SLG_DM === 28 && destMap.HENP_DM === 72;
  if (!record_('responses_dry_run', {
    ok: dryOk,
    message: dryOk ? 'dry_run_counts_ok' : 'dry_run_counts_mismatch',
    summary: 'source=' + (dry.outcome.job.sourceRowCount || 0) +
      ' hc=' + (destMap.HC_DM || 0) + ' slg=' + (destMap.SLG_DM || 0) +
      ' henp=' + (destMap.HENP_DM || 0)
  })) {
    return report;
  }

  var preview = runEdmPreviewCsatResponsesEligibility(SLG);
  var prevTotal = (preview.eligible || 0) + (preview.excluded || 0) + (preview.rejected || 0);
  var previewOk = preview.ok &&
    preview.routedCandidateRows === 28 &&
    prevTotal === 28 &&
    (preview.deploymentUniverseSize || 0) > 0 &&
    ((preview.eligible || 0) > 0 || preview.excluded === 28);
  if (!record_('slg_eligibility_preview', {
    ok: previewOk,
    message: previewOk ? 'eligibility_ok' : 'eligibility_implausible',
    summary: 'input=' + preview.routedCandidateRows + ' eligible=' + (preview.eligible || 0) +
      ' excluded=' + (preview.excluded || 0) + ' universe=' + (preview.deploymentUniverseSize || 0)
  })) {
    return report;
  }

  if (options.skipIngest) {
    report.ok = true;
    report.phase = 'complete_skip_ingest';
    return report;
  }

  var boot = runEdmBootstrapCsatResponsesStorage(SLG);
  if (!record_('slg_bootstrap', {
    ok: boot.ok && boot.dataRowCount === 0,
    message: boot.ok ? 'bootstrap_ok' : 'bootstrap_failed',
    summary: 'dataRows=' + (boot.dataRowCount || 0)
  })) {
    return report;
  }

  runEdmSetQualtricsResponsesIngestEnabled(true);
  var ingest1 = processQualtricsResponsesInboxNow({
    dryRun: false,
    ingestEnabled: true,
    deleteSuccessfulSource: false,
    limitDestinationAppIds: [SLG]
  });
  var slg1 = (ingest1.destinationResults || []).filter(function (d) {
    return d.appId === SLG;
  })[0] || {};
  var ingest1Ok = ingest1.ok && slg1.status === 'success' &&
    (slg1.inserted || 0) > 0 && (slg1.updated || 0) === 0 && (slg1.unchanged || 0) === 0;
  if (!record_('slg_first_ingest', {
    ok: ingest1Ok,
    message: ingest1Ok ? 'first_ingest_ok' : 'first_ingest_failed',
    summary: 'inserted=' + (slg1.inserted || 0) + ' updated=' + (slg1.updated || 0) +
      ' unchanged=' + (slg1.unchanged || 0) + ' excluded=' + (slg1.excludedCount || 0)
  })) {
    runEdmSetQualtricsResponsesIngestEnabled(false);
    return report;
  }

  var verify1 = runEdmVerifyCsatResponsesStorage(SLG);
  var verifyOk = verify1.ok && verify1.headerOk && !verify1.forbiddenColumnsPresent &&
    verify1.rowCount === verify1.uniqueResponseIds && verify1.rowCount === (slg1.inserted || 0);
  if (!record_('slg_storage_verify', {
    ok: verifyOk,
    message: verifyOk ? 'storage_ok' : 'storage_verify_failed',
    summary: 'rows=' + (verify1.rowCount || 0) + ' uniqueIds=' + (verify1.uniqueResponseIds || 0)
  })) {
    runEdmSetQualtricsResponsesIngestEnabled(false);
    return report;
  }

  var ingest2 = processQualtricsResponsesInboxNow({
    dryRun: false,
    ingestEnabled: true,
    deleteSuccessfulSource: false,
    limitDestinationAppIds: [SLG],
    allowDuplicateOverride: true
  });
  var slg2 = (ingest2.destinationResults || []).filter(function (d) {
    return d.appId === SLG;
  })[0] || {};
  var priorEligible = (slg1.inserted || 0) + (slg1.unchanged || 0);
  var idemOk = ingest2.ok &&
    (slg2.inserted || 0) === 0 && (slg2.updated || 0) === 0 &&
    (slg2.unchanged || 0) === priorEligible;
  if (!record_('slg_idempotency', {
    ok: idemOk,
    message: idemOk ? 'idempotent_ok' : 'idempotency_failed',
    summary: 'inserted=' + (slg2.inserted || 0) + ' unchanged=' + (slg2.unchanged || 0)
  })) {
    runEdmSetQualtricsResponsesIngestEnabled(false);
    return report;
  }

  runEdmSetQualtricsResponsesIngestEnabled(false);
  var post = runEdmVerifyOperationalState();
  record_('post_operational_state', {
    ok: post.ok && !post.responsesIngestEnabled,
    message: 'responses_ingest_disabled',
    summary: 'responsesIngest=' + post.responsesIngestEnabled
  });

  report.ok = true;
  report.phase = 'complete';
  report.message = 'canary_complete';
  return report;
}

function runEdmV1bControlledInfrastructureSetup(
  parentFolderId,
  hcSpreadsheetId,
  slgSpreadsheetId,
  henpSpreadsheetId
) {
  var drive = runEdmV1bSetupQualtricsDrive(parentFolderId);
  if (!drive.ok) {
    return drive;
  }
  var ledger = runEdmV1bEnsureAuditLedger();
  if (!ledger.ok) {
    return ledger;
  }
  var dest = runEdmV1bSetDestinationSpreadsheetIds(
    hcSpreadsheetId,
    slgSpreadsheetId,
    henpSpreadsheetId
  );
  if (!dest.ok) {
    return dest;
  }
  return {
    ok: true,
    drive: drive,
    ledger: ledger,
    destinations: dest,
    properties: runEdmVerifyScriptProperties().properties
  };
}
