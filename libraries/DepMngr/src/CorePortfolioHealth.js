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
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function getSnapshot(config, viewModeOpts, productOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var ph  = cfg.report.portfolioHealth || {};
    var pa  = (productOpts && productOpts.product) || 'all';

    var tz  = Session.getScriptTimeZone();
    var now = new Date();

    // ---- Effective deployments (Green/Yellow/Red, post-overrides) -----------
    var allEffective = CoreData.getAllEffectiveDeployments(cfg)
      .filter(function (r) { return !r.excludeFromReport; });

    // S1: exclude Student deployments from Portfolio Health (HENP only).
    allEffective = CoreData.filterDeploymentsByStudent_(allEffective, 'exclude', cfg);
    allEffective = CoreData.filterDeploymentsByProduct_(allEffective, pa, cfg);

    // ---- Health totals -------------------------------------------------------
    var green = 0, yellow = 0, red = 0;
    allEffective.forEach(function (r) {
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

    // ---- Red / Yellow project lists (alphabetical) ---------------------------
    var redProjects    = buildAccountList_(allEffective, 'Red');
    var yellowProjects = buildAccountList_(allEffective, 'Yellow');

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
    var partnerSplit = buildPartnerSplit_(allEffective, workdayPartner);

    // ---- Industry split per health row --------------------------------------
    var industrySplit = buildIndustrySplit_(allEffective, ph.industryBuckets || []);

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

    return {
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
      partnerSplit:    partnerSplit,
      industrySplit:   industrySplit,
      history:         history,
      phasedDeployments: phasedDeployments
    };
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

  // ---------------------------------------------------------------------------
  // EXPORTS
  // ---------------------------------------------------------------------------
  return {
    getSnapshot: getSnapshot
  };
})();