/**
 * Serves the Upcoming Core Go-Lives web app (§10).
 * @param {Object} e Apps Script event object
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  Logger.log('doGet: serving SLED Upcoming Core Go-Lives');
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SLED Upcoming Core Go-Lives')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Includes an HTML partial for HtmlService templates.
 * @param {string} name File name without extension
 * @returns {string}
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Returns milestones in the 6-month window plus metadata for the client (§6).
 * @returns {{ today: string, fieldRegistry: Array<Object>, milestones: Array<Object>, pillOrder: string[] }}
 */
function getUpcomingGoLives() {
  Logger.log('getUpcomingGoLives: start');
  const cache = CacheService.getScriptCache();
  const cacheKey = 'upcomingGoLives_v2';
  const cached = cache.get(cacheKey);

  if (cached) {
    Logger.log('getUpcomingGoLives: returning cached payload');
    return JSON.parse(cached);
  }

  const today = getTodayIso_();
  const allMilestones = buildMilestones_();
  const milestones = filterMilestonesToWindow_(allMilestones);

  milestones.forEach(function(m) {
    m.countdownDays = daysBetweenIso_(today, m.goLiveDate);
  });

  const payload = {
    today: today,
    fieldRegistry: getPublicFieldRegistry_(),
    milestones: milestones,
    pillOrder: PILL_ORDER,
    defaultRange: DEFAULT_RANGE,
  };

  try {
    cache.put(cacheKey, JSON.stringify(payload), 300);
  } catch (err) {
    Logger.log('getUpcomingGoLives: cache put failed ' + err);
  }

  Logger.log('getUpcomingGoLives: returning ' + milestones.length + ' milestones');
  return payload;
}

/**
 * Days from startIso to endIso (end - start).
 * @param {string} startIso yyyy-MM-dd
 * @param {string} endIso yyyy-MM-dd
 * @returns {number}
 */
function daysBetweenIso_(startIso, endIso) {
  const start = parseIsoDate_(startIso);
  const end = parseIsoDate_(endIso);
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86400000);
}

/**
 * Parses yyyy-MM-dd to a Date at local midnight in script timezone.
 * @param {string} iso
 * @returns {Date|null}
 */
function parseIsoDate_(iso) {
  if (!iso) return null;
  const parts = String(iso).split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const date = new Date(y, m, d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Builds export column definitions for the Go-Lives sheet (§11).
 * @returns {Array<{ key: string, label: string, kind: string }>}
 */
function getExportColumns_() {
  const registryByKey = {};
  FIELD_REGISTRY.forEach(function(f) {
    if (f.export) registryByKey[f.key] = f;
  });

  const orderedKeys = [
    'goLiveDate', 'countdownDays',
    'customerName', 'deploymentName', 'industry',
    'coreProducts', 'deploymentType', 'isWorkdayDelivered',
    'csm', 'emdm', 'ae', 'implementationPartner', 'managingPartner',
    'region', 'subRegion',
    'deploymentContactsSummary',
  ];

  const kindMap = {
    goLiveDate: 'date',
    countdownDays: 'number',
    coreProducts: 'products',
    isWorkdayDelivered: 'yn',
    deploymentContactsSummary: 'text',
  };

  const labelMap = {
    goLiveDate: 'Go-Live Date',
    countdownDays: 'Countdown (days)',
    coreProducts: 'Core Products',
    deploymentType: 'Deployment Type',
    isWorkdayDelivered: 'Workday-Delivered (Y/N)',
    deploymentContactsSummary: 'Deployment Contacts',
  };

  return orderedKeys.map(function(key) {
    const reg = registryByKey[key];
    return {
      key: key,
      label: labelMap[key] || (reg ? reg.label : key),
      kind: kindMap[key] || (reg ? reg.type || 'text' : 'text'),
    };
  });
}

/**
 * Formats deployment contacts as a flattened summary string (§11).
 * @param {Array<{name:string,email:string,role:string}>} contacts
 * @returns {string}
 */
function formatContactsSummary_(contacts) {
  if (!contacts || !contacts.length) return '';
  return contacts.map(function(c) {
    const emailPart = c.email ? ' <' + c.email + '>' : '';
    const rolePart = c.role ? ' — ' + c.role : '';
    return (c.name || 'Unknown') + emailPart + rolePart;
  }).join('; ');
}

/**
 * Flattens a milestone row for export.
 * @param {Object} milestone
 * @param {string} todayIso
 * @returns {Object<string, *>}
 */
function flattenMilestoneForExport_(milestone, todayIso) {
  const kc = milestone.keyContacts || {};
  return {
    goLiveDate: milestone.goLiveDate,
    countdownDays: daysBetweenIso_(todayIso, milestone.goLiveDate),
    customerName: milestone.customerName,
    deploymentName: milestone.deploymentName || '',
    industry: milestone.industry,
    region: milestone.region,
    subRegion: milestone.subRegion,
    csm: kc.csm || '',
    emdm: kc.emdm || '',
    ae: kc.ae || '',
    implementationPartner: kc.implementationPartner || '',
    managingPartner: kc.managingPartner || '',
    coreProducts: (milestone.coreProducts || []).join(', '),
    deploymentType: milestone.deploymentType,
    isWorkdayDelivered: milestone.isWorkdayDelivered ? 'Y' : 'N',
    deploymentContactsSummary: formatContactsSummary_(milestone.deploymentContacts),
  };
}

/**
 * Writes a values array to a sheet using the single-array setValues pattern (§11).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<Array<*>>} values
 */
function writeSheetValues_(sheet, values) {
  const numCols = values[0].length;
  sheet.getRange(1, 1, values.length, numCols).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, numCols).setFontWeight('bold');
  for (let c = 1; c <= numCols; c++) {
    sheet.autoResizeColumn(c);
  }
}

/**
 * Exports the current view rows to XLSX and returns a base64 payload (§11).
 * @param {Array<Object>} rows Filtered milestone objects from the client
 * @returns {{ filename: string, b64: string }}
 */
function exportCurrentView(rows) {
  Logger.log('exportCurrentView: exporting ' + (rows ? rows.length : 0) + ' rows');
  if (!rows || !rows.length) {
    throw new Error('exportCurrentView: no rows to export');
  }

  const todayIso = getTodayIso_();
  const stampDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const ss = SpreadsheetApp.create('SLED Upcoming Go-Lives ' + stamp);

  // Sheet 1 — Go-Lives
  const goLivesSheet = ss.getSheets()[0];
  goLivesSheet.setName('Go-Lives');
  const columns = getExportColumns_();
  const headerRow = columns.map(function(c) { return c.label; });
  const dataRows = rows.map(function(milestone) {
    const flat = flattenMilestoneForExport_(milestone, todayIso);
    return columns.map(function(col) {
      const val = flat[col.key];
      if (col.kind === 'date' && val) return parseIsoDate_(val);
      return val !== null && val !== undefined ? val : '';
    });
  });
  const goLivesValues = [headerRow].concat(dataRows);
  writeSheetValues_(goLivesSheet, goLivesValues);

  // Sheet 2 — Contacts (one row per contact)
  const contactsSheet = ss.insertSheet('Contacts');
  const contactHeaders = ['Go-Live Date', 'Customer', 'Deployment Name', 'Contact Name', 'Contact Email', 'Contact Role'];
  const contactRows = [];
  rows.forEach(function(milestone) {
    const contacts = milestone.deploymentContacts || [];
    contacts.forEach(function(c) {
      contactRows.push([
        parseIsoDate_(milestone.goLiveDate),
        milestone.customerName || '',
        milestone.deploymentName || '',
        c.name || '',
        c.email || '',
        c.role || '',
      ]);
    });
  });
  const contactsValues = [contactHeaders].concat(contactRows);
  writeSheetValues_(contactsSheet, contactsValues);

  SpreadsheetApp.flush();

  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  let blob;
  try {
    blob = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    }).getBlob().setName('SLED_Upcoming_GoLives_' + stampDate + '.xlsx');
  } catch (err) {
    Logger.log('exportCurrentView: UrlFetchApp failed ' + err);
    DriveApp.getFileById(ss.getId()).setTrashed(true);
    throw err;
  }

  const filename = blob.getName();
  const b64 = Utilities.base64Encode(blob.getBytes());

  DriveApp.getFileById(ss.getId()).setTrashed(true);
  Logger.log('exportCurrentView: done, trashed temp sheet');

  return { filename: filename, b64: b64 };
}
