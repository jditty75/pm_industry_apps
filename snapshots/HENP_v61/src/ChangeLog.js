function initDeploymentHealthSnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheetName = 'ActiveDeployments';
  const snapshotName = 'DeploymentHealth_Snapshot';

  const srcSheet = ss.getSheetByName(srcSheetName);
  if (!srcSheet) throw new Error('Source sheet not found: ' + srcSheetName);

  let snapSheet = ss.getSheetByName(snapshotName);
  if (!snapSheet) {
    snapSheet = ss.insertSheet(snapshotName);
  } else {
    snapSheet.clear();
  }

  const lastRow = srcSheet.getLastRow();
  if (lastRow < 2) {
    snapSheet.getRange(1, 1, 1, 2).setValues([['DeploymentID', 'Health']]);
    return;
  }

  const HEALTH_COL = 8;   // D: Deployment Health
  const ID_COL     = 15;  // O: Deployment ID
  const numRows    = lastRow - 1;

  const healthVals = srcSheet.getRange(2, HEALTH_COL, numRows, 1).getValues();
  const idVals     = srcSheet.getRange(2, ID_COL,     numRows, 1).getValues();

  const out = [['DeploymentID', 'Health']];
  for (let i = 0; i < numRows; i++) {
    const id = String(idVals[i][0]).trim();
    if (!id) continue;
    out.push([id, healthVals[i][0]]);
  }

  snapSheet.getRange(1, 1, out.length, 2).setValues(out);
}

function diffDeploymentHealthAndLog() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheetName = 'ActiveDeployments';
  const snapshotName = 'DeploymentHealth_Snapshot';
  const logSheetName = 'ChangeLog';

  const srcSheet  = ss.getSheetByName(srcSheetName);
  const snapSheet = ss.getSheetByName(snapshotName);
  const logSheet  = ss.getSheetByName(logSheetName);

  if (!srcSheet)  throw new Error('Source sheet not found: ' + srcSheetName);
  if (!snapSheet) throw new Error('Snapshot sheet not found: ' + snapshotName + '. Run initDeploymentHealthSnapshot() first.');
  if (!logSheet)  throw new Error('Log sheet not found: ' + logSheetName);

  const lastRow = srcSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data in ActiveDeployments; nothing to diff.');
    return;
  }

  const HEALTH_COL = 8;   // D
  const ID_COL     = 15;  // O
  const ACCT_COL   = 1;   // A: Account Name
  const NAME_COL   = 2;   // B: Deployment Name

  const numRows = lastRow - 1;

  const healthVals = srcSheet.getRange(2, HEALTH_COL, numRows, 1).getValues();
  const idVals     = srcSheet.getRange(2, ID_COL,     numRows, 1).getValues();
  const acctVals   = srcSheet.getRange(2, ACCT_COL,   numRows, 1).getValues();
  const nameVals   = srcSheet.getRange(2, NAME_COL,   numRows, 1).getValues();

  // Current state: by DeploymentID
  const current = {};
  for (let i = 0; i < numRows; i++) {
    const id = String(idVals[i][0]).trim();
    if (!id) continue;
    current[id] = {
      health: healthVals[i][0],
      account: acctVals[i][0],
      name: nameVals[i][0]
    };
  }

  // Snapshot state
  const snapData = snapSheet.getDataRange().getValues(); // [ [DeploymentID, Health], ... ]
  const snapshot = {};
  for (let r = 1; r < snapData.length; r++) { // skip header
    const id = String(snapData[r][0]).trim();
    if (!id) continue;
    snapshot[id] = {
      health: snapData[r][1]
    };
  }

  const now      = new Date();
  const yearMonth = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  const source   = 'SalesforceConnector';
  const logRows  = [];

  // Compare
  Object.keys(current).forEach(function(id) {
    const curr = current[id];
    const prev = snapshot[id];

    const currHealth = String(curr.health);
    const prevHealth = prev ? String(prev.health) : '';

    if (prev && currHealth === prevHealth) {
      return; // no change
    }

    if (!prev && currHealth === '') {
      return; // new with empty health – ignore
    }

    logRows.push([
      now,           // Timestamp
      yearMonth,     // YearMonth
      source,        // Source
      id,            // DeploymentID
      curr.account,  // AccountName
      curr.name,     // DeploymentName
      prevHealth || 'N/A',   // OldHealth
      currHealth             // NewHealth
    ]);
  });

  if (logRows.length) {
    const startRow = logSheet.getLastRow() + 1;
    logSheet.getRange(startRow, 1, logRows.length, 8).setValues(logRows);
    Logger.log('Logged %s health changes to ChangeLog.', logRows.length);
  } else {
    Logger.log('No health changes detected.');
  }

  // Refresh snapshot
  refreshDeploymentHealthSnapshotFromCurrent_(snapshotName, current);
}

function refreshDeploymentHealthSnapshotFromCurrent_(snapshotName, currentMap) {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const snapSheet = ss.getSheetByName(snapshotName);
  if (!snapSheet) throw new Error('Snapshot sheet not found: ' + snapshotName);

  snapSheet.clear();

  const out = [['DeploymentID', 'Health']];
  Object.keys(currentMap).forEach(function(id) {
    out.push([id, currentMap[id].health]);
  });

  snapSheet.getRange(1, 1, out.length, 2).setValues(out);
}

/**
 * Rebuilds the HealthMonthlySummary sheet from ChangeLog.
 *
 * Expected ChangeLog columns:
 *  A: Timestamp (Date)
 *  B: YearMonth (YYYY-MM)
 *  C: Source
 *  D: DeploymentID
 *  E: AccountName
 *  F: DeploymentName
 *  G: OldHealth
 *  H: NewHealth
 *
 * Output HealthMonthlySummary columns:
 *  A: YearMonth
 *  B: Status  (e.g., "Green", "Yellow", "Red", "Total")
 *  C: Count
 *  D: Percent (share within that YearMonth)
 */
function recomputeHealthMonthlySummaryFromChangeLog_() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet    = ss.getSheetByName('ChangeLog');
  const summaryName = 'HealthMonthlySummary';

  if (!logSheet) {
    throw new Error('ChangeLog sheet not found.');
  }

  let summarySheet = ss.getSheetByName(summaryName);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(summaryName);
  } else {
    summarySheet.clear();
  }

  const data = logSheet.getDataRange().getValues();
  if (data.length < 2) {
    summarySheet.getRange(1, 1, 1, 4).setValues([['YearMonth', 'Status', 'Count', 'Percent']]);
    Logger.log('ChangeLog empty; HealthMonthlySummary initialized with headers only.');
    return;
  }

  // Column indices (0-based in the array)
  const COL_YEAR_MONTH = 1; // B
  const COL_DEPLOYMENT = 3; // D
  const COL_NEW_HEALTH = 7; // H

  // Map: { YearMonth: { DeploymentID: { lastTimestampIndex, health } } }
  const headers = data[0];
  const rows    = data.slice(1);

  const ymDepMap = {}; // {yearMonth: {deploymentId: {idx, status}}}

  rows.forEach(function(row, idx) {
    const ym   = String(row[COL_YEAR_MONTH]).trim();
    const depId = String(row[COL_DEPLOYMENT]).trim();
    const health = String(row[COL_NEW_HEALTH]).trim();

    if (!ym || !depId || !health) return;

    if (!ymDepMap[ym]) ymDepMap[ym] = {};
    // We just overwrite: if ChangeLog is chronological, last row wins for that month
    ymDepMap[ym][depId] = { idx: idx, status: health };
  });

  // Build summary rows: per YearMonth, per Status, plus Total
  const summaryRows = [];
  summaryRows.push(['YearMonth', 'Status', 'Count', 'Percent']);

  Object.keys(ymDepMap).sort().forEach(function(ym) {
    const depMap = ymDepMap[ym];
    const statusCounts = {}; // e.g. { Green: x, Yellow: y, Red: z }
    let totalCount = 0;

    Object.keys(depMap).forEach(function(depId) {
      const status = depMap[depId].status || '';
      if (!status) return;
      if (!statusCounts[status]) statusCounts[status] = 0;
      statusCounts[status]++;
      totalCount++;
    });

    // Output per status
    Object.keys(statusCounts).sort().forEach(function(status) {
      const count = statusCounts[status];
      const pct   = totalCount > 0 ? count / totalCount : 0;
      summaryRows.push([ym, status, count, pct]);
    });

    // Total row
    summaryRows.push([ym, 'Total', totalCount, totalCount > 0 ? 1 : 0]);
  });

  summarySheet.getRange(1, 1, summaryRows.length, 4).setValues(summaryRows);
  Logger.log('HealthMonthlySummary rebuilt with %s data rows.', summaryRows.length - 1);
}

/**
 * Rebuilds the HealthYtdSummary sheet from ChangeLog.
 *
 * Same ChangeLog assumptions as above.
 *
 * Output HealthYtdSummary columns:
 *  A: Year
 *  B: Status
 *  C: YtdCount
 *  D: YtdPercent (share within that year)
 */
function recomputeHealthYtdSummaryFromChangeLog_() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet    = ss.getSheetByName('ChangeLog');
  const summaryName = 'HealthYtdSummary';

  if (!logSheet) {
    throw new Error('ChangeLog sheet not found.');
  }

  let summarySheet = ss.getSheetByName(summaryName);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(summaryName);
  } else {
    summarySheet.clear();
  }

  const data = logSheet.getDataRange().getValues();
  if (data.length < 2) {
    summarySheet.getRange(1, 1, 1, 4).setValues([['Year', 'Status', 'YtdCount', 'YtdPercent']]);
    Logger.log('ChangeLog empty; HealthYtdSummary initialized with headers only.');
    return;
  }

  const COL_TIMESTAMP = 0; // A
  const COL_DEPLOYMENT = 3; // D
  const COL_NEW_HEALTH = 7; // H

  const headers = data[0];
  const rows    = data.slice(1);

  // Map: { Year: { DeploymentID: statusOfLastChangeThatYear } }
  const yearDepMap = {}; // { year: {deploymentId: status} }

  rows.forEach(function(row) {
    const ts     = row[COL_TIMESTAMP];
    const depId  = String(row[COL_DEPLOYMENT]).trim();
    const health = String(row[COL_NEW_HEALTH]).trim();

    if (!ts || !depId || !health) return;

    const year = (ts instanceof Date)
      ? ts.getFullYear()
      : Number(String(ts).slice(0,4)); // fallback if stored as text

    if (!year) return;

    if (!yearDepMap[year]) yearDepMap[year] = {};
    yearDepMap[year][depId] = health; // last one wins for that year
  });

  const summaryRows = [];
  summaryRows.push(['Year', 'Status', 'YtdCount', 'YtdPercent']);

  Object.keys(yearDepMap).sort().forEach(function(yearStr) {
    const depMap = yearDepMap[yearStr];
    const statusCounts = {};
    let totalCount = 0;

    Object.keys(depMap).forEach(function(depId) {
      const status = depMap[depId] || '';
      if (!status) return;
      if (!statusCounts[status]) statusCounts[status] = 0;
      statusCounts[status]++;
      totalCount++;
    });

    Object.keys(statusCounts).sort().forEach(function(status) {
      const count = statusCounts[status];
      const pct   = totalCount > 0 ? count / totalCount : 0;
      summaryRows.push([Number(yearStr), status, count, pct]);
    });

    summaryRows.push([Number(yearStr), 'Total', totalCount, totalCount > 0 ? 1 : 0]);
  });

  summarySheet.getRange(1, 1, summaryRows.length, 4).setValues(summaryRows);
  Logger.log('HealthYtdSummary rebuilt with %s data rows.', summaryRows.length - 1);
}
