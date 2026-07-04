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
    parsePercentage: parsePercentage,
    escapeHtml: escapeHtml,
    normalizeText: normalizeText,
    sameMonthYear: sameMonthYear,
    clamp: clamp
  };
})();