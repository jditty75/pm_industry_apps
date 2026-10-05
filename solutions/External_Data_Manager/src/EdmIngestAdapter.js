/**
 * DepMngr CSAT ingest adapter (orchestration only — tenant filter in CoreData).
 * @namespace EdmIngestAdapter
 */
var EdmIngestAdapter = (function () {
  'use strict';

  /**
   * @param {string} logicalAppId
   * @param {Object.<string, string>[]} normalizedRows
   * @param {Object} metadata
   * @param {string} spreadsheetId
   * @param {Object} coreLib CoreLib namespace or test double
   * @return {Object}
   */
  function ingestNormalizedRows(logicalAppId, normalizedRows, metadata, spreadsheetId, coreLib) {
    if (!coreLib || !coreLib.CoreData || !coreLib.CoreData.ingestCsatInFlight) {
      return {
        success: false,
        destinationId: logicalAppId,
        message: 'CoreLib.CoreData.ingestCsatInFlight unavailable (DepMngr library release required)',
        eligibleCount: (normalizedRows || []).length,
        writtenCount: 0
      };
    }
    var rawCfg = EdmDmConfigResolver.resolve(logicalAppId);
    var cfg = coreLib.CoreConfig.withDefaults(rawCfg);
    var result = coreLib.CoreData.ingestCsatInFlight(cfg, normalizedRows, metadata, {
      spreadsheetId: spreadsheetId
    });
    return Object.assign({ destinationId: logicalAppId }, result);
  }

  /**
   * @param {string} logicalAppId
   * @param {Object[]} canonicalRows csat-response-v1 DTOs
   * @param {Object} metadata
   * @param {string} spreadsheetId
   * @param {Object} coreLib
   * @return {Object}
   */
  function ingestCanonicalCsatResponses(logicalAppId, canonicalRows, metadata, spreadsheetId, coreLib) {
    if (!coreLib || !coreLib.CoreData || !coreLib.CoreData.ingestCsatResponses) {
      return {
        success: false,
        destinationId: logicalAppId,
        message: 'CoreLib.CoreData.ingestCsatResponses unavailable (DepMngr library release required)',
        eligible: (canonicalRows || []).length,
        inserted: 0,
        updated: 0
      };
    }
    var rawCfg = EdmDmConfigResolver.resolve(logicalAppId);
    var cfg = coreLib.CoreConfig.withDefaults(rawCfg);
    var result = coreLib.CoreData.ingestCsatResponses(cfg, canonicalRows, metadata, {
      spreadsheetId: spreadsheetId
    });
    return Object.assign({ destinationId: logicalAppId }, result);
  }

  return {
    ingestNormalizedRows: ingestNormalizedRows,
    ingestCanonicalCsatResponses: ingestCanonicalCsatResponses
  };
})();
