/**
 * Pure phase validators for the SLG CSAT Responses storage canary (testable in Node).
 * @namespace EdmCsatResponsesCanaryPhases
 */
var EdmCsatResponsesCanaryPhases = (function () {
  'use strict';

  var EXPECTED_DRY_RUN = {
    sourceRowCount: 177,
    HC_DM: 77,
    SLG_DM: 28,
    HENP_DM: 72
  };

  /**
   * @param {Object} run from processQualtricsResponsesInboxNow
   * @param {string} phaseId
   * @return {{ ok: boolean, message?: string, summary?: string, run?: Object }}
   */
  function assertResponsesInboxRunShape(run, phaseId) {
    if (!run || typeof run !== 'object') {
      return {
        ok: false,
        message: phaseId + ': missing_processor_result',
        summary: 'processorResult=absent'
      };
    }
    if (!run.outcome || !run.outcome.job) {
      return {
        ok: false,
        message: phaseId + ': processor_missing_job_outcome',
        summary: 'processorOk=' + !!run.ok +
          ' processorMessage=' + String(run.message || 'none') +
          ' dryRun=' + !!run.dryRun
      };
    }
    return { ok: true, run: run };
  }

  /**
   * @param {Object} run validated inbox run
   * @return {Object<string, number>}
   */
  function destinationInputRowMap_(run) {
    var destMap = {};
    (run.destinationResults || []).forEach(function (d) {
      destMap[d.appId] = d.inputRows;
    });
    if (!Object.keys(destMap).length && run.outcome && run.outcome.result) {
      (run.outcome.result.destinationResults || []).forEach(function (d) {
        destMap[d.appId] = d.inputRows;
      });
    }
    return destMap;
  }

  /**
   * @param {Object} run from processQualtricsResponsesInboxNow (dry-run)
   * @param {Object=} expected defaults to canary oracle counts
   * @return {{ ok: boolean, message: string, summary: string }}
   */
  function evaluateDryRunPhase(run, expected) {
    expected = expected || EXPECTED_DRY_RUN;
    var shape = assertResponsesInboxRunShape(run, 'responses_dry_run');
    if (!shape.ok) {
      return shape;
    }
    var dry = shape.run;
    if (!dry.ok) {
      return {
        ok: false,
        message: 'responses_dry_run: processor_not_ok',
        summary: 'status=' + (dry.outcome.job.status || '') +
          ' errorCategory=' + (dry.outcome.job.errorCategory || 'none')
      };
    }
    var job = dry.outcome.job;
    var destMap = destinationInputRowMap_(dry);
    var countsOk = job.sourceRowCount === expected.sourceRowCount &&
      destMap.HC_DM === expected.HC_DM &&
      destMap.SLG_DM === expected.SLG_DM &&
      destMap.HENP_DM === expected.HENP_DM;
    return {
      ok: countsOk,
      message: countsOk ? 'dry_run_counts_ok' : 'dry_run_counts_mismatch',
      summary: 'source=' + (job.sourceRowCount || 0) +
        ' hc=' + (destMap.HC_DM || 0) +
        ' slg=' + (destMap.SLG_DM || 0) +
        ' henp=' + (destMap.HENP_DM || 0)
    };
  }

  /**
   * @param {Object} preview from runEdmPreviewCsatResponsesEligibility
   * @return {{ ok: boolean, message: string, summary: string }}
   */
  function evaluateEligibilityPhase(preview) {
    if (!preview || typeof preview !== 'object') {
      return {
        ok: false,
        message: 'slg_eligibility_preview: missing_preview_result',
        summary: 'preview=absent'
      };
    }
    if (!preview.ok) {
      return {
        ok: false,
        message: 'slg_eligibility_preview: preview_not_ok',
        summary: String(preview.message || 'preview_failed')
      };
    }
    var prevTotal = (preview.eligible || 0) + (preview.excluded || 0) + (preview.rejected || 0);
    var previewOk = preview.routedCandidateRows === 28 &&
      prevTotal === 28 &&
      (preview.deploymentUniverseSize || 0) > 0 &&
      ((preview.eligible || 0) > 0 || preview.excluded === 28);
    return {
      ok: previewOk,
      message: previewOk ? 'eligibility_ok' : 'eligibility_implausible',
      summary: 'input=' + preview.routedCandidateRows + ' eligible=' + (preview.eligible || 0) +
        ' excluded=' + (preview.excluded || 0) + ' universe=' + (preview.deploymentUniverseSize || 0)
    };
  }

  /**
   * @param {Object} boot from runEdmBootstrapCsatResponsesStorage
   * @return {{ ok: boolean, message: string, summary: string }}
   */
  function evaluateBootstrapPhase(boot) {
    if (!boot || typeof boot !== 'object') {
      return {
        ok: false,
        message: 'slg_bootstrap: missing_bootstrap_result',
        summary: 'bootstrap=absent'
      };
    }
    var ok = boot.ok && boot.dataRowCount === 0;
    return {
      ok: ok,
      message: ok ? 'bootstrap_ok' : 'bootstrap_failed',
      summary: 'dataRows=' + (boot.dataRowCount || 0)
    };
  }

  /**
   * @param {Object} run ingest pass
   * @param {string} slgAppId
   * @param {string} phaseId
   * @return {{ ok: boolean, message: string, summary: string, slg?: Object }}
   */
  function evaluateFirstIngestPhase(run, slgAppId, phaseId) {
    var shape = assertResponsesInboxRunShape(run, phaseId);
    if (!shape.ok) {
      return shape;
    }
    var ingest = shape.run;
    var slg = (ingest.destinationResults || []).filter(function (d) {
      return d.appId === slgAppId;
    })[0];
    if (!slg) {
      return {
        ok: false,
        message: phaseId + ': slg_destination_missing',
        summary: 'destinationResults=' + (ingest.destinationResults || []).length
      };
    }
    var ingestOk = ingest.ok && slg.status === 'success' &&
      (slg.inserted || 0) > 0 && (slg.updated || 0) === 0 && (slg.unchanged || 0) === 0;
    return {
      ok: ingestOk,
      message: ingestOk ? 'first_ingest_ok' : 'first_ingest_failed',
      summary: 'inserted=' + (slg.inserted || 0) + ' updated=' + (slg.updated || 0) +
        ' unchanged=' + (slg.unchanged || 0) + ' excluded=' + (slg.excludedCount || 0),
      slg: slg
    };
  }

  /**
   * @param {Object} verify1
   * @param {Object} slg1
   * @return {{ ok: boolean, message: string, summary: string }}
   */
  function evaluateStorageVerifyPhase(verify1, slg1) {
    if (!verify1 || typeof verify1 !== 'object') {
      return {
        ok: false,
        message: 'slg_storage_verify: missing_verify_result',
        summary: 'verify=absent'
      };
    }
    slg1 = slg1 || {};
    var verifyOk = verify1.ok && verify1.headerOk && !verify1.forbiddenColumnsPresent &&
      verify1.rowCount === verify1.uniqueResponseIds &&
      verify1.rowCount === (slg1.inserted || 0);
    return {
      ok: verifyOk,
      message: verifyOk ? 'storage_ok' : 'storage_verify_failed',
      summary: 'rows=' + (verify1.rowCount || 0) + ' uniqueIds=' + (verify1.uniqueResponseIds || 0)
    };
  }

  /**
   * @param {Object} run second ingest
   * @param {Object} slg1 first ingest dest summary
   * @param {string} slgAppId
   * @return {{ ok: boolean, message: string, summary: string }}
   */
  function evaluateIdempotencyPhase(run, slg1, slgAppId) {
    var shape = assertResponsesInboxRunShape(run, 'slg_idempotency');
    if (!shape.ok) {
      return shape;
    }
    slg1 = slg1 || {};
    var ingest2 = shape.run;
    var slg2 = (ingest2.destinationResults || []).filter(function (d) {
      return d.appId === slgAppId;
    })[0] || {};
    var priorEligible = (slg1.inserted || 0) + (slg1.unchanged || 0);
    var idemOk = ingest2.ok &&
      (slg2.inserted || 0) === 0 && (slg2.updated || 0) === 0 &&
      (slg2.unchanged || 0) === priorEligible;
    return {
      ok: idemOk,
      message: idemOk ? 'idempotent_ok' : 'idempotency_failed',
      summary: 'inserted=' + (slg2.inserted || 0) + ' unchanged=' + (slg2.unchanged || 0)
    };
  }

  /**
   * Reproduces the unsafe access pattern removed from the canary (for regression tests).
   * @param {Object} dry
   * @return {boolean}
   */
  function legacyUnsafeDryRunCountCheck(dry) {
    var destMap = {};
    (dry.destinationResults || []).forEach(function (d) {
      destMap[d.appId] = d.inputRows;
    });
    return dry.ok &&
      (dry.outcome.job.sourceRowCount === 177) &&
      destMap.HC_DM === 77 && destMap.SLG_DM === 28 && destMap.HENP_DM === 72;
  }

  return {
    EXPECTED_DRY_RUN: EXPECTED_DRY_RUN,
    assertResponsesInboxRunShape: assertResponsesInboxRunShape,
    evaluateDryRunPhase: evaluateDryRunPhase,
    evaluateEligibilityPhase: evaluateEligibilityPhase,
    evaluateBootstrapPhase: evaluateBootstrapPhase,
    evaluateFirstIngestPhase: evaluateFirstIngestPhase,
    evaluateStorageVerifyPhase: evaluateStorageVerifyPhase,
    evaluateIdempotencyPhase: evaluateIdempotencyPhase,
    legacyUnsafeDryRunCountCheck: legacyUnsafeDryRunCountCheck
  };
})();
