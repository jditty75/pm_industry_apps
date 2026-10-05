/**
 * Logical DM app IDs → destination spreadsheet IDs (Script Properties).
 * @namespace EdmDestinationRegistry
 */
var EdmDestinationRegistry = (function () {
  'use strict';

  var APP_HC = 'HC_DM';
  var APP_SLG = 'SLG_DM';
  var APP_HENP = 'HENP_DM';

  /**
   * @param {string} appId
   * @return {string} property key
   */
  function propertyKeyForApp(appId) {
    if (appId === APP_HC) {
      return EdmProperties.DEST_HC_DM_SPREADSHEET_ID;
    }
    if (appId === APP_SLG) {
      return EdmProperties.DEST_SLG_DM_SPREADSHEET_ID;
    }
    if (appId === APP_HENP) {
      return EdmProperties.DEST_HENP_DM_SPREADSHEET_ID;
    }
    throw new Error('EdmDestinationRegistry: unknown appId ' + appId);
  }

  /**
   * @param {Object} props PropertiesService or test double
   * @return {Object.<string, string>}
   */
  function readAll(props) {
    var out = {};
    [APP_HC, APP_SLG, APP_HENP].forEach(function (appId) {
      var key = propertyKeyForApp(appId);
      var val = props.getProperty(key);
      if (val) {
        out[appId] = val;
      }
    });
    return out;
  }

  /**
   * @param {string} appId
   * @param {Object} props
   * @return {string|null}
   */
  function resolveSpreadsheetId(appId, props) {
    var key = propertyKeyForApp(appId);
    var id = props.getProperty(key);
    return id ? String(id).trim() : null;
  }

  /**
   * @param {string} appId
   * @param {string} spreadsheetId
   * @param {Object} props
   */
  function setSpreadsheetId(appId, spreadsheetId, props) {
    props.setProperty(propertyKeyForApp(appId), String(spreadsheetId).trim());
  }

  return {
    APP_HC: APP_HC,
    APP_SLG: APP_SLG,
    APP_HENP: APP_HENP,
    propertyKeyForApp: propertyKeyForApp,
    readAll: readAll,
    resolveSpreadsheetId: resolveSpreadsheetId,
    setSpreadsheetId: setSpreadsheetId
  };
})();
