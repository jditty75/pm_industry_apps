/**
 * CoreEscalations.js
 *
 * ESC1 — Executive Escalations read-only tab foundation (schema/config/debug).
 * Phase 0: schema/config debug. Phase 1: normalized dashboard payload + KPIs (read-only).
 *
 * Future UI (post Phase 0): prefer Student-style dynamic tab splice in CoreUI_Markup
 * when cfg.escalations.enabled === true (cfg.escalations.tab.insertAfter), combined with
 * ui.roleVisibility on tab id 'escalations'. That keeps pilot/opt-in apps from editing
 * ui.tabs literals. Legacy tabs such as Notable remain ui.tabs + roleVisibility.
 */

var CoreEscalations = (function () {

  var ESCALATION_CONFIGURATION_SHEET_ = 'Escalation_Configuration';

  var CURRENT_STATE_REQUIRED_ = ['customer', 'status'];
  var CURRENT_STATE_KEY_ANY_ = ['id', 'channelId'];
  var SCHEMA_VERSION_ = 1;

  var TEXT_FIELD_KEYS_ = [
    'executiveSummary', 'customerImpact', 'businessImpact', 'technicalStatus',
    'latestDevelopment', 'nextSteps', 'openActions', 'actionOwners', 'keyRisks',
    'decisionsRequired', 'informationGaps'
  ];

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} warning
   * @param {Array<Object>} warnings
   * @private
   */
  function pushWarning_(warnings, code, message, extra) {
    var w = { code: code, message: message };
    if (extra) {
      Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
    }
    warnings.push(w);
  }

  /**
   * @param {string[]} patterns
   * @return {Object<string, boolean>}
   * @private
   */
  function buildPlaceholderPatternSet_(patterns) {
    var set = {};
    (patterns || []).forEach(function (p) {
      var n = safeString_(p).toLowerCase();
      if (n) set[n] = true;
    });
    return set;
  }

  /**
   * @param {string} raw
   * @param {number} maxChars
   * @param {Object<string, boolean>} placeholderSet
   * @return {{ value: string, isPlaceholder: boolean }}
   * @private
   */
  function formatTextField_(raw, maxChars, placeholderSet) {
    var value = safeString_(raw);
    if (!value) return { value: '', isPlaceholder: false };
    if (maxChars > 0 && value.length > maxChars) {
      value = value.substring(0, maxChars);
    }
    var norm = value.toLowerCase();
    var isPlaceholder = false;
    if (placeholderSet[norm]) {
      isPlaceholder = true;
    } else {
      Object.keys(placeholderSet).forEach(function (pat) {
        if (pat && norm.indexOf(pat) !== -1) isPlaceholder = true;
      });
    }
    return { value: value, isPlaceholder: isPlaceholder };
  }

  /**
   * @param {*} value
   * @return {boolean}
   * @private
   */
  function parseBoolean_(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    var s = safeString_(value).toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  /**
   * @param {Date|null} d
   * @return {string|null}
   * @private
   */
  function toIso_(d) {
    if (!d || isNaN(d.getTime())) return null;
    try {
      return d.toISOString();
    } catch (e) {
      return null;
    }
  }

  /**
   * @param {string[]} closedValues
   * @return {Object<string, boolean>}
   * @private
   */
  function buildClosedStatusSet_(closedValues) {
    var set = {};
    (closedValues || []).forEach(function (v) {
      var n = safeString_(v).toLowerCase();
      if (n) set[n] = true;
    });
    return set;
  }

  /**
   * @param {string} raw
   * @return {string}
   * @private
   */
  function normalizeToken_(raw) {
    return safeString_(raw).toLowerCase();
  }

  /**
   * @param {string} severityNorm
   * @param {Object<string, string>} tones
   * @return {string}
   * @private
   */
  function resolveSeverityTone_(severityNorm, tones) {
    if (!severityNorm) return 'neutral';
    if (tones && tones[severityNorm]) return tones[severityNorm];
    return 'neutral';
  }

  /**
   * @param {Array<*>} row
   * @param {Object} colMeta
   * @return {*}
   * @private
   */
  function cellAt_(row, colMeta) {
    if (!colMeta || !colMeta.found || colMeta.index < 0) return '';
    return row[colMeta.index];
  }

  /**
   * @param {Array<*>} row
   * @param {Object} resolvedColumns
   * @return {{ key: string, keySource: string }}
   * @private
   */
  function deriveRowKey_(row, resolvedColumns) {
    var idVal = safeString_(cellAt_(row, resolvedColumns.id));
    if (idVal) return { key: idVal, keySource: 'id' };

    var ch = safeString_(cellAt_(row, resolvedColumns.channelId));
    var ws = safeString_(cellAt_(row, resolvedColumns.workspaceId));
    if (ch && ws) return { key: 'ch:' + ws + ':' + ch, keySource: 'channel' };
    if (ch) return { key: 'ch:' + ch, keySource: 'channel' };
    return { key: '', keySource: '' };
  }

  /**
   * @param {*} raw
   * @return {number}
   * @private
   */
  function parseRecordVersion_(raw) {
    var s = safeString_(raw);
    if (!s) return 0;
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  /**
   * @param {Object} a
   * @param {Object} b
   * @return {Object}
   * @private
   */
  function pickNewerDuplicateRow_(a, b) {
    var vA = a._recordVersion;
    var vB = b._recordVersion;
    if (vB > vA) return b;
    if (vA > vB) return a;
    var uA = a._lastSheetUpdateMs || 0;
    var uB = b._lastSheetUpdateMs || 0;
    if (uB > uA) return b;
    if (uA > uB) return a;
    return a;
  }

  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @return {GoogleAppsScript.Spreadsheet.Spreadsheet|null}
   * @private
   */
  function getSpreadsheet_(ss) {
    try {
      return ss || SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      return null;
    }
  }

  /**
   * @param {*} value
   * @return {string}
   * @private
   */
  function safeString_(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
      try {
        return value.toISOString();
      } catch (e) {
        return String(value);
      }
    }
    return String(value).trim();
  }

  /**
   * @param {Array<*>} row
   * @return {boolean}
   * @private
   */
  function isBlankRow_(row) {
    if (!row || !row.length) return true;
    for (var i = 0; i < row.length; i++) {
      var s = safeString_(row[i]);
      if (s) return false;
    }
    return true;
  }

  /**
   * Case-insensitive header match against alias lists.
   *
   * @param {Array<string>} headers  Row 1 values from the sheet.
   * @param {Object<string, Array<string>>} fieldMap  Keys → alias arrays.
   * @return {Object<string, {found: boolean, index: number, header: (string|null), aliases: string[]}>}
   * @private
   */
  function resolveColumns_(headers, fieldMap) {
    var normalizedHeaders = (headers || []).map(function (h, idx) {
      return { raw: safeString_(h), norm: safeString_(h).toLowerCase(), index: idx };
    });
    var out = {};
    var keys = Object.keys(fieldMap || {});
    for (var k = 0; k < keys.length; k++) {
      var fieldKey = keys[k];
      var aliases = fieldMap[fieldKey] || [];
      if (!Array.isArray(aliases)) aliases = [];
      var found = false;
      var matchIndex = -1;
      var matchHeader = null;
      for (var a = 0; a < aliases.length; a++) {
        var aliasNorm = safeString_(aliases[a]).toLowerCase();
        if (!aliasNorm) continue;
        for (var h = 0; h < normalizedHeaders.length; h++) {
          if (normalizedHeaders[h].norm === aliasNorm) {
            found = true;
            matchIndex = normalizedHeaders[h].index;
            matchHeader = normalizedHeaders[h].raw || null;
            break;
          }
        }
        if (found) break;
      }
      out[fieldKey] = {
        found: found,
        index: found ? matchIndex : -1,
        header: matchHeader,
        aliases: aliases.slice()
      };
    }
    return out;
  }

  /**
   * @param {*} value
   * @param {string=} tz
   * @return {Date|null}
   * @private
   */
  function parseDate_(value, tz) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number' && isFinite(value)) {
      var ms = value;
      if (value > 0 && value < 1e12) ms = value * 1000;
      var fromNum = new Date(ms);
      return isNaN(fromNum.getTime()) ? null : fromNum;
    }
    var s = safeString_(value);
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) {
      var n = parseFloat(s);
      if (isFinite(n)) {
        var nMs = n < 1e12 ? n * 1000 : n;
        var fromEpoch = new Date(nMs);
        return isNaN(fromEpoch.getTime()) ? null : fromEpoch;
      }
    }
    var direct = new Date(s);
    if (!isNaN(direct.getTime())) return direct;
    var isoLike = s.replace(' ', 'T');
    var fromIso = new Date(isoLike);
    if (!isNaN(fromIso.getTime())) return fromIso;
    try {
      var zone = tz || Session.getScriptTimeZone();
      var parsed = Utilities.parseDate(s, zone, 'yyyy-MM-dd HH:mm:ss');
      if (parsed && !isNaN(parsed.getTime())) return parsed;
    } catch (e1) { /* no-op */ }
    try {
      var zone2 = tz || Session.getScriptTimeZone();
      var parsed2 = Utilities.parseDate(s, zone2, 'yyyy-MM-dd');
      if (parsed2 && !isNaN(parsed2.getTime())) return parsed2;
    } catch (e2) { /* no-op */ }
    return null;
  }

  /**
   * Read-only sheet snapshot (bounded data rows).
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} ss
   * @param {string} sheetName
   * @param {number=} maxDataRows  Max data rows to load (after header); 0 = no cap.
   * @return {Object}
   * @private
   */
  function readSheet_(ss, sheetName, maxDataRows) {
    var empty = {
      found: false,
      sheetName: sheetName,
      headers: [],
      rows: [],
      rowCount: 0,
      columnCount: 0
    };
    var spreadsheet;
    try {
      spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      return empty;
    }
    if (!spreadsheet) return empty;

    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return empty;

    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < 1 || lastColumn < 1) {
      return {
        found: true,
        sheetName: sheetName,
        headers: [],
        rows: [],
        rowCount: 0,
        columnCount: 0,
        lastRow: lastRow,
        lastColumn: lastColumn
      };
    }

    var dataRowCount = Math.max(0, lastRow - 1);
    var readLastRow = lastRow;
    if (maxDataRows > 0 && dataRowCount > maxDataRows) {
      readLastRow = 1 + maxDataRows;
    }

    var values = sheet.getRange(1, 1, readLastRow, lastColumn).getValues();
    var headers = (values[0] || []).map(function (c) { return safeString_(c); });
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      rows.push(values[r]);
    }

    return {
      found: true,
      sheetName: sheetName,
      headers: headers,
      rows: rows,
      rowCount: dataRowCount,
      columnCount: lastColumn,
      lastRow: lastRow,
      lastColumn: lastColumn
    };
  }

  /**
   * @param {Object} resolvedColumns
   * @param {string[]} requiredKeys
   * @param {string[]} keyAnyKeys
   * @return {string[]}
   * @private
   */
  function listMissingRequired_(resolvedColumns, requiredKeys, keyAnyKeys) {
    var missing = [];
    if (keyAnyKeys && keyAnyKeys.length) {
      var anyFound = false;
      for (var i = 0; i < keyAnyKeys.length; i++) {
        var k = keyAnyKeys[i];
        if (resolvedColumns[k] && resolvedColumns[k].found) {
          anyFound = true;
          break;
        }
      }
      if (!anyFound) {
        missing.push('id|channelId');
      }
    }
    for (var j = 0; j < requiredKeys.length; j++) {
      var rk = requiredKeys[j];
      if (!resolvedColumns[rk] || !resolvedColumns[rk].found) {
        missing.push(rk);
      }
    }
    return missing;
  }

  /**
   * @param {Object} resolvedColumns
   * @param {string[]} requiredKeys
   * @param {string[]} keyAnyKeys
   * @param {Object<string, Array<string>>} fieldMap
   * @return {string[]}
   * @private
   */
  function listMissingOptional_(resolvedColumns, requiredKeys, keyAnyKeys, fieldMap) {
    var requiredSet = {};
    requiredKeys.forEach(function (k) { requiredSet[k] = true; });
    keyAnyKeys.forEach(function (k) { requiredSet[k] = true; });
    var missing = [];
    Object.keys(fieldMap || {}).forEach(function (fk) {
      if (requiredSet[fk]) return;
      if (!resolvedColumns[fk] || !resolvedColumns[fk].found) {
        missing.push(fk);
      }
    });
    return missing;
  }

  /**
   * @param {Array<Array<*>>} rows
   * @param {Object} resolvedColumns
   * @return {{ blankRowCount: number, noKeyRowCount: number, duplicateKeyCount: number, sampleKeys: string[] }}
   * @private
   */
  function analyzeCurrentStateKeys_(rows, resolvedColumns) {
    var blankRowCount = 0;
    var noKeyRowCount = 0;
    var keyCounts = {};
    var sampleKeys = [];
    (rows || []).forEach(function (row) {
      if (isBlankRow_(row)) {
        blankRowCount++;
        return;
      }
      var keyInfo = deriveRowKey_(row, resolvedColumns);
      var key = keyInfo.key;
      if (!key) {
        noKeyRowCount++;
        return;
      }
      keyCounts[key] = (keyCounts[key] || 0) + 1;
      if (sampleKeys.length < 8 && sampleKeys.indexOf(key) === -1) {
        sampleKeys.push(key);
      }
    });

    var duplicateKeyCount = 0;
    Object.keys(keyCounts).forEach(function (k) {
      if (keyCounts[k] > 1) duplicateKeyCount++;
    });

    return {
      blankRowCount: blankRowCount,
      noKeyRowCount: noKeyRowCount,
      duplicateKeyCount: duplicateKeyCount,
      sampleKeys: sampleKeys
    };
  }

  /**
   * @param {AppConfig} cfg
   * @param {string} sheetKey  e.g. 'currentState'
   * @param {boolean} isRequired
   * @param {string[]} requiredFieldKeys
   * @param {string[]} keyAnyFieldKeys
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {number} maxDataRows
   * @return {Object}
   * @private
   */
  function buildSheetDiagnostic_(
    cfg, sheetKey, isRequired, requiredFieldKeys, keyAnyFieldKeys, ss, maxDataRows
  ) {
    var esc = cfg.escalations || {};
    var sheetsCfg = esc.sheets || {};
    var configuredName = sheetsCfg[sheetKey] || '';
    var fieldMap = (esc.fields && esc.fields[sheetKey]) || {};
    var read = readSheet_(ss, configuredName, maxDataRows);
    var resolvedColumns = resolveColumns_(read.headers, fieldMap);
    var missingRequired = listMissingRequired_(resolvedColumns, requiredFieldKeys, keyAnyFieldKeys);
    var missingOptional = listMissingOptional_(
      resolvedColumns, requiredFieldKeys, keyAnyFieldKeys, fieldMap
    );

    var keyStats = {
      blankRowCount: 0,
      noKeyRowCount: 0,
      duplicateKeyCount: 0,
      sampleKeys: []
    };
    if (sheetKey === 'currentState' && read.found) {
      keyStats = analyzeCurrentStateKeys_(read.rows, resolvedColumns);
    }

    return {
      configuredName: configuredName,
      required: isRequired,
      found: read.found,
      rowCount: read.rowCount || 0,
      columnCount: read.columnCount || 0,
      headers: read.headers || [],
      resolvedColumns: resolvedColumns,
      missingRequired: missingRequired,
      missingOptional: missingOptional,
      blankRowCount: keyStats.blankRowCount,
      noKeyRowCount: keyStats.noKeyRowCount,
      duplicateKeyCount: keyStats.duplicateKeyCount,
      sampleKeys: keyStats.sampleKeys
    };
  }

  /**
   * @param {string} statusNorm
   * @param {Object<string, boolean>} closedSet
   * @return {boolean}
   * @private
   */
  function isActiveStatus_(statusNorm, closedSet) {
    if (!statusNorm) return true;
    return !closedSet[statusNorm];
  }

  /**
   * @param {AppConfig} cfg
   * @param {Array<Array<*>>} rows
   * @param {Object} resolvedColumns
   * @param {Object<string, boolean>} closedSet
   * @param {Object} tones
   * @param {number} maxTextChars
   * @param {Object<string, boolean>} placeholderSet
   * @param {string} tz
   * @return {Array<Object>}
   * @private
   */
  function parseCurrentStateRows_(
    cfg, rows, resolvedColumns, closedSet, tones, maxTextChars, placeholderSet, tz
  ) {
    var parsed = [];
    (rows || []).forEach(function (row) {
      if (isBlankRow_(row)) return;
      var keyInfo = deriveRowKey_(row, resolvedColumns);
      if (!keyInfo.key) return;

      var openedAt = parseDate_(cellAt_(row, resolvedColumns.openedAt), tz);
      var lastActivityAt = parseDate_(cellAt_(row, resolvedColumns.lastActivityAt), tz);
      var lastAnalysisAt = parseDate_(cellAt_(row, resolvedColumns.lastAnalysisAt), tz);
      var lastSheetUpdateAt = parseDate_(cellAt_(row, resolvedColumns.lastSheetUpdateAt), tz);

      var openedMs = openedAt ? openedAt.getTime() : null;
      var lastActivityMs = lastActivityAt ? lastActivityAt.getTime() : null;
      var lastAnalysisMs = lastAnalysisAt ? lastAnalysisAt.getTime() : null;
      var lastSheetUpdateMs = lastSheetUpdateAt ? lastSheetUpdateAt.getTime() : null;

      var effectiveDate = lastActivityAt || lastSheetUpdateAt || openedAt;
      var effectiveUpdatedMs = effectiveDate ? effectiveDate.getTime() : null;

      var statusRaw = safeString_(cellAt_(row, resolvedColumns.status));
      var statusNorm = normalizeToken_(statusRaw);
      var severityRaw = safeString_(cellAt_(row, resolvedColumns.severity));
      var severityNorm = normalizeToken_(severityRaw);

      var text = {};
      TEXT_FIELD_KEYS_.forEach(function (fk) {
        text[fk] = formatTextField_(cellAt_(row, resolvedColumns[fk]), maxTextChars, placeholderSet);
      });

      parsed.push({
        key: keyInfo.key,
        keySource: keyInfo.keySource,
        id: safeString_(cellAt_(row, resolvedColumns.id)),
        customer: safeString_(cellAt_(row, resolvedColumns.customer)),
        channelName: safeString_(cellAt_(row, resolvedColumns.channelName)),
        channelId: safeString_(cellAt_(row, resolvedColumns.channelId)),
        status: statusRaw,
        statusNorm: statusNorm,
        severity: severityRaw,
        severityNorm: severityNorm,
        severityTone: resolveSeverityTone_(severityNorm, tones),
        isActive: isActiveStatus_(statusNorm, closedSet),
        execAttention: parseBoolean_(cellAt_(row, resolvedColumns.execAttention)),
        execAttentionReason: safeString_(cellAt_(row, resolvedColumns.execAttentionReason)),
        openedAt: toIso_(openedAt),
        openedMs: openedMs,
        lastActivityAt: toIso_(lastActivityAt),
        lastActivityMs: lastActivityMs,
        lastAnalysisAt: toIso_(lastAnalysisAt),
        lastAnalysisMs: lastAnalysisMs,
        lastSheetUpdateAt: toIso_(lastSheetUpdateAt),
        lastSheetUpdateMs: lastSheetUpdateMs,
        effectiveUpdatedAt: toIso_(effectiveDate),
        effectiveUpdatedMs: effectiveUpdatedMs,
        recordVersion: safeString_(cellAt_(row, resolvedColumns.recordVersion)),
        text: text,
        _recordVersion: parseRecordVersion_(cellAt_(row, resolvedColumns.recordVersion)),
        _lastSheetUpdateMs: lastSheetUpdateMs || 0
      });
    });
    return parsed;
  }

  /**
   * @param {Array<Object>} rows
   * @return {{ rows: Array<Object>, duplicateCount: number }}
   * @private
   */
  function dedupeEscalationRows_(rows) {
    var byKey = {};
    var duplicateCount = 0;
    rows.forEach(function (row) {
      if (!byKey[row.key]) {
        byKey[row.key] = row;
      } else {
        duplicateCount++;
        byKey[row.key] = pickNewerDuplicateRow_(byKey[row.key], row);
      }
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) { out.push(byKey[k]); });
    return { rows: out, duplicateCount: duplicateCount };
  }

  /**
   * @param {Object} esc
   * @param {number} nowMs
   * @param {number} thresholdDays
   * @return {number|null}
   * @private
   */
  function computeDaysSinceUpdate_(esc, nowMs, thresholdDays) {
    if (!esc.effectiveUpdatedMs) return null;
    var days = (nowMs - esc.effectiveUpdatedMs) / (24 * 60 * 60 * 1000);
    return Math.round(days * 10) / 10;
  }

  /**
   * @param {Object} esc
   * @param {string} updatedField
   * @return {number|null}
   * @private
   */
  function getUpdatedFieldMs_(esc, updatedField) {
    var field = updatedField || 'lastSheetUpdateAt';
    if (field === 'lastActivityAt') return esc.lastActivityMs;
    if (field === 'lastAnalysisAt') return esc.lastAnalysisMs;
    if (field === 'openedAt') return esc.openedMs;
    return esc.lastSheetUpdateMs;
  }

  /**
   * @param {Array<Object>} escalations
   * @param {number} nowMs
   * @param {AppConfig} cfg
   * @private
   */
  function enrichEscalationFlags_(escalations, nowMs, cfg) {
    var kpi = cfg.escalations.kpi || {};
    var newWindowMs = (kpi.newWindowDays || 7) * 24 * 60 * 60 * 1000;
    var updatedWindowMs = (kpi.updatedWindowHours || 24) * 60 * 60 * 1000;
    var thresholdDays = kpi.noUpdateDaysThreshold || 7;
    var updatedField = kpi.updatedField || 'lastSheetUpdateAt';

    escalations.forEach(function (esc) {
      esc.daysSinceUpdate = computeDaysSinceUpdate_(esc, nowMs, thresholdDays);
      esc.isStale = esc.isActive && (
        !esc.effectiveUpdatedMs ||
        esc.daysSinceUpdate > thresholdDays
      );
      esc.isNew = !!(esc.openedMs && (nowMs - esc.openedMs) <= newWindowMs);
      var updatedMs = getUpdatedFieldMs_(esc, updatedField);
      esc.isUpdatedRecently = esc.isActive && !!updatedMs &&
        (nowMs - updatedMs) <= updatedWindowMs;
      delete esc._recordVersion;
      delete esc._lastSheetUpdateMs;
    });
  }

  /**
   * @param {Array<Object>} escalations
   * @private
   */
  function sortActiveEscalations_(escalations) {
    escalations.sort(function (a, b) {
      var euA = a.effectiveUpdatedMs || 0;
      var euB = b.effectiveUpdatedMs || 0;
      if (euB !== euA) return euB - euA;
      var oA = a.openedMs || 0;
      var oB = b.openedMs || 0;
      if (oB !== oA) return oB - oA;
      return String(a.key).localeCompare(String(b.key));
    });
  }

  /**
   * @param {AppConfig} cfg
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {Object<string, boolean>} closedSet
   * @param {number} nowMs
   * @return {Object}
   * @private
   */
  function buildChannelRegistryKpi_(cfg, ss, closedSet, nowMs) {
    var esc = cfg.escalations;
    var sheetName = esc.sheets.channelRegistry;
    var read = readSheet_(ss, sheetName, 0);
    if (!read.found) {
      return {
        value: null,
        total: null,
        withoutEscalation: null,
        available: false,
        activeChannelIds: [],
        latestRegisteredMs: null
      };
    }
    var resolved = resolveColumns_(read.headers, esc.fields.channelRegistry);
    var byChannel = {};
    read.rows.forEach(function (row) {
      if (isBlankRow_(row)) return;
      var channelId = safeString_(cellAt_(row, resolved.channelId));
      if (!channelId) return;
      var statusNorm = normalizeToken_(cellAt_(row, resolved.status));
      var closedAtBlank = !safeString_(cellAt_(row, resolved.closedAt));
      var isActive = closedAtBlank && isActiveStatus_(statusNorm, closedSet);
      if (!byChannel[channelId]) {
        byChannel[channelId] = { active: false, statusNorm: statusNorm };
      }
      if (isActive) byChannel[channelId].active = true;
    });

    var activeIds = [];
    Object.keys(byChannel).forEach(function (cid) {
      if (byChannel[cid].active) activeIds.push(cid);
    });

    var latestRegisteredMs = null;
    read.rows.forEach(function (row) {
      if (isBlankRow_(row)) return;
      var d = parseDate_(cellAt_(row, resolved.registeredAt));
      if (d) {
        var ms = d.getTime();
        if (!latestRegisteredMs || ms > latestRegisteredMs) latestRegisteredMs = ms;
      }
    });

    return {
      value: activeIds.length,
      total: Object.keys(byChannel).length,
      withoutEscalation: null,
      available: true,
      activeChannelIds: activeIds,
      latestRegisteredMs: latestRegisteredMs
    };
  }

  /**
   * @param {AppConfig} cfg
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @return {number|null}
   * @private
   */
  function getLatestProcessingLogMs_(cfg, ss) {
    var sheetName = cfg.escalations.sheets.processingLog;
    var read = readSheet_(ss, sheetName, 0);
    if (!read.found) return null;
    var resolved = resolveColumns_(read.headers, cfg.escalations.fields.processingLog);
    var latest = null;
    read.rows.forEach(function (row) {
      if (isBlankRow_(row)) return;
      var d = parseDate_(cellAt_(row, resolved.processedAt));
      if (!d) return;
      var ms = d.getTime();
      if (!latest || ms > latest) latest = ms;
    });
    return latest;
  }

  /**
   * @param {Array<Object>} allEscalations
   * @param {Object} registryKpi
   * @param {number|null} processingLogMs
   * @param {number|null} registryLatestMs
   * @param {number} nowMs
   * @param {AppConfig} cfg
   * @return {Object}
   * @private
   */
  function buildLastAgentActivity_(
    allEscalations, registryKpi, processingLogMs, registryLatestMs, nowMs, cfg
  ) {
    var bestMs = null;
    var source = null;

    if (processingLogMs && (!bestMs || processingLogMs > bestMs)) {
      bestMs = processingLogMs;
      source = 'processingLog';
    }

    allEscalations.forEach(function (esc) {
      if (esc.lastAnalysisMs && (!bestMs || esc.lastAnalysisMs > bestMs)) {
        bestMs = esc.lastAnalysisMs;
        source = 'currentState';
      }
      if (esc.lastSheetUpdateMs && (!bestMs || esc.lastSheetUpdateMs > bestMs)) {
        bestMs = esc.lastSheetUpdateMs;
        source = 'currentState';
      }
    });

    if (registryLatestMs && (!bestMs || registryLatestMs > bestMs)) {
      bestMs = registryLatestMs;
      source = 'channelRegistry';
    }

    var ageHours = null;
    if (bestMs) {
      ageHours = Math.round(((nowMs - bestMs) / (60 * 60 * 1000)) * 10) / 10;
    }
    var quietHours = (cfg.escalations.kpi && cfg.escalations.kpi.quietNoticeHours) || 72;

    return {
      at: bestMs ? new Date(bestMs).toISOString() : null,
      source: source,
      ageHours: ageHours,
      quietNotice: ageHours !== null && ageHours > quietHours
    };
  }

  /**
   * @param {Array<Object>} allEscalations
   * @param {Object} registryKpi
   * @param {Object<string, boolean>} closedSet
   * @param {Array<Object>} warnings
   * @private
   */
  function applyRegistryMismatchWarnings_(allEscalations, registryKpi, closedSet, warnings) {
    if (!registryKpi.available) return;
    var escByChannel = {};
    allEscalations.forEach(function (esc) {
      if (esc.channelId) escByChannel[esc.channelId] = esc;
    });
    // Lightweight mismatch: active escalation but channel not in active registry set.
    var activeSet = {};
    (registryKpi.activeChannelIds || []).forEach(function (id) { activeSet[id] = true; });
    var mismatchCount = 0;
    allEscalations.forEach(function (esc) {
      if (!esc.isActive || !esc.channelId) return;
      if (!activeSet[esc.channelId]) mismatchCount++;
    });
    if (mismatchCount > 0) {
      pushWarning_(warnings, 'REGISTRY_STATUS_MISMATCH',
        'Active escalations with channel not in active registry', { count: mismatchCount });
    }
  }

  /**
   * @param {AppConfig} cfg
   * @param {Object=} options
   * @return {Object}
   */
  function getDashboardData(config, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(config);
    var appId = cfg.appId || '';
    var tz = Session.getScriptTimeZone();
    var nowMs = options.nowMs != null ? options.nowMs : Date.now();
    var escCfg = cfg.escalations;

    if (escCfg.enabled !== true) {
      return {
        ok: false,
        status: 'disabled',
        schemaVersion: SCHEMA_VERSION_,
        appId: appId,
        message: 'Escalations are not enabled for this app.'
      };
    }

    var warnings = [];
    var ss = getSpreadsheet_(options.spreadsheet);

    try {
      var maxRows = (escCfg.display && escCfg.display.maxRows) || 200;
      var maxTextChars = (escCfg.display && escCfg.display.textMaxChars) || 4000;
      var placeholderSet = buildPlaceholderPatternSet_(escCfg.display.placeholderPatterns);
      var closedSet = buildClosedStatusSet_(escCfg.status.closedStatusValues);
      var tones = escCfg.severity.tones || {};

      var sheetName = escCfg.sheets.currentState;
      var read = readSheet_(ss, sheetName, 0);
      var fieldMap = escCfg.fields.currentState || {};
      var resolvedColumns = resolveColumns_(read.headers, fieldMap);
      var missingRequired = listMissingRequired_(
        resolvedColumns, CURRENT_STATE_REQUIRED_, CURRENT_STATE_KEY_ANY_
      );
      var missingOptional = listMissingOptional_(
        resolvedColumns, CURRENT_STATE_REQUIRED_, CURRENT_STATE_KEY_ANY_, fieldMap
      );

      var missingSheets = [];
      if (!read.found) missingSheets.push(sheetName);

      var setup = {
        ok: read.found && !missingRequired.length,
        missingSheets: missingSheets,
        missingRequired: missingRequired.length ? { currentState: missingRequired } : {},
        missingOptional: missingOptional.length ? { currentState: missingOptional } : {}
      };

      if (!setup.ok) {
        return {
          ok: false,
          status: 'setup_required',
          schemaVersion: SCHEMA_VERSION_,
          appId: appId,
          generatedAt: new Date(nowMs).toISOString(),
          timeZone: tz,
          settings: {
            tabLabel: escCfg.tab.label,
            newWindowDays: escCfg.kpi.newWindowDays,
            updatedWindowHours: escCfg.kpi.updatedWindowHours,
            noUpdateDaysThreshold: escCfg.kpi.noUpdateDaysThreshold
          },
          kpis: null,
          escalations: [],
          counts: {
            totalRows: 0,
            active: 0,
            closed: 0,
            skippedNoKey: 0,
            duplicates: 0,
            truncated: 0
          },
          setup: setup,
          warnings: warnings
        };
      }

      var keyStats = analyzeCurrentStateKeys_(read.rows, resolvedColumns);
      if (keyStats.noKeyRowCount > 0) {
        pushWarning_(warnings, 'ROW_NO_KEY', 'Rows skipped with no escalation key',
          { count: keyStats.noKeyRowCount });
      }

      var rawParsed = parseCurrentStateRows_(
        cfg, read.rows, resolvedColumns, closedSet, tones, maxTextChars, placeholderSet, tz
      );
      var skippedNoKey = keyStats.noKeyRowCount;
      var deduped = dedupeEscalationRows_(rawParsed);
      if (deduped.duplicateCount > 0) {
        pushWarning_(warnings, 'DUPLICATE_KEY', 'Duplicate keys resolved by record version',
          { count: deduped.duplicateCount });
      }

      var allEscalations = deduped.rows;
      enrichEscalationFlags_(allEscalations, nowMs, cfg);

      var optionalSheetKeys = [
        { key: 'channelRegistry', name: escCfg.sheets.channelRegistry },
        { key: 'processingLog', name: escCfg.sheets.processingLog },
        { key: 'updateHistory', name: escCfg.sheets.updateHistory }
      ];
      optionalSheetKeys.forEach(function (item) {
        var optRead = readSheet_(ss, item.name, 0);
        if (!optRead.found) {
          pushWarning_(warnings, 'MISSING_OPTIONAL_SHEET', 'Optional sheet missing',
            { sheet: item.name });
        }
      });

      var registryKpi = buildChannelRegistryKpi_(cfg, ss, closedSet, nowMs);
      var escalationChannelIds = {};
      allEscalations.forEach(function (esc) {
        if (esc.channelId) escalationChannelIds[esc.channelId] = true;
      });
      if (registryKpi.available) {
        var without = 0;
        (registryKpi.activeChannelIds || []).forEach(function (cid) {
          if (!escalationChannelIds[cid]) without++;
        });
        registryKpi.withoutEscalation = without;
      }

      applyRegistryMismatchWarnings_(allEscalations, registryKpi, closedSet, warnings);

      var activeList = allEscalations.filter(function (e) { return e.isActive; });
      var closedCount = allEscalations.length - activeList.length;
      sortActiveEscalations_(activeList);

      var truncated = 0;
      if (activeList.length > maxRows) {
        truncated = activeList.length - maxRows;
        pushWarning_(warnings, 'TRUNCATED', 'Active escalation list truncated', { count: truncated });
        activeList = activeList.slice(0, maxRows);
      }

      var kpiCfg = escCfg.kpi;
      var newWindowMs = (kpiCfg.newWindowDays || 7) * 24 * 60 * 60 * 1000;
      var updatedWindowMs = (kpiCfg.updatedWindowHours || 24) * 60 * 60 * 1000;
      var thresholdDays = kpiCfg.noUpdateDaysThreshold || 7;
      var updatedField = kpiCfg.updatedField || 'lastSheetUpdateAt';

      var activeAll = allEscalations.filter(function (e) { return e.isActive; });
      var activeExecAttention = activeAll.filter(function (e) { return e.execAttention; }).length;

      var newThisWeek = allEscalations.filter(function (e) {
        return e.openedMs && (nowMs - e.openedMs) <= newWindowMs;
      }).length;

      var updatedRecently = activeAll.filter(function (e) {
        var uMs = getUpdatedFieldMs_(e, updatedField);
        return uMs && (nowMs - uMs) <= updatedWindowMs;
      }).length;

      var noTimestamp = 0;
      var noUpdate = activeAll.filter(function (e) {
        if (!e.effectiveUpdatedMs) {
          noTimestamp++;
          return true;
        }
        var days = computeDaysSinceUpdate_(e, nowMs, thresholdDays);
        return days > thresholdDays;
      }).length;

      var processingLogMs = getLatestProcessingLogMs_(cfg, ss);
      var lastAgent = buildLastAgentActivity_(
        allEscalations, registryKpi, processingLogMs, registryKpi.latestRegisteredMs, nowMs, cfg
      );

      var status = 'ready';
      if (!allEscalations.length) status = 'empty';

      return {
        ok: true,
        status: status,
        schemaVersion: SCHEMA_VERSION_,
        appId: appId,
        generatedAt: new Date(nowMs).toISOString(),
        timeZone: tz,
        settings: {
          tabLabel: escCfg.tab.label,
          newWindowDays: kpiCfg.newWindowDays,
          updatedWindowHours: kpiCfg.updatedWindowHours,
          noUpdateDaysThreshold: kpiCfg.noUpdateDaysThreshold
        },
        kpis: {
          active: { value: activeAll.length, execAttention: activeExecAttention },
          newThisWeek: {
            value: newThisWeek,
            windowStartAt: new Date(nowMs - newWindowMs).toISOString()
          },
          updatedRecently: {
            value: updatedRecently,
            windowHours: kpiCfg.updatedWindowHours
          },
          noUpdate: {
            value: noUpdate,
            thresholdDays: thresholdDays,
            noTimestamp: noTimestamp
          },
          channelsRegistered: {
            value: registryKpi.value,
            total: registryKpi.total,
            withoutEscalation: registryKpi.withoutEscalation,
            available: registryKpi.available
          },
          lastAgentActivity: lastAgent
        },
        escalations: activeList,
        counts: {
          totalRows: read.rowCount,
          active: activeAll.length,
          closed: closedCount,
          skippedNoKey: skippedNoKey,
          duplicates: deduped.duplicateCount,
          truncated: truncated
        },
        setup: setup,
        warnings: warnings
      };
    } catch (err) {
      Logger.log('CoreEscalations.getDashboardData: ' + err);
      return {
        ok: false,
        status: 'error',
        schemaVersion: SCHEMA_VERSION_,
        appId: appId,
        message: String(err && err.message ? err.message : err),
        warnings: warnings
      };
    }
  }

  /**
   * Compact dashboard diagnostic (no long text).
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugEscalationsDashboard(config) {
    var cfg = CoreConfig.withDefaults(config);
    var payload = getDashboardData(config, { debug: true });
    var enabled = cfg.escalations.enabled === true;

    var sample = [];
    if (payload.escalations && payload.escalations.length) {
      sample = payload.escalations.slice(0, 5).map(function (e) {
        return {
          key: e.key,
          customer: e.customer,
          status: e.status,
          severity: e.severity,
          effectiveUpdatedAt: e.effectiveUpdatedAt,
          isStale: e.isStale
        };
      });
    }

    var summary = {
      status: payload.status,
      appId: payload.appId || cfg.appId || '',
      enabled: enabled,
      ok: payload.ok,
      kpis: payload.kpis || null,
      counts: payload.counts || null,
      setup: payload.setup || null,
      warnings: payload.warnings || [],
      sampleEscalations: sample
    };

    Logger.log('CoreEscalations._debugEscalationsDashboard: ' + JSON.stringify(summary));
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Read-only schema/setup diagnostic for Escalations sheets (no writes).
   *
   * @param {AppConfig} config
   * @return {Object}
   */
  function _debugEscalationsSchema(config) {
    var cfg = CoreConfig.withDefaults(config);
    var enabled = cfg.escalations.enabled === true;
    var maxDataRows = (cfg.escalations.display && cfg.escalations.display.maxRows) || 200;
    var warnings = [];
    var ss;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      Logger.log('CoreEscalations._debugEscalationsSchema: no active spreadsheet: ' + e);
      ss = null;
    }

    var sheetsOut = {};
    var missingSheets = [];
    var missingRequiredBySheet = {};

    var current = buildSheetDiagnostic_(
      cfg, 'currentState', true, CURRENT_STATE_REQUIRED_, CURRENT_STATE_KEY_ANY_, ss, maxDataRows
    );
    sheetsOut.currentState = current;
    if (!current.found) {
      missingSheets.push(current.configuredName || 'currentState');
    }
    if (current.missingRequired && current.missingRequired.length) {
      missingRequiredBySheet.currentState = current.missingRequired;
    }

    var optionalKeys = ['channelRegistry', 'processingLog', 'updateHistory'];
    for (var o = 0; o < optionalKeys.length; o++) {
      var ok = optionalKeys[o];
      var diag = buildSheetDiagnostic_(cfg, ok, false, [], [], ss, maxDataRows);
      sheetsOut[ok] = diag;
      if (!diag.found) {
        warnings.push('Optional sheet not found: ' + (diag.configuredName || ok));
      }
    }

    var escConfigRead = readSheet_(ss, ESCALATION_CONFIGURATION_SHEET_, 0);
    if (escConfigRead.found) {
      sheetsOut.escalationConfiguration = {
        found: true,
        headers: escConfigRead.headers || []
      };
    } else {
      sheetsOut.escalationConfiguration = { found: false, headers: [] };
    }

    var setupOk = current.found && (!current.missingRequired || !current.missingRequired.length);

    if (!enabled) {
      warnings.push('Escalations feature is disabled in config (escalations.enabled !== true).');
    }

    var result = {
      ok: true,
      appId: cfg.appId || '',
      enabled: enabled,
      sheets: sheetsOut,
      setup: {
        ok: setupOk,
        missingSheets: missingSheets,
        missingRequired: missingRequiredBySheet
      },
      warnings: warnings
    };

    Logger.log('CoreEscalations._debugEscalationsSchema: appId=' + result.appId +
      ', enabled=' + enabled + ', setup.ok=' + setupOk);
    return result;
  }

  return {
    getDashboardData: getDashboardData,
    _debugEscalationsSchema: _debugEscalationsSchema,
    _debugEscalationsDashboard: _debugEscalationsDashboard
  };
})();
