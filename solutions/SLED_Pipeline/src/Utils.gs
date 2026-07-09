/**
 * Utils.gs — Shared utility helpers for SLED Pipeline Analysis.
 * Phase 1: number coercion, string normalisation, student detection, fiscal-period parsing.
 * Phase 2: compact money formatting, percentage, HTML escaping.
 */

/**
 * Coerces a value to a Number; returns 0 for blank, null, or non-numeric input.
 * @param {*} v
 * @returns {number}
 */
function Utils_toNumber_(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Coerces a value to a trimmed string; returns '' for null/undefined.
 * @param {*} v
 * @returns {string}
 */
function Utils_str_(v) {
  return String(v || '').trim();
}

/**
 * Returns true if the string contains the word "student" (case-insensitive, whole-word).
 * @param {string} s
 * @returns {boolean}
 */
function Utils_hasWordStudent_(s) {
  return /\bstudent\b/i.test(s);
}

/**
 * Parses a fiscal-period string in the format "Q#-YYYY".
 * Returns { quarter, year, sortKey } where sortKey = year*10 + quarter for chronological ordering.
 * Returns null for unparseable input.
 * @param {string} fp  e.g. "Q3-2026"
 * @returns {{ quarter: number, year: number, sortKey: number }|null}
 */
function Utils_parseFiscalPeriod_(fp) {
  if (!fp) return null;
  var m = String(fp).match(/^Q(\d)-(\d{4})$/i);
  if (!m) return null;
  var quarter = parseInt(m[1], 10);
  var year    = parseInt(m[2], 10);
  return { quarter: quarter, year: year, sortKey: year * 10 + quarter };
}

/**
 * Formats a number as compact currency: $X.XM (≥$1M), $X.XK (≥$1K), else $X.
 * Adds thousands separators to the integer portion (e.g. $1,759.3M).
 * @param {number} n
 * @returns {string}
 */
function Utils_fmtMoney_(n) {
  function addCommas(s) {
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  if (n >= 1e9) return '$' + addCommas((n / 1e9).toFixed(1)) + 'B';
  if (n >= 1e6) return '$' + addCommas((n / 1e6).toFixed(1)) + 'M';
  if (n >= 1e3) return '$' + addCommas((n / 1e3).toFixed(1)) + 'K';
  return '$' + Math.round(n);
}

/**
 * Returns (part / whole * 100) rounded to one decimal place as a Number.
 * Returns 0 when whole is 0 or falsy.
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
function Utils_pct_(part, whole) {
  if (!whole) return 0;
  return parseFloat((part / whole * 100).toFixed(1));
}

/**
 * Escapes HTML special characters to prevent XSS in server-generated markup.
 * @param {*} s
 * @returns {string}
 */
function Utils_escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
