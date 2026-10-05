/**
 * Qualtrics destination routing configuration (data only — not a rules engine).
 * Add routes or destinations here (or load from Script Properties in V1B+).
 *
 * Examples (future, not active in V1A):
 * - Add application: append `destinations: [{ appId: 'NEW_DM', ... }]`
 * - Route Industry Y: new route with `match: { field: 'customer_segment', op: 'equals', value: 'Y' }`
 *
 * @namespace QualtricsRoutingConfig
 */
var QualtricsRoutingConfig = (function () {
  'use strict';

  /**
   * @typedef {Object} QualtricsDestinationRef
   * @property {string} appId GAS application id (e.g. HC_DM)
   * @property {string} [ingestKind] adapter id (e.g. csat_inflight)
   * @property {boolean} enabled
   */

  /**
   * @typedef {Object} QualtricsRouteRule
   * @property {string} routeId stable id for ops/audit
   * @property {{ field: string, op: string, value: string }} match
   * @property {string} populationId logical slice id (not a DM app id)
   * @property {QualtricsDestinationRef[]} destinations
   */

  /**
   * @typedef {Object} QualtricsRoutingConfigShape
   * @property {number} version
   * @property {string} routingKeyField normalized column for primary splits (default `app`)
   * @property {QualtricsRouteRule[]} routes
   */

  /** @type {QualtricsRoutingConfigShape} */
  var DEFAULT = {
    version: 1,
    routingKeyField: 'app',
    routes: [
      {
        routeId: 'us_healthcare',
        match: { field: 'app', op: 'equals', value: 'US Healthcare' },
        populationId: 'healthcare',
        destinations: [
          { appId: 'HC_DM', ingestKind: 'csat_inflight', enabled: true }
        ]
      },
      {
        routeId: 'us_sled',
        match: { field: 'app', op: 'equals', value: 'US SLED' },
        populationId: 'sled',
        destinations: [
          { appId: 'SLG_DM', ingestKind: 'csat_inflight', enabled: true },
          { appId: 'HENP_DM', ingestKind: 'csat_inflight', enabled: true }
        ]
      }
    ]
  };

  /**
   * @param {QualtricsRoutingConfigShape} [config]
   * @return {QualtricsRoutingConfigShape}
   */
  function getActiveConfig(config) {
    return config || DEFAULT;
  }

  return {
    DEFAULT: DEFAULT,
    getActiveConfig: getActiveConfig
  };
})();
