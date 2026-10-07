/**
 * Pilot-only deployment-signal-candidate-v1 helpers (not shipped in DepMngr runtime).
 * Mirrors historical Stage-1 ingest contract for regression tests.
 */

var Stage1CandidatePilot = {

  CANDIDATE_SCHEMA_VERSION: 'deployment-signal-candidate-v1',

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

  normalizeAttention: function (value) {
    return Stage1CandidatePilot._normalizeToken_(value, Stage1CandidatePilot.ATTENTION_MAP);
  },

  normalizeConfidence: function (value) {
    return Stage1CandidatePilot._normalizeToken_(value, Stage1CandidatePilot.CONFIDENCE_MAP);
  },

  parseBatchText: function (text, batchId) {
    return CoreDeploymentSignalNormalize._parseSanaBatchBlocks_(text, batchId);
  },

  buildNormalizedCandidate: function (block, depId, contextRef, checksum) {
    var fields = block.fields || {};
    var att = Stage1CandidatePilot.normalizeAttention(fields.Attention || '');
    var conf = Stage1CandidatePilot.normalizeConfidence(fields.Confidence || '');
    var typeRaw = String(fields['Signal Type'] || '').trim();
    var typeNorm = typeRaw ? typeRaw.replace(/[\s\-/]+/g, '_').toUpperCase() : '';
    return {
      schema_version: Stage1CandidatePilot.CANDIDATE_SCHEMA_VERSION,
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

  _normalizeToken_: function (value, map) {
    var raw = String(value || '').trim();
    if (!raw) return { normalized: '', raw: '' };
    var key = raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    if (map[key]) return { normalized: map[key], raw: raw };
    return { normalized: raw.replace(/[\s\-/]+/g, '_').toUpperCase(), raw: raw };
  }
};

module.exports = { Stage1CandidatePilot };
