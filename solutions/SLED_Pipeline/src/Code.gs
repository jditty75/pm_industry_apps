/**
 * Code.gs — Server-side entry points for SLED Pipeline Analysis.
 * Phase 1: diagnostic endpoint only. UI endpoints added in Phase 2+.
 */

/**
 * Returns diagnostic counts from the effective-row builder.
 * Run this in the Apps Script editor to verify Phase 1 data layer correctness.
 * @returns {Object}
 */
function getDataLayerDiagnostics() {
  Logger.log('getDataLayerDiagnostics: start');
  var rows = Data_getEffectiveRows_();
  var by = function(pred) { return rows.filter(pred).length; };
  var result = {
    totalRows:        rows.length,
    teamScope: {
      SLG:  by(function(r) { return r.teamScope === 'SLG';  }),
      HENP: by(function(r) { return r.teamScope === 'HENP'; }),
      NONE: by(function(r) { return r.teamScope === 'NONE'; })
    },
    student:           by(function(r) { return r.isStudentSlice;        }),
    subscriptionLike:  by(function(r) { return r.isSubscriptionLike;    }),
    servicesLike:      by(function(r) { return r.isServicesLike;        }),
    closedWon:         by(function(r) { return r.isClosedWon;           }),
    active:            by(function(r) { return r.isActive;              }),
    hasRelatedService: by(function(r) { return r.hasRelatedServiceFlag; }),
    sample:            rows.slice(0, 3)
  };
  Logger.log('getDataLayerDiagnostics: totalRows=' + result.totalRows);
  return result;
}
