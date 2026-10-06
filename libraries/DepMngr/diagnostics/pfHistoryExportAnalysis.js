/**
 * Read-only analysis helpers for exported SFDC Product Function History CSVs.
 * Used by local diagnostic scripts and Node tests — no SpreadsheetApp.
 */

'use strict';

var PF_TARGET = 'Production_Move_Date_Target__c';
var PF_ACTUAL = 'Production_Move_Date_Actual__c';

/**
 * @param {string} raw
 * @return {string}
 */
function normalizeId(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  if (s.length >= 15) return s.slice(0, 15);
  return s;
}

/**
 * @param {*} value
 * @return {string} YYYY-MM-DD or ''
 */
function normalizeDateValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  var s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

/**
 * @param {string} oldDate
 * @param {string} newDate
 * @return {string}
 */
function classifyTargetTransition(oldDate, newDate) {
  var o = normalizeDateValue(oldDate);
  var n = normalizeDateValue(newDate);
  if (!o && !n) return 'blank_to_blank';
  if (!o && n) return 'blank_to_date';
  if (o && !n) return 'date_to_blank';
  if (o && n && o !== n) return 'date_to_date';
  if (o && n && o === n) return 'unchanged';
  return 'other';
}

/**
 * Mirrors TrajectorySchedule.replayFunctionFieldHistory validChange rules.
 * @param {string} oldDate
 * @param {string} newDate
 * @return {boolean}
 */
function isMeaningfulTargetMovement(oldDate, newDate) {
  var o = normalizeDateValue(oldDate);
  var n = normalizeDateValue(newDate);
  if (!o || !n || o === n) return false;
  return true;
}

/**
 * @param {Array<Record<string, string>>} historyRows parsed CSV rows
 * @param {Set<string>|Object<string, boolean>} productFunctionIdSet
 * @return {Object}
 */
function analyzeProductFunctionHistoryExport(historyRows, productFunctionIdSet) {
  historyRows = historyRows || [];
  var pfSet = productFunctionIdSet;
  if (pfSet && !pfSet.has) {
    var lookup = {};
    Object.keys(pfSet).forEach(function (k) { lookup[k] = true; });
    pfSet = lookup;
  }

  var fieldCounts = {};
  var transitionCounts = { target: {}, actual: {} };
  var meaningfulTarget = 0;
  var initialPopulationTarget = 0;
  var matched = 0;
  var unresolved = 0;
  var unresolvedCategories = {
    not_in_current_product_functions: 0,
    empty_parent_id: 0
  };

  historyRows.forEach(function (row) {
    var field = String(row.Field || row.field || '').trim();
    if (field) fieldCounts[field] = (fieldCounts[field] || 0) + 1;

    var parentId = normalizeId(row.ParentId || row.parentId || '');
    if (!parentId) {
      unresolved++;
      unresolvedCategories.empty_parent_id++;
      return;
    }

    var inSet = pfSet && (pfSet.has ? pfSet.has(parentId) : pfSet[parentId]);
    if (!inSet && parentId.length >= 15 && pfSet) {
      inSet = pfSet.has ? pfSet.has(parentId.slice(0, 15)) : pfSet[parentId.slice(0, 15)];
    }
    if (!inSet) {
      unresolved++;
      unresolvedCategories.not_in_current_product_functions++;
      return;
    }
    matched++;

    if (field !== PF_TARGET && field !== PF_ACTUAL) return;

    var bucket = field === PF_TARGET ? transitionCounts.target : transitionCounts.actual;
    var cls = classifyTargetTransition(row.OldValue || row.oldValue, row.NewValue || row.newValue);
    bucket[cls] = (bucket[cls] || 0) + 1;

    if (field === PF_TARGET) {
      if (cls === 'blank_to_date') initialPopulationTarget++;
      if (isMeaningfulTargetMovement(row.OldValue || row.oldValue, row.NewValue || row.newValue)) {
        meaningfulTarget++;
      }
    }
  });

  return {
    totalHistoryRows: historyRows.length,
    fieldCounts: fieldCounts,
    matchedToCurrentProductFunctions: matched,
    unresolvedParentIds: unresolved,
    unresolvedCategories: unresolvedCategories,
    targetTransitionCounts: transitionCounts.target,
    actualTransitionCounts: transitionCounts.actual,
    meaningfulTargetMovementsUnderCurrentRules: meaningfulTarget,
    initialTargetPopulationsExcludedFromMetrics: initialPopulationTarget,
    wouldEmitFunctionTargetChangeEvents:
      (transitionCounts.target.blank_to_date || 0) +
      (transitionCounts.target.date_to_date || 0) +
      (transitionCounts.target.date_to_blank || 0) +
      (transitionCounts.target.blank_to_blank || 0) +
      (transitionCounts.target.unchanged || 0) +
      (transitionCounts.target.other || 0)
  };
}

/**
 * @param {Array<Record<string, string>>} productFunctionRows
 * @return {Set<string>}
 */
function productFunctionIdSetFromExport(productFunctionRows) {
  var set = new Set();
  (productFunctionRows || []).forEach(function (row) {
    var id = normalizeId(row.Id || row.id || '');
    if (id) {
      set.add(id);
      if (id.length >= 15) set.add(id.slice(0, 15));
    }
  });
  return set;
}

module.exports = {
  PF_TARGET: PF_TARGET,
  PF_ACTUAL: PF_ACTUAL,
  normalizeId: normalizeId,
  normalizeDateValue: normalizeDateValue,
  classifyTargetTransition: classifyTargetTransition,
  isMeaningfulTargetMovement: isMeaningfulTargetMovement,
  analyzeProductFunctionHistoryExport: analyzeProductFunctionHistoryExport,
  productFunctionIdSetFromExport: productFunctionIdSetFromExport
};
