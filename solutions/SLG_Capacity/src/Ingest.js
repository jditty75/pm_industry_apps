/**
 * WFM.21-deprecated: retained for rollback, no longer wired to primary Admin flow.
 * Ingest an uploaded PSA .xlsx file (base64) into the active spreadsheet,
 * replacing the PSA sheet, then normalize it.
 *
 * Returns: { filename, rowsIn, rowsOut, weeksDetected, warnings }
 */
function uploadStaffFile(base64, filename) {
  if (!base64) {
    throw new Error('No file content received.');
  }

  // 1) Decode the base64 string to a Blob (Excel)
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename || 'psa_upload.xlsx'
  );

  // 2) Create a native Google Sheet from this blob (with conversion)
  // using the Advanced Drive service.
  var gsFile = Drive.Files.insert(
    {
      title: filename || 'PSA Upload',
      mimeType: 'application/vnd.google-apps.spreadsheet'
    },
    blob
  );
  var gsId = gsFile.id;

  try {
    // 3) Open the converted Google Sheet
    var tempSs = SpreadsheetApp.openById(gsId);

    // 4) Find PSA sheet (or first sheet if no PSA tab)
    var srcSheet = tempSs.getSheetByName('PSA') || tempSs.getSheets()[0];
    if (!srcSheet) {
      throw new Error('Uploaded file has no sheets.');
    }

    // 5) Copy values into PSA in the active spreadsheet
    var destSs = SpreadsheetApp.getActiveSpreadsheet();
    var destSheet = destSs.getSheetByName(STAFF_SHEET); // STAFF_SHEET = 'PSA'
    if (!destSheet) {
      destSheet = destSs.insertSheet(STAFF_SHEET);
    } else {
      destSheet.clear();
    }

    // Raw PSA values from upload
    var values = srcSheet.getDataRange().getValues();

    // Apply Config_Ingest_Filters (config‑driven ingest scoping)
    var filtered = applyIngestFilters_(values);
    var rowsIn = Math.max((filtered.length || 0) - 1, 0); // data rows after filter

    if (filtered.length) {
      destSheet
        .getRange(1, 1, filtered.length, filtered[0].length)
        .setValues(filtered);
    }

    // 6) Normalize PSA into Allocations_Normalized
    var normResult = normalizeStaff();
    return {
      filename: filename || gsFile.title,
      rowsIn: rowsIn,
      rowsOut: normResult.rowsOut || 0,
      weeksDetected: normResult.weeksDetected || 0,
      warnings: normResult.warnings || []
    };
  } finally {
    // 7) Clean up the temporary Google Sheet
    try {
      DriveApp.getFileById(gsId).setTrashed(true);
    } catch (e) {
      // ignore cleanup failures
    }
  }
}

/**
 * WFM.21-deprecated: retained for rollback, no longer wired to primary Admin flow.
 * Ingest an uploaded actuals .xlsx file (base64) into the active spreadsheet,
 * replacing the Actuals sheet, then normalize it.
 *
 * Returns: { filename, rowsIn, rowsOut, weeksDetected, warnings }
 */
function uploadActualsFile(base64, filename) {
  if (!base64) {
    throw new Error('No file content received.');
  }

  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename || 'actuals_upload.xlsx'
  );

  var gsFile = Drive.Files.insert(
    {
      title: filename || 'Actuals Upload',
      mimeType: 'application/vnd.google-apps.spreadsheet'
    },
    blob
  );
  var gsId = gsFile.id;

  try {
    var tempSs = SpreadsheetApp.openById(gsId);

    var srcSheet = tempSs.getSheetByName('Actuals') || tempSs.getSheets()[0];
    if (!srcSheet) {
      throw new Error('Uploaded file has no sheets.');
    }

    var destSs = SpreadsheetApp.getActiveSpreadsheet();
    var destSheet = destSs.getSheetByName('Actuals');
    if (!destSheet) {
      destSheet = destSs.insertSheet('Actuals');
    } else {
      destSheet.clear();
    }

    var values = srcSheet.getDataRange().getValues();
    var rowsIn = Math.max((values.length || 0) - 1, 0);

    if (values.length) {
      destSheet
        .getRange(1, 1, values.length, values[0].length)
        .setValues(values);
    }

    var normResult = normalizeActuals();
    return {
      filename: filename || gsFile.title,
      rowsIn: rowsIn,
      rowsOut: normResult.rowsOut || 0,
      weeksDetected: normResult.weeksDetected || 0,
      warnings: normResult.warnings || []
    };
  } finally {
    try {
      DriveApp.getFileById(gsId).setTrashed(true);
    } catch (e) {
      // ignore cleanup failures
    }
  }
}

/** @const {string[]} Staged actuals columns (source_row added at write time). */
var ACTUALS_CURRENT_STAGED_HEADERS_ = ACTUALS_HEADERS.filter(function (h) {
  return h !== 'source_row';
});

/** @const {string[]} Data sheets validated against _manifest (excludes _manifest). */
var CONSOLIDATED_DATA_SHEETS_ = CONSOLIDATED_REQUIRED_SHEETS.filter(function (s) {
  return s !== '_manifest';
});

/**
 * PSA context columns required on wide Forecast_Staged (resolved via Config_ColumnAliases).
 * @const {string[]}
 */
var FORECAST_STAGED_REQUIRED_LOGICAL_ = [
  'employee_id', 'resource_name', 'team', 'practice', 'manager', 'job_profile',
  'role_category', 'resource_type', 'project_role', 'account_name', 'project_name',
  'engagement_manager', 'flag_customer', 'flag_internal', 'flag_education',
  'region_worker', 'region_project'
];

/** @const {Object<string,string>} Default PSA header names when alias sheet is absent. */
var FORECAST_STAGED_DEFAULT_ACTUAL_ = {
  employee_id: 'Employee ID',
  resource_name: 'Worker',
  team: 'Specialty Practice',
  practice: 'Customer Segment Practice',
  manager: "Worker's Manager",
  job_profile: 'Job Profile',
  role_category: 'Project Role Category',
  resource_type: 'Resource Type',
  project_role: 'Project Role',
  account_name: 'Account',
  project_name: 'Project',
  engagement_manager: 'Engagement Manager',
  flag_customer: 'Customer Projects',
  flag_internal: 'Internal Projects (Excludes Education)',
  flag_education: 'Education Projects',
  region_worker: 'Region - Worker',
  region_project: 'Project Region'
};

/**
 * Log elapsed ms for consolidated-upload phase timing (WFM.21.1 instrumentation).
 * @param {string} label phase name
 * @param {number} t0 phase start timestamp (Date.getTime())
 * @param {string} [detail] optional row-count or note
 * @return {number} current timestamp for chaining
 * @private
 */
function _logConsolidatedPhase_(label, t0, detail) {
  var now = new Date().getTime();
  var msg = 'uploadConsolidatedWorkbook [PHASE] ' + label + ': ' + (now - t0) + 'ms';
  if (detail) msg += ' (' + detail + ')';
  Logger.log(msg);
  return now;
}

/**
 * Ingest a consolidated workbook (base64) with full preflight validation.
 * Writes Forecast → PSA + normalizeStaff, actuals, summary, utilization
 * quarterly, and history tables on success.
 *
 * @param {string} base64 uploaded .xlsx content
 * @param {string} [filename] original filename
 * @return {{success:boolean, filename:string,
 *   preflight:{passed:boolean, checks:Object[]}, written:Object|null, warnings:string[]}}
 */
function uploadConsolidatedWorkbook(base64, filename) {
  var safeName = String(filename || 'consolidated_upload.xlsx');
  var warnings = [];
  var gsId = null;
  var tAll = new Date().getTime();
  var tPhase = tAll;

  try {
    if (!base64) {
      return _buildConsolidatedResult_(false, safeName, {
        passed: false,
        checks: [{ label: 'Input', passed: false, detail: 'No file content received.' }]
      }, null, warnings);
    }

    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      safeName
    );

    var gsFile = Drive.Files.insert(
      {
        title: safeName,
        mimeType: 'application/vnd.google-apps.spreadsheet'
      },
      blob
    );
    gsId = gsFile.id;
    safeName = String(filename || gsFile.title || safeName);

    var tempSs = SpreadsheetApp.openById(gsId);
    tPhase = _logConsolidatedPhase_('drive_conversion', tPhase, safeName);

    var preflight = runConsolidatedPreflight_(tempSs, warnings);
    tPhase = _logConsolidatedPhase_('preflight', tPhase);
    if (!preflight.passed) {
      _logConsolidatedPhase_('total_elapsed', tAll, 'preflight_failed');
      return _buildConsolidatedResult_(false, safeName, preflight, null, warnings);
    }

    var written = writeConsolidatedWorkbook_(preflight.data, warnings);
    tPhase = _logConsolidatedPhase_('destination_writes_total', tPhase);

    try {
      if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_();
    } catch (e) {
      Logger.log('uploadConsolidatedWorkbook: invalidateEnrichedCaches_ failed — ' + e);
    }
    tPhase = _logConsolidatedPhase_('invalidate_enriched_caches_post_write', tPhase);

    _logConsolidatedPhase_('total_elapsed', tAll, 'success');
    return _buildConsolidatedResult_(true, safeName, preflight, written, warnings);
  } catch (e) {
    Logger.log('uploadConsolidatedWorkbook: unexpected error — ' + e);
    _logConsolidatedPhase_('total_elapsed', tAll, 'error');
    return _buildConsolidatedResult_(false, safeName, {
      passed: false,
      checks: [{ label: 'Unexpected error', passed: false, detail: String(e) }]
    }, null, warnings);
  } finally {
    if (gsId) {
      try {
        DriveApp.getFileById(gsId).setTrashed(true);
      } catch (e) {
        // ignore cleanup failures
      }
    }
  }
}

/**
 * Build the wire-safe consolidated-upload result (no sheet data, no Dates).
 * @param {boolean} success
 * @param {string} filename
 * @param {{passed:boolean, checks:Object[]}} preflight
 * @param {Object|null} written
 * @param {string[]} warnings
 * @return {Object}
 * @private
 */
function _buildConsolidatedResult_(success, filename, preflight, written, warnings) {
  var checks = (preflight && preflight.checks) ? preflight.checks.map(function (c) {
    return {
      label: String((c && (c.label || c.check)) || ''),
      passed: !!(c && c.passed),
      detail: String((c && c.detail) || '')
    };
  }) : [];
  var result = {
    success: !!success,
    filename: String(filename || ''),
    preflight: {
      passed: !!(preflight && preflight.passed),
      checks: checks
    },
    written: written ? {
      forecastRowsOut: Number(written.forecastRowsOut) || 0,
      actualsRowsOut: Number(written.actualsRowsOut) || 0,
      summaryRowsOut: Number(written.summaryRowsOut) || 0,
      utilQuarterlyRows: Number(written.utilQuarterlyRows) || 0,
      historyRows: Number(written.historyRows) || 0,
      unstaffedDemandRowsOut: Number(written.unstaffedDemandRowsOut) || 0
    } : null,
    warnings: (warnings || []).map(function (w) { return String(w); })
  };
  return _sanitizeConsolidatedResult_(result);
}

/**
 * Recursively strip non-serializable values for google.script.run transport.
 * @param {*} value
 * @return {*}
 * @private
 */
function _sanitizeWireValue_(value) {
  if (value === undefined) return '';
  if (value === null) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : weekKey_(value);
  }
  if (Array.isArray(value)) {
    return value.map(function (v) { return _sanitizeWireValue_(v); });
  }
  if (typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) {
      out[k] = _sanitizeWireValue_(value[k]);
    });
    return out;
  }
  if (typeof value === 'number' && !isFinite(value)) return 0;
  return value;
}

/**
 * @param {Object} obj
 * @return {Object}
 * @private
 */
function _sanitizeConsolidatedResult_(obj) {
  return _sanitizeWireValue_(obj);
}

/**
 * Run all consolidated-workbook preflight checks. Does not write anything.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} tempSs converted upload
 * @param {string[]} warnings non-fatal warnings collector
 * @return {{passed:boolean, checks:Object[], data:Object}}
 * @private
 */
function runConsolidatedPreflight_(tempSs, warnings) {
  var checks = [];
  var data = {};
  var failed = false;

  function recordCheck(name, passed, detail) {
    checks.push({ label: name, passed: passed, detail: detail || '' });
    if (!passed) failed = true;
  }

  CONSOLIDATED_REQUIRED_SHEETS.forEach(function (sheetName) {
    var sh = tempSs.getSheetByName(sheetName);
    var present = !!sh;
    recordCheck('sheet_present:' + sheetName, present,
      present ? '' : 'Missing required sheet "' + sheetName + '"');
    if (present) {
      data[sheetName] = sh.getDataRange().getValues();
    }
  });

  if (failed) {
    return { passed: false, checks: checks, data: data };
  }

  var unstaffedSh = tempSs.getSheetByName(UNSTAFFED_DEMAND_SHEET);
  if (unstaffedSh) {
    data[UNSTAFFED_DEMAND_SHEET] = unstaffedSh.getDataRange().getValues();
    recordCheck('sheet_present:' + UNSTAFFED_DEMAND_SHEET, true,
      'Optional sheet present (' + Math.max(data[UNSTAFFED_DEMAND_SHEET].length - 1, 0) + ' data rows)');
  }

  var xorgSh = tempSs.getSheetByName(XORG_FORECAST_AGGREGATE);
  if (xorgSh) {
    data[XORG_FORECAST_AGGREGATE] = xorgSh.getDataRange().getValues();
    recordCheck('sheet_present:' + XORG_FORECAST_AGGREGATE, true,
      Math.max(data[XORG_FORECAST_AGGREGATE].length - 1, 0) + ' data rows (empty is valid)');
    validateSheetHeadersStrict_(
      XORG_FORECAST_AGGREGATE, data[XORG_FORECAST_AGGREGATE],
      XORG_FORECAST_AGGREGATE_HEADERS, recordCheck
    );
  } else {
    recordCheck('sheet_present:' + XORG_FORECAST_AGGREGATE, true,
      'Optional sheet absent — app tab will be cleared on write');
  }

  validateForecastStagedHeaders_(data.Forecast_Staged, recordCheck, warnings);
  validateSheetHeadersStrict_(
    'Actuals_Current_Normalized', data.Actuals_Current_Normalized,
    ACTUALS_CURRENT_STAGED_HEADERS_, recordCheck
  );
  validateSheetHeadersStrict_(
    'Utilization_Normalized', data.Utilization_Normalized,
    UTIL_QUARTERLY_HEADERS, recordCheck
  );
  validateSheetHeadersStrict_(
    'History_Normalized', data.History_Normalized,
    ACTUALS_HISTORY_HEADERS, recordCheck
  );

  var manifestMap = parseConsolidatedManifest_(data._manifest, recordCheck);
  if (!failed && manifestMap) {
    validateConsolidatedManifestTotals_(
      data, manifestMap, recordCheck, warnings
    );
  }

  validateConsolidatedWeekKeys_(
    data.Actuals_Current_Normalized, 'Actuals_Current_Normalized', recordCheck
  );
  validateForecastWeekColumns_(data.Forecast_Staged, recordCheck);
  validateNoBlankEmployeeIds_(data, recordCheck);
  validateUtilizationQuarterCount_(data.Utilization_Normalized, recordCheck);

  return { passed: !failed, checks: checks, data: data };
}

/**
 * @param {Array[]} values sheet values including header
 * @param {Function} recordCheck
 * @param {string[]} warnings
 * @private
 */
function validateForecastStagedHeaders_(values, recordCheck, warnings) {
  if (!values || values.length < 1) {
    recordCheck('headers:Forecast_Staged', false, 'Sheet is empty');
    return;
  }
  var header = values[0];
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var aliasMap = getAliasMap_();
  var missing = [];
  FORECAST_STAGED_REQUIRED_LOGICAL_.forEach(function (logical) {
    var actual = aliasMap[logical] || FORECAST_STAGED_DEFAULT_ACTUAL_[logical] || logical;
    if (!idx.hasOwnProperty(actual)) missing.push(actual);
  });
  recordCheck(
    'headers:Forecast_Staged',
    missing.length === 0,
    missing.length ? 'Missing PSA columns: ' + missing.join(', ') : ''
  );

  var weekDetection = detectWeekColumns_(header);
  weekDetection.warnings.forEach(function (w) {
    warnings.push('Forecast_Staged: ' + w);
  });
  recordCheck(
    'headers:Forecast_Staged_weeks',
    weekDetection.weeks.length > 0,
    'No weekly columns detected (expected MM/DD/YYYY week headers)'
  );
}

/**
 * @param {string} sheetName
 * @param {Array[]} values
 * @param {string[]} expectedHeaders
 * @param {Function} recordCheck
 * @private
 */
function validateSheetHeadersStrict_(sheetName, values, expectedHeaders, recordCheck) {
  if (!values || values.length < 1) {
    recordCheck('headers:' + sheetName, false, 'Sheet is empty');
    return;
  }
  var header = values[0].map(function (h) { return String(h).trim(); });
  var ok = header.length >= expectedHeaders.length;
  var detail = '';
  if (ok) {
    for (var i = 0; i < expectedHeaders.length; i++) {
      if (header[i] !== expectedHeaders[i]) {
        ok = false;
        detail = 'Column ' + (i + 1) + ' expected "' + expectedHeaders[i] +
          '" got "' + header[i] + '"';
        break;
      }
    }
  } else {
    detail = 'Expected ' + expectedHeaders.length + ' header columns, got ' + header.length;
  }
  recordCheck('headers:' + sheetName, ok, detail);
}

/**
 * @param {Array[]} manifestValues
 * @param {Function} recordCheck
 * @return {Object<string,{rows:number, primary_measure:string, primary_total:number,
 *   distinct_workers:number, min_period:string, max_period:string}>|null}
 * @private
 */
function parseConsolidatedManifest_(manifestValues, recordCheck) {
  if (!manifestValues || manifestValues.length < 2) {
    recordCheck('manifest:parse', false, '_manifest has no data rows');
    return null;
  }
  var header = manifestValues[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var iSheet = header.indexOf('sheet');
  var iRows = header.indexOf('rows');
  var iMeasure = header.indexOf('primary_measure');
  var iTotal = header.indexOf('primary_total');
  var iWorkers = header.indexOf('distinct_workers');
  var iMinPeriod = header.indexOf('min_period');
  var iMaxPeriod = header.indexOf('max_period');
  if (iSheet < 0 || iRows < 0 || iTotal < 0 || iMinPeriod < 0 || iMaxPeriod < 0) {
    recordCheck(
      'manifest:parse', false,
      '_manifest must have sheet, rows, primary_total, min_period, max_period columns'
    );
    return null;
  }

  var map = {};
  for (var r = 1; r < manifestValues.length; r++) {
    var row = manifestValues[r];
    var sheetKey = String(row[iSheet] || '').trim();
    if (!sheetKey) continue;
    map[sheetKey] = {
      rows: Number(row[iRows]) || 0,
      primary_measure: iMeasure >= 0 ? String(row[iMeasure] || '').trim() : '',
      primary_total: Number(row[iTotal]) || 0,
      distinct_workers: iWorkers >= 0 ? Number(row[iWorkers]) || 0 : 0,
      min_period: normalizeManifestPeriod_(row[iMinPeriod], sheetKey),
      max_period: normalizeManifestPeriod_(row[iMaxPeriod], sheetKey)
    };
  }
  recordCheck('manifest:parse', true, Object.keys(map).length + ' sheet entries');
  return map;
}

/**
 * Normalize a _manifest min_period / max_period cell for comparison.
 * Forecast/Actuals: canonical ISO date (YYYY-MM-DD). Utilization/History: fiscal-quarter key.
 * @param {*} value manifest period cell
 * @param {string} sheetName manifest sheet key
 * @return {string}
 * @private
 */
function normalizeManifestPeriod_(value, sheetName) {
  if (!value && value !== 0) return '';
  if (sheetName === 'Utilization_Normalized' || sheetName === 'History_Normalized') {
    return String(value).trim();
  }
  return normalizeManifestWeek_(value);
}

/**
 * @param {*} value manifest week cell
 * @return {string} canonical YYYY-MM-DD or ''
 * @private
 */
function normalizeManifestWeek_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return weekKey_(value);
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return weekKey_(new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  }
  return s;
}

/**
 * @param {Object} data parsed sheet values keyed by sheet name
 * @param {Object} manifestMap
 * @param {Function} recordCheck
 * @param {string[]} warnings
 * @private
 */
function validateConsolidatedManifestTotals_(data, manifestMap, recordCheck, warnings) {
  CONSOLIDATED_DATA_SHEETS_.forEach(function (sheetName) {
    var expected = manifestMap[sheetName];
    if (!expected) {
      recordCheck('manifest:entry:' + sheetName, false, 'No _manifest row for ' + sheetName);
      return;
    }
    var values = data[sheetName];
    var dataRows;
    var actualTotal;
    var actualMin = '';
    var actualMax = '';

    if (sheetName === 'Forecast_Staged') {
      dataRows = countForecastDataRows_(values);
      var weekStats = getForecastWeekStats_(values, warnings);
      actualTotal = weekStats.total;
      actualMin = weekStats.earliest;
      actualMax = weekStats.latest;
    } else if (sheetName === 'Actuals_Current_Normalized') {
      dataRows = Math.max((values || []).length - 1, 0);
      actualTotal = sumConsolidatedPrimary_(sheetName, values, warnings);
      var actualsPeriod = getActualsPeriodRange_(values);
      actualMin = actualsPeriod.min;
      actualMax = actualsPeriod.max;
    } else if (sheetName === 'Utilization_Normalized' || sheetName === 'History_Normalized') {
      dataRows = Math.max((values || []).length - 1, 0);
      actualTotal = sumConsolidatedPrimary_(sheetName, values, warnings);
      var fqPeriod = getFiscalQuarterPeriodRange_(values);
      actualMin = fqPeriod.min;
      actualMax = fqPeriod.max;
    } else {
      dataRows = Math.max((values || []).length - 1, 0);
      actualTotal = sumConsolidatedPrimary_(sheetName, values, warnings);
    }

    var rowsOk = dataRows === expected.rows;
    var totalOk = compareManifestPrimaryTotal_(expected.primary_total, actualTotal);
    recordCheck(
      'manifest:rows:' + sheetName,
      rowsOk,
      'expected ' + expected.rows + ', actual ' + dataRows
    );
    recordCheck(
      'manifest:primary_total:' + sheetName,
      totalOk,
      'expected ' + expected.primary_total + ', actual ' + actualTotal
    );
    // Empty sheets have no period range (e.g. start-of-quarter Actuals_Current).
    if (dataRows === 0) {
      recordCheck(
        'manifest:min_period:' + sheetName,
        true,
        'skipped — empty sheet'
      );
      recordCheck(
        'manifest:max_period:' + sheetName,
        true,
        'skipped — empty sheet'
      );
    } else {
      recordCheck(
        'manifest:min_period:' + sheetName,
        !!expected.min_period && expected.min_period === actualMin,
        'expected ' + expected.min_period + ', actual ' + actualMin
      );
      recordCheck(
        'manifest:max_period:' + sheetName,
        !!expected.max_period && expected.max_period === actualMax,
        'expected ' + expected.max_period + ', actual ' + actualMax
      );
    }
  });
}

/**
 * Earliest/latest week_key from Actuals_Current_Normalized.
 * @param {Array[]} values
 * @return {{min:string, max:string}}
 * @private
 */
function getActualsPeriodRange_(values) {
  if (!values || values.length < 2) return { min: '', max: '' };
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var iWeekKey = idx.week_key;
  var iWeekStart = idx.week_start;
  var keys = [];
  data.forEach(function (row) {
    var k = '';
    if (iWeekKey !== undefined) k = String(row[iWeekKey] || '').trim();
    else if (iWeekStart !== undefined) k = weekKey_(row[iWeekStart]);
    if (k) keys.push(k);
  });
  if (!keys.length) return { min: '', max: '' };
  keys.sort();
  return { min: keys[0], max: keys[keys.length - 1] };
}

/**
 * Earliest/latest fiscal_quarter from Utilization_Normalized / History_Normalized.
 * @param {Array[]} values
 * @return {{min:string, max:string}}
 * @private
 */
function getFiscalQuarterPeriodRange_(values) {
  if (!values || values.length < 2) return { min: '', max: '' };
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var iFq = idx.fiscal_quarter;
  if (iFq === undefined) return { min: '', max: '' };
  var keys = [];
  data.forEach(function (row) {
    var fq = String(row[iFq] || '').trim();
    if (fq) keys.push(fq);
  });
  if (!keys.length) return { min: '', max: '' };
  keys.sort();
  return { min: keys[0], max: keys[keys.length - 1] };
}

/**
 * @param {string} sheetName
 * @param {Array[]} values
 * @param {string[]} warnings
 * @return {number}
 * @private
 */
function sumConsolidatedPrimary_(sheetName, values, warnings) {
  if (!values || values.length < 2) return 0;
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });

  if (sheetName === 'Forecast_Staged') {
    var weekDetection = detectWeekColumns_(header);
    weekDetection.warnings.forEach(function (w) { warnings.push(sheetName + ': ' + w); });
    var total = 0;
    data.forEach(function (row) {
      weekDetection.weeks.forEach(function (wc) {
        total += Number(row[wc.index]) || 0;
      });
    });
    return total;
  }

  var colBySheet = {
    Actuals_Current_Normalized: 'actual_icp_hours',
    Utilization_Normalized: 'target_hours',
    History_Normalized: 'worked_hours'
  };
  var col = colBySheet[sheetName];
  if (!col || idx[col] === undefined) return 0;
  var colIdx = idx[col];
  var sum = 0;
  data.forEach(function (row) {
    sum += Number(row[colIdx]) || 0;
  });
  return sum;
}

/**
 * Compare manifest primary_total against app-computed sum (0.1 tolerance).
 * @param {number} expected manifest primary_total
 * @param {number} actual app-computed sum
 * @return {boolean}
 * @private
 */
function compareManifestPrimaryTotal_(expected, actual) {
  return Math.abs(Number(expected) - Number(actual)) < 0.1;
}

/**
 * Count non-footer Forecast_Staged rows (non-blank Employee ID).
 * @param {Array[]} values
 * @return {number}
 * @private
 */
function countForecastDataRows_(values) {
  if (!values || values.length < 2) return 0;
  var header = values[0];
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var aliasMap = getAliasMap_();
  var empCol = aliasMap.employee_id || FORECAST_STAGED_DEFAULT_ACTUAL_.employee_id;
  var iEmp = idx[empCol];
  if (iEmp === undefined) return 0;
  var count = 0;
  for (var r = 1; r < values.length; r++) {
    var cell = values[r][iEmp];
    if (cell !== '' && cell !== null && cell !== undefined) count++;
  }
  return count;
}

/**
 * @param {Array[]} values
 * @param {string[]} warnings
 * @return {{weeks:Object[], total:number, earliest:string, latest:string}}
 * @private
 */
function getForecastWeekStats_(values, warnings) {
  if (!values || values.length < 1) {
    return { weeks: [], total: 0, earliest: '', latest: '' };
  }
  var header = values[0];
  var data = values.slice(1);
  var weekDetection = detectWeekColumns_(header);
  weekDetection.warnings.forEach(function (w) { warnings.push('Forecast_Staged: ' + w); });
  var total = 0;
  data.forEach(function (row) {
    weekDetection.weeks.forEach(function (wc) {
      total += Number(row[wc.index]) || 0;
    });
  });
  var earliest = weekDetection.weeks.length
    ? weekKey_(weekDetection.weeks[0].weekStart) : '';
  var latest = weekDetection.weeks.length
    ? weekKey_(weekDetection.weeks[weekDetection.weeks.length - 1].weekStart) : '';
  return { weeks: weekDetection.weeks, total: total, earliest: earliest, latest: latest };
}

/**
 * Validate Forecast_Staged weekly column headers are Saturday anchors.
 * @param {Array[]} values
 * @param {Function} recordCheck
 * @private
 */
function validateForecastWeekColumns_(values, recordCheck) {
  if (!values || values.length < 1) return;
  var header = values[0];
  var weekDetection = detectWeekColumns_(header);
  if (!weekDetection.weeks.length) return;

  for (var i = 0; i < weekDetection.weeks.length; i++) {
    var wc = weekDetection.weeks[i];
    var wsDate = weekStart_(wc.weekStart);
    if (wsDate.getDay() !== 6) {
      recordCheck(
        'week_saturday:Forecast_Staged',
        false,
        'Week column ' + weekKey_(wsDate) + ' is not a Saturday'
      );
      return;
    }
  }
  recordCheck(
    'week_saturday:Forecast_Staged',
    true,
    weekDetection.weeks.length + ' week columns checked'
  );
}

/**
 * @param {Array[]} values
 * @param {string} sheetName
 * @param {Function} recordCheck
 * @private
 */
function validateConsolidatedWeekKeys_(values, sheetName, recordCheck) {
  if (!values || values.length < 2) return;
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var iWeekStart = idx.week_start;
  var iWeekKey = idx.week_key;
  if (iWeekStart === undefined || iWeekKey === undefined) return;

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var ws = row[iWeekStart];
    if (!ws && ws !== 0) continue;
    var wsDate = weekStart_(ws);
    if (wsDate.getDay() !== 6) {
      recordCheck(
        'week_saturday:' + sheetName,
        false,
        'Row ' + (r + 2) + ': week_start ' + ws + ' is not a Saturday'
      );
      return;
    }
    var expectedKey = weekKey_(wsDate);
    var actualKey = String(row[iWeekKey] || '').trim();
    if (actualKey !== expectedKey) {
      recordCheck(
        'week_key:' + sheetName,
        false,
        'Row ' + (r + 2) + ': week_key "' + actualKey +
          '" does not match week_start "' + expectedKey + '"'
      );
      return;
    }
  }
  recordCheck('week_saturday:' + sheetName, true, data.length + ' rows checked');
  recordCheck('week_key:' + sheetName, true, data.length + ' rows checked');
}

/**
 * @param {Object} data
 * @param {Function} recordCheck
 * @private
 */
function validateNoBlankEmployeeIds_(data, recordCheck) {
  CONSOLIDATED_DATA_SHEETS_.forEach(function (sheetName) {
    var values = data[sheetName];
    if (!values || values.length < 2) {
      recordCheck('employee_id:' + sheetName, true, 'no data rows');
      return;
    }
    var header = values[0];
    var dataRows = values.slice(1);
    var idx = {};
    header.forEach(function (h, i) { idx[String(h).trim()] = i; });
    var iEmp;
    if (sheetName === 'Forecast_Staged') {
      var aliasMap = getAliasMap_();
      var empCol = aliasMap.employee_id || FORECAST_STAGED_DEFAULT_ACTUAL_.employee_id;
      iEmp = idx[empCol];
    } else {
      iEmp = idx.employee_id;
    }
    if (iEmp === undefined) {
      recordCheck('employee_id:' + sheetName, false, 'employee_id column not found');
      return;
    }
    for (var r = 0; r < dataRows.length; r++) {
      var cell = dataRows[r][iEmp];
      if (cell === '' || cell === null || cell === undefined) {
        recordCheck(
          'employee_id:' + sheetName,
          false,
          'Blank employee_id at row ' + (r + 2)
        );
        return;
      }
    }
    recordCheck('employee_id:' + sheetName, true, dataRows.length + ' rows checked');
  });
}

/**
 * @param {Array[]} values
 * @param {Function} recordCheck
 * @private
 */
function validateUtilizationQuarterCount_(values, recordCheck) {
  if (!values || values.length < 2) {
    recordCheck('utilization_quarters', false, 'Utilization_Normalized has no data rows');
    return;
  }
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var iFq = idx.fiscal_quarter;
  if (iFq === undefined) {
    recordCheck('utilization_quarters', false, 'fiscal_quarter column not found');
    return;
  }
  var quarters = {};
  data.forEach(function (row) {
    var fq = String(row[iFq] || '').trim();
    if (fq) quarters[fq] = true;
  });
  var count = Object.keys(quarters).length;
  recordCheck(
    'utilization_quarters',
    count === 3,
    'Expected 3 distinct fiscal_quarter values, found ' + count +
      ' (' + Object.keys(quarters).join(', ') + ')'
  );
}

/**
 * Write consolidated workbook data after successful preflight.
 * @param {Object} data parsed sheet values keyed by sheet name
 * @param {string[]} warnings
 * @return {Object}
 * @private
 */
function writeConsolidatedWorkbook_(data, warnings) {
  var t0 = new Date().getTime();
  var destSs = SpreadsheetApp.getActiveSpreadsheet();
  var forecastValues = data.Forecast_Staged;
  var destSheet = destSs.getSheetByName(STAFF_SHEET);
  if (!destSheet) {
    destSheet = destSs.insertSheet(STAFF_SHEET);
  } else {
    destSheet.clear();
  }
  if (forecastValues.length) {
    destSheet
      .getRange(1, 1, forecastValues.length, forecastValues[0].length)
      .setValues(forecastValues);
  }
  t0 = _logConsolidatedPhase_('write_forecast_psa_copy', t0,
    Math.max(forecastValues.length - 1, 0) + ' forecast rows, ' +
    (forecastValues[0] ? forecastValues[0].length : 0) + ' cols');

  var normResult = normalizeStaff();
  normResult.warnings.forEach(function (w) { warnings.push('normalizeStaff: ' + w); });
  t0 = _logConsolidatedPhase_('normalizeStaff', t0,
    (normResult.rowsIn || 0) + ' PSA rows in, ' + (normResult.rowsOut || 0) +
    ' alloc rows out (includes reconcileWorkerExclusions_ + invalidateEnrichedCaches_ + enriched-cache warm inside)');

  var actualsRowsOut = writeConsolidatedActuals_(data.Actuals_Current_Normalized);
  t0 = _logConsolidatedPhase_('write_actuals_normalized', t0, actualsRowsOut + ' rows');

  var summaryRowsOut = writeConsolidatedActualsSummary_(data.Utilization_Normalized);
  t0 = _logConsolidatedPhase_('write_actuals_worker_summary', t0, summaryRowsOut + ' rows');

  var utilQuarterlyRows = writeConsolidatedUtilQuarterly_(data.Utilization_Normalized);
  t0 = _logConsolidatedPhase_('write_utilization_quarterly', t0, utilQuarterlyRows + ' rows');

  var historyRows = writeConsolidatedHistory_(data.History_Normalized);
  t0 = _logConsolidatedPhase_('write_actuals_history', t0, historyRows + ' rows');

  var unstaffedRowsOut = writeConsolidatedUnstaffedDemand_(data[UNSTAFFED_DEMAND_SHEET]);
  t0 = _logConsolidatedPhase_('write_unstaffed_demand', t0, unstaffedRowsOut + ' rows');

  var xorgRowsOut = writeConsolidatedXorgForecast_(data[XORG_FORECAST_AGGREGATE]);
  _logConsolidatedPhase_('write_xorg_forecast_aggregate', t0, xorgRowsOut + ' rows');

  return {
    forecastRowsOut: normResult.rowsOut || 0,
    actualsRowsOut: actualsRowsOut,
    summaryRowsOut: summaryRowsOut,
    utilQuarterlyRows: utilQuarterlyRows,
    historyRows: historyRows,
    unstaffedDemandRowsOut: unstaffedRowsOut,
    xorgForecastRowsOut: xorgRowsOut
  };
}

/**
 * Copy Xorg_Forecast_Aggregate into the app tab (aggregate-only; not routed to Allocations_Normalized).
 * Empty sheet or absent upload clears the tab.
 * @param {Array[]|undefined} values sheet values including header
 * @return {number} data rows written (0 if empty/absent)
 * @private
 */
function writeConsolidatedXorgForecast_(values) {
  if (!values || values.length < 2) {
    writeTable_(XORG_FORECAST_AGGREGATE, XORG_FORECAST_AGGREGATE_HEADERS, []);
    invalidateCache_(XORG_FORECAST_AGGREGATE);
    return 0;
  }
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    out.push([
      String(row[idx.worker_group] || '').trim(),
      String(row[idx.region] || '').trim(),
      String(row[idx.fiscal_quarter] || '').trim(),
      Number(row[idx.forecast_hours]) || 0
    ]);
  }
  writeTable_(XORG_FORECAST_AGGREGATE, XORG_FORECAST_AGGREGATE_HEADERS, out);
  invalidateCache_(XORG_FORECAST_AGGREGATE);
  return out.length;
}

/**
 * Copy optional Unstaffed_Demand sheet verbatim into the app tab for review.
 * No normalization or downstream routing.
 * @param {Array[]|undefined} values sheet values including header
 * @return {number} data rows written (0 if sheet absent/empty)
 * @private
 */
function writeConsolidatedUnstaffedDemand_(values) {
  if (!values || !values.length) return 0;
  var destSs = SpreadsheetApp.getActiveSpreadsheet();
  var destSheet = destSs.getSheetByName(UNSTAFFED_DEMAND_SHEET);
  if (!destSheet) {
    destSheet = destSs.insertSheet(UNSTAFFED_DEMAND_SHEET);
  } else {
    destSheet.clear();
  }
  destSheet
    .getRange(1, 1, values.length, values[0].length)
    .setValues(values);
  return Math.max(values.length - 1, 0);
}

/**
 * @param {Array[]} values Actuals_Current_Normalized sheet values
 * @return {number} rows written
 * @private
 */
function writeConsolidatedActuals_(values) {
  if (!values || values.length < 2) {
    writeTable_(ACTUALS_NORM, ACTUALS_HEADERS, []);
    invalidateCache_(ACTUALS_NORM);
    return 0;
  }
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    out.push([
      String(row[idx.employee_id] || '').trim(),
      String(row[idx.resource_name] || '').trim(),
      row[idx.week_start],
      String(row[idx.week_key] || '').trim(),
      Number(row[idx.actual_icp_hours]) || 0,
      r + 2
    ]);
  }
  writeTable_(ACTUALS_NORM, ACTUALS_HEADERS, out);
  invalidateCache_(ACTUALS_NORM);
  return out.length;
}

/**
 * @param {Array[]} values Utilization_Normalized sheet values
 * @return {number} rows written
 * @private
 */
function writeConsolidatedActualsSummary_(values) {
  var curQ = fiscalQuarterKey_(new Date());
  if (!values || values.length < 2) {
    writeTable_(ACTUALS_SUMMARY, ACTUALS_SUMMARY_HEADERS, []);
    invalidateCache_(ACTUALS_SUMMARY);
    return 0;
  }
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var fq = String(row[idx.fiscal_quarter] || '').trim();
    if (fq !== curQ) continue;
    out.push([
      String(row[idx.employee_id] || '').trim(),
      String(row[idx.resource_name] || '').trim(),
      Number(row[idx.qtd_actual_icp]) || 0,
      Number(row[idx.qtd_icp_plus_forecast]) || 0,
      Number(row[idx.target_hours]) || 0,
      r + 2
    ]);
  }
  writeTable_(ACTUALS_SUMMARY, ACTUALS_SUMMARY_HEADERS, out);
  invalidateCache_(ACTUALS_SUMMARY);
  return out.length;
}

/**
 * @param {Array[]} values Utilization_Normalized sheet values
 * @return {number} rows written
 * @private
 */
function writeConsolidatedUtilQuarterly_(values) {
  if (!values || values.length < 2) {
    writeTable_(CFG_UTIL_QUARTERLY, UTIL_QUARTERLY_HEADERS, []);
    invalidateCache_(CFG_UTIL_QUARTERLY);
    return 0;
  }
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    out.push(UTIL_QUARTERLY_HEADERS.map(function (h) {
      if (h === 'employee_id' || h === 'resource_name' || h === 'fiscal_quarter' || h === 'source_sheet') {
        return String(row[idx[h]] || '').trim();
      }
      return row[idx[h]] !== undefined && row[idx[h]] !== '' ? row[idx[h]] : '';
    }));
  }
  writeTable_(CFG_UTIL_QUARTERLY, UTIL_QUARTERLY_HEADERS, out);
  invalidateCache_(CFG_UTIL_QUARTERLY);
  return out.length;
}

/**
 * @param {Array[]} values History_Normalized sheet values
 * @return {number} rows written
 * @private
 */
function writeConsolidatedHistory_(values) {
  if (!values || values.length < 2) {
    writeTable_(ACTUALS_HISTORY, ACTUALS_HISTORY_HEADERS, []);
    invalidateCache_(ACTUALS_HISTORY);
    return 0;
  }
  var header = values[0];
  var data = values.slice(1);
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var out = [];
  var iRegion = idx['workday_region_as_of_date_worked'];
  if (iRegion === undefined) iRegion = idx['Region as of Date Worked'];

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    out.push(ACTUALS_HISTORY_HEADERS.map(function (h) {
      if (h === 'worked_hours') {
        return Number(row[idx[h]]) || 0;
      }
      if (h === 'workday_region_as_of_date_worked') {
        return iRegion !== undefined ? String(row[iRegion] || '').trim() : '';
      }
      if (h === 'specialty_practice' || h === 'sub_specialty_practice') {
        var spVal = idx[h] !== undefined ? String(row[idx[h]] || '').trim() : '';
        return spVal || 'Unclassified';
      }
      return String(row[idx[h]] || '').trim();
    }));
  }
  writeTable_(ACTUALS_HISTORY, ACTUALS_HISTORY_HEADERS, out);
  invalidateCache_(ACTUALS_HISTORY);
  return out.length;
}

/**
 * Authorized API entry for consolidated workbook upload (WFM.21).
 * @param {string} base64 uploaded .xlsx content
 * @param {string} [filename] original filename
 * @return {Object}
 */
function api_uploadConsolidatedWorkbook(base64, filename) {
  _requireAuthorized_();
  return uploadConsolidatedWorkbook(base64, filename);
}

/**
 * WFM.21-deprecated: retained for rollback, no longer wired to primary Admin flow.
 * Normalize actuals from the Actuals sheet to Actuals_Normalized and
 * Actuals_Worker_Summary.
 */
function normalizeActuals() {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName('Actuals');
  if (!src) throw new Error('Missing sheet: Actuals');
  const values = src.getDataRange().getValues();
  if (values.length < 2) {
    writeTable_(ACTUALS_NORM, ACTUALS_HEADERS, []);
    invalidateCache_(ACTUALS_NORM);
    try { if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_(); } catch(e){}
    return { rowsIn: 0, rowsOut: 0, weeksDetected: 0, warnings: [] };
  }
  const header = values.shift();
  const idx = {};
  header.forEach((h, i) => { idx[String(h).trim()] = i; });

  const iEmpId  = idx['Employee ID'] ?? -1;
  const iWorker = idx['Worker'] ?? -1;
  if (iEmpId < 0) throw new Error('Actuals: no "Employee ID" column found.');

  const iQtd = idx['QTD actual ICP hours'] ?? -1;
  const iQtdIcpPlusForecast = idx['QTD ICP Hours + Forecast Hours'] ?? -1;
  const iBonusTarget = idx['Bonus target billable hours at EoQ'] ?? -1;

  const weekDetection = detectWeekColumns_(header);
  const weeks = weekDetection.weeks;
  if (!weeks.length) {
    throw new Error('Actuals: no weekly columns detected (expected Date/MM-DD-YYYY headers).');
  }
  weekDetection.warnings.forEach(w => Logger.log('normalizeActuals: ' + w));

  try {
    const added = ensureCalendarWeeks_(weeks.map(w => w.weekStart));
    if (added) Logger.log('normalizeActuals: added ' + added + ' week(s) to Config_Calendar');
  } catch (e) { Logger.log('normalizeActuals: ensureCalendarWeeks_ failed — ' + e); }

  const out = [];
  const summaryOut = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (iEmpId < 0 || (!row[iEmpId] && row[iEmpId] !== 0)) continue;
    const empId = String(row[iEmpId]).trim();
    const worker = iWorker >= 0 ? String(row[iWorker] || '').trim() : '';
    summaryOut.push([
      empId,
      worker,
      iQtd >= 0 ? Number(row[iQtd]) || 0 : '',
      iQtdIcpPlusForecast >= 0 ? Number(row[iQtdIcpPlusForecast]) || 0 : '',
      iBonusTarget >= 0 ? Number(row[iBonusTarget]) || 0 : '',
      r + 2
    ]);
    for (let k = 0; k < weeks.length; k++) {
      const wc = weeks[k];
      const hrs = Number(row[wc.index]);
      if (!hrs) continue;
      out.push([ empId, worker, wc.weekStart, weekKey_(wc.weekStart), hrs, r + 2 ]);
    }
  }
  writeTable_(ACTUALS_NORM, ACTUALS_HEADERS, out);
  writeTable_(ACTUALS_SUMMARY, ACTUALS_SUMMARY_HEADERS, summaryOut);
  invalidateCache_(ACTUALS_NORM);
  invalidateCache_(ACTUALS_SUMMARY);
  try { if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_(); } catch(e){}
  return { rowsIn: values.length, rowsOut: out.length, weeksDetected: weeks.length, warnings: weekDetection.warnings };
}

/**
 * Build a logical->actual column name map from Config_ColumnAliases.
 * Each row in Config_ColumnAliases should have:
 *   logical | actual
 */
function getAliasMap_() {
  let rows;
  try {
    rows = readTable_(CFG_ALIAS);
  } catch (e) {
    // If alias sheet is missing, just return empty map.
    return {};
  }
  const m = {};
  rows.forEach(a => {
    const logical = String(a.logical || '').trim();
    const actual  = String(a.actual  || '').trim();
    if (logical && actual) {
      m[logical] = actual;
    }
  });
  return m;
}

/**
 * Load Config_Ingest_Filters into normalized rules:
 *   { logical, group, operator, mode, values[] }
 */
function getIngestFilters_() {
  let rows;
  try {
    rows = readTable_(CFG_INGEST);
  } catch (e) {
    // No filter sheet => no filtering
    return [];
  }
  const rules = [];
  rows.forEach(r => {
    const logical = String(r.logical_field || '').trim();
    const group   = String(r.group || 'default').trim() || 'default';
    const op      = String(r.operator || '').trim().toLowerCase();
    const mode    = String(r.mode || '').trim().toLowerCase() || 'include';
    const raw     = String(r.value || '').trim();
    if (!logical || !op || !raw) return;

    const parts = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (!parts.length) return;

    rules.push({
      logical: logical,
      group:   group,
      operator: op,
      mode:     mode,   // 'include' or 'exclude'
      values:   parts
    });
  });
  return rules;
}

/**
 * Apply Config_Ingest_Filters to raw PSA values BEFORE writing to PSA sheet.
 * - Supports OR-style includes within each group, AND across groups.
 * - groups: rules with the same "group" value.
 *
 * values: 2D array from getDataRange().getValues()
 * Returns filtered 2D array (header row + data).
 */
function applyIngestFilters_(values) {
  if (!values || values.length < 2) return values;

  const header = values[0];
  const data   = values.slice(1);

  const idx = {};
  header.forEach((h, i) => {
    idx[String(h || '').trim()] = i;
  });

  const aliasMap = getAliasMap_(); // logical -> actual header
  const filters  = getIngestFilters_();
  if (!filters.length) return values;

  // Pre-resolve each filter's column index using aliases where present
  const resolved = filters
    .map(f => {
      const actualHeader = aliasMap[f.logical] || f.logical;
      const colIndex     = idx[actualHeader];
      if (colIndex === undefined) return null; // skip filters whose column isn't present
      return Object.assign({}, f, { colIndex: colIndex });
    })
    .filter(Boolean);

  if (!resolved.length) return values;

  // Group rules by group name for OR-within-group, AND-across-groups
  const groups = {};
  resolved.forEach(r => {
    const g = r.group || 'default';
    if (!groups[g]) groups[g] = [];
    groups[g].push(r);
  });

  function rowMatches(row) {
    const groupNames = Object.keys(groups);
    if (!groupNames.length) return true;

    // All groups must pass
    for (let gi = 0; gi < groupNames.length; gi++) {
      const gName  = groupNames[gi];
      const rules  = groups[gName];

      let includeHit    = null; // null = no include rules; true/false = OR over includes

      for (let i = 0; i < rules.length; i++) {
        const rule   = rules[i];
        const rawVal = String(row[rule.colIndex] || '').trim().toLowerCase();
        const vals   = rule.values.map(v => v.toLowerCase());

        const inSet       = vals.includes(rawVal);
        const containsAny = vals.some(v => rawVal.indexOf(v) >= 0);
        const starts      = vals.some(v => rawVal.startsWith(v));
        const ends        = vals.some(v => rawVal.endsWith(v));

        let hit = false;
        switch (rule.operator) {
          case 'equals':       hit = inSet;        break;
          case 'not_equals':   hit = !inSet;       break;
          case 'in':           hit = inSet;        break;
          case 'not_in':       hit = !inSet;       break;
          case 'contains':     hit = containsAny;  break;
          case 'not_contains': hit = !containsAny; break;
          case 'starts_with':  hit = starts;       break;
          case 'ends_with':    hit = ends;         break;
          default:             hit = true;         break; // unknown operator => ignore
        }

        if (rule.mode === 'include') {
          // OR-semantics across include rules within a group: any include
          // hit means the include constraint passes. We still must finish
          // checking remaining rules in case one is an exclude.
          includeHit = (includeHit === null) ? hit : (includeHit || hit);
        } else if (rule.mode === 'exclude') {
          // Exclude rules short-circuit the entire group: any exclude
          // hit means the group fails immediately. No need to evaluate
          // remaining rules in this group.
          if (hit) {
            return false;
          }
        }
      }

      // If group has include rules (includeHit !== null), at least one must hit
      if (includeHit === false) return false;
      // If no include rules in this group (includeHit === null), the group passes by default
    }

    return true;
  }

  const filtered = data.filter(row => rowMatches(row));
  return [header].concat(filtered);
}

/**
 * Classify a PSA row into an allocation type.
 * - Treats "PTO/Holiday" and "(Blank)" as PTO_Holiday.
 * - Uses customer/internal/education flags otherwise.
 * - Any non-blank project with no flags is treated as Billable (committed).
 */
function classifyAllocation_(project, custFlag, intFlag, eduFlag) {
  const p = String(project || '').trim();

  // PTO / Holiday (also used by normalizeStaff for "(Blank)")
  if (p === 'PTO/Holiday' || p === '(Blank)') return 'PTO_Holiday';

  // Work-type flags from PSA export
  if (String(custFlag) === 'Yes') return 'Billable';
  if (String(intFlag) === 'Yes')  return 'Internal';
  if (String(eduFlag) === 'Yes')  return 'Education';

  // Any other row with a project name is still committed time;
  // treat it as Billable rather than Unassigned.
  if (p) return 'Billable';

  // Only truly empty/no-project rows should be Unassigned
  return 'Unassigned';
}

/**
 * Normalize a manager name by stripping known suffix tags like " (On Leave)".
 */
function normalizeManagerName_(name) {
  if (!name) return '';
  let n = String(name);
  // Strip literal " (On Leave)" suffix if present (case-sensitive)
  if (n.endsWith(' (On Leave)')) {
    n = n.slice(0, -' (On Leave)'.length);
  }
  return n.trim();
}

/**
 * Detect a PSA "(On Leave)" tag on a worker's name. Returns 'Yes' or ''.
 * WFM-FIX.3, Option A: the tag is authoritative for ADDING a worker to the
 * on_leave rule set (see reconcileWorkerExclusions_) -- untagged + present
 * + has project rows is the separate, safer signal for REMOVING one.
 * Does not alter resource_name; the suffix stays in the normalized row.
 * @param {string} workerName
 * @return {string} 'Yes' or ''
 */
function _deriveOnLeave_(workerName) {
  return /\(On Leave\)\s*$/i.test(String(workerName || '')) ? 'Yes' : '';
}

/**
 * Read SLG manager names from Config_SLG_Managers.
 * Returns a Set of lowercase manager names for matching.
 */
function getSlgManagers_() {
  let rows;
  try {
    rows = readTable_(CFG_SLG_MGRS);
  } catch (e) {
    return new Set();
  }
  const set = new Set();
  rows.forEach(r => {
    const raw  = r.manager_name;
    const norm = normalizeManagerName_(raw).toLowerCase();
    if (norm) set.add(norm);
  });
  return set;
}

/**
 * Classify worker_class for a PSA row.
 *
 * Order:
 *  1) External_Contractor  — Worker contains "[C]" (case-sensitive)
 *  2) External_NonSLG      — Project Region = Government AND manager not in SLG list
 *  3) SLG_Real             — Region - Worker = Government AND manager in SLG list
 *  4) ''                   — unclassified
 */
function classifyWorkerClass_(workerName, managerOrgKey, projectRegion, regionWorker, slgManagers) {
  const name = String(workerName || '');
  if (!name) return '';

  // Contractors: "[C]" anywhere in the name (case-sensitive)
  if (name.indexOf('[C]') >= 0) {
    return 'External_Contractor';
  }

  const mgrKey = String(managerOrgKey || '').trim().toLowerCase();
  const pr     = String(projectRegion || '').trim().toLowerCase();
  const rw     = String(regionWorker  || '').trim().toLowerCase();

  const isSlgMgr = mgrKey && slgManagers.has(mgrKey);

  // Non-SLG workers on Government projects
  if (pr === 'government' && !isSlgMgr) {
    return 'External_NonSLG';
  }

  // SLG real workers by Region - Worker
  if (rw === 'government' && isSlgMgr) {
    return 'SLG_Real';
  }

  return '';
}

/**
 * Classify ICP role (role code) from:
 * - Project Role Category (rc)
 * - Job Profile (jp)
 * - Project Role (pr)
 * - Resource Type (rt: ENGAGEMENT MANAGER, INTEGRATIONS, FUNCTIONAL)
 *
 * Returns codes like 'EM', 'PD', 'DA', 'CS_FUNC', 'CS_TECH', or '' if not recognized.
 */
function classifyIcpRole_(roleCategory, jobProfile, projectRole, resourceType) {
  const rc = String(roleCategory || '').trim();
  const jp = String(jobProfile  || '').toLowerCase();
  const pr = String(projectRole || '').toLowerCase();
  const rt = String(resourceType || '').toLowerCase(); // engagement manager, integrations, functional

  // DELIVERY: EM / PD / DA driven primarily by Project Role
  if (pr.indexOf('engagement manager') >= 0) {
    // Includes PS Engagement Manager, PS Senior Engagement Manager
    return 'EM';
  }
  if (pr.indexOf('project director') >= 0) {
    // PS Project Director
    return 'PD';
  }
  if (pr.indexOf('delivery assurance manager') >= 0) {
    // PS Delivery Assurance Manager
    return 'DA';
  }

  // FUNCTIONAL & TECHNICAL: consultants (CS) driven by Project Role + Resource Type
  const isConsultant =
    pr.indexOf('ps consultant')           >= 0 ||
    pr.indexOf('ps senior consultant')    >= 0 ||
    pr.indexOf('ps principal consultant') >= 0;

  if (isConsultant) {
    if (rt === 'functional')   return 'CS_FUNC';
    if (rt === 'integrations') return 'CS_TECH';
  }

  // Fallbacks based on Project Role Category / Job Profile (keeps original behavior)
  if (rc === 'Engagement Manager') return 'EM';
  if (rc === 'Project Director')   return 'PD';
  if (jp.indexOf('engagement manager') >= 0) return 'EM';
  if (jp.indexOf('project director')   >= 0) return 'PD';

  // Job Profile is authoritative for consultants regardless of resource_type.
  // (WFM-FIX.2: the previous "&& rt === ..." guard here dropped bench/
  // specialty workers whose Job Profile clearly stated their role family
  // -- e.g. "P4 Sr Functional Consultant" -- but whose resource_type wasn't
  // exactly 'functional'/'integrations', leaving 75% of SLG workers
  // Unclassified. Job Profile carries the canonical role family;
  // resource_type does not reliably. Validated 429/436 rows, 98.4%; the
  // 7 residual rows are management titles (Consulting Management, Program
  // Management) that stay blank by design and are handled via
  // Config_Worker_Exclusions.
  //
  // Order matters: "technical consultant" is checked before "functional
  // consultant" -- both are substrings of longer titles, but neither
  // contains the other, so order is safe (validated).
  if (jp.indexOf('technical consultant') >= 0) return 'CS_TECH';
  if (jp.indexOf('functional consultant') >= 0) return 'CS_FUNC';

  return '';
}

/**
 * Read Config_Worker_Role_Overrides directly from the sheet (no cache layer)
 * so newly-added columns can't be silently dropped by cachedRead_'s header
 * handling (cf. resolved bug #1 with Config_Resource_Type).
 *
 * Returns a map: { <lowercased worker_name> -> <override_icp_role> }.
 * Filters to only rows where active is truthy AND both worker_name and
 * override_icp_role are non-blank.
 *
 * Tolerant active matching (yes/y/true/t/1/x/active/on), same pattern
 * as readExclusions_ and readConfigPracticeManagers_.
 *
 * Used by normalizeStaff to override classifyIcpRole_'s output for
 * specific workers whose PSA Job Profile no longer matches their actual
 * SLG team assignment (e.g., legacy Deployment Strategy team members).
 *
 * Override applies at ingest time. Changes to the sheet require a
 * re-run of normalizeStaff (manual or via PSA upload) to take effect.
 *
 * Returns {} gracefully if the sheet is missing, empty, or malformed.
 */
function readWorkerRoleOverrides_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG_WORKER_ROLE_OVERRIDES);
  if (!sh) {
    Logger.log('readWorkerRoleOverrides_: sheet "' + CFG_WORKER_ROLE_OVERRIDES + '" not found.');
    return {};
  }
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return {};

  var header = values[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  var iName = header.indexOf('worker_name');
  var iIcp = header.indexOf('override_icp_role');
  var iActive = header.indexOf('active');

  if (iName < 0 || iIcp < 0) {
    Logger.log(
      'readWorkerRoleOverrides_: required headers (worker_name, override_icp_role) ' +
      'not found. Have: ' + JSON.stringify(values[0])
    );
    return {};
  }

  function _normCell_(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  var TRUTHY = {
    'yes': 1, 'y': 1, 'true': 1, 't': 1,
    '1': 1, 'x': 1, 'active': 1, 'on': 1
  };

  var map = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = _normCell_(row[iName]);
    if (!name) continue;
    var override = _normCell_(row[iIcp]);
    if (!override) continue;

    // Default active when column missing or blank — treat as active.
    if (iActive >= 0) {
      var rawActive = (row[iActive] === '' || row[iActive] === null || row[iActive] === undefined)
        ? 'Yes' : row[iActive];
      var active = _normCell_(rawActive).toLowerCase();
      if (!TRUTHY[active]) continue;
    }

    map[name.toLowerCase()] = override;
  }
  return map;
}

/**
 * Detect weekly PSA columns (weekly-forecast-migration; clean cutover --
 * monthly detection is no longer supported, see normalizeStaff's throw).
 *
 * Matches header cells that are real Date cells OR strings matching
 * MM/DD/YYYY (tolerates MM/DD/YY). Explicitly excludes a 'Total Hours'
 * column (case-insensitive) even if it were to otherwise match. Any other
 * non-date trailing column is naturally excluded by not matching.
 *
 * Sorts ascending by date and validates 7-day contiguity between
 * consecutive columns; gaps/duplicates are collected as warnings but do
 * NOT hard-fail (only a zero-weeks result hard-fails, in normalizeStaff).
 *
 * @param {Array} headerRow raw header row values (strings and/or Date objects)
 * @return {{weeks: Array<{index:number, weekStart:Date}>, warnings: string[]}}
 */
function detectWeekColumns_(headerRow) {
  const cols = [];
  const reMDYYYY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/; // MM/DD/YYYY
  const reMDYY   = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;  // MM/DD/YY

  headerRow.forEach((h, i) => {
    if (h === '' || h === null || h === undefined) return;

    // Header cells often arrive as real Date values (Sheets auto-converts
    // date-like header text on paste/import).
    if (Object.prototype.toString.call(h) === '[object Date]' && !isNaN(h.getTime())) {
      cols.push({ index: i, weekStart: weekStart_(h) });
      return;
    }

    const s = String(h).trim();
    if (!s) return;
    if (s.toLowerCase() === 'total hours') return; // explicit exclusion

    let m = s.match(reMDYYYY);
    if (m) {
      cols.push({ index: i, weekStart: new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) });
      return;
    }

    m = s.match(reMDYY);
    if (m) {
      let yy = Number(m[3]);
      yy += 2000; // MM/DD/YY heuristic, consistent with the old mY-format handling
      cols.push({ index: i, weekStart: new Date(yy, Number(m[1]) - 1, Number(m[2])) });
    }
  });

  cols.sort((a, b) => a.weekStart - b.weekStart);

  const warnings = [];
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  for (let i = 1; i < cols.length; i++) {
    const diffDays = Math.round((cols[i].weekStart - cols[i - 1].weekStart) / ONE_DAY_MS);
    if (diffDays === 0) {
      warnings.push('Duplicate week column: ' + weekKey_(cols[i].weekStart));
    } else if (diffDays !== 7) {
      warnings.push(
        'Non-contiguous week columns: ' + weekKey_(cols[i - 1].weekStart) +
        ' -> ' + weekKey_(cols[i].weekStart) + ' (' + diffDays + ' days apart, expected 7)'
      );
    }
  }

  return { weeks: cols, warnings: warnings };
}

/**
 * Normalize PSA staff allocations to Allocations_Normalized.
 * - Detects WEEKLY columns dynamically (detectWeekColumns_). Clean cutover:
 *   monthly exports are no longer supported -- see the throw below.
 * - Maps headers via Config_ColumnAliases.
 * - Treats "(Blank)" Project rows as "PTO/Holiday" PTO time.
 * - POPULATES account_name from the PSA "Account" column.
 * - Classifies worker_class based on Worker name, Region, and Manager.
 * - Backfills ICP_role per worker so PTO_Holiday and other blank rows
 *   inherit the worker's ICP role from non-PTO allocations.
 */
function normalizeStaff() {
  const ss  = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(STAFF_SHEET);
  if (!src) throw new Error('Missing sheet: ' + STAFF_SHEET);

  const values = src.getDataRange().getValues();
  if (values.length < 2) {
    writeTable_(ALLOC_NORM, ALLOC_HEADERS, []);
    logRefresh_('staff', 0, 0, 0, '');
    invalidateCache_(ALLOC_NORM);
    return { rowsIn: 0, rowsOut: 0, weeksDetected: 0, warnings: [] };
  }

  const header = values.shift();
  const idx = {};
  header.forEach((h, i) => { idx[String(h).trim()] = i; });

  const aliasMap = getAliasMap_();
  const slgManagers = getSlgManagers_();
  // Per-worker ICP role overrides (Config_Worker_Role_Overrides).
  // Applied after classifyIcpRole_ in the first pass below.
  const workerIcpOverrides = readWorkerRoleOverrides_();

  // Resolve logical -> actual column indices, using aliases where present
  const iEmpId      = idx[aliasMap['employee_id'] || 'Employee ID'] ?? -1;
  const iWorker     = idx[aliasMap['resource_name'] || 'Worker'] ?? -1;
  const iTeam       = idx[aliasMap['team'] || 'Specialty Practice'] ?? -1;
  const iPract      = idx[aliasMap['practice']       || 'Customer Segment Practice'] ?? -1;
  const iMgr        = idx[aliasMap['manager']        || "Worker's Manager"]          ?? -1;
  const iJob        = idx[aliasMap['job_profile']    || 'Job Profile']               ?? -1;
  const iRoleCat    = idx[aliasMap['role_category']  || 'Project Role Category']     ?? -1;
  const iResType    = idx[aliasMap['resource_type']  || 'Resource Type']             ?? -1;
  const iProjRole   = idx[aliasMap['project_role']   || 'Project Role']              ?? -1;
  const iEM         = idx[aliasMap['engagement_manager'] || 'Engagement Manager']    ?? -1;
  const iCust       = idx[aliasMap['flag_customer']  || 'Customer Projects']         ?? -1;
  const iInt        = idx[aliasMap['flag_internal']  || 'Internal Projects (Excludes Education)'] ?? -1;
  const iEdu        = idx[aliasMap['flag_education'] || 'Education Projects']        ?? -1;
  const iProject    = idx[aliasMap['project_name']   || 'Project']                   ?? -1;
  const iAccount    = idx[aliasMap['account_name']   || 'Account']                   ?? -1;
  const iRegionW    = idx[aliasMap['region_worker']  || 'Region - Worker']           ?? -1;
  const iProjRegion = idx[aliasMap['region_project'] || 'Project Region']            ?? -1;

  // Detect week columns (dynamic). Clean cutover: monthly exports are no
  // longer supported.
  const weekDetection = detectWeekColumns_(header);
  const weeks = weekDetection.weeks;
  if (!weeks.length) {
    throw new Error(
      'No weekly columns detected (expected MM/DD/YYYY week headers). ' +
      'Monthly exports are no longer supported.'
    );
  }
  weekDetection.warnings.forEach(function (w) {
    Logger.log('normalizeStaff: ' + w);
  });

  // Self-heal Config_Calendar coverage (weekly-forecast-migration): append
  // any week from THIS export that Config_Calendar doesn't already have a
  // row for, so readCalendar_()/computeWeeklyForecast_ always see every
  // week that Allocations_Normalized actually contains. See
  // ensureCalendarWeeks_ (Util.gs) for why this matters.
  try {
    const addedWeeks = ensureCalendarWeeks_(weeks.map(function (w) { return w.weekStart; }));
    if (addedWeeks) Logger.log('normalizeStaff: added ' + addedWeeks + ' new week(s) to Config_Calendar');
  } catch (e) {
    Logger.log('normalizeStaff: ensureCalendarWeeks_ failed \u2014 ' + e);
  }

  // First pass: determine per-worker canonical ICP role from non-PTO rows
  const workerIcp = {}; // worker_name -> icpRole
  const cache     = []; // cache per-row derived values so we don't recompute

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (iWorker < 0 || !row[iWorker]) continue; // skip blank worker rows

   // Normalize "(Blank)" project to PTO/Holiday
    const projectStr = iProject >= 0 ? String(row[iProject] || '') : '';
    const isPtoRow = (projectStr === '(Blank)' || projectStr === 'PTO/Holiday');
    const project = isPtoRow ? 'PTO/Holiday' : projectStr;

    const allocType = classifyAllocation_(
      isPtoRow ? 'PTO/Holiday' : projectStr,  // <-- always send something the classifier recognizes
      iCust >= 0 ? row[iCust] : '',
      iInt  >= 0 ? row[iInt]  : '',
      iEdu  >= 0 ? row[iEdu]  : ''
    );

        let icpRoleRaw = classifyIcpRole_(
      iRoleCat >= 0 ? row[iRoleCat] : '',
      iJob >= 0 ? row[iJob] : '',
      iProjRole >= 0 ? row[iProjRole] : '',
      iResType >= 0 ? row[iResType] : ''
    );

    const workerName = row[iWorker];

    // Apply Config_Worker_Role_Overrides if the worker has an active override.
    // The override is the canonical answer regardless of what classifyIcpRole_
    // produced — accommodates workers whose PSA Job Profile no longer matches
    // their actual SLG team assignment.
    const workerNameKey = String(workerName || '').trim().toLowerCase();
    if (workerNameKey && workerIcpOverrides[workerNameKey]) {
      icpRoleRaw = workerIcpOverrides[workerNameKey];
    }

    const rawManagerOrg = iMgr >= 0 ? row[iMgr] : '';
    const managerOrgKey = normalizeManagerName_(rawManagerOrg);
    const projectRegion = iProjRegion >= 0 ? row[iProjRegion] : '';
    const regionWorker  = iRegionW    >= 0 ? row[iRegionW]    : '';

    const workerClass = classifyWorkerClass_(
      workerName,
      managerOrgKey,
      projectRegion,
      regionWorker,
      slgManagers
    );

    // Only use non-PTO allocations to establish canonical worker ICP role
    if (allocType !== 'PTO_Holiday' && icpRoleRaw) {
      if (!workerIcp[workerName]) {
        workerIcp[workerName] = icpRoleRaw;
      }
    }

    cache.push({
      rowIndex:    r,
      row:         row,
      workerName:  workerName,
      project:     project,
      projectStr:  projectStr,
      allocType:   allocType,
      icpRoleRaw:  icpRoleRaw,
      workerClass: workerClass
    });
  }

  // Second pass: build output rows, backfilling ICP_role for blanks
  const out = [];

  for (let i = 0; i < cache.length; i++) {
    const entry      = cache[i];
    const row        = entry.row;
    const workerName = entry.workerName;

    // Skip rows with no worker
    if (!workerName) continue;

    // Backfill ICP_role from workerIcp if classifier returned blank
    const icpRole     = entry.icpRoleRaw || workerIcp[workerName] || '';
    const managerOrg  = iMgr     >= 0 ? String(row[iMgr] || '')     : ''; // RAW from PSA (may include "(On Leave)")
    const accountName = iAccount >= 0 ? String(row[iAccount] || '') : '';
    const workerClass = entry.workerClass || '';
    // WFM-FIX.3: stamp every row regardless of exclusion -- retained as the
    // hook for a future requirement even for workers who end up excluded.
    const onLeave = _deriveOnLeave_(workerName);
    const rawSpecialty = iTeam >= 0 ? String(row[iTeam] || '').trim() : '';
    const specialtyPractice = rawSpecialty || 'Unclassified';

    const base = [
      iEmpId >= 0 ? String(row[iEmpId] || '').trim() : '',  // employee_id (Phase 0) — trimmed string for cross-source join
      row[iWorker],                            // resource_name
      iTeam >= 0 ? row[iTeam] : '',            // team (Specialty Practice)
      iPract   >= 0 ? row[iPract]   : '',    // practice (Customer Segment Practice)
      managerOrg,                            // manager_org (Worker's Manager) - RAW, with "(On Leave)" if present
      iJob     >= 0 ? row[iJob]     : '',    // job_profile
      iRoleCat >= 0 ? row[iRoleCat] : '',    // role_category
      iResType >= 0 ? row[iResType] : '',    // resource_type
      workerClass,                           // worker_class
      icpRole,                               // ICP_role (backfilled if needed)
      accountName,                           // account_name
      entry.project,                         // project_name (PTO/Holiday normalized)
      entry.allocType,                       // allocation_type
      iEM  >= 0 ? row[iEM]  : '',            // engagement_manager
      iMgr >= 0 ? row[iMgr] : ''             // manager (raw PSA value)
    ];

    for (let k = 0; k < weeks.length; k++) {
      const wc  = weeks[k];
      const hrs = Number(row[wc.index]);
      if (!hrs) continue;

      out.push(
        // week_start, week_key, hours, source_row, on_leave, specialty_practice
        base.concat([wc.weekStart, weekKey_(wc.weekStart), hrs, entry.rowIndex + 2, onLeave, specialtyPractice])
      );
    }
  }

  writeTable_(ALLOC_NORM, ALLOC_HEADERS, out);

  // WFM-FIX.3: reconcile Config_Worker_Exclusions against this ingest's
  // manager membership + on_leave tags. Read back via readTable_ (not
  // cachedRead_) so we see the just-written on_leave column fresh, not a
  // stale cached copy. Reconciliation failure must never break ingest.
  try {
    reconcileWorkerExclusions_(readTable_(ALLOC_NORM));
  } catch (e) {
    Logger.log('normalizeStaff: reconcileWorkerExclusions_ failed \u2014 ' + e);
  }

  logRefresh_('staff', values.length, out.length, weeks.length, weekDetection.warnings.join(' | '));
  invalidateCache_(ALLOC_NORM);
  // Drop 5: invalidate enriched-data caches that depend on ALLOC_NORM.
  try { if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_(); } catch(e) {}

  // WFM-PERF.2: warm enriched caches so the next viewer doesn't pay the
  // cold rebuild. The uploader absorbs it once, here, right after ingest.
  // Runs after reconcileWorkerExclusions_ and cache invalidation above so
  // it warms the final, post-reconcile state. Non-fatal, wrapped.
  try {
    if (typeof getEnrichedAllocations_ === 'function') getEnrichedAllocations_();
    if (typeof getResourceIndex_ === 'function') getResourceIndex_();
    if (typeof getEnrichedAssignments_ === 'function') getEnrichedAssignments_();
  } catch (e) { Logger.log('normalizeStaff warm-up failed (non-fatal): ' + e); }

  return {
    rowsIn: values.length,
    rowsOut: out.length,
    weeksDetected: weeks.length,
    warnings: weekDetection.warnings
  };
}

/**
 * Reconcile Config_Worker_Exclusions against current data (WFM-FIX.3).
 * - Materializes rule:manager (Config_SLG_Managers membership) and
 *   rule:on_leave (workers with the (On Leave) tag in the just-ingested data).
 * - NEVER modifies rows whose source is 'manual' or that carry an override.
 * - Removes a rule:on_leave row only when the worker is PRESENT in the
 *   export, UNTAGGED, and has project (>1) rows -- the safe return signal.
 * - Idempotent: keyed by _exclusionKey_, single write, stable order.
 * Called at the end of normalizeStaff; also standalone-callable (e.g. from
 * the Apps Script editor, or _dbg_migrateWorkerExclusions).
 * @param {Array<Object>} allocRows rows shaped like Allocations_Normalized
 *   (must include resource_name and on_leave)
 */
function reconcileWorkerExclusions_(allocRows) {
  // 1. Build data-derived signals
  var managers = {};   // _exclusionKey_ -> display name
  (readConfigSlgManagers_() || []).forEach(function (m) {
    var nm = String(m.manager_name || '').trim();
    if (nm) managers[_exclusionKey_(nm)] = nm;
  });

  // Per-worker: is tagged on-leave? how many rows? (project-row = return signal)
  var byWorker = {};   // _exclusionKey_ -> { name, tagged, rowCount }
  (allocRows || []).forEach(function (a) {
    var raw = String(a.resource_name || '').trim();
    if (!raw) return;
    var k = _exclusionKey_(raw);
    if (!byWorker[k]) byWorker[k] = { name: raw, tagged: false, rowCount: 0 };
    byWorker[k].rowCount++;
    if (String(a.on_leave || '').trim().toLowerCase() === 'yes') {
      byWorker[k].tagged = true;
      byWorker[k].name = raw; // prefer the tagged spelling for display
    }
  });
  var onLeave = {}; // _exclusionKey_ -> display name  (Option A: tag authoritative)
  Object.keys(byWorker).forEach(function (k) {
    if (byWorker[k].tagged) onLeave[k] = byWorker[k].name;
  });

  // 2. Read existing sheet; index by _exclusionKey_
  var existing = readTable_(CFG_WORKER_EXCLUSIONS) || [];
  var rowsByKey = {};
  existing.forEach(function (r) {
    var k = _exclusionKey_(r.worker_name);
    if (k) rowsByKey[k] = r;
  });

  // 3. Build target rows
  var out = {}; // _exclusionKey_ -> row object
  function ensure(k, name) {
    if (!out[k]) {
      var prev = rowsByKey[k] || {};
      out[k] = {
        worker_name: name || prev.worker_name || '',
        manager_org: prev.manager_org || '',
        reason: '',
        active: 'Yes',
        source: '',
        override: String(prev.override || '').trim(),  // preserve human override
        return_date: prev.return_date || '',
        modified_by: prev.modified_by || '',
        modified_at: prev.modified_at || ''
      };
    }
    return out[k];
  }

  // 3a. Preserve all human-owned rows: manual, or anything with an override.
  Object.keys(rowsByKey).forEach(function (k) {
    var r = rowsByKey[k];
    var src = String(r.source || '').trim().toLowerCase();
    var ovr = String(r.override || '').trim();
    var isManual = (src === 'manual' || src === '');   // legacy blank source treated as manual
    if (isManual || ovr) {
      out[k] = {
        worker_name: r.worker_name, manager_org: r.manager_org || '',
        reason: r.reason || '', active: r.active || 'Yes',
        source: isManual ? 'manual' : (r.source || 'manual'),
        override: ovr,
        return_date: r.return_date || '',
        modified_by: r.modified_by || '',
        modified_at: r.modified_at || ''
      };
    }
  });

  // 3b. Materialize rule:manager
  Object.keys(managers).forEach(function (k) {
    var row = ensure(k, managers[k]);
    _addSource_(row, 'rule:manager');
    row.active = 'Yes';
  });

  // 3c. Materialize rule:on_leave (Option A)
  Object.keys(onLeave).forEach(function (k) {
    var row = ensure(k, onLeave[k]);
    _addSource_(row, 'rule:on_leave');
    row.active = 'Yes';
  });

  // 3d. Safe removal of stale rule:on_leave (return-from-leave)
  Object.keys(out).forEach(function (k) {
    var row = out[k];
    if (_hasSource_(row, 'rule:on_leave') && !onLeave[k]) {
      var w = byWorker[k];
      var returned = w && !w.tagged && w.rowCount > 1; // present, untagged, has project rows
      if (returned) {
        _removeSource_(row, 'rule:on_leave');
      } else if (!w) {
        // Absent from export: DO NOT remove. Keep the row as-is.
        // (Preserve the previously stored row rather than dropping it.)
        if (!out[k].source) out[k] = rowsByKey[k];
      }
    }
  });

  // 3e. Drop rows that ended up with no source and no override and not manual-active
  //     (i.e., a rule row whose rule no longer applies). Manual/override rows already preserved.
  var finalRows = Object.keys(out).map(function (k) { return out[k]; }).filter(function (r) {
    var src = String(r.source || '').trim();
    var ovr = String(r.override || '').trim();
    var manualActive = (src === 'manual' && String(r.active).toLowerCase() === 'yes');
    return !!ovr || manualActive || src.indexOf('rule:') === 0;
  });

  // 4. Stable sort + single write
  finalRows.sort(function (a, b) {
    return String(a.worker_name).localeCompare(String(b.worker_name));
  });
  writeTable_(CFG_WORKER_EXCLUSIONS,
    WORKER_EXCLUSION_HEADERS,
    finalRows.map(function (r) {
      return WORKER_EXCLUSION_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
    }));
  invalidateCache_(CFG_WORKER_EXCLUSIONS);
}

// source is a comma-joined set of tags
function _addSource_(row, tag) {
  var set = String(row.source || '').split(',').map(function (s){return s.trim();}).filter(Boolean);
  if (set.indexOf('manual') >= 0) set = set.filter(function(s){return s!=='manual';}); // rule supersedes bare manual
  if (set.indexOf(tag) < 0) set.push(tag);
  row.source = set.join(',');
  // reason mirror for human readability
  var reasons = set.map(function(s){ return s==='rule:manager'?'Manager':(s==='rule:on_leave'?'On Leave':''); }).filter(Boolean);
  if (reasons.length) row.reason = reasons.join(' + ');
}
function _hasSource_(row, tag){ return String(row.source||'').split(',').map(function(s){return s.trim();}).indexOf(tag)>=0; }
function _removeSource_(row, tag){
  var set = String(row.source||'').split(',').map(function(s){return s.trim();}).filter(function(s){return s && s!==tag;});
  row.source = set.join(',');
  var reasons = set.map(function(s){ return s==='rule:manager'?'Manager':(s==='rule:on_leave'?'On Leave':''); }).filter(Boolean);
  row.reason = reasons.join(' + ');
}

/**
 * Normalize opportunities from the Pipeline tab to Opportunities_Normalized.
 *
 * Restored 2026-06-11 after being lost in a prior edit. Originally ran on a
 * 30-minute time-based trigger; that trigger was orphaned when the function
 * disappeared. The function now runs only when explicitly invoked — via
 * api_refreshOpportunities (the Admin view's "Refresh Opportunities" button)
 * or from the Apps Script editor.
 *
 * Reads from: Pipeline tab (Salesforce-fed, managed by the Salesforce connector)
 * Writes to:  Opportunities_Normalized tab (consumed by api_listOpportunities)
 *
 * Note on ACV column: the Pipeline tab from Salesforce uses "ACV  Amount"
 * with TWO spaces between "ACV" and "Amount". The previous version of this
 * function looked up "ACV Amount" (one space) and silently returned 0 for
 * every ACV value. This restore fixes that bug by checking the two-space
 * variant first and falling back to the single-space variant for resilience.
 */
function normalizeOpportunities() {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(OPPS_SHEET);
  if (!src) throw new Error('Missing sheet: ' + OPPS_SHEET);

  const values = src.getDataRange().getValues();
  if (values.length < 2) {
    logRefresh_('opps', 0, 0, 0);
    invalidateCache_(OPPS_NORM);
    return { rowsIn: 0, rowsOut: 0 };
  }

  const header = values.shift();
  const idx = {};
  header.forEach((h, i) => { idx[String(h).trim()] = i; });

  function v(name) {
    return idx.hasOwnProperty(name) ? idx[name] : -1;
  }

  const iId    = v('Opportunity ID');
  const iName  = v('Opportunity Name');
  const iAcct  = v('Account Name');
  const iStage = v('Stage');
  const iProb  = v('Probability (%)');
  // ACV column from Salesforce has two spaces: "ACV  Amount".
  // Fall back to single-space variant for resilience.
  const iAcv   = v('ACV  Amount');
  const iAcv2  = v('ACV Amount');
  const iStart = v('Est Deployment Start Date');
  const iEnd   = v('Estimated Go Live Date');
  const iEe    = v('Deployment EE Count');
  const iSvcs  = v('Workday Services');
  const iSeg   = v('Account PS Sub Region');
  const iDeal  = v('Deal Type');
  const iAppr  = v('Deployment Approach');

  const out = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (iId < 0 || !row[iId]) continue;

    const stageStr = String(row[iStage] || '');
    const stageNum = parseInt((stageStr.match(/^(\d+)/) || [])[1] || '0', 10);

    let services = [];
    if (iSvcs >= 0) {
      try {
        services = JSON.parse(row[iSvcs] || '[]');
      } catch (e) {
        services = [];
      }
    }

    const acvRaw = iAcv >= 0 ? row[iAcv] : (iAcv2 >= 0 ? row[iAcv2] : 0);

    out.push([
      row[iId],
      iName  >= 0 ? row[iName]  : '',
      iAcct  >= 0 ? row[iAcct]  : '',
      stageStr,
      stageNum,
      Number(iProb >= 0 ? row[iProb] : 0) || 0,
      Number(acvRaw) || 0,
      iStart >= 0 ? row[iStart] : '',
      iEnd   >= 0 ? row[iEnd]   : '',
      Number(iEe >= 0 ? row[iEe] : 0) || 0,
      JSON.stringify(services),
      iSeg   >= 0 ? row[iSeg]   : '',
      iDeal  >= 0 ? row[iDeal]  : '',
      iAppr  >= 0 ? row[iAppr]  : ''
    ]);
  }

  writeTable_(OPPS_NORM, OPP_HEADERS, out);
  logRefresh_('opps', values.length, out.length, 0);
  invalidateCache_(OPPS_NORM);
  // Drop 5: invalidate enriched-data caches that depend on source data.
  try { if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_(); } catch(e) {}

  return { rowsIn: values.length, rowsOut: out.length };
}

function _diagnoseAdminLoad() {
  const apis = [
    'api_getRefreshLog',
    'api_getPipelineRefreshLog',
    'api_listGenericResources',
    'api_getExclusions',
    'api_getReference'
  ];
  apis.forEach(function (name) {
    try {
      const fn = this[name];
      if (typeof fn !== 'function') {
        Logger.log(name + ': FUNCTION NOT FOUND');
        return;
      }
      const result = (name === 'api_getReference') ? fn() : fn();
      const type = Array.isArray(result) ? 'array(len=' + result.length + ')' :
                   (result === null ? 'NULL' :
                   (result === undefined ? 'UNDEFINED' :
                   typeof result));
      Logger.log(name + ': returned ' + type);
      
      // For arrays, inspect the first row for problematic types
      if (Array.isArray(result) && result.length > 0) {
        const sample = result[0];
        Object.keys(sample).forEach(function (key) {
          const val = sample[key];
          const valType = val === null ? 'null' :
                          val === undefined ? 'undefined' :
                          val instanceof Date ? 'Date' :
                          typeof val;
          if (valType === 'Date' || valType === 'object') {
            Logger.log('  field "' + key + '" = ' + valType + ' (POTENTIAL SERIALIZATION ISSUE)');
          }
        });
      }
    } catch (e) {
      Logger.log(name + ': THREW — ' + e.message);
    }
  });
}