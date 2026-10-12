/**
 * CSV helpers for SLG Capacity WoW sources.
 * @namespace SlgCapacityCsv
 */
var SlgCapacityCsv = (function () {
  'use strict';

  /**
   * @param {string} csvText
   * @return {string[][]}
   */
  function parseCsvText(csvText) {
    return QualtricsCsv.parseCsvText(csvText);
  }

  /**
   * @param {string[][]} grid
   * @return {Object.<string, string>[]}
   */
  function gridToRecords(grid) {
    if (!grid || grid.length < 1) {
      return [];
    }
    var headers = grid[0].map(function (h) { return String(h).trim(); });
    var out = [];
    for (var r = 1; r < grid.length; r++) {
      var row = grid[r];
      var rec = {};
      for (var c = 0; c < headers.length; c++) {
        rec[headers[c]] = row[c] == null ? '' : String(row[c]);
      }
      out.push(rec);
    }
    return out;
  }

  /**
   * @param {string} globPattern simple * wildcard
   * @param {string} fileName
   * @return {boolean}
   */
  function fileNameMatches(globPattern, fileName) {
    var esc = globPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + esc + '$', 'i').test(fileName);
  }

  return {
    parseCsvText: parseCsvText,
    gridToRecords: gridToRecords,
    fileNameMatches: fileNameMatches
  };
})();
