/**
 * CorePortfolioMomentum.gs
 *
 * P2: Portfolio Momentum data module.
 * Computes Workday-FY-bucketed product-function go-live counts per platform,
 * growth rates, and current-FY running totals from SFDC_DeploymentProductFunctions.
 *
 * Public surface:
 *   CorePortfolioMomentum.getMomentumSnapshot(config)
 *
 * Returns null if cfg.momentum?.enabled !== true (safe for apps without opt-in).
 */

// Tier-1 in-memory cache (reset each execution automatically).
var _momentumCache = null;

var CorePortfolioMomentum = (function () {

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Returns { fyYear, label } for a Date.
   * Workday FY runs Feb 1 – Jan 31.
   * Feb–Dec of year Y → FY label = FY(Y+1). Jan of year Y → FY(Y).
   * Label format: 'FY' + last two digits (e.g. FY27).
   * @param {Date} date
   * @return {{ fyYear: number, label: string }}
   */
  function _wyFyFromDate_(date) {
    var m = date.getMonth(); // 0=Jan, 1=Feb, ...
    var y = date.getFullYear();
    var fyYear = (m >= 1) ? y + 1 : y;
    return { fyYear: fyYear, label: 'FY' + String(fyYear).slice(-2) };
  }

  /**
   * Returns the Workday FY label for a 'YYYY-MM-DD' string.
   * Returns null if the date is invalid.
   * @param {string} dateStr
   * @return {string|null}
   */
  function _fyLabelFromDateStr_(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    var parts = dateStr.split('-');
    if (parts.length < 2) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1; // convert to 0-indexed
    if (isNaN(y) || isNaN(m)) return null;
    var fyYear = (m >= 1) ? y + 1 : y;
    return 'FY' + String(fyYear).slice(-2);
  }

  /**
   * Returns the calendar year component of a FY label string.
   * 'FY27' → 2027, 'FY22' → 2022.
   * @param {string} label
   * @return {number}
   */
  function _fyYearFromLabel_(label) {
    return parseInt('20' + label.slice(2), 10);
  }

  /**
   * Determines whether the given date falls in H1 or H2 of the Workday FY.
   * H1: Feb 1 – Jul 31 (months 1–6, 0-indexed).
   * H2: Aug 1 – Jan 31 (months 7–11 and 0).
   * @param {Date} now
   * @return {'H1'|'H2'}
   */
  function _getHalf_(now) {
    var m = now.getMonth();
    return (m >= 1 && m <= 6) ? 'H1' : 'H2';
  }

  /**
   * Normalizes a cell value (Date object, date-like string, or empty) to
   * 'YYYY-MM-DD'. Returns null if unparseable or empty.
   * @param {*} raw
   * @return {string|null}
   */
  function _normalizeDate_(raw) {
    if (!raw) return null;
    if (raw instanceof Date) {
      if (isNaN(raw.getTime())) return null;
      var tz = Session.getScriptTimeZone();
      return Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
    }
    var s = String(raw).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return null;
  }

  /**
   * Formats a Date as 'YYYY-MM-DD' using the script timezone.
   * @param {Date} d
   * @return {string}
   */
  function _isoDate_(d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * Formats a Date as "Month D, YYYY" (e.g. "July 4, 2026").
   * @param {Date} d
   * @return {string}
   */
  function _dateLabel_(d) {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /**
   * Case-insensitive substring column finder with positional fallback.
   * Strips __c suffix and underscores from header values before comparing.
   * @param {Array} headers
   * @param {Array<string>} keywords  Lowercase search terms.
   * @param {number} fallback         0-based index to use if no keyword match.
   * @return {number}  Column index, or -1 if not found and fallback invalid.
   */
  function _findCol_(headers, keywords, fallback) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').toLowerCase()
                .replace(/__c$/i, '').replace(/_/g, ' ').trim();
      for (var j = 0; j < keywords.length; j++) {
        if (h.indexOf(keywords[j]) >= 0) return i;
      }
    }
    return (fallback >= 0 && fallback < headers.length) ? fallback : -1;
  }

  /**
   * Builds and returns an empty snapshot (no data rows matched).
   * @param {AppConfig} cfg
   * @return {Object}
   */
  function _buildEmptySnapshot_(cfg) {
    var now = new Date();
    var fyInfo = _wyFyFromDate_(now);
    var half = _getHalf_(now);
    var platforms = (cfg.momentum && cfg.momentum.platforms) || [];
    var emptyCountMap = {};
    platforms.forEach(function(p) { emptyCountMap[p] = 0; });
    var genLabel = _dateLabel_(now);
    var growthRates = {};
    platforms.forEach(function(p) { growthRates[p] = { avgYoyPct: 0, sampleFys: 0 }; });
    return {
      appId: cfg.appId || '',
      generatedAt: now.toISOString(),
      generatedDateLabel: genLabel,
      currentFy: {
        label: fyInfo.label,
        isInProgress: true,
        inProgressLabel: half,
        inProgressBadge: fyInfo.label + ' ' + half + ' running total as of ' + genLabel,
        startDate: _isoDate_(new Date(fyInfo.fyYear - 1, 1, 1)),
        endDate:   _isoDate_(new Date(fyInfo.fyYear, 0, 31)),
        periodEndDate: _isoDate_(half === 'H1'
          ? new Date(fyInfo.fyYear - 1, 6, 31)
          : new Date(fyInfo.fyYear, 0, 31)),
        counts: emptyCountMap,
        distinctAccounts: 0,
        totalGoLives: 0
      },
      historicalFys: [],
      growthRates: growthRates,
      fastestGrowingPlatform: platforms[0] || null,
      platforms: platforms,
      dataIntegrity: {
        totalRowsScanned: 0, rowsCounted: 0,
        rowsSkippedNoDate: 0, rowsSkippedUnmappedProductArea: 0
      }
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: getMomentumSnapshot
  // --------------------------------------------------------------------------

  /**
   * P2: Generates the Portfolio Momentum snapshot.
   * Returns null if cfg.momentum?.enabled is not true.
   *
   * @param {AppConfig} config
   * @return {Object|null}
   */
  function getMomentumSnapshot(config) {
    var cfg = CoreConfig.withDefaults(config);

    if (!cfg.momentum || !cfg.momentum.enabled) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: momentum not enabled — returning null.');
      return null;
    }

    if (_momentumCache) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: returning tier-1 cached result.');
      return _momentumCache;
    }

    var startMs = Date.now();
    Logger.log('CorePortfolioMomentum.getMomentumSnapshot: starting for appId=' + cfg.appId);

    // -----------------------------------------------------------------------
    // 1. Open SFDC_DeploymentProductFunctions sheet
    // -----------------------------------------------------------------------
    var sheetName = (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
                    'SFDC_DeploymentProductFunctions';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: sheet "' + sheetName +
                 '" not found — returning null.');
      return null;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: sheet "' + sheetName +
                 '" has no data rows — returning empty snapshot.');
      return _buildEmptySnapshot_(cfg);
    }

    var lastCol = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = allValues[0];

    Logger.log('CorePortfolioMomentum.getMomentumSnapshot: read ' + (lastRow - 1) +
               ' data rows, ' + lastCol + ' cols from "' + sheetName + '".');

    // -----------------------------------------------------------------------
    // 2. Resolve columns (same case-insensitive pattern as CoreSalesforce)
    // -----------------------------------------------------------------------
    var colProductArea  = _findCol_(headers, ['product area'], 1);
    var colDateActual   = _findCol_(headers, ['production move date actual', 'move date actual', 'actual'], 4);
    var colDeploymentFk = _findCol_(headers, ['deployment'], 5);
    // Account column — optional; fall back to counting distinct Deployment__c IDs
    var colAccount = _findCol_(headers,
                               ['account name', 'account c', 'accountname'], -1);
    var useDeploymentAsAccount = (colAccount < 0);

    if (useDeploymentAsAccount) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: Account column not found ' +
                 '— using distinct Deployment__c IDs as proxy for distinct accounts.');
    }
    if (colDeploymentFk < 0) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: Deployment__c FK column ' +
                 'missing — cannot process rows. Returning null.');
      return null;
    }

    // -----------------------------------------------------------------------
    // 3. Build platform lookup: product area value (lowercase) → platform code
    // -----------------------------------------------------------------------
    var productAreaMapping = (cfg.momentum && cfg.momentum.productAreaMapping) || {};
    var platforms = (cfg.momentum && cfg.momentum.platforms) || [];
    var areaToCode = {}; // 'core hcm' → 'HCM', etc.
    platforms.forEach(function(code) {
      var values = productAreaMapping[code] || [];
      values.forEach(function(v) {
        areaToCode[v.toLowerCase()] = code;
      });
    });

    // -----------------------------------------------------------------------
    // 4. Determine current WD FY and H1/H2 period
    // -----------------------------------------------------------------------
    var now = new Date();
    var currentFyInfo = _wyFyFromDate_(now);
    var currentFyLabel = currentFyInfo.label;
    var currentFyYear  = currentFyInfo.fyYear;
    var half = _getHalf_(now);

    // FY date range: Feb 1 of (fyYear-1) through Jan 31 of fyYear
    var fyStartDate = new Date(currentFyYear - 1, 1, 1);  // Feb 1
    var fyEndDate   = new Date(currentFyYear, 0, 31);      // Jan 31
    // H1 period ends Jul 31 of the same calendar year FY started; H2 ends at FY end
    var periodEndDate = (half === 'H1')
      ? new Date(currentFyYear - 1, 6, 31)  // Jul 31 of the year FY started
      : fyEndDate;                           // Jan 31 of next calendar year

    var generatedAt = now.toISOString();
    var generatedDateLabel = _dateLabel_(now);
    var inProgressBadge = currentFyLabel + ' ' + half +
                          ' running total as of ' + generatedDateLabel;

    var historicalYears = (cfg.momentum && cfg.momentum.historicalYears) || 6;
    var oldestAllowedFyYear = currentFyYear - historicalYears;

    // -----------------------------------------------------------------------
    // 5. Scan all rows
    // -----------------------------------------------------------------------
    var historicalCounts = {}; // { 'FY22': { HCM: n, FIN: n, ... } }
    var currentFyCounts  = {}; // { HCM: n, FIN: n, ... }
    var currentFyAccountKeys = {}; // distinct account/deployment keys
    platforms.forEach(function(p) { currentFyCounts[p] = 0; });

    var statsTotal    = 0;
    var statsCounted  = 0;
    var statsNoDate   = 0;
    var statsUnmapped = 0;

    for (var r = 1; r < allValues.length; r++) {
      statsTotal++;
      var row = allValues[r];

      // Require a populated Production_Move_Date_Actual__c
      var actualRaw = (colDateActual >= 0) ? row[colDateActual] : null;
      var actualStr = _normalizeDate_(actualRaw);
      if (!actualStr) {
        statsNoDate++;
        continue;
      }

      // Map product area to platform code
      var productAreaRaw = (colProductArea >= 0)
        ? String(row[colProductArea] || '').trim()
        : '';
      var platformCode = areaToCode[productAreaRaw.toLowerCase()] || null;
      if (!platformCode) {
        statsUnmapped++;
        continue;
      }

      // Determine Workday FY for this go-live date
      var fyLabel = _fyLabelFromDateStr_(actualStr);
      if (!fyLabel) {
        statsNoDate++;
        continue;
      }
      var fyYear = _fyYearFromLabel_(fyLabel);

      // Collect deployment/account key for distinct-account count
      var deploymentId = (colDeploymentFk >= 0)
        ? String(row[colDeploymentFk] || '').trim()
        : '';
      var accountKey = useDeploymentAsAccount
        ? deploymentId
        : (String(row[colAccount] || '').trim() || deploymentId);

      if (fyLabel === currentFyLabel) {
        // Current FY running total
        currentFyCounts[platformCode] = (currentFyCounts[platformCode] || 0) + 1;
        if (accountKey) currentFyAccountKeys[accountKey] = true;
        statsCounted++;
      } else if (fyYear >= oldestAllowedFyYear && fyYear < currentFyYear) {
        // Historical FY within the configured window
        if (!historicalCounts[fyLabel]) {
          historicalCounts[fyLabel] = {};
          platforms.forEach(function(p) { historicalCounts[fyLabel][p] = 0; });
        }
        historicalCounts[fyLabel][platformCode] =
          (historicalCounts[fyLabel][platformCode] || 0) + 1;
        statsCounted++;
      }
      // Rows outside the window (too old or future) are silently skipped.
    }

    // -----------------------------------------------------------------------
    // 6. Build sorted historical FYs array
    // -----------------------------------------------------------------------
    var historicalFys = Object.keys(historicalCounts).map(function(label) {
      var counts = historicalCounts[label];
      var total = 0;
      platforms.forEach(function(p) { total += (counts[p] || 0); });
      return { label: label, counts: counts, totalGoLives: total };
    }).sort(function(a, b) {
      return _fyYearFromLabel_(a.label) - _fyYearFromLabel_(b.label);
    });

    // -----------------------------------------------------------------------
    // 7. Compute per-platform growth rates (historical FYs only)
    // -----------------------------------------------------------------------
    var growthRates = {};
    platforms.forEach(function(p) {
      growthRates[p] = { avgYoyPct: 0, sampleFys: 0 };
    });

    if (historicalFys.length >= 2) {
      platforms.forEach(function(p) {
        var yoyPcts = [];
        for (var i = 1; i < historicalFys.length; i++) {
          var prev = historicalFys[i - 1].counts[p] || 0;
          var curr = historicalFys[i].counts[p] || 0;
          if (prev > 0) {
            yoyPcts.push((curr - prev) / prev);
          }
        }
        if (yoyPcts.length > 0) {
          var sum = yoyPcts.reduce(function(a, b) { return a + b; }, 0);
          growthRates[p] = {
            avgYoyPct: Math.round((sum / yoyPcts.length) * 1000) / 1000,
            sampleFys: yoyPcts.length
          };
        }
      });
    }

    // Fastest-growing platform (highest avgYoyPct)
    var fastestPlatform = platforms[0] || null;
    var highestRate = -Infinity;
    platforms.forEach(function(p) {
      var rate = growthRates[p] ? growthRates[p].avgYoyPct : 0;
      if (rate > highestRate) {
        highestRate = rate;
        fastestPlatform = p;
      }
    });

    // -----------------------------------------------------------------------
    // 8. Assemble and cache the snapshot
    // -----------------------------------------------------------------------
    var totalCurrentFyGoLives = 0;
    platforms.forEach(function(p) { totalCurrentFyGoLives += (currentFyCounts[p] || 0); });

    var snapshot = {
      appId: cfg.appId || '',
      generatedAt: generatedAt,
      generatedDateLabel: generatedDateLabel,
      currentFy: {
        label: currentFyLabel,
        isInProgress: true,
        inProgressLabel: half,
        inProgressBadge: inProgressBadge,
        startDate:    _isoDate_(fyStartDate),
        endDate:      _isoDate_(fyEndDate),
        periodEndDate: _isoDate_(periodEndDate),
        counts: currentFyCounts,
        distinctAccounts: Object.keys(currentFyAccountKeys).length,
        totalGoLives: totalCurrentFyGoLives
      },
      historicalFys: historicalFys,
      growthRates: growthRates,
      fastestGrowingPlatform: fastestPlatform,
      platforms: platforms,
      dataIntegrity: {
        totalRowsScanned:            statsTotal,
        rowsCounted:                  statsCounted,
        rowsSkippedNoDate:            statsNoDate,
        rowsSkippedUnmappedProductArea: statsUnmapped
      }
    };

    var elapsed = Date.now() - startMs;
    Logger.log('CorePortfolioMomentum.getMomentumSnapshot: complete in ' + elapsed + 'ms.' +
               ' scanned=' + statsTotal + ', counted=' + statsCounted +
               ', skippedNoDate=' + statsNoDate + ', skippedUnmapped=' + statsUnmapped +
               ', historicalFys=' + historicalFys.length +
               ', currentFy=' + currentFyLabel + ' ' + half);

    _momentumCache = snapshot;
    return snapshot;
  }

  // --------------------------------------------------------------------------
  // EXPORTS
  // --------------------------------------------------------------------------
  return {
    getMomentumSnapshot: getMomentumSnapshot
  };

})();
