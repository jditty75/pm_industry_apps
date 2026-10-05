/**
 * Infrastructure setup entry points (idempotent).
 * @namespace EdmSetup
 */
var EdmSetup = (function () {
  'use strict';

  /**
   * @param {string} externalDataParentFolderId
   * @return {Object}
   */
  function setupQualtricsDriveFolders(externalDataParentFolderId) {
    var props = PropertiesService.getScriptProperties();
    return EdmQualtricsDriveSetup.setupAndPersist(
      externalDataParentFolderId,
      props,
      DriveApp
    );
  }

  /**
   * @return {string} ledger spreadsheet id
   */
  function ensureAuditLedger() {
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID);
    if (existing) {
      return existing;
    }
    var id = EdmAuditLedgerSheet.createLedgerSpreadsheet(SpreadsheetApp);
    props.setProperty(EdmProperties.AUDIT_LEDGER_SPREADSHEET_ID, id);
    return id;
  }

  /**
   * @param {string} appId logical id
   * @param {string} spreadsheetId
   */
  function setDestinationSpreadsheetId(appId, spreadsheetId) {
    EdmDestinationRegistry.setSpreadsheetId(
      appId,
      spreadsheetId,
      PropertiesService.getScriptProperties()
    );
  }

  return {
    setupQualtricsDriveFolders: setupQualtricsDriveFolders,
    ensureAuditLedger: ensureAuditLedger,
    setDestinationSpreadsheetId: setDestinationSpreadsheetId
  };
})();
