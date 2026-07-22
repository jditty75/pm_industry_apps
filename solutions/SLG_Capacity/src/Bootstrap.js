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
  getOrCreateSheet_(CFG_HOLIDAYS, HOLIDAY_HEADERS);

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

  // Seed Config_Holidays if empty (WFM.15). Idempotent -- only seeds when
  // the sheet has zero data rows, so re-running bootstrap() never
  // overwrites Jeff's manual edits (added/removed holidays, corrected
  // hours, etc.). DEFAULT_HOLIDAYS_2026 is the official 2026 Workday
  // schedule only.
  if (readTable_(CFG_HOLIDAYS).length === 0) {
    writeTable_(CFG_HOLIDAYS, HOLIDAY_HEADERS, DEFAULT_HOLIDAYS_2026);
    Logger.log('bootstrap: seeded Config_Holidays with the 2026 Workday schedule (16 rows). ' +
      '2027 holiday dates are NOT included -- add them to Config_Holidays manually once published.');
  }

  // Clear Config_Calendar to headers-only, zero data rows (weekly-forecast-
  // migration; WFM.13 fix). No speculative week generation here -- the
  // previous version of this block generated a 260-week, Monday-anchored
  // grid spanning ~2 years back to ~3 years forward regardless of what the
  // real PSA export's day-of-week actually was (Saturday in the sample
  // export). That phantom grid was WFM.13's defect #2: ensureCalendarWeeks_()
  // (Util.gs, called from Ingest.gs's normalizeStaff() on every upload)
  // then added the REAL Saturday weeks alongside it as a second set
  // instead of replacing it, and the forecast table rendered the union --
  // interleaved 2-day/5-day columns, half of them empty.
  //
  // Config_Calendar is now populated EXCLUSIVELY by ensureCalendarWeeks_()
  // from the actual uploaded export's week columns (see that function,
  // Util.gs, for the full rationale) -- the anchor is derived from the
  // data, never hardcoded. This unconditional reseed-to-empty (still NOT
  // guarded by "if empty" like ICP/Roles/Aliases above) also wipes any
  // pre-migration monthly rows or corrupted week_key values left over from
  // before this fix, so re-running bootstrap() always yields a clean slate
  // ready for the next upload to repopulate.
  writeTable_(CFG_CAL, CAL_HEADERS, []);

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
