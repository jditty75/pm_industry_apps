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
    var goLives = (CoreData.getRecentGoLives(cfg, viewModeOpts, undefined, productOpts) || [])
      .filter(function (r) { return String(r.partner || '').trim() === workdayPartner; });

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
      industrySplit = buildTopIndustriesSplit_(countRows, industryTopN);
    } else if (industryMode === 'all') {
      industrySplit = buildAllIndustriesSplit_(countRows);
    } else {
      industrySplit = buildIndustrySplit_(countRows, ph.industryBuckets || []);
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
      phasedDeployments: phasedDeployments
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
  function buildIndustrySplit_(rows, buckets) {
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
        var idx = bucketIndexFor(r.industry);
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
  function buildTopIndustriesSplit_(rows, topN) {
    topN = Math.max(1, Number(topN || 10));

    var byIndustry = {};
    var totalPortfolio = 0;

    rows.forEach(function (r) {
      var health = String(r.health || '').trim();
      if (health !== 'Green' && health !== 'Yellow' && health !== 'Red') return;

      var industry = String(r.industry || '').trim();
      if (!industry) industry = 'Unknown';

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
  function buildAllIndustriesSplit_(rows) {
    var healths = ['Green', 'Yellow', 'Red'];

    var industrySet = {};
    rows.forEach(function (r) {
      var industry = String(r.industry || '').trim();
      if (!industry) return;
      industrySet[industry] = true;
    });

    var bucketLabels = Object.keys(industrySet).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    var rowsOut = healths.map(function (h) {
      var counts = bucketLabels.map(function () { return 0; });

      rows.forEach(function (r) {
        if (String(r.health || '').trim() !== h) return;
        var industry = String(r.industry || '').trim();
        if (!industry) return;
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
  function industryNameForRow_(row) {
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
    var ewSet = buildExecutiveWatchAccountSet_(countRows);

    var upcomingWithHealthPlans = 0;
    var upcomingOnExecutiveWatch = 0;
    upcoming30Events.forEach(function (ev) {
      if (goLiveEventHasHealthPlan_(ev, dhpSet)) upcomingWithHealthPlans++;
      if (goLiveEventOnExecutiveWatch_(ev, ewSet)) upcomingOnExecutiveWatch++;
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

    // Executive Watch (Wellness / isExecutiveWatch on count rows)
    var executiveWatch = healthRows.filter(function (row) { return !!row.isExecutiveWatch; }).length;
    var executiveWatchPct = totalActive > 0 ? executiveWatch / totalActive : 0;

    // Partner + industry concentration
    var partnerDist = buildRankedDistribution_(healthRows, partnerNameForRow_, totalActive, topN);
    var industryDist = buildRankedDistribution_(healthRows, industryNameForRow_, totalActive, topN);

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

      appId:        baseSnapshot.appId,
      title:        baseSnapshot.title,
      subtitle:     'Executive Snapshot',
      monthLabel:   baseSnapshot.monthLabel,
      generatedLabel: baseSnapshot.generatedLabel,
      generatedAt:  baseSnapshot.generatedAt,

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
      upcomingGoLivesMismatchWarning: false
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
  // EXPORTS
  // ---------------------------------------------------------------------------
  return {
    getSnapshot: getSnapshot,
    debugPortfolioHealthVNext: debugPortfolioHealthVNext
  };
})();