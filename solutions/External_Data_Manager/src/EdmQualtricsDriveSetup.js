/**
 * Drive folder layout under External Data / Qualtrics.
 * @namespace EdmQualtricsDriveSetup
 */
var EdmQualtricsDriveSetup = (function () {
  'use strict';

  var QUALTRICS_SEGMENT = 'Qualtrics';
  var CHILD_INBOX = 'Inbox';
  var CHILD_FAILED = 'Failed';

  /**
   * @param {Object} parentFolder Drive folder
   * @param {string} name
   * @return {string|null} folder id when exactly one match
   */
  function findUniqueChildByName_(parentFolder, name) {
    var it = parentFolder.getFoldersByName(name);
    var first = it.hasNext() ? it.next() : null;
    if (!first) {
      return null;
    }
    if (it.hasNext()) {
      throw new Error('Ambiguous folder name "' + name + '" under parent');
    }
    return first.getId();
  }

  /**
   * @param {Object} parentFolder
   * @param {string} name
   * @return {string}
   */
  function findOrCreateChild_(parentFolder, name) {
    var existing = findUniqueChildByName_(parentFolder, name);
    if (existing) {
      return existing;
    }
    return parentFolder.createFolder(name).getId();
  }

  /**
   * Idempotent: External Data/Qualtrics/Inbox + Failed.
   *
   * @param {string} externalDataParentFolderId
   * @param {Object} driveApp
   * @return {{ qualtricsFolderId: string, inboxId: string, failedId: string }}
   */
  function ensureQualtricsPipelineFolders(externalDataParentFolderId, driveApp) {
    var parent = driveApp.getFolderById(externalDataParentFolderId);
    var qualtricsId = findOrCreateChild_(parent, QUALTRICS_SEGMENT);
    var qualtricsFolder = driveApp.getFolderById(qualtricsId);
    return {
      qualtricsFolderId: qualtricsId,
      inboxId: findOrCreateChild_(qualtricsFolder, CHILD_INBOX),
      failedId: findOrCreateChild_(qualtricsFolder, CHILD_FAILED)
    };
  }

  /**
   * @param {string} parentFolderId
   * @param {Object} props
   * @param {Object} driveApp
   * @return {Object}
   */
  function setupAndPersist(parentFolderId, props, driveApp) {
    var ids = ensureQualtricsPipelineFolders(parentFolderId, driveApp);
    props.setProperty(EdmProperties.EXTERNAL_DATA_PARENT_FOLDER_ID, parentFolderId);
    props.setProperty(EdmProperties.QUALTRICS_INBOX_FOLDER_ID, ids.inboxId);
    props.setProperty(EdmProperties.QUALTRICS_FAILED_FOLDER_ID, ids.failedId);
    return ids;
  }

  return {
    QUALTRICS_SEGMENT: QUALTRICS_SEGMENT,
    CHILD_INBOX: CHILD_INBOX,
    CHILD_FAILED: CHILD_FAILED,
    ensureQualtricsPipelineFolders: ensureQualtricsPipelineFolders,
    setupAndPersist: setupAndPersist,
    findUniqueChildByName_: findUniqueChildByName_
  };
})();
