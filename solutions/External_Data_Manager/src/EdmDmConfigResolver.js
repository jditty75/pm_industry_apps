/**
 * Resolves DepMngr AppConfig for EDM destination ingest (sheet names + appId).
 * Keep in sync with solutions/*_DM Config_*.js deployment-universe settings.
 * @namespace EdmDmConfigResolver
 */
var EdmDmConfigResolver = (function () {
  'use strict';

  var BASE_SHEETS = {
    deployments: 'SFDC_Deployments',
    deploymentsMeta: 'DeploymentsMeta',
    deploymentOverrides: 'DeploymentOverrides',
    sfdcDeploymentProductFunctions: 'SFDC_DeploymentProductFunctions',
    csatInFlight: 'CSAT_InFlight'
  };

  var BASE_SF = {
    statusValues: { active: 'Active', complete: 'Complete' }
  };

  /**
   * @param {string} logicalAppId HC_DM | SLG_DM | HENP_DM
   * @return {Object}
   */
  function resolve(logicalAppId) {
    if (logicalAppId === EdmDestinationRegistry.APP_HC) {
      return { appId: 'HC', sheets: BASE_SHEETS, salesforce: BASE_SF };
    }
    if (logicalAppId === EdmDestinationRegistry.APP_SLG) {
      return { appId: 'SLG', sheets: BASE_SHEETS, salesforce: BASE_SF };
    }
    if (logicalAppId === EdmDestinationRegistry.APP_HENP) {
      return { appId: 'HENP', sheets: BASE_SHEETS, salesforce: BASE_SF };
    }
    throw new Error('EdmDmConfigResolver: unknown logical app ' + logicalAppId);
  }

  return {
    resolve: resolve
  };
})();
