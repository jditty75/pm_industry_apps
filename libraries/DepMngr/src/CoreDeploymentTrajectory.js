/**
 * CoreDeploymentTrajectory.js
 *
 * Deterministic context-engineering layer: one row per Active parent-grain
 * Salesforce deployment. SLG pilot via cfg.deploymentSignal.enabled.
 */

var CoreDeploymentTrajectory = {

  /**
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  isEnabled: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    return !!(cfg.deploymentSignal && cfg.deploymentSignal.enabled === true);
  },

  /**
   * Refreshes trajectory and detail sheets. No-op when feature disabled.
   *
   * @param {AppConfig} appConfig
   * @return {Object} summary
   */
  refresh: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentTrajectory.isEnabled(cfg)) {
      Logger.log('CoreDeploymentTrajectory.refresh: deploymentSignal.enabled is false — skip.');
      return { skipped: true, reason: 'disabled' };
    }
    return CoreDeploymentTrajectory._runRefresh_(cfg, null);
  },

  /**
   * Debug bundle for one deployment.
   *
   * @param {AppConfig} appConfig
   * @param {string} deploymentId
   * @return {Object}
   */
  debugForDeployment: function (appConfig, deploymentId) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var target = String(deploymentId || '').trim();
    if (!target) {
      return { error: 'deploymentId required' };
    }
    var bundle = CoreDeploymentTrajectory._buildContext_(cfg, target);
    var match = null;
    (bundle.deployments || []).forEach(function (item) {
      if (item.row && CoreDeploymentTrajectory._idEquals_(item.row.deployment_id, target)) {
        match = item;
      }
    });
    var payload = {
      summary: bundle.summary,
      stats: bundle.stats,
      deployment: match ? {
        row: match.row,
        healthEvents: match.healthEvents,
        mtpEvents: match.mtpEvents,
        debug: match.debug
      } : null,
      actionHistoryIndex: (bundle.actionHistoryIndex || []).filter(function (row) {
        return CoreDeploymentTrajectory._idEquals_(row.deployment_id, target);
      })
    };
    Logger.log('CoreDeploymentTrajectory.debugForDeployment: ' +
      JSON.stringify(payload.summary || {}));
    return payload;
  },

  /**
   * @param {AppConfig} cfg
   * @param {string|null} onlyDeploymentId
   * @return {Object}
   * @private
   */
  _runRefresh_: function (cfg, onlyDeploymentId) {
    Logger.log('CoreDeploymentTrajectory._runRefresh_: start');
    var signal = cfg.deploymentSignal || {};
    var builtAt = new Date().toISOString();
    var todayStr = CoreDeploymentTrajectory._todayStr_();
    var ctx = CoreDeploymentTrajectory._buildContext_(cfg, onlyDeploymentId);

    var trajectoryHeaders = CoreDeploymentTrajectory._trajectoryHeaders_();
    var trajectoryRows = [];
    var healthEventRows = [];
    var mtpEventRows = [];
    var actionIndexRows = [];

    (ctx.deployments || []).forEach(function (item) {
      if (item.skipped) return;
      item.row.trajectory_built_at = builtAt;
      trajectoryRows.push(CoreDeploymentTrajectory._trajectoryRowToArray_(item.row, trajectoryHeaders));
      (item.healthEvents || []).forEach(function (ev) {
        healthEventRows.push(CoreDeploymentTrajectory._healthEventToArray_(ev));
      });
      (item.mtpEvents || []).forEach(function (ev) {
        mtpEventRows.push(CoreDeploymentTrajectory._mtpEventToArray_(ev));
      });
    });
    (ctx.actionHistoryIndex || []).forEach(function (row) {
      actionIndexRows.push(CoreDeploymentTrajectory._actionIndexToArray_(row));
    });

    var mtpMaxPerDeployment = 0;
    (ctx.deployments || []).forEach(function (item) {
      if (item.skipped) return;
      var n = (item.mtpEvents || []).length;
      if (n > mtpMaxPerDeployment) mtpMaxPerDeployment = n;
    });
    Logger.log('CoreDeploymentTrajectory._runRefresh_: output row counts' +
      ' trajectory=' + trajectoryRows.length +
      ' healthEvents=' + healthEventRows.length +
      ' mtpEvents=' + mtpEventRows.length +
      ' mtpMaxPerDeployment=' + mtpMaxPerDeployment +
      ' actionHistoryIndex=' + actionIndexRows.length);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    CoreDeploymentTrajectory._logWritePlan_(
      signal.trajectorySheetName, trajectoryHeaders, trajectoryRows);
    CoreDeploymentTrajectory._writeSheet_(
      ss, signal.trajectorySheetName, trajectoryHeaders, trajectoryRows);
    CoreDeploymentTrajectory._logWritePlan_(
      signal.healthEventsSheetName,
      CoreDeploymentTrajectory._healthEventHeaders_(),
      healthEventRows);
    CoreDeploymentTrajectory._writeSheet_(
      ss,
      signal.healthEventsSheetName,
      CoreDeploymentTrajectory._healthEventHeaders_(),
      healthEventRows);
    CoreDeploymentTrajectory._logWritePlan_(
      signal.mtpEventsSheetName,
      CoreDeploymentTrajectory._mtpEventHeaders_(),
      mtpEventRows);
    CoreDeploymentTrajectory._writeSheet_(
      ss,
      signal.mtpEventsSheetName,
      CoreDeploymentTrajectory._mtpEventHeaders_(),
      mtpEventRows);
    CoreDeploymentTrajectory._logWritePlan_(
      signal.actionHistoryIndexSheetName,
      CoreDeploymentTrajectory._actionIndexHeaders_(),
      actionIndexRows);
    CoreDeploymentTrajectory._writeSheet_(
      ss,
      signal.actionHistoryIndexSheetName,
      CoreDeploymentTrajectory._actionIndexHeaders_(),
      actionIndexRows);

    var summary = {
      activeDeploymentsProcessed: ctx.stats.activeDeploymentsProcessed,
      trajectoryRowsWritten: trajectoryRows.length,
      healthEventsWritten: healthEventRows.length,
      mtpEventsWritten: mtpEventRows.length,
      actionHistoryIndexRowsWritten: actionIndexRows.length,
      warningCount: ctx.stats.warningCount,
      skippedDeployments: ctx.stats.skippedDeployments,
      skippedReasons: ctx.stats.skippedReasons,
      trajectory_built_at: builtAt
    };

    if (ctx.stats && ctx.stats.scheduleDiagnostics) {
      summary.scheduleDiagnostics = ctx.stats.scheduleDiagnostics;
    }
    if (ctx.stats && ctx.stats.buildWarningAnalysis) {
      summary.buildWarningAnalysis = ctx.stats.buildWarningAnalysis;
    }

    Logger.log('CoreDeploymentTrajectory._runRefresh_: summary ' + JSON.stringify(summary));
    return summary;
  },

  /**
   * @param {AppConfig} cfg
   * @param {string|null} onlyDeploymentId
   * @return {Object}
   * @private
   */
  _buildContext_: function (cfg, onlyDeploymentId) {
    var signal = cfg.deploymentSignal || {};
    var schemaVersion = signal.schemaVersion != null ? signal.schemaVersion : 1;
    var todayStr = CoreDeploymentTrajectory._todayStr_();
    var tz = Session.getScriptTimeZone();

    var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
      cfg.salesforce.statusValues.active) || 'Active';

    var rawRows = CoreData.readSfdcDeploymentsRaw(cfg) || [];
    var historyMap = CoreHistory.getHistoryMap(cfg);
    var dhpMap = CoreData.getDeploymentHealthPlanMap(cfg) || {};
    var activeDepIds = CoreDeploymentTrajectory._collectActiveDeploymentIds_(
      rawRows, activeStatus, onlyDeploymentId);
    var productFunctionsRead = CoreDeploymentTrajectory._readProductFunctions_(cfg);
    var pfHistoryRead = CoreDeploymentTrajectory._readProductFunctionHistory_(cfg);
    var pfByDeployment = productFunctionsRead.byDeploymentId;
    var pfHistoryByParentId = pfHistoryRead.byParentId;
    var actionHistory = CoreDeploymentTrajectory._readActionHistory_(cfg);
    CoreDeploymentTrajectory._logActionHistoryDiagnostics_(
      cfg, activeDepIds, actionHistory, dhpMap);
    var actionByDhp = actionHistory.byDhpId;
    var dhpIdToDeployment = actionHistory.dhpIdToDeployment;

    var stats = {
      activeDeploymentsProcessed: 0,
      warningCount: 0,
      skippedDeployments: 0,
      skippedReasons: []
    };

    var deployments = [];
    var actionHistoryIndex = [];
    var seenIds = {};

    rawRows.forEach(function (row) {
      if (String(row.overallStatus || row.status || '').trim() !== activeStatus) return;

      var depId = CoreData.canonicalDeploymentId(row.deploymentId);
      if (!depId) {
        stats.skippedDeployments++;
        stats.skippedReasons.push({ deploymentId: '', reason: 'empty_id' });
        return;
      }
      if (onlyDeploymentId &&
          !CoreDeploymentTrajectory._idEquals_(depId, onlyDeploymentId)) {
        return;
      }
      if (seenIds[depId]) {
        stats.skippedDeployments++;
        stats.skippedReasons.push({ deploymentId: depId, reason: 'duplicate_active_row' });
        return;
      }
      seenIds[depId] = true;
      stats.activeDeploymentsProcessed++;

      var warnings = [];
      var historyParentId = depId;
      var events = (historyMap[historyParentId] && historyMap[historyParentId].events) || [];

      var healthFieldEvents = CoreDeploymentTrajectory._fieldEvents_(events, TrajectoryMetrics.HEALTH_FIELD, tz);
      var stageFieldEvents = CoreDeploymentTrajectory._fieldEvents_(events, TrajectoryMetrics.STAGE_FIELD, tz);
      var baselineMtp = CoreDeploymentTrajectory._resolveBaselineMtp_(row, events, tz, warnings);

      var healthMetrics = TrajectoryMetrics.computeHealthMetrics(
        healthFieldEvents, row.health || '', todayStr);
      var stageMetrics = TrajectoryMetrics.computeStageMetrics(
        stageFieldEvents, row.stage || '', todayStr);
      var currentMtp = CoreDeploymentTrajectory._normalizeDateCell_(row.mtpDate, tz, warnings, 'current_mtp');
      var parentTargetFromRow = CoreDeploymentTrajectory._normalizeDateCell_(
        row.firstMtpDate, tz, warnings, 'parent_target_row');

      var deploymentPfList = pfByDeployment[depId] ||
        pfByDeployment[depId.slice(0, 15)] || [];
      var scheduleNormalize = function (value, label) {
        if (label === 'parent_hist_at') {
          return CoreDeploymentTrajectory._isoToDateOnly_(value, tz);
        }
        return CoreDeploymentTrajectory._normalizeDateCell_(value, tz, warnings, label);
      };
      var scheduleBundle = TrajectorySchedule.buildForDeployment({
        deploymentId: depId,
        productFunctions: deploymentPfList,
        pfHistoryByPfId: pfHistoryByParentId,
        parentHistoryEvents: events,
        normalizeDate: scheduleNormalize,
        todayStr: todayStr,
        parentTargetFromRow: parentTargetFromRow,
        currentMtpReference: currentMtp,
        baselineMtp: baselineMtp
      });
      (scheduleBundle.warnings || []).forEach(function (w) { warnings.push(w); });

      var grain = scheduleBundle.grainInfo.mtp_analysis_grain;
      var parentMtp = scheduleBundle.parentSchedule.parentMtpMetrics || {};
      var mtpMetrics = {
        baseline_mtp: baselineMtp,
        earliest_recorded_mtp: '',
        previous_mtp: '',
        mtp_last_change_date: '',
        mtp_last_change_days: null,
        mtp_changes_30d: 0,
        mtp_changes_90d: 0,
        mtp_changes_total: 0,
        mtp_slips_90d: 0,
        mtp_accelerations_90d: 0,
        mtp_event_count: 0,
        mtp_net_movement_days: null,
        mtp_net_movement_comparison: '',
        mtp_gross_movement_days: 0,
        mtp_slip_days_90d: 0,
        days_until_current_mtp: null
      };
      if (grain === TrajectorySchedule.GRAIN_DEPLOYMENT ||
          grain === TrajectorySchedule.GRAIN_DEPLOYMENT_ONLY) {
        mtpMetrics = parentMtp;
        mtpMetrics.baseline_mtp = baselineMtp;
        if (currentMtp) {
          mtpMetrics.days_until_current_mtp =
            TrajectoryMetrics.signedDaysBetween(todayStr, currentMtp);
        }
      } else if (currentMtp) {
        mtpMetrics.days_until_current_mtp =
          TrajectoryMetrics.signedDaysBetween(todayStr, currentMtp);
      }

      var effectiveMtpReplay = [];
      try {
        effectiveMtpReplay = CoreHistory.getMTPDateHistory(cfg, historyParentId) || [];
      } catch (e) {
        warnings.push('effective_mtp_replay_failed');
      }

      var dhpAgg = dhpMap[depId] || dhpMap[depId.slice(0, 15)] || null;
      var dhpContext = CoreDeploymentTrajectory._dhpContext_(dhpAgg, todayStr, tz);

      var actionMeta = CoreDeploymentTrajectory._actionHistoryMeta_(
        dhpAgg, actionByDhp, todayStr, tz);
      (actionMeta.indexRows || []).forEach(function (idxRow) {
        idxRow.deployment_id = depId;
        actionHistoryIndex.push(idxRow);
      });

      var healthEventsOut = CoreDeploymentTrajectory._buildHealthEventRows_(
        depId, healthFieldEvents, healthMetrics);
      var mtpEventsOut = CoreDeploymentTrajectory._buildMtpEventRows_(
        depId, scheduleBundle.mtpEvents, grain);

      warnings.forEach(function () { stats.warningCount++; });

      var rowObj = {
        deployment_id: depId,
        deployment_name: row.deploymentName || '',
        customer_name: row.accountName || '',
        industry: row.industry || '',
        deployment_phase: row.phase || '',
        current_stage: row.stage || '',
        current_health: row.health || '',
        deployment_start_date: CoreDeploymentTrajectory._normalizeDateCell_(
          row.deploymentStartDate, tz, warnings, 'deployment_start_date'),
        current_mtp: currentMtp,
        actual_mtp: row.firstMtpDateActual || '',
        deployment_completion_date: CoreDeploymentTrajectory._normalizeDateCell_(
          row.completionDate, tz, warnings, 'completion_date'),
        priming_partner: row.primingPartner || '',
        implementation_partner: row.implPartner || '',

        previous_health: healthMetrics.previous_health,
        health_last_change_date: healthMetrics.health_last_change_date,
        days_at_current_health: healthMetrics.days_at_current_health,
        health_changes_30d: healthMetrics.health_changes_30d,
        health_changes_90d: healthMetrics.health_changes_90d,
        health_changes_total: healthMetrics.health_changes_total,
        health_deteriorations_90d: healthMetrics.health_deteriorations_90d,
        health_improvements_90d: healthMetrics.health_improvements_90d,
        health_event_count: healthMetrics.health_event_count,

        baseline_mtp: mtpMetrics.baseline_mtp,
        earliest_recorded_mtp: mtpMetrics.earliest_recorded_mtp,
        previous_mtp: mtpMetrics.previous_mtp,
        mtp_last_change_date: mtpMetrics.mtp_last_change_date,
        mtp_last_change_days: mtpMetrics.mtp_last_change_days,
        mtp_changes_30d: mtpMetrics.mtp_changes_30d,
        mtp_changes_90d: mtpMetrics.mtp_changes_90d,
        mtp_changes_total: mtpMetrics.mtp_changes_total,
        mtp_slips_90d: mtpMetrics.mtp_slips_90d,
        mtp_accelerations_90d: mtpMetrics.mtp_accelerations_90d,
        mtp_event_count: mtpMetrics.mtp_event_count,
        mtp_net_movement_days: mtpMetrics.mtp_net_movement_days,
        mtp_net_movement_comparison: mtpMetrics.mtp_net_movement_comparison,
        mtp_gross_movement_days: mtpMetrics.mtp_gross_movement_days,
        mtp_slip_days_90d: mtpMetrics.mtp_slip_days_90d,
        days_until_current_mtp: mtpMetrics.days_until_current_mtp,

        previous_stage: stageMetrics.previous_stage,
        stage_last_change_date: stageMetrics.stage_last_change_date,
        days_in_current_stage: stageMetrics.days_in_current_stage,
        stage_changes_30d: stageMetrics.stage_changes_30d,
        stage_changes_90d: stageMetrics.stage_changes_90d,
        stage_changes_total: stageMetrics.stage_changes_total,

        has_open_health_plan: dhpContext.has_open_health_plan,
        dhp_count: dhpContext.dhp_count,
        dhp_ids: dhpContext.dhp_ids,
        dhp_plan_owners: dhpContext.dhp_plan_owners,
        dhp_issue_categories: dhpContext.dhp_issue_categories,
        dhp_latest_updated_date: dhpContext.dhp_latest_updated_date,
        days_since_dhp_update: dhpContext.days_since_dhp_update,

        action_history_record_count: actionMeta.action_history_record_count,
        action_history_latest_created_date: actionMeta.action_history_latest_created_date,
        days_since_action_history_update: actionMeta.days_since_action_history_update,
        action_history_latest_health_status: actionMeta.action_history_latest_health_status,
        action_history_ids: actionMeta.action_history_ids,

        history_parent_id: historyParentId,
        trajectory_schema_version: schemaVersion,
        trajectory_built_at: '',
        build_warnings: warnings.join('; '),
        mtp_analysis_grain: grain,
        product_function_count: scheduleBundle.grainInfo.product_function_count,
        product_function_with_mtp_count: scheduleBundle.grainInfo.product_function_with_mtp_count,
        product_function_without_mtp_count: scheduleBundle.grainInfo.product_function_without_mtp_count,
        distinct_current_function_mtp_count: scheduleBundle.grainInfo.distinct_current_function_mtp_count,
        distinct_current_function_mtps: scheduleBundle.grainInfo.distinct_current_function_mtps,
        functions_actual_mtp_count: scheduleBundle.pfRollups.functions_actual_mtp_count || '',
        functions_remaining_count: scheduleBundle.pfRollups.functions_remaining_count || '',
        remaining_earliest_target_mtp: scheduleBundle.pfRollups.remaining_earliest_target_mtp || '',
        remaining_latest_target_mtp: scheduleBundle.pfRollups.remaining_latest_target_mtp || '',
        functions_with_target_changes_30d: scheduleBundle.pfRollups.functions_with_target_changes_30d || '',
        functions_with_target_changes_90d: scheduleBundle.pfRollups.functions_with_target_changes_90d || '',
        functions_with_target_slips_90d: scheduleBundle.pfRollups.functions_with_target_slips_90d || '',
        function_target_changes_30d: scheduleBundle.pfRollups.function_target_changes_30d || '',
        function_target_changes_90d: scheduleBundle.pfRollups.function_target_changes_90d || '',
        function_target_slips_90d: scheduleBundle.pfRollups.function_target_slips_90d || '',
        function_target_accelerations_90d: scheduleBundle.pfRollups.function_target_accelerations_90d || '',
        function_target_slip_days_90d: scheduleBundle.pfRollups.function_target_slip_days_90d || '',
        function_target_gross_movement_days_90d:
          scheduleBundle.pfRollups.function_target_gross_movement_days_90d || '',
        most_recent_function_target_change_date:
          scheduleBundle.pfRollups.most_recent_function_target_change_date || '',
        functions_late_vs_final_target_count:
          scheduleBundle.pfRollups.functions_late_vs_final_target_count || '',
        functions_on_or_before_final_target_count:
          scheduleBundle.pfRollups.functions_on_or_before_final_target_count || '',
        function_schedule_event_count: scheduleBundle.pfRollups.function_schedule_event_count || '',
        reconstructed_parent_effective_mtp:
          scheduleBundle.parentSchedule.reconstructed_parent_effective_mtp || '',
        parent_mtp_reconciliation_status: scheduleBundle.reconciliationStatus || '',
        source_health_event_count: healthFieldEvents.length,
        source_mtp_event_count: (scheduleBundle.mtpEvents || []).length,
        source_action_history_count: actionMeta.action_history_record_count,
        effective_mtp_replay_point_count: effectiveMtpReplay.length
      };

      deployments.push({
        skipped: false,
        row: rowObj,
        healthEvents: healthEventsOut,
        mtpEvents: mtpEventsOut,
        debug: onlyDeploymentId ? {
          rawDeployment: row,
          healthFieldEvents: healthFieldEvents,
          scheduleBundle: scheduleBundle,
          stageFieldEvents: stageFieldEvents,
          effectiveMtpReplay: effectiveMtpReplay,
          dhpAgg: dhpAgg,
          actionMeta: actionMeta
        } : null
      });
    });

    var scheduleDiagnostics = CoreDeploymentTrajectory._buildScheduleDiagnostics_(
      deployments, productFunctionsRead, pfHistoryRead);
    CoreDeploymentTrajectory._logScheduleDiagnostics_(scheduleDiagnostics);
    stats.scheduleDiagnostics = scheduleDiagnostics;

    var buildWarningAnalysis = CoreDeploymentTrajectory._analyzeBuildWarnings_(deployments);
    CoreDeploymentTrajectory._logBuildWarningAnalysis_(buildWarningAnalysis);
    stats.buildWarningAnalysis = buildWarningAnalysis;

    return {
      deployments: deployments,
      actionHistoryIndex: actionHistoryIndex,
      stats: stats,
      summary: {
        active: stats.activeDeploymentsProcessed,
        warnings: stats.warningCount,
        skipped: stats.skippedDeployments,
        scheduleDiagnostics: scheduleDiagnostics,
        buildWarningAnalysis: buildWarningAnalysis
      }
    };
  },

  /**
   * @param {Array} events
   * @param {string} fieldName
   * @param {string} tz
   * @return {Array<{atDate:string, old:string, new:string}>}
   * @private
   */
  _fieldEvents_: function (events, fieldName, tz) {
    var out = [];
    (events || []).forEach(function (ev) {
      if (ev.field !== fieldName) return;
      var atDate = CoreDeploymentTrajectory._isoToDateOnly_(ev.at, tz);
      if (!atDate) return;
      out.push({
        atDate: atDate,
        old: String(ev.old || ''),
        new: String(ev['new'] || '')
      });
    });
    out.sort(function (a, b) {
      return a.atDate < b.atDate ? -1 : (a.atDate > b.atDate ? 1 : 0);
    });
    return out;
  },

  /**
   * @param {Array} events
   * @param {string} tz
   * @return {Array<Object>}
   * @private
   */
  _mtpCurrentFieldEvents_: function (events, tz) {
    var out = [];
    (events || []).forEach(function (ev) {
      if (ev.field !== TrajectoryMetrics.MTP_FIELD) return;
      var atDate = CoreDeploymentTrajectory._isoToDateOnly_(ev.at, tz);
      if (!atDate) return;
      var oldDate = CoreDeploymentTrajectory._normalizeDateCell_(ev.old, tz, null, 'mtp_old');
      var newDate = CoreDeploymentTrajectory._normalizeDateCell_(ev['new'], tz, null, 'mtp_new');
      var movement = null;
      if (oldDate && newDate) {
        movement = TrajectoryMetrics.signedDaysBetween(oldDate, newDate);
      }
      out.push({
        atDate: atDate,
        oldDate: oldDate,
        newDate: newDate,
        movementDays: movement,
        field: TrajectoryMetrics.MTP_FIELD,
        eventType: movement === null ? 'invalid' :
          (movement > 0 ? 'later' : (movement < 0 ? 'earlier' : 'unchanged'))
      });
    });
    out.sort(function (a, b) {
      return a.atDate < b.atDate ? -1 : (a.atDate > b.atDate ? 1 : 0);
    });
    return out;
  },

  /**
   * @param {Object} row
   * @param {Array} events
   * @param {string} tz
   * @param {Array<string>} warnings
   * @return {string}
   * @private
   */
  _resolveBaselineMtp_: function (row, events, tz, warnings) {
    var fromHistory = '';
    (events || []).forEach(function (ev) {
      if (ev.field !== TrajectorySchedule.PARENT_BASELINE_FIELD &&
          ev.field !== TrajectoryMetrics.BASELINE_MTP_FIELD) return;
      var d = CoreDeploymentTrajectory._normalizeDateCell_(ev['new'], tz, warnings, 'baseline_hist');
      if (d) fromHistory = d;
    });
    return fromHistory || '';
  },

  /**
   * @param {Object|null} dhpAgg
   * @param {string} todayStr
   * @param {string} tz
   * @return {Object}
   * @private
   */
  _dhpContext_: function (dhpAgg, todayStr, tz) {
    if (!dhpAgg || !dhpAgg.hasHealthPlan) {
      return {
        has_open_health_plan: false,
        dhp_count: 0,
        dhp_ids: '',
        dhp_plan_owners: '',
        dhp_issue_categories: '',
        dhp_latest_updated_date: '',
        days_since_dhp_update: ''
      };
    }
    var latest = dhpAgg.latestUpdated || '';
    var daysSince = '';
    if (latest) {
      var parsed = CoreDeploymentTrajectory._normalizeDateCell_(latest, tz, null, 'dhp_update');
      if (parsed) {
        var d = TrajectoryMetrics.signedDaysBetween(parsed, todayStr);
        daysSince = d !== null ? d : '';
      }
    }
    return {
      has_open_health_plan: true,
      dhp_count: dhpAgg.dhpCount || 0,
      dhp_ids: (dhpAgg.dhpIds || []).join(';'),
      dhp_plan_owners: (dhpAgg.planOwners || []).join(';'),
      dhp_issue_categories: (dhpAgg.issueCategories || []).join(';'),
      dhp_latest_updated_date: latest,
      days_since_dhp_update: daysSince
    };
  },

  /**
   * @param {Object|null} dhpAgg
   * @param {Object} actionByDhp
   * @param {string} todayStr
   * @param {string} tz
   * @return {Object}
   * @private
   */
  _actionHistoryMeta_: function (dhpAgg, actionByDhp, todayStr, tz) {
    var records = [];
    var dhpIds = (dhpAgg && dhpAgg.dhpIds) ? dhpAgg.dhpIds : [];
    dhpIds.forEach(function (dhpId) {
      var list = actionByDhp[dhpId] || [];
      records = records.concat(list);
    });

    records.sort(function (a, b) {
      return (a.created_date || '') < (b.created_date || '') ? -1 :
        ((a.created_date || '') > (b.created_date || '') ? 1 : 0);
    });

    var latest = records.length ? records[records.length - 1] : null;
    var daysSince = '';
    if (latest && latest.created_date) {
      var d = TrajectoryMetrics.signedDaysBetween(latest.created_date, todayStr);
      daysSince = d !== null ? d : '';
    }

    var indexRows = records.map(function (rec) {
      return {
        deployment_id: '',
        dhp_id: rec.dhp_id,
        action_history_id: rec.action_history_id,
        created_date: rec.created_date,
        health_status: rec.health_status
      };
    });

    return {
      action_history_record_count: records.length,
      action_history_latest_created_date: latest ? latest.created_date : '',
      days_since_action_history_update: daysSince,
      action_history_latest_health_status: latest ? latest.health_status : '',
      action_history_ids: records.map(function (r) { return r.action_history_id; }).join(';'),
      indexRows: indexRows
    };
  },

  /**
   * Config-driven reader for SFDC_DeploymentProductFunctions (trajectory v2).
   * @param {AppConfig} cfg
   * @return {{rows: Array, byDeploymentId: Object, readMeta: Object}}
   * @private
   */
  _readProductFunctions_: function (cfg) {
    var signal = cfg.deploymentSignal || {};
    var sheetName = signal.productFunctionsSheetName ||
      (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
      'SFDC_DeploymentProductFunctions';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    var empty = { rows: [], byDeploymentId: {}, readMeta: {
      sheetName: sheetName,
      sheetFound: !!sheet,
      rawDataRows: 0
    }};
    var tz = Session.getScriptTimeZone();

    if (!sheet || sheet.getLastRow() < 2) {
      CoreDeploymentTrajectory._logProductFunctionIngestDiagnostics_(empty.readMeta);
      return empty;
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var parsed = TrajectorySchedule.parseProductFunctionSheetValues(values, {
      parseRelationshipId: function (raw) {
        return CoreData.parseSalesforceRelationshipId(raw);
      },
      canonicalId: function (id) {
        return CoreData.canonicalDeploymentId(id);
      },
      normalizeDate: function (raw, label) {
        return CoreDeploymentTrajectory._normalizeDateCell_(raw, tz, null, label);
      }
    });

    parsed.readMeta.sheetName = sheetName;
    parsed.readMeta.sheetFound = true;
    parsed.readMeta.sheetLastRow = lastRow;
    parsed.readMeta.sheetLastColumn = lastCol;
    CoreDeploymentTrajectory._logProductFunctionIngestDiagnostics_(parsed.readMeta);

    return {
      rows: parsed.rows,
      byDeploymentId: parsed.byDeploymentId,
      readMeta: parsed.readMeta
    };
  },

  /**
   * Logs Product Function ingest diagnostics (structural only — no customer narrative).
   * @param {Object} readMeta
   * @private
   */
  _logProductFunctionIngestDiagnostics_: function (readMeta) {
    Logger.log('CoreDeploymentTrajectory._logProductFunctionIngestDiagnostics_: ' +
      JSON.stringify({
        sheetName: readMeta.sheetName,
        sheetFound: readMeta.sheetFound,
        sheetLastRow: readMeta.sheetLastRow,
        sheetLastColumn: readMeta.sheetLastColumn,
        headerRow: readMeta.headerRow,
        columnIndices: readMeta.columnIndices,
        rawDataRows: readMeta.rawDataRows,
        rowsWithNonblankId: readMeta.rowsWithNonblankId,
        rowsWithNonblankDeployment: readMeta.rowsWithNonblankDeployment,
        rowsWithValidId: readMeta.rowsWithValidId,
        rowsWithValidDeploymentId: readMeta.rowsWithValidDeploymentId,
        rowCount: readMeta.rowCount,
        uniqueProductFunctionIds: readMeta.uniqueProductFunctionIds,
        rejectionCounts: readMeta.rejectionCounts,
        structuralSamples: readMeta.structuralSamples
      }));
  },

  /**
   * Config-driven reader for SFDC_DeploymentProductFunctionHistory (trajectory v2).
   * @param {AppConfig} cfg
   * @return {{rows: Array, byParentId: Object, readMeta: Object}}
   * @private
   */
  _readProductFunctionHistory_: function (cfg) {
    var signal = cfg.deploymentSignal || {};
    var sheetName = signal.productFunctionHistorySheetName ||
      'SFDC_DeploymentProductFunctionHistory';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    var rows = [];
    var byParentId = {};
    var readMeta = {
      sheetName: sheetName,
      sheetFound: !!sheet,
      rawDataRows: 0,
      matchedToProductFunction: 0,
      unresolvedParent: 0
    };
    var tz = Session.getScriptTimeZone();

    if (!sheet || sheet.getLastRow() < 2) {
      return { rows: rows, byParentId: byParentId, readMeta: readMeta };
    }

    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var headers = values[0].map(function (h) { return String(h || '').trim(); });
    var lower = headers.map(function (h) { return h.toLowerCase(); });
    readMeta.rawDataRows = values.length - 1;

    function colExact_(name) {
      var t = name.toLowerCase();
      for (var i = 0; i < lower.length; i++) {
        if (lower[i] === t) return i;
      }
      return -1;
    }

    var colParent = colExact_('ParentId');
    var colField = colExact_('Field');
    var colOld = colExact_('OldValue');
    var colNew = colExact_('NewValue');
    var colCreated = colExact_('CreatedDate');

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var parentId = CoreData.canonicalDeploymentId(
        CoreData.parseSalesforceRelationshipId(colParent >= 0 ? row[colParent] : ''));
      var field = colField >= 0 ? String(row[colField] || '').trim() : '';
      if (!parentId || !field) continue;
      if (field !== TrajectorySchedule.PF_TARGET_FIELD &&
          field !== TrajectorySchedule.PF_ACTUAL_FIELD) {
        continue;
      }
      var created = colCreated >= 0 ?
        CoreDeploymentTrajectory._isoToDateOnly_(row[colCreated], tz) : '';
      if (!created && colCreated >= 0) {
        created = CoreDeploymentTrajectory._normalizeDateCell_(row[colCreated], tz, null, 'pf_hist');
      }
      var rec = {
        parentId: parentId,
        field: field,
        oldValue: colOld >= 0 ? row[colOld] : '',
        newValue: colNew >= 0 ? row[colNew] : '',
        createdDate: created
      };
      rows.push(rec);
      if (!byParentId[parentId]) byParentId[parentId] = [];
      byParentId[parentId].push(rec);
      if (parentId.length >= 15) {
        var shortId = parentId.slice(0, 15);
        if (!byParentId[shortId]) byParentId[shortId] = byParentId[parentId];
      }
    }

    readMeta.rowCount = rows.length;
    return { rows: rows, byParentId: byParentId, readMeta: readMeta };
  },

  /**
   * @param {AppConfig} cfg
   * @return {{byDhpId: Object, dhpIdToDeployment: Object, rows: Array}}
   * @private
   */
  _readActionHistory_: function (cfg) {
    var signal = cfg.deploymentSignal || {};
    var sheetName = signal.actionHistorySheetName || 'SFDC_HealthPlanActionHistory';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    var byDhpId = {};
    var dhpIdToDeployment = {};
    var rows = [];
    var readMeta = {
      sheetName: sheetName,
      sheetFound: !!sheet,
      rawDataRows: 0,
      headerRow: [],
      columnIndices: {},
      rowsWithDhpId: 0
    };

    if (!sheet || sheet.getLastRow() < 2) {
      return {
        byDhpId: byDhpId,
        dhpIdToDeployment: dhpIdToDeployment,
        rows: rows,
        readMeta: readMeta
      };
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function (h) { return String(h || '').trim(); });
    var lower = headers.map(function (h) { return h.toLowerCase(); });
    readMeta.headerRow = headers.slice();
    readMeta.rawDataRows = values.length - 1;

    function colExact_(name) {
      var t = name.toLowerCase();
      for (var i = 0; i < lower.length; i++) {
        if (lower[i] === t) return i;
      }
      return -1;
    }

    var colId = colExact_('Id');
    var colDhp = colExact_('Deployment_Health_Plan__c');
    var colDhpName = colExact_('Deployment_Health_Plan__r.Name');
    var colDhpUpdate = colExact_('Deployment_Health_Plan_Update__c');
    var colHealth = colExact_('Health_Status__c');
    var colCreated = colExact_('CreatedDate');
    readMeta.columnIndices = {
      Id: colId,
      Deployment_Health_Plan__c: colDhp,
      'Deployment_Health_Plan__r.Name': colDhpName,
      Deployment_Health_Plan_Update__c: colDhpUpdate,
      Health_Status__c: colHealth,
      CreatedDate: colCreated
    };
    var tz = Session.getScriptTimeZone();

    var dhpMap = CoreData.getDeploymentHealthPlanMap(cfg) || {};

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var dhpId = CoreData.parseSalesforceRelationshipId(
        colDhp >= 0 ? row[colDhp] : '');
      if (!dhpId) continue;
      readMeta.rowsWithDhpId++;
      var created = colCreated >= 0 ?
        CoreDeploymentTrajectory._normalizeDateCell_(row[colCreated], tz, null, 'ah_created') :
        '';
      if (!created && colCreated >= 0) {
        created = CoreDeploymentTrajectory._isoToDateOnly_(row[colCreated], tz);
      }
      var rec = {
        action_history_id: colId >= 0 ? String(row[colId] || '').trim() : '',
        dhp_id: dhpId,
        created_date: created,
        health_status: colHealth >= 0 ? String(row[colHealth] || '').trim() : ''
      };
      rows.push(rec);
      if (!byDhpId[dhpId]) byDhpId[dhpId] = [];
      byDhpId[dhpId].push(rec);
    }

    Object.keys(dhpMap).forEach(function (depKey) {
      var agg = dhpMap[depKey];
      if (!agg || !agg.dhpIds) return;
      agg.dhpIds.forEach(function (id) {
        dhpIdToDeployment[id] = agg.deploymentId || depKey;
      });
    });

    return {
      byDhpId: byDhpId,
      dhpIdToDeployment: dhpIdToDeployment,
      rows: rows,
      readMeta: readMeta
    };
  },

  /**
   * Active deployment ids for diagnostics (same grain as trajectory build).
   * @param {Array<Object>} rawRows
   * @param {string} activeStatus
   * @param {string|null} onlyDeploymentId
   * @return {Array<string>}
   * @private
   */
  _collectActiveDeploymentIds_: function (rawRows, activeStatus, onlyDeploymentId) {
    var seen = {};
    var out = [];
    (rawRows || []).forEach(function (row) {
      if (String(row.overallStatus || row.status || '').trim() !== activeStatus) return;
      var depId = CoreData.canonicalDeploymentId(row.deploymentId);
      if (!depId || seen[depId]) return;
      if (onlyDeploymentId &&
          !CoreDeploymentTrajectory._idEquals_(depId, onlyDeploymentId)) {
        return;
      }
      seen[depId] = true;
      out.push(depId);
    });
    return out;
  },

  /**
   * Logs MTP history source resolution (SFDC_DeploymentHistory via historyMap).
   * @param {Object} historyMap
   * @param {Array<string>} activeDepIds
   * @param {string} tz
   * @private
   */
  /**
   * True when a deployment-history Field name is MTP-related (aligned with CoreHistory replay).
   * @param {string} field
   * @return {boolean}
   * @private
   */
  _isMtpRelatedHistoryField_: function (field) {
    var f = String(field || '').toLowerCase();
    if (!f) return false;
    return f.indexOf('mtp') !== -1 ||
      f.indexOf('move_to_production') !== -1 ||
      f.indexOf('oemb') !== -1 ||
      f.indexOf('target_project_completion') !== -1 ||
      f.indexOf('current_mtp') !== -1;
  },

  /**
   * Portfolio-level MTP source model for trajectory v1 field choice.
   * @param {Object} historyMap
   * @param {Array<string>} activeDepIds
   * @param {Array<Object>} deployments
   * @param {string} tz
   * @return {Object}
   * @private
   */
  _analyzeMtpModel_: function (historyMap, activeDepIds, deployments, tz) {
    var mtpField = TrajectoryMetrics.MTP_FIELD;
    var activeSet = CoreDeploymentTrajectory._activeIdLookup_(activeDepIds);
    var fieldCounts = {};
    var mtpRelatedFieldCounts = {};
    var mtpRelatedActiveParents = {};

    Object.keys(historyMap || {}).forEach(function (parentId) {
      var onActive = CoreDeploymentTrajectory._idInActiveSet_(parentId, activeSet);
      (historyMap[parentId].events || []).forEach(function (ev) {
        var field = String(ev.field || '').trim();
        if (!field) return;
        fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        if (!CoreDeploymentTrajectory._isMtpRelatedHistoryField_(field)) return;
        mtpRelatedFieldCounts[field] = (mtpRelatedFieldCounts[field] || 0) + 1;
        if (onActive) {
          mtpRelatedActiveParents[field] = mtpRelatedActiveParents[field] || {};
          mtpRelatedActiveParents[field][parentId] = true;
        }
      });
    });

    var withCurrentMtpOnRow = 0;
    var withSourceMtpEvents = 0;
    var withEffectiveReplay = 0;
    var withMtpRelatedHistory = 0;
    var withTrajectoryMtpFieldHistory = 0;

    (deployments || []).forEach(function (item) {
      if (item.skipped || !item.row) return;
      if (item.row.current_mtp) withCurrentMtpOnRow++;
      if ((item.row.source_mtp_event_count || 0) > 0) withSourceMtpEvents++;
      if ((item.row.effective_mtp_replay_point_count || 0) > 0) withEffectiveReplay++;
      var depId = item.row.deployment_id;
      var events = (historyMap[depId] && historyMap[depId].events) || [];
      if (!events.length && depId.length >= 15) {
        events = (historyMap[depId.slice(0, 15)] && historyMap[depId.slice(0, 15)].events) || [];
      }
      var hasMtpRelated = false;
      var hasTrajectoryField = false;
      (events || []).forEach(function (ev) {
        if (CoreDeploymentTrajectory._isMtpRelatedHistoryField_(ev.field)) hasMtpRelated = true;
        if (ev.field === mtpField) hasTrajectoryField = true;
      });
      if (hasMtpRelated) withMtpRelatedHistory++;
      if (hasTrajectoryField) withTrajectoryMtpFieldHistory++;
    });

    var candidateFields = Object.keys(mtpRelatedFieldCounts).sort(function (a, b) {
      return (mtpRelatedFieldCounts[b] || 0) - (mtpRelatedFieldCounts[a] || 0);
    });
    var recommendedField = '';
    if ((mtpRelatedFieldCounts[mtpField] || 0) > 0) {
      recommendedField = mtpField;
    } else if (candidateFields.length) {
      recommendedField = candidateFields[0];
    }

    var activeParentCounts = {};
    Object.keys(mtpRelatedActiveParents).forEach(function (field) {
      activeParentCounts[field] = Object.keys(mtpRelatedActiveParents[field]).length;
    });

    return {
      trajectoryMtpField: mtpField,
      historyFieldCounts: fieldCounts,
      mtpRelatedFieldCounts: mtpRelatedFieldCounts,
      mtpRelatedActiveParentCounts: activeParentCounts,
      activeDeploymentCount: (activeDepIds || []).length,
      activeWithCurrentMtpOnDeploymentsRow: withCurrentMtpOnRow,
      activeWithSourceMtpEventCountGt0: withSourceMtpEvents,
      activeWithEffectiveMtpReplayGt0: withEffectiveReplay,
      activeWithAnyMtpRelatedHistory: withMtpRelatedHistory,
      activeWithCurrentMtpDateHistoryField: withTrajectoryMtpFieldHistory,
      recommendedHistoryFieldForMtpEvents: recommendedField,
      currentMtpFieldEventCount: mtpRelatedFieldCounts[mtpField] || 0,
      targetProjectCompletionEventCount:
        mtpRelatedFieldCounts['Target_Project_Completion_Date__c'] || 0
    };
  },

  /**
   * @param {Object} mtpModel
   * @private
   */
  _logMtpModelDiscovery_: function (mtpModel) {
    var logPrefix = 'CoreDeploymentTrajectory._logMtpModelDiscovery_:';
    Logger.log(logPrefix + ' ' + JSON.stringify(mtpModel));
    if (!mtpModel.currentMtpFieldEventCount &&
        mtpModel.targetProjectCompletionEventCount > 0) {
      Logger.log(logPrefix + ' CONCLUSION trajectory listens on ' + mtpModel.trajectoryMtpField +
        ' but history is populated on Target_Project_Completion_Date__c — expect mtpEvents=0' +
        ' until field mapping changes (metrics unchanged).');
    } else if (!mtpModel.currentMtpFieldEventCount && !mtpModel.targetProjectCompletionEventCount) {
      Logger.log(logPrefix + ' CONCLUSION no Current_MTP or Target_Project_Completion events' +
        ' in history; check mtpRelatedFieldCounts for alternate MTP drivers.');
    }
  },

  /**
   * @param {Array<Object>} deployments
   * @return {Object}
   * @private
   */
  _analyzeBuildWarnings_: function (deployments) {
    var warningCounts = {};
    var deploymentsWithWarnings = 0;
    var deploymentsWithAnyWarningText = 0;
    var totalWarnings = 0;
    var sourceMtpZero = 0;
    var sourceMtpPositive = 0;
    var netMovementMissingComparison = 0;
    var effectiveReplayFailed = 0;

    (deployments || []).forEach(function (item) {
      if (item.skipped || !item.row) return;
      var srcMtp = item.row.source_mtp_event_count || 0;
      if (srcMtp > 0) sourceMtpPositive++;
      else sourceMtpZero++;

      var text = String(item.row.build_warnings || '').trim();
      if (text) {
        deploymentsWithAnyWarningText++;
        text.split(';').forEach(function (part) {
          var token = String(part || '').trim();
          if (!token) return;
          totalWarnings++;
          warningCounts[token] = (warningCounts[token] || 0) + 1;
          if (token === 'mtp_net_movement_missing_comparison_point') {
            netMovementMissingComparison++;
          }
          if (token === 'effective_mtp_replay_failed') {
            effectiveReplayFailed++;
          }
        });
      }
      if ((item.row.build_warnings || '').length) deploymentsWithWarnings++;
    });

    var topWarnings = Object.keys(warningCounts).sort(function (a, b) {
      return warningCounts[b] - warningCounts[a];
    }).slice(0, 15).map(function (key) {
      return { warning: key, count: warningCounts[key] };
    });

    return {
      deploymentCount: (deployments || []).filter(function (d) { return !d.skipped; }).length,
      deploymentsWithBuildWarnings: deploymentsWithAnyWarningText,
      totalWarningTokens: totalWarnings,
      sourceMtpEventCountZero: sourceMtpZero,
      sourceMtpEventCountPositive: sourceMtpPositive,
      mtpNetMovementMissingComparison: netMovementMissingComparison,
      effectiveMtpReplayFailed: effectiveReplayFailed,
      topWarnings: topWarnings,
      allWarningCounts: warningCounts
    };
  },

  /**
   * @param {Object} analysis
   * @private
   */
  /**
   * @param {Array<Object>} deployments
   * @param {Object} pfRead
   * @param {Object} pfHistRead
   * @return {Object}
   * @private
   */
  _buildScheduleDiagnostics_: function (deployments, pfRead, pfHistRead) {
    var grainCounts = {
      DEPLOYMENT: 0,
      PRODUCT_FUNCTION: 0,
      DEPLOYMENT_ONLY: 0
    };
    var eventTypeCounts = {};
    var reconCounts = {};
    var pfWithoutMtp = 0;
    var pfIdSet = {};

    (pfRead.rows || []).forEach(function (pf) {
      pfIdSet[pf.id] = true;
      if (pf.id && pf.id.length >= 15) pfIdSet[pf.id.slice(0, 15)] = true;
      if (!TrajectorySchedule.functionEffectiveMtp(pf)) pfWithoutMtp++;
    });

    var histMatched = 0;
    var histUnresolved = 0;
    (pfHistRead.rows || []).forEach(function (h) {
      if (pfIdSet[h.parentId] ||
          (h.parentId && h.parentId.length >= 15 && pfIdSet[h.parentId.slice(0, 15)])) {
        histMatched++;
      } else {
        histUnresolved++;
      }
    });

    var pfMatchedActive = 0;
    (deployments || []).forEach(function (item) {
      if (item.skipped || !item.row) return;
      var grain = item.row.mtp_analysis_grain;
      if (grainCounts[grain] !== undefined) grainCounts[grain]++;
      var recon = item.row.parent_mtp_reconciliation_status;
      if (recon) reconCounts[recon] = (reconCounts[recon] || 0) + 1;
      pfMatchedActive += item.row.product_function_count || 0;
      (item.mtpEvents || []).forEach(function (ev) {
        var t = ev.event_type || '';
        if (t) eventTypeCounts[t] = (eventTypeCounts[t] || 0) + 1;
      });
    });

    var uniquePfIds = {};
    (pfRead.rows || []).forEach(function (pf) {
      if (pf.id) uniquePfIds[pf.id] = true;
    });

    return {
      productFunctionSourceRowsRead: (pfRead.readMeta && pfRead.readMeta.rawDataRows) || 0,
      productFunctionRowsParsed: (pfRead.rows || []).length,
      uniqueProductFunctionIds: Object.keys(uniquePfIds).length,
      productFunctionIngestRejectionCounts: (pfRead.readMeta && pfRead.readMeta.rejectionCounts) || {},
      productFunctionColumnIndices: (pfRead.readMeta && pfRead.readMeta.columnIndices) || {},
      productFunctionHistorySourceRowsRead: (pfHistRead.readMeta && pfHistRead.readMeta.rawDataRows) || 0,
      productFunctionHistoryRowsParsed: (pfHistRead.rows || []).length,
      productFunctionHistoryRowsMatchedToProductFunctions: histMatched,
      productFunctionHistoryParentUnresolved: histUnresolved,
      productFunctionsMatchedToActiveDeployments: pfMatchedActive,
      productFunctionsWithoutMtpCount: pfWithoutMtp,
      mtpAnalysisGrainCounts: grainCounts,
      mtpEventCountByType: eventTypeCounts,
      parentMtpReconciliationCounts: reconCounts
    };
  },

  /**
   * @param {Object} diagnostics
   * @private
   */
  _logScheduleDiagnostics_: function (diagnostics) {
    Logger.log('CoreDeploymentTrajectory._logScheduleDiagnostics_: ' +
      JSON.stringify(diagnostics));
  },

  _logBuildWarningAnalysis_: function (analysis) {
    Logger.log('CoreDeploymentTrajectory._logBuildWarningAnalysis_: ' + JSON.stringify({
      deploymentCount: analysis.deploymentCount,
      deploymentsWithBuildWarnings: analysis.deploymentsWithBuildWarnings,
      totalWarningTokens: analysis.totalWarningTokens,
      sourceMtpEventCountZero: analysis.sourceMtpEventCountZero,
      sourceMtpEventCountPositive: analysis.sourceMtpEventCountPositive,
      mtpNetMovementMissingComparison: analysis.mtpNetMovementMissingComparison,
      effectiveMtpReplayFailed: analysis.effectiveMtpReplayFailed,
      topWarnings: analysis.topWarnings
    }));
  },

  _logMtpSourceDiagnostics_: function (historyMap, activeDepIds, tz) {
    var logPrefix = 'CoreDeploymentTrajectory._logMtpSourceDiagnostics_:';
    var mtpField = TrajectoryMetrics.MTP_FIELD;
    var fieldCounts = {};
    var mtpParentIds = {};
    var mtpRawEventCount = 0;

    Object.keys(historyMap || {}).forEach(function (parentId) {
      var entry = historyMap[parentId];
      (entry && entry.events || []).forEach(function (ev) {
        var field = String(ev.field || '').trim();
        if (field) fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        if (field === mtpField) {
          mtpRawEventCount++;
          mtpParentIds[parentId] = true;
        }
      });
    });

    var activeSet = CoreDeploymentTrajectory._activeIdLookup_(activeDepIds);
    var mtpParentsActive = 0;
    Object.keys(mtpParentIds).forEach(function (pid) {
      if (CoreDeploymentTrajectory._idInActiveSet_(pid, activeSet)) mtpParentsActive++;
    });

    var mtpAfterProcess = 0;
    (activeDepIds || []).forEach(function (depId) {
      var events = (historyMap[depId] && historyMap[depId].events) || [];
      if (!events.length && depId.length >= 15) {
        events = (historyMap[depId.slice(0, 15)] && historyMap[depId.slice(0, 15)].events) || [];
      }
      mtpAfterProcess += CoreDeploymentTrajectory._mtpCurrentFieldEvents_(events, tz).length;
    });

    Logger.log(logPrefix + ' fieldValueCounts=' + JSON.stringify(fieldCounts));
    Logger.log(logPrefix + ' currentMtpField=' + mtpField +
      ' rawEventCount=' + mtpRawEventCount +
      ' distinctParentIds=' + Object.keys(mtpParentIds).length +
      ' parentIdsMatchingActive=' + mtpParentsActive +
      ' activeDeploymentCount=' + (activeDepIds || []).length +
      ' mtpEventsAfterMtpCurrentFieldEvents=' + mtpAfterProcess +
      ' targetProjectCompletionEventCount=' +
      (fieldCounts['Target_Project_Completion_Date__c'] || 0));

    var samplesLogged = 0;
    (activeDepIds || []).some(function (depId) {
      if (samplesLogged >= 3) return true;
      var events = (historyMap[depId] && historyMap[depId].events) || [];
      if (!events.length && depId.length >= 15) {
        events = (historyMap[depId.slice(0, 15)] && historyMap[depId.slice(0, 15)].events) || [];
      }
      var rawMtp = (events || []).filter(function (ev) {
        return ev.field === mtpField;
      });
      if (!rawMtp.length) return false;
      var processed = CoreDeploymentTrajectory._mtpCurrentFieldEvents_(events, tz);
      Logger.log(logPrefix + ' sample deploymentId=' + depId +
        ' rawCurrentMtpRows=' + JSON.stringify(rawMtp.map(function (ev) {
          return {
            field: ev.field,
            old: ev.old,
            new: ev['new'],
            at: ev.at
          };
        })) +
        ' resultingMtpEvents=' + JSON.stringify(processed));
      samplesLogged++;
      return false;
    });
    if (samplesLogged === 0) {
      Logger.log(logPrefix + ' sample no Active deployment with raw Current_MTP history');
    }
  },

  /**
   * Logs Action History join chain diagnostics (no health-plan narrative).
   * @param {AppConfig} cfg
   * @param {Array<string>} activeDepIds
   * @param {Object} actionHistory
   * @param {Object} dhpMap
   * @private
   */
  _logActionHistoryDiagnostics_: function (cfg, activeDepIds, actionHistory, dhpMap) {
    var logPrefix = 'CoreDeploymentTrajectory._logActionHistoryDiagnostics_:';
    var meta = (actionHistory && actionHistory.readMeta) || {};
    Logger.log(logPrefix + ' sheet="' + (meta.sheetName || '') + '"' +
      ' sheetFound=' + !!meta.sheetFound +
      ' rawDataRows=' + (meta.rawDataRows || 0) +
      ' columnIndices=' + JSON.stringify(meta.columnIndices || {}) +
      ' headerRow=' + JSON.stringify(meta.headerRow || []));
    Logger.log(logPrefix + ' rowsWithNonblankDhpId=' + (meta.rowsWithDhpId || 0) +
      ' parsedActionHistoryRows=' + ((actionHistory && actionHistory.rows) || []).length);

    var dhpSheetStats = CoreDeploymentTrajectory._summarizeDhpSheet_(dhpMap);
    Logger.log(logPrefix + ' dhpRowsFromSfdcDhp=' + dhpSheetStats.rowCount +
      ' dhpRowsWithResolvedDeploymentId=' + dhpSheetStats.withDeploymentId +
      ' uniqueDhpIdsOnSheet=' + dhpSheetStats.uniqueDhpIds.length);

    var uniqueAhDhp = {};
    ((actionHistory && actionHistory.rows) || []).forEach(function (rec) {
      if (rec.dhp_id) uniqueAhDhp[rec.dhp_id] = true;
    });
    var uniqueAhDhpList = Object.keys(uniqueAhDhp);
    Logger.log(logPrefix + ' uniqueDhpIdsInActionHistory=' + uniqueAhDhpList.length);

    var activeSet = CoreDeploymentTrajectory._activeIdLookup_(activeDepIds);
    var matchedDhpSheet = 0;
    var withDeploymentId = 0;
    var activeDeploymentMatch = 0;
    uniqueAhDhpList.forEach(function (dhpId) {
      var depId = CoreDeploymentTrajectory._resolveDhpIdToDeployment_(
        dhpId, dhpSheetStats.dhpIdToDeployment, actionHistory.dhpIdToDeployment);
      if (depId) withDeploymentId++;
      if (CoreDeploymentTrajectory._dhpIdOnSheet_(dhpId, dhpSheetStats.dhpIdSet)) {
        matchedDhpSheet++;
      }
      if (depId && CoreDeploymentTrajectory._idInActiveSet_(depId, activeSet)) {
        activeDeploymentMatch++;
      }
    });

    var rawRows = meta.rawDataRows || 0;
    var withDhp = meta.rowsWithDhpId || 0;
    Logger.log(logPrefix + ' actionHistoryDhpIdsMatchingSfdcDhp=' + matchedDhpSheet +
      ' matchedRecordsWithDeploymentId=' + withDeploymentId +
      ' matchedRecordsWithActiveDeployment=' + activeDeploymentMatch);
    Logger.log(logPrefix + ' orphans missingDhpId=' + (rawRows - withDhp) +
      ' dhpIdNotOnSfdcDhp=' + (withDhp > 0 ? (uniqueAhDhpList.length - matchedDhpSheet) : 0) +
      ' noDeploymentOnDhp=' + (matchedDhpSheet - withDeploymentId) +
      ' deploymentNotActive=' + (withDeploymentId - activeDeploymentMatch));

    var indexWouldWrite = 0;
    var indexWouldWriteNormalized = 0;
    (activeDepIds || []).forEach(function (depId) {
      var dhpAgg = dhpMap[depId] || dhpMap[depId.slice(0, 15)] || null;
      if (!dhpAgg || !dhpAgg.dhpIds) return;
      dhpAgg.dhpIds.forEach(function (dhpId) {
        var list = (actionHistory.byDhpId && actionHistory.byDhpId[dhpId]) || [];
        indexWouldWrite += list.length;
        indexWouldWriteNormalized +=
          CoreDeploymentTrajectory._lookupActionHistoryForDhp_(
            actionHistory.byDhpId, dhpId).length;
      });
    });
    Logger.log(logPrefix + ' trajectoryIndexRowsViaDhpAggJoin=' + indexWouldWrite +
      ' trajectoryIndexRowsViaDhpAggJoinNormalized=' + indexWouldWriteNormalized);

    var samples = [];
    ((actionHistory && actionHistory.rows) || []).some(function (rec) {
      if (samples.length >= 3) return true;
      var depId = CoreDeploymentTrajectory._resolveDhpIdToDeployment_(
        rec.dhp_id, dhpSheetStats.dhpIdToDeployment, actionHistory.dhpIdToDeployment);
      samples.push({
        action_history_id: rec.action_history_id,
        dhp_id: rec.dhp_id,
        deployment_id: depId || ''
      });
      return false;
    });
    Logger.log(logPrefix + ' sampleJoinChains=' + JSON.stringify(samples));
  },

  /**
   * @param {Object} dhpMap
   * @return {{ rowCount: number, withDeploymentId: number, uniqueDhpIds: Array<string>, dhpIdSet: Object, dhpIdToDeployment: Object }}
   * @private
   */
  _summarizeDhpSheet_: function (dhpMap) {
    var seenDep = {};
    var dhpIdSet = {};
    var dhpIdToDeployment = {};
    var rowCount = 0;
    var withDeploymentId = 0;

    Object.keys(dhpMap || {}).forEach(function (key) {
      var agg = dhpMap[key];
      if (!agg || !agg.hasHealthPlan) return;
      var depCanon = CoreData.canonicalDeploymentId(agg.deploymentId || key);
      if (!depCanon || seenDep[depCanon]) return;
      seenDep[depCanon] = true;
      rowCount += agg.dhpCount || 0;
      if (depCanon) withDeploymentId += agg.dhpCount || 0;
      (agg.dhpIds || []).forEach(function (dhpId) {
        dhpIdSet[dhpId] = true;
        dhpIdToDeployment[dhpId] = depCanon;
        var c = CoreData.canonicalDeploymentId(dhpId);
        if (c && c.length >= 15) {
          dhpIdSet[c] = true;
          dhpIdSet[c.slice(0, 15)] = true;
          dhpIdToDeployment[c] = depCanon;
          dhpIdToDeployment[c.slice(0, 15)] = depCanon;
        }
      });
    });

    return {
      rowCount: rowCount,
      withDeploymentId: withDeploymentId,
      uniqueDhpIds: Object.keys(dhpIdSet),
      dhpIdSet: dhpIdSet,
      dhpIdToDeployment: dhpIdToDeployment
    };
  },

  /**
   * @param {string} dhpId
   * @param {Object} dhpIdSet
   * @return {boolean}
   * @private
   */
  _dhpIdOnSheet_: function (dhpId, dhpIdSet) {
    if (!dhpId || !dhpIdSet) return false;
    if (dhpIdSet[dhpId]) return true;
    var c = CoreData.canonicalDeploymentId(dhpId);
    if (c && dhpIdSet[c]) return true;
    if (c && c.length >= 15 && dhpIdSet[c.slice(0, 15)]) return true;
    return false;
  },

  /**
   * @param {string} dhpId
   * @param {Object} fromDhpSheet
   * @param {Object} fromAggMap
   * @return {string}
   * @private
   */
  _resolveDhpIdToDeployment_: function (dhpId, fromDhpSheet, fromAggMap) {
    if (!dhpId) return '';
    if (fromDhpSheet && fromDhpSheet[dhpId]) return fromDhpSheet[dhpId];
    if (fromAggMap && fromAggMap[dhpId]) return fromAggMap[dhpId];
    var c = CoreData.canonicalDeploymentId(dhpId);
    if (c) {
      if (fromDhpSheet && fromDhpSheet[c]) return fromDhpSheet[c];
      if (fromAggMap && fromAggMap[c]) return fromAggMap[c];
      if (c.length >= 15) {
        if (fromDhpSheet && fromDhpSheet[c.slice(0, 15)]) return fromDhpSheet[c.slice(0, 15)];
        if (fromAggMap && fromAggMap[c.slice(0, 15)]) return fromAggMap[c.slice(0, 15)];
      }
    }
    return '';
  },

  /**
   * @param {Array<string>} activeDepIds
   * @return {Object}
   * @private
   */
  _activeIdLookup_: function (activeDepIds) {
    var set = {};
    (activeDepIds || []).forEach(function (id) {
      var c = CoreData.canonicalDeploymentId(id);
      if (!c) return;
      set[c] = true;
      if (c.length >= 15) set[c.slice(0, 15)] = true;
    });
    return set;
  },

  /**
   * @param {string} id
   * @param {Object} activeSet
   * @return {boolean}
   * @private
   */
  _idInActiveSet_: function (id, activeSet) {
    var c = CoreData.canonicalDeploymentId(id);
    if (!c) return false;
    if (activeSet[c]) return true;
    if (c.length >= 15 && activeSet[c.slice(0, 15)]) return true;
    return false;
  },

  /**
   * Looks up action-history rows by DHP id (exact key, then 15/18 aliases).
   * @param {Object} byDhpId
   * @param {string} dhpId
   * @return {Array<Object>}
   * @private
   */
  _lookupActionHistoryForDhp_: function (byDhpId, dhpId) {
    if (!byDhpId || !dhpId) return [];
    if (byDhpId[dhpId] && byDhpId[dhpId].length) return byDhpId[dhpId];
    var c = CoreData.canonicalDeploymentId(dhpId);
    if (c && byDhpId[c] && byDhpId[c].length) return byDhpId[c];
    if (c && c.length >= 15 && byDhpId[c.slice(0, 15)] && byDhpId[c.slice(0, 15)].length) {
      return byDhpId[c.slice(0, 15)];
    }
    return [];
  },

  _buildHealthEventRows_: function (deploymentId, events, metrics) {
    return (events || []).map(function (ev, idx) {
      var cls = TrajectoryMetrics.classifyHealthTransition(ev.old, ev.new);
      return {
        deployment_id: deploymentId,
        event_index: idx + 1,
        event_date: ev.atDate,
        old_health: ev.old,
        new_health: ev.new,
        transition_class: cls || 'none',
        current_health_after_build: metrics.current_health
      };
    });
  },

  _buildMtpEventRows_: function (deploymentId, events, grain) {
    return (events || []).map(function (ev) {
      return {
        deployment_id: deploymentId,
        mtp_analysis_grain: grain || ev.mtp_analysis_grain || '',
        product_function_id: ev.product_function_id || '',
        product_area: ev.product_area || '',
        function: ev.function || '',
        event_date: ev.event_date || '',
        event_type: ev.event_type || '',
        old_date: ev.old_date || '',
        new_date: ev.new_date || '',
        movement_days: ev.movement_days != null ? ev.movement_days : '',
        actual_vs_final_target_days: ev.actual_vs_final_target_days != null ?
          ev.actual_vs_final_target_days : '',
        source_object: ev.source_object || '',
        source_field: ev.source_field || ''
      };
    });
  },

  _trajectoryHeaders_: function () {
    return [
      'deployment_id', 'deployment_name', 'customer_name', 'industry',
      'deployment_phase', 'current_stage', 'current_health',
      'deployment_start_date', 'current_mtp', 'actual_mtp', 'deployment_completion_date',
      'priming_partner', 'implementation_partner',
      'previous_health', 'health_last_change_date', 'days_at_current_health',
      'health_changes_30d', 'health_changes_90d', 'health_changes_total',
      'health_deteriorations_90d', 'health_improvements_90d', 'health_event_count',
      'baseline_mtp', 'earliest_recorded_mtp', 'previous_mtp',
      'mtp_last_change_date', 'mtp_last_change_days',
      'mtp_changes_30d', 'mtp_changes_90d', 'mtp_changes_total',
      'mtp_slips_90d', 'mtp_accelerations_90d', 'mtp_event_count',
      'mtp_net_movement_days', 'mtp_net_movement_comparison', 'mtp_gross_movement_days',
      'mtp_slip_days_90d', 'days_until_current_mtp',
      'previous_stage', 'stage_last_change_date', 'days_in_current_stage',
      'stage_changes_30d', 'stage_changes_90d', 'stage_changes_total',
      'has_open_health_plan', 'dhp_count', 'dhp_ids', 'dhp_plan_owners',
      'dhp_issue_categories', 'dhp_latest_updated_date', 'days_since_dhp_update',
      'action_history_record_count', 'action_history_latest_created_date',
      'days_since_action_history_update', 'action_history_latest_health_status',
      'action_history_ids',
      'mtp_analysis_grain', 'product_function_count', 'product_function_with_mtp_count',
      'product_function_without_mtp_count', 'distinct_current_function_mtp_count',
      'distinct_current_function_mtps',
      'functions_actual_mtp_count', 'functions_remaining_count',
      'remaining_earliest_target_mtp', 'remaining_latest_target_mtp',
      'functions_with_target_changes_30d', 'functions_with_target_changes_90d',
      'functions_with_target_slips_90d',
      'function_target_changes_30d', 'function_target_changes_90d',
      'function_target_slips_90d', 'function_target_accelerations_90d',
      'function_target_slip_days_90d', 'function_target_gross_movement_days_90d',
      'most_recent_function_target_change_date',
      'functions_late_vs_final_target_count', 'functions_on_or_before_final_target_count',
      'function_schedule_event_count',
      'reconstructed_parent_effective_mtp', 'parent_mtp_reconciliation_status',
      'history_parent_id', 'trajectory_schema_version', 'trajectory_built_at',
      'build_warnings', 'source_health_event_count', 'source_mtp_event_count',
      'source_action_history_count', 'effective_mtp_replay_point_count'
    ];
  },

  _healthEventHeaders_: function () {
    return [
      'deployment_id', 'event_index', 'event_date', 'old_health', 'new_health',
      'transition_class', 'current_health_after_build'
    ];
  },

  _mtpEventHeaders_: function () {
    return [
      'deployment_id', 'mtp_analysis_grain', 'product_function_id', 'product_area', 'function',
      'event_date', 'event_type', 'old_date', 'new_date', 'movement_days',
      'actual_vs_final_target_days', 'source_object', 'source_field'
    ];
  },

  _actionIndexHeaders_: function () {
    return [
      'deployment_id', 'dhp_id', 'action_history_id', 'created_date', 'health_status'
    ];
  },

  _trajectoryRowToArray_: function (rowObj, headers) {
    return headers.map(function (h) {
      var v = rowObj[h];
      if (v === null || v === undefined) return '';
      return v;
    });
  },

  _healthEventToArray_: function (ev) {
    return [
      ev.deployment_id, ev.event_index, ev.event_date, ev.old_health, ev.new_health,
      ev.transition_class, ev.current_health_after_build
    ];
  },

  _mtpEventToArray_: function (ev) {
    return [
      ev.deployment_id, ev.mtp_analysis_grain, ev.product_function_id, ev.product_area, ev.function,
      ev.event_date, ev.event_type, ev.old_date, ev.new_date,
      ev.movement_days != null ? ev.movement_days : '',
      ev.actual_vs_final_target_days != null ? ev.actual_vs_final_target_days : '',
      ev.source_object, ev.source_field
    ];
  },

  _actionIndexToArray_: function (row) {
    return [
      row.deployment_id, row.dhp_id, row.action_history_id,
      row.created_date, row.health_status
    ];
  },

  /**
   * Logs intended write dimensions before Spreadsheet service calls.
   * @param {string} sheetName
   * @param {Array<string>} headers
   * @param {Array<Array>} dataRows
   * @private
   */
  _logWritePlan_: function (sheetName, headers, dataRows) {
    var plan = CoreDeploymentTrajectoryStore.estimatePayload(headers, dataRows || []);
    Logger.log('CoreDeploymentTrajectory._runRefresh_: WRITE_PLAN sheet="' + sheetName + '"' +
      ' dataRows=' + plan.dataRows +
      ' headerCols=' + plan.headerCols +
      ' totalRows=' + plan.totalRows +
      ' totalCells=' + plan.totalCells +
      ' approxChars=' + plan.approxChars);
  },

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {string} sheetName
   * @param {Array<string>} headers
   * @param {Array<Array>} dataRows
   * @private
   */
  _writeSheet_: function (ss, sheetName, headers, dataRows) {
    var logPrefix = 'CoreDeploymentTrajectory._writeSheet_: sheet="' + sheetName + '"';
    Logger.log(logPrefix + ' START');

    dataRows = dataRows || [];
    headers = headers || [];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(logPrefix + ' INSERT_SHEET');
      sheet = ss.insertSheet(sheetName);
    } else {
      Logger.log(logPrefix + ' REUSE_EXISTING_SHEET');
    }
    Logger.log(logPrefix + ' SHEET_READY');

    Logger.log(logPrefix + ' PHASE getLastRow START');
    var previousLastRow = sheet.getLastRow();
    Logger.log(logPrefix + ' PHASE getLastRow DONE value=' + previousLastRow);
    Logger.log(logPrefix + ' PHASE getLastColumn START');
    var previousLastCol = sheet.getLastColumn();
    Logger.log(logPrefix + ' PHASE getLastColumn DONE value=' + previousLastCol);
    var headerColCount = headers.length;
    var normalized = CoreDeploymentTrajectoryStore.normalizeRectangularRows(dataRows, headerColCount);
    var bodyRows = normalized.rows;
    var dataRowCount = bodyRows.length;
    var writeColCount = Math.max(headerColCount, 1);
    var matrixNumRows = CoreDeploymentTrajectoryStore.writeMatrixRowCount(dataRowCount);
    var trailingClearNumRows = CoreDeploymentTrajectoryStore.trailingBodyClearNumRows(
      previousLastRow, dataRowCount);
    var prevBodyRows = CoreDeploymentTrajectoryStore.previousBodyRowCount(previousLastRow);

    Logger.log(logPrefix +
      ' headerCols=' + headerColCount +
      ' dataRows=' + dataRowCount +
      ' matrixNumRows=' + matrixNumRows +
      ' setValuesNumCols=' + writeColCount +
      ' trailingClearNumRows=' + trailingClearNumRows +
      ' prevLastRow=' + previousLastRow +
      ' prevBodyRows=' + prevBodyRows +
      ' prevLastCol=' + previousLastCol +
      (normalized.adjustedRowCount ? (' rectangularAdjusted=' + normalized.adjustedRowCount) : '') +
      (prevBodyRows > dataRowCount + 500 ?
        ' WARNING_large_stale_sheet_body' : ''));

    Logger.log(logPrefix + ' PHASE getMaxRows START');
    var maxRows = sheet.getMaxRows();
    Logger.log(logPrefix + ' PHASE getMaxRows DONE value=' + maxRows);
    if (maxRows < matrixNumRows) {
      Logger.log(logPrefix + ' PHASE insertRowsAfter START need=' + matrixNumRows + ' max=' + maxRows);
      sheet.insertRowsAfter(maxRows, matrixNumRows - maxRows);
      Logger.log(logPrefix + ' PHASE insertRowsAfter DONE');
    }
    Logger.log(logPrefix + ' PHASE getMaxColumns START');
    var maxCols = sheet.getMaxColumns();
    Logger.log(logPrefix + ' PHASE getMaxColumns DONE value=' + maxCols);
    if (maxCols < writeColCount) {
      Logger.log(logPrefix + ' PHASE insertColumnsAfter START need=' + writeColCount + ' max=' + maxCols);
      sheet.insertColumnsAfter(maxCols, writeColCount - maxCols);
      Logger.log(logPrefix + ' PHASE insertColumnsAfter DONE');
    }

    var matrix = headerColCount > 0 ? [headers].concat(bodyRows) : bodyRows;
    if (matrixNumRows > 0 && headerColCount > 0) {
      Logger.log(logPrefix + ' PHASE setValues DATA_WRITE_START rows=' + matrixNumRows +
        ' cols=' + writeColCount);
      sheet.getRange(1, 1, matrixNumRows, writeColCount).setValues(matrix);
      Logger.log(logPrefix + ' PHASE setValues DATA_WRITE_DONE');
    } else if (headerColCount > 0) {
      Logger.log(logPrefix + ' PHASE setValues HEADER_WRITE_START cols=' + writeColCount);
      sheet.getRange(1, 1, 1, writeColCount).setValues([headers]);
      Logger.log(logPrefix + ' PHASE setValues HEADER_WRITE_DONE');
    }

    if (trailingClearNumRows > 0) {
      Logger.log(logPrefix + ' PHASE clearContent START trailingRows=' + trailingClearNumRows +
        ' cols=' + writeColCount + ' startRow=' + (CoreDeploymentTrajectoryStore.bodyStartRow() + dataRowCount));
      sheet.getRange(
        CoreDeploymentTrajectoryStore.bodyStartRow() + dataRowCount,
        1,
        trailingClearNumRows,
        writeColCount
      ).clearContent();
      Logger.log(logPrefix + ' PHASE clearContent DONE');
    }

    Logger.log(logPrefix + ' COMPLETE');
  },

  _normalizeDateCell_: function (value, tz, warnings, label) {
    if (!value) return '';
    var d;
    if (value instanceof Date) {
      d = value;
    } else if (typeof value === 'number') {
      d = new Date(value);
    } else {
      var s = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      d = new Date(s);
    }
    if (!d || isNaN(d.getTime())) {
      if (warnings) warnings.push('malformed_date:' + (label || 'unknown'));
      return '';
    }
    return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  _isoToDateOnly_: function (iso, tz) {
    if (!iso) return '';
    var d = new Date(String(iso));
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  _todayStr_: function () {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  _idEquals_: function (a, b) {
    var ca = CoreData.canonicalDeploymentId(a);
    var cb = CoreData.canonicalDeploymentId(b);
    if (ca === cb) return true;
    if (ca.length >= 15 && cb.length >= 15 && ca.slice(0, 15) === cb.slice(0, 15)) {
      return true;
    }
    return false;
  }
};
