/**
 * CoreDeploymentSignalNormalize.js
 *
 * Deterministic normalization/validation for approved Sana substantive output.
 * Does not assign lifecycle, Signal IDs, or workbook fields.
 */

var CoreDeploymentSignalNormalize = {

  ATTENTION_MAP: {
    high: 'HIGH',
    watch: 'WATCH',
    informational: 'INFORMATIONAL',
    positive: 'POSITIVE'
  },

  CONFIDENCE_MAP: {
    high: 'HIGH',
    medium: 'MEDIUM',
    low: 'LOW'
  },

  SIGNAL_TYPE_ALIASES: {
    compound: 'COMPOUND',
    health: 'HEALTH',
    schedule: 'SCHEDULE',
    lifecycle: 'LIFECYCLE',
    intervention: 'INTERVENTION',
    positive: 'POSITIVE',
    'green exception': 'GREEN_EXCEPTION',
    green_exception: 'GREEN_EXCEPTION'
  },

  /**
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  isEnabled: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    return CoreDeploymentSignalNormalize._isSlgPersistenceCfg_(cfg);
  },

  /**
   * Normalize one substantive AI record into deployment-signal-v1 fields (no system fields).
   *
   * @param {Object} raw
   * @param {Object=} options
   * @return {{ ok: boolean, record: Object|null, errors: Array<string>, original: Object }}
   */
  normalizeSubstantiveRecord: function (raw, options) {
    options = options || {};
    var errors = [];
    var original = Object.assign({}, raw || {});
    var depId = String(raw.deployment_id || raw.deploymentId || '').trim();
    if (!depId) {
      errors.push('deployment_id required');
    }

    var att = CoreDeploymentSignalNormalize._normalizeAttention_(raw.attention);
    if (!att.normalized) {
      errors.push('attention required or unrecognizable');
    }

    var typeNorm = CoreDeploymentSignalNormalize._normalizeSignalType_(
      raw.signal_type || raw.signalType);
    if (!typeNorm.normalized) {
      errors.push('signal_type required or unrecognizable');
    }

    var conf = CoreDeploymentSignalNormalize._normalizeConfidence_(raw.confidence);
    var observation = CoreDeploymentSignalNormalize._trimProse_(raw.observation);
    var interpretation = CoreDeploymentSignalNormalize._trimProse_(raw.interpretation);
    if (!observation && !interpretation) {
      errors.push('observation or interpretation required');
    }

    var record = {
      deployment_id: depId,
      attention: att.normalized,
      attention_raw: att.raw,
      signal_type: typeNorm.normalized,
      signal_type_raw: typeNorm.raw,
      observation: observation,
      interpretation: interpretation,
      why_it_matters: CoreDeploymentSignalNormalize._trimProse_(
        raw.why_it_matters || raw.whyItMatters),
      leadership_question: CoreDeploymentSignalNormalize._trimProse_(
        raw.leadership_question || raw.leadershipQuestion),
      confidence: conf.normalized,
      confidence_raw: conf.raw,
      evidence_limitations: CoreDeploymentSignalNormalize._trimProse_(
        raw.evidence_limitations || raw.evidenceLimitations),
      context_ref: String(raw.context_ref || raw.contextRef || '').trim(),
      reasoning_prose_original: String(
        raw.reasoning_prose_original || raw.reasoningProseOriginal || '').trim(),
      current_health: String(raw.current_health || raw.currentHealth || '').trim(),
      stage: String(raw.stage || raw.deployment_stage || '').trim()
    };

    if (errors.length) {
      return { ok: false, record: null, errors: errors, original: original };
    }
    return { ok: true, record: record, errors: [], original: original };
  },

  /**
   * @param {Object} runInput approved run payload (records array and/or sana_batch_text)
   * @param {Object=} options
   * @return {{ ok: boolean, records: Array<Object>, errors: Array<string>, meta: Object }}
   */
  normalizeApprovedRun: function (runInput, options) {
    options = options || {};
    runInput = runInput || {};
    var errors = [];
    var records = [];
    var rawRecords = runInput.records || runInput.signals || [];

    if ((!rawRecords || !rawRecords.length) && runInput.sana_batch_text) {
      rawRecords = CoreDeploymentSignalNormalize._recordsFromSanaText_(
        runInput.sana_batch_text, runInput.batch_id || 'approved');
    }

    if (!rawRecords || !rawRecords.length) {
      return {
        ok: false,
        records: [],
        errors: ['no signal records in approved run'],
        meta: {}
      };
    }

    rawRecords.forEach(function (raw, idx) {
      var norm = CoreDeploymentSignalNormalize.normalizeSubstantiveRecord(raw, options);
      if (!norm.ok) {
        errors.push('record[' + idx + ']: ' + norm.errors.join('; '));
        return;
      }
      records.push(norm.record);
    });

    return {
      ok: errors.length === 0,
      records: records,
      errors: errors,
      meta: {
        proposed_count: rawRecords.length,
        normalized_count: records.length
      }
    };
  },

  /**
   * @param {string} deploymentId
   * @param {string} signalType
   * @return {string}
   */
  identityKey: function (deploymentId, signalType) {
    var dep = String(deploymentId || '').trim().toLowerCase();
    var fam = CoreDeploymentSignalNormalize._normalizeSignalType_(signalType).normalized;
    return dep + '|' + fam;
  },

  /** @private */
  _isSlgPersistenceCfg_: function (cfg) {
    if (cfg.appId !== 'SLG') return false;
    var sig = cfg.deploymentSignal || {};
    return sig.enabled === true && sig.persistenceEnabled === true;
  },

  /** @private */
  _normalizeAttention_: function (value) {
    return CoreDeploymentSignalNormalize._normalizeToken_(
      value, CoreDeploymentSignalNormalize.ATTENTION_MAP);
  },

  /** @private */
  _normalizeConfidence_: function (value) {
    return CoreDeploymentSignalNormalize._normalizeToken_(
      value, CoreDeploymentSignalNormalize.CONFIDENCE_MAP);
  },

  /** @private */
  _normalizeSignalType_: function (value) {
    var raw = String(value || '').trim();
    if (!raw) return { normalized: '', raw: '' };
    var key = raw.toLowerCase().replace(/[\s\-/]+/g, ' ').trim();
    if (CoreDeploymentSignalNormalize.SIGNAL_TYPE_ALIASES[key]) {
      return {
        normalized: CoreDeploymentSignalNormalize.SIGNAL_TYPE_ALIASES[key],
        raw: raw
      };
    }
    var norm = raw.replace(/[\s\-/]+/g, '_').toUpperCase();
    return { normalized: norm, raw: raw };
  },

  /** @private */
  _normalizeToken_: function (value, map) {
    var raw = String(value || '').trim();
    if (!raw) return { normalized: '', raw: '' };
    var key = raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    if (map[key]) return { normalized: map[key], raw: raw };
    var upper = raw.replace(/[\s\-/]+/g, '_').toUpperCase();
    return { normalized: upper, raw: raw };
  },

  /** @private */
  _trimProse_: function (value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  },

  /** @private */
  _recordsFromSanaText_: function (text, batchId) {
    if (!CoreDeploymentSignalStage1Ingest) return [];
    var blocks = CoreDeploymentSignalStage1Ingest.parseBatchText(text, batchId);
    var out = [];
    blocks.forEach(function (block) {
      if (!block.is_signal) return;
      var fields = block.fields || {};
      out.push({
        deployment_id: block.deployment_id,
        attention: fields.Attention,
        signal_type: fields['Signal Type'],
        observation: fields.Observation,
        interpretation: fields.Interpretation,
        why_it_matters: fields['Why This Matters'] || fields['Why it matters'],
        leadership_question: fields['Leadership Question'],
        confidence: fields.Confidence,
        evidence_limitations: fields['Evidence Limitations'],
        reasoning_prose_original: block.raw_text
      });
    });
    return out;
  }
};
