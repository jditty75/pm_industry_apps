function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Healthcare Wellness Tools')
    .addItem('Export WPS Deployment Health HTML', 'exportWpsDeploymentHealthHtml')
    .addItem('Send Agenda (Gmail)', 'sendAgendaEmail')
    .addItem('Send Agenda Reminder', 'sendAgendaReminderEmail')
    .addSeparator()
    .addItem('Close Meeting', 'closeMeetingFromMenu')
    .addToUi();
}

/***********************************
 * Healthcare Wellness Leadership Agenda Web App
 * Code.gs
 ***********************************/

/**
 * Entry point for the web app.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Healthcare Wellness Leadership Agenda')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Utility to include HTML partials in templates:
 *   <?!= include('SomePartial'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Read Agenda sheet and return items sorted by Agenda Order.
 * Columns:
 *  A: Agenda Order
 *  B: Source
 *  C: Account
 *  D: ID
 *  E: Lead
 *  F: Current State
 *  G: Desired Outcome
 *  H: Future State
 *  I: Health/CSAT Status
 *  J: User
 */
function getAgendaItemsOrdered_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Agenda');
  if (!sheet) throw new Error('Agenda sheet not found');

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  const headers = data[0];
  const rows = data.slice(1);

  const orderIdx = headers.indexOf('Agenda Order');
  const sourceIdx = headers.indexOf('Source');
  const accountIdx = headers.indexOf('Account');
  const idIdx = headers.indexOf('ID');
  const leadIdx = headers.indexOf('Lead');
  const currIdx = headers.indexOf('Current State');
  const desiredIdx = headers.indexOf('Desired Outcome');
  const futureIdx = headers.indexOf('Future State');
  const healthIdx = headers.indexOf('Health/CSAT Status');
  const userIdx = headers.indexOf('User');

  const items = rows.map(r => ({
    agendaOrder: Number(r[orderIdx] || 0),
    source: r[sourceIdx] || '',
    account: r[accountIdx] || '',
    id: r[idIdx] || '',
    lead: r[leadIdx] || '',
    currentState: r[currIdx] || '',
    desiredOutcome: r[desiredIdx] || '',
    futureState: r[futureIdx] || '',
    healthStatus: r[healthIdx] || '',
    user: r[userIdx] || ''
  }));

  // Sort by Agenda Order (ascending), then by account as a tiebreaker
  items.sort((a, b) => {
    const ao = (a.agendaOrder || 0) - (b.agendaOrder || 0);
    if (ao !== 0) return ao;
    return String(a.account || '').localeCompare(String(b.account || ''));
  });

  return items;
}

/**
 * Generic helper: returns rows as array of objects keyed by header row.
 */
function getSheetData_(sheetName) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[String(h)] = row[i];
    });
    return obj;
  });
}

function debugCsatHeaders() {
  const rows = getSheetData_('CSAT_SOQL');
  if (!rows.length) {
    Logger.log('No rows found in CSAT_SOQL');
    return;
  }
  const first = rows[0];
  Logger.log('First CSAT row keys: ' + Object.keys(first).join(', '));
  Logger.log('First CSAT row values: ' + JSON.stringify(first, null, 2));
}

/**
 * Strip HTML tags from a string (used for Deployment_Name__c).
 */
function stripHtml_(htmlValue) {
  if (htmlValue == null) return '';
  const s = String(htmlValue);
  return s.replace(/<[^>]*>/g, '');
}

function parseCsmName_(raw) {
  if (!raw) return '';
  const s = String(raw);
  const m = s.match(/Name=([^,}]+)/);
  return m ? m[1].trim() : '';
}

/**
 * Read a key/value setting from the "Settings" sheet (Column A = key, Column B = value).
 * Returns the trimmed string value, or '' if the sheet/key is missing.
 */
function getSetting_(key) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return '';
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(key).trim()) {
      return String(values[i][1] == null ? '' : values[i][1]).trim();
    }
  }
  return '';
}

/**
 * Write or update a key/value setting on the Settings sheet.
 * @param {string} key
 * @param {string} value
 */
function setSetting_(key, value) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) throw new Error('Settings sheet not found');

  var values = sheet.getDataRange().getValues();
  var keyStr = String(key).trim();
  var valStr = value == null ? '' : String(value);

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === keyStr) {
      sheet.getRange(i + 1, 2).setValue(valStr);
      return;
    }
  }

  sheet.appendRow([keyStr, valStr]);
}

/**
 * Build a lookup map from sheet rows keyed by Id column.
 * @param {Array<Object>} rows
 * @param {string} idCol
 * @return {Object<string, Object>}
 */
function buildIdLookup_(rows, idCol) {
  var lookup = {};
  (rows || []).forEach(function (r) {
    var id = String(r[idCol] || '');
    if (id) lookup[id] = r;
  });
  return lookup;
}

/**
 * Default label for agenda items no longer in the live DEPLOYMENT/CSAT feed.
 * @return {string}
 */
function getResolvedChipLabel_() {
  return getSetting_('Resolved Chip Label') || 'Improved â€” Now Green';
}

/**
 * Apply read-time live overlay for DEPLOYMENT/CSAT agenda items.
 * Preserves Lead, Current State, Desired Outcome, Future State from snapshot.
 * @param {Array<Object>} items
 * @return {Array<Object>}
 */
function applyLiveOverlayToAgendaItems_(items) {
  var depLookup = buildIdLookup_(getSheetData_('Deployments_SOQL'), 'Id');
  var csatLookup = buildIdLookup_(getSheetData_('CSAT_SOQL'), 'Id');
  var resolvedLabel = getResolvedChipLabel_();

  return (items || []).map(function (item) {
    var copy = {
      agendaOrder: item.agendaOrder,
      source: item.source,
      account: item.account,
      id: item.id,
      lead: item.lead,
      currentState: item.currentState,
      desiredOutcome: item.desiredOutcome,
      futureState: item.futureState,
      healthStatus: item.healthStatus,
      user: item.user,
      resolved: false
    };

    var src = String(item.source || '').toUpperCase();
    var id = String(item.id || '');

    if (src === 'DEPLOYMENT') {
      var dep = depLookup[id];
      if (dep) {
        copy.healthStatus = String(dep['Overall_Health__c'] || '');
        var acct = dep['Customer_name__c'] || item.account || '';
        var partner = String(dep['Deployment_Partner_Name__c'] || '').trim();
        var summary = String(dep['Deployment_Summary__c'] || '').trim();
        if (partner) copy.partner = partner;
        if (summary) copy.sourceSummary = summary;
        copy.account = partner
          ? (acct ? acct + ' \u00b7 ' + partner : partner)
          : acct;
      } else {
        copy.healthStatus = resolvedLabel;
        copy.resolved = true;
      }
    } else if (src === 'CSAT') {
      var csat = csatLookup[id];
      if (csat) {
        copy.healthStatus = String(csat['Overall_Health_Status__c'] || '');
        copy.account = csat['Account__r.Name'] || item.account || '';
        var csatSummary = String(
          csat['Summary_of_Issues__c'] || csat['Wellness_Update__c'] || ''
        ).trim();
        if (csatSummary) copy.sourceSummary = csatSummary;
      } else {
        copy.healthStatus = resolvedLabel;
        copy.resolved = true;
      }
    }

    return copy;
  });
}

/**
 * Suggested next step for the meeting lifecycle state machine.
 * @param {string} status
 * @param {string} meetingDate
 * @param {string} agendaSentAt
 * @param {string} reminderSentAt
 * @return {string}
 */
function getSuggestedNextStep_(status, meetingDate, agendaSentAt, reminderSentAt) {
  var s = String(status || 'OPEN').toUpperCase();
  if (s === 'CLOSED') {
    return 'Set the next Meeting Date in Admin to start a new cycle.';
  }
  if (!meetingDate) {
    return 'Set the Meeting Date in Admin.';
  }
  if (s === 'OPEN' && !agendaSentAt) {
    return 'Build the agenda, then send it from Admin when ready.';
  }
  if (s === 'AGENDA_SENT' || agendaSentAt) {
    return 'After the meeting, close and archive from Admin.';
  }
  if (!reminderSentAt) {
    return 'Send a reminder from Admin if submissions are still needed.';
  }
  return 'Review agenda items and send the agenda when ready.';
}

/**
 * Return meeting lifecycle state for the admin panel and stale nudge.
 * @return {Object}
 */
function getMeetingState() {
  var status = getSetting_('Meeting Status') || 'OPEN';
  var meetingDate = getSetting_('Meeting Date');
  var reminderDate = getSetting_('Reminder Date');
  var deliveryDate = getSetting_('Delivery Date');
  var reminderSentAt = getSetting_('Reminder Sent At');
  var agendaSentAt = getSetting_('Agenda Sent At');
  var staleDays = parseInt(getSetting_('Stale Meeting Days') || '10', 10);
  if (isNaN(staleDays) || staleDays < 0) staleDays = 10;

  var staleMeeting = false;
  if (String(status).toUpperCase() !== 'CLOSED' && meetingDate) {
    var md = new Date(meetingDate);
    if (!isNaN(md.getTime())) {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      md.setHours(0, 0, 0, 0);
      var diffDays = (today.getTime() - md.getTime()) / (1000 * 60 * 60 * 24);
      staleMeeting = diffDays > staleDays;
    }
  }

  var meetingDateLocked = !!(meetingDate && String(status).toUpperCase() !== 'CLOSED');

  return {
    status: String(status).toUpperCase() || 'OPEN',
    meetingDate: meetingDate,
    reminderDate: reminderDate,
    deliveryDate: deliveryDate,
    reminderSentAt: reminderSentAt,
    agendaSentAt: agendaSentAt,
    staleMeeting: staleMeeting,
    meetingDateLocked: meetingDateLocked,
    suggestedNextStep: getSuggestedNextStep_(status, meetingDate, agendaSentAt, reminderSentAt),
    staleMeetingDays: staleDays
  };
}

/**
 * Persist editable meeting dates from the admin panel.
 * @param {{meetingDate?:string,reminderDate?:string,deliveryDate?:string}} payload
 * @return {Object}
 */
function saveMeetingDates(payload) {
  if (!payload) throw new Error('Missing payload');

  var state = getMeetingState();
  var nextMeetingDate = payload.meetingDate !== undefined
    ? String(payload.meetingDate || '').trim()
    : state.meetingDate;

  if (payload.meetingDate !== undefined) {
    if (state.meetingDateLocked && nextMeetingDate !== state.meetingDate) {
      throw new Error('Meeting Date is locked until the meeting is closed.');
    }

    if (nextMeetingDate && String(state.status).toUpperCase() === 'CLOSED') {
      setSetting_('Meeting Status', 'OPEN');
      setSetting_('Agenda Sent At', '');
      setSetting_('Reminder Sent At', '');
      setSetting_('Closeout Reminder Sent At', '');
    }

    setSetting_('Meeting Date', nextMeetingDate);
  }

  if (payload.reminderDate !== undefined) {
    setSetting_('Reminder Date', String(payload.reminderDate || '').trim());
  }
  if (payload.deliveryDate !== undefined) {
    setSetting_('Delivery Date', String(payload.deliveryDate || '').trim());
  }

  return getMeetingState();
}

/**
 * Whether a Meeting Date already exists in Agenda Archive.
 * @param {string} meetingDate
 * @return {boolean}
 */
function isMeetingDateArchived_(meetingDate) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Agenda Archive');
  if (!sheet || sheet.getLastRow() < 2) return false;

  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var meetingIdx = headers.indexOf('Meeting Date');
  if (meetingIdx < 0) meetingIdx = 1;

  var target = String(meetingDate || '').trim();
  for (var i = 1; i < values.length; i++) {
    var cell = values[i][meetingIdx];
    var cellStr = cell instanceof Date
      ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(cell || '').trim();
    if (cellStr === target) return true;
  }
  return false;
}

/**
 * Append rows to an archive sheet and verify the write succeeded.
 * @param {string} sheetName
 * @param {Array<Array<*>>} rows
 */
function appendAndVerifyArchive_(sheetName, rows) {
  if (!rows || !rows.length) return;

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(sheetName + ' sheet not found. Create it before closing a meeting.');
  }

  var before = sheet.getLastRow();
  var numRows = rows.length;
  var numCols = rows[0].length;
  sheet.getRange(before + 1, 1, numRows, numCols).setValues(rows);
  SpreadsheetApp.flush();

  if (sheet.getLastRow() !== before + numRows) {
    throw new Error('Archive write verification failed for ' + sheetName + '. Clear aborted.');
  }
}

/**
 * Clear a sheet to headers only (row 1 preserved).
 * @param {string} sheetName
 */
function clearSheetToHeaders_(sheetName) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

/**
 * Preview data for close-meeting confirmation dialogs.
 * @return {{meetingDate:string,itemCount:number}}
 */
function getCloseMeetingPreview() {
  var meetingDate = getSetting_('Meeting Date');
  var items = applyLiveOverlayToAgendaItems_(getAgendaItemsOrdered_());
  return {
    meetingDate: meetingDate || '(not set)',
    itemCount: items.length
  };
}

/**
 * Archive the current meeting, verify writes, then clear working sheets.
 * @return {{success:boolean,meetingDate:string,itemCount:number}}
 */
function closeMeetingAndArchive() {
  var meetingDate = getSetting_('Meeting Date');
  if (!meetingDate) {
    throw new Error('Meeting Date is not set. Set it in Admin before closing.');
  }

  if (isMeetingDateArchived_(meetingDate)) {
    throw new Error(
      'Meeting Date ' + meetingDate + ' has already been archived. Close aborted.'
    );
  }

  var items = applyLiveOverlayToAgendaItems_(getAgendaItemsOrdered_());
  var kpis = getAgendaKpis_();
  var archivedDate = new Date();

  var agendaArchiveRows = items.map(function (item) {
    return [
      archivedDate,
      meetingDate,
      item.agendaOrder || '',
      item.source || '',
      item.account || '',
      item.id || '',
      item.lead || '',
      item.currentState || '',
      item.desiredOutcome || '',
      item.futureState || '',
      item.healthStatus || '',
      item.user || ''
    ];
  });

  if (agendaArchiveRows.length) {
    appendAndVerifyArchive_('Agenda Archive', agendaArchiveRows);
  }

  appendAndVerifyArchive_('KPI Archive', [[
    meetingDate,
    kpis.depRed,
    kpis.depYellow,
    kpis.csatUnfav,
    kpis.csatNeutral,
    archivedDate
  ]]);

  clearSheetToHeaders_('Agenda');
  clearSheetToHeaders_('Deployment Selections');
  clearSheetToHeaders_('CSAT Selections');

  setSetting_('Meeting Status', 'CLOSED');
  setSetting_('Agenda Sent At', '');
  setSetting_('Reminder Sent At', '');

  Logger.log('closeMeetingAndArchive: archived ' + items.length + ' items for ' + meetingDate);

  return {
    success: true,
    meetingDate: meetingDate,
    itemCount: items.length
  };
}

/**
 * Close meeting from the spreadsheet menu with confirmation.
 */
function closeMeetingFromMenu() {
  var preview = getCloseMeetingPreview();
  if (!preview.meetingDate || preview.meetingDate === '(not set)') {
    SpreadsheetApp.getUi().alert('Meeting Date is not set. Set it in the web app Admin panel first.');
    return;
  }

  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'Close Meeting',
    'Archive Meeting Date ' + preview.meetingDate + ' (' + preview.itemCount + ' agenda items)?\n\n' +
    'This is irreversible: agenda and selection sheets will be cleared after archiving.',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  try {
    var result = closeMeetingAndArchive();
    ui.alert(
      'Meeting closed.',
      'Archived ' + result.itemCount + ' items for ' + result.meetingDate + '.',
      ui.ButtonSet.OK
    );
  } catch (e) {
    Logger.log('closeMeetingFromMenu: ' + e.message);
    ui.alert('Close failed: ' + e.message);
  }
}

/**
 * Daily trigger: send closeout email once per stale cycle.
 */
function checkStaleMeetingDaily_() {
  var status = String(getSetting_('Meeting Status') || 'OPEN').toUpperCase();
  if (status === 'CLOSED') return;

  var meetingDate = getSetting_('Meeting Date');
  if (!meetingDate) return;

  var state = getMeetingState();
  if (!state.staleMeeting) return;

  if (getSetting_('Closeout Reminder Sent At')) return;

  sendMeetingCloseoutReminder();
  setSetting_(
    'Closeout Reminder Sent At',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );
}

/**
 * Resolve the set of quarters used to filter the Qualtrics "Detractor Tracker".
 * Source of truth: Settings sheet, key "Qualtrix Quarters" (comma-separated, e.g. "Q1,Q2").
 * Falls back to DEFAULT_QUALTRIX_QUARTERS if unset/blank.
 * Values are normalized (trimmed + uppercased).
 */
var DEFAULT_QUALTRIX_QUARTERS = 'Q1';

function getQualtrixQuarters_() {
  var raw = getSetting_('Qualtrix Quarters');
  if (!raw) raw = DEFAULT_QUALTRIX_QUARTERS;
  var set = {};
  raw.split(',').forEach(function (q) {
    var norm = String(q).trim().toUpperCase();
    if (norm) set[norm] = true;
  });
  return set;
}

/**
 * Read Qualtrics items from an external Google Sheet.
 * URL: https://docs.google.com/spreadsheets/d/1VyC60G5qVYT_ALVzVMh1LCQvS-7jcmDXc85gh2XpAKI/edit?gid=1274570197#gid=1274570197
 * Sheet: "Detractor Tracker"
 * Filter: Column A is one of the quarters in the Settings sheet ("Qualtrix Quarters"), default "Q1".
 */
function getQualtrixItems_() {
  const url = 'https://docs.google.com/spreadsheets/d/1VyC60G5qVYT_ALVzVMh1LCQvS-7jcmDXc85gh2XpAKI/edit#gid=1274570197';
  const ss = SpreadsheetApp.openByUrl(url);
  const sheet = ss.getSheetByName('Detractor Tracker');
  if (!sheet) throw new Error('Detractor Tracker sheet not found in Qualtrix workbook');

  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const quarterSet = getQualtrixQuarters_();

  const rows = values.slice(1);
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const quarter = String(row[0] || '').trim().toUpperCase(); // Column A, normalized
    if (!quarterSet[quarter]) continue;

    const colB = row[1];  // B
    const colC = row[2];  // C
    const colF = row[5];  // F
    const colI = row[8];  // I
    const colJ = row[9];  // J
    const colK = row[10]; // K
    const colM = row[12]; // M

    const rowNumber = i + 2;
    const id = 'QUALTRIX-' + rowNumber;

    items.push({
      source: 'QUALTRIX',
      id: id,
      account: colB || '',
      detail: colF || '',
      colC: colC || '',
      colI: colI || '',
      colJ: colJ || '',
      colK: colK || '',
      colM: colM || ''
    });
  }

  return items;
}

/**
 * Read existing agenda rows and enrich them with user info from
 * Deployment Selections (User column) for deployment items.
 */
function getExistingAgendaSelections_() {
  const rows = getSheetData_('Agenda');

  let depUsersById = {};
  try {
    const depSelRows = getSheetData_('Deployment Selections');
    depSelRows.forEach(r => {
      const id = r['ID'] || r['Id'] || '';
      if (id) {
        const user = r['User'] || r['Reviewer Name'] || '';
        if (user) depUsersById[id] = user;
      }
    });
  } catch (e) {}

  return rows.map(r => {
    const source = r['Source'] || '';
    const id = r['ID'] || '';

    const base = {
      source: source,
      id: id,
      account: r['Account'] || '',
      lead: r['Lead'] || '',
      currentState: r['Current State'] || '',
      desiredOutcome: r['Desired Outcome'] || '',
      futureState: r['Future State'] || '',
      healthStatus: r['Health/CSAT Status'] || '',
      user: r['User'] || ''
    };

    if (source.toUpperCase() === 'DEPLOYMENT' && id && depUsersById[id] && !base.user) {
      base.user = depUsersById[id];
    }

    return base;
  });
}

function getWowBudgetItems_() {
  const rows = getSheetData_('WoW');
  if (!rows || rows.length === 0) return [];

  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const project = r['Project'] || '';
    const owner = r['Project Owner'] || '';
    const director = r['Delivery Director Sponsor'] || '';
    const pct = r['PCT'] || '';
    const concern = String(r['Wellness - Budget Concern'] || '');
    const investFlag = String(r['Wellness - Investment'] || '');
    const adjBacHrs = r['Adjusted BAC to EAC HRS'] || '';
    const adjBacPct = r['Adjusted BAC to EAC %'] || '';

    let category = null;
    if (concern === 'EAC>105% of BAC') {
      category = 'OVER_BUDGET';
    } else if (concern === 'NA') {
      category = 'RED_INVESTMENT';
    }
    if (!category) continue;

    const id = project || ('WOW-' + (i + 1));

    items.push({
      source: 'BUDGET_EAC',
      id: id,
      project: project,
      projectOwner: owner,
      deliveryDirector: director,
      pct: pct,
      category: category,
      adjustedBacToEacHrs: adjBacHrs,
      adjustedBacToEacPct: adjBacPct,
      wellnessBudgetConcern: concern,
      wellnessInvestment: investFlag
    });
  }

  return items;
}

function getInitialAgendaData() {
  const deployments = getSheetData_('Deployments_SOQL');
  const csatsRaw = getSheetData_('CSAT_SOQL');
  const qualtrixItems = getQualtrixItems_();
  const agendaSelections = getExistingAgendaSelections_();
  const wowBudgetItems = getWowBudgetItems_();

  const deploymentItems = deployments.map(r => {
    const health = String(r['Overall_Health__c'] || '');
    return {
      source: 'DEPLOYMENT',
      id: r['Id'] || '',
      account: r['Customer_name__c'] || '',
      title: stripHtml_(r['Deployment_Name__c']),
      healthStatus: health,
      summary: r['Deployment_Summary__c'] || '',
      partner: r['Deployment_Partner_Name__c'] || ''
    };
  });

  const csatItems = csatsRaw.map(r => {
    const health = String(r['Overall_Health_Status__c'] || '');

    let csmName = '';
    if (r['Plan_Owner__r.Name']) {
      csmName = String(r['Plan_Owner__r.Name']).trim();
    } else {
      const rawCsm =
        r['CSM__c'] ||
        r['CSM'] ||
        r['Account__r.Customer_Success_Manager__r'] ||
        '';
      csmName = parseCsmName_(rawCsm);
    }

    const highRisk = String(r['High_Risk_Flag__c'] || '');

    return {
      source: 'CSAT',
      id: r['Id'] || '',
      account: r['Account__r.Name'] || '',
      healthStatus: health,
      wellnessUpdate: r['Wellness_Update__c'] || '',
      summaryOfIssues: r['Summary_of_Issues__c'] || '',
      csm: csmName,
      highRiskFlag: highRisk
    };
  });

  return {
    deployments: deploymentItems,
    csats: csatItems,
    qualtrix: qualtrixItems,
    wow: wowBudgetItems,
    agendaSelections: agendaSelections
  };
}

/**
 * Write final agenda rows to the Agenda sheet.
 *
 * Columns:
 * A: Agenda Order
 * B: Source
 * C: Account
 * D: ID
 * E: Lead
 * F: Current State
 * G: Desired Outcome
 * H: Future State
 * I: Health/CSAT Status
 * J: User
 */
function writeAgenda_(agendaItems) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Agenda');
  if (!sheet) throw new Error('Agenda sheet not found');

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  if (!agendaItems || agendaItems.length === 0) {
    return { rowsWritten: 0 };
  }

  const values = agendaItems.map((item, idx) => ([
    idx + 1,
    item.source || '',
    item.account || '',
    item.id || '',
    item.lead || '',
    item.currentState || '',
    item.desiredOutcome || '',
    item.futureState || '',
    item.healthStatus || '',
    item.user || ''
  ]));

  sheet.getRange(2, 1, values.length, values[0].length).setValues(values);
  return { rowsWritten: values.length };
}

/**
 * Save:
 * - Deployment selections into "Deployment Selections"
 * - CSAT selections into "CSAT Selections"
 * - Combined selections + manual items into "Agenda"
 */
function saveSelectionsAndAgenda(payload) {
  if (!payload) throw new Error('Missing payload');

  const reviewerName = payload.reviewerName || '';
  const reviewerEmail = Session.getActiveUser().getEmail() || '';
  const activeUser = reviewerEmail || reviewerName;
  const now = new Date();

  const deploymentSelections = payload.deploymentSelections || [];
  const csatSelections = payload.csatSelections || [];
  const manualItems = payload.manualItems || [];

  const ss = SpreadsheetApp.getActive();

  // 1) Deployment Selections
  const depSheet = ss.getSheetByName('Deployment Selections');
  if (!depSheet) throw new Error('Deployment Selections sheet not found');

  if (deploymentSelections.length > 0) {
    const depRows = deploymentSelections.map(sel => ([
      now,
      reviewerEmail,
      reviewerName,
      sel.id || '',
      sel.account || '',
      sel.deploymentName || '',
      sel.lead || '',
      sel.currentState || '',
      sel.desiredOutcome || '',
      sel.futureState || '',
      activeUser
    ]));

    depSheet.insertRowsAfter(depSheet.getLastRow() || 1, depRows.length);
    depSheet
      .getRange(
        depSheet.getLastRow() - depRows.length + 1,
        1,
        depRows.length,
        depRows[0].length
      )
      .setValues(depRows);
  }

  // 2) CSAT Selections
  const csatSheet = ss.getSheetByName('CSAT Selections');
  if (!csatSheet) throw new Error('CSAT Selections sheet not found');

  if (csatSelections.length > 0) {
    const csatRows = csatSelections.map(sel => ([
      now,
      reviewerEmail,
      reviewerName,
      sel.id || '',
      sel.account || '',
      sel.csatIndicator || sel.healthStatus || '',
      sel.lead || '',
      sel.currentState || '',
      sel.desiredOutcome || '',
      sel.futureState || ''
    ]));

    csatSheet.insertRowsAfter(csatSheet.getLastRow() || 1, csatRows.length);
    csatSheet
      .getRange(
        csatSheet.getLastRow() - csatRows.length + 1,
        1,
        csatRows.length,
        csatRows[0].length
      )
      .setValues(csatRows);
  }

  // 3) Build Agenda items from selections + manualItems
  const agendaItems = [];

  // Deployments -> Agenda
  deploymentSelections.forEach(sel => {
    agendaItems.push({
      source: 'DEPLOYMENT',
      id: sel.id || '',
      account: sel.account || '',
      lead: sel.lead || '',
      currentState: sel.currentState || '',
      desiredOutcome: sel.desiredOutcome || '',
      futureState: sel.futureState || '',
      healthStatus: sel.healthStatus || '',
      user: activeUser
    });
  });

  // CSAT -> Agenda
  csatSelections.forEach(sel => {
    const status = sel.healthStatus || sel.csatIndicator || '';
    agendaItems.push({
      source: 'CSAT',
      id: sel.id || '',
      account: sel.account || '',
      lead: sel.lead || '',
      currentState: sel.currentState || '',
      desiredOutcome: sel.desiredOutcome || '',
      futureState: sel.futureState || '',
      healthStatus: status,
      highRiskFlag: sel.highRiskFlag || '',
      user: activeUser
    });
  });

  // Manual items -> Agenda (topicSource provided by client)
  manualItems.forEach(m => {
    if (m.account || m.currentState || m.desiredOutcome || m.futureState) {
      const topicSource = m.topicSource || 'MANUAL';
      agendaItems.push({
        source: topicSource,
        id: m.id || '',
        account: m.account || '',
        lead: m.lead || '',
        currentState: m.currentState || '',
        desiredOutcome: m.desiredOutcome || '',
        futureState: m.futureState || '',
        healthStatus: '',
        user: activeUser
      });
    }
  });

  const agendaResult = writeAgenda_(agendaItems);

  return {
    deploymentSelectionCount: deploymentSelections.length,
    csatSelectionCount: csatSelections.length,
    manualItemCount: manualItems.length,
    agendaRowsWritten: agendaResult.rowsWritten
  };
}

/**
 * Upsert (insert or update) a single agenda item row.
 */
function upsertAgendaItem(item) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Agenda');
  if (!sheet) throw new Error('Agenda sheet not found');

  const activeUser = Session.getActiveUser().getEmail() || item.user || '';

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    const rowIndex = 2;
    sheet.getRange(rowIndex, 1, 1, 10).setValues([[
      1,
      item.source || '',
      item.account || '',
      item.id || '',
      item.lead || '',
      item.currentState || '',
      item.desiredOutcome || '',
      item.futureState || '',
      item.healthStatus || '',
      activeUser
    ]]);
    return { rowIndex: rowIndex };
  }

  const headers = data[0];
  const rows = data.slice(1);
  const sourceIdx = headers.indexOf('Source');
  const idIdx = headers.indexOf('ID');
  const orderIdx = headers.indexOf('Agenda Order');

  let foundRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const src = r[sourceIdx] || '';
    const rid = r[idIdx] || '';
    if (
      String(src).toUpperCase() === String(item.source || '').toUpperCase() &&
      String(rid) === String(item.id || '')
    ) {
      foundRow = i + 2;
      break;
    }
  }

  if (foundRow === -1) {
    const lastRow = sheet.getLastRow();
    const newOrder = (lastRow > 1) ? (lastRow - 1 + 1) : 1;
    const rowIndex = lastRow + 1;
    sheet.getRange(rowIndex, 1, 1, 10).setValues([[
      newOrder,
      item.source || '',
      item.account || '',
      item.id || '',
      item.lead || '',
      item.currentState || '',
      item.desiredOutcome || '',
      item.futureState || '',
      item.healthStatus || '',
      activeUser
    ]]);
  } else {
    const rowValues = sheet.getRange(foundRow, 1, 1, 10).getValues()[0];
    const existingOrder = (orderIdx >= 0) ? rowValues[orderIdx] : (foundRow - 1);
    sheet.getRange(foundRow, 1, 1, 10).setValues([[
      existingOrder,
      item.source || '',
      item.account || '',
      item.id || '',
      item.lead || '',
      item.currentState || '',
      item.desiredOutcome || '',
      item.futureState || '',
      item.healthStatus || '',
      activeUser
    ]]);
  }

  renumberAgenda_();
  return { success: true };
}

/**
 * Remove a single agenda item row by (source, id).
 */
function removeAgendaItem(source, id) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Agenda');
  if (!sheet) throw new Error('Agenda sheet not found');

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { removed: false };

  const headers = data[0];
  const rows = data.slice(1);
  const sourceIdx = headers.indexOf('Source');
  const idIdx = headers.indexOf('ID');

  let deleteRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const src = r[sourceIdx] || '';
    const rid = r[idIdx] || '';
    if (
      String(src).toUpperCase() === String(source || '').toUpperCase() &&
      String(rid) === String(id || '')
    ) {
      deleteRow = i + 2;
      break;
    }
  }

  if (deleteRow !== -1) {
    sheet.deleteRow(deleteRow);
    renumberAgenda_();
    return { removed: true };
  }

  return { removed: false };
}

/**
 * Return agenda items for the reorder panel, sorted by five-group order.
 * @return {Array<{source:string,id:string,account:string,group:string,groupLabel:string}>}
 */
function getReorderAgendaData() {
  const items = getAgendaItemsOrdered_();

  return items.map(item => {
    const group = classifyEmailGroup_(item);
    return {
      source: item.source || '',
      id: item.id || '',
      account: item.account || '',
      group: group,
      groupLabel: EMAIL_GROUP_LABELS_[group] || group
    };
  });
}

/**
 * Reorder agenda items globally across groups.
 * @param {Array<{source:string,id:string}>} orderedKeys
 * @return {{updated:number}}
 */
function reorderAgenda(orderedKeys) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Agenda');
  if (!sheet) throw new Error('Agenda sheet not found');

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { updated: 0 };

  const headers = data[0];
  const orderIdx = headers.indexOf('Agenda Order');
  const sourceIdx = headers.indexOf('Source');
  const idIdx = headers.indexOf('ID');
  if (orderIdx < 0 || sourceIdx < 0 || idIdx < 0) {
    throw new Error('Agenda sheet missing required columns');
  }

  const rowMap = {};
  for (let i = 1; i < data.length; i++) {
    const src = String(data[i][sourceIdx] || '').toUpperCase();
    const id = String(data[i][idIdx] || '');
    rowMap[src + '::' + id] = i;
  }

  const used = {};
  const newOrder = [];

  (orderedKeys || []).forEach(k => {
    const src = String(k.source || '').toUpperCase();
    const id = String(k.id || '');
    const key = src + '::' + id;
    if (rowMap.hasOwnProperty(key) && !used[key]) {
      newOrder.push(rowMap[key]);
      used[key] = true;
    }
  });

  for (let i = 1; i < data.length; i++) {
    const src = String(data[i][sourceIdx] || '').toUpperCase();
    const id = String(data[i][idIdx] || '');
    const key = src + '::' + id;
    if (!used[key]) {
      newOrder.push(i);
      used[key] = true;
    }
  }

  const numRows = data.length - 1;
  const orderCol = orderIdx + 1;
  const orderValues = [];
  for (let i = 0; i < numRows; i++) {
    orderValues.push([0]);
  }

  newOrder.forEach((rowIdx, idx) => {
    orderValues[rowIdx - 1][0] = idx + 1;
  });

  sheet.getRange(2, orderCol, numRows, 1).setValues(orderValues);
  return { updated: newOrder.length };
}

/**
 * Renumber Agenda Order column sequentially (1..n).
 */
function renumberAgenda_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Agenda');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const numRows = lastRow - 1;
  const orders = [];
  for (let i = 0; i < numRows; i++) {
    orders.push([i + 1]);
  }
  sheet.getRange(2, 1, numRows, 1).setValues(orders);
}


/**
 * Simple HTML escaper.
 * @param {*} value
 * @return {string}
 */
function escapeHtml_(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * WPS deployment health export (unchanged).
 */
function exportWpsDeploymentHealthHtml() {
  const rows = getSheetData_('Deployments_SOQL');

  const HEALTH_COL = 'Overall_Health__c';
  const ACCOUNT_COL = 'Customer_name__c';
  const DEPLOYMENT_NAME_COL = 'Deployment_Name__c';
  const MTP_DATE_COL = 'Current_MTP_Date__c';
  const EM_COL = 'Workday_Engagement_Manager__r';
  const PARTNER_COL = 'Deployment_Partner_Name__c';

  const filtered = rows.filter(r => {
    const health = String(r[HEALTH_COL] || '').toLowerCase();
    const partner = String(r[PARTNER_COL] || '');
    const isRedOrYellow = (health === 'red' || health === 'yellow');
    const isWps = (partner === 'Workday Professional Services');
    return isRedOrYellow && isWps;
  });

  if (!filtered.length) {
    SpreadsheetApp.getUi().alert(
      'No red or yellow deployments found for Workday Professional Services.'
    );
    return;
  }

  const healthRank = h => {
    const v = String(h || '').toLowerCase();
    if (v === 'red') return 1;
    if (v === 'yellow') return 2;
    return 99;
  };
  filtered.sort((a, b) => healthRank(a[HEALTH_COL]) - healthRank(b[HEALTH_COL]));

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const formatMtpDate = value => {
    if (!value) return '';
    let d;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      if (isNaN(value.getTime())) return '';
      d = value;
    } else {
      d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
    }
    const mm = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd = ('0' + d.getDate()).slice(-2);
    const yyyy = d.getFullYear();
    return mm + '/' + dd + '/' + yyyy;
  };

  let html = '';
  html += '<!DOCTYPE html>\n<html>\n<body style="margin:0;padding:0;">\n';
  html += '<table border="1" cellpadding="4" cellspacing="0" ' +
    'style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">\n';
  html += '  <tr style="background-color:#f3f4f6;">\n';
  html += '    <th style="text-align:left;">Health</th>\n';
  html += '    <th style="text-align:left;">Account Name</th>\n';
  html += '    <th style="text-align:left;">Deployment Name</th>\n';
  html += '    <th style="text-align:left;">MTP Date</th>\n';
  html += '    <th style="text-align:left;">EM</th>\n';
  html += '  </tr>\n';

  filtered.forEach(r => {
    const rawHealth = String(r[HEALTH_COL] || '');
    const healthLower = rawHealth.toLowerCase();

    let healthBg = '#ffffff';
    let healthColor = '#000000';
    let healthWeight = 'normal';
    if (healthLower === 'red') {
      healthBg = '#b91c1c';
      healthColor = '#ffffff';
      healthWeight = 'bold';
    } else if (healthLower === 'yellow') {
      healthBg = '#facc15';
      healthColor = '#000000';
      healthWeight = 'bold';
    }

    const account = r[ACCOUNT_COL] || '';
    const deploymentName = stripHtml_(r[DEPLOYMENT_NAME_COL] || '');
    const mtpRaw = r[MTP_DATE_COL] || '';
    const mtpFormatted = formatMtpDate(mtpRaw);
    const em = r[EM_COL] || '';

    html += '  <tr>\n';
    html += '    <td style="background-color:' + healthBg +
      ';color:' + healthColor +
      ';font-weight:' + healthWeight +
      ';white-space:nowrap;">' + esc(rawHealth) + '</td>\n';
    html += '    <td>' + esc(account) + '</td>\n';
    html += '    <td>' + esc(deploymentName) + '</td>\n';
    html += '    <td>' + esc(mtpFormatted) + '</td>\n';
    html += '    <td>' + esc(em) + '</td>\n';
    html += '  </tr>\n';
  });

  html += '</table>\n</body>\n</html>';

  const t = HtmlService.createTemplateFromFile('ExportWpsHtmlDialog');
  t.rawHtml = html;
  t.escapedHtml = esc(html);

  const output = t.evaluate()
    .setWidth(800)
    .setHeight(600);

  SpreadsheetApp.getUi().showModalDialog(
    output,
    'Export WPS Deployment Health HTML'
  );
}
