/**
 * CoreDeploymentSignalLifecycle.js
 *
 * Pure lifecycle comparison for approved weekly Signal runs.
 * POSITIVE is modeled as portfolio-relative attention, not a lifecycle_state.
 */

var CoreDeploymentSignalLifecycle = {

  LIFECYCLE_NEW: 'NEW',
  LIFECYCLE_CONTINUING: 'CONTINUING',
  LIFECYCLE_ESCALATED: 'ESCALATED',
  LIFECYCLE_DE_ESCALATED: 'DE_ESCALATED',
  LIFECYCLE_RESOLVED: 'RESOLVED',

  ATTENTION_RANK: {
    POSITIVE: 0,
    INFORMATIONAL: 1,
    WATCH: 2,
    HIGH: 3
  },

  /**
   * Compare attention levels for escalation semantics (deterministic only).
   *
   * @param {string} prior
   * @param {string} next
   * @return {number} negative de-escalated, 0 same, positive escalated
   */
  attentionRankDelta: function (prior, next) {
    var p = CoreDeploymentSignalLifecycle.ATTENTION_RANK[String(prior || '').trim()];
    var n = CoreDeploymentSignalLifecycle.ATTENTION_RANK[String(next || '').trim()];
    if (p === undefined || n === undefined) return 0;
    return n - p;
  },

  /**
   * @param {Object|null} priorActive prior current-state row (plain object)
   * @param {Object} incoming normalized substantive + system context
   * @return {string}
   */
  determineLifecycle: function (priorActive, incoming) {
    if (!priorActive || priorActive.signal_status === 'RESOLVED') {
      return CoreDeploymentSignalLifecycle.LIFECYCLE_NEW;
    }
    var delta = CoreDeploymentSignalLifecycle.attentionRankDelta(
      priorActive.attention, incoming.attention);
    if (delta > 0) {
      return CoreDeploymentSignalLifecycle.LIFECYCLE_ESCALATED;
    }
    if (delta < 0) {
      return CoreDeploymentSignalLifecycle.LIFECYCLE_DE_ESCALATED;
    }
    return CoreDeploymentSignalLifecycle.LIFECYCLE_CONTINUING;
  },

  /**
   * Build full persistence plan (pure).
   *
   * @param {Object} params
   * @param {Array<Object>} params.priorCurrent
   * @param {Array<Object>} params.incomingRecords normalized substantive records
   * @param {Object} params.runMeta
   * @param {Object} params.timestamps { receivedAt, persistedAt }
   * @param {function(string):string} params.makeSignalId
   * @return {Object}
   */
  buildPlan: function (params) {
    params = params || {};
    var priorCurrent = params.priorCurrent || [];
    var incoming = params.incomingRecords || [];
    var runMeta = params.runMeta || {};
    var ts = params.timestamps || {};
    var makeSignalId = params.makeSignalId || function (key) {
      return 'SIG-' + String(key).replace(/\|/g, '-');
    };

    var priorByKey = {};
    priorCurrent.forEach(function (row) {
      if (row.signal_status !== 'RESOLVED' && row.identity_key) {
        priorByKey[row.identity_key] = row;
      }
    });

    var nextCurrent = [];
    var historyEvents = [];
    var matchedPriorKeys = {};
    var lifecycleCounts = {
      NEW: 0,
      CONTINUING: 0,
      ESCALATED: 0,
      DE_ESCALATED: 0,
      RESOLVED: 0
    };

    incoming.forEach(function (rec) {
      var identityKey = rec.identity_key ||
        CoreDeploymentSignalNormalize.identityKey(rec.deployment_id, rec.signal_type);
      var prior = priorByKey[identityKey];
      var lifecycle = CoreDeploymentSignalLifecycle.determineLifecycle(prior, rec);
      lifecycleCounts[lifecycle] = (lifecycleCounts[lifecycle] || 0) + 1;
      matchedPriorKeys[identityKey] = true;

      var signalId = prior && prior.signal_id
        ? prior.signal_id
        : makeSignalId(identityKey);
      var firstActive = prior && prior.first_active_at
        ? prior.first_active_at
        : ts.persistedAt;

      var currentRow = CoreDeploymentSignalLifecycle._materializeRow_({
        record: rec,
        signalId: signalId,
        priorSignalId: prior ? prior.signal_id : '',
        lifecycle: lifecycle,
        signalStatus: 'ACTIVE',
        runMeta: runMeta,
        timestamps: ts,
        firstActiveAt: firstActive,
        identityKey: identityKey
      });
      nextCurrent.push(currentRow);
      historyEvents.push(CoreDeploymentSignalLifecycle._historyFromCurrent_(
        currentRow, 'APPROVED_RUN', ts.persistedAt));
    });

    priorCurrent.forEach(function (prior) {
      if (prior.signal_status === 'RESOLVED') return;
      var key = prior.identity_key;
      if (!key || matchedPriorKeys[key]) return;
      lifecycleCounts.RESOLVED = (lifecycleCounts.RESOLVED || 0) + 1;
      var resolvedRow = Object.assign({}, prior, {
        lifecycle_state: CoreDeploymentSignalLifecycle.LIFECYCLE_RESOLVED,
        signal_status: 'RESOLVED',
        signal_run_id: runMeta.signal_run_id,
        signal_as_of: runMeta.signal_as_of,
        last_updated_at: ts.persistedAt,
        persisted_at: ts.persistedAt
      });
      historyEvents.push(CoreDeploymentSignalLifecycle._historyFromCurrent_(
        resolvedRow, 'RESOLUTION', ts.persistedAt));
    });

    return {
      nextCurrent: nextCurrent,
      historyEvents: historyEvents,
      lifecycleCounts: lifecycleCounts,
      signalsPersisted: nextCurrent.length,
      resolutions: lifecycleCounts.RESOLVED || 0
    };
  },

  /** @private */
  _materializeRow_: function (ctx) {
    var rec = ctx.record;
    var runMeta = ctx.runMeta;
    return {
      schema_version: CoreDeploymentSignalStore.SIGNAL_SCHEMA_VERSION,
      signal_id: ctx.signalId,
      deployment_id: rec.deployment_id,
      signal_run_id: runMeta.signal_run_id,
      signal_as_of: runMeta.signal_as_of,
      lifecycle_state: ctx.lifecycle,
      attention: rec.attention,
      signal_type: rec.signal_type,
      observation: rec.observation,
      interpretation: rec.interpretation,
      why_it_matters: rec.why_it_matters,
      leadership_question: rec.leadership_question,
      confidence: rec.confidence,
      evidence_limitations: rec.evidence_limitations,
      current_health: rec.current_health,
      stage: rec.stage,
      signal_status: ctx.signalStatus,
      context_ref: rec.context_ref,
      source_reasoning_run_ref: runMeta.source_reasoning_run_ref || '',
      prior_signal_id: ctx.priorSignalId || '',
      normalization_version: CoreDeploymentSignalStore.NORMALIZATION_VERSION,
      reasoning_prose_original: rec.reasoning_prose_original || '',
      first_active_at: ctx.firstActiveAt,
      last_updated_at: ctx.timestamps.persistedAt,
      persisted_at: ctx.timestamps.persistedAt,
      identity_key: ctx.identityKey
    };
  },

  /** @private */
  _historyFromCurrent_: function (row, eventType, eventAt) {
    var hist = Object.assign({}, row);
    hist.history_event_at = eventAt;
    hist.history_event_type = eventType;
    return hist;
  }
};
