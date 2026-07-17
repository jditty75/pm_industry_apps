// ============================================================
// Util.gs — date, sheet I/O, uuid, user helpers + caching
// ============================================================

function uuid_() { return Utilities.getUuid(); }
function now_()  { return new Date(); }

function getUserEmail_() {
  try { return Session.getActiveUser().getEmail() || 'unknown'; }
  catch (e) { return 'unknown'; }
}

function firstOfMonth_(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

function monthKey_(d) {
  const x = new Date(d);
  return Utilities.formatString('%04d-%02d', x.getFullYear(), x.getMonth() + 1);
}

function monthsBetween_(start, end) {
  const out = [];
  let cur = firstOfMonth_(start);
  const last = firstOfMonth_(end);
  while (cur <= last) {
    out.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

// ============================================================
// Week + fiscal helpers (weekly-forecast-migration)
//
// Calendar-quarter logic (quarterKey_ / quarterMonths_) has been removed
// per the weekly-forecast-migration spec (LOCKED: Workday fiscal quarters
// everywhere, Feb-anchored). Use fiscalQuarter_ / fiscalYear_ /
// fiscalQuarterKey_ below instead. Do not reintroduce calendar-quarter
// (Math.floor(month/3)) logic anywhere in this codebase.
// ============================================================

/**
 * Normalize a date to its week's canonical start. The export column date
 * is used AS-IS (sample exports start weeks on Saturday) -- this does NOT
 * snap to the ISO Monday week start. Only strips the time-of-day component.
 * @param {Date|string|number} d
 * @return {Date} midnight local time on the same calendar day as d
 */
function weekStart_(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

/**
 * Canonical week id: 'YYYY-MM-DD' of weekStart_(d). Sortable, unambiguous,
 * identical server- and client-side. LOCKED format -- see Constants.gs.
 * @param {Date|string|number} d
 * @return {string}
 */
function weekKey_(d) {
  const x = weekStart_(d);
  return Utilities.formatString('%04d-%02d-%02d', x.getFullYear(), x.getMonth() + 1, x.getDate());
}

/**
 * Enumerate 7-day-step week starts from weekStart_(start) through
 * weekStart_(end) inclusive, anchored on start's own day-of-week (NOT
 * snapped to Monday -- matches weekStart_'s as-is semantics).
 *
 * NOTE: callers that must align to the REAL PSA week grid (e.g. Engine.gs
 * assignment/adjustment expansion, which needs calendar[weekKey] lookups
 * to hit) should prefer filtering the actual Config_Calendar rows that
 * fall within [start, end] over this naive stepper, since an arbitrary
 * start date will not in general land on the same weekday as the
 * ingested PSA week columns.
 *
 * @param {Date|string|number} start
 * @param {Date|string|number} end
 * @return {Date[]}
 */
function weeksBetween_(start, end) {
  const out = [];
  let cur = weekStart_(start);
  const last = weekStart_(end);
  while (cur <= last) {
    out.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
  }
  return out;
}

/**
 * Workday fiscal year number for a date (February-anchored). Months
 * Feb-Dec roll into the FOLLOWING calendar year's fiscal year; January
 * belongs to the fiscal year that started the previous February.
 * E.g. Jul 2026 -> 2027 ("FY27"); Jan 2027 -> 2027 ("FY27").
 * @param {Date|string|number} d
 * @return {number} full 4-digit fiscal year
 */
function fiscalYear_(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = x.getMonth() + 1; // 1-indexed
  return (m >= FISCAL_YEAR_START_MONTH) ? y + 1 : y;
}

/**
 * Workday fiscal quarter ('Q1'..'Q4') for a date, per
 * FISCAL_QUARTER_BY_CALENDAR_MONTH (Constants.gs): Feb-Apr=Q1,
 * May-Jul=Q2, Aug-Oct=Q3, Nov-Jan=Q4.
 * @param {Date|string|number} d
 * @return {string}
 */
function fiscalQuarter_(d) {
  const x = new Date(d);
  return FISCAL_QUARTER_BY_CALENDAR_MONTH[x.getMonth() + 1];
}

/**
 * Combined fiscal-quarter label, e.g. 'FY27-Q2'. LOCKED format -- server
 * and client must produce byte-identical labels for the same date.
 * @param {Date|string|number} d
 * @return {string}
 */
function fiscalQuarterKey_(d) {
  const fy = fiscalYear_(d);
  const q = fiscalQuarter_(d);
  return 'FY' + String(fy % 100).padStart(2, '0') + '-' + q;
}

/**
 * Split a week's hours across the calendar month(s) it overlaps,
 * proportional to day count. Sum of returned hours always equals the
 * input hours exactly -- no rounding here (round only at display time).
 *
 * @param {Date|string|number} weekStart the week's start date (as-is, not Monday-snapped)
 * @param {number} hours total hours for the week
 * @param {string} [basis] 'calendar' (all 7 days, default) | 'weekday' (Mon-Fri only)
 * @return {Array<{monthKey:string, hours:number}>}
 */
function splitWeekAcrossMonths_(weekStart, hours, basis) {
  basis = basis || 'calendar';
  const start = weekStart_(weekStart);
  const dayKeys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dow = d.getDay();
    const isWeekday = dow !== 0 && dow !== 6;
    if (basis === 'weekday' && !isWeekday) continue;
    dayKeys.push(monthKey_(d));
  }
  const totalDays = dayKeys.length;
  if (totalDays === 0) return [];

  const order = [];
  const counts = {};
  dayKeys.forEach(mk => {
    if (!counts[mk]) { counts[mk] = 0; order.push(mk); }
    counts[mk]++;
  });

  return order.map(mk => ({
    monthKey: mk,
    hours: hours * (counts[mk] / totalDays)
  }));
}

function workdaysInMonth_(year, monthIdx /*0-11*/) {
  const first = new Date(year, monthIdx, 1);
  const last  = new Date(year, monthIdx + 1, 0);
  let count = 0;
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

// ============================================================
// Sheet I/O
// ============================================================

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  } else if (headers && headers.length) {
    const curHeader = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
    const needsWrite = headers.some((h, i) => curHeader[i] !== h);
    if (needsWrite) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function writeTable_(name, headers, rows) {
  const sh = getOrCreateSheet_(name, headers);
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), headers.length);
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (rows && rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  invalidateCache_(name);
  return (rows || []).length;
}

function readTable_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values.shift();
  return values
    .filter(r => r.some(v => v !== '' && v !== null && v !== undefined))
    .map(r => {
      const o = {};
      header.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
}

function appendRow_(name, rowObj, headers) {
  const sh = getOrCreateSheet_(name, headers);
  const row = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  sh.appendRow(row);
  invalidateCache_(name);
}

function updateRow_(name, idField, idValue, patch, headers) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return false;
  const values = sh.getDataRange().getValues();
  const header = values[0];
  const idCol = header.indexOf(idField);
  if (idCol < 0) return false;
  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === idValue) {
      headers.forEach((h, i) => {
        if (patch[h] !== undefined) values[r][i] = patch[h];
      });
      sh.getRange(r + 1, 1, 1, header.length).setValues([values[r]]);
      invalidateCache_(name);
      return true;
    }
  }
  return false;
}

/**
 * Log one ingest run to Normalization_Log.
 * @param {string} source 'staff' | 'opps'
 * @param {number} rowsIn
 * @param {number} rowsOut
 * @param {number} weeksDetected count of weekly columns detected (was
 *   months_detected pre-weekly-forecast-migration; see REFRESH_HEADERS)
 */
function logRefresh_(source, rowsIn, rowsOut, weeksDetected) {
  appendRow_(REFRESH_LOG, {
    timestamp: now_(),
    source: source,
    rows_in: rowsIn,
    rows_out: rowsOut,
    weeks_detected: weeksDetected,
    user: getUserEmail_()
  }, REFRESH_HEADERS);
}

// ============================================================
// Two-tier cache: in-memory (per execution) + CacheService (6h)
// ============================================================

const _memCache = {};

// Per-key cache size limit in CacheService is 100KB; we use 95KB to be safe.
const _CACHE_CHUNK_BYTES = 95000;

/**
 * Read a table with two-tier caching: in-memory (per execution) +
 * CacheService (6h). Large payloads are transparently split across
 * multiple cache keys: 'tbl:<name>:meta' holds the chunk count,
 * 'tbl:<name>:0', 'tbl:<name>:1', ... hold the payload chunks.
 *
 * On read, the meta key tells us how many chunks to fetch; missing
 * any chunk falls through to a fresh sheet read.
 */
function cachedRead_(name, ttlSeconds) {
  if (_memCache[name]) return _memCache[name];
  const cache = CacheService.getScriptCache();
  const ttl = ttlSeconds || 21600;

  // Try chunked read.
  const meta = cache.get('tbl:' + name + ':meta');
  if (meta) {
    try {
      const chunkCount = Number(meta);
      if (chunkCount > 0) {
        const keys = [];
        for (let i = 0; i < chunkCount; i++) {
          keys.push('tbl:' + name + ':' + i);
        }
        const all = cache.getAll(keys);
        let combined = '';
        let ok = true;
        for (let i = 0; i < chunkCount; i++) {
          const part = all['tbl:' + name + ':' + i];
          if (part === null || part === undefined) { ok = false; break; }
          combined += part;
        }
        if (ok) {
          const parsed = JSON.parse(combined);
          _memCache[name] = parsed;
          return parsed;
        }
      }
    } catch (e) { /* fall through to fresh read */ }
  }

  // Fresh read.
  const rows = readTable_(name);
  _memCache[name] = rows;

  // Write chunked cache.
  try {
    const payload = JSON.stringify(rows);
    const chunkCount = Math.ceil(payload.length / _CACHE_CHUNK_BYTES);
    if (chunkCount > 0 && chunkCount <= 50) {
      // Hard cap at 50 chunks (~4.75MB) to avoid runaway.
      const writes = {};
      for (let i = 0; i < chunkCount; i++) {
        const start = i * _CACHE_CHUNK_BYTES;
        writes['tbl:' + name + ':' + i] = payload.slice(start, start + _CACHE_CHUNK_BYTES);
      }
      writes['tbl:' + name + ':meta'] = String(chunkCount);
      cache.putAll(writes, ttl);
    }
  } catch (e) { /* ignore write failures */ }

  return rows;
}

function invalidateCache_(name) {
  delete _memCache[name];
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get('tbl:' + name + ':meta');
    const keys = ['tbl:' + name, 'tbl:' + name + ':meta'];
    if (meta) {
      const chunkCount = Number(meta);
      for (let i = 0; i < chunkCount; i++) {
        keys.push('tbl:' + name + ':' + i);
      }
    }
    cache.removeAll(keys);
  } catch (e) {}
}

function invalidateAllCaches_() {
  // Clear in-memory cache entirely
  Object.keys(_memCache).forEach(k => delete _memCache[k]);

  // Clear CacheService for every known config + data table.
  // Keep this list in sync with every sheet name read via cachedRead_.
  const keys = [
    ALLOC_NORM, OPPS_NORM, ASSIGNMENTS, SCENARIOS,
    CFG_ICP, CFG_ROLES, CFG_CAL, CFG_ALIAS,
    CFG_SETTINGS, CFG_GENERIC, CFG_SLG_MGRS,
    CFG_PRACTICE_MGRS,                     // NEW: practice -> manager ownership
    'Config_Worker_Exclusions',
    'Config_Resource_Type', 'Config_ResourceType_Map',
    'Config_Ingest_Filters',
    CAPACITY_ADJUSTMENTS_AUDIT_SHEET,       // Doc B: adjustment audit log
    CAPACITY_ADJUSTMENTS_AUDIT_ARCHIVE_SHEET
  ];
  keys.forEach(function (k) { invalidateCache_(k); });

  // Clear per-user API caches (Phase 3).
  try {
    CacheService.getUserCache().remove('api_getReference_v1');
  } catch (e) { /* ignore */ }

  // Drop 5: bump enriched-data cache version so getEnrichedAllocations_,
  // getEnrichedAssignments_, and getResourceIndex_ all rebuild on next call.
  try {
    if (typeof invalidateEnrichedCaches_ === 'function') {
      invalidateEnrichedCaches_();
    }
  } catch (e) { /* ignore — EnrichedData.gs may not be present yet */ }
}

// ============================================================
// Config_Practice_Managers reader + helpers
//
// Practice-based attribution for External resources.
// One row per (practice, manager) pair. Multi-manager practices
// are supported by adding multiple rows with the same practice.
//
// This sheet works in concert with:
//   - Config_Resource_Type.practice : maps role_category (etc.) -> practice
//   - Config_SLG_Managers           : SLG manager hierarchy (parent/descendants)
//
// The resolver below uses this sheet to attribute External rows to the
// manager(s) who own their practice, separately from any direct
// manager_org relationship reported by PSA (which is unreliable for
// External resources).
// ============================================================

/**
 * Read Config_Practice_Managers directly from the sheet (no cache layer)
 * so header drops can't silently lose columns. Returns an array of
 * objects with keys: practice_name, manager_name, active (raw),
 * notes. Only rows whose practice_name and manager_name are non-empty
 * and whose active flag is truthy are returned.
 *
 * Tolerant truthy matching on the active column, same pattern as
 * readExclusions_ in Engine.gs:
 *   yes / y / true / t / 1 / x / active / on   -> active
 *   anything else (including blank)             -> inactive
 *
 * Returns [] gracefully if the sheet is missing or empty.
 */
function readConfigPracticeManagers_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CFG_PRACTICE_MGRS);
  if (!sh) {
    Logger.log('readConfigPracticeManagers_: sheet "' + CFG_PRACTICE_MGRS + '" not found.');
    return [];
  }
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  var header = values[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  var iPract  = header.indexOf('practice_name');
  var iMgr    = header.indexOf('manager_name');
  var iActive = header.indexOf('active');
  var iNotes  = header.indexOf('notes');

  if (iPract < 0 || iMgr < 0) {
    Logger.log(
      'readConfigPracticeManagers_: required headers not found. Have: ' +
      JSON.stringify(values[0])
    );
    return [];
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
    '1':   1, 'x': 1, 'active': 1, 'on': 1
  };

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var practice = _normCell_(row[iPract]);
    var manager  = _normCell_(row[iMgr]);
    if (!practice || !manager) continue;

    var rawActive = (iActive >= 0)
      ? (row[iActive] === '' || row[iActive] === null || row[iActive] === undefined
          ? 'Yes'
          : row[iActive])
      : 'Yes';
    var active = _normCell_(rawActive).toLowerCase();
    if (!TRUTHY[active]) continue;

    out.push({
      practice_name: practice,
      manager_name:  manager,
      active:        rawActive,
      notes:         iNotes >= 0 ? String(row[iNotes] || '') : ''
    });
  }
  return out;
}

/**
 * Build a lookup map: practice_name (lowercase) -> [manager_name, ...].
 * Supports multiple managers per practice. Pass the result of
 * readConfigPracticeManagers_().
 */
function buildPracticeManagerMap_(rows) {
  var map = {};
  (rows || []).forEach(function (r) {
    var key = String(r.practice_name || '').toLowerCase();
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(String(r.manager_name || ''));
  });
  return map;
}

/**
 * Read Config_Resource_Type into a richer map:
 *   keyLower -> { team_label, practice }
 *
 * Same lookup keys as the existing readConfigResourceType_() in Api.gs
 * (resource_type / project_role_category / key), with case-insensitive
 * matching baked into the returned map keys. Reads directly off the
 * sheet (no cachedRead_) to be robust against header drops.
 *
 * Used by resolveOwnersForRow_ to look up both the team_label
 * (for the Delivery branch in Stage 2) and the practice (for the
 * practice-based attribution branch in Stage 1).
 */
function readConfigResourceTypeRich_() {
  var ss = SpreadsheetApp.getActive();

  function readSheetAsRichMap_(sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return null;
    var values = sh.getDataRange().getValues();
    if (!values || values.length < 2) return {};

    var header = values[0].map(function (h) {
      return String(h || '').trim().toLowerCase();
    });
    var iKey  = header.indexOf('resource_type');
    var iTeam = header.indexOf('team_label');
    var iPract = header.indexOf('practice');
    if (iKey  < 0) iKey  = header.indexOf('project_role_category');
    if (iKey  < 0) iKey  = header.indexOf('key');
    if (iTeam < 0) iTeam = header.indexOf('team');
    if (iTeam < 0) iTeam = header.indexOf('label');

    if (iKey < 0 || iTeam < 0) {
      Logger.log(
        'readConfigResourceTypeRich_: could not locate key/team columns in ' +
        sheetName + '. Header was: ' + JSON.stringify(values[0])
      );
      return {};
    }

    var map = {};
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var key  = String(row[iKey]  || '').trim();
      var team = String(row[iTeam] || '').trim();
      if (!key || !team) continue;
      var practice = (iPract >= 0) ? String(row[iPract] || '').trim() : '';
      map[key.toLowerCase()] = {
        key:        key,         // preserve original-case source key for diagnostics
        team_label: team,
        practice:   practice
      };
    }
    return map;
  }

  var primary = readSheetAsRichMap_('Config_Resource_Type');
  if (primary && Object.keys(primary).length) return primary;

  var legacy = readSheetAsRichMap_('Config_ResourceType_Map');
  if (legacy && Object.keys(legacy).length) return legacy;

  Logger.log('readConfigResourceTypeRich_: returning empty map — no usable config sheet found.');
  return {};
}

/**
 * Resolve the practice for an allocation row using the rich
 * Config_Resource_Type map. Lookup order matches _classifyTeam_:
 *   role_category -> job_profile -> project_role -> resource_type
 * The first key that maps to an entry whose `practice` is non-empty
 * returns that practice. Returns '' if no practice is resolvable.
 *
 * Case-insensitive matching against keys in rtRichMap.
 */
function _resolvePracticeForRow_(row, rtRichMap) {
  if (!rtRichMap) return '';
  function tryKey(v) {
    if (!v) return '';
    var k = String(v).trim().toLowerCase();
    if (!k) return '';
    var hit = rtRichMap[k];
    if (hit && hit.practice) return hit.practice;
    return '';
  }
  return (
    tryKey(row.role_category) ||
    tryKey(row.job_profile)   ||
    tryKey(row.project_role)  ||
    tryKey(row.resource_type) ||
    ''
  );
}

/**
 * Resolve the set of managers who own a given allocation row.
 *
 * For SLG rows (worker_class = SLG_Real or SLG_Generic):
 *   returns [row.manager_org] — unchanged from existing behavior.
 *
 * For External rows (worker_class starts with 'External_'):
 *   1) Resolve the row's practice via _resolvePracticeForRow_.
 *   2) Look up practice -> [managers] in practiceMgrMap (lowercase keys).
 *   3) If at least one manager is found, return that list.
 *   4) Otherwise fall through to [row.manager_org] (existing behavior).
 *      This preserves backward compatibility for rows whose practice
 *      isn't yet mapped — Stage 2 will add an account-based branch
 *      for the Delivery case before falling back to manager_org.
 *
 * For rows with blank worker_class:
 *   returns [row.manager_org]. These rows are typically out of scope
 *   under any worker_scope filter, so the value rarely matters.
 *
 * The returned list may be empty if the row has no resolvable owner
 * AND no PSA manager_org. Callers should treat an empty list as
 * "unattributable" — typically excluded under any manager filter.
 *
 * Args:
 *   row             — allocation row object (must include worker_class,
 *                     manager_org, role_category, job_profile,
 *                     project_role, resource_type fields as available)
 *   rtRichMap       — output of readConfigResourceTypeRich_()
 *   practiceMgrMap  — output of buildPracticeManagerMap_(...) — keys
 *                     must already be lowercased
 *
 * Returns: array of manager_name strings (may be empty)
 */
function resolveOwnersForRow_(row, rtRichMap, practiceMgrMap) {
  var wc = String((row && row.worker_class) || '');
  var isExternal = wc.indexOf('External_') === 0;

  if (!isExternal) {
    var mgr = String((row && row.manager_org) || '');
    return mgr ? [mgr] : [];
  }

  // External row: try practice-based attribution first.
  var practice = _resolvePracticeForRow_(row, rtRichMap);
  if (practice && practiceMgrMap) {
    var owners = practiceMgrMap[practice.toLowerCase()];
    if (owners && owners.length) {
      return owners.slice();  // return a copy to keep caller-side mutations safe
    }
  }

  // No practice owner resolved. Fall back to PSA manager_org so the
  // row is at least addressable; Stage 2 will add a Delivery account
  // branch before this fallback.
  var fallback = String((row && row.manager_org) || '');
  return fallback ? [fallback] : [];
}

// ============================================================
// Notes on the practice-attribution model (Stage 1)
//
// The resolver above operates on two sheets that compose cleanly:
//
//   - Config_Resource_Type.practice
//       Maps a PSA role string (role_category, job_profile, project_role,
//       or resource_type) to a sub-practice name. Examples:
//         "HCM Functional Consultant" -> "HCM"
//         "Integrations"              -> "INT"
//       Blank practice means "no sub-practice info; fall through".
//
//   - Config_Practice_Managers
//       Maps a practice name to one or more SLG manager owners.
//       Multi-manager practices are supported (one row per owner).
//
// Composition with Config_SLG_Managers (manager hierarchy) is implicit:
// the existing buildManagerDescendants_ + buildEffectiveManagers_ logic
// computes the effective manager set from the SLG hierarchy. The new
// resolver returns owner manager_names; callers check whether any of
// those names is in the effective set. So filtering on a parent manager
// (e.g., Marie at the Functional level, with include_descendants = Y)
// automatically picks up External rows owned by sub-practice managers
// (e.g., Sonja for HCM).
//
// Stage 2 will add a Delivery-specific branch between the practice
// lookup and the manager_org fallback, attributing Delivery External
// rows by account_name / project_name via a new Config sheet.
// ============================================================