/**
 * CoreUtils.gs
 *
 * Shared utility functions: date formatting, HTML escaping, percentage parsing, etc.
 */

var CoreUtils = (function () {

  /**
   * Safely converts a value to a Date and returns an ISO string (UTC) or '' if invalid.
   *
   * @param {Date|string} date
   * @return {string}
   */
  function formatDateToIsoString(date) {
    if (!date) return '';
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    if (isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  /**
   * Extracts a calendar YYYY-MM-DD from a date-only or ISO-prefix string without
   * timezone shifting (does not use Date parsing for YYYY-MM-DD prefixes).
   *
   * @param {*} value
   * @return {string} YYYY-MM-DD or ''
   */
  function extractIsoCalendarDateKey(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) return '';
    var str = String(value).trim();
    if (!str) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(str);
    if (!m) return '';
    var mo = parseInt(m[2], 10);
    var day = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return '';
    return m[1] + '-' + m[2] + '-' + m[3];
  }

  /**
   * Normalizes a sheet/source value to a YYYY-MM-DD calendar key.
   * Date-only strings preserve the leading calendar date; Date objects use timeZone.
   *
   * @param {*} value
   * @param {string=} timeZone  Defaults to Session.getScriptTimeZone() at runtime.
   * @return {string} YYYY-MM-DD or ''
   */
  function toCalendarDateKey(value, timeZone) {
    if (value == null || value === '') return '';
    var isoKey = extractIsoCalendarDateKey(value);
    if (isoKey) return isoKey;
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return '';
      var tz = timeZone || Session.getScriptTimeZone();
      return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    }
    var str = String(value).trim();
    if (!str) return '';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      var parts = str.split('/');
      var mm = parts[0].padStart(2, '0');
      var dd = parts[1].padStart(2, '0');
      return parts[2] + '-' + mm + '-' + dd;
    }
    var prefixFromSplit = extractIsoCalendarDateKey(str.split('T')[0]);
    if (prefixFromSplit) return prefixFromSplit;
    var d = new Date(str);
    if (isNaN(d.getTime())) return '';
    var tz2 = timeZone || Session.getScriptTimeZone();
    return Utilities.formatDate(d, tz2, 'yyyy-MM-dd');
  }

  /**
   * VoC table display: M/DD/YY (no leading zero on month, zero-padded day, two-digit year).
   * Calendar-safe for date-only and ISO-prefix strings; timestamps use timeZone calendar date.
   *
   * @param {*} value
   * @param {string=} timeZone
   * @return {string} Formatted date or em dash when missing/invalid.
   */
  function formatVocTableDate(value, timeZone) {
    var key = toCalendarDateKey(value, timeZone);
    if (!key) return '\u2014';
    var parts = key.split('-');
    if (parts.length !== 3) return '\u2014';
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(mo) || isNaN(day)) return '\u2014';
    var yy = String(y % 100);
    if (yy.length < 2) yy = '0' + yy;
    var dd = day < 10 ? '0' + day : String(day);
    return mo + '/' + dd + '/' + yy;
  }

  /**
   * Parses a display value ("34%", "0.34", "34") into 0–100,
   * or returns null if it cannot be interpreted as a percentage.
   *
   * @param {any} v
   * @return {number|null}
   */
  function parsePercentage(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (!s) return null;

    var hasPercent = /%$/.test(s);
    if (hasPercent) {
      s = s.replace(/%$/, '').trim();
    }

    var num = parseFloat(s);
    if (isNaN(num)) return null;

    if (hasPercent) {
      return clamp(num, 0, 100);
    }

    // Treat 0–1 as fraction
    if (num <= 1 && num >= 0) {
      return clamp(num * 100, 0, 100);
    }

    return clamp(num, 0, 100);
  }

  /**
   * HTML-escapes a string for safe embedding in HTML.
   *
   * @param {any} text
   * @return {string}
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;');
  }

  /**
   * Normalize text for case-insensitive matching (e.g. table titles).
   *
   * @param {any} text
   * @return {string}
   */
  function normalizeText(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Returns true if a & b have the same year and month.
   *
   * @param {Date|any} a
   * @param {Date|any} b
   * @return {boolean}
   */
  function sameMonthYear(a, b) {
    if (!a || !b) return false;
    var da = new Date(a);
    var db = new Date(b);
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
    return da.getFullYear() === db.getFullYear() &&
           da.getMonth() === db.getMonth();
  }

  /**
   * Clamp a number between min and max.
   *
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @return {number}
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return {
    formatDateToIsoString: formatDateToIsoString,
    extractIsoCalendarDateKey: extractIsoCalendarDateKey,
    toCalendarDateKey: toCalendarDateKey,
    formatVocTableDate: formatVocTableDate,
    parsePercentage: parsePercentage,
    escapeHtml: escapeHtml,
    normalizeText: normalizeText,
    sameMonthYear: sameMonthYear,
    clamp: clamp
  };
})();