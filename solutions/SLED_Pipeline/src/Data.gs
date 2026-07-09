/**
 * Data.gs — Source reads, effective-row builder, per-execution cache.
 * SFDC_Opps is READ-ONLY; this module never writes to it.
 * Effective-view pattern: read once → map to clean row-objects → attach derived fields.
 */

/** @type {Array<Object>|null} Per-execution in-memory cache. Populated on first call. */
var _EFFECTIVE_ROWS_CACHE = null;

/**
 * Returns the full array of effective rows derived from SFDC_Opps.
 * Cached per execution (module-scoped var); safe to call multiple times.
 * Throws if the source sheet is missing or a required column is absent.
 * @returns {Array<Object>}
 */
function Data_getEffectiveRows_() {
  if (_EFFECTIVE_ROWS_CACHE) return _EFFECTIVE_ROWS_CACHE;

  var sh = SpreadsheetApp.getActive().getSheetByName(APP_CONFIG.sheets.sfdcOpps);
  if (!sh) throw new Error('Source sheet missing: ' + APP_CONFIG.sheets.sfdcOpps);

  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    _EFFECTIVE_ROWS_CACHE = [];
    return _EFFECTIVE_ROWS_CACHE;
  }

  var headers = values[0].map(String);
  var idx = Data_buildColumnIndex_(headers);
  _EFFECTIVE_ROWS_CACHE = values.slice(1).map(function(r) { return Data_mapRow_(r, idx); });
  return _EFFECTIVE_ROWS_CACHE;
}

/**
 * Builds a map of logical column key → zero-based column index from the header row.
 * Performs case-insensitive exact matching against APP_CONFIG.columns[key].header.
 * Throws for any required column that cannot be located.
 * @param {string[]} headers
 * @returns {Object.<string, number|null>}
 */
function Data_buildColumnIndex_(headers) {
  var lower = headers.map(function(h) { return String(h).toLowerCase(); });
  var idx = {};
  Object.keys(APP_CONFIG.columns).forEach(function(key) {
    var def = APP_CONFIG.columns[key];
    var i = lower.indexOf(def.header.toLowerCase());
    if (i === -1 && !def.optional) {
      throw new Error('Required column missing: ' + def.header);
    }
    idx[key] = (i === -1 ? null : i);
  });
  return idx;
}

/**
 * Maps a single raw data row to a clean effective-row object with all derived fields.
 * @param {Array} r       Raw row values array.
 * @param {Object} idx    Column index map from Data_buildColumnIndex_.
 * @returns {Object}
 */
function Data_mapRow_(r, idx) {
  function get(k) { var i = idx[k]; return i == null ? null : r[i]; }

  var industryRaw = Utils_str_(get('industry'));
  var name        = Utils_str_(get('name'));
  var svc         = Utils_str_(get('workdayServices'));
  var recordType  = Utils_str_(get('recordType'));
  var stage       = Utils_str_(get('stage'));

  // teamScope: classify SLED segments; SLED view = SLG + HENP
  var isSLG  = (industryRaw === 'State & Local Government' || industryRaw === 'Special Districts');
  var isHENP = (industryRaw === 'Higher Education' || industryRaw === 'Non-Profit' || industryRaw === 'Education (K-12)');
  var teamScope = isHENP ? 'HENP' : (isSLG ? 'SLG' : 'NONE');

  // Student slice: orthogonal to teamScope — word-boundary match on name or Workday_Services__c
  var isStudentSlice = Utils_hasWordStudent_(name) || Utils_hasWordStudent_(svc);

  // Record-type flags
  var isSubscriptionLike = (recordType === 'Subscription Opportunity' || recordType === 'Renewals Opportunity');
  var isServicesLike     = (recordType === 'Services Opportunity' || recordType === 'Supplemental Services' || recordType === 'Subcontracting Opportunity');

  // Stage flags
  var isClosedWon = (stage === '9- Closed/Won');

  // Related-service linkage
  var relatedServiceId = Utils_str_(get('relatedServiceId')) || null;

  return {
    id:                      Utils_str_(get('id')),
    name:                    name,
    recordType:              recordType,
    stage:                   stage,
    amount:                  Utils_toNumber_(get('amount')),
    fiscalPeriod:            Utils_str_(get('fiscalPeriod')),
    industryRaw:             industryRaw,
    industryGroup:           industryRaw || 'Other / Out-of-Scope',
    teamScope:               teamScope,
    isStudentSlice:          isStudentSlice,
    isSubscriptionLike:      isSubscriptionLike,
    isServicesLike:          isServicesLike,
    isClosedWon:             isClosedWon,
    isActive:                !isClosedWon,
    relatedServiceId:        relatedServiceId,
    hasRelatedServiceFlag:   !!relatedServiceId,
    // Optional passthrough fields (null when column absent)
    ownerName:               get('ownerName'),
    workdayServices:         svc,
    probability:             get('probability'),
    createdDate:             get('createdDate'),
    estProjectStart:         get('estProjectStart'),
    deploymentApproach:      get('deploymentApproach'),
    deploymentPhase:         get('deploymentPhase'),
    primaryPartner:          get('primaryPartner'),
    psSubRegion:             get('psSubRegion')
  };
}
