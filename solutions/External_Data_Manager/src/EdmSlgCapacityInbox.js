/**
 * SLG Capacity four-file Drive Inbox discovery.
 * @namespace EdmSlgCapacityInbox
 */
var EdmSlgCapacityInbox = (function () {
  'use strict';

  /**
   * @param {string} inboxFolderId
   * @param {Object} driveApp
   * @return {{ ok: boolean, batch?: Object, files?: Object, errors?: string[] }}
   */
  function findCompleteBatch(inboxFolderId, driveApp) {
    var folder = driveApp.getFolderById(inboxFolderId);
    var files = folder.getFiles();
    var names = [];
    var fileByName = {};
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      names.push(name);
      fileByName[name] = f;
    }
    var resolved = SlgCapacityPipeline.resolveBatchFromFileNames(names);
    if (!resolved.ok) {
      return resolved;
    }
    var out = { ok: true, batch: resolved.batch, files: {} };
    Object.keys(resolved.batch).forEach(function (slot) {
      out.files[slot] = fileByName[resolved.batch[slot]];
    });
    return out;
  }

  /**
   * @param {Object} file Drive file
   * @return {string}
   */
  function readCsvText(file) {
    return file.getBlob().getDataAsString('utf-8');
  }

  /**
   * @param {Object.<string, Object>} files slot -> Drive file
   * @return {Object.<string, string>}
   */
  function readBatchTexts(files) {
    var texts = {};
    Object.keys(files).forEach(function (slot) {
      texts[slot] = readCsvText(files[slot]);
    });
    return texts;
  }

  /**
   * @param {Object} file
   * @param {string} failedFolderId
   * @param {Object} driveApp
   */
  function moveToFailed(file, failedFolderId, driveApp) {
    EdmQualtricsInbox.moveToFailed(file, failedFolderId, driveApp);
  }

  /**
   * @param {Object} file
   */
  function deleteFile(file) {
    EdmQualtricsInbox.deleteFile(file);
  }

  /**
   * @param {Object.<string, Object>} files
   * @param {string} archiveFolderId
   * @param {Object} driveApp
   */
  function moveBatchToFolder(files, archiveFolderId, driveApp) {
    var dest = driveApp.getFolderById(archiveFolderId);
    Object.keys(files).forEach(function (slot) {
      try {
        files[slot].moveTo(dest);
      } catch (e) {
        dest.addFile(files[slot]);
        var parents = files[slot].getParents();
        while (parents.hasNext()) {
          parents.next().removeFile(files[slot]);
        }
      }
    });
  }

  return {
    findCompleteBatch: findCompleteBatch,
    readBatchTexts: readBatchTexts,
    moveToFailed: moveToFailed,
    deleteFile: deleteFile,
    moveBatchToFolder: moveBatchToFolder
  };
})();
