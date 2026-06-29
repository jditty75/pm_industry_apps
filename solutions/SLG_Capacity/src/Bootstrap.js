// ============================================================
// Bootstrap.gs — one-time setup: tabs, seed config, triggers
//
// bootstrap() is NOT auto-run. It is a manual recovery / first-install
// helper. Run it once from the Apps Script editor after a fresh install
// or to repair missing tabs after a structural change.
//
// The override sheets (Overrides, Overrides_Audit, Overrides_Audit_Archive,
// Config_Overridable_Fields) are also created on first write via
// getOrCreateSheet_ calls inside writeTable_/appendRow_, so the override
// system works even if bootstrap() is never explicitly run.
// ============================================================

function bootstrap() {
  const ss = SpreadsheetApp.getActive();

  // Create tabs with headers
  getOrCreateSheet_(STAFF_SHEET, null); // raw — columns arrive with upload
  getOrCreateSheet_(OPPS_SHEET,  null); // raw — columns arrive with auto-refresh
  getOrCreateSheet_(ALLOC_NORM,   ALLOC_HEADERS);
  getOrCreateSheet_(OPPS_NORM,    OPP_HEADERS);
  getOrCreateSheet_(ASSIGNMENTS,  ASSIGN_HEADERS);
  getOrCreateSheet_(SCENARIOS,    SCENARIO_HEADERS);
  getOrCreateSheet_(CFG_ICP,      ICP_HEADERS);
  getOrCreateSheet_(CFG_ROLES,    ROLE_HEADERS);
  getOrCreateSheet_(CFG_CAL,      CAL_HEADERS);
  getOrCreateSheet_(CFG_ALIAS,    ALIAS_HEADERS);
  getOrCreateSheet_(REFRESH_LOG,  REFRESH_HEADERS);

  // Drop 3: Source Overrides tabs
  getOrCreateSheet_(OVERRIDES_SHEET,              OVERRIDE_HEADERS);
  getOrCreateSheet_(OVERRIDES_AUDIT_SHEET,        OVERRIDE_AUDIT_HEADERS);
  getOrCreateSheet_(OVERRIDES_AUDIT_ARCHIVE_SHEET, OVERRIDE_AUDIT_HEADERS);
  getOrCreateSheet_(CFG_OVERRIDABLE_FIELDS,       OVERRIDABLE_FIELDS_HEADERS);

  // Doc B: Deployment Hour Overrides tabs
  getOrCreateSheet_(DEPLOYMENT_HOUR_OVERRIDES_SHEET,               DEPLOYMENT_HOUR_OVERRIDE_HEADERS);
  getOrCreateSheet_(DEPLOYMENT_HOUR_OVERRIDES_AUDIT_SHEET,         DEPLOYMENT_HOUR_OVERRIDE_AUDIT_HEADERS);
  getOrCreateSheet_(DEPLOYMENT_HOUR_OVERRIDES_AUDIT_ARCHIVE_SHEET, DEPLOYMENT_HOUR_OVERRIDE_AUDIT_HEADERS);

  // Seed Config_Overridable_Fields if empty
  if (readTable_(CFG_OVERRIDABLE_FIELDS).length === 0) {
    writeTable_(CFG_OVERRIDABLE_FIELDS, OVERRIDABLE_FIELDS_HEADERS, DEFAULT_OVERRIDABLE_FIELDS);
  }

  // Seed ICP if empty
  if (readTable_(CFG_ICP).length === 0) {
    writeTable_(CFG_ICP, ICP_HEADERS, DEFAULT_ICP);
  }

  // Seed Roles if empty
  if (readTable_(CFG_ROLES).length === 0) {
    writeTable_(CFG_ROLES, ROLE_HEADERS, DEFAULT_ROLES);
  }

  // Seed Aliases if empty
  if (readTable_(CFG_ALIAS).length === 0) {
    writeTable_(CFG_ALIAS, ALIAS_HEADERS, DEFAULT_ALIASES);
  }

  // Seed Calendar for 2024-2028 if empty
  if (readTable_(CFG_CAL).length === 0) {
    const rows = [];
    for (let y = 2024; y <= 2028; y++) {
      for (let m = 0; m < 12; m++) {
        const period = new Date(y, m, 1);
        const q = 'Q' + (Math.floor(m / 3) + 1);
        rows.push([period, y, m + 1, q, workdaysInMonth_(y, m)]);
      }
    }
    writeTable_(CFG_CAL, CAL_HEADERS, rows);
  }

  // Reorder tabs for usability
  reorderTabs_([
    REFRESH_LOG,
    CFG_ALIAS, CFG_CAL, CFG_ROLES, CFG_ICP,
    SCENARIOS, ASSIGNMENTS,
    OPPS_NORM, ALLOC_NORM,
    OPPS_SHEET, STAFF_SHEET
  ]);

  // Set up a trigger to auto-normalize opportunities every 30 minutes
  ensureTrigger_('normalizeOpportunities', 30);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Bootstrap complete. Deploy the web app from Deploy > New deployment.',
    'Capacity Planner', 5);
}

function reorderTabs_(orderFromRight) {
  const ss = SpreadsheetApp.getActive();
  orderFromRight.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(ss.getNumSheets()); }
  });
}

function ensureTrigger_(handler, minutes) {
  const existing = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler);
  if (existing.length) return;
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(minutes).create();
}
