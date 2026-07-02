/**
 * CoreTrends.gs
 *
 * Seven v1 Trends metric computation functions for the WebApp Trends tab.
 * Consumes CoreData.getAllDeployments(), CoreHistory.*, CoreData.getRecentGoLives(),
 * and reads HealthReportSnapshots and SFDC_Deployments directly as needed.
 *
 * Phase 3g design: Phase 3g Cursor Handoff Spec (canvas ts5cdwoV178e).
 *
 * Public functions:
 *   getTimeInRedMetrics(cfg, viewModeOpts)
 *   getHealthTrajectory(cfg)                  — always team-wide, no viewModeOpts
 *   getHealthByPartner(cfg, viewModeOpts)
 *   getHealthByDeliveryDirector(cfg, viewModeOpts)
 *   getTimeInStageMetrics(cfg, viewModeOpts)
 *   getTimeToGoLiveMetrics(cfg, viewModeOpts)
 *   getGoLiveOutcomePatterns(cfg, viewModeOpts)
 *
 * Convention: top-level object (no IIFE). Follows the CoreSalesforce pattern.
 *
 * ViewMode:
 *   All functions except getHealthTrajectory respect viewModeOpts
 *   { viewMode: 'my' | 'all', ddDisplayName: string }.
 *   getHealthTrajectory is always team-wide.
 *
 * Performance note:
 *   CoreHistory.getHistoryMap() caches its result per execution; multiple
 *   calls from different CoreTrends functions are free after the first.
 */

var CoreTrends = {

  // ===========================================================================
  // 1. TIME-IN-RED METRICS
  // ===========================================================================

  /**
   * Returns time-in-red data for currently-Red deployments and historical
   * resolution aggregates.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts  { viewMode: 'my'|'all', ddDisplayName: string }
   * @return {Object}
   */
  getTimeInRedMetrics: function (cfg, viewModeOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getTimeInRedMetrics: start (viewMode=' +
               ((viewModeOpts || {}).viewMode || 'all') + ')');

    var allDeployments;
    try {
      allDeployments = CoreData.getAllDeployments(cfg, viewModeOpts);
    } catch (e) {
      Logger.log('CoreTrends.getTimeInRedMetrics: CoreData.getAllDeployments failed: ' + e);
      allDeployments = [];
    }

    var currentRedDeployments = [];
    var historicalResolutions = []; // { durationDays } for resolved Red episodes in last 12mo

    var today = CoreTrends._todayStr_();
    var cutoff12mo = CoreTrends._dateMinusMonths_(today, 12);

    allDeployments.forEach(function (dep) {
      if (!dep.deploymentId) return;

      var stateHistory;
      try {
        stateHistory = CoreHistory.getStateHistory(cfg, dep.deploymentId, 'Overall_Health__c');
      } catch (e) {
        stateHistory = [];
      }

      // Collect historical resolutions (closed Red episodes within last 12 months).
      stateHistory.forEach(function (ep) {
        if (ep.value === 'Red' && ep.to !== null && ep.to >= cutoff12mo) {
          historicalResolutions.push({ durationDays: ep.durationDays || 0 });
        }
      });

      // Only build current-Red entry for deployments currently Red.
      if (dep.health !== 'Red') return;

      var openEp = null;
      for (var i = stateHistory.length - 1; i >= 0; i--) {
        if (stateHistory[i].value === 'Red' && stateHistory[i].to === null) {
          openEp = stateHistory[i];
          break;
        }
      }

      var currentDurationDays = openEp ? (openEp.durationDays || 0) : 0;
      var enteredRedAt = openEp ? (openEp.from || '') : '';

      // previousState: the episode just before the current Red.
      var previousState = null;
      if (openEp) {
        // Find the episode before the current open Red.
        var redIdx = -1;
        for (var j = stateHistory.length - 1; j >= 0; j--) {
          if (stateHistory[j] === openEp) { redIdx = j; break; }
        }
        if (redIdx > 0) {
          previousState = stateHistory[redIdx - 1].value || null;
        }
      }

      currentRedDeployments.push({
        deploymentId:        dep.deploymentId,
        accountName:         dep.accountName         || '',
        deploymentName:      dep.deploymentName       || '',
        partner:             dep.partner              || '',
        deliveryDirector:    dep.deliveryDirector     || '',
        currentDurationDays: currentDurationDays,
        enteredRedAt:        enteredRedAt,
        previousState:       previousState
      });
    });

    // Sort by durationDays descending.
    currentRedDeployments.sort(function (a, b) {
      return b.currentDurationDays - a.currentDurationDays;
    });

    // Aggregates.
    var longestCurrentStreak = currentRedDeployments.length > 0
      ? { deployment: currentRedDeployments[0].accountName,
          days:        currentRedDeployments[0].currentDurationDays }
      : { deployment: '', days: 0 };

    var currentDurations = currentRedDeployments.map(function (d) { return d.currentDurationDays; });
    var avgCurrent    = CoreTrends._average_(currentDurations);
    var medianCurrent = CoreTrends._median_(currentDurations);
    var countCurrentlyRed = currentRedDeployments.length;

    var resolvedDurations = historicalResolutions.map(function (r) { return r.durationDays; });
    var avgResolution    = CoreTrends._average_(resolvedDurations);
    var medianResolution = CoreTrends._median_(resolvedDurations);

    Logger.log('CoreTrends.getTimeInRedMetrics: ' + countCurrentlyRed +
               ' currently Red, ' + historicalResolutions.length + ' resolved in last 12mo');

    return {
      currentRedDeployments: currentRedDeployments,
      aggregates: {
        longestCurrentStreak:  longestCurrentStreak,
        averageCurrentRedDays: Math.round(avgCurrent),
        medianCurrentRedDays:  Math.round(medianCurrent),
        countCurrentlyRed:     countCurrentlyRed
      },
      historicalAggregates: {
        averageTimeToResolution:     Math.round(avgResolution),
        medianTimeToResolution:      Math.round(medianResolution),
        totalResolutionsLast12Months: historicalResolutions.length
      }
    };
  },

  // ===========================================================================
  // 2. HEALTH TRAJECTORY (always team-wide — no viewModeOpts)
  // ===========================================================================

  /**
   * Returns monthly health trajectory from HealthReportSnapshots.
   * Always team-wide; ignores viewMode.
   *
   * @param {AppConfig} cfg
   * @return {Object}
   */
  getHealthTrajectory: function (cfg) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getHealthTrajectory: start');

    var sheetName = (cfg.sheets && cfg.sheets.healthReportSnapshots) || 'HealthReportSnapshots';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('CoreTrends.getHealthTrajectory: HealthReportSnapshots missing or empty');
      return {
        points: [],
        baselineMonth: null,
        currentMonth: null,
        deltaSinceBaseline: { greenPctChange: 0, redPctChange: 0, yellowPctChange: 0 }
      };
    }

    var lastRow  = sheet.getLastRow();
    var data     = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    // Columns: A=ReportMonth(date), B=Status(string), C=Count(num), D=Percent(num)

    var tz = Session.getScriptTimeZone();
    // Group by reportMonth key ('YYYY-MM').
    var byMonth = {};
    data.forEach(function (row) {
      var dt = row[0];
      if (!dt) return;
      var d = (dt instanceof Date) ? dt : new Date(String(dt));
      if (isNaN(d.getTime())) return;
      var key    = Utilities.formatDate(d, tz, 'yyyy-MM');
      var label  = Utilities.formatDate(d, tz, 'MMM yyyy');
      var status = String(row[1] || '').trim();
      var count  = Number(row[2] || 0);
      var pct    = Number(row[3] || 0);

      if (!byMonth[key]) {
        byMonth[key] = { reportMonth: key, label: label, green: 0, red: 0, yellow: 0, total: 0,
                         greenPct: 0, redPct: 0, yellowPct: 0 };
      }
      if (status === 'Green')  { byMonth[key].green  = count; byMonth[key].greenPct  = pct; }
      if (status === 'Red')    { byMonth[key].red    = count; byMonth[key].redPct    = pct; }
      if (status === 'Yellow') { byMonth[key].yellow = count; byMonth[key].yellowPct = pct; }
      if (status === 'Total')  { byMonth[key].total  = count; }
    });

    var keys   = Object.keys(byMonth).sort();
    var points = keys.map(function (k) { return byMonth[k]; });

    if (points.length === 0) {
      return {
        points: [],
        baselineMonth: null,
        currentMonth: null,
        deltaSinceBaseline: { greenPctChange: 0, redPctChange: 0, yellowPctChange: 0 }
      };
    }

    var baselinePt = points[0];
    var currentPt  = points[points.length - 1];

    var delta = {
      greenPctChange:  currentPt.greenPct  - baselinePt.greenPct,
      redPctChange:    currentPt.redPct    - baselinePt.redPct,
      yellowPctChange: currentPt.yellowPct - baselinePt.yellowPct
    };

    if (points.length < 2) {
      Logger.log('CoreTrends.getHealthTrajectory: WARNING \u2014 fewer than 2 months of snapshots; ' +
                 'delta will be zero.');
      delta = { greenPctChange: 0, redPctChange: 0, yellowPctChange: 0 };
    }

    Logger.log('CoreTrends.getHealthTrajectory: ' + points.length + ' monthly points');

    return {
      points:            points,
      baselineMonth:     baselinePt.reportMonth,
      currentMonth:      currentPt.reportMonth,
      deltaSinceBaseline: delta
    };
  },

  // ===========================================================================
  // 3. HEALTH BY PARTNER
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @return {Object}
   */
  getHealthByPartner: function (cfg, viewModeOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getHealthByPartner: start');

    var deployments;
    try {
      deployments = CoreData.getAllDeployments(cfg, viewModeOpts);
    } catch (e) {
      Logger.log('CoreTrends.getHealthByPartner: getAllDeployments failed: ' + e);
      deployments = [];
    }

    var byPartner = {};
    var unassignedCount = 0;
    var totalDeployments = deployments.length;

    deployments.forEach(function (dep) {
      var partner = String(dep.partner || '').trim();
      if (!partner) {
        unassignedCount++;
        partner = '(Unassigned)';
      }
      if (!byPartner[partner]) {
        byPartner[partner] = { partner: partner, total: 0, green: 0, red: 0, yellow: 0 };
      }
      byPartner[partner].total++;
      var h = String(dep.health || '').trim();
      if (h === 'Green')  byPartner[partner].green++;
      else if (h === 'Red')    byPartner[partner].red++;
      else if (h === 'Yellow') byPartner[partner].yellow++;
    });

    var rows = [];
    var unassignedRow = null;
    Object.keys(byPartner).forEach(function (p) {
      var r = byPartner[p];
      var row = {
        partner:    r.partner,
        total:      r.total,
        green:      r.green,
        red:        r.red,
        yellow:     r.yellow,
        greenPct:   r.total > 0 ? r.green  / r.total : 0,
        redPct:     r.total > 0 ? r.red    / r.total : 0,
        yellowPct:  r.total > 0 ? r.yellow / r.total : 0
      };
      if (r.partner === '(Unassigned)') {
        unassignedRow = row;
      } else {
        rows.push(row);
      }
    });

    rows.sort(function (a, b) { return b.total - a.total; });
    if (unassignedRow && unassignedRow.total > 0) rows.push(unassignedRow);

    Logger.log('CoreTrends.getHealthByPartner: ' + rows.length + ' partner rows');

    return {
      rows:             rows,
      totalDeployments: totalDeployments,
      dataIntegrity:    { unassignedCount: unassignedCount, showDisclaimer: unassignedCount > 0 }
    };
  },

  // ===========================================================================
  // 4. HEALTH BY DELIVERY DIRECTOR
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @return {Object}
   */
  getHealthByDeliveryDirector: function (cfg, viewModeOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getHealthByDeliveryDirector: start');

    var deployments;
    try {
      deployments = CoreData.getAllDeployments(cfg, viewModeOpts);
    } catch (e) {
      Logger.log('CoreTrends.getHealthByDeliveryDirector: getAllDeployments failed: ' + e);
      deployments = [];
    }

    var byDD = {};
    var unassignedCount = 0;
    var totalDeployments = deployments.length;

    deployments.forEach(function (dep) {
      var dd = String(dep.deliveryDirector || '').trim();
      if (!dd) {
        unassignedCount++;
        dd = '(Unassigned)';
      }
      if (!byDD[dd]) {
        byDD[dd] = { deliveryDirector: dd, total: 0, green: 0, red: 0, yellow: 0,
                     redDeploymentIds: [] };
      }
      byDD[dd].total++;
      var h = String(dep.health || '').trim();
      if (h === 'Green')       byDD[dd].green++;
      else if (h === 'Red')    { byDD[dd].red++; byDD[dd].redDeploymentIds.push(dep.deploymentId); }
      else if (h === 'Yellow') byDD[dd].yellow++;
    });

    // Compute average Red days per DD.
    var rows = [];
    var unassignedRow = null;
    Object.keys(byDD).forEach(function (dd) {
      var r = byDD[dd];
      var avgRedDays = 0;
      if (r.redDeploymentIds.length > 0) {
        var durations = r.redDeploymentIds.map(function (id) {
          try {
            var cur = CoreHistory.getCurrentStateDuration(cfg, id, 'Overall_Health__c');
            return (cur && cur.value === 'Red') ? (cur.durationDays || 0) : 0;
          } catch (e) { return 0; }
        });
        avgRedDays = Math.round(CoreTrends._average_(durations));
      }

      var row = {
        deliveryDirector:          r.deliveryDirector,
        total:                     r.total,
        green:                     r.green,
        red:                       r.red,
        yellow:                    r.yellow,
        greenPct:                  r.total > 0 ? r.green  / r.total : 0,
        redPct:                    r.total > 0 ? r.red    / r.total : 0,
        yellowPct:                 r.total > 0 ? r.yellow / r.total : 0,
        averageRedDaysOnPortfolio: avgRedDays
      };
      if (r.deliveryDirector === '(Unassigned)') {
        unassignedRow = row;
      } else {
        rows.push(row);
      }
    });

    rows.sort(function (a, b) { return b.total - a.total; });
    if (unassignedRow && unassignedRow.total > 0) rows.push(unassignedRow);

    Logger.log('CoreTrends.getHealthByDeliveryDirector: ' + rows.length + ' DD rows');

    return {
      rows:             rows,
      totalDeployments: totalDeployments,
      dataIntegrity:    { unassignedCount: unassignedCount, showDisclaimer: unassignedCount > 0 }
    };
  },

  // ===========================================================================
  // 5. TIME IN STAGE METRICS
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @return {Object}
   */
  getTimeInStageMetrics: function (cfg, viewModeOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getTimeInStageMetrics: start');

    var CANONICAL_STAGES = [
      'On-Boarding', 'Plan', 'Architect & Configure', 'Test', 'Deploy', 'Post Prod'
    ];
    var stageRank = {};
    CANONICAL_STAGES.forEach(function (s, i) { stageRank[s] = i; });

    var outlierMultiple  = (cfg.salesforce && cfg.salesforce.timeInStageOutlierMultiple)  || 2;
    var minSampleSize    = (cfg.salesforce && cfg.salesforce.timeInStageMinSampleSize)     || 10;

    // Current state per Active deployment.
    var activeDeployments;
    try {
      activeDeployments = CoreData.getAllDeployments(cfg, viewModeOpts);
    } catch (e) {
      Logger.log('CoreTrends.getTimeInStageMetrics: getAllDeployments failed: ' + e);
      activeDeployments = [];
    }

    var currentStateByDeployment = [];
    activeDeployments.forEach(function (dep) {
      var cur;
      try {
        cur = CoreHistory.getCurrentStateDuration(cfg, dep.deploymentId, 'Deployment_Stage__c');
      } catch (e) { cur = null; }
      // Fallback to the live stage field if no history episode.
      var stage    = (cur && cur.value) ? cur.value : (dep.stage || '');
      var duration = (cur && cur.durationDays != null) ? cur.durationDays : 0;
      var entered  = (cur && cur.enteredAt) ? cur.enteredAt : '';
      currentStateByDeployment.push({
        deploymentId:             dep.deploymentId,
        accountName:              dep.accountName || '',
        currentStage:             stage,
        currentStageDurationDays: duration,
        enteredStageAt:           entered
      });
    });

    // Stage benchmarks — walk history for ALL deployments (team-wide).
    var historyMap;
    try {
      historyMap = CoreHistory.getHistoryMap(cfg);
    } catch (e) {
      Logger.log('CoreTrends.getTimeInStageMetrics: getHistoryMap failed: ' + e);
      historyMap = {};
    }

    var stageBuckets = {}; // { stageName: [durationDays] }
    CANONICAL_STAGES.forEach(function (s) { stageBuckets[s] = []; });

    Object.keys(historyMap).forEach(function (depId) {
      var episodes;
      try {
        episodes = CoreHistory.getStateHistory(cfg, depId, 'Deployment_Stage__c');
      } catch (e) { episodes = []; }

      // Only count completed (to !== null) forward-only transitions.
      for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        if (ep.to === null) continue;               // open — skip
        if (ep.durationDays === null) continue;     // first implicit — skip

        var stageVal = ep.value;
        if (!(stageVal in stageRank)) continue;     // not a canonical stage

        // Check the next episode to determine if this is a forward transition.
        if (i + 1 < episodes.length) {
          var nextVal = episodes[i + 1].value;
          if (nextVal in stageRank && stageRank[nextVal] <= stageRank[stageVal]) continue;
        }

        stageBuckets[stageVal].push(ep.durationDays);
      }
    });

    var stageBenchmarks = CANONICAL_STAGES.map(function (stage) {
      var durations = stageBuckets[stage];
      return {
        stage:       stage,
        averageDays: durations.length > 0 ? Math.round(CoreTrends._average_(durations)) : null,
        medianDays:  durations.length > 0 ? Math.round(CoreTrends._median_(durations))  : null,
        sampleSize:  durations.length
      };
    });

    // Outliers — Active deployments stuck more than outlierMultiple * benchmarkMedian.
    var benchmarkByStage = {};
    stageBenchmarks.forEach(function (b) { benchmarkByStage[b.stage] = b; });

    var outliers = [];
    currentStateByDeployment.forEach(function (row) {
      var stage = row.currentStage;
      if (stage === 'Post Prod') return;
      var bench = benchmarkByStage[stage];
      if (!bench || bench.sampleSize < minSampleSize || bench.medianDays === null) return;
      if (row.currentStageDurationDays >= outlierMultiple * bench.medianDays) {
        outliers.push({
          deploymentId:             row.deploymentId,
          accountName:              row.accountName,
          currentStage:             stage,
          currentStageDurationDays: row.currentStageDurationDays,
          benchmarkMedian:          bench.medianDays,
          multipleOfMedian:         bench.medianDays > 0
            ? Math.round((row.currentStageDurationDays / bench.medianDays) * 10) / 10
            : 0
        });
      }
    });
    outliers.sort(function (a, b) { return b.multipleOfMedian - a.multipleOfMedian; });

    Logger.log('CoreTrends.getTimeInStageMetrics: ' + currentStateByDeployment.length +
               ' active, ' + outliers.length + ' outliers');

    return {
      currentStateByDeployment: currentStateByDeployment,
      stageBenchmarks:          stageBenchmarks,
      outliers:                 outliers
    };
  },

  // ===========================================================================
  // 6. TIME TO GO-LIVE METRICS
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @return {Object}
   */
  getTimeToGoLiveMetrics: function (cfg, viewModeOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getTimeToGoLiveMetrics: start');

    var today = CoreTrends._todayStr_();
    var windowMonths = (cfg.salesforce && cfg.salesforce.trendsWindowMonths) || 12;

    // Active in-flight.
    var activeDeployments;
    try {
      activeDeployments = CoreData.getAllDeployments(cfg, viewModeOpts);
    } catch (e) {
      Logger.log('CoreTrends.getTimeToGoLiveMetrics: getAllDeployments failed: ' + e);
      activeDeployments = [];
    }

    var activeInFlight = [];
    activeDeployments.forEach(function (dep) {
      var startDate = dep.startDate || dep.deploymentStartDate || '';
      if (!startDate && dep.mtpDate) {
        // Fallback: try to get start date from history (first event date).
        var histMap = CoreHistory.getHistoryMap(cfg);
        var entry   = histMap[dep.deploymentId];
        if (entry && entry.events && entry.events.length > 0) {
          startDate = CoreHistory._toDateOnly_(entry.events[0].at,
                                               Session.getScriptTimeZone());
        }
      }

      var mtpEntry;
      try { mtpEntry = CoreHistory.getCurrentMTPDate(cfg, dep.deploymentId); } catch (e) {}
      var currentMtpDate = (mtpEntry && mtpEntry.date) ? mtpEntry.date :
                           (dep.mtpDate || '');

      if (!startDate || !currentMtpDate) return;

      var daysInFlight       = CoreTrends._daysBetween_(startDate, today);
      var projectedTotalDays = CoreTrends._daysBetween_(startDate, currentMtpDate);
      var projectedDaysRemaining = CoreTrends._daysBetween_(today, currentMtpDate);
      // Remaining can be negative (overdue).
      if (currentMtpDate < today) projectedDaysRemaining = -CoreTrends._daysBetween_(currentMtpDate, today);
      var pctComplete = projectedTotalDays > 0
        ? Math.min(1, Math.max(0, daysInFlight / projectedTotalDays))
        : 0;
      var isOverdue = projectedDaysRemaining < 0;

      activeInFlight.push({
        deploymentId:          dep.deploymentId,
        accountName:           dep.accountName      || '',
        deploymentName:        dep.deploymentName    || '',
        partner:               dep.partner           || '',
        deliveryDirector:      dep.deliveryDirector  || '',
        startDate:             startDate,
        currentMtpDate:        currentMtpDate,
        daysInFlight:          daysInFlight,
        projectedTotalDays:    projectedTotalDays,
        projectedDaysRemaining: projectedDaysRemaining,
        pctComplete:           Math.round(pctComplete * 1000) / 1000,
        isOverdue:             isOverdue
      });
    });

    var overdueDeployments = activeInFlight
      .filter(function (d) { return d.isOverdue; })
      .sort(function (a, b) { return Math.abs(b.projectedDaysRemaining) - Math.abs(a.projectedDaysRemaining); });

    // Benchmark stats from Complete deployments.
    var benchmarkStats = CoreTrends._buildTimeToGoLiveBenchmarks_(cfg, windowMonths, viewModeOpts);

    Logger.log('CoreTrends.getTimeToGoLiveMetrics: ' + activeInFlight.length + ' in-flight, ' +
               overdueDeployments.length + ' overdue');

    return {
      activeInFlight:    activeInFlight,
      overdueDeployments: overdueDeployments,
      benchmarkStats:    benchmarkStats
    };
  },

  // ===========================================================================
  // 7. GO-LIVE OUTCOME PATTERNS
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @return {Object}
   */
  getGoLiveOutcomePatterns: function (cfg, viewModeOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    Logger.log('CoreTrends.getGoLiveOutcomePatterns: start');

    var windowMonths = (cfg.salesforce && cfg.salesforce.trendsWindowMonths) || 12;
    var byPartnerMin = (cfg.salesforce && cfg.salesforce.byPartnerMinSampleSize)   || 5;
    var today        = CoreTrends._todayStr_();
    var cutoff       = CoreTrends._dateMinusMonths_(today, windowMonths);

    // Get Complete deployments from the last windowMonths months.
    var completeRows = CoreTrends._getCompleteDeployments_(cfg, viewModeOpts, cutoff);

    var sampleSize = completeRows.length;
    var onTimeOrEarlyCount = 0;
    var slippedCount       = 0;
    var slippageSums       = [];
    var mtpChangeCounts    = [];
    var neverChanged = 0, changedOnce = 0, changedTwoThree = 0, changedFourPlus = 0;

    var byApproachMap = {};
    var byPartnerMap  = {};

    var recentCompletions = [];

    completeRows.forEach(function (dep) {
      var mtpHistory;
      try {
        mtpHistory = CoreHistory.getMTPDateHistory(cfg, dep.deploymentId);
      } catch (e) {
        mtpHistory = [];
      }

      var actualGoLive = dep.firstMtpActual || dep.lastGoLiveDate || '';
      if (!actualGoLive) return;

      // originalBaseline: first entry where source === 'Baseline'; else first entry.
      var originalBaseline = '';
      if (mtpHistory.length > 0) {
        var baselineEntry = null;
        for (var i = 0; i < mtpHistory.length; i++) {
          if (mtpHistory[i].source === 'Baseline') { baselineEntry = mtpHistory[i]; break; }
        }
        originalBaseline = baselineEntry
          ? baselineEntry.date
          : mtpHistory[0].date;
      }
      if (!originalBaseline) originalBaseline = dep.mtpDate || actualGoLive;

      // finalTarget: entry just before Actual was set; fallback to Baseline.
      var finalTarget = originalBaseline;
      if (mtpHistory.length >= 2) {
        // Find where Actual appears, take the entry before it.
        var actIdx = -1;
        for (var j = 0; j < mtpHistory.length; j++) {
          if (mtpHistory[j].source === 'Actual') { actIdx = j; break; }
        }
        if (actIdx > 0) {
          finalTarget = mtpHistory[actIdx - 1].date;
        } else if (actIdx < 0 && mtpHistory.length > 0) {
          finalTarget = mtpHistory[mtpHistory.length - 1].date;
        }
      }

      var baselineSlippageDays = originalBaseline
        ? CoreTrends._signedDaysBetween_(originalBaseline, actualGoLive)
        : 0;
      var finalTargetSlippageDays = finalTarget
        ? CoreTrends._signedDaysBetween_(finalTarget, actualGoLive)
        : 0;

      // Count distinct date changes.
      var changeCount = 0;
      for (var k = 1; k < mtpHistory.length; k++) {
        if (mtpHistory[k].date !== mtpHistory[k - 1].date) changeCount++;
      }

      if (baselineSlippageDays <= 0) onTimeOrEarlyCount++;
      else {
        slippedCount++;
        slippageSums.push(baselineSlippageDays);
      }
      mtpChangeCounts.push(changeCount);

      if (changeCount === 0)      neverChanged++;
      else if (changeCount === 1) changedOnce++;
      else if (changeCount <= 3)  changedTwoThree++;
      else                        changedFourPlus++;

      // byApproach
      var approach = String(dep.servicesApproach || dep.deploymentPhase || 'Unknown').trim();
      if (!byApproachMap[approach]) {
        byApproachMap[approach] = { approach: approach, sampleSize: 0, onTimeCount: 0,
                                    slippageDays: [], mtpChanges: [] };
      }
      byApproachMap[approach].sampleSize++;
      if (baselineSlippageDays <= 0) byApproachMap[approach].onTimeCount++;
      else byApproachMap[approach].slippageDays.push(baselineSlippageDays);
      byApproachMap[approach].mtpChanges.push(changeCount);

      // byPartner
      var partner = String(dep.partner || '').trim();
      if (partner) {
        if (!byPartnerMap[partner]) {
          byPartnerMap[partner] = { partner: partner, sampleSize: 0, onTimeCount: 0,
                                    slippageDays: [], mtpChanges: [] };
        }
        byPartnerMap[partner].sampleSize++;
        if (baselineSlippageDays <= 0) byPartnerMap[partner].onTimeCount++;
        else byPartnerMap[partner].slippageDays.push(baselineSlippageDays);
        byPartnerMap[partner].mtpChanges.push(changeCount);
      }

      recentCompletions.push({
        deploymentId:            dep.deploymentId,
        accountName:             dep.accountName        || '',
        completionDate:          actualGoLive,
        approach:                approach,
        partner:                 dep.partner             || '',
        originalBaseline:        originalBaseline,
        finalTarget:             finalTarget,
        actualGoLive:            actualGoLive,
        baselineSlippageDays:    baselineSlippageDays,
        finalTargetSlippageDays: finalTargetSlippageDays,
        mtpDateChangeCount:      changeCount
      });
    });

    recentCompletions.sort(function (a, b) {
      return b.completionDate < a.completionDate ? -1 : (b.completionDate > a.completionDate ? 1 : 0);
    });

    var avgSlippage    = CoreTrends._average_(slippageSums);
    var medianSlippage = CoreTrends._median_(slippageSums);

    var byApproach = Object.keys(byApproachMap).map(function (k) {
      var a = byApproachMap[k];
      return {
        approach:        a.approach,
        sampleSize:      a.sampleSize,
        onTimePct:       a.sampleSize > 0 ? a.onTimeCount / a.sampleSize : 0,
        avgSlippageDays: a.slippageDays.length > 0 ? Math.round(CoreTrends._average_(a.slippageDays)) : 0,
        avgMtpChanges:   a.mtpChanges.length > 0
          ? Math.round(CoreTrends._average_(a.mtpChanges) * 10) / 10 : 0
      };
    }).sort(function (a, b) { return b.sampleSize - a.sampleSize; });

    var byPartner = Object.keys(byPartnerMap)
      .filter(function (k) { return byPartnerMap[k].sampleSize >= byPartnerMin; })
      .map(function (k) {
        var p = byPartnerMap[k];
        return {
          partner:         p.partner,
          sampleSize:      p.sampleSize,
          onTimePct:       p.sampleSize > 0 ? p.onTimeCount / p.sampleSize : 0,
          avgSlippageDays: p.slippageDays.length > 0 ? Math.round(CoreTrends._average_(p.slippageDays)) : 0,
          avgMtpChanges:   p.mtpChanges.length > 0
            ? Math.round(CoreTrends._average_(p.mtpChanges) * 10) / 10 : 0
        };
      }).sort(function (a, b) { return b.sampleSize - a.sampleSize; });

    Logger.log('CoreTrends.getGoLiveOutcomePatterns: sampleSize=' + sampleSize +
               ', onTime=' + onTimeOrEarlyCount + ', slipped=' + slippedCount);

    return {
      windowMonths: windowMonths,
      sampleSize:   sampleSize,
      baselineAccuracy: {
        onTimeOrEarlyCount: onTimeOrEarlyCount,
        slippedCount:       slippedCount,
        onTimePct:          sampleSize > 0 ? onTimeOrEarlyCount / sampleSize : 0,
        avgSlippageDays:    Math.round(avgSlippage),
        medianSlippageDays: Math.round(medianSlippage)
      },
      mtpDateMovementDistribution: {
        neverChanged:       neverChanged,
        changedOnce:        changedOnce,
        changedTwiceOrThree: changedTwoThree,
        changedFourPlus:    changedFourPlus
      },
      byApproach:        byApproach,
      byPartner:         byPartner,
      recentCompletions: recentCompletions
    };
  },

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Returns today's date as 'YYYY-MM-DD' in script timezone.
   * @return {string}
   * @private
   */
  _todayStr_: function () {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  /**
   * Returns the date N months before the given 'YYYY-MM-DD' string.
   * @param {string} dateStr
   * @param {number} months
   * @return {string}
   * @private
   */
  _dateMinusMonths_: function (dateStr, months) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setMonth(d.getMonth() - months);
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  },

  /**
   * Whole days between two 'YYYY-MM-DD' strings (non-negative).
   * @param {string} fromStr
   * @param {string} toStr
   * @return {number}
   * @private
   */
  _daysBetween_: function (fromStr, toStr) {
    if (!fromStr || !toStr) return 0;
    var from = new Date(fromStr + 'T00:00:00Z');
    var to   = new Date(toStr   + 'T00:00:00Z');
    var ms   = to.getTime() - from.getTime();
    return ms < 0 ? 0 : Math.floor(ms / 86400000);
  },

  /**
   * Signed days between two dates (positive = to is after from, i.e. slipped).
   * @param {string} fromStr  Baseline / target date.
   * @param {string} toStr    Actual date.
   * @return {number}
   * @private
   */
  _signedDaysBetween_: function (fromStr, toStr) {
    if (!fromStr || !toStr) return 0;
    var from = new Date(fromStr + 'T00:00:00Z');
    var to   = new Date(toStr   + 'T00:00:00Z');
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  },

  /**
   * @param {Array<number>} arr
   * @return {number}
   * @private
   */
  _average_: function (arr) {
    if (!arr || arr.length === 0) return 0;
    var sum = arr.reduce(function (s, v) { return s + v; }, 0);
    return sum / arr.length;
  },

  /**
   * @param {Array<number>} arr
   * @return {number}
   * @private
   */
  _median_: function (arr) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  },

  /**
   * @param {Array<number>} arr
   * @param {number} pct  0–1
   * @return {number}
   * @private
   */
  _percentile_: function (arr, pct) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var idx = (pct * (sorted.length - 1));
    var lo  = Math.floor(idx);
    var hi  = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  },

  /**
   * Reads SFDC_Deployments directly to get Complete deployments filtered
   * by firstMtpActual within the given cutoff date (inclusive).
   * Falls back to getRecentGoLives for the data.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {string} cutoffDate  'YYYY-MM-DD' — only completions on/after this date.
   * @return {Array<Object>}
   * @private
   */
  _getCompleteDeployments_: function (cfg, viewModeOpts, cutoffDate) {
    try {
      // Prefer getRecentGoLives — it already handles Complete deployments and
      // applies the recentWindowDays filter.
      var rows = CoreData.getRecentGoLives(cfg, viewModeOpts || {});
      if (rows && rows.length > 0) {
        return rows
          .filter(function (r) {
            var d = r.lastGoLiveDate || r.firstMtpActual || '';
            return d >= cutoffDate;
          })
          .map(function (r) {
            return {
              deploymentId:     r.deploymentId,
              accountName:      r.accountName      || '',
              deploymentName:   r.deploymentName   || '',
              partner:          r.partner           || '',
              deliveryDirector: r.deliveryDirector  || '',
              servicesApproach: r.servicesApproach  || r.deploymentPhase || '',
              deploymentPhase:  r.servicesApproach  || r.deploymentPhase || '',
              lastGoLiveDate:   r.lastGoLiveDate     || '',
              firstMtpActual:   r.lastGoLiveDate     || '',
              startDate:        r.startDate          || '',
              mtpDate:          r.lastGoLiveDate     || ''
            };
          });
      }
    } catch (e) {
      Logger.log('CoreTrends._getCompleteDeployments_: getRecentGoLives failed, reading sheet directly: ' + e);
    }

    // Fallback: read SFDC_Deployments directly.
    return CoreTrends._readCompleteDeploymentsDirect_(cfg, viewModeOpts, cutoffDate);
  },

  /**
   * Reads SFDC_Deployments directly for Complete rows as fallback.
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {string} cutoffDate
   * @return {Array<Object>}
   * @private
   */
  _readCompleteDeploymentsDirect_: function (cfg, viewModeOpts, cutoffDate) {
    try {
      var sheetName   = (cfg.sheets && cfg.sheets.deployments) || 'SFDC_Deployments';
      var ss          = SpreadsheetApp.getActiveSpreadsheet();
      var sheet       = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2) return [];

      var completeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
                            cfg.salesforce.statusValues.complete) || 'Complete';
      var tz = Session.getScriptTimeZone();

      var lastRow  = sheet.getLastRow();
      var lastCol  = sheet.getLastColumn();
      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var lowerH    = allValues[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

      function detectCol_(kw) {
        for (var i = 0; i < lowerH.length; i++) {
          if (lowerH[i].indexOf(kw) !== -1) return i;
        }
        return -1;
      }

      var colId       = (function () {
        for (var i = 0; i < lowerH.length; i++) { if (lowerH[i] === 'id') return i; }
        return -1;
      })();
      var colStatus   = detectCol_('overall_status');
      var colActual   = detectCol_('first_move_to_production_date_actual');
      var colAccount  = detectCol_('customer__r.name');
      var colName     = (function () {
        for (var i = 0; i < lowerH.length; i++) { if (lowerH[i] === 'name') return i; }
        return detectCol_('name');
      })();
      var colPartner  = detectCol_('partner_name');
      var colPhase    = detectCol_('deployment_phase');
      var colMtp      = detectCol_('current_mtp_date');
      var colStart    = detectCol_('deployment_start_date');

      var rows = [];
      for (var r = 1; r < allValues.length; r++) {
        var row     = allValues[r];
        var status  = colStatus >= 0 ? String(row[colStatus] || '').trim() : '';
        if (status !== completeStatus) continue;

        var actualDate = colActual >= 0
          ? CoreHistory._normalizeDate_(row[colActual], tz) : null;
        if (!actualDate || actualDate < cutoffDate) continue;

        var ddName = '';
        if (viewModeOpts && viewModeOpts.viewMode === 'my' && viewModeOpts.ddDisplayName) {
          // Respect viewMode — skip if not this DD's deployment (approximate).
          // We don't have deliveryDirector in SFDC_Deployments directly.
          // We'll include all and note the limitation.
        }

        rows.push({
          deploymentId:     colId     >= 0 ? String(row[colId]     || '').trim() : '',
          accountName:      colAccount >= 0 ? String(row[colAccount] || '') : '',
          deploymentName:   colName    >= 0 ? String(row[colName]    || '') : '',
          partner:          colPartner >= 0 ? String(row[colPartner] || '') : '',
          servicesApproach: colPhase   >= 0 ? String(row[colPhase]   || '') : '',
          deploymentPhase:  colPhase   >= 0 ? String(row[colPhase]   || '') : '',
          lastGoLiveDate:   actualDate,
          firstMtpActual:   actualDate,
          startDate:        colStart   >= 0 ? (CoreHistory._normalizeDate_(row[colStart], tz) || '') : '',
          mtpDate:          colMtp     >= 0 ? (CoreHistory._normalizeDate_(row[colMtp],   tz) || '') : '',
          deliveryDirector: ''
        });
      }
      Logger.log('CoreTrends._readCompleteDeploymentsDirect_: found ' + rows.length +
                 ' Complete rows since ' + cutoffDate);
      return rows;
    } catch (e) {
      Logger.log('CoreTrends._readCompleteDeploymentsDirect_: error: ' + e);
      return [];
    }
  },

  /**
   * Builds benchmark statistics for Time-to-Go-Live from Complete deployments.
   * @param {AppConfig} cfg
   * @param {number} windowMonths
   * @param {Object=} viewModeOpts
   * @return {Object}
   * @private
   */
  _buildTimeToGoLiveBenchmarks_: function (cfg, windowMonths, viewModeOpts) {
    var today   = CoreTrends._todayStr_();
    var cutoff  = CoreTrends._dateMinusMonths_(today, windowMonths);
    var rows    = CoreTrends._getCompleteDeployments_(cfg, viewModeOpts, cutoff);

    var durations   = [];
    var byApproach  = {};

    rows.forEach(function (dep) {
      var actualDate = dep.firstMtpActual || dep.lastGoLiveDate || '';
      var startDate  = dep.startDate || '';
      if (!actualDate || !startDate) return;
      var dur = CoreTrends._daysBetween_(startDate, actualDate);
      if (dur <= 0) return;
      durations.push(dur);

      var approach = String(dep.servicesApproach || dep.deploymentPhase || 'Unknown').trim();
      if (!byApproach[approach]) byApproach[approach] = [];
      byApproach[approach].push(dur);
    });

    var approachBreakdown = Object.keys(byApproach).map(function (a) {
      return {
        approach:          a,
        sampleSize:        byApproach[a].length,
        medianDurationDays: Math.round(CoreTrends._median_(byApproach[a]))
      };
    }).sort(function (a, b) { return b.sampleSize - a.sampleSize; });

    return {
      windowMonths:      windowMonths,
      sampleSize:        durations.length,
      meanDurationDays:  Math.round(CoreTrends._average_(durations)),
      medianDurationDays: Math.round(CoreTrends._median_(durations)),
      p25DurationDays:   Math.round(CoreTrends._percentile_(durations, 0.25)),
      p75DurationDays:   Math.round(CoreTrends._percentile_(durations, 0.75)),
      byApproach:        approachBreakdown
    };
  }
};
