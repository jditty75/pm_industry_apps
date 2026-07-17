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

  // Doc B: Capacity Adjustments Audit tabs
  getOrCreateSheet_(CAPACITY_ADJUSTMENTS_AUDIT_SHEET,         CAPACITY_ADJUSTMENT_AUDIT_HEADERS);
  getOrCreateSheet_(CAPACITY_ADJUSTMENTS_AUDIT_ARCHIVE_SHEET, CAPACITY_ADJUSTMENT_AUDIT_HEADERS);

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

  // Reseed Config_Calendar as weekly rows (weekly-forecast-migration §12).
  // Unconditional (NOT guarded by "if empty" like ICP/Roles/Aliases above):
  // CAL_HEADERS changed shape entirely (monthly period_start/fiscal_year/
  // fiscal_quarter/workdays_in_month -> weekly week_start/week_key/
  // fiscal_year/fiscal_quarter/workdays_in_week/holiday_hours), so any
  // pre-migration monthly rows left in the sheet would be silently
  // misread under the new column headers (e.g. old col2 "year number"
  // read as new col2 "week_key string") -- clean cutover, no back-compat,
  // per the working agreement. Config_Calendar is fully computed/
  // deterministic (never hand-edited by an admin), so unconditionally
  // regenerating it on every bootstrap() run is safe.
  //
  // Horizon: ~2 years back to ~3 years forward from today (260 weeks),
  // Monday-anchored as a placeholder baseline -- this is NOT required to
  // match the real PSA export's day-of-week. As soon as the first weekly
  // file is normalized, normalizeStaff()'s ensureCalendarWeeks_() call
  // (Ingest.gs / Util.gs) appends whatever weeks the real export actually
  // uses, so the calendar grid self-heals to the production day-of-week.
  {
    const rows = [];
    const today = new Date();
    const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const daysSinceMonday = (anchor.getDay() + 6) % 7;
    anchor.setDate(anchor.getDate() - daysSinceMonday - (104 * 7)); // ~2 years back, Monday
    for (let i = 0; i < 260; i++) {
      const ws = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i * 7);
      rows.push([ws, weekKey_(ws), fiscalYear_(ws), fiscalQuarter_(ws), 5, 0]);
    }
    writeTable_(CFG_CAL, CAL_HEADERS, rows);
  }

  // Seed new Config_Settings keys if missing (weekly-forecast-migration
  // §4.1). Config_Settings is a sparse key/value table -- existing keys
  // (planning_window_months, hide_all_external, etc.) are left untouched;
  // this only appends the 4 new weekly-migration keys when absent, so
  // re-running bootstrap() never clobbers an admin's saved settings.
  {
    const newSettingsDefaults = {
      weekly_target_default:   '32.8',
      weekly_target_P6:        '26.0',
      week_month_split_basis:  'calendar',
      fiscal_year_start_month: '2'
    };
    const existingSettings = readTable_(CFG_SETTINGS);
    const existingKeys = {};
    existingSettings.forEach(function (r) { existingKeys[String(r.key || '')] = true; });
    Object.keys(newSettingsDefaults).forEach(function (k) {
      if (existingKeys[k]) return;
      appendRow_(CFG_SETTINGS, { key: k, value: newSettingsDefaults[k] }, ['key', 'value']);
    });
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
