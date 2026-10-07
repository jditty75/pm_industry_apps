/**
 * CorePortfolioHealth.gs
 *
 * Shared "Portfolio Health" snapshot builder for SLG, HENP, HC.
 *
 * Produces a single data object consumed by each app's WebApp "Portfolio Health"
 * tab. All counts come from the EFFECTIVE deployment view (source + overrides +
 * meta) and from the effective Go Lives view, so values stay consistent with the
 * monthly report.
 *
 * Configuration lives at:
 *   cfg.report.portfolioHealth = {
 *     title: 'Portfolio Health',
 *     workdayPartner: 'Workday Professional Services',
 *     workdayLabel:   'Workday',
 *     otherLabel:     'Partners/Other',
 *     industryBuckets: [
 *       { label: 'SLG',               match: ['State & Local Government'] },
 *       { label: 'Special Districts', match: ['Special Districts'] }
 *     ],
 *     recentGoLivesWindowDays: 60, // informational; window itself comes from
 *                                  // cfg.report.goLivesWindowDays
 *     historyWindowMonths: 6       // sparkline + trend window
 *   }
 */
var CorePortfolioHealth = (function () {

  // ---------------------------------------------------------------------------
  // PUBLIC
  // ---------------------------------------------------------------------------

  /**
   * Build the full Portfolio Health snapshot for the given app.
   * Branches to vNext builder if portfolioHealthVNext.enabled is true.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function getSnapshot(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var ph  = cfg.report.portfolioHealth || {};

    var tz  = Session.getScriptTimeZone();
    var now = new Date();

    // ---- Effective deployments (Green/Yellow/Red, post-overrides) -----------
    // Display rows: Deployments-tab grain (lists, expandable rows).
    var displayRows = CoreData.getAllEffectiveDeployments(cfg, productOpts)
      .filter(function (r) { return !r.excludeFromReport; });
    displayRows = CoreData.filterDeploymentsByStudent_(displayRows, 'exclude', cfg);

    // Count rows: ProductMode count grain for KPI totals / splits.
    var countRows = CoreData.getActiveCountDeployments(cfg, productOpts)
      .filter(function (r) { return !r.excludeFromReport; });
    countRows = CoreData.filterDeploymentsByStudent_(countRows, 'exclude', cfg);

    // ---- Health totals -------------------------------------------------------
    var green = 0, yellow = 0, red = 0;
    countRows.forEach(function (r) {
      var h = String(r.health || '').trim();
      if (h === 'Green')  green++;
      else if (h === 'Yellow') yellow++;
      else if (h === 'Red')    red++;
    });
    var total = green + yellow + red;
    var pct = function (v) { return total > 0 ? v / total : 0; };

    var totals = {
      green:  green,
      yellow: yellow,
      red:    red,
      total:  total,
      greenPct:  pct(green),
      yellowPct: pct(yellow),
      redPct:    pct(red)
    };

    // ---- Red / Yellow project lists (alphabetical, display grain) -----------
    var redProjects    = buildAccountList_(displayRows, 'Red');
    var yellowProjects = buildAccountList_(displayRows, 'Yellow');

    // ---- WD Prime Go Lives (last N days, effective view) --------------------
    // Phase 3i: use getRecentGoLives() (SOQL-backed, Complete deployments) instead
    // of the deprecated getGoLives() which read from the frozen legacy Go Lives sheet.
    var workdayPartner = ph.workdayPartner || 'Workday Professional Services';
    var goLives = CoreData.getRecentGoLives(cfg, viewModeOpts, undefined, productOpts) || [];
    goLives = CoreData.filterRowsExcludedFromReport_(goLives);
    goLives = goLives.filter(function (r) {
      return String(r.partner || '').trim() === workdayPartner;
    });

    // Sorted ascending by lastGoLiveDate in CoreData.getRecentGoLives.
    var recentGoLivesAccounts = goLives.map(function (r) {
      return { accountName: r.accountName, goLiveDate: r.lastGoLiveDate || '' };
    });

    // ---- Partner split (Workday vs Partners/Other) per health row -----------
    var partnerSplit = buildPartnerSplit_(countRows, workdayPartner);

    // ---- Industry split per health row --------------------------------------
    var industryMode = String(ph.industryMode || 'bucketed').trim().toLowerCase();
    var industryDisplayMode = String(ph.industryDisplayMode || 'bucketed').trim();
    var industryTopN = Number(ph.industryTopN || 10);
    var industrySplit;

    if (industryMode === 'all' && industryDisplayMode === 'topNWithOther') {
      industrySplit = buildTopIndustriesSplit_(countRows, industryTopN, cfg);
    } else if (industryMode === 'all') {
      industrySplit = buildAllIndustriesSplit_(countRows, cfg);
    } else {
      industrySplit = buildIndustrySplit_(countRows, ph.industryBuckets || [], cfg);
    }

    Logger.log(
      'CorePortfolioHealth.getSnapshot: appId=' + (cfg.appId || '') +
      ', industryMode=' + industryMode +
      ', industryDisplayMode=' + industryDisplayMode +
      ', countRows=' + countRows.length +
      ', displayRows=' + displayRows.length +
      ', industryRows=' + (
        industrySplit && industrySplit.rows ? industrySplit.rows.length : 0
      )
    );

    // ---- History (trailing months + trend) ----------------------------------
    var historyWindow = (ph.historyWindowMonths && ph.historyWindowMonths > 0)
      ? ph.historyWindowMonths
      : 6;
    var history = buildHistory_(cfg, historyWindow);

    // Re-anchor the latest point to the live counts computed above so the
    // KPI value, trend chip, and sparkline tip always agree (even when
    // analytics snapshots haven't been refreshed yet today).
    history.trend.total  = blendCurrent_(history.trend.total,  totals.total);
    history.trend.green  = blendCurrent_(history.trend.green,  totals.green);
    history.trend.yellow = blendCurrent_(history.trend.yellow, totals.yellow);
    history.trend.red    = blendCurrent_(history.trend.red,    totals.red);

    if (history.series.total.length)  history.series.total[history.series.total.length - 1]   = totals.total;
    if (history.series.green.length)  history.series.green[history.series.green.length - 1]   = totals.green;
    if (history.series.yellow.length) history.series.yellow[history.series.yellow.length - 1] = totals.yellow;
    if (history.series.red.length)    history.series.red[history.series.red.length - 1]       = totals.red;

    // ---- Phase 3a: Phased deployments count (upcoming window) ---------------
    var phasedDeployments = 0;
    try {
      var upcomingRows = CoreData.getUpcomingGoLives(cfg, viewModeOpts, productOpts) || [];
      // getUpcomingGoLives already filters Student out (S1); phasedDeployments
      // count stays Student-exclusive automatically.
      phasedDeployments = upcomingRows.filter(function (r) {
        return !!r.isPhased && !r.excludeFromReport;
      }).length;
    } catch (err) {
      Logger.log('CorePortfolioHealth.getSnapshot: phasedDeployments count failed — ' +
                 'defaulting to 0. Error: ' + err);
    }

    // ---- Labels / branding --------------------------------------------------
    var monthLabel     = Utilities.formatDate(now, tz, 'MMMM yyyy');
    var generatedLabel = Utilities.formatDate(now, tz, 'MMMM d, yyyy');

    var classicSnapshot = {
      appId:        cfg.appId || '',
      title:        ph.title || 'Portfolio Health',
      workdayLabel: ph.workdayLabel || 'Workday',
      otherLabel:   ph.otherLabel   || 'Partners/Other',
      monthLabel:     monthLabel,
      generatedLabel: generatedLabel,
      generatedAt:    now.toISOString(),
      windowDays:     cfg.report.goLivesWindowDays || ph.recentGoLivesWindowDays || 60,
      totals:         totals,
      redProjects:    redProjects,
      yellowProjects: yellowProjects,
      recentGoLives: {
        windowDays: cfg.report.goLivesWindowDays || ph.recentGoLivesWindowDays || 60,
        accounts:   recentGoLivesAccounts
      },
      partnerSplit:         partnerSplit,
      industryMode:         industryMode,
      industryDisplayMode:  industryDisplayMode,
      industrySplit:        industrySplit,
      history:         history,
      phasedDeployments: phasedDeployments,
      overrideFootnote: CoreData.buildOverrideFootnote_(countRows)
    };

    // vNext builder (if enabled)
    if (ph && ph.vNextEnabled) {
      return getPortfolioHealthVNextSnapshot_(cfg, classicSnapshot, countRows, displayRows, viewModeOpts, productOpts);
    }

    return classicSnapshot;
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Build an alphabetically sorted list of unique account names for a given
   * health value.
   *
   * @param {Array<Object>} rows
   * @param {string} health
   * @return {Array<{accountName:string}>}
   * @private
   */
  function buildAccountList_(rows, health) {
    var seen = {};
    var out = [];
    rows.forEach(function (r) {
      if (String(r.health || '').trim() !== health) return;
      var name = String(r.accountName || '').trim();
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ accountName: name });
    });
    out.sort(function (a, b) {
      return a.accountName.toLowerCase().localeCompare(b.accountName.toLowerCase());
    });
    return out;
  }

  /**
   * Build the Workday vs Partners/Other split per health bucket.
   *
   * @param {Array<Object>} rows
   * @param {string} workdayPartner
   * @return {Object}
   * @private
   */
  function buildPartnerSplit_(rows, workdayPartner) {
    var healths = ['Green', 'Yellow', 'Red'];
    var rowsOut = healths.map(function (h) {
      var workdayCount = 0;
      var otherCount   = 0;
      rows.forEach(function (r) {
        if (String(r.health || '').trim() !== h) return;
        if (String(r.partner || '').trim() === workdayPartner) workdayCount++;
        else otherCount++;
      });
      var sub = workdayCount + otherCount;
      return {
        health:       h,
        workdayCount: workdayCount,
        otherCount:   otherCount,
        workdayPct:   sub > 0 ? workdayCount / sub : 0,
        otherPct:     sub > 0 ? otherCount   / sub : 0
      };
    });

    var totW = rowsOut.reduce(function (s, r) { return s + r.workdayCount; }, 0);
    var totO = rowsOut.reduce(function (s, r) { return s + r.otherCount;   }, 0);
    var grand = totW + totO;

    return {
      rows: rowsOut,
      totals: {
        workdayCount: totW,
        otherCount:   totO,
        total:        grand,
        workdayPct:   grand > 0 ? totW / grand : 0,
        otherPct:     grand > 0 ? totO / grand : 0
      }
    };
  }

  /**
   * Build the industry split per health bucket using configured industry buckets.
   *
   * @param {Array<Object>} rows
   * @param {Array<{label:string,match:Array<string>}>} buckets
   * @return {Object}
   * @private
   */
  function buildIndustrySplit_(rows, buckets, cfg) {
    var bucketLabels = buckets.map(function (b) { return b.label; });

    // Normalize match values once for case-insensitive comparison.
    var normalizedBuckets = buckets.map(function (b) {
      return {
        label: b.label,
        match: (b.match || []).map(function (v) {
          return String(v || '').trim().toLowerCase();
        })
      };
    });

    function bucketIndexFor(industry) {
      var ind = String(industry || '').trim().toLowerCase();
      if (!ind) return -1;
      for (var i = 0; i < normalizedBuckets.length; i++) {
        if (normalizedBuckets[i].match.indexOf(ind) !== -1) return i;
      }
      return -1;
    }

    var healths = ['Green', 'Yellow', 'Red'];
    var rowsOut = healths.map(function (h) {
      var counts = bucketLabels.map(function () { return 0; });
      rows.forEach(function (r) {
        if (String(r.health || '').trim() !== h) return;
        var idx = bucketIndexFor(cfg ? CoreData.getDeploymentGroupingValue(r, cfg) : r.industry);
        if (idx >= 0) counts[idx]++;
      });
      var sub = counts.reduce(function (s, c) { return s + c; }, 0);
      return {
        health: h,
        buckets: bucketLabels.map(function (label, i) {
          return {
            label: label,
            count: counts[i],
            pct:   sub > 0 ? counts[i] / sub : 0
          };
        })
      };
    });

    // Totals across health rows per bucket
    var bucketTotals = bucketLabels.map(function (label, i) {
      var c = rowsOut.reduce(function (s, r) { return s + r.buckets[i].count; }, 0);
      return { label: label, count: c };
    });
    var grand = bucketTotals.reduce(function (s, b) { return s + b.count; }, 0);

    return {
      bucketLabels: bucketLabels,
      rows: rowsOut,
      totals: {
        buckets: bucketTotals.map(function (b) {
          return {
            label: b.label,
            count: b.count,
            pct:   grand > 0 ? b.count / grand : 0
          };
        }),
        total: grand
      }
    };
  }

  /**
   * Build a compact ranked industry split for product apps (Top N + Other).
   *
   * @param {Array<Object>} rows
   * @param {number} topN
   * @return {Object}
   * @private
   */
  function buildTopIndustriesSplit_(rows, topN, cfg) {
    topN = Math.max(1, Number(topN || 10));

    var byIndustry = {};
    var totalPortfolio = 0;

    rows.forEach(function (r) {
      var health = String(r.health || '').trim();
      if (health !== 'Green' && health !== 'Yellow' && health !== 'Red') return;

      var industry = cfg
        ? CoreData.getDeploymentGroupingValue(r, cfg)
        : (String(r.industry || '').trim() || 'Unknown');

      if (!byIndustry[industry]) {
        byIndustry[industry] = {
          label: industry,
          green: 0,
          yellow: 0,
          red: 0,
          total: 0
        };
      }

      if (health === 'Green') byIndustry[industry].green++;
      else if (health === 'Yellow') byIndustry[industry].yellow++;
      else if (health === 'Red') byIndustry[industry].red++;

      byIndustry[industry].total++;
      totalPortfolio++;
    });

    var ranked = Object.keys(byIndustry)
      .map(function (k) { return byIndustry[k]; })
      .filter(function (x) { return x.label !== 'Unknown'; })
      .sort(function (a, b) {
        if (b.total !== a.total) return b.total - a.total;
        return String(a.label).toLowerCase().localeCompare(String(b.label).toLowerCase());
      });

    var top = ranked.slice(0, topN);
    var rest = ranked.slice(topN);

    var unknown = byIndustry.Unknown || null;

    var other = {
      label: 'Other',
      green: 0,
      yellow: 0,
      red: 0,
      total: 0
    };

    rest.forEach(function (x) {
      other.green += x.green;
      other.yellow += x.yellow;
      other.red += x.red;
      other.total += x.total;
    });

    if (unknown) {
      other.green += unknown.green;
      other.yellow += unknown.yellow;
      other.red += unknown.red;
      other.total += unknown.total;
    }

    var outRows = top.slice();
    if (other.total > 0) outRows.push(other);

    outRows.forEach(function (x) {
      x.greenPct = x.total > 0 ? x.green / x.total : 0;
      x.yellowPct = x.total > 0 ? x.yellow / x.total : 0;
      x.redPct = x.total > 0 ? x.red / x.total : 0;
      x.portfolioPct = totalPortfolio > 0 ? x.total / totalPortfolio : 0;
    });

    return {
      mode: 'topNWithOther',
      topN: topN,
      rows: outRows,
      total: totalPortfolio,
      hiddenIndustryCount: rest.length + (unknown ? 1 : 0),
      legend: [
        { label: 'Green', key: 'green' },
        { label: 'Yellow', key: 'yellow' },
        { label: 'Red', key: 'red' }
      ]
    };
  }

  /**
   * Build the industry split per health bucket using actual industry values
   * from deployment rows (product apps with industryMode: 'all').
   *
   * @param {Array<Object>} rows
   * @return {Object}
   * @private
   */
  function buildAllIndustriesSplit_(rows, cfg) {
    var healths = ['Green', 'Yellow', 'Red'];

    var industrySet = {};
    rows.forEach(function (r) {
      var industry = cfg
        ? CoreData.getDeploymentGroupingValue(r, cfg)
        : String(r.industry || '').trim();
      if (!industry || industry === 'Unknown') return;
      industrySet[industry] = true;
    });

    var bucketLabels = Object.keys(industrySet).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    var rowsOut = healths.map(function (h) {
      var counts = bucketLabels.map(function () { return 0; });

      rows.forEach(function (r) {
        if (String(r.health || '').trim() !== h) return;
        var industry = cfg
          ? CoreData.getDeploymentGroupingValue(r, cfg)
          : String(r.industry || '').trim();
        if (!industry || industry === 'Unknown') return;
        var idx = bucketLabels.indexOf(industry);
        if (idx >= 0) counts[idx]++;
      });

      var sub = counts.reduce(function (s, c) { return s + c; }, 0);

      return {
        health: h,
        buckets: bucketLabels.map(function (label, i) {
          return {
            label: label,
            count: counts[i],
            pct:   sub > 0 ? counts[i] / sub : 0
          };
        })
      };
    });

    var bucketTotals = bucketLabels.map(function (label, i) {
      var c = rowsOut.reduce(function (s, r) {
        return s + r.buckets[i].count;
      }, 0);
      return { label: label, count: c };
    });

    var grand = bucketTotals.reduce(function (s, b) {
      return s + b.count;
    }, 0);

    return {
      mode: 'all',
      bucketLabels: bucketLabels,
      rows: rowsOut,
      totals: {
        buckets: bucketTotals.map(function (b) {
          return {
            label: b.label,
            count: b.count,
            pct:   grand > 0 ? b.count / grand : 0
          };
        }),
        total: grand
      }
    };
  }

  /**
   * Build trailing-month history + per-status trend from HealthReportSnapshots.
   *
   * Returns an "empty" shape (no months, zero trend) when the snapshot sheet
   * is missing or empty, so callers can render gracefully on first run.
   *
   * @param {AppConfig} cfg
   * @param {number} windowMonths
   * @return {Object}
   * @private
   */
  function buildHistory_(cfg, windowMonths) {
    var empty = {
      months: [],
      series: { total: [], green: [], yellow: [], red: [] },
      trend: {
        total:  { current: 0, previous: null, delta: 0 },
        green:  { current: 0, previous: null, delta: 0 },
        yellow: { current: 0, previous: null, delta: 0 },
        red:    { current: 0, previous: null, delta: 0 }
      },
      windowMonths: windowMonths
    };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var snap = ss.getSheetByName(cfg.sheets.healthReportSnapshots);
    if (!snap) return empty;

    var lastRow = snap.getLastRow();
    if (lastRow <= 1) return empty;

    var values = snap.getRange(2, 1, lastRow - 1, 4).getValues();
    var tz = Session.getScriptTimeZone();

    // byMonth[ymKey][status] = count
    var byMonth = {};
    values.forEach(function (row) {
      var dt = row[0];
      var status = String(row[1] || '').trim();
      var count = Number(row[2] || 0);
      if (!dt || !status) return;
      var ym = Utilities.formatDate(new Date(dt), tz, 'yyyy-MM');
      if (!byMonth[ym]) byMonth[ym] = {};
      byMonth[ym][status] = count;
    });

    var monthsAsc = Object.keys(byMonth).sort();
    if (!monthsAsc.length) return empty;

    // Trim to last N months (oldest -> newest)
    var trimmed = monthsAsc.slice(Math.max(0, monthsAsc.length - windowMonths));

    function series(status) {
      return trimmed.map(function (ym) {
        var m = byMonth[ym] || {};
        return Number(m[status] || 0);
      });
    }

    var totalSeries  = series('Total');
    var greenSeries  = series('Green');
    var yellowSeries = series('Yellow');
    var redSeries    = series('Red');

    // If any 'Total' value is missing (older snapshots may have only G/Y/R),
    // derive it from the colored statuses.
    for (var i = 0; i < trimmed.length; i++) {
      if (!totalSeries[i]) {
        totalSeries[i] = greenSeries[i] + yellowSeries[i] + redSeries[i];
      }
    }

    function trend(seriesArr) {
      var n = seriesArr.length;
      if (n === 0) return { current: 0, previous: null, delta: 0 };
      if (n === 1) return { current: seriesArr[0], previous: null, delta: 0 };
      var current  = seriesArr[n - 1];
      var previous = seriesArr[n - 2];
      return { current: current, previous: previous, delta: current - previous };
    }

    return {
      months: trimmed,
      series: {
        total:  totalSeries,
        green:  greenSeries,
        yellow: yellowSeries,
        red:    redSeries
      },
      trend: {
        total:  trend(totalSeries),
        green:  trend(greenSeries),
        yellow: trend(yellowSeries),
        red:    trend(redSeries)
      },
      windowMonths: windowMonths
    };
  }

  /**
   * Re-anchor a trend object so "current" matches the live count.
   * Keeps "previous" from the snapshot history.
   *
   * @param {{current:number, previous:?number, delta:number}} trendObj
   * @param {number} liveCurrent
   * @return {{current:number, previous:?number, delta:number}}
   * @private
   */
  function blendCurrent_(trendObj, liveCurrent) {
    var prev = trendObj ? trendObj.previous : null;
    if (prev === null || prev === undefined) {
      return { current: liveCurrent, previous: null, delta: 0 };
    }
    return { current: liveCurrent, previous: prev, delta: liveCurrent - prev };
  }

  /**
   * Get DHP issue category metrics from SFDC_DHP.
   * Returns category counts, with categories split by delimiter.
   * Only counts DHP records that match deployments in the active portfolio countRows.
   *
   * @param {AppConfig} cfg
   * @param {Array<Object>} countRows  deployment rows with deploymentId, parentDeploymentId, deploymentFk
   * @return {Object}  {
   *   topCategories,
   *   totalIssuesCount,
   *   deploymentsWithIssuesCount,
   *   activeRowsWithHealthPlans,
   *   activeRowsWithoutHealthPlans,
   *   rawDhpRecordCount,
   *   matchedDhpDeploymentIds,
   *   unmatchedDhpDeploymentIds
   * }
   * @private
   */
  function buildDhpMetrics_(cfg, countRows) {
    var dhpCfg = (cfg && cfg.deploymentHealthPlan) || {};
    if (!dhpCfg.enabled) {
      return {
        topCategories: [],
        totalIssuesCount: 0,
        deploymentsWithIssuesCount: 0,
        activeRowsWithHealthPlans: 0,
        activeRowsWithoutHealthPlans: (countRows || []).length,
        rawDhpRecordCount: 0,
        matchedDhpDeploymentIds: [],
        unmatchedDhpDeploymentIds: []
      };
    }

    try {
      countRows = countRows || [];
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(dhpCfg.sheetName);
      if (!sheet) {
        return {
          topCategories: [],
          totalIssuesCount: 0,
          deploymentsWithIssuesCount: 0,
          activeRowsWithHealthPlans: 0,
          activeRowsWithoutHealthPlans: countRows.length,
          rawDhpRecordCount: 0,
          matchedDhpDeploymentIds: [],
          unmatchedDhpDeploymentIds: []
        };
      }

      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return {
          topCategories: [],
          totalIssuesCount: 0,
          deploymentsWithIssuesCount: 0,
          activeRowsWithHealthPlans: 0,
          activeRowsWithoutHealthPlans: countRows.length,
          rawDhpRecordCount: 0,
          matchedDhpDeploymentIds: [],
          unmatchedDhpDeploymentIds: []
        };
      }

      // Build map of valid deployment IDs from countRows.
      // Priority: parentDeploymentId/deploymentFk, then non-synthetic deploymentId.
      var validDeploymentIds = {};
      countRows.forEach(function (row) {
        var parentId = String(row.parentDeploymentId || row.deploymentFk || '').trim();
        if (parentId && parentId.length >= 15) {
          parentId = parentId.slice(0, 18);
          validDeploymentIds[parentId] = true;
        }
        var depId = String(row.deploymentId || '').trim();
        if (depId && depId.indexOf('__pf__') < 0 && depId.indexOf('__product__') < 0) {
          if (depId.length >= 15) depId = depId.slice(0, 18);
          validDeploymentIds[depId] = true;
        }
      });

      // Expected cols: A=Id, B=Deployment__r.Id, C=Plan_Owner, D=DHP_Last_Updated, E=Plan_Update, F=Action_Plan, G=Issue_Category
      var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      var delimiter = dhpCfg.issueCategoryDelimiter || ';';

      var categoryCount = {};
      var dhpDeploymentIdsMatched = {};
      var dhpDeploymentIdsUnmatched = {};
      var totalIssues = 0;
      var rawDhpRecordCount = 0;

      data.forEach(function (row) {
        var deploymentId = String(row[1] || '').trim();
        var categories = String(row[6] || '').trim();

        if (!deploymentId) return;
        rawDhpRecordCount++;

        var canonId = deploymentId.length >= 15 ? deploymentId.slice(0, 18) : deploymentId;
        var isMatched = !!validDeploymentIds[canonId];

        if (!categories) {
          if (!isMatched) dhpDeploymentIdsUnmatched[canonId] = true;
          return;
        }

        if (!isMatched) {
          dhpDeploymentIdsUnmatched[canonId] = true;
          return;
        }

        dhpDeploymentIdsMatched[canonId] = true;

        var cats = categories.split(delimiter).map(function (c) {
          return String(c || '').trim();
        }).filter(function (c) { return c.length > 0; });

        cats.forEach(function (cat) {
          totalIssues++;
          categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        });
      });

      // Count countRows with and without DHP.
      var rowsWithDhp = 0;
      var rowsWithoutDhp = 0;
      countRows.forEach(function (row) {
        var parentId = String(row.parentDeploymentId || row.deploymentFk || '').trim();
        if (parentId && parentId.length >= 15) {
          parentId = parentId.slice(0, 18);
          if (dhpDeploymentIdsMatched[parentId]) {
            rowsWithDhp++;
            return;
          }
        }
        var depId = String(row.deploymentId || '').trim();
        if (depId && depId.indexOf('__pf__') < 0 && depId.indexOf('__product__') < 0) {
          if (depId.length >= 15) depId = depId.slice(0, 18);
          if (dhpDeploymentIdsMatched[depId]) {
            rowsWithDhp++;
            return;
          }
        }
        rowsWithoutDhp++;
      });

      var topCats = Object.keys(categoryCount)
        .map(function (cat) {
          return { category: cat, count: categoryCount[cat] };
        })
        .sort(function (a, b) { return b.count - a.count; })
        .slice(0, 10);

      return {
        topCategories: topCats,
        totalIssuesCount: totalIssues,
        deploymentsWithIssuesCount: Object.keys(dhpDeploymentIdsMatched).length,
        activeRowsWithHealthPlans: rowsWithDhp,
        activeRowsWithoutHealthPlans: rowsWithoutDhp,
        rawDhpRecordCount: rawDhpRecordCount,
        matchedDhpDeploymentIds: Object.keys(dhpDeploymentIdsMatched),
        unmatchedDhpDeploymentIds: Object.keys(dhpDeploymentIdsUnmatched)
      };
    } catch (err) {
      Logger.log('buildDhpMetrics_: error — ' + err);
      return {
        topCategories: [],
        totalIssuesCount: 0,
        deploymentsWithIssuesCount: 0,
        activeRowsWithHealthPlans: 0,
        activeRowsWithoutHealthPlans: (countRows || []).length,
        rawDhpRecordCount: 0,
        matchedDhpDeploymentIds: [],
        unmatchedDhpDeploymentIds: []
      };
    }
  }

  /**
   * Add calendar days to a YYYY-MM-DD key.
   * @param {string} yearMonthDay
   * @param {number} days
   * @return {string}
   * @private
   */
  function addDaysToDateKey_(yearMonthDay, days) {
    if (!yearMonthDay) return '';
    var tz = Session.getScriptTimeZone();
    var parts = String(yearMonthDay).split('-');
    if (parts.length !== 3) return '';
    var d = new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
    d.setDate(d.getDate() + days);
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }

  /**
   * True when row contributes to portfolio health totals.
   * @param {Object} row
   * @return {boolean}
   * @private
   */
  function isPortfolioHealthRow_(row) {
    var h = String(row.health || '').trim();
    return h === 'Green' || h === 'Yellow' || h === 'Red';
  }

  /**
   * Resolve partner label for a count row.
   * @param {Object} row
   * @return {string}
   * @private
   */
  function partnerNameForRow_(row) {
    var p = String(row.partner || '').trim();
    if (!p) p = String(row.implPartner || '').trim();
    if (!p) p = String(row.deploymentPartnerName || '').trim();
    if (!p) p = String(row.primingPartner || '').trim();
    return p || 'Unassigned';
  }

  /**
   * Resolve industry label for a count row.
   * @param {Object} row
   * @return {string}
   * @private
   */
  function industryNameForRow_(row, cfg) {
    if (cfg && CoreConfig.isProductModeApp(cfg)) {
      return CoreData.getDeploymentGroupingValue(row, cfg);
    }
    var ind = String(row.industry || '').trim();
    return ind || 'Unknown';
  }

  /**
   * Build top N + Other distribution rows.
   * @param {Array<Object>} rows
   * @param {function(Object):string} nameFn
   * @param {number} denominator
   * @param {number} topN
   * @return {{rows: Array<Object>, top: Object|null, total: number}}
   * @private
   */
  function buildRankedDistribution_(rows, nameFn, denominator, topN) {
    topN = Math.max(1, Number(topN || 10));
    denominator = Number(denominator || 0);
    var byName = {};
    rows.forEach(function (r) {
      var name = nameFn(r);
      byName[name] = (byName[name] || 0) + 1;
    });

    var ranked = Object.keys(byName)
      .map(function (name) {
        return { name: name, count: byName[name] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
      });

    var top = ranked.slice(0, topN);
    var otherCount = ranked.slice(topN).reduce(function (s, x) { return s + x.count; }, 0);
    if (otherCount > 0) {
      top.push({ name: 'Other', count: otherCount });
    }

    var dist = top.map(function (item) {
      var pct = denominator > 0 ? item.count / denominator : 0;
      return {
        name: item.name,
        label: item.name,
        count: item.count,
        percent: pct,
        pct: pct
      };
    });

    return {
      rows: dist,
      top: dist.length ? dist[0] : null,
      total: denominator
    };
  }

  /**
   * Build lookup set from matched DHP deployment ids.
   * @param {Array<string>} matchedIds
   * @return {Object<string, boolean>}
   * @private
   */
  function buildDhpMatchedSet_(matchedIds) {
    var set = {};
    (matchedIds || []).forEach(function (id) {
      var canon = String(id || '').trim();
      if (!canon) return;
      if (canon.length >= 18) canon = canon.slice(0, 18);
      else if (canon.length >= 15) canon = canon.slice(0, 18);
      set[canon] = true;
      if (canon.length >= 15) set[canon.slice(0, 15)] = true;
    });
    return set;
  }

  /**
   * True when a count row has a matched DHP record.
   * @param {Object} row
   * @param {Object<string, boolean>} dhpSet
   * @return {boolean}
   * @private
   */
  function countRowHasDhp_(row, dhpSet) {
    var parentId = String(row.parentDeploymentId || row.deploymentFk || '').trim();
    if (parentId && parentId.length >= 15) {
      parentId = parentId.slice(0, 18);
      if (dhpSet[parentId] || dhpSet[parentId.slice(0, 15)]) return true;
    }
    var depId = String(row.deploymentId || '').trim();
    if (depId && depId.indexOf('__pf__') < 0 && depId.indexOf('__product__') < 0) {
      if (depId.length >= 15) depId = depId.slice(0, 18);
      if (dhpSet[depId] || dhpSet[depId.slice(0, 15)]) return true;
    }
    return false;
  }

  /**
   * Account ids with Executive Watch from Wellness-enriched count rows.
   * @param {Array<Object>} countRows
   * @return {Object<string, boolean>}
   * @private
   */
  function buildExecutiveWatchAccountSet_(countRows) {
    var set = {};
    (countRows || []).forEach(function (row) {
      if (!row.isExecutiveWatch) return;
      var aid = String(row.accountId || '').trim();
      if (!aid) return;
      set[aid.slice(0, 15)] = true;
      if (aid.length >= 18) set[aid.slice(0, 18)] = true;
    });
    return set;
  }

  /**
   * True when a grouped go-live event has any parent deployment with DHP.
   * @param {Object} event
   * @param {Object<string, boolean>} dhpSet
   * @return {boolean}
   * @private
   */
  function goLiveEventHasHealthPlan_(event, dhpSet) {
    var ids = [];
    if (event.parentDeploymentIds && event.parentDeploymentIds.length) {
      ids = event.parentDeploymentIds.slice();
    }
    if (event.parentDeploymentId) ids.push(event.parentDeploymentId);
    if (event.deploymentFk) ids.push(event.deploymentFk);
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i] || '').trim();
      if (!id) continue;
      var canon = id.length >= 15 ? id.slice(0, 18) : id;
      if (dhpSet[canon] || dhpSet[canon.slice(0, 15)]) return true;
    }
    return false;
  }

  /**
   * True when a grouped go-live event account is on Executive Watch.
   * @param {Object} event
   * @param {Object<string, boolean>} ewSet
   * @return {boolean}
   * @private
   */
  function goLiveEventOnExecutiveWatch_(event, ewSet) {
    var aid = String(event.accountId || '').trim();
    if (!aid) return false;
    return !!(ewSet[aid.slice(0, 15)] || ewSet[aid.slice(0, 18)]);
  }

  /**
   * Build health plan concentration by partner from DHP-matched count rows.
   * @param {Array<Object>} countRows
   * @param {Object} dhpMetrics
   * @param {number} topN
   * @return {{rows: Array<Object>, top: Object|null, denominator: number}}
   * @private
   */
  function buildHealthPlansByPartner_(countRows, dhpMetrics, topN) {
    var dhpSet = buildDhpMatchedSet_(dhpMetrics.matchedDhpDeploymentIds);
    var hpRows = (countRows || []).filter(function (row) {
      return isPortfolioHealthRow_(row) && countRowHasDhp_(row, dhpSet);
    });
    var denominator = hpRows.length || dhpMetrics.activeRowsWithHealthPlans || 0;
    var dist = buildRankedDistribution_(hpRows, partnerNameForRow_, denominator, topN);
    return {
      rows: dist.rows,
      top: dist.top,
      denominator: denominator
    };
  }

  /**
   * Build structured go-live readiness metrics for ProductMode vNext.
   * @param {AppConfig} cfg
   * @param {Array<Object>} countRows
   * @param {Object} dhpMetrics
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   * @private
   */
  function buildGoLiveReadiness_(cfg, countRows, dhpMetrics, viewModeOpts, productOpts) {
    var tz = Session.getScriptTimeZone();
    var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var thirtyAhead = addDaysToDateKey_(todayKey, 30);

    var upcomingAll = [];
    var recentAll = [];
    try {
      upcomingAll = CoreData.getUpcomingGoLives(cfg, viewModeOpts, productOpts) || [];
    } catch (err) {
      Logger.log('buildGoLiveReadiness_: getUpcomingGoLives failed — ' + err);
    }
    try {
      recentAll = CoreData.getRecentGoLives(cfg, viewModeOpts, 60, productOpts) || [];
      recentAll = CoreData.filterRowsExcludedFromReport_(recentAll);
    } catch (err) {
      Logger.log('buildGoLiveReadiness_: getRecentGoLives failed — ' + err);
    }

    var upcoming30Events = upcomingAll.filter(function (ev) {
      var d = String(ev.goLiveDate || ev.nextGoLiveDate || ev.mtpDate || '').trim();
      if (!d) return false;
      var key = d.length >= 10 ? d.slice(0, 10) : d;
      return key >= todayKey && key <= thirtyAhead;
    });

    var dhpSet = buildDhpMatchedSet_(dhpMetrics.matchedDhpDeploymentIds);
    var ewEnabled = CoreConfig.isExecutiveWatchEnabled(cfg);
    var ewSet = ewEnabled ? buildExecutiveWatchAccountSet_(countRows) : {};

    var upcomingWithHealthPlans = 0;
    var upcomingOnExecutiveWatch = 0;
    upcoming30Events.forEach(function (ev) {
      if (goLiveEventHasHealthPlan_(ev, dhpSet)) upcomingWithHealthPlans++;
      if (ewEnabled && goLiveEventOnExecutiveWatch_(ev, ewSet)) upcomingOnExecutiveWatch++;
    });

    var upcoming30 = upcoming30Events.length;
    var recent60 = recentAll.length;
    var pct = function (part, whole) { return whole > 0 ? part / whole : 0; };

    return {
      upcoming30: upcoming30,
      recent60: recent60,
      upcomingWithHealthPlans: upcomingWithHealthPlans,
      upcomingOnExecutiveWatch: upcomingOnExecutiveWatch,
      upcomingWithHealthPlansPct: pct(upcomingWithHealthPlans, upcoming30),
      upcomingOnExecutiveWatchPct: pct(upcomingOnExecutiveWatch, upcoming30),
      upcoming: upcoming30,
      recent: recent60,
      recentGoLives: recent60,
      withHealthPlans: upcomingWithHealthPlans,
      goLivesWithHealthPlans: upcomingWithHealthPlans,
      executiveWatch: upcomingOnExecutiveWatch,
      goLivesOnExecutiveWatch: upcomingOnExecutiveWatch,
      upcomingEvents: upcoming30Events.slice(0, 10).map(function (ev) {
        return {
          accountName: ev.accountName || '',
          goLiveDate: ev.goLiveDate || ev.nextGoLiveDate || ev.mtpDate || '',
          partner: ev.partner || ''
        };
      })
    };
  }

  /**
   * Build top N + Other distribution from rows by key (partner/industry/region).
   * @private
   */
  function buildTopNDistribution_(rows, keyFn, topN, allLabel) {
    topN = Math.max(1, Number(topN || 10));
    var byKey = {};
    rows.forEach(function (r) {
      var k = keyFn(r);
      if (!k) return;
      byKey[k] = (byKey[k] || 0) + 1;
    });

    var ranked = Object.keys(byKey)
      .map(function (k) { return { label: k, count: byKey[k] }; })
      .sort(function (a, b) { return b.count - a.count; });

    var top = ranked.slice(0, topN);
    var otherCount = ranked.slice(topN).reduce(function (s, x) { return s + x.count; }, 0);
    if (otherCount > 0) {
      top.push({ label: 'Other', count: otherCount });
    }
    return top;
  }

  /**
   * Build deterministic executive insights.
   * @private
   */
  function buildExecutiveInsights_(snapshot, cfg, countRows, partnerSplit, industrySplit, dhpMetrics, context) {
    var insights = [];
    context = context || {};

    try {
      var topPartner = context.topPartner || null;
      var topIndustry = context.topIndustry || null;
      var goLiveReadiness = context.goLiveReadiness || {};
      var openHealthPlans = dhpMetrics ? (dhpMetrics.activeRowsWithHealthPlans || 0) : 0;

      // Insight 1: Portfolio concentration
      if (topPartner && topPartner.name) {
        var portfolioText = topPartner.name + ' is the top partner';
        if (topIndustry && topIndustry.name) {
          portfolioText += '; ' + topIndustry.name + ' is the top industry';
        }
        portfolioText += '.';
        insights.push({
          title: 'Portfolio',
          text: portfolioText,
          metric: topPartner.count,
          tone: 'neutral'
        });
      } else if (partnerSplit && partnerSplit.totals) {
        var legacyTop = partnerSplit.totals.workdayCount > partnerSplit.totals.otherCount
          ? 'Workday' : 'Partners';
        insights.push({
          title: 'Portfolio',
          text: legacyTop + ' leads deployment leadership across the portfolio.',
          metric: snapshot.totals.total,
          tone: 'neutral'
        });
      }

      // Insight 2: Risk (top issue category or open health plans)
      var topCategory = dhpMetrics && dhpMetrics.topCategories && dhpMetrics.topCategories.length > 0
        ? dhpMetrics.topCategories[0].category
        : null;
      if (topCategory) {
        insights.push({
          title: 'Risk',
          text: topCategory + ' is the leading Health Plan issue category.',
          metric: dhpMetrics.topCategories[0].count,
          tone: 'risk'
        });
      } else if (openHealthPlans > 0) {
        insights.push({
          title: 'Risk',
          text: openHealthPlans + ' active deployments have open Health Plans.',
          metric: openHealthPlans,
          tone: 'risk'
        });
      } else {
        var atRisk = (snapshot.totals.red || 0) + (snapshot.totals.yellow || 0);
        insights.push({
          title: 'Risk',
          text: atRisk + ' deployments are at risk (Red/Yellow).',
          metric: atRisk,
          tone: atRisk > 0 ? 'risk' : 'neutral'
        });
      }

      // Insight 3: Go-Live readiness
      var upcoming30 = goLiveReadiness.upcoming30 || 0;
      var upcomingWithHp = goLiveReadiness.upcomingWithHealthPlans || 0;
      var recent60 = goLiveReadiness.recent60 || 0;
      var goLiveText;
      var goLiveMetric = 0;
      var goLiveTone = 'watch';

      if (upcomingWithHp > 0) {
        goLiveText = upcomingWithHp + ' of ' + upcoming30 +
          ' upcoming go-lives are tied to open Health Plans.';
        goLiveMetric = upcomingWithHp;
      } else if (upcoming30 > 0) {
        goLiveText = upcoming30 + ' go-lives are scheduled in the next 30 days.';
        goLiveMetric = upcoming30;
      } else if (recent60 > 0) {
        goLiveText = recent60 + ' recent go-lives completed in the last 60 days.';
        goLiveMetric = recent60;
        goLiveTone = 'neutral';
      } else {
        goLiveText = 'No near-term go-live activity is currently scheduled.';
        goLiveTone = 'neutral';
      }

      insights.push({
        title: 'Go-Live',
        text: goLiveText,
        metric: goLiveMetric,
        tone: goLiveTone
      });
    } catch (err) {
      Logger.log('buildExecutiveInsights_: error — ' + err);
    }

    return insights.length >= 3 ? insights.slice(0, 3) : insights;
  }

  /**
   * Build Portfolio Health vNext snapshot (ProductMode).
   * Enriches classic snapshot with DHP, Wellness, and vNext metrics.
   *
   * @param {AppConfig} cfg
   * @param {Object} baseSnapshot  from getSnapshot()
   * @param {Object} productOpts
   * @return {Object}
   * @private
   */
  function getPortfolioHealthVNextSnapshot_(cfg, baseSnapshot, countRows, displayRows, viewModeOpts, productOpts) {
    var ph = (cfg && cfg.report && cfg.report.portfolioHealth) || {};
    var topN = Number(ph.industryTopN || 10);
    var healthRows = (countRows || []).filter(isPortfolioHealthRow_);
    var totalActive = baseSnapshot.totals.total;

    // DHP metrics
    var dhpMetrics = buildDhpMetrics_(cfg, countRows);

    var ewEnabled = CoreConfig.isExecutiveWatchEnabled(cfg);

    // Executive Watch (Wellness / isExecutiveWatch on count rows)
    var executiveWatch = ewEnabled
      ? healthRows.filter(function (row) { return !!row.isExecutiveWatch; }).length
      : 0;
    var executiveWatchPct = (ewEnabled && totalActive > 0) ? executiveWatch / totalActive : 0;

    // Partner + industry concentration (Partner Analysis may exclude configured partners)
    var partnerRowsForAnalysis = CoreConfig.filterRowsForPartnerAnalysis_(healthRows, cfg);
    var partnerDenominator = partnerRowsForAnalysis.length;
    var partnerDist = buildRankedDistribution_(
      partnerRowsForAnalysis, partnerNameForRow_, partnerDenominator, topN
    );
    var industryDist = buildRankedDistribution_(healthRows, function (r) {
      return industryNameForRow_(r, cfg);
    }, totalActive, topN);

    // Health plan concentration by partner (DHP only)
    var hpByPartner = buildHealthPlansByPartner_(countRows, dhpMetrics, topN);
    var healthPlanConcentration = hpByPartner.top ? {
      dimension: String(ph.healthPlanConcentrationDimension || 'partner'),
      name: hpByPartner.top.name,
      count: hpByPartner.top.count,
      percent: hpByPartner.top.percent
    } : {
      dimension: String(ph.healthPlanConcentrationDimension || 'partner'),
      name: '',
      count: 0,
      percent: 0
    };

    // Go-live readiness
    var goLiveReadiness = buildGoLiveReadiness_(cfg, countRows, dhpMetrics, viewModeOpts, productOpts);

    var insightContext = {
      topPartner: partnerDist.top,
      topIndustry: industryDist.top,
      goLiveReadiness: goLiveReadiness
    };

    // Executive insights
    var insights = buildExecutiveInsights_(
      baseSnapshot, cfg, countRows,
      baseSnapshot.partnerSplit, baseSnapshot.industrySplit, dhpMetrics, insightContext
    );

    // Enrich the base snapshot
    return {
      vNext: true,
      layoutMode: cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled ? 'product' : 'industry',
      executiveWatchEnabled: ewEnabled,

      appId:        baseSnapshot.appId,
      title:        baseSnapshot.title,
      subtitle:     'Executive Snapshot',
      monthLabel:   baseSnapshot.monthLabel,
      generatedLabel: baseSnapshot.generatedLabel,
      generatedAt:  baseSnapshot.generatedAt,
      overrideFootnote: baseSnapshot.overrideFootnote,

      portfolioStatus: {
        totalActive:   totalActive,
        green:         baseSnapshot.totals.green,
        yellow:        baseSnapshot.totals.yellow,
        red:           baseSnapshot.totals.red,
        atRisk:        (baseSnapshot.totals.yellow || 0) + (baseSnapshot.totals.red || 0),
        greenPct:      baseSnapshot.totals.greenPct,
        yellowPct:     baseSnapshot.totals.yellowPct,
        redPct:        baseSnapshot.totals.redPct,
        executiveWatch: executiveWatch,
        executiveWatchPct: executiveWatchPct,
        openHealthPlans: dhpMetrics.activeRowsWithHealthPlans,
        upcomingGoLives30: goLiveReadiness.upcoming30
      },

      partnerAnalysis: {
        excludePartners: CoreConfig.getPartnerAnalysisExcludePartners(cfg)
      },

      portfolioConcentration: {
        partnerDistribution: partnerDist.rows,
        partnerTotal: partnerDist.total,
        topPartner: partnerDist.top ? {
          name: partnerDist.top.name,
          count: partnerDist.top.count,
          percent: partnerDist.top.percent
        } : null,
        industryDistribution: industryDist.rows,
        industryTotal: industryDist.total,
        topIndustry: industryDist.top ? {
          name: industryDist.top.name,
          count: industryDist.top.count,
          percent: industryDist.top.percent
        } : null
      },

      deliveryOwnership: baseSnapshot.partnerSplit ? {
        workdayLed:  baseSnapshot.partnerSplit.totals.workdayCount,
        partnerLed:  baseSnapshot.partnerSplit.totals.otherCount,
        total:       baseSnapshot.partnerSplit.totals.total,
        workdayPct:  baseSnapshot.partnerSplit.totals.workdayPct,
        partnerPct:  baseSnapshot.partnerSplit.totals.otherPct
      } : {},

      goLiveReadiness: goLiveReadiness,

      deploymentHealthInsights: {
        openHealthPlans:            dhpMetrics.activeRowsWithHealthPlans,
        openHealthPlanRecords:      dhpMetrics.totalIssuesCount,
        openHealthPlanDeployments:  dhpMetrics.deploymentsWithIssuesCount,
        activeRowsWithHealthPlans:  dhpMetrics.activeRowsWithHealthPlans,
        activeRowsWithoutHealthPlans: dhpMetrics.activeRowsWithoutHealthPlans,
        totalActiveRowsChecked:     dhpMetrics.activeRowsWithHealthPlans + dhpMetrics.activeRowsWithoutHealthPlans,
        topIssueCategory:      dhpMetrics.topCategories.length > 0 ? dhpMetrics.topCategories[0].category : '',
        topIssueCategoryCount: dhpMetrics.topCategories.length > 0 ? dhpMetrics.topCategories[0].count : 0,
        issueCategories:       dhpMetrics.topCategories,
        healthPlansByPartner:  hpByPartner.rows,
        healthPlanConcentration: healthPlanConcentration
      },

      executiveInsights: insights,

      // Keep classic fields for compatibility
      classic: baseSnapshot
    };
  }

  /**
   * Diagnostic: log Portfolio Health vNext snapshot structure and metrics.
   * Returns a structured summary object.
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  function debugPortfolioHealthVNext(cfg, viewModeOpts, productOpts) {
    var diagnostic = {
      ok: true,
      diagnostic: 'debugPortfolioHealthVNext',
      appId: cfg && cfg.appId ? String(cfg.appId) : 'unknown',
      generatedAt: new Date().toISOString(),
      executiveWatchEnabled: CoreConfig.isExecutiveWatchEnabled(cfg),
      vNextEnabled: !!(cfg && cfg.report && cfg.report.portfolioHealth && cfg.report.portfolioHealth.vNextEnabled),
      portfolioTotalActive: 0,
      dhpOpenHealthPlans: 0,
      issueCategoryCount: 0,
      executiveInsights: 0,
      executiveWatch: 0,
      executiveWatchPct: 0,
      partnerDistributionCount: 0,
      topPartner: null,
      topIndustry: null,
      healthPlansByPartnerCount: 0,
      healthPlanConcentration: null,
      upcomingGoLives30: 0,
      recent60: 0,
      upcomingWithHealthPlans: 0,
      upcomingOnExecutiveWatch: 0,
      upcomingGoLivesMismatchWarning: false,
      slidesExportAvailable: true
    };

    try {
      var snapshot = getSnapshot(cfg, viewModeOpts, productOpts);
      diagnostic.vNext = !!snapshot.vNext;
      diagnostic.layoutMode = snapshot.layoutMode || 'unknown';
      diagnostic.portfolioTotalActive = snapshot.portfolioStatus ? snapshot.portfolioStatus.totalActive : 0;
      var ps = snapshot.portfolioStatus || {};
      var dhi = snapshot.deploymentHealthInsights || {};
      var pc = snapshot.portfolioConcentration || {};
      var glr = snapshot.goLiveReadiness || {};

      diagnostic.dhpOpenHealthPlans = dhi.openHealthPlans || 0;
      diagnostic.activeRowsWithHealthPlans = dhi.activeRowsWithHealthPlans || 0;
      diagnostic.activeRowsWithoutHealthPlans = dhi.activeRowsWithoutHealthPlans || 0;
      diagnostic.totalActiveRowsChecked = dhi.totalActiveRowsChecked || 0;
      diagnostic.issueCategoryCount = (dhi.issueCategories || []).length;
      diagnostic.executiveInsights = (snapshot.executiveInsights || []).length;

      diagnostic.executiveWatch = ps.executiveWatch || 0;
      diagnostic.executiveWatchPct = ps.executiveWatchPct || 0;
      if (!diagnostic.executiveWatchEnabled) {
        diagnostic.runtimeExecutiveWatch = diagnostic.executiveWatch;
        try {
          var wellnessDbg = CoreData._debugWellnessData(cfg);
          diagnostic.shadowExecutiveWatch = wellnessDbg.shadowDeploymentRowsWithExecutiveWatch;
        } catch (shadowErr) {
          diagnostic.shadowExecutiveWatch = null;
          diagnostic.shadowExecutiveWatchError = String(shadowErr);
        }
      }
      diagnostic.partnerDistributionCount = (pc.partnerDistribution || []).length;
      diagnostic.topPartner = pc.topPartner || null;
      diagnostic.topIndustry = pc.topIndustry || null;
      diagnostic.healthPlansByPartnerCount = (dhi.healthPlansByPartner || []).length;
      diagnostic.healthPlanConcentration = dhi.healthPlanConcentration || null;
      diagnostic.upcomingGoLives30 = glr.upcoming30 || ps.upcomingGoLives30 || 0;
      diagnostic.recent60 = glr.recent60 || 0;
      diagnostic.upcomingWithHealthPlans = glr.upcomingWithHealthPlans || 0;
      diagnostic.upcomingOnExecutiveWatch = glr.upcomingOnExecutiveWatch || 0;

      if (ps.upcomingGoLives30 === glr.recent60 &&
          glr.upcoming30 !== glr.recent60) {
        diagnostic.upcomingGoLivesMismatchWarning = true;
      }

      Logger.log('=== Portfolio Health vNext Debug ===');
      Logger.log('vNext enabled: ' + diagnostic.vNextEnabled);
      Logger.log('vNext active: ' + diagnostic.vNext);
      Logger.log('layoutMode: ' + diagnostic.layoutMode);
      Logger.log('portfolioStatus.totalActive: ' + diagnostic.portfolioTotalActive);
      Logger.log('portfolioStatus.executiveWatch: ' + diagnostic.executiveWatch +
        ' (' + (diagnostic.executiveWatchPct * 100).toFixed(1) + '%)');
      Logger.log('portfolioStatus.upcomingGoLives30: ' + diagnostic.upcomingGoLives30);
      Logger.log('');
      Logger.log('--- DHP Metrics (corrected) ---');
      Logger.log('deploymentHealthInsights.openHealthPlans (business KPI): ' + diagnostic.dhpOpenHealthPlans);
      Logger.log('deploymentHealthInsights.activeRowsWithHealthPlans: ' + diagnostic.activeRowsWithHealthPlans);
      Logger.log('deploymentHealthInsights.activeRowsWithoutHealthPlans: ' + diagnostic.activeRowsWithoutHealthPlans);
      Logger.log('deploymentHealthInsights.totalActiveRowsChecked: ' + diagnostic.totalActiveRowsChecked);
      Logger.log('deploymentHealthInsights.issueCategories.count: ' + diagnostic.issueCategoryCount);
      Logger.log('deploymentHealthInsights.healthPlansByPartner.count: ' + diagnostic.healthPlansByPartnerCount);
      if (diagnostic.healthPlanConcentration) {
        Logger.log('deploymentHealthInsights.healthPlanConcentration: ' +
          JSON.stringify(diagnostic.healthPlanConcentration));
      }
      if (diagnostic.totalActiveRowsChecked > 0) {
        var pct = (diagnostic.dhpOpenHealthPlans / diagnostic.totalActiveRowsChecked * 100).toFixed(1);
        Logger.log('  (' + pct + '% of active rows have health plans)');
      }
      if (diagnostic.dhpOpenHealthPlans > diagnostic.portfolioTotalActive * 0.75) {
        Logger.log('  WARNING: openHealthPlans is suspiciously high (>75% of totalActive)');
        Logger.log('  Verify DHP join logic and that rows without DHP are not counted as DHP rows.');
      }
      Logger.log('');
      Logger.log('--- Portfolio Concentration ---');
      Logger.log('partnerDistribution.count: ' + diagnostic.partnerDistributionCount);
      if (diagnostic.topPartner) {
        Logger.log('topPartner: ' + diagnostic.topPartner.name + ' (' + diagnostic.topPartner.count + ')');
      }
      if (diagnostic.topIndustry) {
        Logger.log('topIndustry: ' + diagnostic.topIndustry.name + ' (' + diagnostic.topIndustry.count + ')');
      }
      Logger.log('');
      Logger.log('--- Go-Live Readiness ---');
      Logger.log('goLiveReadiness.upcoming30: ' + diagnostic.upcomingGoLives30);
      Logger.log('goLiveReadiness.recent60: ' + diagnostic.recent60);
      Logger.log('goLiveReadiness.upcomingWithHealthPlans: ' + diagnostic.upcomingWithHealthPlans);
      Logger.log('goLiveReadiness.upcomingOnExecutiveWatch: ' + diagnostic.upcomingOnExecutiveWatch);
      if (diagnostic.upcomingGoLivesMismatchWarning) {
        Logger.log('  WARNING: upcomingGoLives30 appears to mirror recent60; verify go-live readiness builder.');
      }
      Logger.log('');
      Logger.log('executiveInsights.count: ' + diagnostic.executiveInsights);
      if (snapshot.executiveInsights && snapshot.executiveInsights.length) {
        snapshot.executiveInsights.forEach(function (insight, idx) {
          Logger.log('  [' + idx + '] ' + insight.title + ': ' + insight.text);
        });
      }
    } catch (err) {
      diagnostic.ok = false;
      diagnostic.error = String(err);
      Logger.log('debugPortfolioHealthVNext: error — ' + diagnostic.error);
    }

    return diagnostic;
  }

  // ---------------------------------------------------------------------------
  // PORTFOLIO HEALTH — GOOGLE SLIDES EXPORT (ProductMode vNext)
  // ---------------------------------------------------------------------------

  /** @const {Object<string, string>} */
  var PH_SLIDES_COLORS_ = {
    navy: '#0F4C81',
    green: '#10B981',
    yellow: '#F59E0B',
    red: '#EF4444',
    dhp: '#6D28D9',
    indigo: '#4F46E5',
    teal: '#0891B2',
    partner: '#64748B',
    text: '#0F172A',
    muted: '#64748B',
    cardBg: '#F8FAFC',
    white: '#FFFFFF',
    track: '#E2E8F0'
  };

  /** @const {Object<string, number>} Shared slide layout zones (points). */
  var PH_SLIDES_LAYOUT_ = {
    MARGIN: 36,
    HEADER_H: 50,
    FOOTER_H: 26,
    FOOTER_PAD: 12,
    BODY_GAP: 10,
    BAR_ROW_MIN_H: 22,
    BAR_ROW_MAX_H: 28,
    BAR_ROW_GAP: 6,
    CALLOUT_TILE_H: 50,
    CARD_SECTION_GAP: 14,
    INSIGHT_H: 52
  };

  /**
   * @param {*} value
   * @param {number=} fallback
   * @return {number}
   * @private
   */
  function phSlidesSafeNum_(value, fallback) {
    var n = Number(value);
    return isNaN(n) ? (fallback || 0) : n;
  }

  /**
   * @param {number} part
   * @param {number} whole
   * @return {number}
   * @private
   */
  function phSlidesPctOf_(part, whole) {
    whole = phSlidesSafeNum_(whole, 0);
    return whole > 0 ? phSlidesSafeNum_(part, 0) / whole : 0;
  }

  /**
   * @param {number} pct
   * @return {string}
   * @private
   */
  function formatPct_(pct) {
    if (pct === undefined || pct === null || isNaN(pct)) return '0%';
    return (Math.round(pct * 1000) / 10) + '%';
  }

  /**
   * @param {*} text
   * @param {number=} maxLen
   * @return {string}
   * @private
   */
  function safeText_(text, maxLen) {
    var s = String(text === undefined || text === null ? '' : text).trim();
    if (!maxLen || s.length <= maxLen) return s;
    return s.slice(0, Math.max(1, maxLen - 1)) + '\u2026';
  }

  /**
   * @param {*} text
   * @param {number=} maxLen
   * @return {string}
   * @private
   */
  function truncateText_(text, maxLen) {
    return safeText_(text, maxLen);
  }

  /**
   * @param {Object} snapshot
   * @return {number}
   * @private
   */
  function phSlidesOpenHealthPlans_(snapshot) {
    var ps = snapshot.portfolioStatus || {};
    var dhi = snapshot.deploymentHealthInsights || {};
    if (ps.openHealthPlans !== undefined && ps.openHealthPlans !== null) {
      return phSlidesSafeNum_(ps.openHealthPlans, 0);
    }
    return phSlidesSafeNum_(dhi.openHealthPlans, 0);
  }

  /**
   * @param {Object} snapshot
   * @return {Object}
   * @private
   */
  function phSlidesGoLiveReadiness_(snapshot) {
    if (snapshot.goLiveReadiness) return snapshot.goLiveReadiness;
    var ps = snapshot.portfolioStatus || {};
    return {
      upcoming30: phSlidesSafeNum_(ps.upcomingGoLives30, 0),
      recent60: 0,
      upcomingWithHealthPlans: 0,
      upcomingOnExecutiveWatch: 0
    };
  }

  /**
   * @param {Array<Object>} raw
   * @return {Array<Object>}
   * @private
   */
  function phSlidesDistItems_(raw) {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * @param {Object} row
   * @param {number} total
   * @param {string=} labelKey
   * @return {{label: string, count: number, pct: number}}
   * @private
   */
  function phSlidesNormalizeDistRow_(row, total, labelKey) {
    labelKey = labelKey || 'label';
    var label = row[labelKey] || row.label || row.category || row.name || 'Unknown';
    var count = phSlidesSafeNum_(row.count !== undefined ? row.count : row.total, 0);
    var pct = row.pct;
    if (pct === undefined || pct === null || isNaN(pct)) {
      if (row.percent !== undefined && row.percent !== null) pct = row.percent;
      else if (row.portfolioPct !== undefined && row.portfolioPct !== null) pct = row.portfolioPct;
      else if (row.share !== undefined && row.share !== null) pct = row.share;
      else pct = phSlidesPctOf_(count, total);
    }
    return { label: String(label), count: count, pct: pct };
  }

  /**
   * @param {Object} snapshot
   * @return {Array<Object>}
   * @private
   */
  function phSlidesPartnerDistribution_(snapshot) {
    var pc = snapshot.portfolioConcentration || {};
    var raw = phSlidesDistItems_(pc.partnerDistribution);
    if (!raw.length) return [];
    var total = phSlidesSafeNum_(pc.partnerTotal, 0);
    if (!total) {
      total = raw.reduce(function (s, r) { return s + phSlidesSafeNum_(r.count, 0); }, 0);
    }
    return raw.map(function (r) { return phSlidesNormalizeDistRow_(r, total); });
  }

  /**
   * @param {Object} snapshot
   * @return {Array<Object>}
   * @private
   */
  function phSlidesIndustryDistribution_(snapshot) {
    var pc = snapshot.portfolioConcentration || {};
    var raw = phSlidesDistItems_(pc.industryDistribution);
    if (!raw.length) return [];
    var total = phSlidesSafeNum_(pc.industryTotal, 0);
    if (!total) {
      total = raw.reduce(function (s, r) { return s + phSlidesSafeNum_(r.count, 0); }, 0);
    }
    return raw.map(function (r) { return phSlidesNormalizeDistRow_(r, total); });
  }

  /**
   * @param {Object} snapshot
   * @return {Array<Object>}
   * @private
   */
  function phSlidesIssueCategories_(snapshot) {
    var dhi = snapshot.deploymentHealthInsights || {};
    var cats = dhi.issueCategories || [];
    var openPlans = phSlidesOpenHealthPlans_(snapshot);
    var denom = openPlans || cats.reduce(function (s, c) {
      return s + phSlidesSafeNum_(c.count, 0);
    }, 0);
    return cats.map(function (c) {
      return phSlidesNormalizeDistRow_(c, denom, 'category');
    });
  }

  /**
   * @param {Object} snapshot
   * @return {Array<Object>}
   * @private
   */
  function phSlidesHealthPlanConcentration_(snapshot) {
    var dhi = snapshot.deploymentHealthInsights || {};
    var raw = phSlidesDistItems_(dhi.healthPlansByPartner);
    if (!raw.length) return [];
    var openPlans = phSlidesOpenHealthPlans_(snapshot);
    var total = openPlans || raw.reduce(function (s, r) {
      return s + phSlidesSafeNum_(r.count, 0);
    }, 0);
    return raw.map(function (r) { return phSlidesNormalizeDistRow_(r, total); });
  }

  /**
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function phSlidesInitLayout_(presentation, snapshot, cfg) {
    var pw = presentation.getPageWidth();
    var ph = presentation.getPageHeight();
    var margin = PH_SLIDES_LAYOUT_.MARGIN;
    var headerH = PH_SLIDES_LAYOUT_.HEADER_H;
    var footerH = PH_SLIDES_LAYOUT_.FOOTER_H;
    var footerPad = PH_SLIDES_LAYOUT_.FOOTER_PAD;
    var bodyTop = margin + headerH + PH_SLIDES_LAYOUT_.BODY_GAP;
    var footerY = ph - margin - footerH;
    var contentBottom = footerY - footerPad;
    return {
      pres: presentation,
      cfg: cfg,
      snapshot: snapshot,
      pw: pw,
      ph: ph,
      margin: margin,
      headerH: headerH,
      footerH: footerH,
      footerY: footerY,
      contentLeft: margin,
      contentTop: bodyTop,
      bodyTop: bodyTop,
      contentWidth: pw - (margin * 2),
      contentBottom: contentBottom,
      bodyBottom: contentBottom,
      bodyHeight: contentBottom - bodyTop,
      font: 'Arial',
      generatedLabel: snapshot.generatedLabel || ''
    };
  }

  /**
   * Trim ranked bar-list rows to fit maxRows, aggregating overflow into Other.
   *
   * @param {Array<Object>} items
   * @param {number} maxRows
   * @return {Array<Object>}
   * @private
   */
  function phSlidesTrimBarItems_(items, maxRows) {
    if (!items || !items.length || items.length <= maxRows) {
      return items ? items.slice() : [];
    }
    maxRows = Math.max(1, maxRows);
    if (maxRows === 1) {
      var totalCount = 0;
      var totalPct = 0;
      items.forEach(function (r) {
        totalCount += phSlidesSafeNum_(r.count, 0);
        totalPct += phSlidesSafeNum_(r.pct, 0);
      });
      return [{ label: 'Other', count: totalCount, pct: totalPct }];
    }
    var kept = items.slice(0, maxRows - 1);
    var rest = items.slice(maxRows - 1);
    var otherCount = 0;
    var otherPct = 0;
    rest.forEach(function (r) {
      otherCount += phSlidesSafeNum_(r.count, 0);
      otherPct += phSlidesSafeNum_(r.pct, 0);
    });
    kept.push({ label: 'Other', count: otherCount, pct: otherPct });
    return kept;
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {string} title
   * @param {string=} subtitle
   * @private
   */
  function addSlideHeader_(slide, layout, title, subtitle) {
    var bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, layout.pw, layout.headerH);
    bar.getFill().setSolidFill(PH_SLIDES_COLORS_.navy);
    bar.getBorder().setTransparent();

    var titleBox = slide.insertShape(
      SlidesApp.ShapeType.TEXT_BOX,
      layout.margin,
      8,
      layout.pw - (layout.margin * 2),
      22
    );
    titleBox.getFill().setTransparent();
    titleBox.getBorder().setTransparent();
    var titleText = titleBox.getText();
    titleText.setText(safeText_(title, 80));
    titleText.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(16)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.white);

    if (subtitle) {
      var subBox = slide.insertShape(
        SlidesApp.ShapeType.TEXT_BOX,
        layout.margin,
        30,
        layout.pw - (layout.margin * 2),
        16
      );
      subBox.getFill().setTransparent();
      subBox.getBorder().setTransparent();
      var subText = subBox.getText();
      subText.setText(safeText_(subtitle, 120));
      subText.getTextStyle()
        .setFontFamily(layout.font)
        .setFontSize(9)
        .setForegroundColor('#CBD5E1');
    }
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @private
   */
  function addSlideFooter_(slide, layout) {
    var footerText = 'Workday Confidential';
    if (layout.generatedLabel) {
      footerText += '  |  Generated ' + layout.generatedLabel;
    }
    var footerBox = slide.insertShape(
      SlidesApp.ShapeType.TEXT_BOX,
      layout.margin,
      layout.footerY + 4,
      layout.contentWidth,
      layout.footerH
    );
    footerBox.getFill().setTransparent();
    footerBox.getBorder().setTransparent();
    var ft = footerBox.getText();
    ft.setText(footerText);
    ft.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(8)
      .setForegroundColor(PH_SLIDES_COLORS_.muted);
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} title
   * @private
   */
  function addSectionTitle_(slide, layout, x, y, w, title) {
    var box = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x, y, w, 18);
    box.getFill().setTransparent();
    box.getBorder().setTransparent();
    var t = box.getText();
    t.setText(safeText_(title, 60));
    t.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(12)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.navy);
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} label
   * @param {string|number} value
   * @param {string=} sub
   * @param {string=} accentColor
   * @private
   */
  function addKpiCard_(slide, layout, x, y, w, h, label, value, sub, accentColor) {
    var card = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, x, y, w, h);
    card.getFill().setSolidFill(PH_SLIDES_COLORS_.cardBg);
    card.getBorder().getLineFill().setSolidFill(PH_SLIDES_COLORS_.track);

    if (accentColor) {
      var accent = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, 3);
      accent.getFill().setSolidFill(accentColor);
      accent.getBorder().setTransparent();
    }

    var subH = 12;
    var subBottomPad = 12;
    var valueGap = 6;
    var labelTop = accentColor ? y + 10 : y + 8;
    var labelH = 11;
    var valueTop = labelTop + labelH + 2;
    var subTop = y + h - subBottomPad - subH;
    var valueH = subTop - valueGap - valueTop;
    if (valueH < 14) valueH = 14;
    var valueFont = 22;
    if (valueH < 20 || h < 70) valueFont = 18;
    if (valueH < 16 || h < 64) valueFont = 16;

    var labelBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 8, labelTop, w - 16, labelH);
    labelBox.getFill().setTransparent();
    labelBox.getBorder().setTransparent();
    var lt = labelBox.getText();
    lt.setText(safeText_(label, 40).toUpperCase());
    lt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(7)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.muted);

    var valueBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 8, valueTop, w - 16, valueH);
    valueBox.getFill().setTransparent();
    valueBox.getBorder().setTransparent();
    var vt = valueBox.getText();
    vt.setText(String(value));
    vt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(valueFont)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.text);

    if (sub) {
      var subBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 8, subTop, w - 16, subH);
      subBox.getFill().setTransparent();
      subBox.getBorder().setTransparent();
      var st = subBox.getText();
      st.setText(safeText_(sub, 36));
      st.getTextStyle()
        .setFontFamily(layout.font)
        .setFontSize(8)
        .setForegroundColor(PH_SLIDES_COLORS_.muted);
    }
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} label
   * @param {string|number} value
   * @param {string=} sub
   * @param {string=} accentColor
   * @private
   */
  function addMetricCard_(slide, layout, x, y, w, h, label, value, sub, accentColor) {
    addKpiCard_(slide, layout, x, y, w, h, label, value, sub, accentColor);
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} y
   * @param {string} label
   * @param {number} count
   * @param {number} pct
   * @param {number} maxCount
   * @param {string} barColor
   * @param {number=} rowH
   * @return {number}
   * @private
   */
  function addHorizontalBar_(slide, layout, y, label, count, pct, maxCount, barColor, rowH) {
    rowH = rowH || PH_SLIDES_LAYOUT_.BAR_ROW_MIN_H;
    var labelW = 176;
    var valueW = 72;
    var barH = Math.max(8, Math.round(rowH * 0.45));
    var barYOffset = Math.round((rowH - barH) / 2);
    var fontSize = rowH < 20 ? 7 : 8;
    var barX = layout.contentLeft + labelW + 6;
    var barW = layout.contentWidth - labelW - valueW - 12;
    var fillW = maxCount > 0 ? Math.max(4, (count / maxCount) * barW) : 0;

    var labelBox = slide.insertShape(
      SlidesApp.ShapeType.TEXT_BOX,
      layout.contentLeft,
      y,
      labelW,
      rowH
    );
    labelBox.getFill().setTransparent();
    labelBox.getBorder().setTransparent();
    var lt = labelBox.getText();
    lt.setText(truncateText_(label, 32));
    lt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(fontSize)
      .setForegroundColor(PH_SLIDES_COLORS_.text);

    var track = slide.insertShape(
      SlidesApp.ShapeType.ROUND_RECTANGLE, barX, y + barYOffset, barW, barH
    );
    track.getFill().setSolidFill(PH_SLIDES_COLORS_.track);
    track.getBorder().setTransparent();

    if (fillW > 0) {
      var fill = slide.insertShape(
        SlidesApp.ShapeType.ROUND_RECTANGLE, barX, y + barYOffset, fillW, barH
      );
      fill.getFill().setSolidFill(barColor || PH_SLIDES_COLORS_.navy);
      fill.getBorder().setTransparent();
    }

    var valueBox = slide.insertShape(
      SlidesApp.ShapeType.TEXT_BOX,
      barX + barW + 6,
      y,
      valueW,
      rowH
    );
    valueBox.getFill().setTransparent();
    valueBox.getBorder().setTransparent();
    var vt = valueBox.getText();
    vt.setText(count + ' (' + formatPct_(pct) + ')');
    vt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(fontSize)
      .setForegroundColor(PH_SLIDES_COLORS_.muted);
    vt.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);

    return y + rowH;
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {Array<{label: string, count: number, pct: number, color: string}>} segments
   * @private
   */
  function addSplitBar_(slide, layout, x, y, w, h, segments) {
    var cursor = x;
    segments.forEach(function (seg) {
      var segW = Math.max(0, w * phSlidesSafeNum_(seg.pct, 0));
      if (segW < 1) return;
      var rect = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, cursor, y, segW, h);
      rect.getFill().setSolidFill(seg.color || PH_SLIDES_COLORS_.navy);
      rect.getBorder().setTransparent();
      if (segW >= 56) {
        var segFont = segW >= 88 ? 9 : 8;
        var tbox = slide.insertShape(
          SlidesApp.ShapeType.TEXT_BOX, cursor + 4, y + 3, segW - 8, h - 6
        );
        tbox.getFill().setTransparent();
        tbox.getBorder().setTransparent();
        var tt = tbox.getText();
        tt.setText(seg.count + ' (' + formatPct_(seg.pct) + ')');
        tt.getTextStyle()
          .setFontFamily(layout.font)
          .setFontSize(segFont)
          .setBold(true)
          .setForegroundColor(PH_SLIDES_COLORS_.white);
        tt.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      }
      cursor += segW;
    });

    var legendY = y + h + 8;
    var legendX = x;
    segments.forEach(function (seg) {
      var dot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, legendX, legendY + 2, 8, 8);
      dot.getFill().setSolidFill(seg.color || PH_SLIDES_COLORS_.navy);
      dot.getBorder().setTransparent();
      var leg = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, legendX + 12, legendY, 160, 14);
      leg.getFill().setTransparent();
      leg.getBorder().setTransparent();
      var lt = leg.getText();
      lt.setText(safeText_(seg.label, 28) + ': ' + seg.count + ' (' + formatPct_(seg.pct) + ')');
      lt.getTextStyle()
        .setFontFamily(layout.font)
        .setFontSize(9)
        .setForegroundColor(PH_SLIDES_COLORS_.text);
      legendX += 180;
    });
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {Object} insight
   * @private
   */
  function addInsightBox_(slide, layout, x, y, w, insight) {
    if (!insight) return;
    var tone = insight.tone || 'neutral';
    var accent = PH_SLIDES_COLORS_.navy;
    if (tone === 'risk') accent = PH_SLIDES_COLORS_.red;
    else if (tone === 'watch') accent = PH_SLIDES_COLORS_.yellow;
    else if (tone === 'positive') accent = PH_SLIDES_COLORS_.green;

    var box = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, x, y, w, 52);
    box.getFill().setSolidFill(PH_SLIDES_COLORS_.cardBg);
    box.getBorder().getLineFill().setSolidFill(PH_SLIDES_COLORS_.track);
    var accentBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, 4, 52);
    accentBar.getFill().setSolidFill(accent);
    accentBar.getBorder().setTransparent();

    var titleBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 12, y + 6, w - 20, 14);
    titleBox.getFill().setTransparent();
    titleBox.getBorder().setTransparent();
    var tt = titleBox.getText();
    tt.setText(safeText_(insight.title || 'Insight', 40));
    tt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(9)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.navy);

    var textBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 12, y + 22, w - 20, 26);
    textBox.getFill().setTransparent();
    textBox.getBorder().setTransparent();
    var txt = textBox.getText();
    txt.setText(safeText_(insight.text || '', 160));
    txt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(9)
      .setForegroundColor(PH_SLIDES_COLORS_.text);
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {string} title
   * @param {Object|null} item
   * @private
   */
  function addCalloutTile_(slide, layout, x, y, w, title, item, tileH) {
    if (!item || !item.label) return;
    tileH = tileH || PH_SLIDES_LAYOUT_.CALLOUT_TILE_H;
    var metaH = 12;
    var metaBottomPad = 12;
    var tile = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, x, y, w, tileH);
    tile.getFill().setSolidFill(PH_SLIDES_COLORS_.cardBg);
    tile.getBorder().getLineFill().setSolidFill(PH_SLIDES_COLORS_.track);

    var titleBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 10, y + 6, w - 20, 12);
    titleBox.getFill().setTransparent();
    titleBox.getBorder().setTransparent();
    var tt = titleBox.getText();
    tt.setText(safeText_(title, 30).toUpperCase());
    tt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(7)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.muted);

    var metaTop = y + tileH - metaBottomPad - metaH;
    var valBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 10, y + 18, w - 20, metaTop - y - 20);
    valBox.getFill().setTransparent();
    valBox.getBorder().setTransparent();
    var vt = valBox.getText();
    vt.setText(truncateText_(item.label, 32));
    vt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(11)
      .setBold(true)
      .setForegroundColor(PH_SLIDES_COLORS_.text);

    var metaBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x + 10, metaTop, w - 20, metaH);
    metaBox.getFill().setTransparent();
    metaBox.getBorder().setTransparent();
    var mt = metaBox.getText();
    mt.setText(item.count + ' (' + formatPct_(item.pct) + ')');
    mt.getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(8)
      .setForegroundColor(PH_SLIDES_COLORS_.muted);
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {Object} layout
   * @param {number} y
   * @param {Array<Object>} items
   * @param {string} barColor
   * @param {string=} emptyText
   * @param {Object=} opts
   * @param {number=} opts.bottomY
   * @param {number=} opts.minRowH
   * @param {number=} opts.maxRows
   * @return {number}
   * @private
   */
  function addBarList_(slide, layout, y, items, barColor, emptyText, opts) {
    opts = opts || {};
    var bottomY = opts.bottomY !== undefined ? opts.bottomY : layout.contentBottom;
    var minRowH = opts.minRowH || PH_SLIDES_LAYOUT_.BAR_ROW_MIN_H;
    var maxRowH = PH_SLIDES_LAYOUT_.BAR_ROW_MAX_H;

    if (!items || !items.length) {
      var empty = slide.insertShape(
        SlidesApp.ShapeType.TEXT_BOX,
        layout.contentLeft,
        y,
        layout.contentWidth,
        20
      );
      empty.getFill().setTransparent();
      empty.getBorder().setTransparent();
      empty.getText().setText(emptyText || 'No data available.');
      empty.getText().getTextStyle()
        .setFontFamily(layout.font)
        .setFontSize(10)
        .setForegroundColor(PH_SLIDES_COLORS_.muted);
      return y + 24;
    }

    var rowGap = PH_SLIDES_LAYOUT_.BAR_ROW_GAP;
    var perRowMin = minRowH + rowGap;
    var availableH = Math.max(minRowH, bottomY - y);
    var maxFit = Math.floor((availableH + rowGap) / perRowMin);
    if (opts.maxRows && opts.maxRows < maxFit) maxFit = opts.maxRows;
    if (maxFit < 1) maxFit = 1;

    var displayItems = phSlidesTrimBarItems_(items, maxFit);
    var gapTotal = displayItems.length > 1 ? (displayItems.length - 1) * rowGap : 0;
    var rowH = Math.floor((availableH - gapTotal) / displayItems.length);
    if (rowH > maxRowH) rowH = maxRowH;
    if (rowH < minRowH) rowH = minRowH;

    var maxCount = 0;
    displayItems.forEach(function (it) {
      if (it.count > maxCount) maxCount = it.count;
    });
    if (!maxCount) maxCount = 1;

    var cursor = y;
    for (var i = 0; i < displayItems.length; i++) {
      if (cursor + rowH > bottomY) break;
      cursor = addHorizontalBar_(
        slide, layout, cursor, displayItems[i].label, displayItems[i].count,
        displayItems[i].pct, maxCount, barColor, rowH
      );
      if (i < displayItems.length - 1) {
        cursor += rowGap;
      }
    }
    return Math.min(cursor, bottomY);
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {Object} layout
   * @private
   */
  function buildPhSlideKpiSummary_(slide, presentation, snapshot, layout) {
    addSlideHeader_(slide, layout, 'Product Portfolio Health', 'KPI Summary');
    addSlideFooter_(slide, layout);

    var ps = snapshot.portfolioStatus || {};
    var glr = phSlidesGoLiveReadiness_(snapshot);
    var totalActive = phSlidesSafeNum_(ps.totalActive, 0);
    var atRisk = phSlidesSafeNum_(ps.atRisk, phSlidesSafeNum_(ps.yellow, 0) + phSlidesSafeNum_(ps.red, 0));
    var green = phSlidesSafeNum_(ps.green, 0);
    var executiveWatch = phSlidesSafeNum_(ps.executiveWatch, 0);
    var openPlans = phSlidesOpenHealthPlans_(snapshot);
    var upcoming30 = phSlidesSafeNum_(glr.upcoming30 !== undefined ? glr.upcoming30 : glr.upcoming, 0);
    var ewEnabled = snapshot.executiveWatchEnabled !== false;

    var atRiskPct = ps.atRiskPct !== undefined ? ps.atRiskPct : phSlidesPctOf_(atRisk, totalActive);
    var greenPct = ps.greenPct !== undefined ? ps.greenPct : phSlidesPctOf_(green, totalActive);
    var ewPct = ewEnabled && ps.executiveWatchPct !== undefined
      ? ps.executiveWatchPct
      : phSlidesPctOf_(executiveWatch, totalActive);
    var openPlansPct = ps.openHealthPlansPct !== undefined
      ? ps.openHealthPlansPct
      : phSlidesPctOf_(openPlans, totalActive);

    var contextParts = [];
    if (snapshot.appId) contextParts.push(snapshot.appId);
    if (snapshot.monthLabel) contextParts.push(snapshot.monthLabel);
    if (layout.generatedLabel) contextParts.push('Generated ' + layout.generatedLabel);
    var contextLine = contextParts.join(' \u00B7 ');

    if (contextLine) {
      var ctxBox = slide.insertShape(
        SlidesApp.ShapeType.TEXT_BOX,
        layout.contentLeft,
        layout.contentTop,
        layout.contentWidth,
        14
      );
      ctxBox.getFill().setTransparent();
      ctxBox.getBorder().setTransparent();
      ctxBox.getText().setText(safeText_(contextLine, 120));
      ctxBox.getText().getTextStyle()
        .setFontFamily(layout.font)
        .setFontSize(9)
        .setForegroundColor(PH_SLIDES_COLORS_.muted);
    }

    var gridTop = layout.contentTop + 18;
    var gap = 10;
    var cardW = (layout.contentWidth - (gap * 2)) / 3;
    var cardH = 68;
    var kpis = [
      { label: 'Active Product Deployments', value: totalActive, sub: 'Portfolio total', color: PH_SLIDES_COLORS_.navy },
      { label: 'At Risk', value: atRisk, sub: formatPct_(atRiskPct) + ' of portfolio', color: PH_SLIDES_COLORS_.red },
      { label: 'Green', value: green, sub: formatPct_(greenPct) + ' of portfolio', color: PH_SLIDES_COLORS_.green }
    ];
    if (ewEnabled) {
      kpis.push({
        label: 'Executive Watch',
        value: executiveWatch,
        sub: formatPct_(ewPct) + ' of portfolio',
        color: PH_SLIDES_COLORS_.yellow
      });
    }
    kpis.push(
      { label: 'Open Health Plans', value: openPlans, sub: formatPct_(openPlansPct) + ' of portfolio', color: PH_SLIDES_COLORS_.dhp },
      { label: 'Upcoming Go-Lives', value: upcoming30, sub: 'Next 30 days', color: PH_SLIDES_COLORS_.navy }
    );

    kpis.forEach(function (kpi, idx) {
      var col = idx % 3;
      var row = Math.floor(idx / 3);
      var x = layout.contentLeft + (col * (cardW + gap));
      var y = gridTop + (row * (cardH + gap));
      addKpiCard_(slide, layout, x, y, cardW, cardH, kpi.label, kpi.value, kpi.sub, kpi.color);
    });

    var insights = Array.isArray(snapshot.executiveInsights) ? snapshot.executiveInsights : [];
    if (insights.length) {
      var insightTop = gridTop + (cardH + gap) * 2 + 12;
      if (insightTop + PH_SLIDES_LAYOUT_.INSIGHT_H <= layout.contentBottom) {
        addInsightBox_(
          slide,
          layout,
          layout.contentLeft,
          insightTop,
          layout.contentWidth,
          insights[0]
        );
      }
    }
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {Object} layout
   * @private
   */
  function buildPhSlideDeliveryReadiness_(slide, presentation, snapshot, layout) {
    addSlideHeader_(slide, layout, 'Delivery Ownership & Go-Live Readiness', snapshot.appId || '');
    addSlideFooter_(slide, layout);

    var own = snapshot.deliveryOwnership || {};
    var workdayLed = phSlidesSafeNum_(own.workdayLed, 0);
    var partnerLed = phSlidesSafeNum_(own.partnerLed, 0);
    var ownTotal = phSlidesSafeNum_(own.total, workdayLed + partnerLed);
    var workdayPct = own.workdayPct !== undefined ? own.workdayPct : phSlidesPctOf_(workdayLed, ownTotal);
    var partnerPct = own.partnerPct !== undefined ? own.partnerPct : phSlidesPctOf_(partnerLed, ownTotal);

    var glr = phSlidesGoLiveReadiness_(snapshot);
    var upcoming30 = phSlidesSafeNum_(glr.upcoming30 !== undefined ? glr.upcoming30 : glr.upcoming, 0);
    var recent60 = phSlidesSafeNum_(glr.recent60 !== undefined ? glr.recent60 : glr.recent, 0);
    var withHp = phSlidesSafeNum_(
      glr.upcomingWithHealthPlans !== undefined ? glr.upcomingWithHealthPlans : glr.withHealthPlans,
      0
    );
    var glEw = phSlidesSafeNum_(
      glr.upcomingOnExecutiveWatch !== undefined ? glr.upcomingOnExecutiveWatch : glr.executiveWatch,
      0
    );
    var ewEnabled = snapshot.executiveWatchEnabled !== false;

    var leftW = layout.contentWidth * 0.48;
    var rightX = layout.contentLeft + leftW + 16;
    var rightW = layout.contentWidth - leftW - 16;
    var y = layout.contentTop;

    addSectionTitle_(slide, layout, layout.contentLeft, y, leftW, 'Delivery Ownership');
    addSplitBar_(slide, layout, layout.contentLeft, y + 22, leftW, 28, [
      { label: 'Workday-led', count: workdayLed, pct: workdayPct, color: PH_SLIDES_COLORS_.navy },
      { label: 'Partner-led', count: partnerLed, pct: partnerPct, color: PH_SLIDES_COLORS_.partner }
    ]);

    addSectionTitle_(slide, layout, rightX, y, rightW, 'Go-Live Readiness');
    var miniW = (rightW - 10) / 2;
    var miniH = 68;
    var miniGap = 10;
    var sectionOffset = 22;
    addMetricCard_(slide, layout, rightX, y + sectionOffset, miniW, miniH, 'Upcoming', upcoming30, 'Next 30 days', PH_SLIDES_COLORS_.navy);
    addMetricCard_(slide, layout, rightX + miniW + 10, y + sectionOffset, miniW, miniH, 'Recent', recent60, 'Last 60 days', PH_SLIDES_COLORS_.partner);
    addMetricCard_(slide, layout, rightX, y + sectionOffset + miniH + miniGap, miniW, miniH, 'With Health Plans', withHp, 'Upcoming go-lives', PH_SLIDES_COLORS_.dhp);
    if (ewEnabled) {
      addMetricCard_(slide, layout, rightX + miniW + 10, y + sectionOffset + miniH + miniGap, miniW, miniH,
        'Executive Watch', glEw, 'Upcoming go-lives', PH_SLIDES_COLORS_.yellow);
    }

    var splitBarBottom = y + sectionOffset + 28 + 8 + 14;
    var cardsBottom = y + sectionOffset + miniH + miniGap + miniH;
    var columnsBottom = Math.max(splitBarBottom, cardsBottom);

    var insights = Array.isArray(snapshot.executiveInsights) ? snapshot.executiveInsights : [];
    var goLiveInsight = null;
    insights.forEach(function (ins) {
      if (!goLiveInsight && ins && ins.title === 'Go-Live') goLiveInsight = ins;
    });
    if (!goLiveInsight && insights.length > 1) goLiveInsight = insights[1];
    if (goLiveInsight) {
      var insightH = PH_SLIDES_LAYOUT_.INSIGHT_H;
      var insightGap = PH_SLIDES_LAYOUT_.CARD_SECTION_GAP;
      var insightY = columnsBottom + insightGap;
      var maxInsightY = layout.contentBottom - insightH - PH_SLIDES_LAYOUT_.FOOTER_PAD;
      if (insightY > maxInsightY) insightY = maxInsightY;
      if (insightY + insightH <= layout.contentBottom) {
        addInsightBox_(slide, layout, layout.contentLeft, insightY, layout.contentWidth, goLiveInsight);
      }
    }
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {Object} layout
   * @private
   */
  function buildPhSlidePartnerAnalysis_(slide, presentation, snapshot, layout) {
    addSlideHeader_(slide, layout, 'Partner Analysis', snapshot.appId || '');
    addSlideFooter_(slide, layout);

    var dist = phSlidesPartnerDistribution_(snapshot);
    var pc = snapshot.portfolioConcentration || {};
    var topPartner = pc.topPartner
      ? { label: pc.topPartner.name, count: pc.topPartner.count, pct: pc.topPartner.percent }
      : (dist.length ? dist[0] : null);

    var own = snapshot.deliveryOwnership || {};
    var partnerPct = own.partnerPct;

    var y = layout.contentTop;
    if (topPartner) {
      addCalloutTile_(slide, layout, layout.contentLeft, y, 260, 'Top Partner', topPartner);
      y += PH_SLIDES_LAYOUT_.CALLOUT_TILE_H + 4;
    }
    if (partnerPct !== undefined && partnerPct !== null) {
      var shareBox = slide.insertShape(
        SlidesApp.ShapeType.TEXT_BOX,
        layout.contentLeft + 270,
        layout.contentTop + 10,
        220,
        24
      );
      shareBox.getFill().setTransparent();
      shareBox.getBorder().setTransparent();
      shareBox.getText().setText('Partner-led share: ' + formatPct_(partnerPct));
      shareBox.getText().getTextStyle()
        .setFontFamily(layout.font)
        .setFontSize(10)
        .setForegroundColor(PH_SLIDES_COLORS_.text);
    }

    addBarList_(
      slide, layout, y + 4, dist, PH_SLIDES_COLORS_.navy,
      'Partner distribution is not available for this portfolio.',
      { bottomY: layout.contentBottom }
    );
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {Object} layout
   * @private
   */
  function buildPhSlideIndustryAnalysis_(slide, presentation, snapshot, layout) {
    addSlideHeader_(slide, layout, 'Industry Analysis', snapshot.appId || '');
    addSlideFooter_(slide, layout);

    var dist = phSlidesIndustryDistribution_(snapshot);
    var pc = snapshot.portfolioConcentration || {};
    var topIndustry = pc.topIndustry
      ? { label: pc.topIndustry.name, count: pc.topIndustry.count, pct: pc.topIndustry.percent }
      : (dist.length ? dist[0] : null);

    var y = layout.contentTop;
    if (topIndustry) {
      addCalloutTile_(slide, layout, layout.contentLeft, y, 260, 'Top Industry', topIndustry);
      y += PH_SLIDES_LAYOUT_.CALLOUT_TILE_H + 4;
    }

    addBarList_(
      slide, layout, y + 4, dist, PH_SLIDES_COLORS_.teal,
      'Industry distribution is not available for this portfolio.',
      { bottomY: layout.contentBottom }
    );
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {Object} layout
   * @private
   */
  function buildPhSlideDhpIssueCategories_(slide, presentation, snapshot, layout) {
    addSlideHeader_(slide, layout, 'Deployment Health Plan Issue Categories', snapshot.appId || '');
    addSlideFooter_(slide, layout);

    var dhi = snapshot.deploymentHealthInsights || {};
    var dist = phSlidesIssueCategories_(snapshot);
    var topIssue = dhi.topIssueCategory
      ? {
        label: dhi.topIssueCategory,
        count: phSlidesSafeNum_(dhi.topIssueCategoryCount, 0),
        pct: phSlidesPctOf_(dhi.topIssueCategoryCount, phSlidesOpenHealthPlans_(snapshot))
      }
      : (dist.length ? dist[0] : null);

    var y = layout.contentTop;
    if (topIssue && topIssue.label) {
      addCalloutTile_(slide, layout, layout.contentLeft, y, 280, 'Top Issue Category', topIssue);
      y += PH_SLIDES_LAYOUT_.CALLOUT_TILE_H + 4;
    }

    var note = slide.insertShape(
      SlidesApp.ShapeType.TEXT_BOX,
      layout.contentLeft,
      y,
      layout.contentWidth,
      14
    );
    note.getFill().setTransparent();
    note.getBorder().setTransparent();
    note.getText().setText('Health plans may include more than one issue category.');
    note.getText().getTextStyle()
      .setFontFamily(layout.font)
      .setFontSize(8)
      .setItalic(true)
      .setForegroundColor(PH_SLIDES_COLORS_.muted);
    y += 18;

    addBarList_(
      slide,
      layout,
      y,
      dist,
      PH_SLIDES_COLORS_.dhp,
      'No issue categories found for open health plans.',
      { bottomY: layout.contentBottom }
    );
  }

  /**
   * @param {GoogleAppsScript.Slides.Page} slide
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {Object} layout
   * @private
   */
  function buildPhSlideHealthPlanConcentration_(slide, presentation, snapshot, layout) {
    addSlideHeader_(slide, layout, 'Health Plan Concentration', 'By Partner');
    addSlideFooter_(slide, layout);

    var openPlans = phSlidesOpenHealthPlans_(snapshot);
    var dist = phSlidesHealthPlanConcentration_(snapshot);
    var dhi = snapshot.deploymentHealthInsights || {};
    var hpConc = dhi.healthPlanConcentration || {};
    var topConc = hpConc.name
      ? { label: hpConc.name, count: hpConc.count, pct: hpConc.percent }
      : (dist.length ? dist[0] : null);

    var y = layout.contentTop;
    var topCardH = 68;
    addKpiCard_(
      slide,
      layout,
      layout.contentLeft,
      y,
      180,
      topCardH,
      'Open Health Plans',
      openPlans,
      'Active deployments with plans',
      PH_SLIDES_COLORS_.dhp
    );

    if (topConc && topConc.label) {
      addCalloutTile_(slide, layout, layout.contentLeft + 196, y, 260, 'Highest Concentration', topConc, topCardH);
    }
    y += topCardH + PH_SLIDES_LAYOUT_.CARD_SECTION_GAP;

    addBarList_(
      slide,
      layout,
      y,
      dist,
      PH_SLIDES_COLORS_.indigo,
      'Health plan concentration is not available for this portfolio.',
      { bottomY: layout.contentBottom }
    );
  }

  /**
   * Resolves the accessing user's email for Slides export filenames.
   * Prefers active user, then effective user, then a safe fallback.
   *
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function phSlidesResolveUserEmail_(cfg) {
    try {
      var access = CoreUsers.getCurrentUserAccess(cfg);
      if (access && access.email) return access.email;
    } catch (err) {
      Logger.log('phSlidesResolveUserEmail_: CoreUsers failed — ' + err);
    }
    try {
      var e = Session.getActiveUser().getEmail();
      if (e) return e;
      e = Session.getEffectiveUser().getEmail();
      if (e) return e;
    } catch (err2) {
      Logger.log('phSlidesResolveUserEmail_: Session failed — ' + err2);
    }
    return 'unknown-user';
  }

  /**
   * Builds token map for Slides export filename templates.
   *
   * @param {AppConfig} cfg
   * @param {Object} snapshot
   * @return {Object<string,string>}
   * @private
   */
  function phSlidesFormatTokens_(cfg, snapshot) {
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var appId = snapshot.appId || cfg.appId || '';
    return {
      appName: appId || 'Portfolio',
      appId: appId,
      userEmail: phSlidesResolveUserEmail_(cfg),
      date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
      timestamp: Utilities.formatDate(now, tz, 'yyyy-MM-dd_HH-mm'),
      deckType: 'Portfolio Health'
    };
  }

  /**
   * Sanitizes a generated Slides deck title for Drive/Slides readability.
   *
   * @param {string} title
   * @return {string}
   * @private
   */
  function phSlidesSanitizeFilename_(title) {
    var s = String(title || '')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length > 180) s = s.slice(0, 180).trim();
    return s || 'Portfolio Health';
  }

  /**
   * Applies cfg.report.portfolioHealth.slidesExport.filename tokens.
   *
   * @param {string} template
   * @param {AppConfig} cfg
   * @param {Object} snapshot
   * @return {string}
   * @private
   */
  function phSlidesApplyFilenameTemplate_(template, cfg, snapshot) {
    var tpl = String(template || '').trim();
    if (!tpl) return '';
    var tokens = phSlidesFormatTokens_(cfg, snapshot);
    var out = tpl;
    Object.keys(tokens).forEach(function (key) {
      out = out.split('{' + key + '}').join(tokens[key]);
    });
    return phSlidesSanitizeFilename_(out);
  }

  /**
   * Legacy title when no filename template is configured.
   *
   * @param {AppConfig} cfg
   * @param {Object} snapshot
   * @return {string}
   * @private
   */
  function phSlidesLegacyTitle_(cfg, snapshot) {
    var appLabel = snapshot.appId || cfg.appId || 'Portfolio';
    var monthLabel = snapshot.monthLabel || Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'MMMM yyyy'
    );
    return appLabel + ' Portfolio Health - ' + monthLabel;
  }

  /**
   * Move a Portfolio Health Slides deck to a configured shared folder when enabled.
   * Fail-open: logs move errors and returns diagnostics without throwing.
   *
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function phSlidesApplyDestination_(presentation, cfg) {
    var ph = (cfg.report && cfg.report.portfolioHealth) || {};
    var exp = ph.slidesExport || {};
    var mode = String(exp.destinationMode || 'root').toLowerCase();
    var folderId = String(exp.folderId || '').trim();

    if (mode !== 'folder' || !folderId) {
      return { applied: false, reason: 'not_configured' };
    }

    try {
      var file = DriveApp.getFileById(presentation.getId());
      var folder = DriveApp.getFolderById(folderId);
      file.moveTo(folder);
      return {
        applied: true,
        mode: 'folder',
        folderId: folderId,
        folderName: folder.getName()
      };
    } catch (err) {
      Logger.log('phSlidesApplyDestination_: failed — ' + err);
      return {
        applied: false,
        mode: 'folder',
        folderId: folderId,
        reason: 'move_failed',
        error: String(err)
      };
    }
  }

  /**
   * @param {GoogleAppsScript.Slides.Presentation} presentation
   * @param {Object} snapshot
   * @param {AppConfig} cfg
   * @private
   */
  function buildPortfolioSlidesDeck_(presentation, snapshot, cfg) {
    var layout = phSlidesInitLayout_(presentation, snapshot, cfg);
    var slides = presentation.getSlides();
    var first = slides[0];
    first.getPageElements().forEach(function (el) { el.remove(); });

    buildPhSlideKpiSummary_(first, presentation, snapshot, layout);
    buildPhSlideDeliveryReadiness_(presentation.appendSlide(), presentation, snapshot, layout);
    buildPhSlidePartnerAnalysis_(presentation.appendSlide(), presentation, snapshot, layout);
    buildPhSlideIndustryAnalysis_(presentation.appendSlide(), presentation, snapshot, layout);
    buildPhSlideDhpIssueCategories_(presentation.appendSlide(), presentation, snapshot, layout);
    buildPhSlideHealthPlanConcentration_(presentation.appendSlide(), presentation, snapshot, layout);
  }

  /**
   * Create a Google Slides deck for ProductMode Portfolio Health vNext.
   *
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {{ok:boolean, presentationId?:string, url?:string, title?:string, slideCount?:number, destination?:Object, code?:string, error?:string}}
   */
  function createPortfolioHealthSlides(config, viewModeOpts, productOpts) {
    try {
      var snapshot = getSnapshot(config, viewModeOpts, productOpts);
      if (!snapshot || snapshot.vNext !== true || snapshot.layoutMode !== 'product') {
        return {
          ok: false,
          code: 'NOT_VNEXT_PRODUCT',
          error: 'Portfolio Health Slides export is currently available for Product Portfolio Health only.'
        };
      }

      var cfg = CoreConfig.withDefaults(config);
      var exp = (cfg.report.portfolioHealth && cfg.report.portfolioHealth.slidesExport) || {};
      var finalTitle = phSlidesApplyFilenameTemplate_(exp.filename, cfg, snapshot);
      if (!finalTitle) finalTitle = phSlidesLegacyTitle_(cfg, snapshot);

      Logger.log('createPortfolioHealthSlides: creating deck — ' + finalTitle);
      var presentation = SlidesApp.create(finalTitle);
      buildPortfolioSlidesDeck_(presentation, snapshot, cfg);
      var dest = phSlidesApplyDestination_(presentation, cfg);

      var result = {
        ok: true,
        presentationId: presentation.getId(),
        url: presentation.getUrl(),
        title: finalTitle,
        filename: finalTitle,
        slideCount: presentation.getSlides().length,
        destination: dest
      };
      Logger.log('createPortfolioHealthSlides: created ' + result.presentationId);
      return result;
    } catch (err) {
      Logger.log('createPortfolioHealthSlides: error — ' + err);
      return {
        ok: false,
        code: 'SLIDES_CREATE_FAILED',
        error: String(err)
      };
    }
  }

  /**
   * Dry-run diagnostic for Portfolio Health Slides payload readiness.
   *
   * @param {AppConfig} cfg
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  function debugPortfolioHealthSlidesPayload(cfg, viewModeOpts, productOpts) {
    var diagnostic = {
      ok: true,
      diagnostic: 'debugPortfolioHealthSlidesPayload',
      slideCount: 6,
      vNext: false,
      layoutMode: 'unknown',
      partnerDistributionCount: 0,
      industryDistributionCount: 0,
      issueCategoryCount: 0,
      healthPlansByPartnerCount: 0,
      openHealthPlans: 0,
      topIssueCategory: '',
      topPartner: null,
      topIndustry: null,
      healthPlanConcentration: null
    };

    try {
      var snapshot = getSnapshot(cfg, viewModeOpts, productOpts);
      diagnostic.vNext = !!snapshot.vNext;
      diagnostic.layoutMode = snapshot.layoutMode || 'unknown';
      diagnostic.partnerDistributionCount = phSlidesPartnerDistribution_(snapshot).length;
      diagnostic.industryDistributionCount = phSlidesIndustryDistribution_(snapshot).length;
      diagnostic.issueCategoryCount = phSlidesIssueCategories_(snapshot).length;
      diagnostic.healthPlansByPartnerCount = phSlidesHealthPlanConcentration_(snapshot).length;
      diagnostic.openHealthPlans = phSlidesOpenHealthPlans_(snapshot);

      var dhi = snapshot.deploymentHealthInsights || {};
      var pc = snapshot.portfolioConcentration || {};
      diagnostic.topIssueCategory = dhi.topIssueCategory || '';
      diagnostic.topPartner = pc.topPartner || null;
      diagnostic.topIndustry = pc.topIndustry || null;
      diagnostic.healthPlanConcentration = dhi.healthPlanConcentration || null;
    } catch (err) {
      diagnostic.ok = false;
      diagnostic.error = String(err);
      Logger.log('debugPortfolioHealthSlidesPayload: error — ' + err);
    }

    return diagnostic;
  }

  /**
   * Portfolio pulse KPIs for Deployment Intelligence (same active population as getSnapshot).
   *
   * @param {AppConfig} config
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @return {Object}
   */
  function buildDeploymentIntelligencePortfolioPulse(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var tz = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    var countRows = CoreData.getActiveCountDeployments(cfg, productOpts)
      .filter(function (r) { return !r.excludeFromReport; });
    countRows = CoreData.filterDeploymentsByStudent_(countRows, 'exclude', cfg);

    var green = 0;
    var yellow = 0;
    var red = 0;
    var mtpWithin90Days = 0;

    countRows.forEach(function (r) {
      var h = String(r.health || '').trim();
      if (h === 'Green') green++;
      else if (h === 'Yellow') yellow++;
      else if (h === 'Red') red++;

      var mtpRaw = r.currentMtp || r.goLiveDate || r.mtpDate || '';
      if (!mtpRaw) return;
      var mtpKey = CoreUtils.toCalendarDateKey(mtpRaw, tz);
      if (!mtpKey) return;
      var days = TrajectoryMetrics.signedDaysBetween(todayStr, mtpKey);
      if (days !== null && days >= 0 && days <= 90) {
        mtpWithin90Days++;
      }
    });

    var totalActive = green + yellow + red;
    var pct100 = function (v) {
      if (!totalActive) return 0;
      return Math.round((v / totalActive) * 1000) / 10;
    };

    return {
      totalActive: totalActive,
      green: green,
      yellow: yellow,
      red: red,
      greenPct: pct100(green),
      yellowPct: pct100(yellow),
      redPct: pct100(red),
      mtpWithin90Days: mtpWithin90Days
    };
  }

  // ---------------------------------------------------------------------------
  // EXPORTS
  // ---------------------------------------------------------------------------
  return {
    getSnapshot: getSnapshot,
    buildDeploymentIntelligencePortfolioPulse: buildDeploymentIntelligencePortfolioPulse,
    debugPortfolioHealthVNext: debugPortfolioHealthVNext,
    createPortfolioHealthSlides: createPortfolioHealthSlides,
    debugPortfolioHealthSlidesPayload: debugPortfolioHealthSlidesPayload
  };
})();