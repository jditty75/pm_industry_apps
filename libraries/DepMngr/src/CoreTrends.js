/**
 * CoreTrends.gs
 *
 * Seven v1 Trends metric computation functions for the WebApp Trends tab.
 * Consumes CoreData.getAllDeployments(), CoreHistory.*, CoreData.getRecentGoLives(),
 * and reads HealthReportSnapshots and SFDC_Deployments directly as needed.
 *
 * Phase 3g design: Phase 3g Cursor Handoff Spec (canvas ts5cdwoV178e).
 * T1 revisit (v70 baseline): adds optional pass-through cache parameter to all 7
 * public functions.  Callers pass CacheService.getScriptCache() from the app's
 * script context; that handle binds to the calling app's cache, sidestepping the
 * library-scope issue documented in C1.  When cache is undefined, functions behave
 * exactly as before — zero regression for existing callers.
 *
 * Public functions:
 *   getTimeInRedMetrics(cfg, viewModeOpts, cache)
 *   getHealthTrajectory(cfg, cache)                  — always team-wide, no viewModeOpts
 *   getHealthByPartner(cfg, viewModeOpts, cache)
 *   getHealthByDeliveryDirector(cfg, viewModeOpts, cache)
 *   getTimeInStageMetrics(cfg, viewModeOpts, cache)
 *   getTimeToGoLiveMetrics(cfg, viewModeOpts, cache)
 *   getGoLiveOutcomePatterns(cfg, viewModeOpts, cache)
 *   getTrendsDashboardData(cfg, viewModeOpts, productOpts, cache) — bundled v1 backend
 *   debugTrendsReadiness(cfg, viewModeOpts, productOpts)
 *   debugTrendsDashboardData(cfg, viewModeOpts, productOpts)
 *
 * Trends v1 readiness (2026-09): ProductMode history joins use parent deployment IDs
 * resolved from ProductFunction rows, not synthetic display deploymentId values.
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
   * @param {CacheService=} cache   Optional CacheService.getScriptCache() handle.
   * @return {Object}
   */
  getTimeInRedMetrics: function (cfg, viewModeOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:timeInRed:' + cfg.appId + ':' +
                 CoreTrends._buildViewModeKey_(viewModeOpts);
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getTimeInRedMetrics: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getTimeInRedMetrics: cache read failed: ' + e);
      }
    }

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
      var historyParentId = CoreTrends.resolveHistoryDeploymentId_(dep);
      if (!historyParentId && !dep.deploymentId) return;

      var stateHistory;
      try {
        stateHistory = CoreHistory.getStateHistory(cfg, historyParentId, 'Overall_Health__c');
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

    var _result_ = {
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
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getTimeInRedMetrics: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getTimeInRedMetrics: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // 2. HEALTH TRAJECTORY (always team-wide — no viewModeOpts)
  // ===========================================================================

  /**
   * Returns monthly health trajectory from HealthReportSnapshots.
   * Always team-wide; ignores viewMode.
   *
   * @param {AppConfig} cfg
   * @param {CacheService=} cache   Optional CacheService.getScriptCache() handle.
   * @return {Object}
   */
  getHealthTrajectory: function (cfg, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:healthTrajectory:' + cfg.appId;
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getHealthTrajectory: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getHealthTrajectory: cache read failed: ' + e);
      }
    }

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
        deltaSinceBaseline: CoreTrends._emptyHealthTrajectoryDelta_(),
        baselineCounts: null,
        currentCounts: null
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
        deltaSinceBaseline: CoreTrends._emptyHealthTrajectoryDelta_(),
        baselineCounts: null,
        currentCounts: null
      };
    }

    var baselinePt = points[0];
    var currentPt  = points[points.length - 1];
    var deltaPack  = CoreTrends._buildHealthTrajectoryDelta_(baselinePt, currentPt, points.length >= 2);

    if (points.length < 2) {
      Logger.log('CoreTrends.getHealthTrajectory: WARNING \u2014 fewer than 2 months of snapshots; ' +
                 'delta will be zero.');
    }

    Logger.log('CoreTrends.getHealthTrajectory: ' + points.length + ' monthly points');

    var _result_ = {
      points:             points,
      baselineMonth:      baselinePt.reportMonth,
      currentMonth:       currentPt.reportMonth,
      deltaSinceBaseline: deltaPack.deltaSinceBaseline,
      baselineCounts:     deltaPack.baselineCounts,
      currentCounts:      deltaPack.currentCounts
    };
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getHealthTrajectory: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getHealthTrajectory: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // 3. HEALTH BY PARTNER
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {CacheService=} cache
   * @return {Object}
   */
  getHealthByPartner: function (cfg, viewModeOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:healthByPartner:' + cfg.appId + ':' +
                 CoreTrends._buildViewModeKey_(viewModeOpts);
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getHealthByPartner: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getHealthByPartner: cache read failed: ' + e);
      }
    }

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

    var split = CoreTrends._splitHealthConcentrationRows_(rows, 'partner', '(Unassigned)');

    Logger.log('CoreTrends.getHealthByPartner: ' + split.visibleRows.length + ' visible partner rows, ' +
               split.hiddenAllGreen.count + ' all-Green partners hidden');

    var _result_ = {
      rows:             split.visibleRows,
      totalDeployments: totalDeployments,
      hiddenAllGreenPartners: {
        count:            split.hiddenAllGreen.count,
        deploymentCount:  split.hiddenAllGreen.deploymentCount,
        partners:         split.hiddenAllGreen.names
      },
      dataIntegrity:    { unassignedCount: unassignedCount, showDisclaimer: unassignedCount > 0 }
    };
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getHealthByPartner: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getHealthByPartner: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // 4. HEALTH BY DELIVERY DIRECTOR
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {CacheService=} cache
   * @return {Object}
   */
  getHealthByDeliveryDirector: function (cfg, viewModeOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:healthByDeliveryDirector:' + cfg.appId + ':' +
                 CoreTrends._buildViewModeKey_(viewModeOpts);
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getHealthByDeliveryDirector: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getHealthByDeliveryDirector: cache read failed: ' + e);
      }
    }

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
      else if (h === 'Red')    {
        byDD[dd].red++;
        byDD[dd].redDeploymentIds.push(CoreTrends.resolveHistoryDeploymentId_(dep) || dep.deploymentId);
      }
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

    var split = CoreTrends._splitHealthConcentrationRows_(rows, 'deliveryDirector', '(Unassigned)');

    Logger.log('CoreTrends.getHealthByDeliveryDirector: ' + split.visibleRows.length + ' visible DD rows, ' +
               split.hiddenAllGreen.count + ' all-Green DDs hidden');

    var _result_ = {
      rows:             split.visibleRows,
      totalDeployments: totalDeployments,
      hiddenAllGreenDeliveryDirectors: {
        count:              split.hiddenAllGreen.count,
        deploymentCount:    split.hiddenAllGreen.deploymentCount,
        deliveryDirectors:  split.hiddenAllGreen.names
      },
      dataIntegrity:    { unassignedCount: unassignedCount, showDisclaimer: unassignedCount > 0 }
    };
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getHealthByDeliveryDirector: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getHealthByDeliveryDirector: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // 5. TIME IN STAGE METRICS
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {CacheService=} cache
   * @return {Object}
   */
  getTimeInStageMetrics: function (cfg, viewModeOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:timeInStage:' + cfg.appId + ':' +
                 CoreTrends._buildViewModeKey_(viewModeOpts);
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getTimeInStageMetrics: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getTimeInStageMetrics: cache read failed: ' + e);
      }
    }

    Logger.log('CoreTrends.getTimeInStageMetrics: start');

    var CANONICAL_STAGES = [
      'On-Boarding', 'Plan', 'Architect & Configure', 'Test', 'Deploy', 'Post Prod'
    ];
    var stageRank = {};
    CANONICAL_STAGES.forEach(function (s, i) { stageRank[s] = i; });

    var outlierMultiple  = (cfg.trends && cfg.trends.timeInStageOutlierMultiple)  ||
                           (cfg.salesforce && cfg.salesforce.timeInStageOutlierMultiple) || 2;
    var minSampleSize    = (cfg.trends && cfg.trends.timeInStageMinSampleSize)     ||
                           (cfg.salesforce && cfg.salesforce.timeInStageMinSampleSize)  || 10;

    // Current state per Active deployment.
    var activeDeployments;
    try {
      activeDeployments = CoreData.getAllDeployments(cfg, viewModeOpts);
    } catch (e) {
      Logger.log('CoreTrends.getTimeInStageMetrics: getAllDeployments failed: ' + e);
      activeDeployments = [];
    }

    var currentStateByDeployment = [];
    var portfolioScope;
    try {
      portfolioScope = CoreTrends.buildPortfolioHistoryParentIdSet_(cfg, viewModeOpts);
    } catch (e) {
      portfolioScope = { parentIds: {} };
    }

    activeDeployments.forEach(function (dep) {
      var cur;
      var historyParentId = CoreTrends.resolveHistoryDeploymentId_(dep) || dep.deploymentId;
      try {
        cur = CoreHistory.getCurrentStateDuration(cfg, historyParentId, 'Deployment_Stage__c');
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
      if (!CoreTrends._isInPortfolioHistoryScope_(depId, portfolioScope.parentIds)) return;

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
        p90Days:     durations.length > 0 ? Math.round(CoreTrends._percentile_(durations, 0.9)) : null,
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
          deploymentName:           row.deploymentName || '',
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

    var _result_ = {
      currentStateByDeployment: currentStateByDeployment,
      stageBenchmarks:          stageBenchmarks,
      outliers:                 outliers
    };
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getTimeInStageMetrics: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getTimeInStageMetrics: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // 6. TIME TO GO-LIVE METRICS
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {CacheService=} cache
   * @return {Object}
   */
  getTimeToGoLiveMetrics: function (cfg, viewModeOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:timeToGoLive:' + cfg.appId + ':' +
                 CoreTrends._buildViewModeKey_(viewModeOpts);
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getTimeToGoLiveMetrics: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getTimeToGoLiveMetrics: cache read failed: ' + e);
      }
    }

    Logger.log('CoreTrends.getTimeToGoLiveMetrics: start');

    var today = CoreTrends._todayStr_();
    var windowMonths = (cfg.trends && cfg.trends.trendsWindowMonths) ||
                       (cfg.salesforce && cfg.salesforce.trendsWindowMonths) || 12;

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
      var historyParentId = CoreTrends.resolveHistoryDeploymentId_(dep);
      if (!historyParentId) return;

      var startDate = dep.startDate || dep.deploymentStartDate || '';
      if (!startDate) {
        // Fallback: try to get start date from history (first event date).
        var histMap = CoreHistory.getHistoryMap(cfg);
        var entry   = histMap[historyParentId];
        if (entry && entry.events && entry.events.length > 0) {
          startDate = CoreHistory._toDateOnly_(entry.events[0].at,
                                               Session.getScriptTimeZone());
        }
      }

      var mtpEntry;
      try { mtpEntry = CoreHistory.getCurrentMTPDate(cfg, historyParentId); } catch (e) {}
      var currentMtpDate = (mtpEntry && mtpEntry.date) ? mtpEntry.date : '';
      if (!currentMtpDate) {
        var targetEntry = CoreTrends._getCurrentAvailableDateField_(
          cfg, historyParentId, 'Target_Project_Completion_Date__c');
        currentMtpDate = targetEntry ? targetEntry.date
          : (dep.mtpDate || dep.targetProjectCompletionDate || '');
      }

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

    var _result_ = {
      activeInFlight:    activeInFlight,
      overdueDeployments: overdueDeployments,
      benchmarkStats:    benchmarkStats
    };
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getTimeToGoLiveMetrics: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getTimeToGoLiveMetrics: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // 7. GO-LIVE OUTCOME PATTERNS
  // ===========================================================================

  /**
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {CacheService=} cache
   * @return {Object}
   */
  getGoLiveOutcomePatterns: function (cfg, viewModeOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var _ttl_ = (cfg.trends && cfg.trends.cacheTtlSeconds) || 3600;
    var _cKey_ = 'trends:goLiveOutcome:' + cfg.appId + ':' +
                 CoreTrends._buildViewModeKey_(viewModeOpts);
    if (cache) {
      try {
        var _hit_ = cache.get(_cKey_);
        if (_hit_) {
          Logger.log('CoreTrends.getGoLiveOutcomePatterns: cache HIT (' + _cKey_ + ')');
          return JSON.parse(_hit_);
        }
      } catch (e) {
        Logger.log('CoreTrends.getGoLiveOutcomePatterns: cache read failed: ' + e);
      }
    }

    Logger.log('CoreTrends.getGoLiveOutcomePatterns: start');

    var windowMonths = (cfg.trends && cfg.trends.trendsWindowMonths) ||
                       (cfg.salesforce && cfg.salesforce.trendsWindowMonths) || 12;
    var byPartnerMin = (cfg.trends && cfg.trends.byPartnerMinSampleSize) ||
                       (cfg.salesforce && cfg.salesforce.byPartnerMinSampleSize) || 5;
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
      var historyParentId = CoreTrends.resolveHistoryDeploymentId_(dep) || dep.deploymentId;

      var mtpHistory;
      try {
        mtpHistory = CoreHistory.getMTPDateHistory(cfg, historyParentId);
      } catch (e) {
        mtpHistory = [];
      }
      if (!mtpHistory || mtpHistory.length === 0) {
        mtpHistory = CoreTrends._getAvailableDateFieldHistory_(
          cfg, historyParentId, 'Target_Project_Completion_Date__c');
      }

      var actualGoLive = dep.firstMtpActual || dep.lastGoLiveDate || '';
      if (!actualGoLive) {
        var prodEntry = CoreTrends._getCurrentAvailableDateField_(
          cfg, historyParentId, 'First_Move_to_Production_Date_Actual__c');
        if (!prodEntry) {
          prodEntry = CoreTrends._getCurrentAvailableDateField_(
            cfg, historyParentId, 'Production_Move_Date_Earliest__c');
        }
        if (!prodEntry) {
          prodEntry = CoreTrends._getCurrentAvailableDateField_(
            cfg, historyParentId, 'Deployment_Completion_Date__c');
        }
        actualGoLive = prodEntry ? prodEntry.date : '';
      }
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
      var approach = CoreTrends._resolveDeploymentApproach_(dep);
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

    var approachDiagnostics = CoreTrends._buildApproachDiagnostics_(byApproach, sampleSize);

    Logger.log('CoreTrends.getGoLiveOutcomePatterns: sampleSize=' + sampleSize +
               ', onTime=' + onTimeOrEarlyCount + ', slipped=' + slippedCount +
               ', approachUnknownPct=' + approachDiagnostics.unknownApproachPct + '%');

    var _result_ = {
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
      byApproach:           byApproach,
      byPartner:            byPartner,
      recentCompletions:    recentCompletions,
      approachDiagnostics:  approachDiagnostics
    };
    if (cache) {
      try {
        var _json_ = JSON.stringify(_result_);
        cache.put(_cKey_, _json_, _ttl_);
        Logger.log('CoreTrends.getGoLiveOutcomePatterns: cache MISS, wrote ' + _json_.length + ' chars');
      } catch (e) {
        Logger.log('CoreTrends.getGoLiveOutcomePatterns: cache write failed (likely >100KB): ' + e);
      }
    }
    return _result_;
  },

  // ===========================================================================
  // TRENDS V1 BUNDLED BACKEND + DIAGNOSTICS
  // ===========================================================================

  /** @const {number} Warn when UI payload JSON exceeds this size (bytes). */
  _TRENDS_UI_PAYLOAD_WARN_BYTES_: 200 * 1024,

  /** @const {number} Skip optional heavy sections after this elapsed ms. */
  _TRENDS_UI_TIME_BUDGET_MS_: 45000,

  /**
   * Returns a zeroed completion-trend section for partial UI payloads.
   * @return {Object}
   * @private
   */
  _emptyCompletionTrendForUi_: function () {
    return {
      label: 'Completion / Go-Live Trend',
      windowMonths: 12,
      sampleSize: 0,
      onTimeOrEarlyCount: 0,
      slippedCount: 0,
      onTimePct: 0,
      avgSlippageDays: 0,
      medianSlippageDays: 0,
      targetDateMovementDistribution: {},
      recentCompletions: []
    };
  },

  /**
   * Deep-clones a Trends payload and converts Date values to ISO strings.
   * @param {Object} obj
   * @return {Object}
   * @private
   */
  _ensureTrendsSerializable_: function (obj) {
    return JSON.parse(JSON.stringify(obj, function (_key, val) {
      if (val instanceof Date) return val.toISOString();
      return val;
    }));
  },

  /**
   * Builds schedule-movement summary counts for compact UI payloads.
   * @param {Array<Object>} inFlight
   * @param {string} changeCountKey
   * @return {{ inFlightCount: number, overdueCount: number, withChangesCount: number, onTrackCount: number }}
   * @private
   */
  _trendsMovementSummaryCounts_: function (inFlight, changeCountKey) {
    inFlight = inFlight || [];
    var overdueCount = 0;
    var withChangesCount = 0;
    var onTrackCount = 0;
    inFlight.forEach(function (d) {
      var changes = d[changeCountKey] || 0;
      if (changes > 0) withChangesCount++;
      if (d.isOverdue) overdueCount++;
      else if (changes > 0) onTrackCount++;
    });
    return {
      inFlightCount: inFlight.length,
      overdueCount: overdueCount,
      withChangesCount: withChangesCount,
      onTrackCount: onTrackCount
    };
  },

  /**
   * Compacts a raw Trends dashboard payload for google.script.run transport.
   * Omits verbose diagnostics, caps list sizes, and strips non-render fields.
   *
   * @param {Object} raw
   * @param {Array<string>} warnings
   * @return {Object}
   * @private
   */
  _compactTrendsDashboardPayload_: function (raw, warnings) {
    warnings = warnings || [];
    var caps = {
      partnerRows: 20,
      ddRows: 20,
      outliers: 10,
      redDeployments: 10,
      recentCompletions: 15,
      sampleArrays: 5
    };

    var pc = raw.productContext || {};
    var productContext = {
      enabled: !!pc.enabled,
      productAreaCount: pc.productAreaCount || 0,
      functionCount: pc.functionCount || 0,
      productAreas: (pc.productAreas || []).slice(0, caps.sampleArrays),
      functions: (pc.functions || []).slice(0, caps.sampleArrays),
      sampleProductFunctions: (pc.sampleProductFunctions || []).slice(0, caps.sampleArrays)
    };

    var ic = raw.industryContext || {};
    var industryContext = {
      enabled: !!ic.enabled,
      industryCount: ic.industryCount || 0,
      regionCount: ic.regionCount || 0,
      subRegionCount: ic.subRegionCount || 0,
      industries: (ic.industries || []).slice(0, caps.sampleArrays),
      regions: (ic.regions || []).slice(0, caps.sampleArrays),
      subRegions: (ic.subRegions || []).slice(0, caps.sampleArrays)
    };

    var hs = raw.historySummary || {};
    var historySummary = {
      sheetExists: !!hs.sheetExists,
      historyRowCount: hs.historyRowCount || 0,
      historyEventCount: hs.historyEventCount || 0,
      distinctParentIds: hs.distinctParentIds || 0,
      matchedParentIds: hs.matchedParentIds || 0,
      unmatchedPortfolioParentIds: hs.unmatchedPortfolioParentIds || 0,
      unmatchedHistoryParentIds: hs.unmatchedHistoryParentIds || 0,
      minCreatedDate: hs.minCreatedDate || null,
      maxCreatedDate: hs.maxCreatedDate || null
    };

    var tir = raw.timeInRed || {};
    var timeInRed = {
      aggregates: tir.aggregates || {},
      historicalAggregates: tir.historicalAggregates || {},
      currentRedDeployments: (tir.currentRedDeployments || []).slice(0, caps.redDeployments).map(function (r) {
        return {
          deploymentId: String(r.deploymentId || ''),
          accountName: String(r.accountName || ''),
          deploymentName: String(r.deploymentName || ''),
          currentDurationDays: r.currentDurationDays || 0
        };
      })
    };

    var tis = raw.timeInStage || {};
    var timeInStage = {
      stageBenchmarks: tis.stageBenchmarks || [],
      outliers: (tis.outliers || []).slice(0, caps.outliers).map(function (o) {
        return {
          accountName: String(o.accountName || ''),
          currentStage: String(o.currentStage || ''),
          currentStageDurationDays: o.currentStageDurationDays || 0,
          multipleOfMedian: o.multipleOfMedian || 0
        };
      }),
      currentStateByDeployment: (tis.currentStateByDeployment || []).map(function (d) {
        return { currentStage: String(d.currentStage || 'Unknown') };
      })
    };

    var tdm = raw.targetDateMovement || {};
    var tCounts = CoreTrends._trendsMovementSummaryCounts_(tdm.inFlight, 'targetDateChangeCount');
    var targetDateMovement = {
      label: tdm.label || 'Target Date Movement',
      movementDistribution: tdm.movementDistribution || {},
      sampleSize: tdm.sampleSize || tCounts.inFlightCount,
      inFlightCount: tCounts.inFlightCount,
      overdueCount: tCounts.overdueCount,
      withChangesCount: tCounts.withChangesCount,
      onTrackCount: tCounts.onTrackCount
    };

    var pdm = raw.productionDateMovement || {};
    var pCounts = CoreTrends._trendsMovementSummaryCounts_(pdm.inFlight, 'productionDateChangeCount');
    var productionDateMovement = {
      label: pdm.label || 'Production Date Movement',
      movementDistribution: pdm.movementDistribution || {},
      sampleSize: pdm.sampleSize || pCounts.inFlightCount,
      inFlightCount: pCounts.inFlightCount,
      withChangesCount: pCounts.withChangesCount
    };

    var ct = raw.completionTrend || {};
    var completionTrend = {
      label: ct.label || 'Completion / Go-Live Trend',
      windowMonths: ct.windowMonths || 12,
      sampleSize: ct.sampleSize || 0,
      onTimeOrEarlyCount: ct.onTimeOrEarlyCount || 0,
      slippedCount: ct.slippedCount || 0,
      onTimePct: ct.onTimePct || 0,
      avgSlippageDays: ct.avgSlippageDays || 0,
      medianSlippageDays: ct.medianSlippageDays || 0,
      targetDateMovementDistribution: ct.targetDateMovementDistribution || ct.mtpDateMovementDistribution || {},
      recentCompletions: (ct.recentCompletions || []).slice(0, caps.recentCompletions).map(function (r) {
        return {
          deploymentId: String(r.deploymentId || ''),
          accountName: String(r.accountName || ''),
          completionDate: String(r.completionDate || r.actualGoLive || ''),
          slippageDays: r.slippageDays != null ? r.slippageDays : r.baselineSlippageDays,
          targetDateChangeCount: r.targetDateChangeCount != null ? r.targetDateChangeCount : r.mtpDateChangeCount
        };
      })
    };

    var hbp = raw.healthByPartner || {};
    var hiddenP = hbp.hiddenAllGreenPartners || {};
    var healthByPartner = {
      rows: (hbp.rows || []).slice(0, caps.partnerRows),
      totalDeployments: hbp.totalDeployments || 0,
      hiddenAllGreenPartners: {
        count: hiddenP.count || 0,
        deploymentCount: hiddenP.deploymentCount || 0,
        partners: (hiddenP.partners || hiddenP.names || []).slice(0, caps.sampleArrays)
      },
      dataIntegrity: hbp.dataIntegrity || {}
    };

    var hdd = raw.healthByDeliveryDirector || {};
    var hiddenD = hdd.hiddenAllGreenDeliveryDirectors || {};
    var healthByDeliveryDirector = {
      rows: (hdd.rows || []).slice(0, caps.ddRows),
      totalDeployments: hdd.totalDeployments || 0,
      hiddenAllGreenDeliveryDirectors: {
        count: hiddenD.count || 0,
        deploymentCount: hiddenD.deploymentCount || 0,
        deliveryDirectors: (hiddenD.deliveryDirectors || hiddenD.names || []).slice(0, caps.sampleArrays)
      },
      dataIntegrity: hdd.dataIntegrity || {}
    };

    var ht = raw.healthTrend || {};
    var healthTrend = {
      points: (ht.points || []).map(function (pt) {
        return {
          label: String(pt.label || pt.reportMonth || ''),
          reportMonth: String(pt.reportMonth || pt.label || ''),
          green: pt.green || 0,
          yellow: pt.yellow || 0,
          red: pt.red || 0,
          total: pt.total || 0,
          greenPct: pt.greenPct || 0,
          yellowPct: pt.yellowPct || 0,
          redPct: pt.redPct || 0
        };
      }),
      deltaSinceBaseline: ht.deltaSinceBaseline || null,
      baselineCounts: ht.baselineCounts || null,
      currentCounts: ht.currentCounts || null
    };

    return {
      ok: raw.ok !== false,
      partial: !!raw.partial,
      appId: String(raw.appId || ''),
      generatedAt: String(raw.generatedAt || new Date().toISOString()),
      trendsEnabled: !!raw.trendsEnabled,
      layoutMode: raw.layoutMode || 'industry',
      productContext: productContext,
      industryContext: industryContext,
      historySummary: historySummary,
      kpis: raw.kpis || {},
      healthTrend: healthTrend,
      timeInRed: timeInRed,
      healthByPartner: healthByPartner,
      healthByDeliveryDirector: healthByDeliveryDirector,
      timeInStage: timeInStage,
      targetDateMovement: targetDateMovement,
      productionDateMovement: productionDateMovement,
      completionTrend: completionTrend,
      warnings: (raw.warnings || []).concat(warnings)
    };
  },

  /**
   * Returns bundled Trends v1 payload in a single Apps Script execution.
   * Builds historyMap once; compacts and serializes the UI payload before return.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {CacheService=} cache  Optional script cache for metric sub-calls.
   * @return {Object}
   */
  getTrendsDashboardData: function (cfg, viewModeOpts, productOpts, cache) {
    cfg = CoreConfig.withDefaults(cfg);
    var t0 = Date.now();
    var warnings = [];
    var timing = {};
    var partial = false;
    var scriptCache = cache;
    try {
      scriptCache = scriptCache || CacheService.getScriptCache();
    } catch (e) {
      scriptCache = null;
    }

    try {
      var tScope = Date.now();
      var scope = CoreTrends.buildPortfolioHistoryParentIdSet_(cfg, viewModeOpts, productOpts);
      timing.buildScopeMs = Date.now() - tScope;

      var tHistoryStart = Date.now();
      var historyMap = CoreHistory.getHistoryMap(cfg);
      timing.getHistoryMapMs = Date.now() - tHistoryStart;

      var tSummary = Date.now();
      var historySummary = CoreTrends._buildHistorySummary_(cfg, historyMap, scope, warnings);
      timing.historySummaryMs = Date.now() - tSummary;

      var tRed = Date.now();
      var timeInRed = CoreTrends.getTimeInRedMetrics(cfg, viewModeOpts, scriptCache);
      timing.timeInRedMs = Date.now() - tRed;

      var tHealth = Date.now();
      var healthTrend = CoreTrends.getHealthTrajectory(cfg, scriptCache);
      timing.healthTrajectoryMs = Date.now() - tHealth;

      var tPartner = Date.now();
      var healthByPartner = CoreTrends.getHealthByPartner(cfg, viewModeOpts, scriptCache);
      timing.healthByPartnerMs = Date.now() - tPartner;

      var tDd = Date.now();
      var healthByDeliveryDirector = CoreTrends.getHealthByDeliveryDirector(cfg, viewModeOpts, scriptCache);
      timing.healthByDeliveryDirectorMs = Date.now() - tDd;

      var timeInStage = { currentStateByDeployment: [], stageBenchmarks: [], outliers: [] };
      var targetDateMovement = {
        label: 'Target Date Movement',
        movementDistribution: {},
        inFlight: [],
        sampleSize: 0
      };
      var productionDateMovement = {
        label: 'Production Date Movement',
        movementDistribution: {},
        inFlight: [],
        sampleSize: 0
      };
      var completionTrend = CoreTrends._emptyCompletionTrendForUi_();

      var elapsed = Date.now() - t0;
      if (elapsed < CoreTrends._TRENDS_UI_TIME_BUDGET_MS_) {
        var tStage = Date.now();
        timeInStage = CoreTrends.getTimeInStageMetrics(cfg, viewModeOpts, scriptCache);
        timing.timeInStageMs = Date.now() - tStage;
      } else {
        partial = true;
        warnings.push('Time-in-stage metrics were omitted due to runtime constraints.');
      }

      elapsed = Date.now() - t0;
      if (elapsed < CoreTrends._TRENDS_UI_TIME_BUDGET_MS_) {
        var tTarget = Date.now();
        targetDateMovement = CoreTrends._buildTargetDateMovementMetrics_(
          cfg, scope, historyMap, viewModeOpts, warnings, historySummary);
        timing.targetDateMovementMs = Date.now() - tTarget;

        var tProd = Date.now();
        productionDateMovement = CoreTrends._buildProductionDateMovementMetrics_(
          cfg, scope, historyMap, viewModeOpts, warnings);
        timing.productionDateMovementMs = Date.now() - tProd;
      } else {
        partial = true;
        warnings.push('Schedule movement metrics were omitted due to runtime constraints.');
      }

      elapsed = Date.now() - t0;
      if (elapsed < CoreTrends._TRENDS_UI_TIME_BUDGET_MS_) {
        var tCompletion = Date.now();
        completionTrend = CoreTrends._buildCompletionTrendMetrics_(
          cfg, scope, historyMap, viewModeOpts, productOpts, warnings);
        timing.completionTrendMs = Date.now() - tCompletion;
      } else {
        partial = true;
        warnings.push('Completion trend metrics were omitted due to runtime constraints.');
      }

      var kpis = CoreTrends._buildTrendsKpis_(
        scope, historySummary, timeInRed, targetDateMovement, completionTrend);

      var rawPayload = {
        ok: true,
        partial: partial,
        appId: cfg.appId || '',
        generatedAt: new Date().toISOString(),
        trendsEnabled: !!(cfg.ui && cfg.ui.trendsTab && cfg.ui.trendsTab.enabled),
        layoutMode: scope.layoutMode,
        productContext: scope.productContext,
        industryContext: scope.industryContext,
        historySummary: historySummary,
        kpis: kpis,
        healthTrend: healthTrend,
        timeInRed: timeInRed,
        healthByPartner: healthByPartner,
        healthByDeliveryDirector: healthByDeliveryDirector,
        timeInStage: timeInStage,
        targetDateMovement: targetDateMovement,
        productionDateMovement: productionDateMovement,
        completionTrend: completionTrend,
        warnings: warnings
      };

      var tCompact = Date.now();
      var payload = CoreTrends._compactTrendsDashboardPayload_(rawPayload, []);
      timing.compactMs = Date.now() - tCompact;

      payload = CoreTrends._ensureTrendsSerializable_(payload);
      var payloadJson = JSON.stringify(payload);
      var payloadBytes = payloadJson.length;
      payload.payloadBytes = payloadBytes;
      timing.payloadBytes = payloadBytes;
      timing.totalMs = Date.now() - t0;

      if (payloadBytes > CoreTrends._TRENDS_UI_PAYLOAD_WARN_BYTES_) {
        warnings.push('UI payload exceeds 200KB (' + payloadBytes + ' bytes).');
        Logger.log('CoreTrends.getTrendsDashboardData: WARNING payload size ' + payloadBytes + ' bytes');
      }

      payload.warnings = warnings;
      payload.timing = timing;

      Logger.log('CoreTrends.getTrendsDashboardData: completed in ' + timing.totalMs + 'ms ' +
        '(historyMap=' + timing.getHistoryMapMs + 'ms, payloadBytes=' + payloadBytes +
        ', deploymentsTrended=' + (kpis.deploymentsTrended || 0) +
        (partial ? ', partial=true' : '') + ')');

      return payload;
    } catch (err) {
      timing.totalMs = Date.now() - t0;
      Logger.log('CoreTrends.getTrendsDashboardData: error — ' + err);
      return {
        ok: false,
        error: String(err),
        code: 'TRENDS_DASHBOARD_FAILED',
        timing: timing,
        warnings: warnings
      };
    }
  },

  /**
   * Diagnostic: Trends v1 backend readiness for ProductMode and IndustryMode apps.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  debugTrendsReadiness: function (cfg, viewModeOpts, productOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    var t0 = Date.now();
    var warnings = [];
    var diagnostic = {
      ok: true,
      diagnostic: 'debugTrendsReadiness',
      appId: cfg.appId || 'unknown',
      generatedAt: new Date().toISOString(),
      layoutMode: 'industry',
      trendsTabEnabled: !!(cfg.ui && cfg.ui.trendsTab && cfg.ui.trendsTab.enabled),
      trendsTabInUiTabs: false,
      deploymentHistorySheetName: (cfg.sheets && cfg.sheets.deploymentHistory) || 'SFDC_DeploymentHistory',
      sheetExists: false,
      historyRowCount: 0,
      distinctParentIdCount: 0,
      historyFieldCounts: {},
      minCreatedDate: null,
      maxCreatedDate: null,
      portfolioRowsChecked: 0,
      portfolioRowsWithResolvedParentId: 0,
      portfolioRowsMissingResolvedParentId: 0,
      portfolioRowsResolvedButNoHistory: 0,
      portfolioParentIdCount: 0,
      matchedParentIdCount: 0,
      unmatchedPortfolioParentIdCount: 0,
      unmatchedPortfolioParentIdsWithNoHistory: 0,
      resolverFailureCount: 0,
      historyCoveragePct: 0,
      unmatchedHistoryParentIdCount: 0,
      sampleRowsMissingResolvedParentId: [],
      sampleResolvedButNoHistory: [],
      sampleMatched: [],
      productContext: {
        enabled: false,
        productAreaCount: 0,
        functionCount: 0,
        sampleProductFunctions: []
      },
      industryContext: {
        enabled: false,
        industryCount: 0,
        regionCount: 0,
        subRegionCount: 0,
        industries: [],
        regions: [],
        subRegions: []
      },
      resolverSamples: [],
      fieldAvailability: {},
      warnings: warnings,
      getHistoryMapMs: 0,
      totalMs: 0
    };

    try {
      diagnostic.layoutMode = CoreTrends._getLayoutMode_(cfg);
      var uiTabs = (cfg.ui && cfg.ui.tabs) || [];
      diagnostic.trendsTabInUiTabs = uiTabs.indexOf('trends') !== -1;

      var scope = CoreTrends.buildPortfolioHistoryParentIdSet_(cfg, viewModeOpts, productOpts);
      diagnostic.layoutMode = scope.layoutMode;
      diagnostic.productContext = scope.productContext;
      diagnostic.industryContext = scope.industryContext;

      var tHistoryStart = Date.now();
      var historyMap = CoreHistory.getHistoryMap(cfg);
      diagnostic.getHistoryMapMs = Date.now() - tHistoryStart;

      var historySummary = CoreTrends._buildHistorySummary_(cfg, historyMap, scope, warnings);
      var readiness = CoreTrends._buildPortfolioReadinessDiagnostics_(scope, historyMap);

      diagnostic.sheetExists = historySummary.sheetExists;
      diagnostic.historyRowCount = historySummary.historyRowCount;
      diagnostic.distinctParentIdCount = historySummary.distinctParentIds;
      diagnostic.historyFieldCounts = historySummary.fieldCounts;
      diagnostic.minCreatedDate = historySummary.minCreatedDate;
      diagnostic.maxCreatedDate = historySummary.maxCreatedDate;
      diagnostic.unmatchedHistoryParentIdCount = historySummary.unmatchedHistoryParentIds;

      diagnostic.portfolioRowsChecked = readiness.portfolioRowsChecked;
      diagnostic.portfolioRowsWithResolvedParentId = readiness.portfolioRowsWithResolvedParentId;
      diagnostic.portfolioRowsMissingResolvedParentId = readiness.portfolioRowsMissingResolvedParentId;
      diagnostic.portfolioRowsResolvedButNoHistory = readiness.portfolioRowsResolvedButNoHistory;
      diagnostic.portfolioParentIdCount = readiness.portfolioParentIdCount;
      diagnostic.matchedParentIdCount = readiness.matchedParentIdCount;
      diagnostic.unmatchedPortfolioParentIdCount = readiness.unmatchedPortfolioParentIdCount;
      diagnostic.unmatchedPortfolioParentIdsWithNoHistory = readiness.unmatchedPortfolioParentIdsWithNoHistory;
      diagnostic.resolverFailureCount = readiness.resolverFailureCount;
      diagnostic.historyCoveragePct = readiness.historyCoveragePct;
      diagnostic.sampleRowsMissingResolvedParentId = readiness.sampleRowsMissingResolvedParentId;
      diagnostic.sampleResolvedButNoHistory = readiness.sampleResolvedButNoHistory;
      diagnostic.sampleMatched = readiness.sampleMatched;

      diagnostic.fieldAvailability = CoreTrends._getRecommendedFieldAvailability_(
        historySummary.fieldCounts, warnings);

      diagnostic.resolverSamples = CoreTrends._buildResolverSamples_(scope.deployments, historyMap, 5);

      if (!diagnostic.fieldAvailability['Current_MTP_Date__c']) {
        warnings.push('Current_MTP_Date__c not present in history — non-blocking; using Target_Project_Completion_Date__c.');
      }
      if (!diagnostic.fieldAvailability['Baseline_MTP_Date__c']) {
        warnings.push('Baseline_MTP_Date__c not present in history — non-blocking.');
      }
      if (diagnostic.resolverFailureCount > 0) {
        warnings.push('Some portfolio rows could not resolve a parent deployment ID for history join (' +
          diagnostic.resolverFailureCount + ' of ' + diagnostic.portfolioRowsChecked + ' rows).');
      }
      if (diagnostic.unmatchedPortfolioParentIdsWithNoHistory > 0) {
        warnings.push('Some portfolio parent deployments have no matching history events in SFDC_DeploymentHistory. ' +
          'This is expected when deployments have no tracked field changes in the selected history window (' +
          diagnostic.unmatchedPortfolioParentIdsWithNoHistory + ' of ' + diagnostic.portfolioParentIdCount +
          ' parent IDs, ' + (100 - diagnostic.historyCoveragePct).toFixed(1) + '% without history).');
      }
      if (diagnostic.matchedParentIdCount === 0 && diagnostic.portfolioParentIdCount > 0) {
        warnings.push('Zero portfolio parent IDs matched history ParentId values.');
      }

      diagnostic.totalMs = Date.now() - t0;

      Logger.log('=== Trends Readiness Debug ===');
      Logger.log('appId: ' + diagnostic.appId);
      Logger.log('layoutMode: ' + diagnostic.layoutMode);
      Logger.log('trendsTabEnabled: ' + diagnostic.trendsTabEnabled);
      Logger.log('trends tab in ui.tabs: ' + diagnostic.trendsTabInUiTabs);
      Logger.log('history sheet: ' + diagnostic.deploymentHistorySheetName +
        ' (exists=' + diagnostic.sheetExists + ', rows=' + diagnostic.historyRowCount + ')');
      Logger.log('distinct ParentIds: ' + diagnostic.distinctParentIdCount);
      Logger.log('portfolio rows: checked=' + diagnostic.portfolioRowsChecked +
        ', resolved=' + diagnostic.portfolioRowsWithResolvedParentId +
        ', resolverFailures=' + diagnostic.resolverFailureCount +
        ', resolvedNoHistory=' + diagnostic.portfolioRowsResolvedButNoHistory);
      Logger.log('portfolio parent IDs: ' + diagnostic.portfolioParentIdCount +
        ', matched=' + diagnostic.matchedParentIdCount +
        ', noHistory=' + diagnostic.unmatchedPortfolioParentIdsWithNoHistory +
        ', coverage=' + diagnostic.historyCoveragePct + '%' +
        ', unmatched history=' + diagnostic.unmatchedHistoryParentIdCount);
      Logger.log('product areas: ' + diagnostic.productContext.productAreaCount +
        ', functions: ' + diagnostic.productContext.functionCount);
      if (diagnostic.industryContext && diagnostic.industryContext.enabled) {
        Logger.log('industries: ' + diagnostic.industryContext.industryCount +
          ', regions: ' + diagnostic.industryContext.regionCount +
          ', sub-regions: ' + diagnostic.industryContext.subRegionCount);
      }
      Logger.log('getHistoryMapMs: ' + diagnostic.getHistoryMapMs +
        ', totalMs: ' + diagnostic.totalMs);
      if (warnings.length) {
        Logger.log('warnings: ' + warnings.join(' | '));
      }
    } catch (err) {
      diagnostic.ok = false;
      diagnostic.error = String(err);
      diagnostic.totalMs = Date.now() - t0;
      Logger.log('CoreTrends.debugTrendsReadiness: error — ' + diagnostic.error);
    }

    return diagnostic;
  },

  /**
   * Diagnostic: run bundled Trends dashboard and report section sizes / timing.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  debugTrendsDashboardData: function (cfg, viewModeOpts, productOpts) {
    var t0 = Date.now();
    var result = {
      ok: true,
      diagnostic: 'debugTrendsDashboardData',
      appId: (cfg && cfg.appId) ? String(cfg.appId) : 'unknown',
      generatedAt: new Date().toISOString(),
      dashboardOk: false,
      sectionCounts: {},
      timing: {},
      warnings: [],
      totalMs: 0
    };

    try {
      var payload = CoreTrends.getTrendsDashboardData(cfg, viewModeOpts, productOpts);
      result.dashboardOk = !!payload.ok;
      result.timing = payload.timing || {};
      result.warnings = payload.warnings || [];
      result.payloadBytes = payload.payloadBytes || 0;
      result.sectionCounts = {
        currentRed: ((payload.timeInRed || {}).currentRedDeployments || []).length,
        healthTrajectoryPoints: ((payload.healthTrend || {}).points || []).length,
        healthByPartnerRows: ((payload.healthByPartner || {}).rows || []).length,
        hiddenAllGreenPartners: ((payload.healthByPartner || {}).hiddenAllGreenPartners || {}).count || 0,
        healthByDeliveryDirectorRows: ((payload.healthByDeliveryDirector || {}).rows || []).length,
        hiddenAllGreenDeliveryDirectors:
          ((payload.healthByDeliveryDirector || {}).hiddenAllGreenDeliveryDirectors || {}).count || 0,
        timeInStageActive: ((payload.timeInStage || {}).currentStateByDeployment || []).length,
        timeInStageOutliers: ((payload.timeInStage || {}).outliers || []).length,
        targetDateInFlight: (payload.targetDateMovement || {}).inFlightCount ||
          ((payload.targetDateMovement || {}).inFlight || []).length,
        productionDateInFlight: (payload.productionDateMovement || {}).inFlightCount ||
          ((payload.productionDateMovement || {}).inFlight || []).length,
        completionSampleSize: (payload.completionTrend || {}).sampleSize || 0,
        partial: !!payload.partial
      };
      Logger.log('CoreTrends.debugTrendsDashboardData: payloadBytes=' + result.payloadBytes +
        ', sectionCounts=' + JSON.stringify(result.sectionCounts));
    } catch (err) {
      result.ok = false;
      result.error = String(err);
      Logger.log('CoreTrends.debugTrendsDashboardData: error — ' + result.error);
    }

    result.totalMs = Date.now() - t0;
    return result;
  },

  /**
   * Returns zeroed health trajectory delta fields.
   * @return {Object}
   * @private
   */
  _emptyHealthTrajectoryDelta_: function () {
    return {
      greenPctChange: 0, redPctChange: 0, yellowPctChange: 0,
      greenCountChange: 0, redCountChange: 0, yellowCountChange: 0
    };
  },

  /**
   * Builds trajectory delta payload from baseline and current snapshot points.
   *
   * @param {Object} baselinePt
   * @param {Object} currentPt
   * @param {boolean} hasDeltaWindow  True when at least two monthly points exist.
   * @return {{ deltaSinceBaseline: Object, baselineCounts: Object, currentCounts: Object }}
   * @private
   */
  _buildHealthTrajectoryDelta_: function (baselinePt, currentPt, hasDeltaWindow) {
    baselinePt = baselinePt || {};
    currentPt  = currentPt  || {};
    var delta  = CoreTrends._emptyHealthTrajectoryDelta_();
    if (hasDeltaWindow) {
      delta = {
        greenPctChange:    currentPt.greenPct  - baselinePt.greenPct,
        redPctChange:      currentPt.redPct    - baselinePt.redPct,
        yellowPctChange:   currentPt.yellowPct - baselinePt.yellowPct,
        greenCountChange:  currentPt.green  - baselinePt.green,
        redCountChange:    currentPt.red    - baselinePt.red,
        yellowCountChange: currentPt.yellow - baselinePt.yellow
      };
    }
    return {
      deltaSinceBaseline: delta,
      baselineCounts: {
        green: baselinePt.green || 0,
        yellow: baselinePt.yellow || 0,
        red: baselinePt.red || 0,
        total: baselinePt.total || 0,
        label: baselinePt.label || baselinePt.reportMonth || ''
      },
      currentCounts: {
        green: currentPt.green || 0,
        yellow: currentPt.yellow || 0,
        red: currentPt.red || 0,
        total: currentPt.total || 0,
        label: currentPt.label || currentPt.reportMonth || ''
      }
    };
  },

  /**
   * Splits health concentration rows into visible (Red/Yellow exposure) vs all-Green hidden.
   *
   * @param {Array<Object>} allRows
   * @param {string} nameKey  Property holding entity name, e.g. 'partner'.
   * @param {string} unassignedLabel
   * @return {{ visibleRows: Array<Object>, hiddenAllGreen: { count: number, deploymentCount: number, names: Array<string> } }}
   * @private
   */
  _splitHealthConcentrationRows_: function (allRows, nameKey, unassignedLabel) {
    var visible = [];
    var hiddenRows = [];
    var unassignedVisible = null;
    var unassignedHidden = null;

    (allRows || []).forEach(function (row) {
      var name = String(row[nameKey] || '').trim();
      var isUnassigned = name === unassignedLabel;
      if ((row.red || 0) > 0 || (row.yellow || 0) > 0) {
        if (isUnassigned) unassignedVisible = row;
        else visible.push(row);
      } else if ((row.total || 0) > 0) {
        if (isUnassigned) unassignedHidden = row;
        else hiddenRows.push(row);
      }
    });

    visible.sort(function (a, b) { return b.total - a.total; });
    if (unassignedVisible) visible.push(unassignedVisible);

    hiddenRows.sort(function (a, b) { return b.total - a.total; });
    var hiddenNames = hiddenRows.map(function (r) { return r[nameKey]; });
    if (unassignedHidden) hiddenNames.push(unassignedLabel);

    var deploymentCount = hiddenRows.reduce(function (sum, r) { return sum + (r.total || 0); }, 0) +
      (unassignedHidden ? unassignedHidden.total : 0);

    return {
      visibleRows: visible,
      hiddenAllGreen: {
        count: hiddenRows.length + (unassignedHidden ? 1 : 0),
        deploymentCount: deploymentCount,
        names: hiddenNames
      }
    };
  },

  /**
   * Resolves deployment approach/phase label from a completion or deployment row.
   *
   * @param {Object} dep
   * @return {string}
   * @private
   */
  _resolveDeploymentApproach_: function (dep) {
    var approach = String(
      (dep && (dep.servicesApproach || dep.deploymentPhase || dep.phase)) || ''
    ).trim();
    return approach || 'Unknown';
  },

  /**
   * Builds approach distribution diagnostics for Go-Live Outcome Patterns.
   *
   * @param {Array<Object>} byApproach
   * @param {number} sampleSize
   * @return {Object}
   * @private
   */
  _buildApproachDiagnostics_: function (byApproach, sampleSize) {
    var approachCounts = {};
    var unknownApproachCount = 0;
    (byApproach || []).forEach(function (row) {
      var key = String(row.approach || 'Unknown').trim() || 'Unknown';
      approachCounts[key] = row.sampleSize || 0;
      if (key === 'Unknown') unknownApproachCount += row.sampleSize || 0;
    });
    var distinctApproaches = Object.keys(approachCounts).sort();
    var unknownApproachPct = sampleSize > 0
      ? Math.round((unknownApproachCount / sampleSize) * 1000) / 10
      : 0;
    return {
      approachCounts: approachCounts,
      unknownApproachCount: unknownApproachCount,
      unknownApproachPct: unknownApproachPct,
      distinctApproaches: distinctApproaches
    };
  },

  /**
   * Resolve raw parent deployment Salesforce ID for history joins.
   * Never returns synthetic ProductMode display IDs.
   *
   * @param {Object} row  Deployment or ProductFunction-enriched row.
   * @return {string}  Canonical parent deployment ID, or '' when unresolvable.
   */
  resolveHistoryDeploymentId_: function (row) {
    if (!row) return '';

    var parentId = String(row.parentDeploymentId || row.deploymentFk || '').trim();
    if (parentId) return CoreTrends._canonicalHistoryId_(parentId);

    var depId = String(row.deploymentId || '').trim();
    if (depId) {
      if (depId.indexOf('__pf__') >= 0) {
        return CoreTrends._canonicalHistoryId_(depId.split('__pf__')[0]);
      }
      if (depId.indexOf('__product__') >= 0) {
        return CoreTrends._canonicalHistoryId_(depId.split('__product__')[0]);
      }
      if (/^[a-zA-Z0-9]{15,18}$/.test(depId)) {
        return CoreTrends._canonicalHistoryId_(depId);
      }
    }

    var pfs = row.productFunctions;
    if (pfs && pfs.length) {
      for (var i = 0; i < pfs.length; i++) {
        var pf = pfs[i];
        var pfParent = String((pf && (pf.parentDeploymentId || pf.deploymentFk)) || '').trim();
        if (pfParent) return CoreTrends._canonicalHistoryId_(pfParent);
      }
    }
    return '';
  },

  /**
   * Build portfolio parent deployment ID set for history scoping in the current lens.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  buildPortfolioHistoryParentIdSet_: function (cfg, viewModeOpts, productOpts) {
    cfg = CoreConfig.withDefaults(cfg);
    var layoutMode = CoreTrends._getLayoutMode_(cfg);
    var deployments = [];
    try {
      deployments = CoreData.getAllDeployments(cfg, viewModeOpts, productOpts) || [];
    } catch (e) {
      Logger.log('CoreTrends.buildPortfolioHistoryParentIdSet_: getAllDeployments failed: ' + e);
      deployments = [];
    }

    var parentIds = {};
    var parentIdList = [];
    var unresolvedRows = [];

    deployments.forEach(function (row) {
      var pid = CoreTrends.resolveHistoryDeploymentId_(row);
      if (!pid) {
        if (row && row.deploymentId) unresolvedRows.push(String(row.deploymentId));
        return;
      }
      if (!parentIds[pid]) {
        parentIds[pid] = true;
        parentIdList.push(pid);
      }
      if (pid.length >= 15) parentIds[pid.slice(0, 15)] = true;
    });

    return {
      layoutMode: layoutMode,
      deployments: deployments,
      parentIds: parentIds,
      parentIdList: parentIdList,
      unresolvedRows: unresolvedRows,
      productContext: CoreTrends._extractProductContext_(deployments, layoutMode),
      industryContext: CoreTrends._extractIndustryContext_(deployments, layoutMode)
    };
  },

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /** @const {Array<string>} */
  _TRENDS_RECOMMENDED_FIELDS_: [
    'Overall_Health__c',
    'Deployment_Stage__c',
    'Deployment_Phase__c',
    'Overall_Status__c',
    'Deployment_Completion_Date__c',
    'First_Move_to_Production_Date_Actual__c',
    'Production_Move_Date_Earliest__c',
    'Target_Project_Completion_Date__c'
  ],

  /**
   * @param {AppConfig} cfg
   * @return {'product'|'industry'}
   * @private
   */
  _getLayoutMode_: function (cfg) {
    return (cfg && cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled)
      ? 'product' : 'industry';
  },

  /**
   * @param {string} id
   * @return {string}
   * @private
   */
  _canonicalHistoryId_: function (id) {
    var s = String(id || '').trim();
    if (!s) return '';
    if (s.length >= 18) return s.slice(0, 18);
    if (s.length >= 15) return s.slice(0, 18);
    return s;
  },

  /**
   * @param {string} parentId
   * @param {Object<string, boolean>} scopeSet
   * @return {boolean}
   * @private
   */
  _isInPortfolioHistoryScope_: function (parentId, scopeSet) {
    if (!scopeSet || !Object.keys(scopeSet).length) return true;
    var canon = CoreTrends._canonicalHistoryId_(parentId);
    if (!canon) return false;
    if (scopeSet[canon]) return true;
    if (canon.length >= 15 && scopeSet[canon.slice(0, 15)]) return true;
    return false;
  },

  /**
   * True when a parent deployment ID has events in historyMap (15/18-char tolerant).
   * @param {string} parentId
   * @param {Object} historyMap
   * @return {boolean}
   * @private
   */
  _parentIdInHistoryMap_: function (parentId, historyMap) {
    if (!parentId || !historyMap) return false;
    var canon = CoreTrends._canonicalHistoryId_(parentId);
    if (!canon) return false;
    if (historyMap[canon]) return true;
    var prefix = canon.length >= 15 ? canon.slice(0, 15) : canon;
    if (prefix && historyMap[prefix]) return true;
    var keys = Object.keys(historyMap);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === canon) return true;
      if (prefix.length >= 15 && k.slice(0, 15) === prefix) return true;
    }
    return false;
  },

  /**
   * @param {string} parentId
   * @param {Object} historyMap
   * @return {number}
   * @private
   */
  _historyEventCountForParent_: function (parentId, historyMap) {
    if (!parentId || !historyMap) return 0;
    var canon = CoreTrends._canonicalHistoryId_(parentId);
    if (historyMap[canon] && historyMap[canon].events) return historyMap[canon].events.length;
    var prefix = canon.length >= 15 ? canon.slice(0, 15) : canon;
    if (historyMap[prefix] && historyMap[prefix].events) return historyMap[prefix].events.length;
    var keys = Object.keys(historyMap);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if ((k === canon || (prefix.length >= 15 && k.slice(0, 15) === prefix)) &&
          historyMap[k] && historyMap[k].events) {
        return historyMap[k].events.length;
      }
    }
    return 0;
  },

  /**
   * Safe row snapshot for readiness diagnostics (no history field values).
   * @param {Object} row
   * @return {Object}
   * @private
   */
  _rowReadinessSnapshot_: function (row) {
    return {
      deploymentId: String((row && row.deploymentId) || ''),
      parentDeploymentId: String((row && row.parentDeploymentId) || ''),
      deploymentFk: String((row && row.deploymentFk) || ''),
      accountName: String((row && row.accountName) || ''),
      deploymentName: String((row && row.deploymentName) || ''),
      productArea: String((row && row.productArea) || ''),
      funcArea: String((row && row.funcArea) || ''),
      productFunctionCount: (row && row.productFunctions && row.productFunctions.length) || 0
    };
  },

  /**
   * Row-level and parent-ID-level readiness breakdown for debugTrendsReadiness.
   * @param {Object} scope  From buildPortfolioHistoryParentIdSet_.
   * @param {Object} historyMap
   * @return {Object}
   * @private
   */
  _buildPortfolioReadinessDiagnostics_: function (scope, historyMap) {
    var deployments = (scope && scope.deployments) || [];
    var portfolioRowsChecked = deployments.length;
    var portfolioRowsWithResolvedParentId = 0;
    var portfolioRowsMissingResolvedParentId = 0;
    var portfolioRowsResolvedButNoHistory = 0;
    var sampleRowsMissingResolvedParentId = [];
    var sampleResolvedButNoHistory = [];
    var sampleMatched = [];
    var seenNoHistory = {};
    var seenMatched = {};

    deployments.forEach(function (row) {
      var pid = CoreTrends.resolveHistoryDeploymentId_(row);
      if (!pid) {
        portfolioRowsMissingResolvedParentId++;
        if (sampleRowsMissingResolvedParentId.length < 5) {
          sampleRowsMissingResolvedParentId.push(CoreTrends._rowReadinessSnapshot_(row));
        }
        return;
      }

      portfolioRowsWithResolvedParentId++;
      var hasHistory = CoreTrends._parentIdInHistoryMap_(pid, historyMap);
      if (!hasHistory) {
        portfolioRowsResolvedButNoHistory++;
        if (sampleResolvedButNoHistory.length < 5 && !seenNoHistory[pid]) {
          seenNoHistory[pid] = true;
          sampleResolvedButNoHistory.push({
            parentDeploymentId: pid,
            accountName: String(row.accountName || ''),
            deploymentName: String(row.deploymentName || ''),
            productArea: String(row.productArea || ''),
            funcArea: String(row.funcArea || '')
          });
        }
        return;
      }

      if (sampleMatched.length < 5 && !seenMatched[pid]) {
        seenMatched[pid] = true;
        sampleMatched.push({
          parentDeploymentId: pid,
          accountName: String(row.accountName || ''),
          deploymentName: String(row.deploymentName || ''),
          historyEventCount: CoreTrends._historyEventCountForParent_(pid, historyMap)
        });
      }
    });

    var matchedParentIdCount = 0;
    var unmatchedPortfolioParentIdCount = 0;
    (scope.parentIdList || []).forEach(function (pid) {
      if (CoreTrends._parentIdInHistoryMap_(pid, historyMap)) matchedParentIdCount++;
      else unmatchedPortfolioParentIdCount++;
    });

    var portfolioParentIdCount = (scope.parentIdList || []).length;
    var historyCoveragePct = portfolioParentIdCount > 0
      ? Math.round((matchedParentIdCount / portfolioParentIdCount) * 1000) / 10
      : 0;

    return {
      portfolioRowsChecked: portfolioRowsChecked,
      portfolioRowsWithResolvedParentId: portfolioRowsWithResolvedParentId,
      portfolioRowsMissingResolvedParentId: portfolioRowsMissingResolvedParentId,
      portfolioRowsResolvedButNoHistory: portfolioRowsResolvedButNoHistory,
      portfolioParentIdCount: portfolioParentIdCount,
      matchedParentIdCount: matchedParentIdCount,
      unmatchedPortfolioParentIdCount: unmatchedPortfolioParentIdCount,
      unmatchedPortfolioParentIdsWithNoHistory: unmatchedPortfolioParentIdCount,
      resolverFailureCount: portfolioRowsMissingResolvedParentId,
      historyCoveragePct: historyCoveragePct,
      sampleRowsMissingResolvedParentId: sampleRowsMissingResolvedParentId,
      sampleResolvedButNoHistory: sampleResolvedButNoHistory,
      sampleMatched: sampleMatched
    };
  },

  /**
   * @param {Array<Object>} deployments
   * @param {string} layoutMode
   * @return {Object}
   * @private
   */
  _extractProductContext_: function (deployments, layoutMode) {
    var ctx = {
      enabled: layoutMode === 'product',
      productAreas: [],
      functions: [],
      sampleProductFunctions: [],
      productAreaCount: 0,
      functionCount: 0
    };
    if (layoutMode !== 'product') return ctx;

    var areaSet = {};
    var funcSet = {};
    (deployments || []).forEach(function (row) {
      var pfs = row.productFunctions;
      if (pfs && pfs.length) {
        pfs.forEach(function (pf) {
          var pa = String((pf && pf.productArea) || '').trim();
          var fa = String((pf && pf.funcArea) || '').trim();
          if (pa) areaSet[pa] = true;
          if (fa) funcSet[fa] = true;
          if (ctx.sampleProductFunctions.length < 8) {
            ctx.sampleProductFunctions.push({
              productArea: pa,
              funcArea: fa,
              parentDeploymentId: CoreTrends.resolveHistoryDeploymentId_(pf) ||
                CoreTrends.resolveHistoryDeploymentId_(row)
            });
          }
        });
      } else {
        var rowPa = String(row.productArea || '').trim();
        var rowFa = String(row.funcArea || '').trim();
        if (rowPa) areaSet[rowPa] = true;
        if (rowFa) funcSet[rowFa] = true;
      }
    });

    ctx.productAreas = Object.keys(areaSet).sort();
    ctx.functions = Object.keys(funcSet).sort();
    ctx.productAreaCount = ctx.productAreas.length;
    ctx.functionCount = ctx.functions.length;
    return ctx;
  },

  /**
   * Lightweight industry/region lens context for IndustryMode Trends v1.
   *
   * @param {Array<Object>} deployments
   * @param {string} layoutMode
   * @return {Object}
   * @private
   */
  _extractIndustryContext_: function (deployments, layoutMode) {
    var ctx = {
      enabled: layoutMode === 'industry',
      industries: [],
      regions: [],
      subRegions: [],
      industryCount: 0,
      regionCount: 0,
      subRegionCount: 0
    };
    if (layoutMode !== 'industry') return ctx;

    var industrySet = {};
    var regionSet = {};
    var subRegionSet = {};
    (deployments || []).forEach(function (row) {
      var industry = String((row && row.industry) || '').trim();
      var region = String((row && row.region) || '').trim();
      var subRegion = String((row && row.subRegion) || '').trim();
      if (industry) industrySet[industry] = true;
      if (region) regionSet[region] = true;
      if (subRegion) subRegionSet[subRegion] = true;
    });

    ctx.industries = Object.keys(industrySet).sort();
    ctx.regions = Object.keys(regionSet).sort();
    ctx.subRegions = Object.keys(subRegionSet).sort();
    ctx.industryCount = ctx.industries.length;
    ctx.regionCount = ctx.regions.length;
    ctx.subRegionCount = ctx.subRegions.length;
    return ctx;
  },

  /**
   * @param {AppConfig} cfg
   * @param {Object} historyMap
   * @param {Object} scope
   * @param {Array<string>} warnings
   * @return {Object}
   * @private
   */
  _buildHistorySummary_: function (cfg, historyMap, scope, warnings) {
    var sheetName = (cfg.sheets && cfg.sheets.deploymentHistory) || 'SFDC_DeploymentHistory';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss ? ss.getSheetByName(sheetName) : null;
    var sheetExists = !!sheet;
    var historyRowCount = sheet && sheet.getLastRow() > 1 ? sheet.getLastRow() - 1 : 0;

    var fieldCounts = {};
    var minCreated = null;
    var maxCreated = null;
    var eventCount = 0;
    var historyParentIds = {};

    Object.keys(historyMap || {}).forEach(function (pid) {
      historyParentIds[pid] = true;
      var entry = historyMap[pid];
      if (!entry || !entry.events) return;
      entry.events.forEach(function (ev) {
        eventCount++;
        var field = String(ev.field || '').trim();
        if (field) fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        if (ev.at) {
          var d = CoreHistory._toDateOnly_(ev.at, Session.getScriptTimeZone());
          if (d) {
            if (!minCreated || d < minCreated) minCreated = d;
            if (!maxCreated || d > maxCreated) maxCreated = d;
          }
        }
      });
    });

    var matched = 0;
    var unmatchedPortfolio = 0;
    (scope.parentIdList || []).forEach(function (pid) {
      if (CoreTrends._parentIdInHistoryMap_(pid, historyMap)) matched++;
      else unmatchedPortfolio++;
    });

    var unmatchedHistory = 0;
    Object.keys(historyParentIds).forEach(function (pid) {
      if (!CoreTrends._isInPortfolioHistoryScope_(pid, scope.parentIds)) unmatchedHistory++;
    });

    return {
      sheetExists: sheetExists,
      historyRowCount: historyRowCount,
      historyEventCount: eventCount,
      distinctParentIds: Object.keys(historyParentIds).length,
      matchedParentIds: matched,
      unmatchedPortfolioParentIds: unmatchedPortfolio,
      unmatchedHistoryParentIds: unmatchedHistory,
      fieldCounts: fieldCounts,
      minCreatedDate: minCreated,
      maxCreatedDate: maxCreated
    };
  },

  /**
   * @param {Object} fieldCounts
   * @param {Array<string>} warnings
   * @return {Object<string, boolean>}
   * @private
   */
  _getRecommendedFieldAvailability_: function (fieldCounts, warnings) {
    var availability = {};
    CoreTrends._TRENDS_RECOMMENDED_FIELDS_.forEach(function (field) {
      availability[field] = (fieldCounts[field] || 0) > 0;
    });
    availability['Current_MTP_Date__c'] = (fieldCounts['Current_MTP_Date__c'] || 0) > 0;
    availability['Baseline_MTP_Date__c'] = (fieldCounts['Baseline_MTP_Date__c'] || 0) > 0;
    return availability;
  },

  /**
   * @param {Array<Object>} deployments
   * @param {Object} historyMap
   * @param {number} limit
   * @return {Array<Object>}
   * @private
   */
  _buildResolverSamples_: function (deployments, historyMap, limit) {
    var samples = [];
    (deployments || []).some(function (row) {
      if (samples.length >= limit) return true;
      var syntheticId = String(row.deploymentId || '');
      var resolved = CoreTrends.resolveHistoryDeploymentId_(row);
      if (!syntheticId) return false;
      var eventCount = resolved
        ? CoreTrends._historyEventCountForParent_(resolved, historyMap)
        : 0;
      samples.push({
        deploymentId: syntheticId,
        resolvedParentId: resolved,
        historyEventCount: eventCount,
        productArea: row.productArea || '',
        funcArea: row.funcArea || ''
      });
      return false;
    });
    return samples;
  },

  /**
   * @param {AppConfig} cfg
   * @param {string} parentId
   * @param {string} fieldName
   * @return {{ date: string, source: string }|null}
   * @private
   */
  _getCurrentAvailableDateField_: function (cfg, parentId, fieldName) {
    if (!parentId || !fieldName) return null;
    var historyMap = CoreHistory.getHistoryMap(cfg);
    var entry = historyMap[parentId];
    if (!entry && parentId.length >= 15) entry = historyMap[parentId.slice(0, 15)];
    if (!entry || !entry.events) return null;

    var tz = Session.getScriptTimeZone();
    var last = null;
    entry.events.forEach(function (ev) {
      if (ev.field === fieldName && ev['new']) last = ev;
    });
    if (!last) return null;
    var dateStr = CoreHistory._normalizeDate_(last['new'], tz);
    return dateStr ? { date: dateStr, source: fieldName } : null;
  },

  /**
   * @param {AppConfig} cfg
   * @param {string} parentId
   * @param {string} fieldName
   * @return {Array<{ date: string, source: string, setAt: string }>}
   * @private
   */
  _getAvailableDateFieldHistory_: function (cfg, parentId, fieldName) {
    if (!parentId || !fieldName) return [];
    var historyMap = CoreHistory.getHistoryMap(cfg);
    var entry = historyMap[parentId];
    if (!entry && parentId.length >= 15) entry = historyMap[parentId.slice(0, 15)];
    if (!entry || !entry.events) return [];

    var tz = Session.getScriptTimeZone();
    var result = [];
    entry.events.forEach(function (ev) {
      if (ev.field !== fieldName) return;
      var dateStr = CoreHistory._normalizeDate_(ev['new'], tz);
      if (!dateStr) return;
      result.push({
        date: dateStr,
        source: fieldName,
        setAt: ev.at || ''
      });
    });
    return result;
  },

  /**
   * @param {AppConfig} cfg
   * @param {Object} scope
   * @param {Object} historyMap
   * @param {Object=} viewModeOpts
   * @param {Array<string>} warnings
   * @return {Object}
   * @private
   */
  _buildTargetDateMovementMetrics_: function (cfg, scope, historyMap, viewModeOpts, warnings, historySummary) {
    var today = CoreTrends._todayStr_();
    var inFlight = [];
    var movementCounts = { neverChanged: 0, changedOnce: 0, changedTwoThree: 0, changedFourPlus: 0 };

    (scope.deployments || []).forEach(function (dep) {
      var parentId = CoreTrends.resolveHistoryDeploymentId_(dep);
      if (!parentId) return;

      var targetHistory = CoreTrends._getAvailableDateFieldHistory_(
        cfg, parentId, 'Target_Project_Completion_Date__c');
      if (!targetHistory.length) {
        var current = dep.mtpDate || dep.targetProjectCompletionDate || '';
        if (current) targetHistory = [{ date: current, source: 'row', setAt: '' }];
      }

      var changeCount = 0;
      for (var i = 1; i < targetHistory.length; i++) {
        if (targetHistory[i].date !== targetHistory[i - 1].date) changeCount++;
      }
      if (changeCount === 0) movementCounts.neverChanged++;
      else if (changeCount === 1) movementCounts.changedOnce++;
      else if (changeCount <= 3) movementCounts.changedTwoThree++;
      else movementCounts.changedFourPlus++;

      var currentTarget = targetHistory.length
        ? targetHistory[targetHistory.length - 1].date
        : (dep.mtpDate || '');
      var startDate = dep.startDate || dep.deploymentStartDate || '';
      if (!startDate || !currentTarget) return;

      var daysInFlight = CoreTrends._daysBetween_(startDate, today);
      var projectedTotalDays = CoreTrends._daysBetween_(startDate, currentTarget);
      var projectedDaysRemaining = CoreTrends._daysBetween_(today, currentTarget);
      if (currentTarget < today) {
        projectedDaysRemaining = -CoreTrends._daysBetween_(currentTarget, today);
      }

      inFlight.push({
        deploymentId: dep.deploymentId,
        historyParentId: parentId,
        accountName: dep.accountName || '',
        productArea: dep.productArea || '',
        funcArea: dep.funcArea || '',
        startDate: startDate,
        currentTargetDate: currentTarget,
        targetDateChangeCount: changeCount,
        daysInFlight: daysInFlight,
        projectedDaysRemaining: projectedDaysRemaining,
        projectedTotalDays: projectedTotalDays,
        isOverdue: projectedDaysRemaining < 0
      });
    });

    var fieldCounts = (historySummary && historySummary.fieldCounts) ||
      CoreTrends._buildHistorySummary_(cfg, historyMap, scope, warnings).fieldCounts;
    if (!CoreTrends._getRecommendedFieldAvailability_(fieldCounts, warnings
    )['Target_Project_Completion_Date__c']) {
      warnings.push('Target Date Movement: Target_Project_Completion_Date__c sparse in history.');
    }

    return {
      label: 'Target Date Movement',
      field: 'Target_Project_Completion_Date__c',
      inFlight: inFlight,
      overdue: inFlight.filter(function (d) { return d.isOverdue; }),
      movementDistribution: movementCounts,
      sampleSize: inFlight.length
    };
  },

  /**
   * @param {AppConfig} cfg
   * @param {Object} scope
   * @param {Object} historyMap
   * @param {Object=} viewModeOpts
   * @param {Array<string>} warnings
   * @return {Object}
   * @private
   */
  _buildProductionDateMovementMetrics_: function (cfg, scope, historyMap, viewModeOpts, warnings) {
    var inFlight = [];
    var movementCounts = { neverChanged: 0, changedOnce: 0, changedTwoThree: 0, changedFourPlus: 0 };
    var fields = [
      'First_Move_to_Production_Date_Actual__c',
      'Production_Move_Date_Earliest__c'
    ];

    (scope.deployments || []).forEach(function (dep) {
      var parentId = CoreTrends.resolveHistoryDeploymentId_(dep);
      if (!parentId) return;

      var prodHistory = [];
      fields.forEach(function (fieldName) {
        var hist = CoreTrends._getAvailableDateFieldHistory_(cfg, parentId, fieldName);
        if (hist.length) prodHistory = prodHistory.concat(hist);
      });
      prodHistory.sort(function (a, b) {
        return a.setAt < b.setAt ? -1 : (a.setAt > b.setAt ? 1 : 0);
      });

      var changeCount = 0;
      for (var i = 1; i < prodHistory.length; i++) {
        if (prodHistory[i].date !== prodHistory[i - 1].date) changeCount++;
      }
      if (!prodHistory.length) return;
      if (changeCount === 0) movementCounts.neverChanged++;
      else if (changeCount === 1) movementCounts.changedOnce++;
      else if (changeCount <= 3) movementCounts.changedTwoThree++;
      else movementCounts.changedFourPlus++;

      var latest = prodHistory[prodHistory.length - 1];
      inFlight.push({
        deploymentId: dep.deploymentId,
        historyParentId: parentId,
        accountName: dep.accountName || '',
        productArea: dep.productArea || '',
        funcArea: dep.funcArea || '',
        currentProductionDate: latest.date,
        sourceField: latest.source,
        productionDateChangeCount: changeCount
      });
    });

    return {
      label: 'Production Date Movement',
      fields: fields,
      inFlight: inFlight,
      movementDistribution: movementCounts,
      sampleSize: inFlight.length
    };
  },

  /**
   * @param {AppConfig} cfg
   * @param {Object} scope
   * @param {Object} historyMap
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {Array<string>} warnings
   * @return {Object}
   * @private
   */
  _buildCompletionTrendMetrics_: function (cfg, scope, historyMap, viewModeOpts, productOpts, warnings) {
    var windowMonths = (cfg.trends && cfg.trends.trendsWindowMonths) ||
      (cfg.salesforce && cfg.salesforce.trendsWindowMonths) || 12;
    var today = CoreTrends._todayStr_();
    var cutoff = CoreTrends._dateMinusMonths_(today, windowMonths);

    var legacy = CoreTrends.getGoLiveOutcomePatterns(cfg, viewModeOpts);
    var completions = [];

    (legacy.recentCompletions || []).forEach(function (row) {
      completions.push({
        deploymentId: row.deploymentId,
        accountName: row.accountName,
        completionDate: row.actualGoLive || row.completionDate,
        targetDate: row.originalBaseline,
        slippageDays: row.baselineSlippageDays,
        targetDateChangeCount: row.mtpDateChangeCount
      });
    });

    return {
      label: 'Completion / Go-Live Trend',
      windowMonths: windowMonths,
      cutoffDate: cutoff,
      sampleSize: legacy.sampleSize || completions.length,
      onTimeOrEarlyCount: legacy.baselineAccuracy ? legacy.baselineAccuracy.onTimeOrEarlyCount : 0,
      slippedCount: legacy.baselineAccuracy ? legacy.baselineAccuracy.slippedCount : 0,
      onTimePct: legacy.baselineAccuracy ? legacy.baselineAccuracy.onTimePct : 0,
      avgSlippageDays: legacy.baselineAccuracy ? legacy.baselineAccuracy.avgSlippageDays : 0,
      medianSlippageDays: legacy.baselineAccuracy ? legacy.baselineAccuracy.medianSlippageDays : 0,
      targetDateMovementDistribution: legacy.mtpDateMovementDistribution || {},
      byApproach: legacy.byApproach || [],
      byPartner: legacy.byPartner || [],
      approachDiagnostics: legacy.approachDiagnostics || {},
      recentCompletions: completions.slice(0, 15),
      fieldsUsed: [
        'Target_Project_Completion_Date__c',
        'First_Move_to_Production_Date_Actual__c',
        'Production_Move_Date_Earliest__c',
        'Deployment_Completion_Date__c'
      ]
    };
  },

  /**
   * @param {Object} scope
   * @param {Object} historySummary
   * @param {Object} timeInRed
   * @param {Object} targetDateMovement
   * @param {Object} completionTrend
   * @return {Object}
   * @private
   */
  _buildTrendsKpis_: function (scope, historySummary, timeInRed, targetDateMovement, completionTrend) {
    var avgDaysInRed = 0;
    if (timeInRed && timeInRed.aggregates) {
      avgDaysInRed = timeInRed.aggregates.averageCurrentRedDays || 0;
    }
    return {
      deploymentsTrended: (scope.deployments || []).length,
      healthChanges: historySummary.fieldCounts['Overall_Health__c'] || 0,
      stageChanges: historySummary.fieldCounts['Deployment_Stage__c'] || 0,
      dateChanges: (historySummary.fieldCounts['Target_Project_Completion_Date__c'] || 0) +
        (historySummary.fieldCounts['First_Move_to_Production_Date_Actual__c'] || 0) +
        (historySummary.fieldCounts['Production_Move_Date_Earliest__c'] || 0),
      completions: (completionTrend && completionTrend.sampleSize) || 0,
      avgDaysInRed: avgDaysInRed,
      targetDateInFlight: ((targetDateMovement && targetDateMovement.inFlight) || []).length
    };
  },

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
   * Builds a compact cache-key segment from viewModeOpts.
   * Returns 'all' when viewMode is absent or 'all'.
   * Returns 'my:<encodedName>' when viewMode is 'my'.
   *
   * @param {Object=} viewModeOpts
   * @return {string}
   * @private
   */
  _buildViewModeKey_: function (viewModeOpts) {
    if (!viewModeOpts || !viewModeOpts.viewMode || viewModeOpts.viewMode === 'all') {
      return 'all';
    }
    if (viewModeOpts.viewMode === 'my') {
      var name = viewModeOpts.ddDisplayName || '';
      return 'my:' + encodeURIComponent(name);
    }
    return 'all';
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
            var phaseVal = r.phase || r.servicesApproach || r.deploymentPhase || '';
            return {
              deploymentId:       r.deploymentId,
              parentDeploymentId: r.parentDeploymentId || '',
              deploymentFk:       r.deploymentFk || '',
              accountName:      r.accountName      || '',
              deploymentName:   r.deploymentName   || '',
              partner:          r.partner           || '',
              deliveryDirector: r.deliveryDirector  || '',
              phase:            phaseVal,
              servicesApproach: phaseVal,
              deploymentPhase:  phaseVal,
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

      var approach = CoreTrends._resolveDeploymentApproach_(dep);
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
