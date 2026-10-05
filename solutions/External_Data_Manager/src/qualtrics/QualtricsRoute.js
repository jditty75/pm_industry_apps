/**
 * First-level Qualtrics population routing and downstream destination config.
 * @namespace QualtricsRoute
 */
var QualtricsRoute = (function () {
  'use strict';

  var APP_HEALTHCARE = 'US Healthcare';
  var APP_SLED = 'US SLED';

  /**
   * Future DM destinations (tenant filter inside each workbook at ingest).
   * @type {Object.<string, { population: string, destinations: string[], enabled: boolean }>}
   */
  var ROUTE_BY_APP = {
    'US Healthcare': {
      population: QualtricsSchema.POPULATION_HEALTHCARE,
      destinations: ['HC_DM'],
      enabled: true
    },
    'US SLED': {
      population: QualtricsSchema.POPULATION_SLED,
      destinations: ['SLG_DM', 'HENP_DM'],
      enabled: true
    }
  };

  /**
   * @param {Object.<string, string>[]} normalizedRows
   * @return {{ healthcare: Object.<string, string>[], sled: Object.<string, string>[], counts: Object }}
   */
  function routePopulations(normalizedRows) {
    var healthcare = [];
    var sled = [];
    normalizedRows.forEach(function (row) {
      if (row.app === APP_HEALTHCARE) {
        healthcare.push(row);
      } else if (row.app === APP_SLED) {
        sled.push(row);
      }
    });
    return {
      healthcare: healthcare,
      sled: sled,
      counts: {
        total: normalizedRows.length,
        healthcare: healthcare.length,
        sled: sled.length
      }
    };
  }

  /**
   * @param {string} appValue
   * @return {Object|null}
   */
  function getRouteConfig(appValue) {
    return ROUTE_BY_APP[appValue] || null;
  }

  return {
    APP_HEALTHCARE: APP_HEALTHCARE,
    APP_SLED: APP_SLED,
    ROUTE_BY_APP: ROUTE_BY_APP,
    routePopulations: routePopulations,
    getRouteConfig: getRouteConfig
  };
})();
