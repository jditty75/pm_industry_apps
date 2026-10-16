/** VOC V1 forecast engine. Requires existing VOC_Data.gs / vocLoadAllSources(). */
const VOC_V1 = {
  closeDateDays: 2,
  workdayPartnerName: 'Workday Professional Services',
  shortDurationMaxDays: 112
};

/** Informational (non data-quality) notice for Complete deployments with projected PGL. */
const VOC_INFO_COMPLETED_PGL_FORECAST = Object.freeze({
  code: 'COMPLETED_DEPLOYMENT_PGL_FORECAST_ACTIVE',
  title: 'Completed Deployment — PGL Forecast Active',
  message: 'This deployment is marked Complete in Salesforce, but its projected Post-Go-Live Survey date falls within the selected forecast period. It remains included for survey planning purposes.'
});

/**
 * Status-aware forecast inclusion for Salesforce Overall_Status__c.
 * @param {Object} parent Deployment row
 * @return {{include:boolean,generateMds:boolean,generatePgl:boolean,pglForecastOnly:boolean}}
 */
function vocDeploymentForecastEligibility_(parent) {
  const status = String(parent.Overall_Status__c || '').trim().toLowerCase();
  if (status === 'active') {
    return { include: true, generateMds: true, generatePgl: true, pglForecastOnly: false };
  }
  if (status === 'complete') {
    return { include: true, generateMds: false, generatePgl: true, pglForecastOnly: true };
  }
  return { include: false, generateMds: false, generatePgl: false, pglForecastOnly: false };
}

/** @return {typeof VOC_INFO_COMPLETED_PGL_FORECAST} */
function vocCompletedPglInfoNotice_() {
  return { ...VOC_INFO_COMPLETED_PGL_FORECAST };
}

/** Informational survey-planning observations (never affect eligibility or forecasts). */
const VOC_SURVEY_OPPORTUNITY_INSIGHT = Object.freeze({
  ADDITIONAL_PRODUCT_GO_LIVE: Object.freeze({
    code: 'ADDITIONAL_PRODUCT_GO_LIVE',
    title: 'Additional Product Go-Live'
  }),
  COMPLETED_PRODUCT_DEPLOYMENT: Object.freeze({
    code: 'COMPLETED_PRODUCT_DEPLOYMENT',
    title: 'Completed Product Deployment'
  })
});

const VOC_SURVEY_OPPORTUNITY_DISCLAIMER =
  'Informational observation for survey planning only. This does not change MDS/PGL eligibility, distribution inclusion, or Qualtrics survey activity.';

/** @param {string} iso YYYY-MM-DD */
function vocFormatMonthYearLabel_(iso) {
  const d = vocDate_(iso);
  if (!d) return String(iso || '');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/** @param {string} classification */
function vocIsFocusedProductDelivery_(classification) {
  return classification === 'SINGLE_PRODUCT_COHORT' || classification === 'BIG_BANG';
}

/**
 * Rule 1 — Additional Product Go-Live for a single PGL forecast event.
 * @param {Object} deployment
 * @param {Object} pglEvent
 * @return {Object|null}
 */
function vocDetectAdditionalProductGoLiveForPgl_(deployment, pglEvent) {
  const delivery = deployment.delivery || {};
  const parentActual = delivery.parentActualIso;
  if (!parentActual) return null;
  if (!pglEvent || pglEvent.type !== 'PGL' || pglEvent.basis !== 'Actual') return null;
  const laterActual = String(pglEvent.sourceDate || '');
  if (!laterActual || laterActual <= parentActual) return null;
  const productCount = Array.isArray(pglEvent.products) ? pglEvent.products.length : 0;
  const countLabel = productCount === 1 ? 'One product function' : productCount + ' product functions';
  const narrative = countLabel + ' reached production in ' + vocFormatMonthYearLabel_(laterActual) +
    ', following the parent deployment\'s ' + vocFormatMonthYearLabel_(parentActual) +
    ' first production milestone. These later milestones generate a ' +
    vocFormatMonthYearLabel_(pglEvent.surveyDate) + ' PGL projection.';
  return {
    code: VOC_SURVEY_OPPORTUNITY_INSIGHT.ADDITIONAL_PRODUCT_GO_LIVE.code,
    title: VOC_SURVEY_OPPORTUNITY_INSIGHT.ADDITIONAL_PRODUCT_GO_LIVE.title,
    parentFirstActualMtp: parentActual,
    laterActualMtp: laterActual,
    productCount,
    pglSurveyDate: pglEvent.surveyDate,
    narrative,
    disclaimer: VOC_SURVEY_OPPORTUNITY_DISCLAIMER
  };
}

/**
 * Rule 2 — Completed focused product deployment with PGL in the forecast month.
 * @param {Object} deployment
 * @param {string} forecastMonth YYYY-MM
 * @param {Object[]} monthPglEvents PGL events in that month
 * @return {Object|null}
 */
function vocDetectCompletedProductDeployment_(deployment, forecastMonth, monthPglEvents) {
  if (String(deployment.status || '').trim().toLowerCase() !== 'complete') return null;
  const classification = (deployment.delivery || {}).classification;
  if (!vocIsFocusedProductDelivery_(classification)) return null;
  const validPgl = (monthPglEvents || []).filter(e => e.type === 'PGL' &&
    String(e.surveyDate || '').startsWith(forecastMonth));
  if (!validPgl.length) return null;
  return {
    code: VOC_SURVEY_OPPORTUNITY_INSIGHT.COMPLETED_PRODUCT_DEPLOYMENT.code,
    title: VOC_SURVEY_OPPORTUNITY_INSIGHT.COMPLETED_PRODUCT_DEPLOYMENT.title,
    classification,
    pglSurveyDates: [...new Set(validPgl.map(e => e.surveyDate))].sort(),
    narrative: 'This completed deployment contains a focused product delivery cohort with a projected PGL distribution in the selected forecast period.',
    disclaimer: VOC_SURVEY_OPPORTUNITY_DISCLAIMER
  };
}

/**
 * Survey Opportunity Insights for a deployment and selected forecast month.
 * @param {Object} deployment Full forecast deployment (all events)
 * @param {string} forecastMonth YYYY-MM
 * @return {Object[]}
 */
function vocCollectSurveyOpportunityInsights_(deployment, forecastMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(forecastMonth || ''))) return [];
  const monthEvents = (deployment.events || []).filter(e =>
    String(e.surveyDate || '').startsWith(forecastMonth));
  const monthPgl = monthEvents.filter(e => e.type === 'PGL');
  const insights = [];
  const seen = new Set();
  for (const pgl of monthPgl) {
    const additional = vocDetectAdditionalProductGoLiveForPgl_(deployment, pgl);
    if (!additional) continue;
    const key = additional.code + ':' + additional.laterActualMtp + ':' + additional.pglSurveyDate;
    if (seen.has(key)) continue;
    seen.add(key);
    insights.push(additional);
  }
  const completed = vocDetectCompletedProductDeployment_(deployment, forecastMonth, monthPgl);
  if (completed && !seen.has(completed.code)) {
    seen.add(completed.code);
    insights.push(completed);
  }
  return insights;
}

/** Whole calendar days between UTC date-only values (avoids DST drift). */
function vocCalendarDaysBetween_(start, end) {
  const ms = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return ms / 86400000;
}

function vocFormatDeploymentDurationLabel_(days) {
  const weeks = (days / 7).toFixed(1);
  const months = (days / 30.4375).toFixed(1);
  return weeks + ' weeks (' + days + ' days · ~' + months + ' months)';
}

/** MDS duration qualification: strictly greater than 16 weeks (112 calendar days). */
function vocMdsDurationQualification_(days) {
  if (days === null || days === undefined || !Number.isFinite(days)) return 'UNDETERMINED';
  return days > VOC_V1.shortDurationMaxDays ? 'MEETS' : 'DOES_NOT_MEET';
}

/**
 * Planned or actual span from deployment start to a product-function milestone (UTC date-only).
 * @param {Date|null} start
 * @param {Date|null} end
 * @param {'Planned'|'Actual'} basis
 */
function vocComputeCohortSpanDuration_(start, end, basis) {
  const unavailable = { available: false, days: null, basis: null, isShort: false, label: 'Unavailable' };
  if (!start || !end) return unavailable;
  const days = Math.round(vocCalendarDaysBetween_(start, end));
  if (days < 0) return unavailable;
  const isShort = days <= VOC_V1.shortDurationMaxDays;
  return {
    available: true,
    days,
    basis,
    isShort,
    label: vocFormatDeploymentDurationLabel_(days)
  };
}

/** Stable cohort id from deployment id and target MTP ISO date. */
function vocCohortId_(deploymentId, targetIso) {
  return String(deploymentId || '').trim() + ':cohort:' + String(targetIso || '');
}

/**
 * Authoritative product-function delivery cohort model for a deployment.
 * @param {Object} parent Salesforce deployment row
 * @param {Object[]} children Associated product-function rows
 * @return {{cohorts:Object[], undatedCount:number, childCount:number, start:Date|null, parentTarget:Date|null, parentActual:Date|null}}
 */
function vocBuildDeliveryCohorts_(parent, children) {
  const deploymentId = String(parent.Id || '').trim();
  const start = vocDate_(parent.Deployment_Start_Date__c);
  const parentTarget = vocDate_(parent.Current_MTP_Date__c);
  const parentActual = vocDate_(parent.First_Move_to_Production_Date_Actual__c);
  const parentTargetIso = vocISO_(parentTarget);
  const byTarget = new Map();
  let undatedCount = 0;
  for (const child of children) {
    const target = vocDate_(child.Production_Move_Date_Target__c);
    if (!target) {
      undatedCount++;
      continue;
    }
    const targetIso = vocISO_(target);
    if (!byTarget.has(targetIso)) byTarget.set(targetIso, []);
    byTarget.get(targetIso).push(child);
  }
  const cohorts = [];
  for (const targetIso of [...byTarget.keys()].sort()) {
    const group = byTarget.get(targetIso);
    const target = vocDate_(targetIso);
    const plannedDuration = vocComputeCohortSpanDuration_(start, target, 'Planned');
    const mdsDurationQualification = plannedDuration.available
      ? vocMdsDurationQualification_(plannedDuration.days) : 'UNDETERMINED';
    const products = group.map(c => ({
      id: c.Id,
      area: c.Product_Area__c,
      function: c.Function__c,
      targetMtp: targetIso,
      actualMtp: vocISO_(vocDate_(c.Production_Move_Date_Actual__c)) || null
    }));
    const actualByDate = new Map();
    for (const p of products) {
      if (!p.actualMtp) continue;
      if (!actualByDate.has(p.actualMtp)) actualByDate.set(p.actualMtp, []);
      actualByDate.get(p.actualMtp).push(p);
    }
    const actualMilestones = [...actualByDate.keys()].sort().map(dateIso => ({
      date: dateIso,
      productCount: actualByDate.get(dateIso).length,
      duration: vocComputeCohortSpanDuration_(start, vocDate_(dateIso), 'Actual')
    }));
    const recordedActuals = products.filter(p => p.actualMtp);
    const allShareOneActual = recordedActuals.length === products.length && actualByDate.size === 1;
    const cohortActualDuration = allShareOneActual && actualMilestones.length === 1
      ? actualMilestones[0].duration : null;
    cohorts.push({
      id: vocCohortId_(deploymentId, targetIso),
      deploymentId,
      targetMtp: targetIso,
      deploymentStart: vocISO_(start),
      products,
      plannedDuration,
      cohortActualDuration,
      actualMilestones,
      parentTargetAligned: parentTargetIso && parentTargetIso === targetIso,
      mdsDurationQualification,
      productCount: products.length
    });
  }
  return {
    cohorts,
    undatedCount,
    childCount: children.length,
    start,
    parentTarget,
    parentActual,
    parentTargetIso,
    parentActualIso: vocISO_(parentActual)
  };
}

/**
 * Classify delivery structure from cohort evidence (never from deployment name/status).
 * @param {Object} parent
 * @param {ReturnType<typeof vocBuildDeliveryCohorts_>} cohortData
 */
function vocClassifyDeploymentDelivery_(parent, cohortData) {
  const { cohorts, undatedCount, childCount } = cohortData;
  if (!childCount && !cohorts.length) return 'INSUFFICIENT_DATA';
  if (!cohorts.length) return 'INSUFFICIENT_DATA';
  if (cohorts.length > 1) return 'MULTI_DELIVERABLE';
  const only = cohorts[0];
  const parentTarget = vocDate_(parent.Current_MTP_Date__c);
  const parentMatches = parentTarget && vocISO_(parentTarget) === only.targetMtp;
  if (undatedCount === 0 && parentMatches && childCount > 0) return 'BIG_BANG';
  return 'SINGLE_PRODUCT_COHORT';
}

/**
 * Deployment-level duration summary derived from planned delivery cohorts.
 * @param {string} classification
 * @param {ReturnType<typeof vocBuildDeliveryCohorts_>} cohortData
 */
function vocSummarizeDeploymentDuration_(classification, cohortData) {
  const unavailable = {
    available: false, days: null, basis: null, isShort: false, label: 'Unavailable',
    allCohortsShort: false, shortCohortCount: 0, cohortCount: 0, partialData: false,
    classification
  };
  const { cohorts, undatedCount, start } = cohortData;
  if (classification === 'INSUFFICIENT_DATA' && !cohorts.some(c => c.plannedDuration.available)) {
    return unavailable;
  }
  const plannedDays = cohorts.map(c => c.plannedDuration).filter(d => d.available);
  if (!plannedDays.length && !cohorts.length) return unavailable;
  const shortCohortCount = cohorts.filter(c => c.mdsDurationQualification === 'DOES_NOT_MEET').length;
  const qualifyingCohorts = cohorts.filter(c => c.plannedDuration.available);
  const allCohortsShort = qualifyingCohorts.length > 0 &&
    qualifyingCohorts.length === cohorts.length &&
    qualifyingCohorts.every(c => c.mdsDurationQualification === 'DOES_NOT_MEET');
  const partialData = undatedCount > 0 || (classification !== 'BIG_BANG' && undatedCount > 0);
  const hasUndated = undatedCount > 0;

  if (cohorts.length > 1) {
    const daysList = plannedDays.map(d => d.days);
    if (!daysList.length) {
      return { ...unavailable, cohortCount: cohorts.length, shortCohortCount, partialData: true };
    }
    const minD = Math.min(...daysList);
    const maxD = Math.max(...daysList);
    const minW = (minD / 7).toFixed(1);
    const maxW = (maxD / 7).toFixed(1);
    return {
      available: true,
      days: maxD,
      basis: 'Planned',
      isShort: shortCohortCount > 0,
      allCohortsShort,
      shortCohortCount,
      cohortCount: cohorts.length,
      partialData: hasUndated,
      classification,
      label: minW + '–' + maxW + ' weeks · ' + cohorts.length + ' cohorts'
    };
  }

  if (cohorts.length === 1) {
    const cohort = cohorts[0];
    const display = cohort.cohortActualDuration && cohort.cohortActualDuration.available
      ? cohort.cohortActualDuration : cohort.plannedDuration;
    if (!display.available) {
      return {
        ...unavailable,
        cohortCount: 1,
        shortCohortCount,
        partialData: hasUndated || !start
      };
    }
    return {
      available: true,
      days: display.days,
      basis: display.basis,
      isShort: cohort.mdsDurationQualification === 'DOES_NOT_MEET',
      allCohortsShort: cohort.mdsDurationQualification === 'DOES_NOT_MEET',
      shortCohortCount,
      cohortCount: 1,
      partialData: hasUndated,
      classification,
      label: display.label + (hasUndated ? ' · Partial data' : '')
    };
  }
  return unavailable;
}

/**
 * Full delivery model: cohorts, classification, and list/drawer duration summary.
 */
function vocBuildDeploymentDeliveryModel_(parent, children) {
  const cohortData = vocBuildDeliveryCohorts_(parent, children);
  const classification = vocClassifyDeploymentDelivery_(parent, cohortData);
  const durationSummary = vocSummarizeDeploymentDuration_(classification, cohortData);
  return {
    classification,
    cohorts: cohortData.cohorts,
    undatedCount: cohortData.undatedCount,
    parentTargetIso: cohortData.parentTargetIso,
    parentActualIso: cohortData.parentActualIso,
    durationSummary
  };
}

function vocDurationRowFields_(duration) {
  const d = duration || {
    available: false, isShort: false, label: 'Unavailable', allCohortsShort: false,
    shortCohortCount: 0, cohortCount: 0
  };
  return {
    durationDays: d.available ? d.days : null,
    durationLabel: d.label || 'Unavailable',
    durationBasis: d.available ? d.basis : null,
    isShortDuration: d.isShort === true,
    allCohortsShort: d.allCohortsShort === true,
    shortCohortCount: d.shortCohortCount || 0,
    cohortCount: d.cohortCount || 0,
    deliveryClassification: d.classification || null,
    durationPartialData: d.partialData === true
  };
}

/**
 * Deterministic executive observations when the drawer opens (no external APIs).
 * @param {Object} deployment Forecast deployment record
 * @param {Date} [asOf] Calendar date for historical vs upcoming projections
 */
/**
 * @param {Object} deployment
 * @param {Date} [asOf]
 * @param {string} [forecastMonth] YYYY-MM — scopes Survey Opportunity Insights
 */
function vocBuildSurveyIntelligence_(deployment, asOf, forecastMonth) {
  const today = asOf instanceof Date && !isNaN(asOf.getTime())
    ? vocDate_(vocISO_(asOf)) : vocDate_(vocISO_(new Date()));
  const todayIso = vocISO_(today);
  const delivery = deployment.delivery || {};
  const cohorts = delivery.cohorts || [];
  const classification = delivery.classification || 'INSUFFICIENT_DATA';
  const observations = [];
  const classLabels = {
    BIG_BANG: 'Validated Big Bang — one planned delivery cohort aligned with the parent target MTP.',
    MULTI_DELIVERABLE: 'Multi-Deliverable — multiple planned product-function delivery cohorts.',
    SINGLE_PRODUCT_COHORT: 'Single Product Cohort — product-function target dates define one planned cohort.',
    INSUFFICIENT_DATA: 'Insufficient Data — missing inputs prevent a reliable cohort duration or forecast.'
  };
  if (classLabels[classification]) observations.push(classLabels[classification]);
  if (cohorts.length) {
    observations.push(cohorts.length === 1
      ? 'One planned delivery cohort from product-function target MTP dates.'
      : cohorts.length + ' planned delivery cohorts from distinct product-function target MTP dates.');
  }
  if (delivery.undatedCount > 0) {
    observations.push(delivery.undatedCount + ' product function(s) lack a valid target MTP; cohort coverage is partial.');
  }
  if (classification === 'SINGLE_PRODUCT_COHORT' && cohorts.length === 1 && delivery.parentTargetIso &&
    delivery.parentTargetIso !== cohorts[0].targetMtp) {
    observations.push('Parent target MTP differs from the single product-function cohort; product-function dates are authoritative.');
  }
  if (classification === 'MULTI_DELIVERABLE' && delivery.parentTargetIso && cohorts.some(c => c.parentTargetAligned)) {
    observations.push('Parent target MTP aligns with one cohort only; later product deliveries remain independent.');
  }
  const shortN = cohorts.filter(c => c.mdsDurationQualification === 'DOES_NOT_MEET').length;
  const meetN = cohorts.filter(c => c.mdsDurationQualification === 'MEETS').length;
  const undetN = cohorts.filter(c => c.mdsDurationQualification === 'UNDETERMINED').length;
  if (shortN && !meetN) observations.push('All evaluable planned cohorts are at or below the 16-week MDS duration threshold (≤112 days).');
  else if (shortN && meetN) observations.push(shortN + ' planned cohort(s) at or below 16 weeks; ' + meetN + ' exceed 112 days (MDS duration qualification).');
  else if (meetN) observations.push(meetN + ' planned cohort(s) exceed 16 weeks for MDS duration qualification.');
  if (undetN) observations.push(undetN + ' cohort(s) have undetermined MDS duration qualification due to missing or invalid dates.');

  const events = deployment.events || [];
  const mdsEvents = events.filter(e => e.type === 'MDS');
  const pglEvents = events.filter(e => e.type === 'PGL');
  const upcomingMds = mdsEvents.filter(e => e.surveyDate >= todayIso);
  const historicalMds = mdsEvents.filter(e => e.surveyDate < todayIso);
  const upcomingPgl = pglEvents.filter(e => e.surveyDate >= todayIso);
  const historicalPgl = pglEvents.filter(e => e.surveyDate < todayIso);
  if (mdsEvents.length) {
    observations.push('Projected MDS: ' + upcomingMds.length + ' upcoming distribution group(s), ' +
      historicalMds.length + ' historical projection(s).');
  }
  if (pglEvents.length) {
    const actualBased = pglEvents.filter(e => e.basis === 'Actual').length;
    const predicted = pglEvents.filter(e => e.basis === 'Predicted').length;
    observations.push('Projected PGL: ' + upcomingPgl.length + ' upcoming, ' + historicalPgl.length +
      ' historical; ' + actualBased + ' actual-go-live-based group(s), ' + predicted + ' target-based projection(s).');
  }
  if (deployment.pglForecastOnly === true ||
    String(deployment.status || '').trim().toLowerCase() === 'complete') {
    observations.push(VOC_INFO_COMPLETED_PGL_FORECAST.message);
  }
  for (const cohort of cohorts) {
    if (cohort.actualMilestones.length > 1) {
      observations.push('Planned cohort ' + cohort.targetMtp + ' has ' + cohort.actualMilestones.length +
        ' distinct recorded actual production dates.');
    }
  }
  if (!deployment.startDate && cohorts.length) {
    observations.push('Deployment start date is missing; MDS duration qualification may be incomplete.');
  }

  const outlook = [];
  if (deployment.pglForecastOnly === true) {
    outlook.push('Completed deployment: projected PGL distributions remain in the monthly forecast for survey planning; MDS is not forecast for Complete status.');
  } else if (classification === 'BIG_BANG') outlook.push('Single aligned go-live cohort drives MDS and PGL planning.');
  else if (classification === 'MULTI_DELIVERABLE') outlook.push('Survey projections roll up by month while preserving each delivery cohort.');
  else if (classification === 'SINGLE_PRODUCT_COHORT') outlook.push('Duration and MDS planning use the shared product-function target cohort.');
  else outlook.push('Forecast detail may be limited until product-function milestone data is available.');

  const surveyOpportunityInsights = forecastMonth
    ? vocCollectSurveyOpportunityInsights_(deployment, forecastMonth) : [];

  return {
    generatedOn: todayIso,
    executiveOutlook: outlook.join(' '),
    observations: observations.slice(0, 12),
    disclaimer: 'Forecast only. Actual survey administration is managed in Qualtrics.',
    deliveryClassification: classification,
    cohortCount: cohorts.length,
    mdsQualification: { meets: meetN, doesNotMeet: shortN, undetermined: undetN },
    surveyOpportunityInsights
  };
}

function vocIsWorkdayPS_(parent) {
  return String(parent.Deployment_Partner_Name__c || '').trim().toLowerCase() ===
    VOC_V1.workdayPartnerName.toLowerCase();
}

function vocDate_(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
function vocISO_(d) { return d ? d.toISOString().slice(0, 10) : ''; }
function vocAddMonths_(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }
function vocFirstWednesday_(year, monthZero) {
  const first = new Date(Date.UTC(year, monthZero, 1));
  return new Date(first.getTime() + ((3 - first.getUTCDay() + 7) % 7) * 86400000);
}
function vocMdsDate_(start, target) {
  const days = Math.round((target.getTime() - start.getTime()) / 86400000 / 3);
  const milestone = new Date(start.getTime() + days * 86400000);
  const nextMonth = vocAddMonths_(milestone, 1);
  return { durationDays: Math.round((target - start) / 86400000), oneThirdDays: days,
    milestoneDate: vocISO_(milestone), surveyDate: vocISO_(vocFirstWednesday_(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth())) };
}
function vocPglDate_(mtp) {
  const month = vocAddMonths_(mtp, 2);
  return vocISO_(vocFirstWednesday_(month.getUTCFullYear(), month.getUTCMonth()));
}
function vocBuildForecast_ (data) {
  const childrenByParent = new Map();
  for (const child of data.productFunctions) {
    const id = String(child.Deployment__c || '').trim();
    const key = child._vocIndustry + ':' + id;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(child);
  }
  const deployments = [];
  const events = [];
  const exceptions = [];
  let activeStatusCount = 0;
  let completedPglOnlyCount = 0;
  for (const parent of data.deployments) {
    const eligibility = vocDeploymentForecastEligibility_(parent);
    if (!eligibility.include) continue;
    const industry = parent._vocIndustry;
    const key = industry + ':' + String(parent.Id || '').trim();
    const children = childrenByParent.get(key) || [];
    const start = vocDate_(parent.Deployment_Start_Date__c);
    const targetGroups = new Map();
    const pglGroups = new Map();
    const flags = [];
    for (const child of children) {
      const target = vocDate_(child.Production_Move_Date_Target__c);
      const actual = vocDate_(child.Production_Move_Date_Actual__c);
      if (target) {
        const date = vocISO_(target);
        if (!targetGroups.has(date)) targetGroups.set(date, []);
        targetGroups.get(date).push(child);
      }
      if (actual || target) {
        const basis = actual ? 'Actual' : 'Predicted';
        const date = vocISO_(actual || target);
        const groupKey = basis + ':' + date;
        if (!pglGroups.has(groupKey)) pglGroups.set(groupKey, []);
        pglGroups.get(groupKey).push(child);
      }
    }
    const targetDates = [...targetGroups.keys()].sort();
    for (let i = 1; i < targetDates.length; i++) {
      const days = Math.round((vocDate_(targetDates[i]) - vocDate_(targetDates[i - 1])) / 86400000);
      if (days <= VOC_V1.closeDateDays) flags.push('Target MTP dates only ' + days + ' day(s) apart: ' + targetDates[i - 1] + ' / ' + targetDates[i]);
    }
    for (const [date, group] of targetGroups) {
      const actuals = new Set(group.map(c => vocISO_(vocDate_(c.Production_Move_Date_Actual__c))));
      if (actuals.size > 1) flags.push('Inconsistent actual MTP dates within target group ' + date);
    }
    const delivery = vocBuildDeploymentDeliveryModel_(parent, children);
    const record = {
      key, id: String(parent.Id || ''), industry, customer: String(parent['Customer__r.Name'] || ''),
      name: String(parent.Name || ''), partnerName: String(parent.Deployment_Partner_Name__c || ''),
      isWorkdayPS: vocIsWorkdayPS_(parent), status: String(parent.Overall_Status__c || ''),
      health: String(parent.Overall_Health__c || ''), startDate: vocISO_(start),
      pglForecastOnly: eligibility.pglForecastOnly,
      delivery,
      duration: delivery.durationSummary,
      attributes: parent, children, flags: [...new Set(flags)], infoNotices: [], events: []
    };
    if (!start && targetGroups.size) record.flags.push('Missing or invalid deployment start date');
    if (delivery.classification === 'SINGLE_PRODUCT_COHORT' && delivery.cohorts.length === 1 &&
      delivery.parentTargetIso && delivery.cohorts[0].targetMtp !== delivery.parentTargetIso) {
      record.flags.push('Parent target MTP differs from product-function cohort (' +
        delivery.parentTargetIso + ' vs ' + delivery.cohorts[0].targetMtp + ')');
    }
    const cohortByTarget = new Map((delivery.cohorts || []).map(c => [c.targetMtp, c]));
    if (eligibility.generateMds) {
      for (const [date, group] of targetGroups) {
        const target = vocDate_(date);
        if (!start || target < start) {
          if (start && target < start) record.flags.push('Target MTP precedes deployment start: ' + date);
          continue;
        }
        const calculation = vocMdsDate_(start, target);
        const cohort = cohortByTarget.get(date);
        if (cohort) {
          calculation.mdsDurationQualification = cohort.mdsDurationQualification;
          calculation.plannedDurationDays = cohort.plannedDuration.available ? cohort.plannedDuration.days : null;
          calculation.cohortId = cohort.id;
        }
        record.events.push({ id: key + ':MDS:' + date, type: 'MDS', basis: 'Target',
          sourceDate: date, surveyDate: calculation.surveyDate, calculation,
          cohortId: cohort ? cohort.id : null,
          mdsDurationQualification: cohort ? cohort.mdsDurationQualification : 'UNDETERMINED',
          products: group.map(c => ({id: c.Id, area: c.Product_Area__c, function: c.Function__c})) });
      }
    }
    if (eligibility.generatePgl) {
      for (const [groupKey, group] of pglGroups) {
        const colon = groupKey.indexOf(':');
        const basis = groupKey.slice(0, colon);
        const date = groupKey.slice(colon + 1);
        const surveyDate = vocPglDate_(vocDate_(date));
        if (!surveyDate) continue;
        record.events.push({ id: key + ':PGL:' + groupKey, type: 'PGL', basis,
          sourceDate: date, surveyDate,
          calculation: { mtpDate: date, dateBasis: basis, monthsAfterMtp: 2 },
          products: group.map(c => ({id: c.Id, area: c.Product_Area__c, function: c.Function__c})) });
      }
    }
    record.events.sort((a,b) => a.surveyDate.localeCompare(b.surveyDate) || a.type.localeCompare(b.type));
    if (eligibility.pglForecastOnly) {
      if (!record.events.some(e => e.type === 'PGL')) continue;
      record.infoNotices = [vocCompletedPglInfoNotice_()];
      completedPglOnlyCount++;
    } else {
      activeStatusCount++;
    }
    deployments.push(record);
    for (const event of record.events) events.push({ deploymentKey: key, industry, customer: record.customer, deployment: record.name, ...event });
    if (record.flags.length) exceptions.push({ key, industry, customer: record.customer, deployment: record.name, flags: record.flags });
  }
  return {
    deployments, events, exceptions,
    summary: {
      forecastDeployments: deployments.length,
      activeDeployments: activeStatusCount,
      completedPglOnlyDeployments: completedPglOnlyCount,
      surveyEvents: events.length,
      flaggedDeployments: exceptions.length
    }
  };
}
function vocForecastData_() { return vocBuildForecast_(vocLoadAllSources()); }

/** Lightweight response for the UI. Fetches the workbooks once per request. */
function vocGetForecast(month, industry, surveyType, search, includePartners) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Invalid month');
  const data = vocForecastData_();
  const q = String(search || '').trim().toLowerCase();
  const showPartners = includePartners === true;
  const rows = data.deployments.map(d => {
    const matching = d.events.filter(e => e.surveyDate.startsWith(month) &&
      (surveyType === 'All' || e.type === surveyType));
    const surveyOpportunityInsights = vocCollectSurveyOpportunityInsights_(d, month);
    return { key: d.key, industry: d.industry, customer: d.customer, deployment: d.name,
      partnerName: d.partnerName, isWorkdayPS: d.isWorkdayPS,
      status: d.status, health: d.health, flags: d.flags, infoNotices: d.infoNotices || [],
      pglForecastOnly: d.pglForecastOnly === true,
      surveyOpportunityInsights,
      ...vocDurationRowFields_(d.duration),
      events: matching.map(e => ({id:e.id,type:e.type,basis:e.basis,surveyDate:e.surveyDate})) };
  }).filter(d => d.events.length && (showPartners || d.isWorkdayPS) &&
    (industry === 'All' || d.industry === industry) &&
    (!q || (d.customer + ' ' + d.deployment).toLowerCase().includes(q)));
  rows.sort((a,b) => a.events[0].surveyDate.localeCompare(b.events[0].surveyDate) || a.customer.localeCompare(b.customer));
  return { rows, summary: { deployments: rows.length, events: rows.reduce((n,r)=>n+r.events.length,0), flagged: rows.filter(r=>r.flags.length).length } };
}
function vocGetDeploymentDetails(key, forecastMonth) {
  const data = vocForecastData_();
  const record = data.deployments.find(d => d.key === key);
  if (!record) throw new Error('Deployment not found');
  record.contacts = vocGetDeploymentContacts_(record.industry, record.id);
  const month = /^\d{4}-\d{2}$/.test(String(forecastMonth || '')) ? forecastMonth : null;
  record.surveyIntelligence = vocBuildSurveyIntelligence_(record, new Date(), month);
  return record;
}
function vocGetExceptions() { return vocForecastData_().exceptions; }
function testVOCForecast() {
  const data = vocForecastData_();
  console.log('VOC FORECAST V1');
  console.log(JSON.stringify(data.summary));
  for (const industry of ['SLG','HENP','HC']) {
    const group = data.deployments.filter(d=>d.industry===industry);
    console.log(industry + ' active deployments=' + group.length +
      ' MDS=' + group.reduce((n,d)=>n+d.events.filter(e=>e.type==='MDS').length,0) +
      ' PGL=' + group.reduce((n,d)=>n+d.events.filter(e=>e.type==='PGL').length,0) +
      ' flagged=' + group.filter(d=>d.flags.length).length);
  }
  console.log('Sample forecast events: ' + JSON.stringify(data.events.slice(0,3)));
}
function testVOCDateMath() {
  const m = vocMdsDate_(vocDate_('2027-01-01'),vocDate_('2027-12-31'));
  if (m.milestoneDate !== '2027-05-02' || m.surveyDate !== '2027-06-02') throw new Error('MDS date test failed: '+JSON.stringify(m));
  if (vocPglDate_(vocDate_('2027-06-18')) !== '2027-08-04') throw new Error('PGL date test failed');
  console.log('VOC date math tests passed');
}
function doGet() {
  return HtmlService.createHtmlOutputFromFile('VOC_Index').setTitle('VOC | Survey Forecast');
}

/** Sanity test for the partner classification and default filter behavior. */
function testVOCPartnerClassification() {
  const samples = [
    [{Deployment_Partner_Name__c:'Workday Professional Services'}, true],
    [{Deployment_Partner_Name__c:' workday professional services '}, true],
    [{Deployment_Partner_Name__c:'Other Partner'}, false],
    [{Deployment_Partner_Name__c:''}, false]
  ];
  samples.forEach(([parent, expected]) => {
    if (vocIsWorkdayPS_(parent) !== expected) throw new Error('Partner classification test failed');
  });
  console.log('VOC partner classification tests passed');
}
