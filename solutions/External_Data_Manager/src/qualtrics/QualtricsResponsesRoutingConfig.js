/**
 * Routing for canonical CSAT Responses (Sub Region → HC / SLG / HENP).
 * @namespace QualtricsResponsesRoutingConfig
 */
var QualtricsResponsesRoutingConfig = (function () {
  'use strict';

  /** @type {QualtricsRoutingConfig.QualtricsRoutingConfigShape} */
  var DEFAULT = {
    version: 1,
    routingKeyField: 'sub_region',
    routes: [
      {
        routeId: 'us_healthcare',
        match: { field: 'sub_region', op: 'equals', value: 'US Healthcare' },
        populationId: 'healthcare',
        destinations: [
          { appId: 'HC_DM', ingestKind: 'csat_responses', enabled: true }
        ]
      },
      {
        routeId: 'government',
        match: { field: 'sub_region', op: 'equals', value: 'Government' },
        populationId: 'government',
        destinations: [
          { appId: 'SLG_DM', ingestKind: 'csat_responses', enabled: true }
        ]
      },
      {
        routeId: 'higher_ed_student',
        match: { field: 'sub_region', op: 'equals', value: 'Higher Ed & Student' },
        populationId: 'henp',
        destinations: [
          { appId: 'HENP_DM', ingestKind: 'csat_responses', enabled: true }
        ]
      }
    ]
  };

  /**
   * Product Area alias map (config-driven; extend via Script Properties in future).
   * @type {{ aliases: Object.<string, string>, unknownTokenGroup: string }}
   */
  var DEFAULT_PRODUCT_AREA_CONFIG = {
    unknownTokenGroup: 'OTHER',
    aliases: {
      'Financials': 'FINANCIALS',
      'Financial Management': 'FINANCIALS',
      'Spend Management': 'SPEND',
      'Planning': 'PLANNING',
      'Adaptive Planning': 'PLANNING',
      'Core HCM': 'HCM',
      'Human Capital Management': 'HCM',
      'Talent Management': 'TALENT',
      'Talent Optimization': 'TALENT',
      'Prism Analytics': 'ANALYTICS',
      'Analytics and Reporting': 'ANALYTICS',
      'Payroll': 'PAYROLL',
      'Workforce Planning': 'WORKFORCE',
      'Platform': 'PLATFORM'
    }
  };

  /**
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [config]
   * @return {QualtricsRoutingConfig.QualtricsRoutingConfigShape}
   */
  function getActiveConfig(config) {
    return config || DEFAULT;
  }

  /**
   * @param {Object} [config]
   * @return {Object}
   */
  function getProductAreaConfig(config) {
    return config || DEFAULT_PRODUCT_AREA_CONFIG;
  }

  return {
    DEFAULT: DEFAULT,
    DEFAULT_PRODUCT_AREA_CONFIG: DEFAULT_PRODUCT_AREA_CONFIG,
    getActiveConfig: getActiveConfig,
    getProductAreaConfig: getProductAreaConfig
  };
})();
