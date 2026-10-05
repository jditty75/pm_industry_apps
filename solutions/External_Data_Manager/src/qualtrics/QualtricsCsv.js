/**
 * CSV parsing aligned with Utilities.parseCsv semantics (RFC 4180-ish).
 * @namespace QualtricsCsv
 */
var QualtricsCsv = (function () {
  'use strict';

  /**
   * @param {string} csvText
   * @return {string[][]}
   */
  function parseCsvText(csvText) {
    if (csvText == null || csvText === '') {
      return [];
    }
    var text = String(csvText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === ',') {
        row.push(field);
        field = '';
        continue;
      }
      if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    return rows;
  }

  /**
   * @param {Object.<string, string>} row keyed by OUT_ORDER fields
   * @param {string[]} columnOrder
   * @return {string}
   */
  function serializeRowToCsvLine(row, columnOrder) {
    return columnOrder.map(function (col) {
      var v = row[col];
      if (v == null) {
        return '';
      }
      var s = String(v);
      if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  }

  return {
    parseCsvText: parseCsvText,
    serializeRowToCsvLine: serializeRowToCsvLine
  };
})();
