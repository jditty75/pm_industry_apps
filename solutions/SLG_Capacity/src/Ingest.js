/**
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

  // Bench / unassigned consultant fallback:
  // When Project Role is blank (worker has no current project assignment),
  // Job Profile + Resource Type still identify the worker's role.
  //
  // PSA Job Profile patterns we expect to see:
  //   "P3 Functional Consultant"
  //   "P4 Sr Functional Consultant"
  //   "P6 Sr Principal Functional Consultant"
  //   "P5 Principal Technical Consultant"
  // Resource Type values we expect:
  //   "Functional"  -> CS_FUNC
  //   "Integrations" -> CS_TECH
  if (jp.indexOf('functional consultant') >= 0 && rt === 'functional') {
    return 'CS_FUNC';
  }
  if (jp.indexOf('technical consultant') >= 0 && rt === 'integrations') {
    return 'CS_TECH';
  }

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
  const iWorker     = idx[aliasMap['resource_name']  || 'Worker']                    ?? -1;
  const iTeam       = idx[aliasMap['team']           || 'Specialty Practice']        ?? -1;
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

    const base = [
      row[iWorker],                          // resource_name
      iTeam    >= 0 ? row[iTeam]    : '',    // team (Specialty Practice)
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
        base.concat([wc.weekStart, weekKey_(wc.weekStart), hrs, entry.rowIndex + 2]) // week_start, week_key, hours, source_row
      );
    }
  }

  writeTable_(ALLOC_NORM, ALLOC_HEADERS, out);
  logRefresh_('staff', values.length, out.length, weeks.length, weekDetection.warnings.join(' | '));
  invalidateCache_(ALLOC_NORM);
  // Drop 5: invalidate enriched-data caches that depend on ALLOC_NORM.
  try { if (typeof invalidateEnrichedCaches_ === 'function') invalidateEnrichedCaches_(); } catch(e) {}

  return {
    rowsIn: values.length,
    rowsOut: out.length,
    weeksDetected: weeks.length,
    warnings: weekDetection.warnings
  };
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