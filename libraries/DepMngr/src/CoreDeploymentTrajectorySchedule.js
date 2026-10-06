/**
 * CoreDeploymentTrajectorySchedule.js
 *
 * Pure schedule / MTP trajectory logic for Deployment Trajectory v2.
 * No SpreadsheetApp — consumed by CoreDeploymentTrajectory and Node tests.
 */

var TrajectorySchedule = {

  PARENT_TARGET_FIELD: 'First_Move_to_Production_Date_C__c',
  PARENT_ACTUAL_FIELD: 'First_Move_to_Production_Date_Actual__c',
  PARENT_BASELINE_FIELD: 'First_Move_to_Production_Date_OEMB__c',
  PARENT_SOURCE_OBJECT: 'Deployment__c',
  PF_SOURCE_OBJECT: 'Deployment_Product_Function__c',
  PF_TARGET_FIELD: 'Production_Move_Date_Target__c',
  PF_ACTUAL_FIELD: 'Production_Move_Date_Actual__c',
  PF_HISTORY_OBJECT: 'Deployment_Product_Function__History',

  EVENT_PARENT_TARGET: 'PARENT_TARGET_CHANGE',
  EVENT_PARENT_ACTUAL: 'PARENT_ACTUAL_MTP',
  EVENT_FUNCTION_TARGET: 'FUNCTION_TARGET_CHANGE',
  EVENT_FUNCTION_ACTUAL: 'FUNCTION_ACTUAL_MTP',

  GRAIN_DEPLOYMENT: 'DEPLOYMENT',
  GRAIN_PRODUCT_FUNCTION: 'PRODUCT_FUNCTION',
  GRAIN_DEPLOYMENT_ONLY: 'DEPLOYMENT_ONLY',

  RECON_MATCH: 'MATCH',
  RECON_MISMATCH: 'DATE_MISMATCH',
  RECON_RECON_BLANK_CURRENT: 'RECONSTRUCTED_BLANK_CURRENT_POPULATED',
  RECON_RECON_POP_CURRENT_BLANK: 'RECONSTRUCTED_POPULATED_CURRENT_BLANK',
  RECON_NA_PF: 'NOT_APPLICABLE_PRODUCT_FUNCTION_GRAIN',

  /**
   * @param {Object} pf
   * @return {string}
   */
  functionEffectiveMtp: function (pf) {
    if (!pf) return '';
    if (pf.current_actual_mtp) return pf.current_actual_mtp;
    if (pf.current_target_mtp) return pf.current_target_mtp;
    if (pf.actualMtp) return pf.actualMtp;
    if (pf.targetMtp) return pf.targetMtp;
    return '';
  },

  /**
   * @param {Array<Object>} productFunctions
   * @return {Object}
   */
  analyzeProductFunctionGrain: function (productFunctions) {
    productFunctions = productFunctions || [];
    var withMtp = 0;
    var without = 0;
    var distinct = {};

    productFunctions.forEach(function (pf) {
      var eff = TrajectorySchedule.functionEffectiveMtp(pf);
      if (eff) {
        withMtp++;
        distinct[eff] = true;
      } else {
        without++;
      }
    });

    var distinctDates = Object.keys(distinct).sort();
    var grain = TrajectorySchedule.GRAIN_DEPLOYMENT_ONLY;
    var warnings = [];

    if (!productFunctions.length) {
      grain = TrajectorySchedule.GRAIN_DEPLOYMENT_ONLY;
    } else if (distinctDates.length >= 2) {
      grain = TrajectorySchedule.GRAIN_PRODUCT_FUNCTION;
    } else if (distinctDates.length === 1 && withMtp > 0) {
      grain = TrajectorySchedule.GRAIN_DEPLOYMENT;
    } else if (withMtp === 0) {
      grain = TrajectorySchedule.GRAIN_DEPLOYMENT_ONLY;
      warnings.push('insufficient_product_function_data_for_mtp_analysis');
    } else {
      grain = TrajectorySchedule.GRAIN_DEPLOYMENT_ONLY;
    }

    return {
      mtp_analysis_grain: grain,
      product_function_count: productFunctions.length,
      product_function_with_mtp_count: withMtp,
      product_function_without_mtp_count: without,
      distinct_current_function_mtp_count: distinctDates.length,
      distinct_current_function_mtps: distinctDates.join(';'),
      warnings: warnings
    };
  },

  /**
   * @param {Array<Object>} historyRows chronologically sortable
   * @param {string} fieldName
   * @param {function} normalizeDate (value, label) => string
   * @return {Object}
   */
  replayFunctionFieldHistory: function (historyRows, fieldName, normalizeDate) {
    var rows = (historyRows || []).filter(function (r) {
      return r.field === fieldName;
    }).slice();
    rows.sort(function (a, b) {
      return (a.createdDate || '') < (b.createdDate || '') ? -1 :
        ((a.createdDate || '') > (b.createdDate || '') ? 1 : 0);
    });

    var transitions = [];
    rows.forEach(function (r) {
      var oldDate = normalizeDate(r.oldValue, 'pf_hist_old');
      var newDate = normalizeDate(r.newValue, 'pf_hist_new');
      var movement = null;
      var validChange = false;
      if (oldDate && newDate && oldDate !== newDate) {
        movement = TrajectoryMetrics.signedDaysBetween(oldDate, newDate);
        validChange = movement !== null;
      }
      transitions.push({
        atDate: r.createdDate || '',
        oldDate: oldDate,
        newDate: newDate,
        movementDays: movement,
        validChange: validChange
      });
    });
    return transitions;
  },

  /**
   * @param {Array<Object>} targetTransitions
   * @param {Array<Object>} actualTransitions
   * @param {string} sheetTarget
   * @param {string} sheetActual
   * @param {string} todayStr
   * @return {Object}
   */
  computeFunctionScheduleMetrics: function (
    targetTransitions, actualTransitions, sheetTarget, sheetActual, todayStr) {
    var targetMetrics = TrajectorySchedule.computeTargetScheduleMetrics(
      targetTransitions, sheetTarget, todayStr);
    var actualMetrics = TrajectorySchedule.computeActualOutcomeMetrics(
      actualTransitions, targetMetrics.current_target_mtp, todayStr);

    if (!targetMetrics.current_target_mtp && sheetTarget) {
      targetMetrics.current_target_mtp = sheetTarget;
    }
    if (!actualMetrics.current_actual_mtp && sheetActual) {
      actualMetrics.current_actual_mtp = sheetActual;
      actualMetrics.actual_mtp = sheetActual;
    }
    if (actualMetrics.current_actual_mtp && targetMetrics.current_target_mtp &&
        actualMetrics.actual_vs_final_target_days === null) {
      actualMetrics.actual_vs_final_target_days = TrajectoryMetrics.signedDaysBetween(
        targetMetrics.current_target_mtp, actualMetrics.current_actual_mtp);
      actualMetrics.final_target_before_actual = targetMetrics.current_target_mtp;
    }

    return Object.assign({}, targetMetrics, actualMetrics, {
      current_effective_mtp: actualMetrics.current_actual_mtp ||
        targetMetrics.current_target_mtp || ''
    });
  },

  /**
   * Target-only schedule metrics (Product Function or parent projected field).
   * @param {Array<{atDate:string,oldDate:string,newDate:string,movementDays:number|null,validChange:boolean}>} transitions
   * @param {string} currentTargetFromSheet
   * @param {string} todayStr
   * @return {Object}
   */
  computeTargetScheduleMetrics: function (transitions, currentTargetFromSheet, todayStr) {
    transitions = transitions || [];
    var cutoff30 = TrajectoryMetrics.dateMinusDays(todayStr, 30);
    var cutoff90 = TrajectoryMetrics.dateMinusDays(todayStr, 90);

    var earliest = '';
    var previousTarget = '';
    var lastChangeDate = '';
    var lastChangeDays = null;
    var changes30 = 0;
    var changes90 = 0;
    var changesTotal = 0;
    var slips90 = 0;
    var accelerations90 = 0;
    var slipDays90 = 0;
    var gross = 0;
    var recordedTargets = [];

    transitions.forEach(function (ev) {
      if (ev.newDate) recordedTargets.push(ev.newDate);
      if (!ev.validChange) return;

      changesTotal++;
      if (TrajectoryMetrics.isOnOrAfterCutoff(ev.atDate, cutoff30)) changes30++;
      if (TrajectoryMetrics.isOnOrAfterCutoff(ev.atDate, cutoff90)) changes90++;

      if (ev.movementDays !== null) {
        gross += Math.abs(ev.movementDays);
        if (TrajectoryMetrics.isOnOrAfterCutoff(ev.atDate, cutoff90)) {
          if (ev.movementDays > 0) {
            slips90++;
            slipDays90 += ev.movementDays;
          } else if (ev.movementDays < 0) {
            accelerations90++;
          }
        }
      }
      previousTarget = ev.oldDate || '';
      lastChangeDate = ev.atDate || '';
      lastChangeDays = ev.movementDays;
    });

    if (recordedTargets.length) {
      earliest = recordedTargets.slice().sort()[0];
    }

    var currentTarget = currentTargetFromSheet || '';
    if (!currentTarget && transitions.length) {
      currentTarget = transitions[transitions.length - 1].newDate || '';
    }

    var net = null;
    if (currentTarget && earliest) {
      net = TrajectoryMetrics.signedDaysBetween(earliest, currentTarget);
    }

    return {
      current_target_mtp: currentTarget,
      earliest_recorded_target_mtp: earliest,
      previous_target_mtp: previousTarget,
      target_last_change_date: lastChangeDate,
      target_last_change_days: lastChangeDays,
      target_changes_total: changesTotal,
      target_changes_30d: changes30,
      target_changes_90d: changes90,
      target_slips_90d: slips90,
      target_accelerations_90d: accelerations90,
      target_net_movement_days: net,
      target_gross_movement_days: gross,
      target_slip_days_90d: slipDays90
    };
  },

  /**
   * @param {Array<Object>} actualTransitions
   * @param {string} finalTarget
   * @param {string} todayStr
   * @return {Object}
   */
  computeActualOutcomeMetrics: function (actualTransitions, finalTarget, todayStr) {
    actualTransitions = (actualTransitions || []).map(function (ev) {
      return {
        atDate: ev.atDate,
        oldDate: ev.oldDate,
        newDate: ev.newDate,
        movementDays: ev.movementDays,
        validChange: ev.validChange
      };
    });

    var currentActual = '';
    var recordedDate = '';
    if (actualTransitions.length) {
      var last = actualTransitions[actualTransitions.length - 1];
      currentActual = last.newDate || '';
      recordedDate = last.atDate || '';
    }

    var finalTargetBefore = finalTarget || '';
    var variance = null;
    if (currentActual && finalTargetBefore) {
      variance = TrajectoryMetrics.signedDaysBetween(finalTargetBefore, currentActual);
    }

    return {
      current_actual_mtp: currentActual,
      actual_mtp: currentActual,
      actual_mtp_recorded_date: recordedDate,
      final_target_before_actual: finalTargetBefore,
      actual_vs_final_target_days: variance
    };
  },

  /**
   * @param {Array<Object>} parentHistoryEvents raw history map events
   * @param {function} normalizeDate
   * @param {string} todayStr
   * @return {Object}
   */
  buildParentSchedule: function (
    parentHistoryEvents, normalizeDate, todayStr, currentTargetFromRow, currentMtpReference, baselineMtp) {
    var targetRaw = TrajectorySchedule._parentFieldTransitions_(
      parentHistoryEvents, TrajectorySchedule.PARENT_TARGET_FIELD, normalizeDate);
    var actualRaw = TrajectorySchedule._parentFieldTransitions_(
      parentHistoryEvents, TrajectorySchedule.PARENT_ACTUAL_FIELD, normalizeDate);

    var targetMetrics = TrajectorySchedule.computeTargetScheduleMetrics(
      targetRaw, currentTargetFromRow || '', todayStr);
    var parentMtp = TrajectorySchedule.computeParentMtpMetricsFromTarget(
      targetRaw, currentMtpReference || '', baselineMtp || '', todayStr);

    var actualOutcome = TrajectorySchedule.computeActualOutcomeMetrics(
      actualRaw, targetMetrics.current_target_mtp, todayStr);

    var reconstructed = TrajectorySchedule.reconstructParentEffectiveMtp(
      parentHistoryEvents, normalizeDate);

    return {
      targetTransitions: targetRaw,
      actualTransitions: actualRaw,
      targetMetrics: targetMetrics,
      parentMtpMetrics: parentMtp,
      actualOutcome: actualOutcome,
      reconstructed_parent_effective_mtp: reconstructed.effective || ''
    };
  },

  /**
   * Full per-deployment schedule bundle.
   * @param {Object} opts
   * @return {Object}
   */
  buildForDeployment: function (opts) {
    opts = opts || {};
    var warnings = [];
    var pfList = opts.productFunctions || [];
    var grainInfo = TrajectorySchedule.analyzeProductFunctionGrain(pfList);
    (grainInfo.warnings || []).forEach(function (w) { warnings.push(w); });

    var normalizeDate = opts.normalizeDate || function (v) { return String(v || '').slice(0, 10); };
    var todayStr = opts.todayStr || '';
    var grain = grainInfo.mtp_analysis_grain;

    var functionBundles = [];
    var functionMetricsList = [];
    (pfList || []).forEach(function (pf) {
      var hist = (opts.pfHistoryByPfId && opts.pfHistoryByPfId[pf.id]) ||
        (opts.pfHistoryByPfId && pf.id && pf.id.length >= 15 &&
          opts.pfHistoryByPfId[pf.id.slice(0, 15)]) || [];
      var targetT = TrajectorySchedule.replayFunctionFieldHistory(
        hist, TrajectorySchedule.PF_TARGET_FIELD, normalizeDate);
      var actualT = TrajectorySchedule.replayFunctionFieldHistory(
        hist, TrajectorySchedule.PF_ACTUAL_FIELD, normalizeDate);
      var fm = TrajectorySchedule.computeFunctionScheduleMetrics(
        targetT, actualT, pf.targetMtp || '', pf.actualMtp || '', todayStr);
      fm.target_event_count = targetT.length;
      fm.actual_event_count = actualT.length;
      functionMetricsList.push(fm);
      functionBundles.push({
        pf: pf,
        targetTransitions: targetT,
        actualTransitions: actualT,
        finalTarget: fm.current_target_mtp
      });
    });

    var parentSchedule = TrajectorySchedule.buildParentSchedule(
      opts.parentHistoryEvents || [],
      normalizeDate,
      todayStr,
      opts.parentTargetFromRow || '',
      opts.currentMtpReference || '',
      opts.baselineMtp || '');

    if ((grain === TrajectorySchedule.GRAIN_DEPLOYMENT ||
         grain === TrajectorySchedule.GRAIN_DEPLOYMENT_ONLY) &&
        !parentSchedule.targetTransitions.length &&
        !parentSchedule.reconstructed_parent_effective_mtp &&
        !(opts.parentTargetFromRow || opts.currentMtpReference)) {
      warnings.push('parent_mtp_reconstruction_failed');
    }

    var reconciliationStatus = TrajectorySchedule.reconcileParentMtp(
      parentSchedule.reconstructed_parent_effective_mtp,
      opts.currentMtpReference || '',
      grain);
    if (reconciliationStatus === TrajectorySchedule.RECON_MISMATCH) {
      warnings.push('parent_mtp_reconciliation_mismatch');
    }

    var pfRollups = {};
    if (grain === TrajectorySchedule.GRAIN_PRODUCT_FUNCTION) {
      pfRollups = TrajectorySchedule.aggregateProductFunctionRollups(
        functionMetricsList, todayStr);
    }

    var mtpEvents = [];
    if (grain === TrajectorySchedule.GRAIN_PRODUCT_FUNCTION) {
      mtpEvents = TrajectorySchedule.buildScheduleEventRows({
        deploymentId: opts.deploymentId,
        grain: grain,
        functionBundles: functionBundles
      });
    } else {
      mtpEvents = TrajectorySchedule.buildScheduleEventRows({
        deploymentId: opts.deploymentId,
        grain: grain,
        parentTargetTransitions: parentSchedule.targetTransitions,
        parentActualTransitions: parentSchedule.actualTransitions,
        parentFinalTarget: parentSchedule.targetMetrics.current_target_mtp
      });
      if (grain === TrajectorySchedule.GRAIN_DEPLOYMENT && functionBundles.length) {
        var fnEvents = TrajectorySchedule.buildScheduleEventRows({
          deploymentId: opts.deploymentId,
          grain: grain,
          functionBundles: functionBundles
        });
        mtpEvents = mtpEvents.concat(fnEvents);
      }
    }

    return {
      grainInfo: grainInfo,
      parentSchedule: parentSchedule,
      functionMetricsList: functionMetricsList,
      pfRollups: pfRollups,
      mtpEvents: mtpEvents,
      reconciliationStatus: reconciliationStatus,
      warnings: warnings
    };
  },

  /**
   * Maps target transitions to legacy Deployment_Trajectory parent mtp_* columns.
   * @param {Array<Object>} targetTransitions
   * @param {string} currentMtpReference Current_MTP_Date__c from deployments row
   * @param {string} baselineMtp OEMB / baseline
   * @param {string} todayStr
   * @return {Object}
   */
  computeParentMtpMetricsFromTarget: function (
    targetTransitions, currentMtpReference, baselineMtp, todayStr) {
    var evForLegacy = (targetTransitions || []).filter(function (t) {
      return t.validChange;
    }).map(function (t) {
      return {
        atDate: t.atDate,
        oldDate: t.oldDate,
        newDate: t.newDate,
        movementDays: t.movementDays
      };
    });

    var m = TrajectoryMetrics.computeMtpMetrics(
      evForLegacy,
      currentMtpReference || '',
      baselineMtp || '',
      todayStr);

    var allTargetEvents = targetTransitions || [];
    if (allTargetEvents.length) {
      var last = allTargetEvents[allTargetEvents.length - 1];
      m.previous_mtp = last.oldDate || m.previous_mtp;
      m.mtp_last_change_date = last.validChange ? (last.atDate || m.mtp_last_change_date) :
        m.mtp_last_change_date;
      m.mtp_last_change_days = last.validChange ? last.movementDays : m.mtp_last_change_days;
    }

    m.mtp_changes_total = TrajectorySchedule.computeTargetScheduleMetrics(
      targetTransitions, currentMtpReference, todayStr).target_changes_total;

    return m;
  },

  /**
   * CoreHistory-aligned effective MTP replay (Actual ?? Change ?? Baseline).
   * @param {Array<Object>} events
   * @param {function} normalizeDate
   * @return {{effective:string, source:string}}
   */
  reconstructParentEffectiveMtp: function (events, normalizeDate) {
    var classified = (events || []).filter(function (e) {
      var f = String(e.field || '').toLowerCase();
      return f.indexOf('mtp') !== -1 ||
        f.indexOf('move_to_production') !== -1 ||
        f.indexOf('oemb') !== -1;
    }).map(function (e) {
      var f = String(e.field || '').toLowerCase();
      var source;
      if (f.indexOf('actual') !== -1) {
        source = 'Actual';
      } else if (f.indexOf('oemb') !== -1 || f.indexOf('baseline') !== -1) {
        source = 'Baseline';
      } else if (e.field === TrajectorySchedule.PARENT_TARGET_FIELD) {
        source = 'Change';
      } else {
        source = 'Change';
      }
      return {
        source: source,
        rawDate: e['new'],
        setAt: e.at
      };
    });

    classified.sort(function (a, b) {
      return String(a.setAt || '') < String(b.setAt || '') ? -1 :
        (String(a.setAt || '') > String(b.setAt || '') ? 1 : 0);
    });

    var runningActual = null;
    var runningChange = null;
    var runningBaseline = null;
    var effective = '';
    var effectiveSource = '';

    classified.forEach(function (ev) {
      var dateStr = normalizeDate(ev.rawDate, 'parent_replay');
      if (ev.source === 'Actual') runningActual = dateStr;
      if (ev.source === 'Change') runningChange = dateStr;
      if (ev.source === 'Baseline') runningBaseline = dateStr;

      var eff = runningActual || runningChange || runningBaseline || '';
      var src = runningActual ? 'Actual' :
        (runningChange ? 'Change' : (runningBaseline ? 'Baseline' : ''));
      if (eff) {
        effective = eff;
        effectiveSource = src;
      }
    });

    return { effective: effective, source: effectiveSource };
  },

  /**
   * @param {string} reconstructed
   * @param {string} currentMtp
   * @param {string} grain
   * @return {string}
   */
  reconcileParentMtp: function (reconstructed, currentMtp, grain) {
    if (grain === TrajectorySchedule.GRAIN_PRODUCT_FUNCTION) {
      return TrajectorySchedule.RECON_NA_PF;
    }
    if (!reconstructed && currentMtp) {
      return TrajectorySchedule.RECON_RECON_BLANK_CURRENT;
    }
    if (reconstructed && !currentMtp) {
      return TrajectorySchedule.RECON_RECON_POP_CURRENT_BLANK;
    }
    if (!reconstructed && !currentMtp) {
      return TrajectorySchedule.RECON_MATCH;
    }
    if (reconstructed === currentMtp) {
      return TrajectorySchedule.RECON_MATCH;
    }
    return TrajectorySchedule.RECON_MISMATCH;
  },

  /**
   * @param {Array<Object>} functionMetricsList
   * @param {string} todayStr
   * @return {Object}
   */
  aggregateProductFunctionRollups: function (functionMetricsList, todayStr) {
    functionMetricsList = functionMetricsList || [];
    var cutoff30 = TrajectoryMetrics.dateMinusDays(todayStr, 30);
    var cutoff90 = TrajectoryMetrics.dateMinusDays(todayStr, 90);

    var actualCount = 0;
    var remaining = 0;
    var remainingTargets = [];
    var fnChg30 = 0;
    var fnChg90 = 0;
    var fnSlips90 = 0;
    var fnAccel90 = 0;
    var fnSlipDays90 = 0;
    var fnGross90 = 0;
    var fnWithChg30 = 0;
    var fnWithChg90 = 0;
    var fnWithSlips90 = 0;
    var lateCount = 0;
    var onTimeCount = 0;
    var mostRecentChange = '';
    var scheduleEventCount = 0;

    functionMetricsList.forEach(function (fm) {
      scheduleEventCount += (fm.target_event_count || 0) + (fm.actual_event_count || 0);
      if (fm.current_actual_mtp) {
        actualCount++;
        if (fm.actual_vs_final_target_days !== null && fm.actual_vs_final_target_days > 0) {
          lateCount++;
        } else if (fm.actual_vs_final_target_days !== null &&
                   fm.actual_vs_final_target_days <= 0) {
          onTimeCount++;
        }
      } else {
        remaining++;
        if (fm.current_target_mtp) remainingTargets.push(fm.current_target_mtp);
      }

      fnChg30 += fm.target_changes_30d || 0;
      fnChg90 += fm.target_changes_90d || 0;
      fnSlips90 += fm.target_slips_90d || 0;
      fnAccel90 += fm.target_accelerations_90d || 0;
      fnSlipDays90 += fm.target_slip_days_90d || 0;
      fnGross90 += fm.target_gross_movement_days || 0;

      if ((fm.target_changes_30d || 0) > 0) fnWithChg30++;
      if ((fm.target_changes_90d || 0) > 0) fnWithChg90++;
      if ((fm.target_slips_90d || 0) > 0) fnWithSlips90++;

      if (fm.target_last_change_date &&
          (!mostRecentChange || fm.target_last_change_date > mostRecentChange)) {
        mostRecentChange = fm.target_last_change_date;
      }
    });

    remainingTargets.sort();
    return {
      functions_actual_mtp_count: actualCount,
      functions_remaining_count: remaining,
      remaining_earliest_target_mtp: remainingTargets.length ? remainingTargets[0] : '',
      remaining_latest_target_mtp: remainingTargets.length ?
        remainingTargets[remainingTargets.length - 1] : '',
      functions_with_target_changes_30d: fnWithChg30,
      functions_with_target_changes_90d: fnWithChg90,
      functions_with_target_slips_90d: fnWithSlips90,
      function_target_changes_30d: fnChg30,
      function_target_changes_90d: fnChg90,
      function_target_slips_90d: fnSlips90,
      function_target_accelerations_90d: fnAccel90,
      function_target_slip_days_90d: fnSlipDays90,
      function_target_gross_movement_days_90d: fnGross90,
      most_recent_function_target_change_date: mostRecentChange,
      functions_late_vs_final_target_count: lateCount,
      functions_on_or_before_final_target_count: onTimeCount,
      function_schedule_event_count: scheduleEventCount
    };
  },

  /**
   * @param {Object} opts
   * @return {Array<Object>}
   */
  buildScheduleEventRows: function (opts) {
    opts = opts || {};
    var deploymentId = opts.deploymentId || '';
    var grain = opts.grain || '';
    var rows = [];

    function pushTarget_(list, eventType, sourceObject, sourceField, pf) {
      (list || []).forEach(function (t) {
        rows.push({
          deployment_id: deploymentId,
          mtp_analysis_grain: grain,
          product_function_id: pf ? pf.id : '',
          product_area: pf ? (pf.productArea || '') : '',
          function: pf ? (pf.functionName || '') : '',
          event_date: t.atDate,
          event_type: eventType,
          old_date: t.oldDate || '',
          new_date: t.newDate || '',
          movement_days: t.validChange && t.movementDays !== null ? t.movementDays : '',
          actual_vs_final_target_days: '',
          source_object: sourceObject,
          source_field: sourceField
        });
      });
    }

    function pushActual_(list, eventType, sourceObject, sourceField, pf, finalTarget) {
      (list || []).forEach(function (t) {
        var variance = '';
        if (t.newDate && finalTarget) {
          var v = TrajectoryMetrics.signedDaysBetween(finalTarget, t.newDate);
          variance = v !== null ? v : '';
        }
        rows.push({
          deployment_id: deploymentId,
          mtp_analysis_grain: grain,
          product_function_id: pf ? pf.id : '',
          product_area: pf ? (pf.productArea || '') : '',
          function: pf ? (pf.functionName || '') : '',
          event_date: t.atDate,
          event_type: eventType,
          old_date: t.oldDate || '',
          new_date: t.newDate || '',
          movement_days: '',
          actual_vs_final_target_days: variance,
          source_object: sourceObject,
          source_field: sourceField
        });
      });
    }

    if (opts.parentTargetTransitions) {
      pushTarget_(
        opts.parentTargetTransitions,
        TrajectorySchedule.EVENT_PARENT_TARGET,
        TrajectorySchedule.PARENT_SOURCE_OBJECT,
        TrajectorySchedule.PARENT_TARGET_FIELD,
        null);
    }
    if (opts.parentActualTransitions) {
      pushActual_(
        opts.parentActualTransitions,
        TrajectorySchedule.EVENT_PARENT_ACTUAL,
        TrajectorySchedule.PARENT_SOURCE_OBJECT,
        TrajectorySchedule.PARENT_ACTUAL_FIELD,
        null,
        opts.parentFinalTarget || '');
    }
    (opts.functionBundles || []).forEach(function (bundle) {
      pushTarget_(
        bundle.targetTransitions,
        TrajectorySchedule.EVENT_FUNCTION_TARGET,
        TrajectorySchedule.PF_SOURCE_OBJECT,
        TrajectorySchedule.PF_TARGET_FIELD,
        bundle.pf);
      pushActual_(
        bundle.actualTransitions,
        TrajectorySchedule.EVENT_FUNCTION_ACTUAL,
        TrajectorySchedule.PF_SOURCE_OBJECT,
        TrajectorySchedule.PF_ACTUAL_FIELD,
        bundle.pf,
        bundle.finalTarget || '');
    });

    return rows;
  },

  /**
   * @param {Array<Object>} events
   * @param {string} fieldName
   * @param {function} normalizeDate
   * @return {Array<Object>}
   * @private
   */
  _parentFieldTransitions_: function (events, fieldName, normalizeDate) {
    var out = [];
    (events || []).forEach(function (ev) {
      if (ev.field !== fieldName) return;
      var atDate = normalizeDate(ev.at, 'parent_hist_at');
      if (!atDate && ev.at) {
        atDate = String(ev.at).slice(0, 10);
      }
      var oldDate = normalizeDate(ev.old, 'parent_hist_old');
      var newDate = normalizeDate(ev['new'], 'parent_hist_new');
      var movement = null;
      var validChange = false;
      if (oldDate && newDate && oldDate !== newDate) {
        movement = TrajectoryMetrics.signedDaysBetween(oldDate, newDate);
        validChange = movement !== null;
      }
      out.push({
        atDate: atDate,
        oldDate: oldDate,
        newDate: newDate,
        movementDays: movement,
        validChange: validChange
      });
    });
    out.sort(function (a, b) {
      return (a.atDate || '') < (b.atDate || '') ? -1 :
        ((a.atDate || '') > (b.atDate || '') ? 1 : 0);
    });
    return out;
  },

  /**
   * Index PF history rows by ParentId (canonical).
   * @param {Array<Object>} historyRows
   * @param {function} canonicalId
   * @return {Object}
   */
  indexHistoryByParentId: function (historyRows, canonicalId) {
    var map = {};
    (historyRows || []).forEach(function (row) {
      var pid = canonicalId(row.parentId);
      if (!pid) return;
      if (!map[pid]) map[pid] = [];
      map[pid].push(row);
      if (pid.length >= 15) {
        var short = pid.slice(0, 15);
        if (!map[short]) map[short] = map[pid];
      }
    });
    return map;
  },

  /**
   * Index product functions by deployment id.
   * @param {Array<Object>} pfRows
   * @param {function} canonicalId
   * @return {Object}
   */
  indexProductFunctionsByDeployment: function (pfRows, canonicalId) {
    var map = {};
    (pfRows || []).forEach(function (pf) {
      var depId = canonicalId(pf.deploymentId);
      if (!depId) return;
      if (!map[depId]) map[depId] = [];
      map[depId].push(pf);
    });
    return map;
  },

  /**
   * Normalizes connector/sheet header text (BOM, nbsp, trim).
   * @param {any} header
   * @return {string}
   */
  normalizeSheetHeader: function (header) {
    return String(header || '')
      .replace(/\ufeff/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
  },

  /**
   * @param {any} value
   * @return {string}
   */
  sheetCellScalar: function (value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return '';
    return String(value).trim();
  },

  /**
   * @param {string} id
   * @return {boolean}
   */
  isValidSalesforceId: function (id) {
    return /^[a-zA-Z0-9]{15,18}$/.test(String(id || '').trim());
  },

  /**
   * Resolves PF sheet column indices (aligned with CoreData readSfdcProductFunctionsRaw_).
   * @param {Array<string>} headerRow
   * @return {Object}
   */
  resolveProductFunctionColumns: function (headerRow) {
    var headers = (headerRow || []).map(function (h) {
      return TrajectorySchedule.normalizeSheetHeader(h);
    });
    var lower = headers.map(function (h) { return h.toLowerCase(); });

    function findExact_(name) {
      var t = String(name || '').toLowerCase();
      for (var i = 0; i < lower.length; i++) {
        if (lower[i] === t) return i;
      }
      return -1;
    }

    function detect_(keywords, fallback) {
      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = String(keywords[ki] || '').toLowerCase();
        for (var i = 0; i < lower.length; i++) {
          if (lower[i].indexOf(kw) !== -1) return i;
        }
      }
      if (typeof fallback === 'number' && fallback >= 0 && fallback < headers.length) {
        return fallback;
      }
      return -1;
    }

    var colDepFlat = findExact_('Deployment__c');
    var colDepRel = findExact_('Deployment__r.Id');
    var colFk = colDepFlat >= 0 ? colDepFlat : colDepRel;
    if (colFk < 0) {
      for (var fi = 0; fi < lower.length; fi++) {
        if (lower[fi].indexOf('deployment') !== -1 && lower[fi].indexOf('.') === -1) {
          colFk = fi;
          break;
        }
      }
    }
    if (colFk < 0) {
      colFk = detect_(['deployment__c', 'deployment__r.id'], 5);
    }

    var colId = findExact_('Id');
    if (colId >= 0 && colId === colFk) colId = -1;

    return {
      headerRow: headers,
      colId: colId,
      colDepFlat: colDepFlat,
      colDepRel: colDepRel,
      colDepResolved: colFk,
      colArea: findExact_('Product_Area__c') >= 0 ?
        findExact_('Product_Area__c') : detect_(['product_area'], 1),
      colFn: findExact_('Function__c') >= 0 ?
        findExact_('Function__c') : detect_(['function__c', 'function'], 2),
      colTarget: findExact_('Production_Move_Date_Target__c') >= 0 ?
        findExact_('Production_Move_Date_Target__c') :
        detect_(['production_move_date_target', 'move_date_target'], 3),
      colActual: findExact_('Production_Move_Date_Actual__c') >= 0 ?
        findExact_('Production_Move_Date_Actual__c') :
        detect_(['production_move_date_actual', 'move_date_actual'], 4)
    };
  },

  /**
   * Parses SFDC_DeploymentProductFunctions sheet values (no SpreadsheetApp).
   * @param {Array<Array>} values Full sheet A1 range including header row.
   * @param {Object} deps parseRelationshipId, canonicalId, normalizeDate
   * @return {{rows:Array, byDeploymentId:Object, readMeta:Object}}
   */
  parseProductFunctionSheetValues: function (values, deps) {
    deps = deps || {};
    var parseRelId = deps.parseRelationshipId || TrajectoryMetrics.parseRelationshipIdField;
    var canonicalId = deps.canonicalId || function (id) {
      var s = String(id || '').trim();
      return s.length >= 18 ? s.slice(0, 18) : s;
    };
    var normalizeDate = deps.normalizeDate || function (raw) {
      if (!raw) return '';
      if (raw instanceof Date) {
        return raw.toISOString().slice(0, 10);
      }
      var s = String(raw).trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    };

    var rows = [];
    var byDeploymentId = {};
    var readMeta = {
      rawDataRows: 0,
      columnIndices: {},
      rejectionCounts: {},
      rowsWithNonblankId: 0,
      rowsWithNonblankDeployment: 0,
      rowsWithValidId: 0,
      rowsWithValidDeploymentId: 0,
      structuralSamples: []
    };

    if (!values || values.length < 2) {
      return { rows: rows, byDeploymentId: byDeploymentId, readMeta: readMeta };
    }

    var cols = TrajectorySchedule.resolveProductFunctionColumns(values[0]);
    readMeta.headerRow = cols.headerRow;
    readMeta.columnIndices = {
      Id: cols.colId,
      Product_Area__c: cols.colArea,
      Function__c: cols.colFn,
      Production_Move_Date_Target__c: cols.colTarget,
      Production_Move_Date_Actual__c: cols.colActual,
      Deployment__c: cols.colDepFlat,
      'Deployment__r.Id': cols.colDepRel,
      deploymentFkResolved: cols.colDepResolved
    };
    readMeta.rawDataRows = values.length - 1;

    function reject_(reason) {
      readMeta.rejectionCounts[reason] = (readMeta.rejectionCounts[reason] || 0) + 1;
    }

    if (cols.colId < 0) {
      reject_('missing_id_column');
    }
    if (cols.colDepResolved < 0) {
      reject_('missing_deployment_column');
    }

    var maxColIdx = Math.max(
      cols.colId, cols.colDepResolved, cols.colArea, cols.colFn, cols.colTarget, cols.colActual,
      cols.colDepFlat, cols.colDepRel);

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      if (row.length <= maxColIdx) {
        row = row.slice();
        while (row.length <= maxColIdx) row.push('');
      }
      if (cols.colId < 0 || cols.colDepResolved < 0) {
        reject_('unresolved_columns');
        continue;
      }

      var rawPfId = TrajectorySchedule.sheetCellScalar(row[cols.colId]);
      var rawDep = TrajectorySchedule.sheetCellScalar(row[cols.colDepResolved]);
      if (!rawDep && cols.colDepRel >= 0 && cols.colDepRel !== cols.colDepResolved) {
        rawDep = TrajectorySchedule.sheetCellScalar(row[cols.colDepRel]);
      }
      if (!rawDep && cols.colDepFlat >= 0 && cols.colDepFlat !== cols.colDepResolved) {
        rawDep = TrajectorySchedule.sheetCellScalar(row[cols.colDepFlat]);
      }

      if (rawPfId) readMeta.rowsWithNonblankId++;
      if (rawDep) readMeta.rowsWithNonblankDeployment++;

      var pfId = canonicalId(parseRelId(rawPfId));
      var depId = canonicalId(parseRelId(rawDep));

      if (pfId && TrajectorySchedule.isValidSalesforceId(pfId)) {
        readMeta.rowsWithValidId++;
      }
      if (depId && TrajectorySchedule.isValidSalesforceId(depId)) {
        readMeta.rowsWithValidDeploymentId++;
      }

      if (!rawPfId) {
        reject_('blank_id');
        continue;
      }
      if (!rawDep) {
        reject_('blank_deployment');
        continue;
      }
      if (!pfId || !TrajectorySchedule.isValidSalesforceId(pfId)) {
        reject_('invalid_id');
        continue;
      }
      if (!depId || !TrajectorySchedule.isValidSalesforceId(depId)) {
        reject_('invalid_deployment');
        continue;
      }

      var rec = {
        id: pfId,
        deploymentId: depId,
        productArea: cols.colArea >= 0 ?
          TrajectorySchedule.sheetCellScalar(row[cols.colArea]) : '',
        functionName: cols.colFn >= 0 ?
          TrajectorySchedule.sheetCellScalar(row[cols.colFn]) : '',
        targetMtp: normalizeDate(
          cols.colTarget >= 0 ? row[cols.colTarget] : '', 'pf_target'),
        actualMtp: normalizeDate(
          cols.colActual >= 0 ? row[cols.colActual] : '', 'pf_actual')
      };

      rows.push(rec);
      if (!byDeploymentId[depId]) byDeploymentId[depId] = [];
      byDeploymentId[depId].push(rec);
      if (depId.length >= 15) {
        var shortDep = depId.slice(0, 15);
        if (!byDeploymentId[shortDep]) byDeploymentId[shortDep] = byDeploymentId[depId];
      }
      if (pfId.length >= 15) {
        var shortPf = pfId.slice(0, 15);
        if (shortPf !== pfId && !byDeploymentId[shortPf]) {
          // no-op: deployment map only
        }
      }

      if (readMeta.structuralSamples.length < 3) {
        readMeta.structuralSamples.push({
          productFunctionId: rec.id,
          deploymentId: rec.deploymentId,
          productArea: rec.productArea,
          function: rec.functionName,
          targetMtp: rec.targetMtp,
          actualMtp: rec.actualMtp
        });
      }
    }

    readMeta.rowCount = rows.length;
    readMeta.uniqueProductFunctionIds = rows.length ? Object.keys(rows.reduce(function (acc, rec) {
      acc[rec.id] = true;
      return acc;
    }, {})).length : 0;

    return { rows: rows, byDeploymentId: byDeploymentId, readMeta: readMeta };
  }
};
