function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Healthcare Wellness Tools')
    .addItem('Export WPS Deployment Health HTML', 'exportWpsDeploymentHealthHtml')
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
 * Build agenda HTML using the Agenda sheet's Agenda Order.
 */
function buildAgendaPreviewHtmlFromSheet() {
  const items = getAgendaItemsOrdered_();
  return generateAgendaHtml(items);
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
 * Read Qualtrix items from an external Google Sheet.
 * URL: https://docs.google.com/spreadsheets/d/1VyC60G5qVYT_ALVzVMh1LCQvS-7jcmDXc85gh2XpAKI/edit?gid=1274570197#gid=1274570197
 * Sheet: "Detractor Tracker"
 * Filter: Column A == "Q1"
 */
function getQualtrixItems_() {
  const url = 'https://docs.google.com/spreadsheets/d/1VyC60G5qVYT_ALVzVMh1LCQvS-7jcmDXc85gh2XpAKI/edit#gid=1274570197';
  const ss = SpreadsheetApp.openByUrl(url);
  const sheet = ss.getSheetByName('Detractor Tracker');
  if (!sheet) throw new Error('Detractor Tracker sheet not found in Qualtrix workbook');

  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const rows = values.slice(1);
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const quarter = row[0]; // Column A
    if (String(quarter) !== 'Q1') continue;

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
 * Classify an agenda item into one of three render buckets:
 *   'DEPLOYMENT' — source is DEPLOYMENT and id does NOT start with MANUAL-
 *   'CSAT'       — source is CSAT and id does NOT start with MANUAL-
 *   'MANUAL'     — everything else (MANUAL- prefix IDs, QUALTRIX, BUDGET_EAC, MANUAL source, etc.)
 */
function classifyAgendaItem_(item) {
  var id = String(item.id || '');
  var src = String(item.source || '').toUpperCase();
  if (id.indexOf('MANUAL-') === 0) return 'MANUAL';
  if (src === 'DEPLOYMENT') return 'DEPLOYMENT';
  if (src === 'CSAT') return 'CSAT';
  return 'MANUAL';
}

/**
 * Generate full HTML for the agenda preview/export.
 * (Unchanged from your working version except for grouping logic if you add it.)
 */
function generateAgendaHtml(agendaItems) {
  const meetingDate = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'EEEE, MMMM dd, yyyy'
  );

  const deploymentItems = agendaItems.filter(
    item => classifyAgendaItem_(item) === 'DEPLOYMENT'
  );
  const csatItems = agendaItems.filter(
    item => classifyAgendaItem_(item) === 'CSAT'
  );
  const manualItems = agendaItems.filter(
    item => classifyAgendaItem_(item) === 'MANUAL'
  );

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background-color: #f5f5f7;
        padding: 16px;
        color: #222;
      }
      .container {
        max-width: 900px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 12px;
        border: 1px solid #1d4ed8;
        box-shadow: 0 10px 40px rgba(0,0,0,0.12);
        overflow: hidden;
      }
      .header {
        background: linear-gradient(135deg, #0066cc 0%, #004999 100%);
        color: #ffffff;
        padding: 20px 24px;
      }
      .header-inner {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .header-logo { flex: 0 0 auto; }
      .header-main { flex: 1 1 auto; min-width: 0; }
      .header-title {
        font-size: 20px;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .header-subtitle {
        font-size: 13px;
        opacity: 0.9;
        max-width: 620px;
        line-height: 1.35;
      }
      .header-date {
        font-size: 12px;
        opacity: 0.85;
        margin-top: 6px;
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        padding: 12px 24px 16px 24px;
        border-bottom: 1px solid #e5e7eb;
        background-color: #f9fafb;
      }
      .summary-item { min-width: 120px; }
      .summary-number {
        font-size: 22px;
        font-weight: 600;
        color: #1d4ed8;
        line-height: 1.2;
      }
      .summary-label {
        font-size: 11px;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 2px;
      }
      .content {
        padding: 20px 24px 24px 24px;
      }
      .section { margin-bottom: 24px; }
      .section:last-child { margin-bottom: 0; }
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 14px;
        margin: 0 -14px 12px -14px;
        background-color: #1d4ed8;
        color: #ffffff;
      }
      .section-header-left {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .section-icon {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        background: rgba(15, 23, 42, 0.18);
      }
      .section-title {
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .section-count {
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.7);
        background: rgba(15, 23, 42, 0.12);
        white-space: nowrap;
      }
      .agenda-item {
        background: #f9fafb;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        padding: 12px 14px;
        margin-bottom: 10px;
      }
      .agenda-item:last-child { margin-bottom: 0; }
      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
        gap: 8px;
      }
      .account-name {
        font-size: 15px;
        font-weight: 600;
        color: #111827;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .item-number {
        font-size: 12px;
        font-weight: 600;
        color: #4b5563;
      }
      .item-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 12px;
        color: #4b5563;
      }
      .meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .meta-label {
        font-weight: 500;
        color: #374151;
      }
      .status-badge {
        padding: 2px 8px;
        border-radius: 999px;
        font-weight: 500;
        font-size: 11px;
        border: 1px solid transparent;
      }
      .badge-deployment {
        background-color: #eff6ff;
        color: #1d4ed8;
        border-color: #bfdbfe;
      }
      .badge-csat {
        background-color: #fffbeb;
        color: #b45309;
        border-color: #fde68a;
      }
      .badge-unfavorable {
        background-color: #fef2f2;
        color: #b91c1c;
        border-color: #fecaca;
      }
      .badge-neutral {
        background-color: #fefce8;
        color: #92400e;
        border-color: #facc15;
      }
      .badge-favorable {
        background-color: #ecfdf3;
        color: #15803d;
        border-color: #bbf7d0;
      }
      .badge-high-risk {
        background-color: #b91c1c;
        color: #ffffff;
        font-weight: 700;
        border-color: #b91c1c;
      }
      .item-details { display: grid; gap: 6px; }
      .detail-row {
        background: #ffffff;
        border-radius: 4px;
        padding: 8px 9px;
        border: 1px solid #e5e7eb;
      }
      .detail-label {
        font-size: 11px;
        font-weight: 600;
        color: #4b5563;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
      }
      .detail-text {
        font-size: 12px;
        color: #374151;
        line-height: 1.4;
        white-space: pre-wrap;
      }
      .empty-state {
        text-align: center;
        padding: 40px 24px;
        color: #6b7280;
        font-size: 14px;
      }
      .empty-state-icon {
        font-size: 32px;
        margin-bottom: 8px;
        opacity: 0.5;
      }
      .footer {
        background: #ffffff;
        padding: 10px 24px 14px 24px;
        border-top: 1px solid #e5e7eb;
        font-size: 11px;
        color: #6b7280;
        text-align: right;
      }
      .footer-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      .print-button {
        background: #1d4ed8;
        color: #ffffff;
        border: none;
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
      }
      .print-button:hover { background: #1e40af; }
      @media print {

        /* ---- Page setup ---- */
        @page {
          size: Letter;
          margin: 0.45in 0.5in;
        }

        html, body {
          background: #ffffff !important;
        }
        body {
          padding: 0;
          font-size: 10px;
          color: #111827;
        }

        /* ---- Container: kill the blue border that bleeds across pages ---- */
        .container {
          box-shadow: none !important;
          border: none !important;
          border-radius: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          overflow: visible !important;
        }

        /* ---- Hide UI chrome ---- */
        .print-button,
        .footer-main .print-button {
          display: none !important;
        }

        /* ---- Header: condensed, page 1 only ---- */
        .header {
          padding: 10px 14px !important;
          background: #1d4ed8 !important;
          color: #ffffff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .header-title {
          font-size: 16px !important;
          margin-bottom: 2px !important;
        }
        .header-subtitle {
          font-size: 10.5px !important;
          line-height: 1.3 !important;
        }
        .header-date {
          font-size: 10px !important;
          margin-top: 3px !important;
        }
        .header-logo svg {
          width: 30px !important;
          height: 30px !important;
        }

        /* ---- Summary bar: condensed, page 1 only ---- */
        .summary {
          padding: 8px 14px !important;
        }
        .summary-number { font-size: 16px !important; }
        .summary-label  { font-size: 9px  !important; }

        /* ---- Content padding ---- */
        .content { padding: 10px 14px 14px 14px !important; }

        /* ---- Section header: prevent orphan headers, tighten ---- */
        .section {
          margin-bottom: 12px !important;
        }
        .section-header {
          padding: 6px 10px !important;
          margin: 0 -10px 8px -10px !important;
          background: #1d4ed8 !important;
          color: #ffffff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          break-after: avoid;
          page-break-after: avoid;
        }
        .section-title { font-size: 11px !important; }
        .section-count { font-size: 9px !important; padding: 1px 6px !important; }
        .section-icon  { width: 18px !important; height: 18px !important; font-size: 11px !important; }

        /* ---- New page per section (except the very first) ---- */
        .section + .section {
          break-before: page;
          page-break-before: always;
        }

        /* ---- Agenda items: condensed executive layout ---- */
        .agenda-item {
          background: #ffffff !important;
          border: 1px solid #d1d5db !important;
          padding: 6px 9px !important;
          margin-bottom: 6px !important;
          break-inside: auto;
          page-break-inside: auto;
        }
        .item-header { margin-bottom: 4px !important; }
        .account-name { font-size: 12px !important; }
        .item-number  { font-size: 10px !important; }

        .item-meta {
          gap: 6px !important;
          margin-bottom: 5px !important;
          font-size: 9.5px !important;
        }

        /* In print, the section header already labels the category.
           Hide the per-item source badge to save vertical space. */
        .item-meta .badge-deployment,
        .item-meta .badge-csat {
          display: none !important;
        }

        /* ---- Detail rows: tighten and forbid mid-row breaks ---- */
        .item-details { gap: 3px !important; }
        .detail-row {
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          padding: 4px 7px !important;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .detail-label {
          font-size: 8.5px !important;
          margin-bottom: 1px !important;
        }
        .detail-text {
          font-size: 10px !important;
          line-height: 1.35 !important;
        }

        /* Keep status pills colored in print */
        .status-badge {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* ---- Footer ---- */
        .footer {
          border-top: 1px solid #e5e7eb !important;
          padding: 6px 14px 8px 14px !important;
          font-size: 8.5px !important;
          break-before: avoid;
          page-break-before: avoid;
        }

        /* Belt-and-suspenders: ensure no element repeats blue borders
           across pages */
        * {
          box-shadow: none !important;
        }
      }
    </style>
    </head>
    <body>
    <div class="container">
        <div class="header page-1-only">
          <div class="header-inner">
          <div class="header-logo">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="40" height="40">
              <defs>
                <style>
                  .cls-0 { fill: #ffffff; }
                  .cls-1 { fill: #0f2e66; }
                  .cls-2 { fill: #fc5b05; }
                </style>
              </defs>
              <g>
                <g id="Layer_1">
                  <rect class="cls-0" x="0" y="0" width="1540" height="2000" />
                  <path class="cls-1" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9c41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5c4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4c-66.3,320.9-144.7,639.6-260.1,960.4c-10,29.6-27.1,41.7-56.5,41.7Z"/>
                  <path class="cls-2" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9c149.1,0,289.2,58,394.4,163.3c54.8,54.8,96.6,118.9,124.3,188.7c6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54c-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7C302.7,526.7,344.4,462.7,398.9,408.1Z"/>
                </g>
              </g>
            </svg>
          </div>
          <div class="header-main">
            <div class="header-title">HC Wellness Meeting Agenda</div>
            <div class="header-subtitle">
              A review of deployments, accounts, budgets, and investments that require leadership team review and collaboration
            </div>
            <div class="header-date">${meetingDate}</div>
          </div>
        </div>
      </div>
        <div class="summary page-1-only">
          <div class="summary-item">
            <div class="summary-number">${agendaItems.length}</div>
            <div class="summary-label">Total Items</div>
          </div>
        <div class="summary-item">
          <div class="summary-number">${deploymentItems.length}</div>
          <div class="summary-label">Deployments</div>
        </div>
        <div class="summary-item">
          <div class="summary-number">${csatItems.length}</div>
          <div class="summary-label">CSAT Issues</div>
        </div>
        <div class="summary-item">
          <div class="summary-number">${manualItems.length}</div>
          <div class="summary-label">Additional / Manual</div>
        </div>
      </div>
      <div class="content">
  `;

  if (deploymentItems.length > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <div class="section-header-left">
            <div class="section-icon">🚀</div>
            <div class="section-title">Deployment Reviews</div>
          </div>
          <div class="section-count">${deploymentItems.length} items</div>
        </div>
    `;
    deploymentItems.forEach((item, i) => {
      html += generateAgendaItemHtml(item, i + 1, 'deployment');
    });
    html += `</div>`;
  }

  if (csatItems.length > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <div class="section-header-left">
            <div class="section-icon"></div>
            <div class="section-title">Customer Satisfaction Reviews</div>
          </div>
          <div class="section-count">${csatItems.length} items</div>
        </div>
    `;
    csatItems.forEach((item, i) => {
      html += generateAgendaItemHtml(item, i + 1, 'csat');
    });
    html += `</div>`;
  }

  if (manualItems.length > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          <div class="section-header-left">
            <div class="section-icon">📝</div>
            <div class="section-title">Additional / Manual Topics</div>
          </div>
          <div class="section-count">${manualItems.length} items</div>
        </div>
    `;
    manualItems.forEach((item, i) => {
      html += generateAgendaItemHtml(item, i + 1, 'manual');
    });
    html += `</div>`;
  }

  if (agendaItems.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div><strong>No agenda items</strong></div>
        <div>Add Deployment, CSAT, or Additional / Manual topics to populate the agenda.</div>
      </div>
    `;
  }

  html += `
      </div>
      <div class="footer">
        <div class="footer-main">
          <button class="print-button" onclick="window.print()">Print</button>
          <div>Generated on ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss z')}</div>
        </div>
        <div>HC Wellness Solution • ${Session.getActiveUser().getEmail()}</div>
      </div>
    </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Render a single agenda item as HTML.
 */
function generateAgendaItemHtml(item, number, type) {
  var account = item.account || '';
  var lead = item.lead || '';
  var user = item.user || '';
  var health = item.healthStatus || '';

  var html = '<div class="agenda-item">';

  html += '<div class="item-header">';
  html += '<div class="account-name">' + escapeHtml_(account) + '</div>';
  html += '<div class="item-number">#' + number + '</div>';
  html += '</div>';

  html += '<div class="item-meta">';

  if (lead) {
    html += '<div class="meta-item"><span class="meta-label">Lead:</span><span>' +
      escapeHtml_(lead) + '</span></div>';
  }

  if (user) {
    html += '<div class="meta-item"><span class="meta-label">Submitted by:</span><span>' +
      escapeHtml_(user) + '</span></div>';
  }

  var srcLabel;
  var srcClass;
  if (type === 'deployment') {
    srcLabel = 'Deployment';
    srcClass = 'badge-deployment';
  } else if (type === 'csat') {
    srcLabel = 'CSAT';
    srcClass = 'badge-csat';
  } else if (type === 'manual') {
    var rawSrc = String(item.source || '').toUpperCase();
    var topicLabelMap = {
      'DEPLOYMENT': 'Deployment',
      'CSAT': 'CSAT',
      'QUALTRIX': 'Qualtrix',
      'BUDGET_EAC': 'Budget / EAC',
      'MANUAL': 'Manual'
    };
    var topicLabel = topicLabelMap[rawSrc] || (item.source || 'Manual');
    srcLabel = (rawSrc === 'MANUAL') ? 'Manual' : (topicLabel + ' (Manual)');
    srcClass = 'badge-neutral';
  } else {
    srcLabel = item.source || 'Item';
    srcClass = 'badge-neutral';
  }

  html += '<div class="meta-item"><span class="status-badge ' + srcClass + '">' +
    escapeHtml_(srcLabel) + '</span></div>';

  if (health) {
    var hClass;
    var hUpper = String(health).toUpperCase();
    if (hUpper === 'UNFAVORABLE' || hUpper === 'RED') {
      hClass = 'badge-unfavorable';
    } else if (hUpper === 'FAVORABLE' || hUpper === 'GREEN') {
      hClass = 'badge-favorable';
    } else {
      hClass = 'badge-neutral';
    }
    html += '<div class="meta-item"><span class="status-badge ' + hClass + '">' +
      escapeHtml_(health) + '</span></div>';
  }

  if (type === 'csat' && String(item.highRiskFlag || '').toLowerCase() === 'true') {
    html += '<div class="meta-item"><span class="status-badge badge-high-risk">HIGH RISK</span></div>';
  }

  html += '</div>';

  html += '<div class="item-details">';
  if (item.currentState) {
    html += '<div class="detail-row">' +
      '<div class="detail-label">Current State</div>' +
      '<div class="detail-text">' + escapeHtml_(item.currentState) + '</div>' +
      '</div>';
  }

  if (item.desiredOutcome) {
    html += '<div class="detail-row">' +
      '<div class="detail-label">Desired Outcome</div>' +
      '<div class="detail-text">' + escapeHtml_(item.desiredOutcome) + '</div>' +
      '</div>';
  }

  if (item.futureState) {
    html += '<div class="detail-row">' +
      '<div class="detail-label">Future State</div>' +
      '<div class="detail-text">' + escapeHtml_(item.futureState) + '</div>' +
      '</div>';
  }

  html += '</div>';
  html += '</div>';

  return html;
}

/**
 * Simple HTML escaper.
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
 * "PDF" export helper: return HTML and let browser print->PDF.
 */
function exportAgendaPdf(agendaItems) {
  const html = generateAgendaHtml(agendaItems);
  return html;
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