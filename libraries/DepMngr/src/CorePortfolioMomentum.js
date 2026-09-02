/**
 * CorePortfolioMomentum.gs
 *
 * P2: Portfolio Momentum data module.
 * Computes Workday-FY-bucketed product-function go-live counts,
 * growth rates, and current-FY running totals from Salesforce sheets.
 *
 * Supports two configuration modes:
 *   - platform: HC/SLG/HENP — platforms + productAreaMapping (legacy)
 *   - product:  EVI/AI — productFilter + chartLegend + kpiLabels
 *
 * Public surface:
 *   CorePortfolioMomentum.getMomentumSnapshot(config)
 *   CorePortfolioMomentum.queryMomentumDataset(config)
 *   CorePortfolioMomentum.calculateGoLives(ctx, seriesFilter)
 *   CorePortfolioMomentum.calculateDistinctAccounts(ctx, seriesFilter)
 *   CorePortfolioMomentum.calculateAnnualGrowthRate(ctx, seriesFilter)
 *   CorePortfolioMomentum.calculateFastestGrowingIndustry(ctx)
 *
 * Returns null from getMomentumSnapshot if cfg.momentum?.enabled !== true.
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
   * @param {Date} date
   * @return {{ fyYear: number, label: string }}
   */
  function _wyFyFromDate_(date) {
    var m = date.getMonth();
    var y = date.getFullYear();
    var fyYear = (m >= 1) ? y + 1 : y;
    return { fyYear: fyYear, label: 'FY' + String(fyYear).slice(-2) };
  }

  /**
   * Returns the Workday FY label for a 'YYYY-MM-DD' string.
   * @param {string} dateStr
   * @return {string|null}
   */
  function _fyLabelFromDateStr_(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    var parts = dateStr.split('-');
    if (parts.length < 2) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    if (isNaN(y) || isNaN(m)) return null;
    var fyYear = (m >= 1) ? y + 1 : y;
    return 'FY' + String(fyYear).slice(-2);
  }

  /**
   * Returns the calendar year component of a FY label string.
   * @param {string} label
   * @return {number}
   */
  function _fyYearFromLabel_(label) {
    return parseInt('20' + label.slice(2), 10);
  }

  /**
   * @param {Date} now
   * @return {'H1'|'H2'}
   */
  function _getHalf_(now) {
    var m = now.getMonth();
    return (m >= 1 && m <= 6) ? 'H1' : 'H2';
  }

  /**
   * Classifies a resolved momentum date into a chart/KPI period label.
   * @param {string} dateStr
   * @param {number} currentFyYear
   * @param {string} periodView
   * @return {string|null}
   */
  function _momentumPeriodForDate_(dateStr, currentFyYear, periodView) {
    if (!dateStr) return null;

    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;

    var fyInfo = _wyFyFromDate_(d);
    var currentFyLabel = 'FY' + String(currentFyYear).slice(-2);
    var previousFyYear = currentFyYear - 1;
    var previousFyLabel = 'FY' + String(previousFyYear).slice(-2);

    if (periodView === 'previousFyAndCurrentHalves') {
      if (fyInfo.fyYear === previousFyYear) {
        return previousFyLabel;
      }
      if (fyInfo.fyYear === currentFyYear) {
        var month = d.getMonth();
        if (month >= 1 && month <= 6) return currentFyLabel + ' H1';
        return currentFyLabel + ' H2';
      }
      return null;
    }

    return fyInfo.label;
  }

  /**
   * Builds chart period buckets for product-app momentum views.
   * @param {Object} dataset
   * @param {number} currentFyYear
   * @param {string} periodView
   * @param {Array<string>} series
   * @param {'H1'|'H2'} half
   * @return {Array<Object>|null}
   */
  function _buildChartPeriods_(dataset, currentFyYear, periodView, series, half) {
    if (periodView !== 'previousFyAndCurrentHalves') return null;

    var currentFyLabel = 'FY' + String(currentFyYear).slice(-2);
    var previousFyLabel = 'FY' + String(currentFyYear - 1).slice(-2);
    var periodLabels = [
      previousFyLabel,
      currentFyLabel + ' H1',
      currentFyLabel + ' H2'
    ];

    var periodCounts = {};
    periodLabels.forEach(function (label) {
      periodCounts[label] = {};
      series.forEach(function (s) { periodCounts[label][s] = 0; });
    });

    Object.keys(dataset.groups || {}).forEach(function (groupKey) {
      var g = dataset.groups[groupKey];
      var periodLabel = _momentumPeriodForDate_(g.earliestDate, currentFyYear, periodView);
      if (!periodLabel || !periodCounts[periodLabel]) return;
      periodCounts[periodLabel][g.series] =
        (periodCounts[periodLabel][g.series] || 0) + 1;
    });

    return periodLabels.map(function (label) {
      var counts = periodCounts[label];
      var total = 0;
      series.forEach(function (s) { total += counts[s] || 0; });
      var isInProgress = (half === 'H1' && label === currentFyLabel + ' H1') ||
                         (half === 'H2' && label === currentFyLabel + ' H2');
      return {
        label: label,
        counts: counts,
        totalGoLives: total,
        isInProgress: isInProgress,
        isCurrent: isInProgress
      };
    });
  }

  /**
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
   * @param {Date} d
   * @return {string}
   */
  function _isoDate_(d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  /**
   * @param {Date} d
   * @return {string}
   */
  function _dateLabel_(d) {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /**
   * @param {Array} headers
   * @param {Array<string>} keywords
   * @param {number} fallback
   * @return {number}
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
   * @param {*} value
   * @return {string}
   */
  function _normalizeSfdcId_(value) {
    return String(value || '').trim();
  }

  /**
   * @param {*} value
   * @return {string}
   */
  function _sfdcId15_(value) {
    var s = _normalizeSfdcId_(value);
    return s.length >= 15 ? s.slice(0, 15) : s;
  }

  /**
   * @param {Array} headers
   * @param {Array<string>} exactNames
   * @return {number}
   */
  function _findExactHeaderCol_(headers, exactNames) {
    var map = {};
    var i;
    for (i = 0; i < headers.length; i++) {
      map[String(headers[i] || '').trim().toLowerCase()] = i;
    }
    for (i = 0; i < (exactNames || []).length; i++) {
      var key = String(exactNames[i] || '').trim().toLowerCase();
      if (map[key] !== undefined) return map[key];
    }
    return -1;
  }

  /**
   * Prefers exact header match, then keyword fallback.
   * @param {Array} headers
   * @param {Array<string>} exactHeaders
   * @param {Array<string>} keywords
   * @param {number} fallback
   * @return {number}
   */
  function _findExactOrKeywordCol_(headers, exactHeaders, keywords, fallback) {
    var exact = _findExactHeaderCol_(headers, exactHeaders || []);
    if (exact >= 0) return exact;
    return _findCol_(headers, keywords || [], fallback);
  }

  /**
   * Parses momentum timeRange strings such as "LAST_N_YEARS:5".
   * @param {string|number|undefined} timeRange
   * @param {number} fallbackYears
   * @return {number}
   */
  function _parseHistoricalYears_(timeRange, fallbackYears) {
    if (typeof timeRange === 'number' && timeRange > 0) return timeRange;
    var s = String(timeRange || '').trim();
    var match = s.match(/^LAST_N_YEARS:(\d+)$/i);
    if (match) return parseInt(match[1], 10);
    return fallbackYears;
  }

  /**
   * SQL-style LIKE match (% = any substring).
   * @param {string} value
   * @param {string} pattern
   * @return {boolean}
   */
  function _matchesLikePattern_(value, pattern) {
    var v = String(value || '').trim().toLowerCase();
    var p = String(pattern || '').trim().toLowerCase();
    if (!p) return true;
    if (p.indexOf('%') < 0) return v === p;
    var parts = p.split('%').filter(function (x) { return x.length > 0; });
    if (!parts.length) return true;
    var idx = 0;
    for (var i = 0; i < parts.length; i++) {
      var found = v.indexOf(parts[i], idx);
      if (found < 0) return false;
      idx = found + parts[i].length;
    }
    return true;
  }

  /**
   * @param {Object} row
   * @param {Object} productFilter
   * @return {boolean}
   */
  function _rowMatchesProductFilter_(row, productFilter) {
    if (!productFilter) return true;
    var areas = productFilter.Product_Area__c;
    var names = productFilter.Deployment_Name;
    var areaList = areas == null ? [] : (Array.isArray(areas) ? areas : [areas]);
    var nameList = names == null ? [] : (Array.isArray(names) ? names : [names]);
    if (!areaList.length && !nameList.length) return true;

    var productArea = String(row.productArea || '').trim().toLowerCase();
    var depName = String(row.deploymentName || '').trim().toLowerCase();
    var ai, ni;

    for (ai = 0; ai < areaList.length; ai++) {
      if (productArea === String(areaList[ai] || '').trim().toLowerCase()) return true;
    }
    for (ni = 0; ni < nameList.length; ni++) {
      if (_matchesLikePattern_(depName, nameList[ni])) return true;
    }
    return false;
  }

  /**
   * Maps a filtered row to a chartLegend series key.
   * @param {Object} row
   * @param {Array<string>} chartLegend
   * @return {string|null}
   */
  function _resolveSeries_(row, chartLegend) {
    if (!chartLegend || !chartLegend.length) return null;
    if (chartLegend.length === 1) return chartLegend[0];

    var depName = String(row.deploymentName || '').toLowerCase();
    var productArea = String(row.productArea || '').toLowerCase();
    var li, series, key;

    for (li = 0; li < chartLegend.length; li++) {
      series = chartLegend[li];
      key = String(series || '').trim().toLowerCase();
      if (!key) continue;
      if (depName.indexOf(key) >= 0 || productArea.indexOf(key) >= 0) return series;
    }
    return null;
  }

  /**
   * Resolves Deployment__c FK column, excluding relationship traversal headers.
   * @param {Array} headers
   * @param {number} positionalDefault
   * @return {number}
   */
  function _findDeploymentFkCol_(headers, positionalDefault) {
    var exact = _findExactHeaderCol_(headers, ['Deployment__c']);
    if (exact >= 0) return exact;
    var i, h;
    for (i = 0; i < headers.length; i++) {
      h = String(headers[i] || '').trim().toLowerCase();
      if (h.indexOf('deployment') !== -1 && h.indexOf('.') === -1) return i;
    }
    if (positionalDefault >= 0 && positionalDefault < headers.length &&
        String(headers[positionalDefault] || '').trim() !== '') {
      return positionalDefault;
    }
    return -1;
  }

  /**
   * @param {string} industry
   * @param {Array<string>} series
   * @return {boolean}
   */
  function _isInvalidIndustryName_(industry, series) {
    var n = String(industry || '').trim();
    if (!n || n.toLowerCase() === 'unknown') return true;
    if (_isMomentumSeriesName_(n, series)) return true;
    var platformCodes = ['hcm', 'fin', 'pay'];
    return platformCodes.indexOf(n.toLowerCase()) >= 0;
  }

  /**
   * @param {Object} groups
   * @param {Object} stats
   */
  function _tallyGroupIndustryStats_(groups, stats) {
    stats.groupsWithIndustry = 0;
    stats.groupsMissingIndustry = 0;
    Object.keys(groups || {}).forEach(function (groupKey) {
      var industry = String((groups[groupKey] && groups[groupKey].industry) || '').trim();
      if (industry) stats.groupsWithIndustry++;
      else stats.groupsMissingIndustry++;
    });
  }

  /**
   * Resolves sheet name from momentum dataSource config key.
   * @param {AppConfig} cfg
   * @return {string}
   */
  function _resolveDataSheetName_(cfg) {
    var momentum = cfg.momentum || {};
    var dataSource = String(momentum.dataSource || '').trim();
    if (dataSource === 'Deployments__c') {
      return (cfg.sheets && cfg.sheets.deployments) || 'SFDC_Deployments';
    }
    return (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
           'SFDC_DeploymentProductFunctions';
  }

  /**
   * Stores a deployment context under full and 15-char ID keys.
   * @param {Object} lookup
   * @param {string} id
   * @param {Object} entry
   */
  function _storeDeploymentLookupEntry_(lookup, id, entry) {
    var normalized = _normalizeSfdcId_(id);
    if (!normalized) return;
    lookup[normalized] = entry;
    var prefix = _sfdcId15_(normalized);
    if (prefix && !lookup[prefix]) lookup[prefix] = entry;
  }

  /**
   * @param {Object} lookup
   * @param {string} deploymentId
   * @return {Object}
   */
  function _lookupDeploymentCtx_(lookup, deploymentId) {
    var key = _normalizeSfdcId_(deploymentId);
    if (!key) return {};
    if (lookup[key]) return lookup[key];
    var prefix = _sfdcId15_(key);
    if (prefix && lookup[prefix]) return lookup[prefix];
    return {};
  }

  /**
   * Reads SFDC_Deployments into lookup map and ordered row list.
   * ProductMode apps (EVI/AI) build lookup from PF relationship fields instead.
   * @param {AppConfig} cfg
   * @return {{ lookup: Object, deploymentRows: Array<Object> }}
   */
  function _buildDeploymentLookup_(cfg) {
    if (_usesPfMomentumLookup_(cfg)) {
      return _buildDeploymentLookupFromPf_(cfg);
    }

    var sheetName = (cfg.sheets && cfg.sheets.deployments) || 'SFDC_Deployments';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    var lookup = {};
    var deploymentRows = [];
    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('CorePortfolioMomentum._buildDeploymentLookup_: sheet empty or missing.');
      return { lookup: lookup, byId: lookup, deploymentRows: deploymentRows };
    }

    var allValues = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var headers = allValues[0];
    var colId = _findExactOrKeywordCol_(headers, ['Id'], ['id'], 0);
    var colName = _findExactOrKeywordCol_(headers, ['Name'], ['name'], 1);
    var colAccount = _findExactOrKeywordCol_(
      headers,
      ['Customer__r.Name'],
      ['customer__r.name', 'account name'],
      2
    );
    var colIndustry = _findExactOrKeywordCol_(
      headers,
      ['Customer__r.Industry'],
      ['customer__r.industry', 'industry'],
      3
    );
    var colStatus = _findExactOrKeywordCol_(
      headers,
      ['Overall_Status__c'],
      ['overall_status', 'overall status'],
      10
    );
    var colStart = _findExactOrKeywordCol_(
      headers,
      ['Deployment_Start_Date__c'],
      ['deployment_start_date', 'deployment start date'],
      7
    );
    var colCurrentMtp = _findExactOrKeywordCol_(
      headers,
      ['Current_MTP_Date__c'],
      ['current_mtp_date', 'current mtp date'],
      8
    );
    var colFirstMtpActual = _findExactOrKeywordCol_(
      headers,
      ['First_Move_to_Production_Date_Actual__c'],
      ['first_move_to_production_date_actual', 'move_to_production_date_actual', 'first mtp'],
      9
    );
    var colCompletion = _findExactOrKeywordCol_(
      headers,
      ['Deployment_Completion_Date__c'],
      ['deployment_completion_date', 'completion_date', 'deployment completion date'],
      14
    );

    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];
      var id = colId >= 0 ? _normalizeSfdcId_(row[colId]) : '';
      if (!id) continue;
      var entry = {
        deploymentId: id,
        deploymentName: colName >= 0 ? String(row[colName] || '').trim() : '',
        accountName: colAccount >= 0 ? String(row[colAccount] || '').trim() : '',
        industry: colIndustry >= 0 ? String(row[colIndustry] || '').trim() : '',
        status: colStatus >= 0 ? String(row[colStatus] || '').trim() : '',
        deploymentStartDate: _normalizeDate_(colStart >= 0 ? row[colStart] : null),
        currentMtpDate: _normalizeDate_(colCurrentMtp >= 0 ? row[colCurrentMtp] : null),
        firstMtpDateActual: _normalizeDate_(colFirstMtpActual >= 0 ? row[colFirstMtpActual] : null),
        completionDate: _normalizeDate_(colCompletion >= 0 ? row[colCompletion] : null)
      };
      deploymentRows.push(entry);
      _storeDeploymentLookupEntry_(lookup, id, entry);
    }

    Logger.log(
      'CorePortfolioMomentum._buildDeploymentLookup_: rows=' + deploymentRows.length +
      ', byIdKeys=' + Object.keys(lookup).length +
      ', colId=' + colId +
      ', colName=' + colName +
      ', colAccount=' + colAccount +
      ', colIndustry=' + colIndustry +
      ', colStatus=' + colStatus
    );

    return { lookup: lookup, byId: lookup, deploymentRows: deploymentRows };
  }

  /**
   * @param {AppConfig} cfg
   * @return {boolean}
   */
  function _usesPfMomentumLookup_(cfg) {
    return !!(cfg && cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled &&
      cfg.momentum && cfg.momentum.dataSource === 'Deployment_Product_Function__c');
  }

  /**
   * Builds deployment lookup from normalized PF rows (one entry per parent deployment).
   * @param {AppConfig} cfg
   * @return {{ lookup: Object, deploymentRows: Array<Object> }}
   */
  function _buildDeploymentLookupFromPf_(cfg) {
    var lookup = {};
    var deploymentRows = [];
    var pfRows = [];
    try {
      pfRows = CoreData.readProductModePfRowsRaw_(cfg) || [];
    } catch (e) {
      Logger.log('CorePortfolioMomentum._buildDeploymentLookupFromPf_: read failed: ' + e);
      return { lookup: lookup, byId: lookup, deploymentRows: deploymentRows };
    }

    var byParent = {};
    pfRows.forEach(function (pf) {
      if (!pf || !pf.deploymentFk) return;
      var id = String(pf.parentDeploymentId || pf.deploymentFk).trim();
      if (!id) return;
      if (!byParent[id]) {
        byParent[id] = {
          deploymentId: id,
          deploymentName: pf.deploymentName || '',
          accountName: pf.accountName || '',
          industry: pf.industry || '',
          status: pf.overallStatus || '',
          deploymentStartDate: pf.deploymentStartDate || '',
          currentMtpDate: pf.mtpDate || '',
          firstMtpDateActual: pf.firstMtpDateActual || pf.actualGoLive || '',
          completionDate: pf.completionDate || ''
        };
      }
    });

    Object.keys(byParent).forEach(function (id) {
      var entry = byParent[id];
      deploymentRows.push(entry);
      _storeDeploymentLookupEntry_(lookup, id, entry);
    });

    Logger.log(
      'CorePortfolioMomentum._buildDeploymentLookupFromPf_: rows=' + deploymentRows.length +
      ', byIdKeys=' + Object.keys(lookup).length
    );
    return { lookup: lookup, byId: lookup, deploymentRows: deploymentRows };
  }

  /**
   * @return {Object}
   */
  function _createEmptyStats_() {
    return {
      totalRowsScanned: 0,
      productFunctionRowsScanned: 0,
      deploymentRowsScanned: 0,
      rowsCounted: 0,
      productFunctionRowsCounted: 0,
      standaloneDeploymentRowsCounted: 0,
      rowsSkippedNoDate: 0,
      rowsSkippedNoDeploymentId: 0,
      rowsSkippedUnmappedProductArea: 0,
      rowsSkippedNoResolvedSeries: 0,
      rowsUsingActualDate: 0,
      rowsUsingTargetDate: 0,
      deploymentLookupHits: 0,
      deploymentLookupMisses: 0,
      lookupMissSamples: [],
      groupsWithIndustry: 0,
      groupsMissingIndustry: 0
    };
  }

  /**
   * @param {string} dateSource
   * @return {boolean}
   */
  function _isActualDateSource_(dateSource) {
    return dateSource === 'actual';
  }

  /**
   * @param {*} actualRaw
   * @param {*} targetRaw
   * @param {string} dateStrategy
   * @return {{ date: string|null, dateSource: string|null }}
   */
  function _resolvePfDate_(actualRaw, targetRaw, dateStrategy) {
    var actual = _normalizeDate_(actualRaw);
    var target = _normalizeDate_(targetRaw);
    if (dateStrategy === 'targetOnly') {
      return target
        ? { date: target, dateSource: 'target' }
        : { date: null, dateSource: null };
    }
    if (dateStrategy === 'actualThenTarget') {
      if (actual) return { date: actual, dateSource: 'actual' };
      if (target) return { date: target, dateSource: 'target' };
      return { date: null, dateSource: null };
    }
    if (actual) return { date: actual, dateSource: 'actual' };
    return { date: null, dateSource: null };
  }

  /**
   * @param {Object} depCtx
   * @param {string} dateStrategy
   * @return {{ date: string|null, dateSource: string|null }}
   */
  function _resolveDeploymentDate_(depCtx, dateStrategy) {
    var firstActual = depCtx.firstMtpDateActual || null;
    var currentMtp = depCtx.currentMtpDate || null;
    var completion = depCtx.completionDate || null;

    if (dateStrategy === 'targetOnly') {
      return currentMtp
        ? { date: currentMtp, dateSource: 'target' }
        : { date: null, dateSource: null };
    }
    if (dateStrategy === 'actualThenTarget') {
      if (firstActual) return { date: firstActual, dateSource: 'actual' };
      if (currentMtp) return { date: currentMtp, dateSource: 'target' };
      if (completion) return { date: completion, dateSource: 'actual' };
      return { date: null, dateSource: null };
    }
    if (firstActual) return { date: firstActual, dateSource: 'actual' };
    return { date: null, dateSource: null };
  }

  /**
   * @param {string} deploymentName
   * @param {Object} productFilter
   * @return {boolean}
   */
  function _rowMatchesDeploymentNameFilter_(deploymentName, productFilter) {
    if (!productFilter) return false;
    var names = productFilter.Deployment_Name;
    var nameList = names == null ? [] : (Array.isArray(names) ? names : [names]);
    if (!nameList.length) return false;
    var depName = String(deploymentName || '').trim();
    var ni;
    for (ni = 0; ni < nameList.length; ni++) {
      if (_matchesLikePattern_(depName, nameList[ni])) return true;
    }
    return false;
  }

  /**
   * @param {string} status
   * @param {AppConfig} cfg
   * @return {boolean}
   */
  function _isAllowedDeploymentStatus_(status, cfg) {
    var sf = cfg.salesforce || {};
    var statusValues = sf.statusValues || {};
    var active = String(statusValues.active || 'Active').trim().toLowerCase();
    var complete = String(statusValues.complete || 'Complete').trim().toLowerCase();
    var s = String(status || '').trim().toLowerCase();
    return s === active || s === complete;
  }

  /**
   * @param {Object} existing
   * @param {Object} candidate
   * @return {number} negative if candidate wins
   */
  function _compareMomentumCandidates_(existing, candidate) {
    var existingActual = _isActualDateSource_(existing.dateSource);
    var candidateActual = _isActualDateSource_(candidate.dateSource);
    if (candidateActual && !existingActual) return -1;
    if (existingActual && !candidateActual) return 1;
    if (candidate.earliestDate < existing.earliestDate) return -1;
    if (candidate.earliestDate > existing.earliestDate) return 1;
    if (existing.source === 'productFunction' && candidate.source !== 'productFunction') return 1;
    if (candidate.source === 'productFunction' && existing.source !== 'productFunction') return -1;
    return 0;
  }

  /**
   * @param {Object} groups
   * @param {string} groupKey
   * @param {Object} candidate
   */
  function _upsertMomentumGroup_(groups, groupKey, candidate) {
    var existing = groups[groupKey];
    if (!existing) {
      groups[groupKey] = candidate;
      return;
    }
    var cmp = _compareMomentumCandidates_(existing, candidate);
    if (cmp > 0) return;
    if (cmp < 0) {
      groups[groupKey] = candidate;
      return;
    }
    if (!existing.industry && candidate.industry) existing.industry = candidate.industry;
    if (!existing.accountKey && candidate.accountKey) existing.accountKey = candidate.accountKey;
    if (!existing.deploymentName && candidate.deploymentName) {
      existing.deploymentName = candidate.deploymentName;
    }
  }

  /**
   * @param {Object} stats
   * @param {{ dateSource: string|null }} dateInfo
   */
  function _trackDateUsage_(stats, dateInfo) {
    if (dateInfo.dateSource === 'actual') stats.rowsUsingActualDate++;
    if (dateInfo.dateSource === 'target') stats.rowsUsingTargetDate++;
  }

  /**
   * @param {Object} stats
   * @param {string} deploymentId
   * @param {Object} depCtx
   */
  function _trackLookupResult_(stats, deploymentId, depCtx) {
    if (depCtx && depCtx.deploymentId) {
      stats.deploymentLookupHits++;
      return;
    }
    if (!deploymentId) return;
    stats.deploymentLookupMisses++;
    if (stats.lookupMissSamples.length < 5) {
      stats.lookupMissSamples.push(deploymentId);
    }
  }

  /**
   * @param {Object} stats
   * @return {Object}
   */
  function _finalizeStats_(stats) {
    stats.totalRowsScanned =
      (stats.productFunctionRowsScanned || 0) + (stats.deploymentRowsScanned || 0);
    return stats;
  }

  /**
   * @param {Object} stats
   * @param {number} dedupedGoLiveCount
   * @return {Object}
   */
  function _buildDataIntegrity_(stats, dedupedGoLiveCount) {
    return {
      totalRowsScanned: stats.totalRowsScanned || 0,
      rowsCounted: stats.rowsCounted || 0,
      rowsSkippedNoDate: stats.rowsSkippedNoDate || 0,
      rowsSkippedUnmappedProductArea: stats.rowsSkippedUnmappedProductArea || 0,
      rowsSkippedNoDeploymentId: stats.rowsSkippedNoDeploymentId || 0,
      rawRowsInGroupBeforeDedup: stats.rowsCounted || 0,
      dedupedGoLiveCount: dedupedGoLiveCount || 0,
      productFunctionRowsScanned: stats.productFunctionRowsScanned || 0,
      deploymentRowsScanned: stats.deploymentRowsScanned || 0,
      productFunctionRowsCounted: stats.productFunctionRowsCounted || 0,
      standaloneDeploymentRowsCounted: stats.standaloneDeploymentRowsCounted || 0,
      rowsSkippedNoResolvedSeries: stats.rowsSkippedNoResolvedSeries || 0,
      rowsUsingActualDate: stats.rowsUsingActualDate || 0,
      rowsUsingTargetDate: stats.rowsUsingTargetDate || 0,
      deploymentLookupHits: stats.deploymentLookupHits || 0,
      deploymentLookupMisses: stats.deploymentLookupMisses || 0,
      groupsWithIndustry: stats.groupsWithIndustry || 0,
      groupsMissingIndustry: stats.groupsMissingIndustry || 0
    };
  }

  /**
   * Substitutes {FY} tokens in KPI label strings.
   * @param {Object|null} kpiLabels
   * @param {string} fyLabel
   * @return {Object|null}
   */
  function _resolveKpiLabels_(kpiLabels, fyLabel) {
    if (!kpiLabels) return null;
    var out = {};
    Object.keys(kpiLabels).forEach(function (key) {
      out[key] = String(kpiLabels[key] || '').replace(/\{FY\}/g, fyLabel);
    });
    return out;
  }

  /**
   * @param {AppConfig} cfg
   * @param {Array<string>} series
   * @param {string} fyLabel
   * @param {string} mode
   * @return {Object}
   */
  function _buildEmptySnapshot_(cfg, series, fyLabel, mode) {
    var now = new Date();
    var fyInfo = _wyFyFromDate_(now);
    var half = _getHalf_(now);
    var emptyCountMap = {};
    series.forEach(function (s) { emptyCountMap[s] = 0; });
    var genLabel = _dateLabel_(now);
    var growthRates = {};
    series.forEach(function (s) { growthRates[s] = { avgYoyPct: 0, sampleFys: 0 }; });
    var momentum = cfg.momentum || {};
    var periodView = momentum.periodView || 'historicalFyAndCurrentRunningTotal';
    var industryGrowthStrategy = momentum.industryGrowthStrategy || 'cagr';
    var previousFyLabel = 'FY' + String(fyInfo.fyYear - 1).slice(-2);
    var chartPeriods = _buildChartPeriods_(
      { groups: {}, series: series },
      fyInfo.fyYear,
      periodView,
      series,
      half
    );

    return {
      appId: cfg.appId || '',
      mode: mode || 'platform',
      generatedAt: now.toISOString(),
      generatedDateLabel: genLabel,
      currentFy: {
        label: fyLabel || fyInfo.label,
        isInProgress: true,
        inProgressLabel: half,
        inProgressBadge: (fyLabel || fyInfo.label) + ' ' + half + ' running total as of ' + genLabel,
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
      chartPeriods: chartPeriods,
      periodView: periodView,
      industryGrowthStrategy: industryGrowthStrategy,
      previousFyLabel: previousFyLabel,
      growthRates: growthRates,
      fastestGrowingPlatform: series[0] || null,
      fastestGrowingIndustry: null,
      portfolioGrowthRate: { avgYoyPct: 0, sampleFys: 0 },
      growthMetricSeries: series[0] || null,
      platforms: series,
      chartLegend: momentum.chartLegend || series,
      kpiLabels: _resolveKpiLabels_(momentum.kpiLabels, fyLabel || fyInfo.label),
      chartColors: (momentum.chart && momentum.chart.colors) || {},
      inProgressOpacity: (momentum.chart && momentum.chart.inProgressOpacity != null)
        ? momentum.chart.inProgressOpacity : 0.55,
      dataIntegrity: {
        totalRowsScanned: 0, rowsCounted: 0,
        rowsSkippedNoDate: 0, rowsSkippedUnmappedProductArea: 0,
        rowsSkippedNoDeploymentId: 0, rawRowsInGroupBeforeDedup: 0, dedupedGoLiveCount: 0
      }
    };
  }

  /**
   * Computes CAGR between first and last historical FY count maps.
   * @param {Array<{label:string, counts:Object}>} historicalFys
   * @param {string|null} seriesFilter  null = portfolio total across all series
   * @return {{ avgYoyPct: number, sampleFys: number }}
   */
  function _cagrFromHistorical_(historicalFys, seriesFilter) {
    if (!historicalFys || historicalFys.length < 2) {
      return { avgYoyPct: 0, sampleFys: 0 };
    }
    var yearGaps = historicalFys.length - 1;
    var sumCounts = function (fyCounts) {
      if (seriesFilter) return fyCounts[seriesFilter] || 0;
      var total = 0;
      Object.keys(fyCounts || {}).forEach(function (k) {
        total += fyCounts[k] || 0;
      });
      return total;
    };
    var firstCount = sumCounts(historicalFys[0].counts);
    var lastCount = sumCounts(historicalFys[historicalFys.length - 1].counts);
    if (firstCount === 0) return { avgYoyPct: 0, sampleFys: yearGaps };
    var cagr = Math.pow(lastCount / firstCount, 1 / yearGaps) - 1;
    return { avgYoyPct: Math.round(cagr * 10000) / 10000, sampleFys: yearGaps };
  }

  // --------------------------------------------------------------------------
  // DATASET BUILDERS
  // --------------------------------------------------------------------------

  /**
   * Platform-mode dataset (HC/SLG/HENP) — unchanged behavior.
   * @param {AppConfig} cfg
   * @param {Object} momentum
   * @param {Array<string>} seriesList
   * @return {Object|null}
   */
  function _queryPlatformMomentumDataset_(cfg, momentum, seriesList) {
    var sheetName = _resolveDataSheetName_(cfg);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('CorePortfolioMomentum.queryMomentumDataset: sheet "' + sheetName + '" not found.');
      return null;
    }

    var lastRow = sheet.getLastRow();
    var stats = _createEmptyStats_();
    if (lastRow < 2) {
      return {
        mode: 'platform',
        series: seriesList,
        groups: {},
        stats: _finalizeStats_(stats)
      };
    }

    var allValues = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    var headers = allValues[0];
    var deploymentBundle = _buildDeploymentLookup_(cfg);
    var deploymentLookup = deploymentBundle.lookup;

    var colProductArea = _findCol_(headers, ['product area'], 1);
    var colDateActual = _findCol_(headers, ['production move date actual', 'move date actual', 'actual'], 4);
    var colDeploymentFk = _findDeploymentFkCol_(headers, 5);
    var colDeploymentName = _findCol_(headers, ['deployment__r.name', 'deployment name'], -1);
    var colAccount = _findCol_(headers, ['account name', 'account c', 'accountname'], -1);
    var useDeploymentAsAccount = (colAccount < 0);

    if (colDeploymentFk < 0) {
      Logger.log('CorePortfolioMomentum.queryMomentumDataset: Deployment FK column missing.');
      return null;
    }

    var productAreaMapping = momentum.productAreaMapping || {};
    var areaToCode = {};
    seriesList.forEach(function (code) {
      (productAreaMapping[code] || []).forEach(function (v) {
        areaToCode[String(v).toLowerCase()] = code;
      });
    });

    var groups = {};
    var r, row, actualStr, deploymentId, depCtx, productAreaRaw, deploymentName;
    var industry, accountKey, series, groupKey;

    for (r = 1; r < allValues.length; r++) {
      stats.productFunctionRowsScanned++;
      row = allValues[r];
      actualStr = _normalizeDate_((colDateActual >= 0) ? row[colDateActual] : null);
      if (!actualStr) {
        stats.rowsSkippedNoDate++;
        continue;
      }

      deploymentId = String(row[colDeploymentFk] || '').trim();
      if (!deploymentId) {
        stats.rowsSkippedNoDeploymentId++;
        continue;
      }

      depCtx = _lookupDeploymentCtx_(deploymentLookup, deploymentId);
      productAreaRaw = (colProductArea >= 0)
        ? String(row[colProductArea] || '').trim()
        : '';
      deploymentName = '';
      if (colDeploymentName >= 0) {
        deploymentName = String(row[colDeploymentName] || '').trim();
      }
      if (!deploymentName && depCtx.deploymentName) {
        deploymentName = String(depCtx.deploymentName || '').trim();
      }
      industry = depCtx.industry || '';
      accountKey = useDeploymentAsAccount
        ? deploymentId
        : (String((colAccount >= 0 ? row[colAccount] : '') || '').trim() ||
           depCtx.accountName || deploymentId);

      series = areaToCode[productAreaRaw.toLowerCase()] || null;
      if (!series) {
        stats.rowsSkippedUnmappedProductArea++;
        continue;
      }

      stats.rowsCounted++;
      stats.productFunctionRowsCounted++;
      stats.rowsUsingActualDate++;
      groupKey = deploymentId + '|' + series;
      if (!groups[groupKey] || actualStr < groups[groupKey].earliestDate) {
        groups[groupKey] = {
          series: series,
          earliestDate: actualStr,
          dateSource: 'actual',
          source: 'productFunction',
          deploymentId: deploymentId,
          accountKey: accountKey,
          industry: industry,
          deploymentName: deploymentName
        };
      }
    }

    Logger.log(
      'CorePortfolioMomentum.queryMomentumDataset: mode=platform' +
      ', sheet=' + sheetName +
      ', totalRows=' + stats.productFunctionRowsScanned +
      ', counted=' + stats.rowsCounted +
      ', skippedNoDate=' + stats.rowsSkippedNoDate +
      ', skippedUnmapped=' + stats.rowsSkippedUnmappedProductArea +
      ', skippedNoDeployId=' + stats.rowsSkippedNoDeploymentId
    );

    return {
      mode: 'platform',
      series: seriesList,
      groups: groups,
      stats: _finalizeStats_(stats)
    };
  }

  /**
   * Product-function path for product-mode union dataset.
   * @param {AppConfig} cfg
   * @param {Object} momentum
   * @param {Object} deploymentBundle
   * @param {Array<string>} seriesList
   * @param {Object} groups
   * @param {Object} stats
   */
  function _buildProductFunctionMomentumGroups_(cfg, momentum, deploymentBundle, seriesList, groups, stats) {
    var sheetName = (cfg.sheets && cfg.sheets.sfdcDeploymentProductFunctions) ||
                    'SFDC_DeploymentProductFunctions';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;

    var deploymentLookup = deploymentBundle.lookup;
    var dateStrategy = momentum.dateStrategy || 'actualOnly';
    var allValues = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var headers = allValues[0];

    var colProductArea = _findCol_(headers, ['product area'], 1);
    var colDateActual = _findCol_(headers, ['production move date actual', 'move date actual'], 4);
    var colDateTarget = _findCol_(headers, ['production move date target', 'move date target'], 3);
    var colDeploymentFk = _findDeploymentFkCol_(headers, 5);
    var colDeploymentName = _findCol_(headers, ['deployment__r.name', 'deployment name'], -1);
    var colAccount = _findCol_(headers, ['account name', 'account c', 'accountname'], -1);
    var useDeploymentAsAccount = (colAccount < 0);

    if (colDeploymentFk < 0) {
      Logger.log('CorePortfolioMomentum._buildProductFunctionMomentumGroups_: Deployment FK missing.');
      return;
    }

    var r, row, deploymentId, depCtx, productAreaRaw, deploymentName, filterRow;
    var series, dateInfo, accountKey, industry, groupKey, candidate;

    for (r = 1; r < allValues.length; r++) {
      stats.productFunctionRowsScanned++;
      row = allValues[r];

      deploymentId = _normalizeSfdcId_(row[colDeploymentFk]);
      if (!deploymentId) {
        stats.rowsSkippedNoDeploymentId++;
        continue;
      }

      depCtx = _lookupDeploymentCtx_(deploymentLookup, deploymentId);
      _trackLookupResult_(stats, deploymentId, depCtx);

      productAreaRaw = (colProductArea >= 0)
        ? String(row[colProductArea] || '').trim()
        : '';
      deploymentName = '';
      if (colDeploymentName >= 0) {
        deploymentName = String(row[colDeploymentName] || '').trim();
      }
      if (!deploymentName && depCtx.deploymentName) {
        deploymentName = String(depCtx.deploymentName || '').trim();
      }

      filterRow = {
        productArea: productAreaRaw,
        deploymentName: deploymentName
      };
      if (!_rowMatchesProductFilter_(filterRow, momentum.productFilter)) {
        stats.rowsSkippedUnmappedProductArea++;
        continue;
      }

      series = _resolveSeries_(filterRow, seriesList);
      if (!series) {
        stats.rowsSkippedNoResolvedSeries++;
        continue;
      }

      dateInfo = _resolvePfDate_(
        (colDateActual >= 0) ? row[colDateActual] : null,
        (colDateTarget >= 0) ? row[colDateTarget] : null,
        dateStrategy
      );
      if (!dateInfo.date) {
        stats.rowsSkippedNoDate++;
        continue;
      }

      industry = String(depCtx.industry || '').trim();
      accountKey = useDeploymentAsAccount
        ? deploymentId
        : (String((colAccount >= 0 ? row[colAccount] : '') || '').trim() ||
           String(depCtx.accountName || '').trim() || deploymentId);

      stats.rowsCounted++;
      stats.productFunctionRowsCounted++;
      _trackDateUsage_(stats, dateInfo);

      groupKey = deploymentId + '|' + series;
      candidate = {
        series: series,
        earliestDate: dateInfo.date,
        dateSource: dateInfo.dateSource,
        source: 'productFunction',
        deploymentId: deploymentId,
        accountKey: accountKey,
        industry: industry,
        deploymentName: deploymentName
      };
      _upsertMomentumGroup_(groups, groupKey, candidate);
    }
  }

  /**
   * Standalone deployment-name path for product-mode union dataset.
   * @param {AppConfig} cfg
   * @param {Object} momentum
   * @param {Object} deploymentBundle
   * @param {Array<string>} seriesList
   * @param {Object} groups
   * @param {Object} stats
   */
  function _buildStandaloneDeploymentMomentumGroups_(cfg, momentum, deploymentBundle, seriesList, groups, stats) {
    if (momentum.includeStandaloneDeployments !== true) return;

    var dateStrategy = momentum.dateStrategy || 'actualOnly';
    var deploymentRows = deploymentBundle.deploymentRows || [];
    var i, depCtx, filterRow, series, dateInfo, groupKey, candidate, accountKey;

    for (i = 0; i < deploymentRows.length; i++) {
      stats.deploymentRowsScanned++;
      depCtx = deploymentRows[i];

      if (!_isAllowedDeploymentStatus_(depCtx.status, cfg)) continue;
      if (!_rowMatchesDeploymentNameFilter_(depCtx.deploymentName, momentum.productFilter)) {
        continue;
      }

      filterRow = {
        productArea: '',
        deploymentName: depCtx.deploymentName
      };
      series = _resolveSeries_(filterRow, seriesList);
      if (!series) {
        stats.rowsSkippedNoResolvedSeries++;
        continue;
      }

      dateInfo = _resolveDeploymentDate_(depCtx, dateStrategy);
      if (!dateInfo.date) {
        stats.rowsSkippedNoDate++;
        continue;
      }

      accountKey = String(depCtx.accountName || '').trim() || depCtx.deploymentId;
      stats.rowsCounted++;
      stats.standaloneDeploymentRowsCounted++;
      _trackDateUsage_(stats, dateInfo);

      groupKey = depCtx.deploymentId + '|' + series;
      candidate = {
        series: series,
        earliestDate: dateInfo.date,
        dateSource: dateInfo.dateSource,
        source: 'deployment',
        deploymentId: depCtx.deploymentId,
        accountKey: accountKey,
        industry: String(depCtx.industry || '').trim(),
        deploymentName: String(depCtx.deploymentName || '').trim()
      };
      _upsertMomentumGroup_(groups, groupKey, candidate);
    }
  }

  /**
   * Product-mode union dataset (EVI/AI).
   * @param {AppConfig} cfg
   * @param {Object} momentum
   * @param {Array<string>} seriesList
   * @return {Object}
   */
  function _queryProductMomentumDataset_(cfg, momentum, seriesList) {
    var stats = _createEmptyStats_();
    var deploymentBundle = _buildDeploymentLookup_(cfg);
    var groups = {};

    _buildProductFunctionMomentumGroups_(
      cfg, momentum, deploymentBundle, seriesList, groups, stats);
    _buildStandaloneDeploymentMomentumGroups_(
      cfg, momentum, deploymentBundle, seriesList, groups, stats);

    _tallyGroupIndustryStats_(groups, stats);

    Logger.log(
      'CorePortfolioMomentum.queryMomentumDataset: mode=product' +
      ', pfRowsScanned=' + stats.productFunctionRowsScanned +
      ', depRowsScanned=' + stats.deploymentRowsScanned +
      ', pfCounted=' + stats.productFunctionRowsCounted +
      ', standaloneCounted=' + stats.standaloneDeploymentRowsCounted +
      ', dedupedGroups=' + Object.keys(groups).length +
      ', skippedNoDate=' + stats.rowsSkippedNoDate +
      ', lookupHits=' + stats.deploymentLookupHits +
      ', lookupMisses=' + stats.deploymentLookupMisses
    );
    Logger.log(
      'CorePortfolioMomentum.queryMomentumDataset industry: lookupHits=' +
      stats.deploymentLookupHits +
      ', lookupMisses=' + stats.deploymentLookupMisses +
      ', groupsWithIndustry=' + stats.groupsWithIndustry +
      ', groupsMissingIndustry=' + stats.groupsMissingIndustry +
      ', sampleMissingDeploymentIds=' + (stats.lookupMissSamples || []).join(',')
    );
    if (stats.lookupMissSamples && stats.lookupMissSamples.length) {
      Logger.log(
        'CorePortfolioMomentum.queryMomentumDataset: sample lookup misses=' +
        stats.lookupMissSamples.join(', ')
      );
    }

    return {
      mode: 'product',
      series: seriesList,
      groups: groups,
      stats: _finalizeStats_(stats)
    };
  }

  // --------------------------------------------------------------------------
  // DATASET + KPI CALCULATORS
  // --------------------------------------------------------------------------

  /**
   * Loads and filters raw momentum rows, then deduplicates to go-live groups.
   * @param {AppConfig} config
   * @return {Object|null}
   */
  function queryMomentumDataset(config) {
    var cfg = CoreConfig.withDefaults(config);
    var momentum = cfg.momentum || {};
    if (!momentum.enabled) return null;

    var mode = (Array.isArray(momentum.platforms) && momentum.platforms.length)
      ? 'platform'
      : 'product';

    var seriesList = mode === 'platform'
      ? (momentum.platforms || [])
      : (momentum.chartLegend || []);

    if (mode === 'platform') {
      return _queryPlatformMomentumDataset_(cfg, momentum, seriesList);
    }
    return _queryProductMomentumDataset_(cfg, momentum, seriesList);
  }

  /**
   * @param {Object} ctx  Built momentum context with historicalFys/currentFyCounts
   * @param {string|null} seriesFilter
   * @return {number}
   */
  function calculateGoLives(ctx, seriesFilter) {
    var counts = (ctx.currentFyCounts) || {};
    if (seriesFilter) return counts[seriesFilter] || 0;
    var total = 0;
    (ctx.series || []).forEach(function (s) { total += counts[s] || 0; });
    return total;
  }

  /**
   * @param {Object} ctx
   * @param {string|null} seriesFilter
   * @return {number}
   */
  function calculateDistinctAccounts(ctx, seriesFilter) {
    var keys = (ctx.currentFyAccountKeysBySeries) || {};
    if (seriesFilter) {
      return Object.keys(keys[seriesFilter] || {}).length;
    }
    var all = {};
    Object.keys(keys).forEach(function (s) {
      Object.keys(keys[s] || {}).forEach(function (k) { all[k] = true; });
    });
    return Object.keys(all).length;
  }

  /**
   * @param {Object} ctx
   * @param {string|null} seriesFilter
   * @return {{ avgYoyPct: number, sampleFys: number }}
   */
  function calculateAnnualGrowthRate(ctx, seriesFilter) {
    return _cagrFromHistorical_(ctx.historicalFys || [], seriesFilter);
  }

  /**
   * @param {string} name
   * @param {Array<string>} series
   * @return {boolean}
   */
  function _isMomentumSeriesName_(name, series) {
    var n = String(name || '').trim().toLowerCase();
    if (!n) return false;
    return (series || []).some(function (s) {
      return String(s || '').trim().toLowerCase() === n;
    });
  }

  /**
   * @param {Object} ctx
   * @return {{ name: string, avgYoyPct: number, rank: number }|null}
   */
  function calculateFastestGrowingIndustry(ctx) {
    var industryHist = ctx.historicalIndustryCounts || {};
    var series = ctx.series || [];
    var labels = Object.keys(industryHist).sort(function (a, b) {
      return _fyYearFromLabel_(a) - _fyYearFromLabel_(b);
    });
    if (labels.length < 2) return null;

    var industries = {};
    labels.forEach(function (fyLabel) {
      Object.keys(industryHist[fyLabel] || {}).forEach(function (ind) {
        if (!_isInvalidIndustryName_(ind, series)) industries[ind] = true;
      });
    });

    var ranked = [];
    Object.keys(industries).forEach(function (industry) {
      var hist = labels.map(function (fyLabel) {
        return {
          label: fyLabel,
          counts: { _total: (industryHist[fyLabel] && industryHist[fyLabel][industry]) || 0 }
        };
      });
      var rate = _cagrFromHistorical_(hist, '_total');
      ranked.push({
        name: industry,
        avgYoyPct: rate.avgYoyPct,
        sampleFys: rate.sampleFys
      });
    });

    ranked.sort(function (a, b) {
      if (b.avgYoyPct !== a.avgYoyPct) return b.avgYoyPct - a.avgYoyPct;
      return String(a.name).localeCompare(String(b.name));
    });

    if (!ranked.length || ranked[0].avgYoyPct <= 0) return null;
    return {
      name: ranked[0].name,
      avgYoyPct: ranked[0].avgYoyPct,
      rank: 1,
      strategy: 'cagr'
    };
  }

  /**
   * Ranks industries by current-FY YTD count minus previous-FY count (product mode).
   * Supports zero historical baselines unlike CAGR.
   * @param {Object} ctx
   * @param {string} currentFyLabel
   * @param {string} previousFyLabel
   * @param {Array<string>} seriesList
   * @return {Object|null}
   */
  function _calculateFastestGrowingIndustryByDelta_(
    ctx, currentFyLabel, previousFyLabel, seriesList
  ) {
    var historicalIndustryCounts = ctx.historicalIndustryCounts || {};
    var currentFyIndustryCounts = ctx.currentFyIndustryCounts || {};
    var prevCounts = historicalIndustryCounts[previousFyLabel] || {};
    var currCounts = currentFyIndustryCounts || {};
    var industries = {};

    Object.keys(prevCounts).forEach(function (ind) {
      if (!_isInvalidIndustryName_(ind, seriesList)) industries[ind] = true;
    });
    Object.keys(currCounts).forEach(function (ind) {
      if (!_isInvalidIndustryName_(ind, seriesList)) industries[ind] = true;
    });

    var ranked = [];
    Object.keys(industries).forEach(function (industry) {
      var prev = prevCounts[industry] || 0;
      var curr = currCounts[industry] || 0;
      var delta = curr - prev;
      ranked.push({
        name: industry,
        previousFyLabel: previousFyLabel,
        currentFyLabel: currentFyLabel,
        previousFyCount: prev,
        currentFyCount: curr,
        delta: delta,
        avgYoyPct: prev > 0 ? (curr - prev) / prev : null,
        rank: 0
      });
    });

    ranked.sort(function (a, b) {
      if (b.delta !== a.delta) return b.delta - a.delta;
      if (b.currentFyCount !== a.currentFyCount) return b.currentFyCount - a.currentFyCount;
      return String(a.name).localeCompare(String(b.name));
    });

    if (!ranked.length || ranked[0].delta <= 0) return null;

    ranked[0].rank = 1;
    ranked[0].strategy = 'currentVsPreviousFyDelta';
    return ranked[0];
  }

  /**
   * Buckets deduped groups into FY counts from a queryMomentumDataset result.
   * @param {Object} dataset
   * @param {number} historicalYears
   * @param {string} currentFyLabel
   * @param {number} currentFyYear
   * @return {Object}
   */
  function _buildMomentumContext_(dataset, historicalYears, currentFyLabel, currentFyYear) {
    var series = dataset.series || [];
    var oldestAllowedFyYear = currentFyYear - historicalYears;
    var historicalCounts = {};
    var historicalIndustryCounts = {};
    var currentFyIndustryCounts = {};
    var currentFyCounts = {};
    var currentFyAccountKeysBySeries = {};
    series.forEach(function (s) {
      currentFyCounts[s] = 0;
      currentFyAccountKeysBySeries[s] = {};
    });

    var dedupedGoLiveCount = 0;
    Object.keys(dataset.groups || {}).forEach(function (groupKey) {
      var g = dataset.groups[groupKey];
      var fyLabel = _fyLabelFromDateStr_(g.earliestDate);
      if (!fyLabel) return;
      var fyYear = _fyYearFromLabel_(fyLabel);
      dedupedGoLiveCount++;

      if (fyLabel === currentFyLabel) {
        currentFyCounts[g.series] = (currentFyCounts[g.series] || 0) + 1;
        if (g.accountKey) currentFyAccountKeysBySeries[g.series][g.accountKey] = true;
        var currentIndustry = String(g.industry || '').trim() || 'Unknown';
        currentFyIndustryCounts[currentIndustry] =
          (currentFyIndustryCounts[currentIndustry] || 0) + 1;
      } else if (fyYear >= oldestAllowedFyYear && fyYear < currentFyYear) {
        if (!historicalCounts[fyLabel]) {
          historicalCounts[fyLabel] = {};
          series.forEach(function (s) { historicalCounts[fyLabel][s] = 0; });
        }
        historicalCounts[fyLabel][g.series] =
          (historicalCounts[fyLabel][g.series] || 0) + 1;

        var industry = String(g.industry || '').trim() || 'Unknown';
        if (!historicalIndustryCounts[fyLabel]) historicalIndustryCounts[fyLabel] = {};
        historicalIndustryCounts[fyLabel][industry] =
          (historicalIndustryCounts[fyLabel][industry] || 0) + 1;
      }
    });

    var historicalFys = Object.keys(historicalCounts).map(function (label) {
      var counts = historicalCounts[label];
      var total = 0;
      series.forEach(function (s) { total += counts[s] || 0; });
      return { label: label, counts: counts, totalGoLives: total };
    }).sort(function (a, b) {
      return _fyYearFromLabel_(a.label) - _fyYearFromLabel_(b.label);
    });

    return {
      mode: dataset.mode,
      series: series,
      historicalFys: historicalFys,
      historicalIndustryCounts: historicalIndustryCounts,
      currentFyIndustryCounts: currentFyIndustryCounts,
      currentFyCounts: currentFyCounts,
      currentFyAccountKeysBySeries: currentFyAccountKeysBySeries,
      dedupedGoLiveCount: dedupedGoLiveCount
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC: getMomentumSnapshot
  // --------------------------------------------------------------------------

  /**
   * P2: Generates the Portfolio Momentum snapshot.
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

    var dataset = queryMomentumDataset(cfg);
    if (!dataset) return null;

    var momentum = cfg.momentum;
    var mode = dataset.mode;
    var series = dataset.series || [];
    var now = new Date();
    var currentFyInfo = _wyFyFromDate_(now);
    var currentFyLabel = currentFyInfo.label;
    var currentFyYear = currentFyInfo.fyYear;
    var half = _getHalf_(now);
    var periodView = momentum.periodView || 'historicalFyAndCurrentRunningTotal';
    var industryGrowthStrategy = momentum.industryGrowthStrategy || 'cagr';
    var previousFyLabel = 'FY' + String(currentFyYear - 1).slice(-2);
    var historicalYears = _parseHistoricalYears_(
      momentum.timeRange,
      momentum.historicalYears != null ? momentum.historicalYears : 5
    );

    if (!series.length) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: no series configured — empty snapshot.');
      return _buildEmptySnapshot_(cfg, [], currentFyLabel, mode);
    }

    if (!dataset.groups || !Object.keys(dataset.groups).length) {
      Logger.log('CorePortfolioMomentum.getMomentumSnapshot: no matching groups — empty snapshot.');
      var emptySnap = _buildEmptySnapshot_(cfg, series, currentFyLabel, mode);
      emptySnap.dataIntegrity = _buildDataIntegrity_(dataset.stats, 0);
      _momentumCache = emptySnap;
      return emptySnap;
    }

    var ctx = _buildMomentumContext_(dataset, historicalYears, currentFyLabel, currentFyYear);
    var growthRates = {};
    series.forEach(function (s) {
      growthRates[s] = calculateAnnualGrowthRate(ctx, s);
    });

    var fastestPlatform = series[0] || null;
    var highestRate = -Infinity;
    series.forEach(function (p) {
      var rate = growthRates[p] ? growthRates[p].avgYoyPct : 0;
      if (rate > highestRate) {
        highestRate = rate;
        fastestPlatform = p;
      }
    });

    var portfolioGrowthRate = calculateAnnualGrowthRate(ctx, null);
    var fastestGrowingIndustry = null;
    if (mode === 'product') {
      if (industryGrowthStrategy === 'currentVsPreviousFyDelta') {
        fastestGrowingIndustry = _calculateFastestGrowingIndustryByDelta_(
          ctx, currentFyLabel, previousFyLabel, series
        );
      } else {
        fastestGrowingIndustry = calculateFastestGrowingIndustry(ctx);
      }
    }
    if (mode === 'product') {
      Logger.log(
        'CorePortfolioMomentum.getMomentumSnapshot product KPI4: strategy=' +
        industryGrowthStrategy +
        ', fastestGrowingIndustry=' + JSON.stringify(fastestGrowingIndustry)
      );
    }

    var growthMetricSeries = momentum.growthMetricSeries ||
      (series.indexOf('HCM') >= 0 ? 'HCM' : series[0]);

    var fyStartDate = new Date(currentFyYear - 1, 1, 1);
    var fyEndDate = new Date(currentFyYear, 0, 31);
    var periodEndDate = (half === 'H1')
      ? new Date(currentFyYear - 1, 6, 31)
      : fyEndDate;
    var generatedAt = now.toISOString();
    var generatedDateLabel = _dateLabel_(now);
    var inProgressBadge = currentFyLabel + ' ' + half +
                          ' running total as of ' + generatedDateLabel;
    var chartPeriods = _buildChartPeriods_(
      dataset, currentFyYear, periodView, series, half);

    var snapshot = {
      appId: cfg.appId || '',
      mode: mode,
      periodView: periodView,
      industryGrowthStrategy: industryGrowthStrategy,
      previousFyLabel: previousFyLabel,
      generatedAt: generatedAt,
      generatedDateLabel: generatedDateLabel,
      currentFy: {
        label: currentFyLabel,
        isInProgress: true,
        inProgressLabel: half,
        inProgressBadge: inProgressBadge,
        startDate: _isoDate_(fyStartDate),
        endDate: _isoDate_(fyEndDate),
        periodEndDate: _isoDate_(periodEndDate),
        counts: ctx.currentFyCounts,
        distinctAccounts: calculateDistinctAccounts(ctx, null),
        totalGoLives: calculateGoLives(ctx, null)
      },
      historicalFys: ctx.historicalFys,
      chartPeriods: chartPeriods,
      growthRates: growthRates,
      fastestGrowingPlatform: fastestPlatform,
      fastestGrowingIndustry: fastestGrowingIndustry,
      portfolioGrowthRate: portfolioGrowthRate,
      growthMetricSeries: growthMetricSeries,
      platforms: series,
      chartLegend: momentum.chartLegend || series,
      kpiLabels: _resolveKpiLabels_(momentum.kpiLabels, currentFyLabel),
      chartColors: (momentum.chart && momentum.chart.colors) || {},
      inProgressOpacity: (momentum.chart && momentum.chart.inProgressOpacity != null)
        ? momentum.chart.inProgressOpacity : 0.55,
      dataIntegrity: _buildDataIntegrity_(dataset.stats, ctx.dedupedGoLiveCount)
    };

    var elapsed = Date.now() - startMs;
    var chartPeriodLabels = (chartPeriods || []).map(function (p) { return p.label; }).join(',');
    Logger.log(
      'CorePortfolioMomentum.getMomentumSnapshot: complete in ' + elapsed + 'ms.' +
      ' mode=' + mode +
      ', periodView=' + periodView +
      ', series=' + series.join(',') +
      ', chartPeriods=' + chartPeriodLabels +
      ', historicalFys=' + ctx.historicalFys.length +
      ', currentFy=' + currentFyLabel + ' ' + half
    );

    _momentumCache = snapshot;
    return snapshot;
  }

  // --------------------------------------------------------------------------
  // EXPORTS
  // --------------------------------------------------------------------------
  return {
    getMomentumSnapshot: getMomentumSnapshot,
    queryMomentumDataset: queryMomentumDataset,
    calculateGoLives: calculateGoLives,
    calculateDistinctAccounts: calculateDistinctAccounts,
    calculateAnnualGrowthRate: calculateAnnualGrowthRate,
    calculateFastestGrowingIndustry: calculateFastestGrowingIndustry
  };

})();
