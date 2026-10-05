/**
 * Drive folder model and Script Property keys (configuration only in V1A).
 * @namespace EdmDriveFolders
 */
var EdmDriveFolders = (function () {
  'use strict';

  var PROP_QUALTRICS_PARENT = 'EXTERNAL_DATA_PARENT_FOLDER_ID';
  var PROP_QUALTRICS_INBOX = 'QUALTRICS_INBOX_FOLDER_ID';
  var PROP_QUALTRICS_FAILED = 'QUALTRICS_FAILED_FOLDER_ID';

  var CHILD_INBOX = 'Inbox';
  var CHILD_FAILED = 'Failed';

  /**
   * Design-only: locate or create Inbox/Failed under parent. Not invoked in V1A.
   *
   * @param {string} parentFolderId
   * @param {Object} driveApp DriveApp or test double
   * @return {{ inboxId: string, failedId: string }}
   */
  function ensureQualtricsChildFolders(parentFolderId, driveApp) {
    var parent = driveApp.getFolderById(parentFolderId);
    return {
      inboxId: findOrCreateChild_(parent, CHILD_INBOX, driveApp),
      failedId: findOrCreateChild_(parent, CHILD_FAILED, driveApp)
    };
  }

  /**
   * @param {Object} parentFolder
   * @param {string} name
   * @param {Object} driveApp
   * @return {string}
   */
  function findOrCreateChild_(parentFolder, name, driveApp) {
    var it = parentFolder.getFoldersByName(name);
    var first = it.hasNext() ? it.next() : null;
    if (first) {
      if (it.hasNext()) {
        throw new Error('Ambiguous Drive folder "' + name + '"');
      }
      return first.getId();
    }
    return parentFolder.createFolder(name).getId();
  }

  /**
   * Invariant: never delete source on transform-only success (documented for V1B+).
   * @return {Object}
   */
  function sourceDeletionPolicy() {
    return {
      deleteSourceRequires: [
        'transformSuccess',
        'allIntendedIngestionsSuccess',
        'verificationSuccess',
        'auditRecordPersisted'
      ],
      v1aDeletesFiles: false,
      defaultDeleteSuccessfulSource: false
    };
  }

  return {
    PROP_QUALTRICS_PARENT: PROP_QUALTRICS_PARENT,
    PROP_QUALTRICS_INBOX: PROP_QUALTRICS_INBOX,
    PROP_QUALTRICS_FAILED: PROP_QUALTRICS_FAILED,
    CHILD_INBOX: CHILD_INBOX,
    CHILD_FAILED: CHILD_FAILED,
    ensureQualtricsChildFolders: ensureQualtricsChildFolders,
    sourceDeletionPolicy: sourceDeletionPolicy
  };
})();
