/**
 * Qualtrics V1 production activation helpers (testable, no Drive in unit tests).
 * @namespace EdmProductionActivation
 */
var EdmProductionActivation = (function () {
  'use strict';

  var SCHEDULE_HANDLER = 'runQualtricsInboxScheduled';

  /**
   * Inbox CSV names after removing only the known EDM synthetic fixture (exact match).
   *
   * @param {string[]} csvNames
   * @param {string} syntheticFileName from EdmSyntheticQualtricsFixture.FILENAME
   * @return {string[]}
   */
  function filterInboxAfterSyntheticRemoval(csvNames, syntheticFileName) {
    return (csvNames || []).filter(function (name) {
      return name !== syntheticFileName;
    });
  }

  /**
   * @param {number} csvCountAfterSynthetic
   * @param {boolean} ledgerFirstJobSuccess
   * @return {'empty_inbox_ledger_verified'|'empty_inbox_missing_ledger'|'production_source_inbox'}
   */
  function preflightPathAfterSyntheticRemoval(csvCountAfterSynthetic, ledgerFirstJobSuccess) {
    if (csvCountAfterSynthetic === 0) {
      return ledgerFirstJobSuccess
        ? 'empty_inbox_ledger_verified'
        : 'empty_inbox_missing_ledger';
    }
    return 'production_source_inbox';
  }

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

  /**
   * @param {Object} report
   * @return {string}
   */
  function failureMessage(report) {
    return 'EDM Qualtrics V1 activation failed phase=' + (report.phase || '') +
      ' reason=' + (report.message || 'unknown');
  }

  /**
   * Assert final report postconditions (after activation run).
   *
   * @param {Object} report
   */
  function assertReportPostconditions(report) {
    if (!report.ok) {
      throw new Error(failureMessage(report));
    }
    var post = report.post || {};
    if (!post.ingestEnabled) {
      throw new Error('postcondition failed: ingestEnabled');
    }
    if (!post.deleteSuccessfulSource) {
      throw new Error('postcondition failed: deleteSuccessfulSource');
    }
    if (post.triggerCount !== 1) {
      throw new Error('postcondition failed: triggerCount');
    }
    var handlers = post.triggerHandlers || [];
    if (handlers.indexOf(SCHEDULE_HANDLER) < 0) {
      throw new Error('postcondition failed: scheduleHandler');
    }
    var inv = report.postInbox || {};
    if (inv.csvCount !== 0) {
      throw new Error('postcondition failed: inboxCsvCount');
    }
  }

  /**
   * Editor entry: log sanitized summary; throw on failure (visible red execution).
   *
   * @param {Object} report
   * @return {Object} report when successful
   */
  function finishEditorActivation(report) {
    var summary = buildLogSummary(report);
    Logger.log(summary);
    if (!report.ok) {
      throw new Error(failureMessage(report));
    }
    assertReportPostconditions(report);
    return report;
  }

  /**
   * @param {Object} state sanitized runtime snapshot
   * @return {string}
   */
  function buildDebugStateLine(state) {
    return [
      'EdmDebugProductionActivationState',
      'ingestEnabled=' + !!state.ingestEnabled,
      'deleteSuccessfulSource=' + !!state.deleteSuccessfulSource,
      'triggerCount=' + (state.triggerCount != null ? state.triggerCount : 0),
      'triggerHandlers=' + ((state.triggerHandlers || []).join('|') || 'none'),
      'inboxCsvCount=' + (state.inboxCsvCount != null ? state.inboxCsvCount : '?'),
      'ledgerFirstJobSuccess=' + !!state.ledgerFirstJobSuccess,
      'duplicateBlockedOnInbox=' + (state.duplicateBlockedOnInbox == null
        ? 'n/a'
        : !!state.duplicateBlockedOnInbox),
      'syntheticInInbox=' + !!state.syntheticInInbox,
      'activationBlockers=' + ((state.activationBlockers || []).join(',') || 'none')
    ].join(' ');
  }

  /**
   * Read-only diagnosis matching activation preflight (no mutations).
   *
   * @param {Object} state
   * @return {string[]}
   */
  function diagnoseActivationBlockers(state) {
    var blockers = [];
    var triggerCount = state.triggerCount || 0;
    var handlers = state.triggerHandlers || [];
    if (triggerCount > 0) {
      var onlySchedule = triggerCount === 1 && handlers[0] === SCHEDULE_HANDLER;
      if (!onlySchedule) {
        blockers.push('unexpected_trigger');
      }
    }
    if (state.inboxCsvCount === 0) {
      if (!state.ledgerFirstJobSuccess) {
        blockers.push('empty_inbox_no_ledger_success');
      }
    } else if (state.syntheticOnlyInbox && state.ledgerFirstJobSuccess) {
      /* Activation removes known synthetic before duplicate guard; not a blocker. */
    } else if (!state.duplicateGuardOk) {
      blockers.push('duplicate_guard_failed');
    }
    return blockers;
  }

  return {
    SCHEDULE_HANDLER: SCHEDULE_HANDLER,
    filterInboxAfterSyntheticRemoval: filterInboxAfterSyntheticRemoval,
    preflightPathAfterSyntheticRemoval: preflightPathAfterSyntheticRemoval,
    setProductionScriptProperties: setProductionScriptProperties,
    verifiedSourceRemovalResult: verifiedSourceRemovalResult,
    evaluateActivationSuccess: evaluateActivationSuccess,
    buildLogSummary: buildLogSummary,
    failureMessage: failureMessage,
    assertReportPostconditions: assertReportPostconditions,
    finishEditorActivation: finishEditorActivation,
    buildDebugStateLine: buildDebugStateLine,
    diagnoseActivationBlockers: diagnoseActivationBlockers
  };
})();
