/**
 * Utils.gs — Shared utility helpers for SLED Pipeline Analysis.
 * Phase 1 subset: number coercion, string normalisation, student detection, fiscal-period parsing.
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
