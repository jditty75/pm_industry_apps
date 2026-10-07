/**
 * CoreDeploymentSignals.js
 *
 * Signal context assembly and substantive normalization (shared library production).
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
    var blocks = CoreDeploymentSignalNormalize._parseSanaBatchBlocks_(text, batchId);
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
  },

  /**
   * Parse verbatim Sana portfolio text blocks (production approved-run alternate input).
   * @private
   */
  _parseSanaBatchBlocks_: function (text, batchId) {
    text = String(text || '').replace(/\r\n/g, '\n');
    var blocks = text.split(/\n(?=(?:Deployment|DEPLOYMENT)\s*:)/i);
    var parsed = [];
    blocks.forEach(function (block, idx) {
      block = block.trim();
      if (!block) return;
      var isNo = /\bNO[_\s-]?SIGNAL\b/i.test(block) && !/Signal Type\s*:/i.test(block);
      var fields = CoreDeploymentSignalNormalize._parseSanaBlockFields_(block);
      var depMatch = block.match(/\b(a0r[a-zA-Z0-9]{12,18})\b/);
      var depId = depMatch ? depMatch[1] : '';
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

  /** @private */
  _parseSanaBlockFields_: function (block) {
    var fields = {};
    var currentKey = '';
    var lines = block.split('\n');
    lines.forEach(function (line) {
      var m = line.match(/^([A-Za-z][A-Za-z /_]+)\s*:\s*(.*)$/);
      if (m) {
        currentKey = m[1].trim();
        fields[currentKey] = m[2] ? m[2].trim() : '';
        return;
      }
      if (currentKey && line.trim()) {
        fields[currentKey] = (fields[currentKey] ? fields[currentKey] + '\n' : '') + line.trim();
      }
    });
    return fields;
  }
};

var CoreDeploymentSignalContext = {

  SCHEMA_VERSION: 'deployment-signal-context-v1',

  /**
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  isEnabled: function (appConfig) {
    return CoreDeploymentTrajectory.isEnabled(appConfig);
  },

  /**
   * Build one deployment context packet from a trajectory build item.
   *
   * @param {Object} item { row, healthEvents, mtpEvents }
   * @param {Object} options
   * @param {string} [options.todayStr] YYYY-MM-DD
   * @param {string} [options.logicalApp] e.g. SLG_DM
   * @param {Array<Object>} [options.actionHistoryIndex]
   * @param {Array<Object>} [options.actionNarratives] optional raw action rows
   * @return {Object}
   */
  buildFromTrajectoryItem: function (item, options) {
    options = options || {};
    var row = item.row || {};
    var healthEvents = item.healthEvents || [];
    var mtpEvents = item.mtpEvents || [];
    var todayStr = options.todayStr || CoreDeploymentSignalContext._todayStr_();
    var logicalApp = options.logicalApp || 'SLG_DM';

    return CoreDeploymentSignalContext._buildPacket_(
      row,
      healthEvents,
      mtpEvents,
      options.actionHistoryIndex || [],
      options.actionNarratives || [],
      todayStr,
      logicalApp);
  },

  /**
   * @param {AppConfig} appConfig
   * @param {string} deploymentId
   * @param {Object} [options]
   * @return {Object|null}
   */
  buildDeploymentSignalContext: function (appConfig, deploymentId, options) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentSignalContext.isEnabled(cfg)) {
      Logger.log('CoreDeploymentSignalContext.buildDeploymentSignalContext: disabled — skip.');
      return null;
    }
    var debug = CoreDeploymentTrajectory.debugForDeployment(cfg, deploymentId);
    if (!debug.deployment) {
      return null;
    }
    options = options || {};
    options.logicalApp = options.logicalApp || 'SLG_DM';
    return CoreDeploymentSignalContext.buildFromTrajectoryItem(debug.deployment, options);
  },

  /**
   * @param {AppConfig} appConfig
   * @param {Object} [options]
   * @return {Object}
   */
  buildDeploymentSignalPortfolioContext: function (appConfig, options) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    options = options || {};
    if (!CoreDeploymentSignalContext.isEnabled(cfg)) {
      Logger.log('CoreDeploymentSignalContext.buildDeploymentSignalPortfolioContext: disabled — skip.');
      return { skipped: true, packets: [] };
    }
    var bundle = CoreDeploymentTrajectory._buildContext_(cfg, null);
    var todayStr = options.todayStr || CoreDeploymentSignalContext._todayStr_();
    var logicalApp = options.logicalApp || 'SLG_DM';
    var indexByDep = CoreDeploymentSignalContext._indexActionHistory_(bundle.actionHistoryIndex || []);
    var packets = [];
    (bundle.deployments || []).forEach(function (item) {
      if (item.skipped || !item.row) return;
      var depId = item.row.deployment_id;
      packets.push(CoreDeploymentSignalContext._buildPacket_(
        item.row,
        item.healthEvents || [],
        item.mtpEvents || [],
        indexByDep[depId] || [],
        [],
        todayStr,
        logicalApp));
    });
    packets.sort(function (a, b) {
      return String(a.metadata.deployment_id).localeCompare(String(b.metadata.deployment_id));
    });
    return {
      skipped: false,
      snapshot_date: todayStr,
      packet_count: packets.length,
      packets: packets
    };
  },

  /**
   * Approximate UTF-8 byte size of JSON serialization.
   *
   * @param {Object} packet
   * @return {number}
   */
  approximatePacketByteSize: function (packet) {
    try {
      return JSON.stringify(packet).length;
    } catch (e) {
      return 0;
    }
  },

  /**
   * @param {Object} row trajectory row
   * @param {Array<Object>} healthEvents
   * @return {Object}
   */
  healthReconciliationContract: function (row, healthEvents) {
    healthEvents = healthEvents || [];
    var current = String(row.current_health || '').trim();
    var lastNew = '';
    if (healthEvents.length) {
      var last = healthEvents[healthEvents.length - 1];
      lastNew = String(last.new_health || '').trim();
    }
    var reconciled = !current || !lastNew ||
      current.toLowerCase() === lastNew.toLowerCase();
    var caveats = [];
    if (current && lastNew && !reconciled) {
      caveats.push(
        'current_health is live deployment state; last HealthEvents transition ended at ' +
        lastNew + ', not ' + current + '. Do not infer an unlisted transition.');
    }
    var daysSinceHistorized = null;
    var lastChange = String(row.health_last_change_date || '').trim();
    if (lastChange) {
      daysSinceHistorized = TrajectoryMetrics.signedDaysBetween(lastChange, row.trajectory_built_at ?
        String(row.trajectory_built_at).slice(0, 10) : CoreDeploymentSignalContext._todayStr_());
    }
    return {
      health_history_available: healthEvents.length > 0,
      health_last_event_new_health: lastNew,
      health_current_matches_last_event_new_health: reconciled,
      health_current_state_reconciled: reconciled,
      days_since_last_historized_health_change: daysSinceHistorized,
      verified_days_at_current_health: reconciled ? row.days_at_current_health : null,
      caveats: caveats
    };
  },

  /**
   * @param {Object} row
   * @param {Array<Object>} mtpEvents
   * @return {Object}
   */
  scheduleMovementContract: function (row, mtpEvents) {
    mtpEvents = mtpEvents || [];
    var parentTypes = {
      PARENT_TARGET_CHANGE: true,
      DEPLOYMENT_TARGET_CHANGE: true
    };
    var initialPop = 0;
    var validChanges = 0;
    mtpEvents.forEach(function (ev) {
      var t = String(ev.event_type || '');
      if (!parentTypes[t]) return;
      var oldD = String(ev.old_date || '').trim();
      var newD = String(ev.new_date || '').trim();
      if (!oldD && newD) initialPop++;
      if (oldD && newD && ev.movement_days !== null && ev.movement_days !== '') validChanges++;
    });
    return {
      field_semantics: {
        gross_movement_days_lifetime: 'Sum of abs(movement_days) on valid parent target changes.',
        net_movement_days_lifetime: 'Signed days earliest_recorded_mtp to current_mtp (valid changes only).',
        initial_target_population: 'Blank old_date with populated new_date — not target movement.',
        target_movement: 'Historized parent target changes with both dates.',
        actual_outcome: 'PARENT_ACTUAL_MTP / FUNCTION_ACTUAL_MTP — not target movement.'
      },
      mtp_net_movement_comparison: row.mtp_net_movement_comparison || '',
      earliest_recorded_mtp: row.earliest_recorded_mtp || '',
      baseline_mtp: row.baseline_mtp || '',
      current_mtp: row.current_mtp || '',
      mtp_gross_movement_days_lifetime: row.mtp_gross_movement_days,
      mtp_net_movement_days_lifetime: row.mtp_net_movement_days,
      initial_target_population_event_count: initialPop,
      valid_parent_target_change_event_count: validChanges
    };
  },

  /**
   * @param {Object} row
   * @return {Object}
   */
  productFunctionRollupReconciliation: function (row) {
    var count = CoreDeploymentSignalContext._asInt_(row.product_function_count);
    var completed = CoreDeploymentSignalContext._asInt_(row.functions_actual_mtp_count);
    var remaining = CoreDeploymentSignalContext._asInt_(row.functions_remaining_count);
    var reconciled = count <= 0 || (completed + remaining === count);
    return {
      product_function_count: count,
      functions_completed: completed,
      functions_remaining: remaining,
      product_function_rollup_reconciled: reconciled,
      product_function_target_history_available: false,
      product_function_target_history_note:
        'Product Function Production_Move_Date_Target__c history is UNAVAILABLE in the current extract; ' +
        'do not treat missing PF target movement as zero movement.'
    };
  },

  /**
   * @param {Object} row
   * @param {Object} intervention
   * @param {Object} healthContract
   * @return {{classification:string, factors:Array<string>}}
   */
  classifyEvidenceQuality: function (row, intervention, healthContract) {
    var factors = [];
    var warnings = String(row.build_warnings || '').trim();
    if (warnings) factors.push('build_warnings:' + warnings);
    var recon = String(row.parent_mtp_reconciliation_status || '');
    if (recon && recon !== 'MATCH' && recon !== 'NOT_APPLICABLE_PRODUCT_FUNCTION_GRAIN') {
      factors.push('parent_mtp_reconciliation:' + recon);
    }
    if (intervention && intervention.intervention_mismatch) {
      factors.push(String(intervention.intervention_mismatch));
    }
    if (healthContract && !healthContract.health_current_matches_last_event_new_health) {
      factors.push('health_summary_not_reconciled_with_current_health');
    }
    var pf = CoreDeploymentSignalContext.productFunctionRollupReconciliation(row);
    if (!pf.product_function_rollup_reconciled && pf.product_function_count > 0) {
      factors.push('product_function_rollup_not_reconciled');
    }
    if (!pf.product_function_target_history_available) {
      factors.push('product_function_target_history_unavailable');
    }
    var heCount = CoreDeploymentSignalContext._asInt_(row.health_event_count);
    if (heCount === 0 && String(row.previous_health || '').trim()) {
      factors.push('previous_health_without_health_events');
    }
    if (!factors.length) {
      return { classification: 'HIGH', factors: ['complete_trajectory_row_no_warnings'] };
    }
    if (factors.length <= 2 && factors.indexOf('INTERVENTION_EVIDENCE_MISMATCH') < 0 &&
        !String(factors.join('|')).match(/INTERVENTION_EVIDENCE_MISMATCH/)) {
      return { classification: 'MEDIUM', factors: factors };
    }
    return { classification: 'LOW', factors: factors };
  },

  /**
   * Deterministic narrative selection (no LLM).
   *
   * @param {Array<Object>} narratives
   * @param {string} todayStr
   * @param {number} [maxItems]
   * @return {Array<Object>}
   */
  selectActionNarratives: function (narratives, todayStr, maxItems) {
    maxItems = maxItems || 3;
    narratives = narratives || [];
    if (!narratives.length) return [];
    var cutoff90 = TrajectoryMetrics.dateMinusDays(todayStr, 90);
    var scored = narratives.map(function (a, idx) {
      var created = CoreDeploymentSignalContext._normalizeDate_(
        a.created_date || a.CreatedDate || a.createdDate || '');
      var health = String(a.health_status || a.Health_Status__c || '').trim();
      var text = String(
        a.narrative || a.Action_Description__c || a.Comments__c || a.Description || ''
      ).replace(/\s+/g, ' ').trim();
      if (text.length > 500) text = text.slice(0, 500);
      var score = 0;
      if (created >= cutoff90) score += 10;
      if (health) score += 5;
      score += Math.min(idx, 5);
      return {
        trace: {
          action_history_id: a.action_history_id || a.Id || '',
          dhp_id: a.dhp_id || a.Deployment_Health_Plan__c || '',
          source_sheet: a.source_sheet || 'SFDC_DHPActionHistory'
        },
        created_date: created,
        health_status: health,
        narrative_excerpt: text,
        _score: score
      };
    });
    scored.sort(function (a, b) {
      if (b._score !== a._score) return b._score - a._score;
      return (b.created_date || '').localeCompare(a.created_date || '');
    });
    return scored.slice(0, maxItems).map(function (item) {
      return {
        trace: item.trace,
        created_date: item.created_date,
        health_status: item.health_status,
        narrative_excerpt: item.narrative_excerpt
      };
    });
  },

  /**
   * @param {Array<Object>} events
   * @param {string} todayStr
   * @param {number} [limit]
   * @return {Array<Object>}
   */
  selectHealthEvents: function (events, todayStr, limit) {
    limit = limit || 12;
    events = events || [];
    var cutoff365 = TrajectoryMetrics.dateMinusDays(todayStr, 365);
    var recent = [];
    var older = [];
    events.forEach(function (ev) {
      var d = String(ev.event_date || '').slice(0, 10);
      var row = {
        trace: { event_index: ev.event_index, source_sheet: 'Deployment_Trajectory_HealthEvents' },
        event_date: d,
        old_health: ev.old_health,
        new_health: ev.new_health,
        transition_class: ev.transition_class
      };
      if (d >= cutoff365) recent.push(row);
      else older.push(row);
    });
    var pick = recent.length >= limit ? recent.slice(-limit) : recent.concat(older).slice(-limit);
    return pick;
  },

  /**
   * @param {Array<Object>} events
   * @param {number} [limit]
   * @return {Array<Object>}
   */
  selectMtpEvents: function (events, limit) {
    limit = limit || 12;
    events = events || [];
    var parentTypes = {
      PARENT_TARGET_CHANGE: true,
      DEPLOYMENT_TARGET_CHANGE: true,
      PARENT_ACTUAL_MTP: true
    };
    var parent = events.filter(function (ev) {
      return parentTypes[String(ev.event_type || '')];
    });
    var pool = parent.length ? parent : events.filter(function (ev) {
      return String(ev.event_type || '') !== 'FUNCTION_TARGET_CHANGE';
    });
    return pool.slice(-limit).map(function (ev) {
      return {
        trace: {
          event_type: ev.event_type,
          source_sheet: 'Deployment_Trajectory_MtpEvents',
          product_function_id: ev.product_function_id || ''
        },
        event_date: ev.event_date,
        event_type: ev.event_type,
        old_date: ev.old_date,
        new_date: ev.new_date,
        movement_days: ev.movement_days
      };
    });
  },

  /**
   * @param {Object} row
   * @param {Array<Object>} actionIndex
   * @return {Object}
   */
  interventionFacts: function (row, actionIndex) {
    actionIndex = actionIndex || [];
    return {
      has_open_health_plan: !!row.has_open_health_plan,
      dhp_count: CoreDeploymentSignalContext._asInt_(row.dhp_count),
      action_history_count: CoreDeploymentSignalContext._asInt_(row.action_history_record_count),
      action_history_index_row_count: actionIndex.length,
      action_history_latest_created_date: row.action_history_latest_created_date || '',
      days_since_action_history_update: row.days_since_action_history_update,
      action_history_latest_health_status: row.action_history_latest_health_status || '',
      dhp_latest_updated_date: row.dhp_latest_updated_date || '',
      days_since_dhp_update: row.days_since_dhp_update
    };
  },

  /**
   * @private
   */
  _buildPacket_: function (row, healthEvents, mtpEvents, actionIndex, actionNarratives,
    todayStr, logicalApp) {
    var healthContract = CoreDeploymentSignalContext.healthReconciliationContract(row, healthEvents);
    var schedContract = CoreDeploymentSignalContext.scheduleMovementContract(row, mtpEvents);
    var intervention = CoreDeploymentSignalContext.interventionFacts(row, actionIndex);
    var pf = CoreDeploymentSignalContext.productFunctionRollupReconciliation(row);
    var eq = CoreDeploymentSignalContext.classifyEvidenceQuality(row, {}, healthContract);
    var windows = CoreDeploymentSignalContext._evidenceWindows_(todayStr);

    var scheduleRecent90 = {
      target_changes: CoreDeploymentSignalContext._asInt_(row.mtp_changes_90d),
      slips: CoreDeploymentSignalContext._asInt_(row.mtp_slips_90d),
      accelerations: CoreDeploymentSignalContext._asInt_(row.mtp_accelerations_90d),
      function_target_changes: CoreDeploymentSignalContext._asInt_(row.function_target_changes_90d)
    };
    var scheduleRecent30 = {
      target_changes: CoreDeploymentSignalContext._asInt_(row.mtp_changes_30d),
      function_target_changes: CoreDeploymentSignalContext._asInt_(row.function_target_changes_30d)
    };
    var scheduleLifetime = {
      target_changes_total: CoreDeploymentSignalContext._asInt_(row.mtp_changes_total),
      gross_movement_days: row.mtp_gross_movement_days,
      net_movement_days: row.mtp_net_movement_days,
      mtp_event_count: CoreDeploymentSignalContext._asInt_(row.mtp_event_count)
    };

    var unavailable = [
      'product_function_target_date_history'
    ];
    if (!healthContract.health_history_available) {
      unavailable.push('health_event_history_sparse_or_empty');
    }

    return {
      schema_version: CoreDeploymentSignalContext.SCHEMA_VERSION,
      metadata: {
        generated_at: new Date().toISOString(),
        snapshot_date: todayStr,
        logical_app: logicalApp,
        industry_context: row.industry || '',
        deployment_id: row.deployment_id || '',
        deployment_label: row.deployment_name || '',
        evidence_windows: windows
      },
      current_state: {
        current_health: row.current_health,
        deployment_stage: row.current_stage,
        current_mtp: row.current_mtp,
        days_relative_to_mtp: row.days_until_current_mtp,
        priming_partner: row.priming_partner,
        implementation_partner: row.implementation_partner,
        mtp_analysis_grain: row.mtp_analysis_grain
      },
      health_trajectory: {
        current_health: row.current_health,
        previous_historized_health: row.previous_health,
        last_historized_health_change_date: row.health_last_change_date,
        days_since_last_historized_health_change: healthContract.days_since_last_historized_health_change,
        deteriorations_recent_90d: CoreDeploymentSignalContext._asInt_(row.health_deteriorations_90d),
        improvements_recent_90d: CoreDeploymentSignalContext._asInt_(row.health_improvements_90d),
        changes_recent_30d: CoreDeploymentSignalContext._asInt_(row.health_changes_30d),
        changes_recent_90d: CoreDeploymentSignalContext._asInt_(row.health_changes_90d),
        health_event_count: CoreDeploymentSignalContext._asInt_(row.health_event_count),
        reconciliation: healthContract,
        selected_events: CoreDeploymentSignalContext.selectHealthEvents(healthEvents, todayStr, 12)
      },
      schedule_trajectory: {
        recent_30d: scheduleRecent30,
        recent_90d: scheduleRecent90,
        historical_365d: {
          note: 'Use selected_events and lifetime metrics; do not treat lifetime gross as 90d movement.'
        },
        lifetime: scheduleLifetime,
        last_target_change_date: row.mtp_last_change_date,
        parent_reconciliation_status: row.parent_mtp_reconciliation_status,
        reconstructed_parent_effective_mtp: row.reconstructed_parent_effective_mtp,
        movement_contract: schedContract,
        selected_events: CoreDeploymentSignalContext.selectMtpEvents(mtpEvents, 12)
      },
      product_function: Object.assign({}, pf, {
        distinct_current_function_mtp_count: row.distinct_current_function_mtp_count,
        remaining_earliest_target_mtp: row.remaining_earliest_target_mtp,
        remaining_latest_target_mtp: row.remaining_latest_target_mtp,
        functions_late_vs_final_target_count: row.functions_late_vs_final_target_count
      }),
      intervention: Object.assign({}, intervention, {
        selected_narratives: CoreDeploymentSignalContext.selectActionNarratives(
          actionNarratives, todayStr, 3)
      }),
      evidence_quality: {
        classification: eq.classification,
        factors: eq.factors,
        unavailable_evidence: unavailable,
        build_warnings: row.build_warnings || ''
      },
      trace_references: {
        trajectory_schema_version: row.trajectory_schema_version,
        trajectory_built_at: row.trajectory_built_at,
        source_health_event_count: row.source_health_event_count,
        source_mtp_event_count: row.source_mtp_event_count
      }
    };
  },

  /** @private */
  _evidenceWindows_: function (todayStr) {
    return {
      recent_30d: {
        start: TrajectoryMetrics.dateMinusDays(todayStr, 30),
        end: todayStr
      },
      recent_90d: {
        start: TrajectoryMetrics.dateMinusDays(todayStr, 90),
        end: todayStr
      },
      historical_365d: {
        start: TrajectoryMetrics.dateMinusDays(todayStr, 365),
        end: TrajectoryMetrics.dateMinusDays(todayStr, 90)
      },
      lifetime: { start: null, end: todayStr }
    };
  },

  /** @private */
  _indexActionHistory_: function (rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      var id = String(r.deployment_id || '').trim();
      if (!id) return;
      if (!out[id]) out[id] = [];
      out[id].push(r);
    });
    return out;
  },

  /** @private */
  _todayStr_: function () {
    return new Date().toISOString().slice(0, 10);
  },

  /** @private */
  _asInt_: function (v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  },

  /** @private */
  _normalizeDate_: function (value) {
    if (!value) return '';
    var s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return '';
  }
};
