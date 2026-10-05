/**
 * Qualtrics V1 production activation helpers (testable, no Drive in unit tests).
 * @namespace EdmProductionActivation
 */
var EdmProductionActivation = (function () {
  'use strict';

  var SCHEDULE_HANDLER = 'runQualtricsInboxScheduled';

  /**
   * @param {Object} props PropertiesService script properties
   * @return {{ ingestEnabled: boolean, deleteSuccessfulSource: boolean, ok: boolean }}
   */
  function setProductionScriptProperties(props) {
    props.setProperty(EdmProperties.INGEST_ENABLED, 'true');
    props.setProperty(EdmProperties.DELETE_SUCCESSFUL_SOURCE, 'true');
    var ingestEnabled = props.getProperty(EdmProperties.INGEST_ENABLED) === 'true';
    var deleteSuccessfulSource =
      props.getProperty(EdmProperties.DELETE_SUCCESSFUL_SOURCE) === 'true';
    return {
      ingestEnabled: ingestEnabled,
      deleteSuccessfulSource: deleteSuccessfulSource,
      ok: ingestEnabled && deleteSuccessfulSource
    };
  }

  /**
   * Verified PGL removal succeeds when the target file was trashed (Inbox may still hold synthetic).
   *
   * @param {string} removedFileName
   * @return {{ ok: boolean, removedFileName: string }}
   */
  function verifiedSourceRemovalResult(removedFileName) {
    return {
      ok: !!removedFileName,
      removedFileName: removedFileName || ''
    };
  }

  /**
   * @param {Object} emptyInboxRun from runQualtricsInboxScheduled / processQualtricsInboxNow
   * @param {Object} postOperational from runEdmVerifyOperationalState
   * @param {Object} postInboxInventory from runEdmQualtricsInboxInventory
   * @param {Object} triggerInstall from runEdmInstallQualtricsInboxScheduleTrigger
   * @return {boolean}
   */
  function evaluateActivationSuccess(
    emptyInboxRun,
    postOperational,
    postInboxInventory,
    triggerInstall
  ) {
    var emptyOk = emptyInboxRun &&
      emptyInboxRun.ok === true &&
      emptyInboxRun.message === 'No CSV in Inbox';
    var handlers = (postOperational && postOperational.triggerHandlers) || [];
    return !!(
      emptyOk &&
      postOperational &&
      postOperational.ingestEnabled &&
      postOperational.deleteSuccessfulSource &&
      postOperational.triggerCount === 1 &&
      handlers.indexOf(SCHEDULE_HANDLER) >= 0 &&
      postInboxInventory &&
      postInboxInventory.csvCount === 0 &&
      triggerInstall &&
      triggerInstall.ok
    );
  }

  /**
   * Sanitized one-line summary for Logger (no ids, no property values).
   *
   * @param {Object} report activation report
   * @return {string}
   */
  function buildLogSummary(report) {
    var post = report.post || {};
    var inv = report.postInbox || report.sourceCleanup && report.sourceCleanup.inbox || {};
    return [
      'EdmProductionActivation',
      'ok=' + !!report.ok,
      'phase=' + (report.phase || ''),
      'ingestEnabled=' + !!post.ingestEnabled,
      'deleteSuccessfulSource=' + !!post.deleteSuccessfulSource,
      'triggerCount=' + (post.triggerCount != null ? post.triggerCount : '?'),
      'handlers=' + ((post.triggerHandlers || []).join('|') || 'none'),
      'inboxCsvCount=' + (inv.csvCount != null ? inv.csvCount : '?'),
      'message=' + (report.message || '')
    ].join(' ');
  }

  return {
    SCHEDULE_HANDLER: SCHEDULE_HANDLER,
    setProductionScriptProperties: setProductionScriptProperties,
    verifiedSourceRemovalResult: verifiedSourceRemovalResult,
    evaluateActivationSuccess: evaluateActivationSuccess,
    buildLogSummary: buildLogSummary
  };
})();
