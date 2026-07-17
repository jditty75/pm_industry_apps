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
// Existing keys (planning_window_months, etc.) are unchanged.
const CFG_GENERIC = 'Generic_Resources';        // generic (dummy) resources
const CFG_PRACTICE_MGRS = 'Config_Practice_Managers'; // practice -> manager ownership
const CFG_WORKER_ROLE_OVERRIDES = 'Config_Worker_Role_Overrides'; // per-worker ICP role override (applied at ingest time)

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
  'source_row'
];

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
const DISTRIBUTIONS = ['Even','Front-loaded','Back-loaded','Custom'];
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