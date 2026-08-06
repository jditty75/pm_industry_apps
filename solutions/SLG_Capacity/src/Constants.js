// ============================================================
// Constants.gs — shared names, headers, defaults, Workday palette
// ============================================================

// --- Sheet tab names ---
const STAFF_SHEET       = 'PSA';
const OPPS_SHEET        = 'Pipeline';
const DEPLOYMENTS_SHEET = 'Deployments';
const ALLOC_NORM        = 'Allocations_Normalized';
const OPPS_NORM         = 'Opportunities_Normalized';
const ASSIGNMENTS       = 'Opportunity_Assignments';
const SCENARIOS         = 'Scenarios';

const CFG_ICP           = 'Config_ICP';
const CFG_ROLES         = 'Config_Roles';
const CFG_CAL           = 'Config_Calendar';
const CFG_ALIAS         = 'Config_ColumnAliases';
const CFG_TEAMS         = 'Config_Teams';
const CFG_INGEST        = 'Config_Ingest_Filters';     // ingest filters config
const CFG_SLG_MGRS = 'Config_SLG_Managers';     // SLG manager list (+ hierarchy)
const CFG_SETTINGS = 'Config_Settings';         // key/value settings
// New keys added by weekly-forecast-migration (seeded by bootstrap() if
// missing; read via readSettings_() in Engine.gs like all other settings):
//   weekly_target_default   -- default weekly capacity target hours (32.8)
//   weekly_target_P6        -- weekly capacity target hours for P6-level
//                               workers, i.e. Level === 'P6' (26.0)
//   week_month_split_basis  -- 'calendar' | 'weekday'; basis for the
//                               proportional week-to-month hours split
//                               (default 'calendar')
//   fiscal_year_start_month -- 1-indexed calendar month the fiscal year
//                               starts in (2 = February; keep in sync with
//                               FISCAL_YEAR_START_MONTH above)
//   alloc_over_ratio        -- ratio-to-target at/above which a worker is
//                               over-allocated in the Utilization banner
//                               (default 1.10)
//   alloc_under_ratio       -- ratio-to-target below which a worker is
//                               under-allocated in the Utilization banner
//                               (default 0.85)
//   util_band_cold_max         -- WFM.25 unified util color scale (default 0.60)
//   util_band_cool_max         -- (default 0.80)
//   util_band_approaching_max  -- (default 0.90)
//   util_band_ontarget_max     -- (default 1.03)
//   util_band_warm_max         -- (default 1.15)
//   util_color_cold_bg         -- WFM.25 unified util band palette (hex)
//   util_color_cold_fg         -- (default #0a3d7c / #ffffff)
//   util_color_cool_bg         -- (default #D6EBF9 / #0a3d7c)
//   util_color_cool_fg
//   util_color_approaching_bg  -- (default #FFF1B8 / #6b4e00)
//   util_color_approaching_fg
//   util_color_ontarget_bg     -- (default #c8e6c9 / #1b5e20)
//   util_color_ontarget_fg
//   util_color_warm_bg         -- (default #E76F1C / #ffffff)
//   util_color_warm_fg
//   util_color_hot_bg          -- (default #D6371E / #ffffff)
//   util_color_hot_fg
// Existing keys (planning_window_months, etc.) are unchanged.

/** Config_Settings keys + fallbacks for WFM.25 unified utilization color bands. */
const UTIL_BAND_SETTING_KEYS = {
  coldMax: 'util_band_cold_max',
  coolMax: 'util_band_cool_max',
  approachingMax: 'util_band_approaching_max',
  ontargetMax: 'util_band_ontarget_max',
  warmMax: 'util_band_warm_max'
};
const UTIL_BAND_DEFAULTS = {
  coldMax: 0.60,
  coolMax: 0.80,
  approachingMax: 0.90,
  ontargetMax: 1.03,
  warmMax: 1.15
};

/** Config_Settings keys + hex fallbacks for WFM.25 unified utilization band colors. */
const UTIL_COLOR_SETTING_KEYS = {
  coldBg: 'util_color_cold_bg',
  coldFg: 'util_color_cold_fg',
  coolBg: 'util_color_cool_bg',
  coolFg: 'util_color_cool_fg',
  approachingBg: 'util_color_approaching_bg',
  approachingFg: 'util_color_approaching_fg',
  ontargetBg: 'util_color_ontarget_bg',
  ontargetFg: 'util_color_ontarget_fg',
  warmBg: 'util_color_warm_bg',
  warmFg: 'util_color_warm_fg',
  hotBg: 'util_color_hot_bg',
  hotFg: 'util_color_hot_fg'
};
const UTIL_COLOR_DEFAULTS = {
  coldBg: '#0a3d7c',
  coldFg: '#ffffff',
  coolBg: '#D6EBF9',
  coolFg: '#0a3d7c',
  approachingBg: '#FFF1B8',
  approachingFg: '#6b4e00',
  ontargetBg: '#c8e6c9',
  ontargetFg: '#1b5e20',
  warmBg: '#E76F1C',
  warmFg: '#ffffff',
  hotBg: '#D6371E',
  hotFg: '#ffffff'
};
const CFG_GENERIC = 'Generic_Resources';        // generic (dummy) resources
const CFG_PRACTICE_MGRS = 'Config_Practice_Managers'; // practice -> manager ownership
const CFG_WORKER_ROLE_OVERRIDES = 'Config_Worker_Role_Overrides'; // per-worker ICP role override (applied at ingest time)
const CFG_WORKER_EXCLUSIONS = 'Config_Worker_Exclusions'; // SLG worker/manager exclusion list -- WFM-FIX.3: code-maintained
// source: 'manual' | 'rule:manager' | 'rule:on_leave'  (comma-join if multiple, e.g. 'rule:manager,rule:on_leave')
// override: '' | 'include' | 'exclude'   (human-owned; always wins over rules and active)
// return_date / modified_by / modified_at — WFM.25 app-owned return-date field (human-owned; preserved on re-ingest)
const WORKER_EXCLUSION_HEADERS = [
  'worker_name', 'manager_org', 'reason', 'active', 'source', 'override',
  'return_date', 'modified_by', 'modified_at'
];
const CFG_HOLIDAYS = 'Config_Holidays'; // WFM.15: company holiday calendar; reduces ICP available hours

const REFRESH_LOG       = 'Normalization_Log';
// Salesforce connector-owned pipeline refresh log.
// The Salesforce add-on inside Google Sheets manages this tab name and
// will rename it back if changed externally. Update this constant only
// if the Salesforce connector itself changes its naming convention.
const SF_PIPELINE_REFRESH_LOG = 'Auto Refresh Execution Log 1';

// --- Table headers ---

// Weekly grain (weekly-forecast-migration). Replaces the old monthly
// 'period_start' field with 'week_start' (Date, export column date as-is,
// NOT snapped to Monday) + 'week_key' (canonical 'YYYY-MM-DD' string id
// of week_start -- see weekKey_ in Util.gs). Clean cutover: no monthly
// back-compat; Allocations_Normalized is wiped and re-ingested at weekly
// grain.
const ALLOC_HEADERS = [
  'employee_id',
  'resource_name',
  'team',
  'practice',               // SLG worker's practice as reported by PSA (External rows are unreliable; see Config_Practice_Managers)
  'manager_org',
  'job_profile',
  'role_category',
  'resource_type',
  'worker_class',           // SLG_Real / SLG_Generic / External_NonSLG / External_Contractor
  'ICP_role',
  'account_name',
  'project_name',
  'allocation_type',
  'engagement_manager',
  'manager',
  'week_start',             // Date -- the week's column date, as-is from export
  'week_key',               // string -- 'YYYY-MM-DD' of week_start; canonical, sortable
  'hours',                  // number -- forecast hours for that week
  'source_row',
  'on_leave',               // WFM-FIX.3: 'Yes' | '' -- PSA "(On Leave)" name-tag stamp,
                             // written for every row regardless of exclusion. See
                             // _deriveOnLeave_ (Ingest.gs) and reconcileWorkerExclusions_.
  'specialty_practice'      // WFM.25 Pass 3A: raw PSA Specialty Practice (verbatim passthrough;
                             // separate from resolved `team` column)
];

const ACTUALS_NORM = 'Actuals_Normalized';
const ACTUALS_HEADERS = [
  'employee_id',   // trimmed string — join key
  'resource_name', // Worker (display/fallback only)
  'week_start',    // Date, Saturday anchor (matches Allocations_Normalized)
  'week_key',      // canonical 'YYYY-MM-DD' string of week_start (weekKey_)
  'actual_icp_hours', // number — the actual ICP hours for that worker×week
  'source_row'     // number — source row index (diagnostics)
];

const ACTUALS_SUMMARY = 'Actuals_Worker_Summary';
const ACTUALS_SUMMARY_HEADERS = [
  'employee_id',            // trimmed string
  'resource_name',          // Worker
  'qtd_actual_icp_hours',   // number — the source 'QTD actual ICP hours' column, stored verbatim
  'qtd_icp_plus_forecast_hours',       // WFM.17: QTD ICP Hours + Forecast Hours
  'bonus_target_billable_hours_eoq',   // WFM.17: Bonus target billable hours at EoQ
  'source_row'
];

const CFG_UTIL_QUARTERLY = 'Utilization_Quarterly';
const UTIL_QUARTERLY_HEADERS = ['employee_id','resource_name','fiscal_quarter',
    'target_hours','util_rate_wkly','qtd_actual_icp','qtd_icp_plus_forecast','source_sheet'];
const XORG_FORECAST_AGGREGATE = 'Xorg_Forecast_Aggregate';
const XORG_FORECAST_AGGREGATE_HEADERS = [
  'worker_group',
  'region',
  'fiscal_quarter',
  'forecast_hours'
];

const ACTUALS_HISTORY = 'Actuals_History';
const ACTUALS_HISTORY_HEADERS = [
  'employee_id',
  'resource_name',
  'worker_class',
  'workday_region_as_of_date_worked',
  'fiscal_quarter',
  'project',
  'project_role_category',
  'worked_hours',
  'specialty_practice',       // WFM.25 Pass 3A: from History_Normalized
  'sub_specialty_practice'    // WFM.25 Pass 3A: from History_Normalized
];
const CONSOLIDATED_REQUIRED_SHEETS = ['Forecast_Staged','Actuals_Current_Normalized',
    'Utilization_Normalized','History_Normalized','_manifest'];
const UNSTAFFED_DEMAND_SHEET = 'Unstaffed_Demand';

const OPP_HEADERS = [
  'opportunity_id','opportunity_name','account','stage','stage_num',
  'probability','acv','expected_start','expected_end','ee_count',
  'services','segment','deal_type','deployment_approach'
];

// Opportunity_Assignments schema.
//
// Priority 4 additions:
//   resource_type — the user's literal selection from the Role dropdown,
//                   sourced from Config_Resource_Type.resource_type.
//                   This is the canonical role field going forward.
//   team_label    — derived server-side from resource_type via
//                   Config_Resource_Type.team_label. Leadership-facing
//                   team rollup (Delivery / Functional Consulting /
//                   Technical Consulting / Unclassified).
//
// Existing columns kept for backwards compatibility:
//   role  — now stores the resolved ICP role (CS_FUNC, CS_TECH, EM, etc.)
//           when derivable from team_label via Config_Roles inverse.
//           Blank when the team_label maps to multiple ICP roles
//           (e.g., Delivery → EM/PD/DA — ambiguous).
//   team  — duplicates team_label on new writes. Deferred for consolidation
//           with team_label in a post-demo cleanup pass.
const ASSIGN_HEADERS = [
  'assignment_id','opportunity_id','role','resource_name','team',
  'start_date','end_date','estimated_hours','distribution',
  'custom_monthly_json','status','scenario_id','notes',
  'created_by','created_at','modified_by','modified_at',
  'resource_type','team_label'
];

const SCENARIO_HEADERS = [
  'scenario_id','name','description','status',
  'created_by','created_at','modified_by','modified_at'
];

const ICP_HEADERS    = ['role','target_utilization','red_threshold'];
const ROLE_HEADERS   = ['role','monthly_capacity_hours'];

// Weekly grain (weekly-forecast-migration). Config_Calendar now carries one
// row per week. Monthly/fiscal-quarter capacity is derived on demand via
// splitWeekAcrossMonths_ / fiscalQuarter_ (Util.gs) -- there is no separate
// monthly calendar table.
const CAL_HEADERS = [
  'week_start',        // Date -- matches Allocations_Normalized.week_start
  'week_key',          // string -- same canonical 'YYYY-MM-DD' week id
  'fiscal_year',       // number
  'fiscal_quarter',    // 'Q1'..'Q4' per FISCAL_QUARTER_BY_CALENDAR_MONTH below
  'workdays_in_week',  // number (default 5)
  'holiday_hours'      // number (default 0) -- for capacity netting if needed
];

// WFM.15: company holiday calendar. Flat hours (default 8) per active
// holiday, applied to EVERY worker (no per-worker eligibility). Multiple
// holidays landing in the same week sum -- see holidayHoursForWeek_
// (Engine.gs). holiday_date is a real Date; matched against a week's
// [week_start, week_start+6] range, not by exact week_key equality.
const HOLIDAY_HEADERS = ['holiday_date', 'holiday_name', 'hours', 'active'];

const ALIAS_HEADERS  = ['logical','actual','notes'];
const REFRESH_HEADERS = [
  'timestamp','source','rows_in','rows_out','weeks_detected','user','warnings'
];

// ------------------------------------------------------------
// Fiscal calendar (Workday fiscal year, February-anchored).
// LOCKED per weekly-forecast-migration spec -- do not reimplement this
// mapping elsewhere; always go through fiscalQuarter_/fiscalYear_/
// fiscalQuarterKey_ in Util.gs.
//   Q1 = Feb, Mar, Apr
//   Q2 = May, Jun, Jul
//   Q3 = Aug, Sep, Oct
//   Q4 = Nov, Dec, Jan   (January belongs to the PRIOR fiscal year's Q4)
// fiscalQuarterKey_ label format: 'FY<yy>-Q<n>', e.g. 'FY27-Q2'.
// ------------------------------------------------------------
const FISCAL_YEAR_START_MONTH = 2; // 1-indexed calendar month (February)
const FISCAL_QUARTER_BY_CALENDAR_MONTH = {
  1:  'Q4', // January -> prior fiscal year's Q4
  2:  'Q1', 3:  'Q1', 4:  'Q1',
  5:  'Q2', 6:  'Q2', 7:  'Q2',
  8:  'Q3', 9:  'Q3', 10: 'Q3',
  11: 'Q4', 12: 'Q4'
};

const TEAM_HEADERS = [
  'project_role_pattern',
  'job_profile_pattern',
  'team_type',     // Functional / Technical / Delivery
  'subteam',       // FIN / HCM / PATT / INT / RPT / DC / EM / PD
  'priority'       // numeric, higher wins
];

// Ingest filters config headers
const INGEST_FILTER_HEADERS = [
  'logical_field',  // logical column name (e.g. region_worker, resource_type, practice)
  'group',          // OR-group identifier; rules in same group are ORed, groups are ANDed
  'operator',       // equals, not_equals, in, not_in, contains, ...
  'mode',           // include | exclude
  'value',          // single value or comma-separated list
  'notes'           // free-text notes
];

// NEW: Practice managers headers (one row per practice/manager owner)
// practice_name  — must match a value used in Config_Resource_Type.practice
// manager_name   — must match a manager_name in Config_SLG_Managers
// active         — Yes/No (tolerant truthy match in the reader)
// notes          — free-text
const PRACTICE_MGRS_HEADERS = [
  'practice_name',
  'manager_name',
  'active',
  'notes'
];

// --- Seed data ---

const DEFAULT_ICP = [
  ['EM', 0.72, 0.90],
  ['PD', 0.65, 0.85]
];

// WFM.15: official 2026 Workday holiday schedule. 2026 ONLY -- 2027 dates
// must be added manually to Config_Holidays once published (see the
// Bootstrap.gs seeder's logged notice). Bootstrap only seeds this when
// Config_Holidays is empty, so it never overwrites Jeff's manual edits.
const DEFAULT_HOLIDAYS_2026 = [
  [new Date(2026, 0, 1),  "New Year's Day",           8, true],
  [new Date(2026, 0, 19), 'Martin Luther King Jr. Day', 8, true],
  [new Date(2026, 1, 16), "Presidents' Day",          8, true],
  [new Date(2026, 2, 27), 'Thank You Day',            8, true],
  [new Date(2026, 4, 22), 'Thank You Day',            8, true],
  [new Date(2026, 4, 25), 'Memorial Day',             8, true],
  [new Date(2026, 5, 18), 'Thank You Day',            8, true],
  [new Date(2026, 5, 19), 'Juneteenth',                8, true],
  [new Date(2026, 6, 3),  'Independence Day (observed)', 8, true],
  [new Date(2026, 8, 4),  'Thank You Day',            8, true],
  [new Date(2026, 8, 7),  'Labor Day',                8, true],
  [new Date(2026, 10, 11), 'Veterans Day',            8, true],
  [new Date(2026, 10, 26), 'Thanksgiving Day',        8, true],
  [new Date(2026, 10, 27), 'Thanksgiving Day After',  8, true],
  [new Date(2026, 11, 24), 'Christmas Eve',           8, true],
  [new Date(2026, 11, 25), 'Christmas Day',           8, true]
];

// WFM.17: January 2027 holidays required for FY27-Q4 target reconciliation.
const DEFAULT_HOLIDAYS_2027_JAN = [
  [new Date(2027, 0, 1),  "New Year's Day",             8, true],
  [new Date(2027, 0, 18), 'Martin Luther King Jr. Day', 8, true]
];

const DEFAULT_ROLES = [
  ['EM', 160],
  ['PD', 160],
  ['Functional', 160],
  ['Integrations', 160],
  ['Education', 160],
  ['Reporting & Analytics PS', 160],
  ['Advanced Services', 160],
  ['Services Operations', 160],
  ['Other', 160]
];

// Default column aliases
const DEFAULT_ALIASES = [
  ['employee_id','Employee ID','stable worker join key (Phase 0)'],
  ['resource_name','Worker',''],
  ['team','Specialty Practice','primary grouping'],
  ['practice','Customer Segment Practice',''],
  ['job_profile','Job Profile',''],
  ['role_category','Project Role Category','primary ICP role signal'],
  ['resource_type','Resource Type','fallback role bucket'],
  ['project_role','Project Role','worker job title'],
  ['project_name','Project',''],
  ['engagement_manager','Engagement Manager',''],
  ['manager',"Worker's Manager",'supervisory org for Team group-by'],
  ['flag_customer','Customer Projects',''],
  ['flag_internal','Internal Projects (Excludes Education)',''],
  ['flag_education','Education Projects','']
];

const ALLOC_TYPES   = ['Billable','Internal','Education','PTO_Holiday','Unassigned'];
// Allowed distribution modes. 'Custom' removed in WFM.12 (weekly-forecast-
// migration): client collected month-keyed custom_monthly_json while the
// weekly expansion functions look up week_key, silently zeroing every week.
// Returns later as its own week-grid feature. custom_monthly_json /
// custom_weekly_json columns remain in the schema, dormant and unwritten,
// for that future feature to reuse.
const DISTRIBUTIONS = ['Even','Front-loaded','Back-loaded'];
const ASSIGN_STATUSES = ['Modeled','Committed','Archived'];

// --- Drop 6: Capacity Adjustments schema ---

const CAPACITY_ADJUSTMENTS_SHEET = 'Capacity_Adjustments';

const ADJUSTMENT_HEADERS = [
  'adjustment_id',
  'resource_name',
  'start_date',
  'end_date',
  'hours_reduction',          // SIGNED: positive = reduce, negative = add. Column name kept for backward compat.
  'distribution',
  'direction',                // 'add' | 'reduce' — denormalized for readability in the sheet
  'custom_monthly_json',
  'reason',
  'scenario_id',
  'deployment_id',
  'status',                   // 'Modeled' | 'Committed' | 'Archived' (unchanged)
  'created_by',
  'created_at',
  'modified_by',
  'modified_at'
];

// --- Doc B: Capacity Adjustments Audit schema ---

const CAPACITY_ADJUSTMENTS_AUDIT_SHEET = 'Capacity_Adjustments_Audit';
const CAPACITY_ADJUSTMENTS_AUDIT_ARCHIVE_SHEET = 'Capacity_Adjustments_Audit_Archive';

const CAPACITY_ADJUSTMENT_AUDIT_HEADERS = [
  'audit_id',
  'timestamp',
  'actor',
  'action',              // 'create' | 'update' | 'commit' | 'archive' | 'delete'
  'adjustment_id',
  'resource_name',
  'deployment_id',
  'before_json',
  'after_json',
  'notes'
];

// Generic Resources table headers (used by api_saveGenericResources / writeTable_).
const GENERIC_HEADERS = [
  'name', 'resource_type', 'project_role', 'manager_org', 'team', 'practice',
  'start_date', 'end_date', 'capacity_hours', 'status', 'notes'
];

// Group-by modes for the dashboard heatmap
const GROUP_BY_MODES = ['Function','Role','Team','Individual'];

// --- Drop 3: Source Overrides schema ---

const OVERRIDES_SHEET             = 'Overrides';
const OVERRIDES_AUDIT_SHEET       = 'Overrides_Audit';
const OVERRIDES_AUDIT_ARCHIVE_SHEET = 'Overrides_Audit_Archive';
const CFG_OVERRIDABLE_FIELDS      = 'Config_Overridable_Fields';

const OVERRIDE_HEADERS = [
  'override_id', 'source', 'record_id', 'field', 'original_value',
  'override_value', 'reason', 'expires_at', 'status',
  'created_by', 'created_at', 'modified_by', 'modified_at'
];

const OVERRIDE_AUDIT_HEADERS = [
  'audit_id', 'timestamp', 'actor', 'action', 'override_id', 'source',
  'record_id', 'field', 'before_json', 'after_json', 'notes'
];

// Overrides_Audit_Archive uses the same headers as Overrides_Audit.

const OVERRIDABLE_FIELDS_HEADERS = [
  'source', 'field', 'label', 'data_type', 'validator_hint', 'active', 'notes'
];

// Seed data: fields users can override per source.
const DEFAULT_OVERRIDABLE_FIELDS = [
  ['Pipeline',     'acv',                 'ACV',                 'currency', '', 'Yes', ''],
  ['Pipeline',     'probability',         'Probability',         'percent',  '', 'Yes', ''],
  ['Pipeline',     'expected_start',      'Expected Start',      'date',     '', 'Yes', ''],
  ['Pipeline',     'expected_end',        'Expected End',        'date',     '', 'Yes', ''],
  ['Pipeline',     'ee_count',            'EE Count',            'number',   '', 'Yes', ''],
  ['Pipeline',     'stage',               'Stage',               'text',     '', 'Yes', ''],
  ['Pipeline',     'segment',             'Segment',             'text',     '', 'Yes', ''],
  ['Pipeline',     'deal_type',           'Deal Type',           'text',     '', 'Yes', ''],
  ['Pipeline',     'deployment_approach', 'Deployment Approach', 'text',     '', 'Yes', ''],
  ['Deployments',  'deployment_stage',    'Deployment Stage',    'text',     '', 'Yes', ''],
  ['Deployments',  'deployment_health',   'Deployment Health',   'text',     '', 'Yes', ''],
  ['Deployments',  'current_mtp_date',    'Current MTP Date',    'date',     '', 'Yes', ''],
  ['Deployments',  'em_name',             'EM Name',             'text',     '', 'Yes', ''],
  ['Deployments',  'dam_name',            'DAM Name',            'text',     '', 'Yes', ''],
  ['Deployments',  'ps_locations',        'PS Locations',        'text',     '', 'Yes', ''],
  ['Deployments',  'current_update',      'Current Update',      'text',     '', 'Yes', '']
];

// --- Workday brand palette (exposed to client via api_getReference) ---
const WORKDAY_PALETTE = {
  // Core
  afterHours:   '#0B1E3F',
  ink:          '#0A3D7C',
  ballpoint:    '#0875C1',
  waterCooler:  '#2FA4E7',
  blueSky:      '#AED9F4',
  paper:        '#FDFCF7',
  keyboard:     '#F4EFDF',
  highlighter:  '#F7E26B',
  pencil:       '#F5B700',
  lunchBreak:   '#E8A317',
  // Secondary
  tack:         '#5BB5C4',
  eraser:       '#F2C5E0',
  smoothie:     '#A659C4',
  happyHour:    '#E76F1C',
  thumbtack:    '#D6371E',
  laptop:       '#4A5463',
  staple:       '#8A94A1',
  desk:         '#BFC6CF',
  businessCard: '#ECEEF1'
};