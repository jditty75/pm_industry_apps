/**
 * CoreAnalytics.gs
 *
 * Shared analytics:
 * - Snapshot-based health analytics (ALL apps use this for Dashboard)
 * - Optional ChangeLog-based utilities (for history/debug)
 *
 * Snapshot path:
 * 1) updateSnapshotsFromActive(config)
 * 2) populateDashboardFromSnapshots(config)
 * 3) update(config) runs both (used before building HTML/report)
 */
var CoreAnalytics = (function () {

  // --- SNAPSHOT-BASED ANALYTICS (primary path) -------------------------------

  /**
   * Computes the current Green/Red/Yellow/Total counts from the
   * EFFECTIVE deployment health (ActiveDeployments + DeploymentOverrides)
   * and saves them as a snapshot row set for the given reportMonth
   * (first of month).
   *
   * Sheet: config.sheets.healthReportSnapshots (e.g. "HealthReportSnapshots")
   * Columns:
   *  A: ReportMonth (date)
   *  B: Status ("Green","Red","Yellow","Total")
   *  C: Count
   *  D: Percent (0–1)
   *
   * @param {AppConfig} config
   */
  function updateSnapshotsFromActive(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var snapName = cfg.sheets.healthReportSnapshots;

    // Determine canonical reportMonth = first of this month in script timezone
    var now = new Date();
    var tz  = Session.getScriptTimeZone();
    var year       = Number(Utilities.formatDate(now, tz, 'yyyy'));
    var monthIndex = Number(Utilities.formatDate(now, tz, 'M')) - 1; // 0-based
    var reportMonth = new Date(year, monthIndex, 1);

    // Use EFFECTIVE deployments (ActiveDeployments + DeploymentOverrides + Meta)
    var allEffective = CoreData.getAllEffectiveDeployments(cfg);

    var green = 0, red = 0, yellow = 0;
    allEffective.forEach(function (row) {
      var h = String(row.health || '').trim();
      if (h === 'Green')  green++;
      else if (h === 'Red')    red++;
      else if (h === 'Yellow') yellow++;
    });

    var total = green + red + yellow;
    var pct = function (v) {
      return total > 0 ? v / total : 0;
    };

    // Snapshot sheet
    var snapSheet = ss.getSheetByName(snapName);
    if (!snapSheet) {
      snapSheet = ss.insertSheet(snapName);
      snapSheet.getRange('A1:D1')
        .setValues([['ReportMonth', 'Status', 'Count', 'Percent']]);
    }

    var lastSnapRow = snapSheet.getLastRow();
    var data = [];
    if (lastSnapRow > 1) {
      data = snapSheet.getRange(2, 1, lastSnapRow - 1, 4).getValues();
    }

    // Keep all other months; remove any rows for this same month/year
    var keep = [];
    data.forEach(function (row) {
      var d = row[0];
      if (!CoreUtils.sameMonthYear(d, reportMonth)) {
        keep.push(row);
      }
    });

    if (lastSnapRow > 1) {
      snapSheet.getRange(2, 1, lastSnapRow - 1, 4).clearContent();
    }
    if (keep.length) {
      snapSheet.getRange(2, 1, keep.length, 4).setValues(keep);
    }

    // Always write a full set of statuses for this month
    var newRows = [
      [reportMonth, 'Green',  green,  pct(green)],
      [reportMonth, 'Red',    red,    pct(red)],
      [reportMonth, 'Yellow', yellow, pct(yellow)],
      [reportMonth, 'Total',  total,  1]
    ];
    var startRow = snapSheet.getLastRow() + 1;
    snapSheet.getRange(startRow, 1, newRows.length, 4).setValues(newRows);

    var ymLabel = Utilities.formatDate(reportMonth, tz, 'yyyy-MM-01');
    Logger.log('HealthReportSnapshots (effective health) updated for ' + ymLabel);
  }

  /**
   * Populates Dashboard!HealthTotal using HealthReportSnapshots:
   *
   * - B/C: Current Month Count / Percent (from latest snapshot, override-aware)
   * - E/F: Prev Month Count / Percent (from snapshot history)
   * - I:   YTD Count (all months in current year)
   * - J:   Prev YTD Count (all months in current year except current month)
   *
   * A–C come from the sheet/QUERY and are overwritten for B/C
   * with snapshot-based effective values.
   *
   * @param {AppConfig} config
   */
  function populateDashboardFromSnapshots(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var dashSheet   = ss.getSheetByName(cfg.sheets.dashboard);
    var healthRange = ss.getRangeByName(cfg.namedRanges.healthTotal);

    if (!dashSheet || !healthRange) {
      Logger.log('Dashboard or HealthTotal named range not found; skipping populate.');
      return;
    }

    var snapSheet = ss.getSheetByName(cfg.sheets.healthReportSnapshots);
    if (!snapSheet) {
      Logger.log(cfg.sheets.healthReportSnapshots + ' sheet not found.');
      return;
    }
    var snapLastRow = snapSheet.getLastRow();
    if (snapLastRow <= 1) {
      Logger.log(cfg.sheets.healthReportSnapshots + ' has no data.');
      return;
    }

    var snapData = snapSheet
      .getRange(2, 1, snapLastRow - 1, 4)
      .getValues(); // [ReportMonth, Status, Count, Percent]

    var tz = Session.getScriptTimeZone();
    var byMonth   = {}; // { 'yyyy-MM': { Status: {count,pct} } }
    var ytdByYear = {}; // { '2026': { Status: totalCount } }

    snapData.forEach(function (row) {
      var dt     = row[0];
      var status = String(row[1] || '').trim();
      var count  = Number(row[2] || 0);
      var pct    = Number(row[3] || 0);
      if (!dt || !status) return;

      var ymKey   = Utilities.formatDate(new Date(dt), tz, 'yyyy-MM');
      var yearKey = Utilities.formatDate(new Date(dt), tz, 'yyyy');

      if (!byMonth[ymKey]) byMonth[ymKey] = {};
      byMonth[ymKey][status] = { count: count, pct: pct };

      if (!ytdByYear[yearKey]) ytdByYear[yearKey] = {};
      if (!ytdByYear[yearKey][status]) ytdByYear[yearKey][status] = 0;
      ytdByYear[yearKey][status] += count;
    });

    var ymList = Object.keys(byMonth).sort();
    if (!ymList.length) {
      Logger.log('No months found in ' + cfg.sheets.healthReportSnapshots + '.');
      return;
    }

    var currentYM = ymList[ymList.length - 1];
    var prevYM    = ymList.length >= 2 ? ymList[ymList.length - 2] : null;

    var yearList = Object.keys(ytdByYear)
      .map(function (y) { return Number(y); })
      .sort(function (a, b) { return a - b; });
    var currentYear = yearList.length ? String(yearList[yearList.length - 1]) : null;

    var healthValues = healthRange.getValues();
    var numRows      = healthValues.length;
    if (!numRows) return;

    var bcValues = []; // B/C: current month Count / Percent
    var efValues = []; // E/F: prev month Count / Percent
    var ijValues = []; // I/J: YTD Count / Prev YTD Count

    for (var r = 0; r < numRows; r++) {
      var row = healthValues[r];

      if (r === 0) {
        // Header row: keep B/C/E/F/I/J as-is
        bcValues.push([row[1], row[2]]);
        efValues.push([row[4], row[5]]);
        ijValues.push([row[8], row[9]]);
        continue;
      }

      var status = String(row[0] || '').trim() || 'Total';

      // --- Current Month Count / Percent (B/C) ---
      var curCount = row[1];
      var curPct   = row[2];
      if (byMonth[currentYM] && byMonth[currentYM][status]) {
        curCount = byMonth[currentYM][status].count;
        curPct   = byMonth[currentYM][status].pct;
      } else if (status === 'Total' &&
                 byMonth[currentYM] && byMonth[currentYM]['Total']) {
        curCount = byMonth[currentYM]['Total'].count;
        curPct   = byMonth[currentYM]['Total'].pct;
      }

      // --- Prev Month Count / Percent (E/F) ---
      var prevCount   = row[4];
      var prevPct     = row[5];
      var ytdCount    = row[8];
      var prevYtdCount= row[9];

      if (prevYM && byMonth[prevYM] && byMonth[prevYM][status]) {
        prevCount = byMonth[prevYM][status].count;
        prevPct   = byMonth[prevYM][status].pct;
      } else if (prevYM && status === 'Total' &&
                 byMonth[prevYM] && byMonth[prevYM]['Total']) {
        prevCount = byMonth[prevYM]['Total'].count;
        prevPct   = byMonth[prevYM]['Total'].pct;
      }

      // --- YTD Count (I) and Prev YTD Count (J) ---
      if (currentYear && ytdByYear[currentYear]) {
        var totalYtdForStatus;
        if (typeof ytdByYear[currentYear][status] === 'number') {
          totalYtdForStatus = ytdByYear[currentYear][status];
        } else if (status === 'Total' &&
                   typeof ytdByYear[currentYear]['Total'] === 'number') {
          totalYtdForStatus = ytdByYear[currentYear]['Total'];
        }

        if (typeof totalYtdForStatus === 'number') {
          ytdCount = totalYtdForStatus;

          // Current month count (for this status)
          var currentMonthCount = 0;
          if (byMonth[currentYM]) {
            if (byMonth[currentYM][status]) {
              currentMonthCount = byMonth[currentYM][status].count;
            } else if (status === 'Total' && byMonth[currentYM]['Total']) {
              currentMonthCount = byMonth[currentYM]['Total'].count;
            }
          }
          prevYtdCount = totalYtdForStatus - currentMonthCount;
          if (prevYtdCount < 0) prevYtdCount = 0;
        }
      }

      bcValues.push([curCount, curPct]);
      efValues.push([prevCount, prevPct]);
      ijValues.push([ytdCount, prevYtdCount]);
    }

    var startRow = healthRange.getRow();
    var startCol = healthRange.getColumn();

    // B & C: current month (columns 2 & 3)
    dashSheet
      .getRange(startRow, startCol + 1, numRows, 2)
      .setValues(bcValues);

    // E & F: prev month (columns 5 & 6)
    dashSheet
      .getRange(startRow, startCol + 4, numRows, 2)
      .setValues(efValues);

    // I & J: YTD and Prev YTD (columns 9 & 10)
    dashSheet
      .getRange(startRow, startCol + 8, numRows, 2)
      .setValues(ijValues);

    Logger.log(
      'Dashboard!HealthTotal B/C/E/F/I/J updated from ' +
      cfg.sheets.healthReportSnapshots +
      ' (effective health, YTD & Prev YTD in same year).'
    );
  }

  /**
   * Master pipeline: snapshot-based analytics used by ALL apps
   * before building HTML reports or previews.
   *
   * @param {AppConfig} config
   */
  function update(config) {
    updateSnapshotsFromActive(config);
    populateDashboardFromSnapshots(config);
  }

  // --- OPTIONAL: CHANGELOG HELPERS (history/debug) ---------------------------

  /**
   * Initialize DeploymentHealth_Snapshot from current ActiveDeployments.
   *
   * @param {AppConfig} config
   */
  function initDeploymentHealthSnapshot(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var srcSheetName = cfg.sheets.activeDeployments;
    var snapshotName = 'DeploymentHealth_Snapshot'; // historical utility

    var srcSheet = ss.getSheetByName(srcSheetName);
    if (!srcSheet) throw new Error('Source sheet not found: ' + srcSheetName);

    var snapSheet = ss.getSheetByName(snapshotName);
    if (!snapSheet) {
      snapSheet = ss.insertSheet(snapshotName);
    } else {
      snapSheet.clear();
    }

    var lastRow = srcSheet.getLastRow();
    if (lastRow < 2) {
      snapSheet.getRange(1, 1, 1, 2).setValues([['DeploymentID', 'Health']]);
      return;
    }

    var HEALTH_COL = cfg.columns.deployments.DEPLOYMENT_HEALTH;
    var ID_COL     = cfg.columns.deployments.DEPLOYMENT_ID;
    var numRows    = lastRow - 1;

    var healthVals = srcSheet.getRange(2, HEALTH_COL, numRows, 1).getValues();
    var idVals     = srcSheet.getRange(2, ID_COL,    numRows, 1).getValues();

    var out = [['DeploymentID', 'Health']];
    for (var i = 0; i < numRows; i++) {
      var id = String(idVals[i][0]).trim();
      if (!id) continue;
      out.push([id, healthVals[i][0]]);
    }
    snapSheet.getRange(1, 1, out.length, 2).setValues(out);
  }

  /**
   * Diff current ActiveDeployments vs DeploymentHealth_Snapshot and log changes
   * into ChangeLog. Useful for keeping a historical log of health transitions.
   *
   * @param {AppConfig} config
   */
  function diffDeploymentHealthAndLog(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var srcSheetName = cfg.sheets.activeDeployments;
    var snapshotName = 'DeploymentHealth_Snapshot';
    var logSheetName = cfg.sheets.changeLog;

    var srcSheet  = ss.getSheetByName(srcSheetName);
    var snapSheet = ss.getSheetByName(snapshotName);
    var logSheet  = ss.getSheetByName(logSheetName);

    if (!srcSheet) throw new Error('Source sheet not found: ' + srcSheetName);
    if (!snapSheet) throw new Error('Snapshot sheet not found: ' + snapshotName + '. Run initDeploymentHealthSnapshot() first.');
    if (!logSheet) throw new Error('Log sheet not found: ' + logSheetName);

    var lastRow = srcSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('No data in ' + srcSheetName + '; nothing to diff.');
      return;
    }

    var HEALTH_COL = cfg.columns.deployments.DEPLOYMENT_HEALTH;
    var ID_COL     = cfg.columns.deployments.DEPLOYMENT_ID;
    var ACCT_COL   = cfg.columns.deployments.ACCOUNT_NAME;
    var NAME_COL   = cfg.columns.deployments.DEPLOYMENT_NAME;
    var numRows    = lastRow - 1;

    var healthVals = srcSheet.getRange(2, HEALTH_COL, numRows, 1).getValues();
    var idVals     = srcSheet.getRange(2, ID_COL,    numRows, 1).getValues();
    var acctVals   = srcSheet.getRange(2, ACCT_COL,  numRows, 1).getValues();
    var nameVals   = srcSheet.getRange(2, NAME_COL,  numRows, 1).getValues();

    var current = {};
    for (var i = 0; i < numRows; i++) {
      var id = String(idVals[i][0]).trim();
      if (!id) continue;
      current[id] = {
        health:  healthVals[i][0],
        account: acctVals[i][0],
        name:    nameVals[i][0]
      };
    }

    var snapData = snapSheet.getDataRange().getValues(); // [ [DeploymentID, Health], ... ]
    var snapshot = {};
    for (var r = 1; r < snapData.length; r++) {
      var sid = String(snapData[r][0]).trim();
      if (!sid) continue;
      snapshot[sid] = { health: snapData[r][1] };
    }

    var now = new Date();
    var yearMonth = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
    var source = 'SalesforceConnector';
    var logRows = [];

    Object.keys(current).forEach(function (id) {
      var curr = current[id];
      var prev = snapshot[id];

      var currHealth = String(curr.health);
      var prevHealth = prev ? String(prev.health) : '';

      if (prev && currHealth === prevHealth) return;
      if (!prev && currHealth === '') return;

      logRows.push([
        now,         // Timestamp
        yearMonth,   // YearMonth
        source,      // Source
        id,          // DeploymentID
        curr.account,// AccountName
        curr.name,   // DeploymentName
        prevHealth || 'N/A', // OldHealth
        currHealth           // NewHealth
      ]);
    });

    if (logRows.length) {
      var startRow = logSheet.getLastRow() + 1;
      logSheet.getRange(startRow, 1, logRows.length, 8).setValues(logRows);
      Logger.log('Logged %s health changes to %s.', logRows.length, logSheetName);
    } else {
      Logger.log('No health changes detected.');
    }

    refreshDeploymentHealthSnapshotFromCurrent_(config, snapshotName, current);
  }

  /**
   * Helper to refresh DeploymentHealth_Snapshot from a currentMap.
   *
   * @param {AppConfig} config
   * @param {string} snapshotName
   * @param {Object<string,{health:any}>} currentMap
   */
  function refreshDeploymentHealthSnapshotFromCurrent_(config, snapshotName, currentMap) {
    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var snapSheet = ss.getSheetByName(snapshotName);
    if (!snapSheet) throw new Error('Snapshot sheet not found: ' + snapshotName);

    snapSheet.clear();
    var out = [['DeploymentID', 'Health']];
    Object.keys(currentMap).forEach(function (id) {
      out.push([id, currentMap[id].health]);
    });
    snapSheet.getRange(1, 1, out.length, 2).setValues(out);
  }

  /**
   * Rebuilds the HealthMonthlySummary sheet from ChangeLog.
   * (Utility only; dashboard uses snapshot-based analytics.)
   *
   * @param {AppConfig} config
   */
  function recomputeHealthMonthlySummaryFromChangeLog(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName(cfg.sheets.changeLog);
    var summaryName = cfg.sheets.healthMonthlySummary;

    if (!logSheet) throw new Error('ChangeLog sheet not found.');

    var summarySheet = ss.getSheetByName(summaryName);
    if (!summarySheet) {
      summarySheet = ss.insertSheet(summaryName);
    } else {
      summarySheet.clear();
    }

    var data = logSheet.getDataRange().getValues();
    if (data.length < 2) {
      summarySheet.getRange(1, 1, 1, 4)
        .setValues([['YearMonth', 'Status', 'Count', 'Percent']]);
      Logger.log('ChangeLog empty; ' + summaryName + ' initialized with headers only.');
      return;
    }

    var COL_YEAR_MONTH = 1; // B
    var COL_DEPLOYMENT = 3; // D
    var COL_NEW_HEALTH = 7; // H

    var rows = data.slice(1);
    var ymDepMap = {}; // {yearMonth: {deploymentId: {idx,status}}}

    rows.forEach(function (row, idx) {
      var ym     = String(row[COL_YEAR_MONTH]).trim();
      var depId  = String(row[COL_DEPLOYMENT]).trim();
      var health = String(row[COL_NEW_HEALTH]).trim();
      if (!ym || !depId || !health) return;
      if (!ymDepMap[ym]) ymDepMap[ym] = {};
      ymDepMap[ym][depId] = { idx: idx, status: health };
    });

    var summaryRows = [['YearMonth', 'Status', 'Count', 'Percent']];
    Object.keys(ymDepMap).sort().forEach(function (ym) {
      var depMap = ymDepMap[ym];
      var statusCounts = {};
      var totalCount   = 0;

      Object.keys(depMap).forEach(function (depId) {
        var status = depMap[depId].status || '';
        if (!status) return;
        if (!statusCounts[status]) statusCounts[status] = 0;
        statusCounts[status]++;
        totalCount++;
      });

      Object.keys(statusCounts).sort().forEach(function (status) {
        var count = statusCounts[status];
        var pct   = totalCount > 0 ? count / totalCount : 0;
        summaryRows.push([ym, status, count, pct]);
      });
      summaryRows.push([ym, 'Total', totalCount, totalCount > 0 ? 1 : 0]);
    });

    summarySheet.getRange(1, 1, summaryRows.length, 4).setValues(summaryRows);
    Logger.log(summaryName + ' rebuilt with %s data rows.', summaryRows.length - 1);
  }

  /**
   * Rebuilds the HealthYtdSummary sheet from ChangeLog.
   * (Utility only; dashboard uses snapshot-based analytics.)
   *
   * @param {AppConfig} config
   */
  function recomputeHealthYtdSummaryFromChangeLog(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName(cfg.sheets.changeLog);
    var summaryName = cfg.sheets.healthYtdSummary;

    if (!logSheet) throw new Error('ChangeLog sheet not found.');

    var summarySheet = ss.getSheetByName(summaryName);
    if (!summarySheet) {
      summarySheet = ss.insertSheet(summaryName);
    } else {
      summarySheet.clear();
    }

    var data = logSheet.getDataRange().getValues();
    if (data.length < 2) {
      summarySheet.getRange(1, 1, 1, 4)
        .setValues([['Year', 'Status', 'YtdCount', 'YtdPercent']]);
      Logger.log('ChangeLog empty; ' + summaryName + ' initialized with headers only.');
      return;
    }

    var COL_TIMESTAMP  = 0; // A
    var COL_DEPLOYMENT = 3; // D
    var COL_NEW_HEALTH = 7; // H

    var rows = data.slice(1);
    var yearDepMap = {}; // {year: {deploymentId: status}}

    rows.forEach(function (row) {
      var ts     = row[COL_TIMESTAMP];
      var depId  = String(row[COL_DEPLOYMENT]).trim();
      var health = String(row[COL_NEW_HEALTH]).trim();
      if (!ts || !depId || !health) return;

      var year = (ts instanceof Date)
        ? ts.getFullYear()
        : Number(String(ts).slice(0, 4));
      if (!year) return;

      if (!yearDepMap[year]) yearDepMap[year] = {};
      yearDepMap[year][depId] = health; // last one that year wins
    });

    var summaryRows = [['Year', 'Status', 'YtdCount', 'YtdPercent']];
    Object.keys(yearDepMap).sort().forEach(function (yearStr) {
      var depMap = yearDepMap[yearStr];
      var statusCounts = {};
      var totalCount   = 0;

      Object.keys(depMap).forEach(function (depId) {
        var status = depMap[depId] || '';
        if (!status) return;
        if (!statusCounts[status]) statusCounts[status] = 0;
        statusCounts[status]++;
        totalCount++;
      });

      Object.keys(statusCounts).sort().forEach(function (status) {
        var count = statusCounts[status];
        var pct   = totalCount > 0 ? count / totalCount : 0;
        summaryRows.push([Number(yearStr), status, count, pct]);
      });
      summaryRows.push([Number(yearStr), 'Total', totalCount, totalCount > 0 ? 1 : 0]);
    });

    summarySheet.getRange(1, 1, summaryRows.length, 4).setValues(summaryRows);
    Logger.log(summaryName + ' rebuilt with %s data rows.', summaryRows.length - 1);
  }

  // --- PHASE 3b: CODE-SIDE BREAKDOWNS ----------------------------------------

  /**
   * Reads the HealthReportSnapshots sheet and returns a map keyed by 'yyyy-MM'.
   * Each value is a sub-map { Green:{count,pct}, Red:{count,pct}, Yellow:{count,pct}, Total:{count,pct} }.
   * @private
   */
  function readHealthSnapshots_(cfg) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(cfg.sheets.healthReportSnapshots);
    if (!sheet) return {};
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var tz = Session.getScriptTimeZone();
    var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var byMonth = {};
    values.forEach(function (row) {
      var dt = row[0];
      if (!dt) return;
      var dtObj = (dt instanceof Date) ? dt : new Date(dt);
      if (isNaN(dtObj.getTime())) return;
      var status = String(row[1] || '').trim();
      if (!status) return;
      var ym = Utilities.formatDate(dtObj, tz, 'yyyy-MM');
      if (!byMonth[ym]) byMonth[ym] = {};
      byMonth[ym][status] = { count: Number(row[2] || 0), pct: Number(row[3] || 0) };
    });
    return byMonth;
  }

  /**
   * Formats a 'yyyy-MM' key as 'Mon yyyy' (e.g. 'Jun 2026').
   * @private
   */
  function formatMonthLabel_(ym) {
    if (!ym) return '';
    var parts = ym.split('-');
    if (parts.length !== 2) return ym;
    var month = parseInt(parts[1], 10) - 1;
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return (MONTHS[month] || '') + ' ' + parts[0];
  }

  /**
   * Computes a trend indicator for a given status and relative-change delta.
   * Interpretation A (health-direction quality):
   *   Green  → up = good (▲), down = bad (▼)
   *   Red/Yellow → up = bad (▼), down = good (▲)
   * @private
   */
  function buildTrend_(status, delta) {
    if (Math.abs(delta) < 0.000001) {
      return { arrow: '\u25CF', label: '0.0%', polarity: 'flat' };
    }
    var sign = delta > 0 ? '+' : '-';
    var label = sign + (Math.abs(delta) * 100).toFixed(1) + '%';
    var arrow, polarity;
    if (status === 'Green') {
      arrow    = delta > 0 ? '\u25B2' : '\u25BC';
      polarity = delta > 0 ? 'good'   : 'bad';
    } else {
      // Red / Yellow: share going up is a bad health signal
      arrow    = delta > 0 ? '\u25BC' : '\u25B2';
      polarity = delta > 0 ? 'bad'    : 'good';
    }
    return { arrow: arrow, label: label, polarity: polarity };
  }

  /**
   * Phase 3b: returns Health Breakdown (Green/Red/Yellow) computed from
   * effective deployments and historical snapshots, replacing Dashboard reads.
   *
   * Return shape:
   *   {
   *     rows: [{ status, color, currentCount, currentPct, momTrend, ytdTrend }],
   *     asOfMonth: 'yyyy-MM',
   *     baselineMonth: 'yyyy-MM',
   *     baselineMonthLabel: 'Mon yyyy',
   *     dataIntegrity: { expectedTotal, reconciledTotal, blankCount, showDisclaimer }
   *   }
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function getHealthBreakdown(config) {
    var cfg = CoreConfig.withDefaults(config);
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var currentYM   = Utilities.formatDate(now, tz, 'yyyy-MM');
    var currentYear = Utilities.formatDate(now, tz, 'yyyy');

    // Current counts from effective deployments
    var allEffective = CoreData.getAllEffectiveDeployments(cfg);
    var expectedTotal = allEffective.length;
    var counts = { Green: 0, Red: 0, Yellow: 0 };
    allEffective.forEach(function (row) {
      var h = String(row.health || '').trim();
      if (counts[h] !== undefined) counts[h]++;
    });
    var reconciledTotal = counts.Green + counts.Red + counts.Yellow;
    var denom = reconciledTotal;
    var currentPcts = {
      Green:  denom > 0 ? counts.Green  / denom : 0,
      Red:    denom > 0 ? counts.Red    / denom : 0,
      Yellow: denom > 0 ? counts.Yellow / denom : 0
    };

    // Historical snapshots for MoM / YTD trend
    var snapData     = readHealthSnapshots_(cfg);
    var sortedMonths = Object.keys(snapData).sort();

    // Previous month key (the snapshot month immediately before currentYM)
    var prevYM = null;
    var currentIdx = sortedMonths.indexOf(currentYM);
    if (currentIdx > 0) {
      prevYM = sortedMonths[currentIdx - 1];
    } else if (currentIdx === -1 && sortedMonths.length > 0) {
      prevYM = sortedMonths[sortedMonths.length - 1];
    }

    // YTD: snapshot months within the current calendar year
    var ytdMonths = sortedMonths.filter(function (ym) {
      return ym.substring(0, 4) === currentYear;
    });
    var baselineMonth = ytdMonths.length > 0 ? ytdMonths[0] : null;

    var STATUS_ORDER = ['Green', 'Red', 'Yellow'];
    var COLORS = { Green: '#4CAF50', Red: '#F44336', Yellow: '#FBBC04' };

    var rows = STATUS_ORDER.map(function (status) {
      var currentPct = currentPcts[status];

      // MoM trend
      var momTrend;
      var prevSnap = prevYM && snapData[prevYM] && snapData[prevYM][status];
      if (!prevSnap || prevSnap.pct === 0) {
        momTrend = { arrow: '\u25CF', label: '0.0%', polarity: 'flat' };
      } else {
        momTrend = buildTrend_(status, (currentPct - prevSnap.pct) / prevSnap.pct);
      }

      // YTD trend
      var ytdTrend;
      if (ytdMonths.length < 2) {
        ytdTrend = { arrow: '\u25CF', label: '0.0%', polarity: 'flat' };
      } else {
        var firstSnap = snapData[ytdMonths[0]] && snapData[ytdMonths[0]][status];
        var lastSnap  = snapData[ytdMonths[ytdMonths.length - 1]] && snapData[ytdMonths[ytdMonths.length - 1]][status];
        var firstPct  = firstSnap ? firstSnap.pct : 0;
        var lastPct   = lastSnap  ? lastSnap.pct  : 0;
        ytdTrend = (firstPct === 0)
          ? { arrow: '\u25CF', label: '0.0%', polarity: 'flat' }
          : buildTrend_(status, (lastPct - firstPct) / firstPct);
      }

      return {
        status:       status,
        color:        COLORS[status],
        currentCount: counts[status],
        currentPct:   currentPct,
        momTrend:     momTrend,
        ytdTrend:     ytdTrend
      };
    });

    return {
      rows:               rows,
      asOfMonth:          currentYM,
      baselineMonth:      baselineMonth || currentYM,
      baselineMonthLabel: formatMonthLabel_(baselineMonth || currentYM),
      dataIntegrity: {
        expectedTotal:   expectedTotal,
        reconciledTotal: reconciledTotal,
        blankCount:      expectedTotal - reconciledTotal,
        showDisclaimer:  (expectedTotal - reconciledTotal) > 0
      }
    };
  }

  /**
   * Phase 3b: returns Partner Breakdown grouped by the partner field
   * (Deployment_Partner_Name__c) from effective deployments.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function getPartnerBreakdown(config) {
    var cfg = CoreConfig.withDefaults(config);
    var rows = CoreData.getAllEffectiveDeployments(cfg);
    var totalDeployments = rows.length;

    var partnerCounts = {};
    var unassignedCount = 0;
    rows.forEach(function (row) {
      var partner = String(row.partner || '').trim();
      if (!partner) {
        unassignedCount++;
      } else {
        partnerCounts[partner] = (partnerCounts[partner] || 0) + 1;
      }
    });

    var resultRows = Object.keys(partnerCounts).map(function (p) {
      return {
        partner: p,
        count:   partnerCounts[p],
        pct:     totalDeployments > 0 ? partnerCounts[p] / totalDeployments : 0
      };
    }).sort(function (a, b) { return b.count - a.count; });

    if (unassignedCount > 0) {
      resultRows.push({
        partner: '(Unassigned)',
        count:   unassignedCount,
        pct:     totalDeployments > 0 ? unassignedCount / totalDeployments : 0
      });
    }

    return {
      rows:             resultRows,
      totalDeployments: totalDeployments,
      dataIntegrity: {
        unassignedCount: unassignedCount,
        showDisclaimer:  unassignedCount > 0
      }
    };
  }

  /**
   * Phase 3b: returns Services Approach Breakdown grouped by the
   * servicesApproach field (SERVICES_APPROACH or DEPLOYMENT_PHASE column)
   * from effective deployments.
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function getApproachBreakdown(config) {
    var cfg = CoreConfig.withDefaults(config);
    var rows = CoreData.getAllEffectiveDeployments(cfg);
    var totalDeployments = rows.length;

    var approachCounts = {};
    var unassignedCount = 0;
    rows.forEach(function (row) {
      var approach = String(row.servicesApproach || '').trim();
      if (!approach) {
        unassignedCount++;
      } else {
        approachCounts[approach] = (approachCounts[approach] || 0) + 1;
      }
    });

    var resultRows = Object.keys(approachCounts).map(function (a) {
      return {
        approach: a,
        count:    approachCounts[a],
        pct:      totalDeployments > 0 ? approachCounts[a] / totalDeployments : 0
      };
    }).sort(function (a, b) { return b.count - a.count; });

    if (unassignedCount > 0) {
      resultRows.push({
        approach: '(Unassigned)',
        count:    unassignedCount,
        pct:      totalDeployments > 0 ? unassignedCount / totalDeployments : 0
      });
    }

    return {
      rows:             resultRows,
      totalDeployments: totalDeployments,
      dataIntegrity: {
        unassignedCount: unassignedCount,
        showDisclaimer:  unassignedCount > 0
      }
    };
  }

  /**
   * Phase 3b: diagnostic cross-check — logs code-computed breakdown values.
   * Run via Apps Script editor to verify Phase 3b migration output.
   *
   * @param {AppConfig} config
   */
  function _validatePhase3b(config) {
    Logger.log('_validatePhase3b: === Phase 3b Validation ===');
    try {
      var h = getHealthBreakdown(config);
      Logger.log('_validatePhase3b: Health — asOfMonth=' + h.asOfMonth +
        ', baseline=' + h.baselineMonth + ' (' + h.baselineMonthLabel + ')');
      h.rows.forEach(function (row) {
        Logger.log('_validatePhase3b:   ' + row.status +
          ': count=' + row.currentCount +
          ', pct=' + (row.currentPct * 100).toFixed(2) + '%' +
          ', MoM=' + row.momTrend.arrow + ' ' + row.momTrend.label +
          ' (' + row.momTrend.polarity + ')' +
          ', YTD=' + row.ytdTrend.arrow + ' ' + row.ytdTrend.label +
          ' (' + row.ytdTrend.polarity + ')');
      });
      var di = h.dataIntegrity;
      Logger.log('_validatePhase3b: Health DataIntegrity — expected=' + di.expectedTotal +
        ', reconciled=' + di.reconciledTotal + ', blank=' + di.blankCount +
        ', showDisclaimer=' + di.showDisclaimer);
    } catch (err) {
      Logger.log('_validatePhase3b: getHealthBreakdown failed: ' + err);
    }

    try {
      var p = getPartnerBreakdown(config);
      Logger.log('_validatePhase3b: Partner — totalDeployments=' + p.totalDeployments);
      p.rows.forEach(function (row) {
        Logger.log('_validatePhase3b:   ' + row.partner + ': count=' + row.count +
          ', pct=' + (row.pct * 100).toFixed(2) + '%');
      });
    } catch (err) {
      Logger.log('_validatePhase3b: getPartnerBreakdown failed: ' + err);
    }

    try {
      var a = getApproachBreakdown(config);
      Logger.log('_validatePhase3b: Approach — totalDeployments=' + a.totalDeployments);
      a.rows.forEach(function (row) {
        Logger.log('_validatePhase3b:   ' + row.approach + ': count=' + row.count +
          ', pct=' + (row.pct * 100).toFixed(2) + '%');
      });
    } catch (err) {
      Logger.log('_validatePhase3b: getApproachBreakdown failed: ' + err);
    }

    Logger.log('_validatePhase3b: EXPECTED diffs vs. Dashboard sheet:' +
      ' arrow polarity (Phase 3b correction),' +
      ' label format (relative % not absolute count),' +
      ' approach source column (DEPLOYMENT_PHASE alias fix).');
    Logger.log('_validatePhase3b: === End ===');
  }

  // --- EXPORTS ---------------------------------------------------------------

  return {
    // primary pipeline
    update:                    update,
    updateSnapshotsFromActive: updateSnapshotsFromActive,
    populateDashboardFromSnapshots: populateDashboardFromSnapshots,

    // Phase 3b: Code-side breakdown functions
    getHealthBreakdown:   getHealthBreakdown,
    getPartnerBreakdown:  getPartnerBreakdown,
    getApproachBreakdown: getApproachBreakdown,
    _validatePhase3b:     _validatePhase3b,

    // optional ChangeLog utilities
    initDeploymentHealthSnapshot:            initDeploymentHealthSnapshot,
    diffDeploymentHealthAndLog:              diffDeploymentHealthAndLog,
    recomputeHealthMonthlySummaryFromChangeLog: recomputeHealthMonthlySummaryFromChangeLog,
    recomputeHealthYtdSummaryFromChangeLog:  recomputeHealthYtdSummaryFromChangeLog
  };

})();