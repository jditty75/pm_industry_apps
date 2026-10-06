/**
 * CoreDeploymentDataStewardship.js
 *
 * Deterministic system-of-record QA conditions from deployment-signal-context-v1 packets.
 * Does not assign leadership attention or infer responsibility/blame.
 */

var CoreDeploymentDataStewardship = {

  SCHEMA_VERSION: 'deployment-data-stewardship-v1',

  LANE_STEWARDSHIP: 'DEPLOYMENT_DATA_STEWARDSHIP',
  LANE_PLATFORM: 'PLATFORM_EVIDENCE_LIMITATION',

  IMPACT_BLOCKING: 'BLOCKING',
  IMPACT_REVIEW: 'REVIEW',
  IMPACT_ADVISORY: 'ADVISORY',

  STALE_DHP_DAYS: 90,

  /**
   * @param {Object} packet deployment-signal-context-v1
   * @return {Array<Object>}
   */
  detectPlatformLimitations: function (packet) {
    var out = [];
    var meta = packet.metadata || {};
    var depId = String(meta.deployment_id || '').trim();
    var pf = packet.product_function || {};
    if (pf.product_function_target_history_available === false) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'PF_TARGET_DATE_HISTORY_UNAVAILABLE', 'PRODUCT_FUNCTION',
        'Product Function target-date history is unavailable in the current extract; ' +
        'PF target movement cannot be verified from historized evidence.',
        ['product_function.product_function_target_history_available'],
        'context_packet:product_function', CoreDeploymentDataStewardship.IMPACT_ADVISORY,
        CoreDeploymentDataStewardship.LANE_PLATFORM, depId, null));
    }
    var eq = packet.evidence_quality || {};
    (eq.unavailable_evidence || []).forEach(function (item) {
      if (item === 'product_function_target_date_history') return;
      out.push(CoreDeploymentDataStewardship._condition_(
        'PLATFORM_EVIDENCE_GAP', 'EVIDENCE',
        'Deterministic context marks evidence unavailable: ' + item + '.',
        ['evidence_quality.unavailable_evidence:' + item],
        'context_packet:evidence_quality', CoreDeploymentDataStewardship.IMPACT_ADVISORY,
        CoreDeploymentDataStewardship.LANE_PLATFORM, depId, null));
    });
    var ht = packet.health_trajectory || {};
    var recon = ht.reconciliation || {};
    var health = String((packet.current_state || {}).current_health || '').trim();
    if (recon.health_history_available === false && health) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'HEALTH_EVENT_HISTORY_SPARSE', 'HEALTH',
        'HealthEvents historized trace is empty or sparse while current health is populated.',
        ['health_trajectory.health_event_count'],
        'context_packet:health_trajectory', CoreDeploymentDataStewardship.IMPACT_ADVISORY,
        CoreDeploymentDataStewardship.LANE_PLATFORM, depId, null));
    }
    return out;
  },

  /**
   * @param {Object} packet
   * @return {Array<Object>}
   */
  detectStewardshipConditions: function (packet) {
    var out = [];
    var meta = packet.metadata || {};
    var depId = String(meta.deployment_id || '').trim();
    var cs = packet.current_state || {};
    var stage = String(cs.deployment_stage || '').trim().toLowerCase();
    var health = String(cs.current_health || '').trim();
    var mtp = String(cs.current_mtp || '').trim();
    var daysMtp = cs.days_relative_to_mtp;

    if (!mtp) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'CURRENT_MTP_MISSING', 'SCHEDULE',
        'Current MTP is unavailable and cannot be reconstructed from supplied context.',
        ['current_state.current_mtp'],
        'context_packet:current_state', CoreDeploymentDataStewardship.IMPACT_BLOCKING,
        CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId, null));
    }

    var ht = packet.health_trajectory || {};
    var recon = ht.reconciliation || {};
    if (recon.health_current_matches_last_event_new_health === false) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'HEALTH_STATE_RECONCILIATION_MISMATCH', 'HEALTH',
        'Current health does not reconcile with the last historized HealthEvents transition.',
        ['current_state.current_health', 'health_trajectory.reconciliation'],
        'context_packet:health_trajectory.reconciliation',
        CoreDeploymentDataStewardship.IMPACT_REVIEW,
        CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId,
        recon.days_since_last_historized_health_change));
    }

    var pf = packet.product_function || {};
    var pfCount = CoreDeploymentDataStewardship._asInt_(pf.product_function_count);
    var completed = CoreDeploymentDataStewardship._asInt_(pf.functions_completed);
    var remaining = CoreDeploymentDataStewardship._asInt_(pf.functions_remaining);
    if (pfCount > 0 && pf.product_function_rollup_reconciled === false) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'PF_ROLLUP_RECONCILIATION_MISMATCH', 'PRODUCT_FUNCTION',
        'Product Function count does not reconcile to completed + remaining.',
        ['product_function.product_function_count'],
        'context_packet:product_function', CoreDeploymentDataStewardship.IMPACT_REVIEW,
        CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId, null));
    }

    var preTerminal = { deploy: true, test: true, build: true, plan: true };
    if (pfCount > 0 && remaining === 0 && completed >= pfCount && preTerminal[stage]) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'PF_COMPLETE_STAGE_NOT_TERMINAL', 'LIFECYCLE',
        'All Product Functions appear complete while deployment stage remains pre-terminal.',
        ['product_function', 'current_state.deployment_stage'],
        'context_packet:lifecycle', CoreDeploymentDataStewardship.IMPACT_REVIEW,
        CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId, null));
    }

    var st = packet.schedule_trajectory || {};
    var parentRecon = String(st.parent_reconciliation_status || '').trim();
    if (parentRecon === 'DATE_MISMATCH' || parentRecon === 'RECONSTRUCTED_BLANK_CURRENT_POPULATED') {
      out.push(CoreDeploymentDataStewardship._condition_(
        'PARENT_MTP_RECONCILIATION_MISMATCH', 'SCHEDULE',
        'Parent MTP reconciliation status is ' + parentRecon + '.',
        ['schedule_trajectory.parent_reconciliation_status'],
        'context_packet:schedule_trajectory', CoreDeploymentDataStewardship.IMPACT_REVIEW,
        CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId, null));
    }

    var daysVal = parseFloat(daysMtp);
    if (!isNaN(daysVal) && daysVal < -30 && remaining > 0) {
      out.push(CoreDeploymentDataStewardship._condition_(
        'MTP_PASSED_REMAINING_PF_WORK', 'SCHEDULE',
        'Parent MTP is in the past while Product Functions remain.',
        ['current_state.days_relative_to_mtp', 'product_function.functions_remaining'],
        'context_packet:schedule_trajectory', CoreDeploymentDataStewardship.IMPACT_REVIEW,
        CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId, null));
    }

    var iv = packet.intervention || {};
    if (iv.has_open_health_plan) {
      var dhpDays = CoreDeploymentDataStewardship._asInt_(iv.days_since_dhp_update);
      if (dhpDays > CoreDeploymentDataStewardship.STALE_DHP_DAYS) {
        out.push(CoreDeploymentDataStewardship._condition_(
          'OPEN_HEALTH_PLAN_STALE_MAINTENANCE', 'INTERVENTION',
          'Open Health Plan maintenance appears stale relative to snapshot.',
          ['intervention.days_since_dhp_update'],
          'context_packet:intervention', CoreDeploymentDataStewardship.IMPACT_REVIEW,
          CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId, dhpDays));
      }
      var ahHealth = String(iv.action_history_latest_health_status || '').trim();
      if (health && ahHealth && health.toLowerCase() !== ahHealth.toLowerCase()) {
        out.push(CoreDeploymentDataStewardship._condition_(
          'INTERVENTION_HEALTH_STATUS_DIVERGENCE', 'INTERVENTION',
          'Current health differs from latest Action History health status.',
          ['current_state.current_health', 'intervention.action_history_latest_health_status'],
          'context_packet:intervention', CoreDeploymentDataStewardship.IMPACT_REVIEW,
          CoreDeploymentDataStewardship.LANE_STEWARDSHIP, depId,
          iv.days_since_action_history_update));
      }
    }
    return out;
  },

  /**
   * @param {Object} packet
   * @return {Object}
   */
  analyzePacket: function (packet) {
    var stewardship = CoreDeploymentDataStewardship.detectStewardshipConditions(packet);
    var platform = CoreDeploymentDataStewardship.detectPlatformLimitations(packet);
    return {
      schema_version: CoreDeploymentDataStewardship.SCHEMA_VERSION,
      deployment_data_stewardship: stewardship,
      platform_evidence_limitations: platform,
      has_stewardship: stewardship.length > 0,
      has_platform_limitation: platform.length > 0
    };
  },

  /** @private */
  _condition_: function (code, domain, observation, sourceFields, traceRef, impact, lane, depId, age) {
    return {
      schema_version: CoreDeploymentDataStewardship.SCHEMA_VERSION,
      lane: lane,
      condition_code: code,
      affected_domain: domain,
      observation: observation,
      source_fields: sourceFields,
      trace_reference: traceRef,
      impact_classification: impact,
      review_action: 'SYSTEM_OF_RECORD_REVIEW_REQUIRED',
      deployment_id: depId,
      age_or_staleness_days: age
    };
  },

  /** @private */
  _asInt_: function (v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }
};
