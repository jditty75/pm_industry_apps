/**
 * SLG Capacity four-file WoW source contract and consolidated output schema.
 * @namespace SlgCapacitySchema
 */
var SlgCapacitySchema = (function () {
  'use strict';

  var PIPELINE_ID = 'slg_capacity_wow_v4';
  var TRANSFORMER_VERSION = 'slg-capacity-wow-v4';

  var OUT_FORECAST = 'Forecast_Staged';
  var OUT_UNSTAFFED = 'Unstaffed_Demand';
  var OUT_ACTUALS = 'Actuals_Current_Normalized';
  var OUT_UTIL = 'Utilization_Normalized';
  var OUT_HISTORY = 'History_Normalized';
  var OUT_XORG = 'Xorg_Forecast_Aggregate';
  var OUT_MANIFEST = '_manifest';

  var UTIL_COLS = [
    'employee_id', 'resource_name', 'fiscal_quarter', 'target_hours', 'util_rate_wkly',
    'qtd_actual_icp', 'qtd_icp_plus_forecast', 'source_sheet', 'productive_denominator_hours'
  ];
  var MEAS_FSQ = 'SUM(Future Scheduled Quarter Hours)';
  var MEAS_TWH = 'SUM(Total Weekly Hours for Future Scheduled Hours)';
  var ACTCUR_COLS = [
    'employee_id', 'resource_name', 'week_start', 'week_key', 'project',
    'project_role_category', 'actual_icp_hours', 'source_row'
  ];
  var HIST_COLS = [
    'employee_id', 'resource_name', 'worker_class', 'workday_region_as_of_date_worked',
    'fiscal_quarter', 'project', 'project_role_category', 'icp_hours', 'non_icp_hours',
    'specialty_practice', 'sub_specialty_practice'
  ];
  var XORG_COLS = ['worker_group', 'region', 'fiscal_quarter', 'forecast_hours'];
  var MANIFEST_COLS = [
    'sheet', 'rows', 'primary_measure', 'primary_total', 'distinct_workers', 'min_period', 'max_period'
  ];

  /** @type {Object.<string, string[][]>} */
  var BATCH_FILE_PATTERNS = {
    forecast: ['Forecast.csv', 'Forecast*.csv'],
    actualsPrevCurrent: [
      'WoW_Export_SLG_Actuals_PrevQ_Current.csv',
      'Actuals_Prev_Current*.csv',
      'Actuals_Prev*Current*.csv',
      '*PrevQ*Current*.csv'
    ],
    actualsHistorical: [
      'WoW_Export_SLG_Actuals_Historical.csv',
      'Actuals_Historical*.csv',
      'Actuals_Historical*.xlsx'
    ],
    utilization: [
      'SLG Utilization Export_Quarter.csv',
      'SLG Utilization Export_Quarter*.csv',
      '*Utilization*Quarter*.csv'
    ]
  };

  return {
    PIPELINE_ID: PIPELINE_ID,
    TRANSFORMER_VERSION: TRANSFORMER_VERSION,
    OUT_FORECAST: OUT_FORECAST,
    OUT_UNSTAFFED: OUT_UNSTAFFED,
    OUT_ACTUALS: OUT_ACTUALS,
    OUT_UTIL: OUT_UTIL,
    OUT_HISTORY: OUT_HISTORY,
    OUT_XORG: OUT_XORG,
    OUT_MANIFEST: OUT_MANIFEST,
    UTIL_COLS: UTIL_COLS,
    MEAS_FSQ: MEAS_FSQ,
    MEAS_TWH: MEAS_TWH,
    ACTCUR_COLS: ACTCUR_COLS,
    HIST_COLS: HIST_COLS,
    XORG_COLS: XORG_COLS,
    MANIFEST_COLS: MANIFEST_COLS,
    BATCH_FILE_PATTERNS: BATCH_FILE_PATTERNS
  };
})();
