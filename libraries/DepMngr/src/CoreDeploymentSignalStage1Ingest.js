/**
 * CoreDeploymentSignalStage1Ingest.js
 *
 * Parse/normalize verbatim Stage-1 Sana portfolio outputs (deterministic, no LLM).
 */

var CoreDeploymentSignalStage1Ingest = {

  CANDIDATE_SCHEMA_VERSION: 'deployment-signal-candidate-v1',
  EXPECTED_CANDIDATE_COUNT: 17,

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

  /**
   * @param {string} value
   * @return {{normalized:string, raw:string}}
   */
  normalizeAttention: function (value) {
    return CoreDeploymentSignalStage1Ingest._normalizeToken_(value, CoreDeploymentSignalStage1Ingest.ATTENTION_MAP);
  },

  /**
   * @param {string} value
   * @return {{normalized:string, raw:string}}
   */
  normalizeConfidence: function (value) {
    return CoreDeploymentSignalStage1Ingest._normalizeToken_(value, CoreDeploymentSignalStage1Ingest.CONFIDENCE_MAP);
  },

  /**
   * @param {string} text
   * @param {string} batchId
   * @return {Array<Object>}
   */
  parseBatchText: function (text, batchId) {
    text = String(text || '').replace(/\r\n/g, '\n');
    var blocks = text.split(/\n(?=(?:Deployment|DEPLOYMENT)\s*:)/i);
    var parsed = [];
    blocks.forEach(function (block, idx) {
      block = block.trim();
      if (!block) return;
      var isNo = /\bNO[_\s-]?SIGNAL\b/i.test(block) && !/Signal Type\s*:/i.test(block);
      var fields = CoreDeploymentSignalStage1Ingest._parseFields_(block);
      var depId = CoreDeploymentSignalStage1Ingest._extractDeploymentId_(block);
      var isSignal = !isNo && (fields['Signal Type'] || fields.Observation);
      parsed.push({
        raw_text: block,
        is_signal: !!isSignal,
        fields: fields,
        deployment_id: depId,
        batch_id: batchId,
        position_in_batch: idx + 1
      });
    });
    return parsed;
  },

  /**
   * @param {Object} block parsed block
   * @param {string} depId
   * @param {string} contextRef
   * @param {string} checksum
   * @return {Object}
   */
  buildNormalizedCandidate: function (block, depId, contextRef, checksum) {
    var fields = block.fields || {};
    var att = CoreDeploymentSignalStage1Ingest.normalizeAttention(fields.Attention || '');
    var conf = CoreDeploymentSignalStage1Ingest.normalizeConfidence(fields.Confidence || '');
    var typeRaw = String(fields['Signal Type'] || '').trim();
    var typeNorm = typeRaw ? typeRaw.replace(/[\s\-/]+/g, '_').toUpperCase() : '';
    return {
      schema_version: CoreDeploymentSignalStage1Ingest.CANDIDATE_SCHEMA_VERSION,
      identity: {
        deployment_id: depId,
        context_packet_ref: contextRef,
        stage1_batch: block.batch_id,
        stage1_position: block.position_in_batch,
        source_checksum: checksum
      },
      stage1_assessment: {
        attention: att.normalized,
        attention_raw: att.raw,
        signal_type: typeNorm,
        signal_type_raw: typeRaw,
        observation: fields.Observation || '',
        historical_evidence: fields['Historical Evidence'] || '',
        interpretation: fields.Interpretation || '',
        why_this_matters: fields['Why This Matters'] || '',
        leadership_question: fields['Leadership Question'] || '',
        confidence: conf.normalized,
        confidence_raw: conf.raw,
        evidence_limitations: fields['Evidence Limitations'] || ''
      },
      stage1_raw_text: block.raw_text
    };
  },

  /** @private */
  _normalizeToken_: function (value, map) {
    var raw = String(value || '').trim();
    if (!raw) return { normalized: '', raw: '' };
    var key = raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    if (map[key]) return { normalized: map[key], raw: raw };
    return { normalized: raw.replace(/[\s\-/]+/g, '_').toUpperCase(), raw: raw };
  },

  /** @private */
  _parseFields_: function (block) {
    var fields = {};
    var currentKey = '';
    var lines = block.split('\n');
    lines.forEach(function (line) {
      var m = line.match(/^([A-Za-z][A-Za-z /_]+)\s*:\s*(.*)$/);
      if (m) {
        currentKey = m[1].trim();
        if (m[2]) fields[currentKey] = m[2].trim();
        else fields[currentKey] = '';
        return;
      }
      if (currentKey && line.trim()) {
        fields[currentKey] = (fields[currentKey] ? fields[currentKey] + '\n' : '') + line.trim();
      }
    });
    return fields;
  },

  /** @private */
  _extractDeploymentId_: function (block) {
    var m = block.match(/\b(a0r[a-zA-Z0-9]{12,18})\b/);
    return m ? m[1] : '';
  }
};
