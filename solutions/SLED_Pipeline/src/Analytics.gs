/**
 * Analytics.gs — Aggregation functions for SLED Pipeline Analysis.
 * Phase 2: shared filter engine + Overview summary builder.
 * All functions read from Data_getEffectiveRows_() — never from the sheet directly.
 */

/**
 * Applies the global filter payload to an array of effective rows.
 * Shared by all analytical tabs.
 * @param {Array<Object>} rows  Effective rows from Data_getEffectiveRows_().
 * @param {Object} p            Filter payload from the client.
 *   p.scope          'SLED'|'SLG'|'HENP'          (default 'SLED')
 *   p.studentFilter  'all'|'studentOnly'|'nonStudent' (default 'all')
 *   p.pipelineStatus 'active'|'closedWon'|'all'    (default 'active')
 *   p.fiscalWindow   string[]|null                 (null = all periods)
 * @returns {Array<Object>}
 */
function applyCommonFilters_(rows, p) {
  var scope = (p && p.scope)          || 'SLED';
  var sf    = (p && p.studentFilter)  || 'all';
  var ps    = (p && p.pipelineStatus) || 'active';
  var fw    = (p && p.fiscalWindow)   || null;

  return rows.filter(function(r) {
    if (scope === 'SLED' && !(r.teamScope === 'SLG' || r.teamScope === 'HENP')) return false;
    if (scope === 'SLG'  && r.teamScope !== 'SLG')  return false;
    if (scope === 'HENP' && r.teamScope !== 'HENP') return false;

    if (sf === 'studentOnly' && !r.isStudentSlice) return false;
    if (sf === 'nonStudent'  &&  r.isStudentSlice) return false;

    if (ps === 'active'    && !r.isActive)    return false;
    if (ps === 'closedWon' && !r.isClosedWon) return false;

    if (fw && fw.length && fw.indexOf(r.fiscalPeriod) === -1) return false;

    return true;
  });
}

/**
 * Builds the complete Overview summary from a filter payload.
 * Returns { meta, metrics, bullets, charts }.
 * @param {Object} payload  Client filter payload (see applyCommonFilters_ for shape).
 * @returns {Object}
 */
function Analytics_buildOverviewSummary_(payload) {
  Logger.log('Analytics_buildOverviewSummary_: start scope=' +
    (payload && payload.scope) + ' ps=' + (payload && payload.pipelineStatus));

  var rows     = Data_getEffectiveRows_();
  var filtered = applyCommonFilters_(rows, payload);

  var scope = (payload && payload.scope)          || 'SLED';
  var sf    = (payload && payload.studentFilter)  || 'all';
  var ps    = (payload && payload.pipelineStatus) || 'active';
  var daysAhead = (payload && payload.startWindow && payload.startWindow.daysAhead) || 60;

  // ---- Metrics ----
  var totalOpps        = filtered.length;
  var activeOpps       = filtered.filter(function(r) { return r.isActive;    }).length;
  var wonOpps          = filtered.filter(function(r) { return r.isClosedWon; }).length;
  var totalACV         = filtered.reduce(function(s, r) { return s + r.amount; }, 0);

  var servicesRows     = filtered.filter(function(r) { return r.isServicesLike;      });
  var subscriptionRows = filtered.filter(function(r) { return r.isSubscriptionLike;  });
  var studentRows      = filtered.filter(function(r) { return r.isStudentSlice;      });

  var servicesACV      = servicesRows.reduce(function(s, r)     { return s + r.amount; }, 0);
  var subscriptionACV  = subscriptionRows.reduce(function(s, r) { return s + r.amount; }, 0);
  var studentACV       = studentRows.reduce(function(s, r)      { return s + r.amount; }, 0);

  var metrics = {
    totalOpps:        totalOpps,
    activeOpps:       activeOpps,
    wonOpps:          wonOpps,
    totalACV:         totalACV,
    servicesACV:      servicesACV,
    subscriptionACV:  subscriptionACV,
    servicesSharePct: Utils_pct_(servicesACV, totalACV),
    subsSharePct:     Utils_pct_(subscriptionACV, totalACV),
    studentOpps:      studentRows.length,
    studentSharePct:  Utils_pct_(studentACV, totalACV)
  };

  // ---- ACV by Stage ----
  var stageMap = {};
  filtered.forEach(function(r) {
    if (!stageMap[r.stage]) stageMap[r.stage] = 0;
    stageMap[r.stage] += r.amount;
  });
  var acvByStage = Object.keys(stageMap).map(function(s) {
    return { stage: s, acv: stageMap[s] };
  }).sort(function(a, b) {
    var an = parseInt(a.stage, 10) || 99;
    var bn = parseInt(b.stage, 10) || 99;
    return an - bn;
  });

  // ---- ACV by Industry Group ----
  var industryMap = {};
  filtered.forEach(function(r) {
    var ig = r.industryGroup;
    if (!industryMap[ig]) industryMap[ig] = { acv: 0, count: 0 };
    industryMap[ig].acv   += r.amount;
    industryMap[ig].count += 1;
  });
  var acvByIndustryGroup = Object.keys(industryMap).map(function(ig) {
    return { industryGroup: ig, acv: industryMap[ig].acv, count: industryMap[ig].count };
  }).sort(function(a, b) { return b.acv - a.acv; });

  // ---- Bullets ----
  var bullets = buildBullets_(scope, ps, daysAhead, metrics, acvByIndustryGroup, filtered, studentACV);

  Logger.log('Analytics_buildOverviewSummary_: totalOpps=' + totalOpps + ' totalACV=' + totalACV);
  return {
    meta: {
      scope:         scope,
      studentFilter: sf,
      pipelineStatus: ps,
      generatedAt:   new Date().toISOString()
    },
    metrics: metrics,
    bullets: bullets,
    charts: {
      acvByStage:          acvByStage,
      acvByIndustryGroup:  acvByIndustryGroup
    }
  };
}

/**
 * Builds the 3–5 morning-coffee bullet strings for the Overview narrative panel.
 * @private
 */
function buildBullets_(scope, ps, daysAhead, m, acvByIndustryGroup, filtered, studentACV) {
  var scopeLabel = scope === 'SLG' ? 'SLG' : (scope === 'HENP' ? 'HENP' : 'SLED');

  function fmtN(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var bullets = [];

  // Bullet 1 — overall pipeline
  if (ps === 'active') {
    bullets.push(
      scopeLabel + ' active pipeline: ' + fmtN(m.totalOpps) + ' opportunities totaling ' +
      Utils_fmtMoney_(m.totalACV) + ' ACV — Services ' + Utils_fmtMoney_(m.servicesACV) +
      ' (' + m.servicesSharePct + '%) · Subscription ' + Utils_fmtMoney_(m.subscriptionACV) +
      ' (' + m.subsSharePct + '%).'
    );
  } else if (ps === 'closedWon') {
    bullets.push(
      scopeLabel + ' Closed/Won: ' + fmtN(m.totalOpps) + ' opportunities totaling ' +
      Utils_fmtMoney_(m.totalACV) + ' ACV — Services ' + Utils_fmtMoney_(m.servicesACV) +
      ' (' + m.servicesSharePct + '%) · Subscription ' + Utils_fmtMoney_(m.subscriptionACV) +
      ' (' + m.subsSharePct + '%).'
    );
  } else {
    bullets.push(
      scopeLabel + ' pipeline: ' + fmtN(m.totalOpps) + ' opportunities totaling ' +
      Utils_fmtMoney_(m.totalACV) + ' ACV (' + fmtN(m.activeOpps) + ' active / ' +
      fmtN(m.wonOpps) + ' Closed/Won) — Services ' + Utils_fmtMoney_(m.servicesACV) +
      ' (' + m.servicesSharePct + '%) · Subscription ' + Utils_fmtMoney_(m.subscriptionACV) +
      ' (' + m.subsSharePct + '%).'
    );
  }

  // Bullet 2 — top industry
  if (acvByIndustryGroup.length > 0) {
    var top    = acvByIndustryGroup[0];
    var topPct = Utils_pct_(top.acv, m.totalACV);
    bullets.push(
      'Top industry: ' + top.industryGroup + ' leads with ' + Utils_fmtMoney_(top.acv) +
      ' ACV (' + topPct + '% of total, ' + fmtN(top.count) + ' opportunities).'
    );
  }

  // Bullet 3 — student slice
  if (m.studentOpps > 0) {
    bullets.push(
      'Student-tagged opportunities: ' + fmtN(m.studentOpps) +
      ' (' + m.studentSharePct + '% of ACV — ' + Utils_fmtMoney_(studentACV) + ').'
    );
  } else {
    bullets.push('No student-tagged opportunities in the current view.');
  }

  // Bullet 4 — starts-in-next-N-days (Closed/Won only)
  if (ps === 'closedWon') {
    var nowMs     = new Date().getTime();
    var cutoffMs  = nowMs + daysAhead * 86400000;
    var startsCount = filtered.filter(function(r) {
      if (!r.estProjectStart) return false;
      var d = new Date(r.estProjectStart);
      return !isNaN(d.getTime()) && d.getTime() >= nowMs && d.getTime() <= cutoffMs;
    }).length;
    bullets.push(
      fmtN(startsCount) + ' Closed/Won ' + scopeLabel + ' opportunities have estimated project starts in the next ' +
      daysAhead + ' days.'
    );
  }

  return bullets;
}
