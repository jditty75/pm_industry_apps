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
   * Forward-looking batch month keys for Upcoming Batches (current month + horizon).
   * Operational lookback is used for lifecycle evidence only, not month-group presentation.
   *
   * @param {number} horizonMonths 3 or 6
   * @param {Date} anchor Local calendar anchor (typically start-of-today in app TZ)
   * @param {string} tz Script time zone
   * @return {string[]} YYYY-MM ascending
   */
  function buildUpcomingBatchMonthKeys(horizonMonths, anchor, tz) {
    var count = (horizonMonths === 6) ? 6 : 3;
    var keys = [];
    var seen = {};
    var base = (anchor && typeof anchor.getTime === 'function' && !isNaN(anchor.getTime()))
      ? anchor
      : new Date();
    for (var off = 0; off < count; off++) {
      var d = new Date(base.getFullYear(), base.getMonth() + off, 1);
      var ym = Utilities.formatDate(d, tz, 'yyyy-MM');
      if (!seen[ym]) {
        seen[ym] = true;
        keys.push(ym);
      }
    }
    return keys;
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
   * Coerces sheet/API values for google.script.run (native Date breaks client RPC).
   * @param {*} val
   * @return {string|number|null}
   */
  function coerceRpcScalarField(val) {
    if (val === undefined || val === null || val === '') {
      return '';
    }
    if (val instanceof Date ||
        (typeof val === 'object' && typeof val.getTime === 'function')) {
      var ms = val.getTime();
      return (typeof ms === 'number' && !isNaN(ms)) ? new Date(ms).toISOString() : '';
    }
    if (typeof val === 'number' && !isNaN(val)) {
      return val;
    }
    return String(val);
  }

  var LIKERT_5_SAT = '1\u20135, Extremely Dissatisfied to Extremely Satisfied';
  var LIKERT_5_AGREE = '1\u20135, Strongly Disagree to Strongly Agree';
  var NPS_0_10 = '0\u201310, Not at all Likely to Extremely Likely';

  /**
   * @param {*} v
   * @return {boolean}
   */
  function hasScoreValue_(v) {
    return v !== undefined && v !== null && v !== '';
  }

  /**
   * @param {string} role
   * @return {boolean}
   */
  function isExecutiveSponsorRole_(role) {
    var r = String(role || '').trim().toLowerCase();
    if (!r) return false;
    return (r.indexOf('executive') >= 0 && r.indexOf('sponsor') >= 0) ||
      r === 'es' || r.indexOf('exec sponsor') >= 0;
  }

  /**
   * @param {Object} row
   * @param {string} typeKey MDS|PGL
   * @return {{ value:*, label:string, scale:string }|null}
   */
  function pickOverallSatisfactionPresentation_(row, typeKey) {
    var overall = row.overall_satisfaction;
    var specific = typeKey === 'PGL' ? row.pgl_satisfaction : row.mds_satisfaction;
    var label = typeKey === 'PGL'
      ? 'How satisfied are you with your Workday deployment?'
      : 'How satisfied are you with your Workday deployment so far?';
    if (hasScoreValue_(overall)) {
      return { value: overall, label: label, scale: LIKERT_5_SAT };
    }
    if (hasScoreValue_(specific)) {
      return { value: specific, label: label, scale: LIKERT_5_SAT };
    }
    return null;
  }

  /**
   * @param {string} question
   * @param {*} value
   * @param {string} scale
   * @return {Object|null}
   */
  function ratingItem_(question, value, scale) {
    if (!hasScoreValue_(value)) return null;
    return {
      question: question,
      value: value,
      scale: scale || LIKERT_5_SAT
    };
  }

  /**
   * @param {string} text
   * @return {Object|null}
   */
  function qualtricsBundle_(sentiment, score, topics) {
    var hasSent = sentiment !== undefined && sentiment !== null && String(sentiment).trim() !== '';
    var hasTopics = topics !== undefined && topics !== null && String(topics).trim() !== '';
    var hasScore = hasScoreValue_(score);
    if (!hasSent && !hasTopics && !hasScore) return null;
    return {
      attribution: 'Qualtrics',
      sentiment: hasSent ? String(sentiment) : '',
      sentimentScore: hasScore ? score : '',
      topics: hasTopics ? String(topics) : ''
    };
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
      accountId: storageRow.account_id || '',
      accountName: storageRow.account_name || '',
      deploymentName: storageRow.deployment_name || '',
      surveyType: typeKey,
      responseDate: coerceRpcScalarField(storageRow.response_ts_utc),
      cohortDate: coerceRpcScalarField(linkage.cohortDate),
      surveyEventId: linkage.surveyEventId || '',
      linkMethod: linkage.linkMethod || LINK_LEGACY_UNKNOWN,
      overallSatisfaction: headline != null && headline !== '' ? headline : '',
      npsScore: storageRow.nps_score != null ? storageRow.nps_score : null,
      aspectMethodology: storageRow.aspect_methodology != null ? storageRow.aspect_methodology : null,
      aspectSchedule: storageRow.aspect_schedule != null ? storageRow.aspect_schedule : null,
      aspectCommunications: storageRow.aspect_communications != null ? storageRow.aspect_communications : null,
      aspectValue: storageRow.aspect_value != null ? storageRow.aspect_value : null,
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
   * @param {Object} linkage
   * @return {Object} curated detail DTO for VoC response modal (RPC-safe scalars)
   */
  function buildResponseDetailDto(row, linkage) {
    row = row || {};
    linkage = linkage || {};
    var typeKey = normalizeSurveyTypeKey(row.survey_type);
    var list = buildResponseListItem(row, linkage);
    var role = String(row.respondent_role || '').trim();
    var esRole = isExecutiveSponsorRole_(role);

    var overview = [];
    var overall = pickOverallSatisfactionPresentation_(row, typeKey);
    if (overall) {
      overview.push(ratingItem_(overall.label, overall.value, overall.scale));
    }
    if (typeKey === 'PGL' && hasScoreValue_(row.nps_score)) {
      overview.push(ratingItem_(
        'Based on your recent deployment experience, how likely are you to recommend ' +
          'Workday to a friend or colleague?',
        row.nps_score,
        NPS_0_10
      ));
    }
    if (role) {
      overview.push({ question: 'Respondent role', value: role, scale: '' });
    }
    if (row.deployment_stage_at_response) {
      overview.push({
        question: 'Deployment stage at response',
        value: String(row.deployment_stage_at_response),
        scale: ''
      });
    }

    var expectations = [];
    if (typeKey === 'MDS') {
      var mdsExp = [
        ['The transition from the Workday Sales team to the Workday Deployment team was managed well.',
          row.agree_sales_transition],
        ['The deployment so far is meeting the expectations set during the sales cycle.',
          row.agree_sales_expectations]
      ];
      mdsExp.forEach(function (pair) {
        var item = ratingItem_(pair[0], pair[1], LIKERT_5_AGREE);
        if (item) expectations.push(item);
      });
    } else if (typeKey === 'PGL') {
      var pglExp = [
        ['Project team set appropriate expectations for the effort required to deploy Workday.',
          row.agree_sales_expectations],
        ['We were prepared to go live and support Workday upon completion of the project.',
          row.agree_prepared_go_live]
      ];
      pglExp.forEach(function (pair) {
        var item = ratingItem_(pair[0], pair[1], LIKERT_5_AGREE);
        if (item) expectations.push(item);
      });
      if (esRole || hasScoreValue_(row.agree_met_business_case)) {
        var bc = ratingItem_(
          'Workday deployment met the objectives of our original business case.',
          row.agree_met_business_case,
          LIKERT_5_AGREE
        );
        if (bc) expectations.push(bc);
      }
    }

    var depValueLabel = typeKey === 'PGL'
      ? 'Value delivered considering the defined scope of this engagement'
      : 'Scope as defined by Statement of Work';
    var depExp = [
      ['Workday Methodology (Plan, Architect/Configure' +
        (typeKey === 'PGL' ? ', Test, Deploy' : '') + ')', row.aspect_methodology],
      ['Schedule Management', row.aspect_schedule],
      ['Communications (Status, Risks & Issues)', row.aspect_communications],
      [depValueLabel, row.aspect_value]
    ];
    var deploymentExperience = [];
    depExp.forEach(function (pair) {
      var item = ratingItem_(pair[0], pair[1], LIKERT_5_SAT);
      if (item) deploymentExperience.push(item);
    });

    var teamQs = [
      ['Understanding of your business needs', row.team_understanding],
      ['Collaboration with your team', row.team_collaboration],
      ['Responsiveness', row.team_responsiveness],
      ['Technical competence', row.team_technical_competence],
      ['Workday recommended guidance', row.team_guidance]
    ];
    var projectTeam = [];
    teamQs.forEach(function (pair) {
      var item = ratingItem_('How satisfied are you with your Workday project team\u2019s: ' + pair[0],
        pair[1], LIKERT_5_SAT);
      if (item) projectTeam.push(item);
    });

    var customerFeedback = [];
    function pushComment_(question, text, qual) {
      var body = text != null ? String(text) : '';
      if (!body.trim()) return;
      customerFeedback.push({
        question: question,
        text: body,
        qualtrics: qual || null
      });
    }
    if (typeKey === 'MDS') {
      pushComment_('What are the main reasons for your scores?', row.comment_reasons,
        qualtricsBundle_(row.reasons_sentiment, row.reasons_sentiment_score, row.reasons_parent_topics));
      pushComment_('What could we improve moving forward?', row.comment_improve,
        qualtricsBundle_(row.improve_sentiment, row.improve_sentiment_score, row.improve_parent_topics));
      pushComment_('What is working well that you would like to continue?', row.comment_working_well,
        qualtricsBundle_(row.working_well_sentiment, row.working_well_sentiment_score,
          row.working_well_parent_topics));
    } else {
      pushComment_('What are the main reasons for your scores?', row.comment_reasons,
        qualtricsBundle_(row.reasons_sentiment, row.reasons_sentiment_score, row.reasons_parent_topics));
      pushComment_('Is there anything else you would like to share with us?', row.comment_additional,
        qualtricsBundle_(row.additional_sentiment, row.additional_sentiment_score,
          row.additional_parent_topics));
    }

    var qualtricsAnalytics = [];
    customerFeedback.forEach(function (fb) {
      if (fb.qualtrics) {
        qualtricsAnalytics.push({
          question: fb.question,
          sentiment: fb.qualtrics.sentiment,
          sentimentScore: fb.qualtrics.sentimentScore,
          topics: fb.qualtrics.topics,
          attribution: fb.qualtrics.attribution
        });
      }
    });

    var deploymentContext = [];
    function ctx_(label, val) {
      if (val === undefined || val === null || String(val).trim() === '') return;
      deploymentContext.push({ label: label, value: String(val) });
    }
    ctx_('Account', row.account_name);
    ctx_('Deployment', row.deployment_name);
    ctx_('Deployment type', row.deployment_type);
    ctx_('Services approach', row.services_approach);
    ctx_('Priming partner type', row.priming_partner_type);
    ctx_('Deployment partner', row.partner_name);
    ctx_('Engagement Manager', row.engagement_manager);
    ctx_('Deployment start', row.deployment_start_date);
    ctx_('Target go-live', row.target_go_live_date);
    ctx_('Product areas', row.product_areas);
    ctx_('Product area groups', row.product_area_groups);
    ctx_('Sub-region', row.sub_region);

    var sourceAudit = [];
    function audit_(label, val) {
      if (val === undefined || val === null || String(val).trim() === '') return;
      sourceAudit.push({ label: label, value: coerceRpcScalarField(val) });
    }
    audit_('Response ID', row.response_id);
    audit_('Survey ID', row.survey_id);
    audit_('First imported', row.first_imported_at);
    audit_('Updated', row.updated_at);
    audit_('Revision', row.revision);
    audit_('Contract version', row.contract_version);
    audit_('Link method', linkage.linkMethod);
    audit_('Survey event ID', linkage.surveyEventId);

    return Object.assign({}, list, {
      respondentRole: role,
      scoreScaleVersion: coerceRpcScalarField(row.score_scale_version),
      targetGoLiveDate: coerceRpcScalarField(row.target_go_live_date),
      deploymentStage: coerceRpcScalarField(row.deployment_stage_at_response),
      deploymentType: coerceRpcScalarField(row.deployment_type),
      servicesApproach: coerceRpcScalarField(row.services_approach),
      primingPartnerType: coerceRpcScalarField(row.priming_partner_type),
      engagementManager: coerceRpcScalarField(row.engagement_manager),
      deploymentStartDate: coerceRpcScalarField(row.deployment_start_date),
      productAreas: coerceRpcScalarField(row.product_areas),
      productAreaGroups: coerceRpcScalarField(row.product_area_groups),
      subRegion: coerceRpcScalarField(row.sub_region),
      sections: {
        overview: overview,
        expectations: expectations,
        deploymentExperience: deploymentExperience,
        projectTeam: projectTeam,
        customerFeedback: customerFeedback,
        deploymentContext: deploymentContext,
        qualtricsAnalytics: qualtricsAnalytics,
        sourceAudit: sourceAudit
      }
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
    buildUpcomingBatchMonthKeys: buildUpcomingBatchMonthKeys,
    getDefaultPartnerScopeNames: getDefaultPartnerScopeNames,
    partnerMatchesScope: partnerMatchesScope,
    rowVisibleForPartnerScope: rowVisibleForPartnerScope,
    computeSurveyState: computeSurveyState,
    buildAwarenessConditions: buildAwarenessConditions,
    reconcileInFlightToCohort: reconcileInFlightToCohort,
    coerceRpcScalarField: coerceRpcScalarField,
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
