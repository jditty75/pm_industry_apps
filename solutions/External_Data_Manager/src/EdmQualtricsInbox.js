/**
 * Drive Inbox discovery and source disposition.
 * @namespace EdmQualtricsInbox
 */
var EdmQualtricsInbox = (function () {
  'use strict';

  /**
   * @param {string} inboxFolderId
   * @param {string} [preferredFileName]
   * @param {Object} driveApp
   * @return {Object|null} file metadata { id, name }
   */
  function findCandidateCsv(inboxFolderId, preferredFileName, driveApp) {
    var folder = driveApp.getFolderById(inboxFolderId);
    var files = folder.getFiles();
    var candidates = [];
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      if (!/\.csv$/i.test(name)) {
        continue;
      }
      if (preferredFileName && name !== preferredFileName) {
        continue;
      }
      candidates.push({ id: f.getId(), name: name, file: f });
    }
    if (!candidates.length) {
      return null;
    }
    candidates.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return candidates[0];
  }

  /**
   * @param {Object} file Drive file
   * @return {string}
   */
  function readCsvText(file) {
    return file.getBlob().getDataAsString('utf-8');
  }

  /**
   * @param {Object} file
   * @param {string} failedFolderId
   * @param {Object} driveApp
   */
  function moveToFailed(file, failedFolderId, driveApp) {
    var failed = driveApp.getFolderById(failedFolderId);
    failed.addFile(file);
    var parents = file.getParents();
    while (parents.hasNext()) {
      parents.next().removeFile(file);
    }
  }

  /**
   * @param {Object} file
   */
  function deleteFile(file) {
    driveAppTrash_(file);
  }

  /**
   * @param {Object} file
   */
  function driveAppTrash_(file) {
    file.setTrashed(true);
  }

  return {
    findCandidateCsv: findCandidateCsv,
    readCsvText: readCsvText,
    moveToFailed: moveToFailed,
    deleteFile: deleteFile
  };
})();
