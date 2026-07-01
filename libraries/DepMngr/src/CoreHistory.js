/**
 * CoreHistory.gs
 *
 * Reads SFDC_DeploymentHistory and exposes history-derived primitives
 * (state episodes, time-in-state, MTP date replay). No Trends-specific
 * business logic lives here — that belongs in CoreTrends.
 *
 * Phase 3g design: Phase 3g Cursor Handoff Spec (canvas ts5cdwoV178e).
 *
 * C13.2 (2026-06): Constrain Date column width in Recent/Upcoming Go Lives tables. Width:110px applied
 *   to both <th> and <td> so the column actually honors the constraint under table-layout:auto. Removes
 *   lingering white-space:nowrap that was inflating the column.
 *
 * C13.1 (2026-06): Monthly Report Date column no longer wraps mid-date in Recent/Upcoming Go Lives
 *   tables. Inline white-space:nowrap on the date <td> for Outlook compatibility.
 *
 * C13 (2026-06): Monthly Report fixes — Approach Breakdown reads Deployment_Phase__c via Effective View
 *   with largest-remainder percentage allocation. Recent and Upcoming Go Lives tables now use
 *   Deployment Name (not Product Name) with multi-line date cells for multi-wave deployments,
 *   showing product names only on lines where the date differs from parent MTP. Portfolio Health
 *   KPI relabeled "Multiple Go Lives".
 *
 * C12 (2026-06): Overview upcoming card now delegates to getUpcomingGoLives for parity with
 *   the Go Lives tab (phased deployments, override exclusions). Next High Risk sorted by
 *   ascending MTP date only (Red/Yellow interleave freely). Canonical .report-loading spinner
 *   pattern adopted by Overview and MDS/PGL tabs; .overview-spinner-container removed.
 *   overviewData cache key bumped to v2 to flush stale pre-C12 cached payloads.
 *
 * Phase Overview-Redesign (2026-06):
 * - C11a: Spinner / render-order fixes.
 *   - MDS/PGL Account column hard-wraps at 280px; horizontal blow-out fixed.
 *   - MDS/PGL spinner shows immediately on tab load.
 *   - Overview spinner renders inline in markup so it appears the moment
 *     the page shell paints (no more "Loading overview..." text flash).
 * - C11b: Overview tab redesigned as a three-band morning briefing.
 *   - Band 1: 5 KPI tiles (Total Active, Red, Yellow, Green, Executive Watch)
 *     with status-colored left borders.
 *   - Band 2: "Next High Risk Go Lives" (top 5 Red+Yellow by Current MTP)
 *     side-by-side with "Upcoming Go Lives (Next 30 Days)" with total count
 *     and "View all" link.
 *   - Band 3: "Deployment Lifecycle" 3-segment bar (Starting / Building /
 *     Landing) replacing the seven-tile Active Deployments by Stage strip.
 *     "Other" segment renders only when count > 0.
 * - getOverviewData server payload reshaped: topHighRisk replaces topRed;
 *   lifecycleBuckets replaces the granular stage count list. Caching moved
 *   into CoreData.getOverviewSnapshot with _PerfCache 5-min TTL. Pre-warmed
 *   by CoreSalesforce._warmCaches.
 * - Click-through: rows in both Band 2 cards jump to Deployments or Go Lives
 *   tab with a search filter / view preset.
 *
 * C10 (2026-06): Tightened MDS/PGL row layout. Removed Products/Event Date/1/3 Point/Start columns.
 *   Added Type pill (MDS/PGL) with hover tooltip showing 1/3 Point or Target Event date.
 *   Added Deployment Partner column. Defaulted to WPS-only with "Show all partners" toggle.
 *   Unified MDS+PGL into single _buildMdsPglRowHtml row builder. All dates m/d/yyyy.
 *
 * Phase MDS-PGL Redesign (2026-06):
 * - Replaced the legacy MGM/PGL tab with a month-grouped survey schedule view.
 * - Added CoreSurveySchedule.gs (FY27 constant + first-full-week-Wednesday projector for FY28+).
 * - Added CoreData.getMdsPglBatchView with canonical go-live event de-duplication
 *   (one row per distinct date; "Multiple GoLives" pill only when distinct dates > 1).
 * - Removed the legacy day-window control in favor of a 3/6 month horizon toggle.
 * - Exceptions list logic lifted verbatim from the previous getUpcomingSurveys —
 *   the Bellingham false-positive issue is locked at the data layer via the new
 *   date-deduplication rule.
 * - Tab remains POWER_USER / ADMIN only; not part of the monthly report.
 *
 * Sheet: SFDC_DeploymentHistory
 *   Row 1 headers: Id, ParentId, Field, OldValue, NewValue, CreatedDate, CreatedById
 *   Rows pre-sorted by ParentId ASC, CreatedDate ASC (per Jeff's manual setup).
 *
 * Performance:
 *   The history sheet has ~9,463 rows. getHistoryMap() caches its result in
 *   a module-scoped variable so that multiple CoreTrends calls within the same
 *   server request share the parsed data.
 *
 * Convention: top-level object (no IIFE). Follows the CoreSalesforce pattern.
 */

// Module-scoped cache. Cleared between server requests automatically
// (Apps Script executions are stateless). Set to null to signal "not yet loaded".
var _CoreHistory_historyCache = null;

var CoreHistory = {

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Returns a map of all history events grouped by deployment (ParentId).
   *
   * @param {AppConfig} cfg  App configuration.
   * @return {Object}  Map: { '<deploymentId>': { events: [{ field, old, new, at, by }] } }
   *
   * Cached per-execution. Returns {} gracefully if the sheet is missing or empty.
   */
  getHistoryMap: function (cfg) {
    if (_CoreHistory_historyCache !== null) return _CoreHistory_historyCache;

    cfg = CoreConfig.withDefaults(cfg);
    var sheetName = (cfg.sheets && cfg.sheets.deploymentHistory) || 'SFDC_DeploymentHistory';
    Logger.log('CoreHistory.getHistoryMap: reading ' + sheetName + '...');

    var rows = CoreHistory._readHistorySheet_(sheetName);
    if (!rows || rows.length === 0) {
      Logger.log('CoreHistory.getHistoryMap: no data rows \u2014 returning empty map.');
      _CoreHistory_historyCache = {};
      return _CoreHistory_historyCache;
    }

    var map = {};
    rows.forEach(function (r) {
      var parentId = String(r.parentId || '').trim();
      if (!parentId) return;
      if (!map[parentId]) {
        map[parentId] = { events: [] };
      }
      map[parentId].events.push({
        field:    String(r.field    || ''),
        old:      String(r.oldValue || ''),
        'new':    String(r.newValue || ''),
        at:       CoreHistory._parseTimestamp_(r.createdDate),
        by:       String(r.createdById || '')
      });
    });

    var deploymentCount = Object.keys(map).length;
    var eventCount = 0;
    Object.keys(map).forEach(function (id) { eventCount += map[id].events.length; });
    Logger.log('CoreHistory.getHistoryMap: parsed ' + eventCount + ' events across ' +
               deploymentCount + ' deployments');

    _CoreHistory_historyCache = map;
    return map;
  },

  /**
   * Returns a chronological list of state episodes for a given field on a
   * given deployment. Handles the implicit "before-history" episode from the
   * first event's OldValue.
   *
   * @param {AppConfig} cfg
   * @param {string} deploymentId  18-char Salesforce deployment Id.
   * @param {string} fieldName     E.g. 'Overall_Health__c' or 'Deployment_Stage__c'.
   * @return {Array<Object>}
   *   [{ value, from: 'YYYY-MM-DD'|null, to: 'YYYY-MM-DD'|null, durationDays: number|null }]
   *
   * Returns [] if no events found for this field. Edge cases:
   *   - First event has non-empty OldValue: prepend an implicit episode with from=null.
   *   - Last (open) episode: to=null, durationDays=days since from.
   *   - Open episode from > today: durationDays=0 with a Logger warning.
   */
  getStateHistory: function (cfg, deploymentId, fieldName) {
    var historyMap = CoreHistory.getHistoryMap(cfg);
    var entry = historyMap[String(deploymentId || '').trim()];
    if (!entry || !entry.events || entry.events.length === 0) return [];

    // Filter to this field and ensure chronological order.
    var fieldEvents = entry.events.filter(function (e) {
      return e.field === fieldName;
    });
    if (fieldEvents.length === 0) return [];

    // Sort by timestamp (events should already be ordered, but be safe).
    fieldEvents = fieldEvents.slice().sort(function (a, b) {
      return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0);
    });

    var tz = Session.getScriptTimeZone();
    var today = CoreHistory._toDateOnly_(new Date(), tz);

    var episodes = [];

    // Implicit prior episode from first event's OldValue.
    if (fieldEvents[0].old && fieldEvents[0].old !== '') {
      var firstDate = CoreHistory._toDateOnly_(fieldEvents[0].at, tz);
      episodes.push({
        value:        fieldEvents[0].old,
        from:         null,
        to:           firstDate,
        durationDays: null
      });
    }

    // Walk events: each event closes the previous episode and opens a new one.
    for (var i = 0; i < fieldEvents.length; i++) {
      var ev = fieldEvents[i];
      var fromDate = CoreHistory._toDateOnly_(ev.at, tz);
      var toDate   = (i < fieldEvents.length - 1)
        ? CoreHistory._toDateOnly_(fieldEvents[i + 1].at, tz)
        : null;

      var duration;
      if (toDate !== null) {
        duration = CoreHistory._daysBetween_(fromDate, toDate);
      } else {
        // Open episode — compute duration to today.
        if (fromDate > today) {
          Logger.log('CoreHistory.getStateHistory: WARNING \u2014 open episode "from" date ' +
                     fromDate + ' is in the future for deployment ' + deploymentId +
                     ' field ' + fieldName + '. Setting durationDays=0.');
          duration = 0;
        } else {
          duration = CoreHistory._daysBetween_(fromDate, today);
        }
      }

      episodes.push({
        value:        ev['new'],
        from:         fromDate,
        to:           toDate,
        durationDays: duration
      });
    }

    return episodes;
  },

  /**
   * Returns the current (open) state episode for a deployment field, or null.
   *
   * @param {AppConfig} cfg
   * @param {string} deploymentId
   * @param {string} fieldName
   * @return {{ value: string, enteredAt: string, durationDays: number }|null}
   */
  getCurrentStateDuration: function (cfg, deploymentId, fieldName) {
    var episodes = CoreHistory.getStateHistory(cfg, deploymentId, fieldName);
    if (!episodes || episodes.length === 0) return null;
    var last = episodes[episodes.length - 1];
    if (last.to !== null) return null; // No open episode.
    return {
      value:        last.value,
      enteredAt:    last.from,
      durationDays: last.durationDays
    };
  },

  /**
   * Returns the current effective MTP date for a deployment by reading
   * SFDC_Deployments and coalescing Actual → Change → Baseline.
   *
   * @param {AppConfig} cfg
   * @param {string} deploymentId
   * @return {{ date: string, source: string }|null}
   */
  getCurrentMTPDate: function (cfg, deploymentId) {
    cfg = CoreConfig.withDefaults(cfg);
    var sheetName = (cfg.sheets && cfg.sheets.deployments) || 'SFDC_Deployments';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return null;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;

    var lastCol  = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers   = allValues[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

    // Detect columns.
    var colId       = CoreHistory._findColExact_(headers, 'id');
    var colMtpDate  = CoreHistory._findColContains_(headers, 'current_mtp_date');
    var colActual   = CoreHistory._findColContains_(headers, 'first_move_to_production_date_actual');
    var colBaseline = CoreHistory._findColContains_(headers, '_oemb__c');
    // "Change" field (C__c pattern for change-controlled MTP)
    var colChange   = CoreHistory._findColContains_(headers, 'current_mtp_date'); // same as mtpDate

    var tz = Session.getScriptTimeZone();
    var targetId = String(deploymentId || '').trim();

    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];
      var rowId = colId >= 0 ? String(row[colId] || '').trim() : '';
      if (rowId !== targetId) continue;

      // Coalesce: Actual ?? Change ?? Baseline
      var actualVal   = colActual   >= 0 ? row[colActual]   : null;
      var mtpVal      = colMtpDate  >= 0 ? row[colMtpDate]  : null;
      var baselineVal = colBaseline >= 0 ? row[colBaseline] : null;

      var actualStr   = CoreHistory._normalizeDate_(actualVal, tz);
      var mtpStr      = CoreHistory._normalizeDate_(mtpVal, tz);
      var baselineStr = CoreHistory._normalizeDate_(baselineVal, tz);

      if (actualStr)   return { date: actualStr,   source: 'Actual' };
      if (mtpStr)      return { date: mtpStr,       source: 'Change' };
      if (baselineStr) return { date: baselineStr,  source: 'Baseline' };
      return null;
    }
    return null;
  },

  /**
   * Returns the chronological history of effective MTP date changes for a
   * deployment, replayed from the history events.
   *
   * @param {AppConfig} cfg
   * @param {string} deploymentId
   * @return {Array<{ date: string, source: string, setAt: string }>}
   */
  getMTPDateHistory: function (cfg, deploymentId) {
    var historyMap = CoreHistory.getHistoryMap(cfg);
    var entry = historyMap[String(deploymentId || '').trim()];
    if (!entry || !entry.events || entry.events.length === 0) return [];

    // Filter to MTP-related fields, classify into source types.
    var mtpEvents = entry.events.filter(function (e) {
      var f = e.field.toLowerCase();
      return f.indexOf('mtp') !== -1 ||
             f.indexOf('move_to_production') !== -1 ||
             f.indexOf('oemb') !== -1 ||
             f.indexOf('current_mtp') !== -1;
    }).map(function (e) {
      var f = e.field.toLowerCase();
      var source;
      if (f.indexOf('actual') !== -1) {
        source = 'Actual';
      } else if (f.indexOf('oemb') !== -1 || f.indexOf('baseline') !== -1) {
        source = 'Baseline';
      } else {
        source = 'Change';
      }
      return {
        source: source,
        rawDate: e['new'],
        setAt: e.at
      };
    });

    if (mtpEvents.length === 0) return [];

    // Sort chronologically.
    mtpEvents.sort(function (a, b) {
      return a.setAt < b.setAt ? -1 : (a.setAt > b.setAt ? 1 : 0);
    });

    var tz = Session.getScriptTimeZone();

    // Walk events maintaining running values per source, emit when effective
    // MTP date or driving source changes.
    var runningActual   = null;
    var runningChange   = null;
    var runningBaseline = null;
    var prevEffective   = null;
    var prevSource      = null;
    var result          = [];

    mtpEvents.forEach(function (ev) {
      var dateStr = CoreHistory._normalizeDate_(ev.rawDate, tz);
      if (ev.source === 'Actual')   runningActual   = dateStr;
      if (ev.source === 'Change')   runningChange   = dateStr;
      if (ev.source === 'Baseline') runningBaseline = dateStr;

      // Coalesce: Actual ?? Change ?? Baseline
      var effectiveDate = runningActual || runningChange || runningBaseline || null;
      var effectiveSource = runningActual   ? 'Actual'   :
                            runningChange   ? 'Change'   :
                            runningBaseline ? 'Baseline' : null;

      if (effectiveDate !== prevEffective || effectiveSource !== prevSource) {
        if (effectiveDate) {
          result.push({
            date:   effectiveDate,
            source: effectiveSource,
            setAt:  ev.setAt
          });
        }
        prevEffective = effectiveDate;
        prevSource    = effectiveSource;
      }
    });

    return result;
  },

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Reads the SFDC_DeploymentHistory sheet and returns raw row objects.
   * @param {string} sheetName
   * @return {Array<Object>}
   * @private
   */
  _readHistorySheet_: function (sheetName) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('CoreHistory._readHistorySheet_: sheet "' + sheetName + '" not found.');
      return [];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var lastCol  = sheet.getLastColumn();
    var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers   = allValues[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

    // Column detection — match expected header names case-insensitively.
    var colId          = CoreHistory._findColExact_(headers, 'id');
    var colParentId    = CoreHistory._findColExact_(headers, 'parentid');
    var colField       = CoreHistory._findColExact_(headers, 'field');
    var colOldValue    = CoreHistory._findColExact_(headers, 'oldvalue');
    var colNewValue    = CoreHistory._findColExact_(headers, 'newvalue');
    var colCreatedDate = CoreHistory._findColExact_(headers, 'createddate');
    var colCreatedById = CoreHistory._findColExact_(headers, 'createdbyid');

    // Fallback to positional if headers don't match exactly.
    if (colId          < 0) colId          = 0;
    if (colParentId    < 0) colParentId    = 1;
    if (colField       < 0) colField       = 2;
    if (colOldValue    < 0) colOldValue    = 3;
    if (colNewValue    < 0) colNewValue    = 4;
    if (colCreatedDate < 0) colCreatedDate = 5;
    if (colCreatedById < 0) colCreatedById = 6;

    var rows = [];
    for (var r = 1; r < allValues.length; r++) {
      var row = allValues[r];
      var parentId = colParentId >= 0 ? String(row[colParentId] || '').trim() : '';
      if (!parentId) continue;
      rows.push({
        id:          colId          >= 0 ? String(row[colId]          || '') : '',
        parentId:    parentId,
        field:       colField       >= 0 ? String(row[colField]       || '') : '',
        oldValue:    colOldValue    >= 0 ? String(row[colOldValue]    || '') : '',
        newValue:    colNewValue    >= 0 ? String(row[colNewValue]    || '') : '',
        createdDate: colCreatedDate >= 0 ? row[colCreatedDate]                : null,
        createdById: colCreatedById >= 0 ? String(row[colCreatedById] || '') : ''
      });
    }
    return rows;
  },

  /**
   * Parses a raw timestamp value (Date object, ISO string, or numeric serial)
   * into an ISO 8601 string. Returns '' on failure.
   * @param {any} value
   * @return {string}
   * @private
   */
  _parseTimestamp_: function (value) {
    if (!value) return '';
    var d;
    if (value instanceof Date) {
      d = value;
    } else if (typeof value === 'number') {
      d = new Date(value);
      if (isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) {
        d = new Date(String(value));
      }
    } else {
      d = new Date(String(value));
    }
    if (!d || isNaN(d.getTime())) return '';
    return d.toISOString();
  },

  /**
   * Normalizes any date-like value to a 'YYYY-MM-DD' string using the script
   * timezone. Returns null on failure.
   * @param {any} value
   * @param {string} tz
   * @return {string|null}
   * @private
   */
  _normalizeDate_: function (value, tz) {
    if (!value) return null;
    var d;
    if (value instanceof Date) {
      d = value;
    } else if (typeof value === 'number') {
      d = new Date(value);
      if (isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) {
        d = new Date(String(value));
      }
    } else {
      d = new Date(String(value));
    }
    if (!d || isNaN(d.getTime())) return null;
    return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  /**
   * Converts an ISO timestamp string or Date to a 'YYYY-MM-DD' date-only string.
   * @param {string|Date} isoOrDate
   * @param {string} tz
   * @return {string}
   * @private
   */
  _toDateOnly_: function (isoOrDate, tz) {
    if (!isoOrDate) return '';
    var d = (isoOrDate instanceof Date) ? isoOrDate : new Date(String(isoOrDate));
    if (!d || isNaN(d.getTime())) return '';
    var tzStr = tz || Session.getScriptTimeZone();
    return Utilities.formatDate(d, tzStr, 'yyyy-MM-dd');
  },

  /**
   * Computes the number of whole days between two 'YYYY-MM-DD' strings.
   * Returns 0 if the dates are the same or if from > to.
   * @param {string} fromStr
   * @param {string} toStr
   * @return {number}
   * @private
   */
  _daysBetween_: function (fromStr, toStr) {
    if (!fromStr || !toStr) return 0;
    var from = new Date(fromStr + 'T00:00:00Z');
    var to   = new Date(toStr   + 'T00:00:00Z');
    var ms = to.getTime() - from.getTime();
    if (ms < 0) return 0;
    return Math.floor(ms / 86400000);
  },

  /**
   * Find a column by exact lower-case match.
   * @param {Array<string>} lowerHeaders
   * @param {string} exactKey
   * @return {number}  0-based index, or -1 if not found.
   * @private
   */
  _findColExact_: function (lowerHeaders, exactKey) {
    for (var i = 0; i < lowerHeaders.length; i++) {
      if (lowerHeaders[i] === exactKey) return i;
    }
    return -1;
  },

  /**
   * Find a column whose lower-case header contains the given substring.
   * @param {Array<string>} lowerHeaders
   * @param {string} substr
   * @return {number}  0-based index, or -1 if not found.
   * @private
   */
  _findColContains_: function (lowerHeaders, substr) {
    for (var i = 0; i < lowerHeaders.length; i++) {
      if (lowerHeaders[i].indexOf(substr) !== -1) return i;
    }
    return -1;
  }
};
