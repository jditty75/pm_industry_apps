/**
 * Shared VoC (Voice of the Customer) survey platform — pure logic.
 * User-facing product name: VoC. Internal/persisted names remain CSAT where historical.
 * @namespace CoreCsatVoc
 */
var CoreCsatVoc = (function () {
  'use strict';

  var SURVEY_STATE_UPCOMING = 'UPCOMING';
  var SURVEY_STATE_IN_FLIGHT = 'IN_FLIGHT';
  var SURVEY_STATE_RESPONDED = 'RESPONDED';
  var SURVEY_STATE_OVERDUE = 'OVERDUE';

  var LINK_INFERRED_BATCH = 'INFERRED_BATCH';
  var LINK_LEGACY_AMBIGUOUS = 'LEGACY_AMBIGUOUS';
  var LINK_LEGACY_UNKNOWN = 'LEGACY_UNKNOWN';
  var LINK_LEDGER = 'LEDGER';

  var DEFAULT_LOOKBACK_DAYS = 180;
  var DEFAULT_PARTNER_LABEL = 'Workday Professional Services';

  /** @const {string[]} CSAT_SurveyEvents ledger columns (additive sheet). */
  var SURVEY_EVENT_COLUMNS = [
    'survey_event_id',
    'deployment_id',
    'survey_type',
    'cohort_date',
    'survey_target_date',
    'batch_year_month',
    'sent_date',
    'frozen_at',
    'link_method',
    'contract_version'
  ];

  var LEDGER_CONTRACT_VERSION = 'csat-survey-event-v1';

  /**
   * @param {string} surveyType
   * @return {string} MDS|PGL|''
   */
  function normalizeSurveyTypeKey(surveyType) {
    var s = String(surveyType || '').trim().toUpperCase();
    if (!s) return '';
    if (s === 'MGM' || s === 'MDS' || s.indexOf('MID-DEPLOYMENT') >= 0 ||
        s.indexOf('MID DEPLOYMENT') >= 0) {
      return 'MDS';
    }
    if (s === 'PGL' || s.indexOf('POST GO-LIVE') >= 0 || s.indexOf('POST GO LIVE') >= 0) {
      return 'PGL';
    }
    return s;
  }

  /**
   * @param {string} canonicalDeploymentId
   * @param {string} surveyType MDS|PGL
   * @param {string} cohortDateKey YYYY-MM-DD
   * @param {function(string): string} hashFn
   * @return {string}
   */
  function computeSurveyEventId(canonicalDeploymentId, surveyType, cohortDateKey, hashFn) {
    var dep = String(canonicalDeploymentId || '').trim().slice(0, 18);
    var typeKey = normalizeSurveyTypeKey(surveyType);
    var cohort = String(cohortDateKey || '').trim();
    if (!dep || !typeKey || !cohort) return '';
    var payload = 'csat-survey-event|v1|' + dep + '|' + typeKey + '|' + cohort;
    return 'SE_' + String(hashFn(payload)).slice(0, 40);
  }

  /**
   * @param {string} dateStr YYYY-MM-DD
   * @param {number} months
   * @return {string|null}
   */
  function addCalendarMonths(dateStr, months) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + months);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /**
   * @param {string} startDate
   * @param {string} targetDate
   * @return {string|null}
   */
  function computeMdsOneThirdPoint(startDate, targetDate) {
    if (!startDate || !targetDate) return null;
    var t0 = new Date(startDate + 'T12:00:00').getTime();
    var t1 = new Date(targetDate + 'T12:00:00').getTime();
    if (isNaN(t0) || isNaN(t1) || t1 <= t0) return null;
    var oneThird = t0 + (t1 - t0) / 3;
    var d = new Date(oneThird);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /**
   * @param {string} surveyType
   * @param {string} deploymentStartDate
   * @param {string} cohortDate
   * @return {string|null}
   */
  function computeSurveyTargetDate(surveyType, deploymentStartDate, cohortDate) {
    var kind = normalizeSurveyTypeKey(surveyType);
    if (kind === 'MDS') {
      return computeMdsOneThirdPoint(deploymentStartDate, cohortDate);
    }
    if (kind === 'PGL') {
      return addCalendarMonths(cohortDate, 2);
    }
    return null;
  }

  /**
   * Builds exact PF cohort events (no parent-MTP fallback, no clustering).
   * @param {Object} deploymentRow
   * @param {Array<Object>} productRows
   * @return {Array<{ kind:string, cohortDate:string, products:string[] }>}
   */
  function buildExactCohortEvents(deploymentRow, productRows) {
    var events = [];
    var pr = productRows || [];
    var targetMap = {};
    var actualMap = {};

    for (var i = 0; i < pr.length; i++) {
      var pf = pr[i];
      var t = pf.targetGoLive || '';
      if (t) {
        if (!targetMap[t]) targetMap[t] = {};
        if (pf.productArea) targetMap[t][pf.productArea] = true;
      }
      var a = pf.actualGoLive || '';
      if (a) {
        if (!actualMap[a]) actualMap[a] = {};
        if (pf.productArea) actualMap[a][pf.productArea] = true;
      }
    }

    Object.keys(targetMap).sort().forEach(function (T) {
      var products = Object.keys(targetMap[T]).sort();
      var oneThird = computeMdsOneThirdPoint(deploymentRow.deploymentStartDate, T);
      if (oneThird) {
        events.push({ kind: 'MDS', cohortDate: T, products: products });
      }
    });

    Object.keys(actualMap).sort().forEach(function (A) {
      var products = Object.keys(actualMap[A]).sort();
      events.push({ kind: 'PGL', cohortDate: A, products: products });
    });

    return events;
  }

  /**
   * @param {Array<Object>} productRows
   * @return {{ mdsCohortCount:number, pglCohortCount:number, plannedPglTargetDateCount:number }}
   */
  function countDeploymentCohorts(productRows) {
    var targets = {};
    var actuals = {};
    (productRows || []).forEach(function (pf) {
      var t = pf.targetGoLive || '';
      var a = pf.actualGoLive || '';
      if (t) targets[t] = true;
      if (a) actuals[a] = true;
    });
    return {
      mdsCohortCount: Object.keys(targets).length,
      pglCohortCount: Object.keys(actuals).length,
      plannedPglTargetDateCount: Object.keys(targets).length
    };
  }

  /**
   * @param {Array<Object>} scheduleByMonth CoreSurveySchedule.resolve results
   * @param {string} surveyType
   * @param {string} surveyTargetDate YYYY-MM-DD
   * @return {Object|null}
   */
  function resolveScheduleEntryForTarget(scheduleByMonth, surveyType, surveyTargetDate) {
    if (!surveyTargetDate || !scheduleByMonth || !scheduleByMonth.length) return null;
    var kind = normalizeSurveyTypeKey(surveyType);
    for (var i = 0; i < scheduleByMonth.length; i++) {
      var s = scheduleByMonth[i];
      var win = (kind === 'MDS') ? s.mdsOneThirdWindow : s.pglFirstMtpWindow;
      if (!win) continue;
      if (surveyTargetDate >= win.start && surveyTargetDate <= win.end) {
        return s;
      }
    }
    return null;
  }

  /**
   * Scans full schedule list (may extend beyond horizon) for batch assignment.
   * @param {function(string): Object} scheduleResolver
   * @param {string} surveyType
   * @param {string} surveyTargetDate
   * @param {string} startYearMonth first month to scan YYYY-MM
   * @param {number} maxMonths
   * @return {Object|null}
   */
  function resolveScheduleEntryWithScan(scheduleResolver, surveyType, surveyTargetDate,
    startYearMonth, maxMonths) {
    if (!scheduleResolver || !surveyTargetDate) return null;
    var parts = String(startYearMonth || '').split('-');
    if (parts.length !== 2) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m)) return null;
    for (var i = 0; i < maxMonths; i++) {
      var ym = y + '-' + (m < 10 ? '0' : '') + m;
      var entry = scheduleResolver(ym);
      if (entry) {
        var kind = normalizeSurveyTypeKey(surveyType);
        var win = (kind === 'MDS') ? entry.mdsOneThirdWindow : entry.pglFirstMtpWindow;
        if (win && surveyTargetDate >= win.start && surveyTargetDate <= win.end) {
          return entry;
        }
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return null;
  }

  /**
   * @param {Object} cfg AppConfig with defaults
   * @return {number}
   */
  function getOperationalLookbackDays(cfg) {
    var tab = (cfg.ui && cfg.ui.csatTab) || (cfg.ui && cfg.ui.mgmPglTab) || {};
    var n = parseInt(String(tab.operationalLookbackDays || tab.overdueLookbackDays || ''), 10);
    if (!isNaN(n) && n > 0) return n;
    return DEFAULT_LOOKBACK_DAYS;
  }

  /**
   * @param {Object} cfg
   * @return {string[]}
   */
  function getDefaultPartnerScopeNames(cfg) {
    var names = [];
    if (cfg.notify && cfg.notify.ddDigest && Array.isArray(cfg.notify.ddDigest.partnerNames) &&
        cfg.notify.ddDigest.partnerNames.length) {
      names = cfg.notify.ddDigest.partnerNames.slice();
    }
    if (!names.length) {
      names = [DEFAULT_PARTNER_LABEL];
    }
    return names.map(function (n) { return String(n || '').trim(); }).filter(Boolean);
  }

  /**
   * @param {string} partner
   * @param {string[]} scopeNames
   * @return {boolean}
   */
  function partnerMatchesScope(partner, scopeNames) {
    var p = String(partner || '').trim().toLowerCase();
    if (!p) return false;
    for (var i = 0; i < scopeNames.length; i++) {
      if (p === String(scopeNames[i] || '').trim().toLowerCase()) return true;
    }
    return false;
  }

  /**
   * @param {Object} row
   * @param {boolean} includePartners
   * @param {string[]} defaultPartners
   * @return {boolean}
   */
  function rowVisibleForPartnerScope(row, includePartners, defaultPartners) {
    if (includePartners) return true;
    return partnerMatchesScope(row.partner, defaultPartners);
  }

  /**
   * @param {Object} ctx
   * @param {string} todayKey YYYY-MM-DD
   * @param {Object|null} scheduleEntry
   * @param {Object} evidence { sent:boolean, responded:boolean }
   * @return {string}
   */
  function computeSurveyState(ctx, todayKey, scheduleEntry, evidence) {
    evidence = evidence || {};
    if (evidence.responded) return SURVEY_STATE_RESPONDED;
    if (evidence.sent) return SURVEY_STATE_IN_FLIGHT;
    var open = scheduleEntry && scheduleEntry.surveyOpen;
    if (open && todayKey >= open && !evidence.sent) {
      return SURVEY_STATE_OVERDUE;
    }
    return SURVEY_STATE_UPCOMING;
  }

  /**
   * @param {Object} input
   * @return {Array<{ code:string, message:string }>}
   */
  function buildAwarenessConditions(input) {
    input = input || {};
    var out = [];
    function push_(code, message) {
      out.push({ code: code, message: message });
    }

    if (input.missingDeploymentStart) {
      push_('MISSING_DEPLOYMENT_START',
        'Review Salesforce — MDS date cannot currently be calculated (no Deployment Start Date).');
    }
    if (input.missingPfCohort) {
      push_('NO_PF_COHORT',
        'Review Salesforce — no product-function cohort date is available for this survey type.');
    }
    if (input.invalidPfTarget) {
      push_('INVALID_PF_TARGET',
        'Review Salesforce — product target production date is missing or invalid.');
    }
    if (input.pfTargetNotAfterStart) {
      push_('PF_TARGET_BEFORE_START',
        'Review Salesforce — product target date is not after Deployment Start Date.');
    }
    if (input.multiCohort) {
      push_('MULTI_COHORT',
        'Multiple survey cohorts identified — additional survey coordination may be required.');
    }
    if (input.batchPassedNoIssuance) {
      push_('MISSED_SURVEY_BATCH',
        'Assigned survey batch has opened with no issuance evidence in In-Flight data.');
    }
    if (input.inflightLinkAmbiguous) {
      push_('INFLIGHT_LINK_AMBIGUOUS',
        'Survey history could not be matched uniquely to a delivery cohort.');
    }
    if (input.responseLinkAmbiguous) {
      push_('RESPONSE_LINK_AMBIGUOUS',
        'Response could not be matched uniquely to a survey cohort.');
    }
    if (input.sourceFreshnessIssue) {
      push_('SOURCE_FRESHNESS',
        'Source data freshness may affect survey preparation — review refresh status.');
    }
    if (input.missingPartner) {
      push_('MISSING_PARTNER',
        'Deployment partner is missing — confirm partner before survey coordination.');
    }
    if (input.plannedMultiplePglTargets && !input.multiCohort) {
      push_('PLANNED_PGL_COMPLEXITY',
        'Multiple product target dates may lead to multiple future PGL cohorts after go-live.');
    }
    return out;
  }

  /**
   * @param {Object} params
   * @return {{ surveyEventId:string, linkMethod:string, ambiguous:boolean }}
   */
  function reconcileInFlightToCohort(params) {
    params = params || {};
    var candidates = params.candidateEvents || [];
    var depId = params.canonicalDeploymentId;
    var typeKey = normalizeSurveyTypeKey(params.surveyType);
    if (!depId || !typeKey) {
      return { surveyEventId: '', linkMethod: LINK_LEGACY_UNKNOWN, ambiguous: true };
    }
    var filtered = candidates.filter(function (ev) {
      return ev.deploymentId === depId && normalizeSurveyTypeKey(ev.surveyType) === typeKey;
    });
    if (filtered.length === 1) {
      return {
        surveyEventId: filtered[0].surveyEventId,
        cohortDate: filtered[0].cohortDate,
        linkMethod: LINK_INFERRED_BATCH,
        ambiguous: false
      };
    }
    if (filtered.length > 1) {
      return { surveyEventId: '', linkMethod: LINK_LEGACY_AMBIGUOUS, ambiguous: true };
    }
    if (params.ledgerEventId) {
      return {
        surveyEventId: params.ledgerEventId,
        linkMethod: LINK_LEDGER,
        ambiguous: false
      };
    }
    return { surveyEventId: '', linkMethod: LINK_LEGACY_UNKNOWN, ambiguous: true };
  }

  /**
   * @param {Object} storageRow CSAT_Responses row
   * @param {Object} linkage from reconcile
   * @return {Object}
   */
  function buildResponseListItem(storageRow, linkage) {
    storageRow = storageRow || {};
    linkage = linkage || {};
    var typeKey = normalizeSurveyTypeKey(storageRow.survey_type);
    var headline = storageRow.overall_satisfaction;
    if (typeKey === 'PGL' && storageRow.pgl_satisfaction !== '' &&
        storageRow.pgl_satisfaction != null) {
      headline = storageRow.pgl_satisfaction;
    }
    if (typeKey === 'MDS' && storageRow.mds_satisfaction !== '' &&
        storageRow.mds_satisfaction != null) {
      headline = storageRow.mds_satisfaction;
    }
    return {
      responseId: storageRow.response_id || '',
      deploymentId: storageRow.deployment_id || '',
      accountName: storageRow.account_name || '',
      deploymentName: storageRow.deployment_name || '',
      surveyType: typeKey,
      responseDate: storageRow.response_ts_utc || '',
      cohortDate: linkage.cohortDate || '',
      surveyEventId: linkage.surveyEventId || '',
      linkMethod: linkage.linkMethod || LINK_LEGACY_UNKNOWN,
      overallSatisfaction: headline,
      npsScore: storageRow.nps_score,
      aspectMethodology: storageRow.aspect_methodology,
      aspectSchedule: storageRow.aspect_schedule,
      aspectCommunications: storageRow.aspect_communications,
      aspectValue: storageRow.aspect_value,
      partnerName: storageRow.partner_name || '',
      summaryLine: buildResponseSummaryLine(storageRow)
    };
  }

  /**
   * @param {Object} row
   * @return {string}
   */
  function buildResponseSummaryLine(row) {
    var parts = [];
    if (row.reasons_parent_topics) parts.push(String(row.reasons_parent_topics));
    if (row.improve_parent_topics) parts.push(String(row.improve_parent_topics));
    var s = parts.join(' · ').trim();
    if (s.length > 160) s = s.slice(0, 157) + '...';
    return s;
  }

  /**
   * @param {Object} row stored response
   * @return {Object} curated detail (no full 63-col dump)
   */
  function buildResponseDetailDto(row, linkage) {
    row = row || {};
    linkage = linkage || {};
    var list = buildResponseListItem(row, linkage);
    return Object.assign({}, list, {
      targetGoLiveDate: row.target_go_live_date || '',
      deploymentStage: row.deployment_stage_at_response || '',
      productAreas: row.product_areas || '',
      productAreaGroups: row.product_area_groups || '',
      teamUnderstanding: row.team_understanding,
      teamCollaboration: row.team_collaboration,
      teamResponsiveness: row.team_responsiveness,
      teamTechnicalCompetence: row.team_technical_competence,
      teamGuidance: row.team_guidance,
      reasonsSentiment: row.reasons_sentiment,
      improveSentiment: row.improve_sentiment,
      commentReasons: row.comment_reasons || '',
      commentImprove: row.comment_improve || '',
      commentWorkingWell: row.comment_working_well || '',
      commentAdditional: row.comment_additional || '',
      contractVersion: row.contract_version || ''
    });
  }

  /**
   * @param {Object} ledgerRow
   * @param {Object} draft
   * @return {Object|null} row to upsert or null if frozen and unchanged
   */
  function planLedgerFreezeRow(ledgerRow, draft) {
    if (!draft || !draft.survey_event_id) return null;
    if (!ledgerRow) return draft;
    if (ledgerRow.survey_event_id !== draft.survey_event_id) return draft;
    if (ledgerRow.frozen_at) {
      return null;
    }
    return draft;
  }

  /**
   * @param {Object} baseRow batch row fields
   * @param {Object} extras voc fields
   * @return {Object}
   */
  function attachBatchVocFields(baseRow, extras) {
    return Object.assign({}, baseRow, extras);
  }

  /**
   * EM reminder anti-duplicate keys (canonical cohort-aware + legacy event-date key).
   * @param {Object} dep batch survey row
   * @param {'first'|'final'} stage
   * @param {string} tz script time zone
   * @return {{ canonical:string, legacy:string }}
   */
  function buildEmReminderDedupeKeys(dep, stage, tz) {
    dep = dep || {};
    var stageKey = stage === 'final' ? 'final' : 'first';
    var depId = String(dep.deploymentId || '').trim();
    var surveyType = String(dep.surveyType || '').trim();
    var legacyDate = '';
    if (dep.eventDate) {
      try {
        legacyDate = Utilities.formatDate(new Date(dep.eventDate), tz, 'yyyy-MM-dd');
      } catch (eLegacy) {
        legacyDate = String(dep.eventDate).trim().substring(0, 10);
      }
    }
    var legacy = depId + '|' + legacyDate + '|' + surveyType + '|' + stageKey;

    var sid = String(dep.surveyEventId || dep.survey_event_id || '').trim();
    if (sid) {
      return { canonical: sid + '|' + stageKey, legacy: legacy };
    }
    var cohort = String(dep.cohortDate || dep.cohort_date || '').trim().substring(0, 10);
    if (depId && surveyType && cohort) {
      return {
        canonical: depId + '|' + cohort + '|' + surveyType + '|' + stageKey,
        legacy: legacy
      };
    }
    return { canonical: legacy, legacy: legacy };
  }

  /**
   * @param {Object<string,string>} sent persisted notify sent-key map
   * @param {{ canonical:string, legacy:string }} keys
   * @return {boolean}
   */
  function emReminderAlreadySent(sent, keys) {
    if (!sent || !keys) return false;
    if (sent[keys.canonical]) return true;
    if (keys.legacy && keys.legacy !== keys.canonical && sent[keys.legacy]) return true;
    return false;
  }

  /**
   * @param {Object<string,string>} sent
   * @param {{ canonical:string, legacy:string }} keys
   * @param {string} isoTimestamp
   */
  function markEmReminderSent(sent, keys, isoTimestamp) {
    if (!sent || !keys) return;
    sent[keys.canonical] = isoTimestamp;
  }

  /**
   * Maps legacy deployment-level exception codes to shared awareness conditions.
   * @param {string} missingType
   * @return {Array<{ code:string, message:string }>}
   */
  function awarenessConditionsForLegacyException(missingType) {
    if (missingType === 'DeploymentTargetEnd') {
      return buildAwarenessConditions({ missingPfCohort: true });
    }
    if (missingType === 'ProductTargets') {
      return buildAwarenessConditions({ invalidPfTarget: true });
    }
    return [];
  }

  return {
    SURVEY_STATE_UPCOMING: SURVEY_STATE_UPCOMING,
    SURVEY_STATE_IN_FLIGHT: SURVEY_STATE_IN_FLIGHT,
    SURVEY_STATE_RESPONDED: SURVEY_STATE_RESPONDED,
    SURVEY_STATE_OVERDUE: SURVEY_STATE_OVERDUE,
    LINK_INFERRED_BATCH: LINK_INFERRED_BATCH,
    LINK_LEGACY_AMBIGUOUS: LINK_LEGACY_AMBIGUOUS,
    LINK_LEGACY_UNKNOWN: LINK_LEGACY_UNKNOWN,
    LINK_LEDGER: LINK_LEDGER,
    DEFAULT_LOOKBACK_DAYS: DEFAULT_LOOKBACK_DAYS,
    DEFAULT_PARTNER_LABEL: DEFAULT_PARTNER_LABEL,
    SURVEY_EVENT_COLUMNS: SURVEY_EVENT_COLUMNS,
    LEDGER_CONTRACT_VERSION: LEDGER_CONTRACT_VERSION,
    normalizeSurveyTypeKey: normalizeSurveyTypeKey,
    computeSurveyEventId: computeSurveyEventId,
    addCalendarMonths: addCalendarMonths,
    computeMdsOneThirdPoint: computeMdsOneThirdPoint,
    computeSurveyTargetDate: computeSurveyTargetDate,
    buildExactCohortEvents: buildExactCohortEvents,
    countDeploymentCohorts: countDeploymentCohorts,
    resolveScheduleEntryForTarget: resolveScheduleEntryForTarget,
    resolveScheduleEntryWithScan: resolveScheduleEntryWithScan,
    getOperationalLookbackDays: getOperationalLookbackDays,
    getDefaultPartnerScopeNames: getDefaultPartnerScopeNames,
    partnerMatchesScope: partnerMatchesScope,
    rowVisibleForPartnerScope: rowVisibleForPartnerScope,
    computeSurveyState: computeSurveyState,
    buildAwarenessConditions: buildAwarenessConditions,
    reconcileInFlightToCohort: reconcileInFlightToCohort,
    buildResponseListItem: buildResponseListItem,
    buildResponseDetailDto: buildResponseDetailDto,
    buildResponseSummaryLine: buildResponseSummaryLine,
    planLedgerFreezeRow: planLedgerFreezeRow,
    attachBatchVocFields: attachBatchVocFields,
    buildEmReminderDedupeKeys: buildEmReminderDedupeKeys,
    emReminderAlreadySent: emReminderAlreadySent,
    markEmReminderSent: markEmReminderSent,
    awarenessConditionsForLegacyException: awarenessConditionsForLegacyException
  };
})();
