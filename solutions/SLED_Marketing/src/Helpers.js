/**
 * SF relationship blob -> person name.
 * e.g. "{attributes={url=/.../005..., type=User}, Name=John Waugh}" -> "John Waugh"
 * @param {*} raw
 * @returns {string}
 */
function parsePersonName(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const text = String(raw).trim();
  const m = text.match(/Name=([^,}]+)/);
  if (m) return m[1].trim();
  if (text.indexOf('{') === -1 && text.indexOf('attributes=') === -1) return text;
  return '';
}

/**
 * Returns the first non-empty deployment field value for a header or alt header list.
 * @param {Object<string, *>} deployment
 * @param {string|Array<string>|undefined} headers
 * @returns {*}
 */
function resolveDeploymentFieldRaw_(deployment, headers) {
  const list = Array.isArray(headers) ? headers : [headers];
  for (let i = 0; i < list.length; i++) {
    const header = list[i];
    if (!header) continue;
    const raw = deployment[header];
    if (raw === null || raw === undefined || raw === '') continue;
    return raw;
  }
  return undefined;
}

/**
 * Most-recent of two possibly-null date values (Date objects from getValues()).
 * @param {Date|null} a
 * @param {Date|null} b
 * @returns {Date|null}
 */
function maxDate(a, b) {
  const da = a instanceof Date ? a : null;
  const db = b instanceof Date ? b : null;
  if (da && db) return da > db ? da : db;
  return da || db || null;
}

/**
 * Date -> ISO yyyy-MM-dd in script timezone.
 * @param {Date|null} d
 * @returns {string|null}
 */
function toIso(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null;
}

/**
 * Maps header name (exact string from row 1) to column index (0-based).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object<string, number>}
 */
function buildHeaderIndex_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const index = {};
  headers.forEach(function(h, i) {
    if (h !== '' && h !== null && h !== undefined) {
      index[String(h)] = i;
    }
  });
  return index;
}

/**
 * Returns true when a value represents an already-set actual move date.
 * @param {*} v
 * @returns {boolean}
 */
function isActualDateSet_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return true;
  return v !== null && v !== undefined && String(v).trim() !== '';
}
