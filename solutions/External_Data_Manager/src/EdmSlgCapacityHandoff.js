/**
 * Write consolidated Capacity workbook to Drive for SLG_Capacity pickup.
 * @namespace EdmSlgCapacityHandoff
 */
var EdmSlgCapacityHandoff = (function () {
  'use strict';

  /**
   * @param {Object.<string, Array[]>} sheets sheetName -> values including header
   * @param {string} handoffFolderId
   * @param {string} title
   * @param {Object} [deps]
   * @return {{ spreadsheetId: string, fileId: string, title: string }}
   */
  function writeConsolidatedSpreadsheet(sheets, handoffFolderId, title, deps) {
    deps = deps || {};
    var ss = deps.spreadsheetApp ?
      deps.spreadsheetApp.create(title) :
      SpreadsheetApp.create(title);
    var spreadsheetId = ss.getId();
    var defaultSheet = ss.getSheets()[0];

    var names = [
      SlgCapacitySchema.OUT_FORECAST,
      SlgCapacitySchema.OUT_UNSTAFFED,
      SlgCapacitySchema.OUT_ACTUALS,
      SlgCapacitySchema.OUT_UTIL,
      SlgCapacitySchema.OUT_HISTORY,
      SlgCapacitySchema.OUT_XORG,
      SlgCapacitySchema.OUT_MANIFEST
    ];
    names.forEach(function (name, idx) {
      var sh = idx === 0 ? defaultSheet : ss.insertSheet(name);
      if (idx === 0 && name !== defaultSheet.getName()) {
        sh.setName(name);
      } else if (idx > 0) {
        sh.setName(name);
      }
      var values = sheets[name] || [['']];
      if (values.length && values[0].length) {
        sh.getRange(1, 1, values.length, values[0].length).setValues(values);
      }
    });

    var driveApp = deps.driveApp || DriveApp;
    var file = driveApp.getFileById(spreadsheetId);
    var folder = driveApp.getFolderById(handoffFolderId);
    folder.addFile(file);
    var parents = file.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() !== handoffFolderId) {
        parent.removeFile(file);
      }
    }
    return { spreadsheetId: spreadsheetId, fileId: spreadsheetId, title: title };
  }

  return {
    writeConsolidatedSpreadsheet: writeConsolidatedSpreadsheet
  };
})();
