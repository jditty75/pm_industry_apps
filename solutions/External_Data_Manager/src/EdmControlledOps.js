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
    EdmProperties.DELETE_SUCCESSFUL_SOURCE
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
