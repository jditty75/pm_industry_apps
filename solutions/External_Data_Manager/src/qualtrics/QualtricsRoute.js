/**
 * Configuration-driven routing for canonical Qualtrics datasets.
 * @namespace QualtricsRoute
 */
var QualtricsRoute = (function () {
  'use strict';

  /**
   * @param {Object.<string, string>} row normalized row
   * @param {QualtricsRoutingConfig.QualtricsRouteRule} route
   * @return {boolean}
   */
  function rowMatchesRoute(row, route) {
    var field = route.match.field;
    var val = row[field];
    if (route.match.op === 'equals') {
      return val === route.match.value;
    }
    return false;
  }

  /**
   * @param {Object.<string, string>} row
   * @param {QualtricsRoutingConfig.QualtricsRouteRule[]} routes
   * @return {QualtricsRoutingConfig.QualtricsRouteRule|null}
   */
  function findMatchingRoute(row, routes) {
    for (var i = 0; i < routes.length; i++) {
      if (rowMatchesRoute(row, routes[i])) {
        return routes[i];
      }
    }
    return null;
  }

  /**
   * Ensures every row maps to a configured route (replaces hardcoded VALID_APPS in normalizer).
   *
   * @param {Object.<string, string>[]} rows
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [routingConfig]
   * @return {EdmJobTypes.EdmValidationResult}
   */
  function validateRoutableRows(rows, routingConfig) {
    var config = QualtricsRoutingConfig.getActiveConfig(routingConfig);
    var errors = [];
    var bad = {};
    var hasNull = false;
    var keyField = config.routingKeyField || QualtricsSchema.ROUTING_KEY_FIELD;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var keyVal = row[keyField];
      if (keyVal == null || String(keyVal).trim() === '') {
        hasNull = true;
        continue;
      }
      if (!findMatchingRoute(row, config.routes)) {
        bad[keyVal] = true;
      }
    }
    if (hasNull || Object.keys(bad).length) {
      var detail = Object.keys(bad).length ? Object.keys(bad).join(', ') : 'nulls present';
      errors.push("Unexpected/blank '" + keyField + "' values: " + detail);
    }
    return errors.length ? { ok: false, errors: errors } : { ok: true };
  }

  /**
   * @param {Object.<string, string>[]} rows canonical normalized rows
   * @param {QualtricsRoutingConfig.QualtricsRoutingConfigShape} [routingConfig]
   * @return {{
   *   slices: Object[],
   *   countsByPopulationId: Object.<string, number>,
   *   destinationPlan: Object[]
   * }}
   */
  function routeCanonicalDataset(rows, routingConfig) {
    var config = QualtricsRoutingConfig.getActiveConfig(routingConfig);
    var validation = validateRoutableRows(rows, config);
    if (!validation.ok) {
      throw new Error((validation.errors || []).join('; '));
    }

    var byPopulation = {};
    config.routes.forEach(function (r) {
      byPopulation[r.populationId] = [];
    });

    rows.forEach(function (row) {
      var route = findMatchingRoute(row, config.routes);
      if (route) {
        byPopulation[route.populationId].push(row);
      }
    });

    var countsByPopulationId = {};
    Object.keys(byPopulation).forEach(function (popId) {
      countsByPopulationId[popId] = byPopulation[popId].length;
    });

    var slices = config.routes
      .filter(function (r) {
        return byPopulation[r.populationId].length > 0;
      })
      .map(function (r) {
        return {
          routeId: r.routeId,
          populationId: r.populationId,
          match: r.match,
          rows: byPopulation[r.populationId],
          destinations: r.destinations
        };
      });

    var destinationPlan = slices.map(function (s) {
      return {
        routeId: s.routeId,
        populationId: s.populationId,
        destinations: s.destinations.map(function (d) {
          return d.appId;
        }),
        destinationRefs: s.destinations,
        rowCount: s.rows.length,
        ingestEnabled: false
      };
    });

    return {
      slices: slices,
      countsByPopulationId: countsByPopulationId,
      destinationPlan: destinationPlan
    };
  }

  return {
    rowMatchesRoute: rowMatchesRoute,
    findMatchingRoute: findMatchingRoute,
    validateRoutableRows: validateRoutableRows,
    routeCanonicalDataset: routeCanonicalDataset
  };
})();
