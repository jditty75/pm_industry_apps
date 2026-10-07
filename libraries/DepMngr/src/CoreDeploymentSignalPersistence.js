/**
 * CoreDeploymentSignalPersistence.js
 *
 * Approved weekly Signal persistence, lifecycle, and read APIs (SLG only).
 */

var CoreDeploymentSignalPersistence = {

  /**
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  isEnabled: function (appConfig) {
    return CoreDeploymentSignalNormalize.isEnabled(appConfig);
  },

  /**
   * Idempotent sheet provisioning (headers only; preserves body data).
   *
   * @param {AppConfig} appConfig
   * @return {{ sheets: Array<string> }}
   */
  initializeSignalSheets: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    CoreDeploymentSignalPersistence._assertSlgPersistence_(cfg);
    var sig = cfg.deploymentSignal;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log('CoreDeploymentSignalPersistence.initializeSignalSheets: workbook resolved');
    var names = [
      sig.signalsSheetName,
      sig.signalHistorySheetName,
      sig.signalRunsSheetName
    ];
    var specs = [
      { label: 'Deployment_Signals', name: sig.signalsSheetName,
        headers: CoreDeploymentSignalStore.currentHeaders() },
      { label: 'Deployment_Signal_History', name: sig.signalHistorySheetName,
        headers: CoreDeploymentSignalStore.historyHeaders() },
      { label: 'Deployment_Signal_Runs', name: sig.signalRunsSheetName,
        headers: CoreDeploymentSignalStore.runHeaders() }
    ];
    specs.forEach(function (spec) {
      CoreDeploymentSignalStore.ensureSheetHeaders(ss, spec.name, spec.headers);
      Logger.log('CoreDeploymentSignalPersistence.initializeSignalSheets: ' +
        spec.label + ' initialized');
    });
    Logger.log('CoreDeploymentSignalPersistence.initializeSignalSheets: initialization PASS');
    return { sheets: names };
  },

  /**
   * Sole supported write path for approved weekly Signal output.
   *
   * @param {AppConfig} appConfig
   * @param {Object} runInput
   * @param {Object=} options { validDeploymentIds: Set|Array, store: in-memory store for tests }
   * @return {Object}
   */
  persistApprovedSlgSignalRun: function (appConfig, runInput, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    CoreDeploymentSignalPersistence._assertSlgPersistence_(cfg);
    runInput = runInput || {};

    var signalRunId = String(runInput.signal_run_id || runInput.signalRunId || '').trim();
    if (!signalRunId) {
      return CoreDeploymentSignalPersistence._fail_('signal_run_id required for idempotency');
    }

    var sig = cfg.deploymentSignal;
    var sheetNames = {
      current: sig.signalsSheetName,
      history: sig.signalHistorySheetName,
      runs: sig.signalRunsSheetName
    };

    if (options.store) {
      return CoreDeploymentSignalPersistence._persistToStore_(
        cfg, runInput, options, sheetNames, signalRunId);
    }

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) {
      return CoreDeploymentSignalPersistence._fail_('could not acquire document lock');
    }
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      CoreDeploymentSignalPersistence.initializeSignalSheets(cfg);
      var runsSheet = ss.getSheetByName(sheetNames.runs);
      var priorRuns = CoreDeploymentSignalStore.readDataRows(
        runsSheet, CoreDeploymentSignalStore.runHeaders());
      var existing = priorRuns.filter(function (r) {
        return String(r.signal_run_id) === signalRunId &&
          String(r.run_status) === CoreDeploymentSignalStore.RUN_STATUS_COMPLETE;
      })[0];
      if (existing) {
        return {
          ok: true,
          idempotentReplay: true,
          signal_run_id: signalRunId,
          run: existing
        };
      }

      var result = CoreDeploymentSignalPersistence._executePersist_(
        cfg, runInput, options, sheetNames, signalRunId, {
          readCurrent: function () {
            var sh = ss.getSheetByName(sheetNames.current);
            return CoreDeploymentSignalStore.readDataRows(
              sh, CoreDeploymentSignalStore.currentHeaders());
          },
          writeCurrent: function (rows) {
            var sh = ss.getSheetByName(sheetNames.current);
            CoreDeploymentSignalStore.replaceCurrentBody(
              sh, CoreDeploymentSignalStore.currentHeaders(), rows);
          },
          appendHistory: function (rows) {
            var sh = ss.getSheetByName(sheetNames.history);
            CoreDeploymentSignalStore.appendBodyRows(
              sh, CoreDeploymentSignalStore.historyHeaders(), rows);
          },
          appendRun: function (row) {
            var sh = ss.getSheetByName(sheetNames.runs);
            CoreDeploymentSignalStore.appendBodyRows(
              sh, CoreDeploymentSignalStore.runHeaders(), [row]);
          },
          updateRunStatus: function (row) {
            CoreDeploymentSignalStore.appendBodyRows(
              runsSheet, CoreDeploymentSignalStore.runHeaders(), [row]);
          }
        });

      return result;
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence.persistApprovedSlgSignalRun: ' + err);
      return CoreDeploymentSignalPersistence._fail_(String(err));
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * @param {AppConfig} appConfig
   * @param {Object=} options { deploymentId, activeOnly }
   * @return {Array<Object>}
   */
  getCurrentSlgDeploymentSignals: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentSignalPersistence.isEnabled(cfg)) return [];
    var rows = CoreDeploymentSignalPersistence._readCurrentRows_(cfg, options.store);
    var depFilter = String(options.deploymentId || '').trim();
    var activeOnly = options.activeOnly !== false;
    return rows.filter(function (r) {
      if (activeOnly && r.signal_status !== 'ACTIVE') return false;
      if (depFilter && String(r.deployment_id) !== depFilter) return false;
      return true;
    });
  },

  /**
   * @param {AppConfig} appConfig
   * @param {Object=} options { deploymentId, signalRunId, limit }
   * @return {Array<Object>}
   */
  getSlgDeploymentSignalHistory: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentSignalPersistence.isEnabled(cfg)) return [];
    var rows = CoreDeploymentSignalPersistence._readHistoryRows_(cfg, options.store);
    var depFilter = String(options.deploymentId || '').trim();
    var runFilter = String(options.signalRunId || '').trim();
    var limit = options.limit != null ? options.limit : 500;
    var out = rows.filter(function (r) {
      if (depFilter && String(r.deployment_id) !== depFilter) return false;
      if (runFilter && String(r.signal_run_id) !== runFilter) return false;
      return true;
    });
    if (out.length > limit) {
      out = out.slice(out.length - limit);
    }
    return out;
  },

  /**
   * @param {AppConfig} appConfig
   * @param {Object=} options
   * @return {Object|null}
   */
  getLatestApprovedSlgSignalRun: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentSignalPersistence.isEnabled(cfg)) return null;
    var rows = CoreDeploymentSignalPersistence._readRunRows_(cfg, options.store);
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i].run_status) === CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
        return rows[i];
      }
    }
    return null;
  },

  /**
   * @param {Object} runRow
   * @param {Array<Object>} signalRows
   * @param {Object} validIds map deploymentId -> true
   * @return {{ ok: boolean, errors: Array<string> }}
   */
  validateSubmittedSignalRunUnit: function (runRow, signalRows, validIds) {
    var errors = [];
    runRow = runRow || {};
    signalRows = signalRows || [];
    var runId = String(runRow.signal_run_id || '').trim();
    if (!runId) errors.push('signal_run_id required');

    var asOf = String(runRow.signal_as_of || '').trim();
    if (!asOf || isNaN(Date.parse(asOf))) {
      errors.push('signal_as_of invalid');
    }

    var evaluated = parseInt(runRow.deployments_evaluated, 10);
    var proposed = parseInt(runRow.signals_proposed, 10);
    var noSignal = parseInt(runRow.no_signal_count, 10);
    if (isNaN(evaluated) || evaluated < 0) errors.push('deployments_evaluated invalid');
    if (isNaN(proposed) || proposed < 0) errors.push('signals_proposed invalid');
    if (isNaN(noSignal) || noSignal < 0) errors.push('no_signal_count invalid');
    if (!isNaN(evaluated) && !isNaN(proposed) && !isNaN(noSignal) &&
        proposed + noSignal !== evaluated) {
      errors.push('signals_proposed + no_signal_count must equal deployments_evaluated');
    }

    var submittedSignals = signalRows.filter(function (r) {
      return String(r.signal_run_id || '').trim() === runId &&
        String(r.signal_status || '').trim() ===
          CoreDeploymentSignalStore.SIGNAL_STATUS_SUBMITTED;
    });
    if (submittedSignals.length !== proposed) {
      errors.push('submitted signal row count mismatch');
    }

    var identitySeen = {};
    submittedSignals.forEach(function (row, idx) {
      if (String(row.signal_run_id || '').trim() !== runId) {
        errors.push('signal row[' + idx + '] run id mismatch');
      }
      var dep = CoreData.canonicalDeploymentId(row.deployment_id);
      if (!dep || !validIds[dep]) {
        errors.push('signal row[' + idx + ']: invalid deployment_id');
      }
      var key = CoreDeploymentSignalNormalize.identityKey(dep, row.signal_type);
      if (identitySeen[key]) {
        errors.push('duplicate identity in submitted set: ' + key);
      }
      identitySeen[key] = true;
      var norm = CoreDeploymentSignalNormalize.normalizeSubstantiveRecord(
        CoreDeploymentSignalPersistence._submittedRowToRecord_(row));
      if (!norm.ok) {
        errors.push('signal row[' + idx + ']: ' + norm.errors.join('; '));
      }
    });

    return { ok: errors.length === 0, errors: errors };
  },

  /**
   * Process all pending SUBMITTED runs in chronological order.
   *
   * @param {AppConfig} appConfig
   * @param {Object=} options
   * @return {Object}
   */
  processSubmittedSlgSignalRuns: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentSignalPersistence.isEnabled(cfg)) {
      return { ok: true, processed: [], skipped: true, reason: 'disabled' };
    }

    if (options.store) {
      return CoreDeploymentSignalPersistence._processSubmittedStore_(cfg, options);
    }

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) {
      return { ok: false, error: 'could not acquire document lock' };
    }
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      CoreDeploymentSignalPersistence.initializeSignalSheets(cfg);
      var sig = cfg.deploymentSignal;
      var runsSheet = ss.getSheetByName(sig.signalRunsSheetName);
      var signalsSheet = ss.getSheetByName(sig.signalsSheetName);
      var historySheet = ss.getSheetByName(sig.signalHistorySheetName);
      var runRows = CoreDeploymentSignalStore.readDataRows(
        runsSheet, CoreDeploymentSignalStore.runHeaders());
      var signalRows = CoreDeploymentSignalStore.readDataRows(
        signalsSheet, CoreDeploymentSignalStore.currentHeaders());
      var historyRows = CoreDeploymentSignalStore.readDataRows(
        historySheet, CoreDeploymentSignalStore.historyHeaders());

      return CoreDeploymentSignalPersistence._processSubmittedRows_(
        cfg, runRows, signalRows, historyRows, {
          writeCurrent: function (rows) {
            CoreDeploymentSignalStore.replaceCurrentBody(
              signalsSheet, CoreDeploymentSignalStore.currentHeaders(), rows);
          },
          appendHistory: function (rows) {
            CoreDeploymentSignalStore.appendBodyRows(
              historySheet, CoreDeploymentSignalStore.historyHeaders(), rows);
          },
          updateRun: function (runId, patch) {
            CoreDeploymentSignalStore.updateRunRowBySignalRunId(
              runsSheet, CoreDeploymentSignalStore.runHeaders(), runId, patch);
          },
          readHistory: function () {
            return CoreDeploymentSignalStore.readDataRows(
              historySheet, CoreDeploymentSignalStore.historyHeaders());
          }
        }, options);
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence.processSubmittedSlgSignalRuns: ' + err);
      return { ok: false, error: String(err) };
    } finally {
      lock.releaseLock();
    }
  },

  /** @private */
  _processSubmittedStore_: function (cfg, options) {
    var store = options.store;
    var sig = cfg.deploymentSignal;
    var runRows = CoreDeploymentSignalStore.readBody(store, sig.signalRunsSheetName);
    var signalRows = CoreDeploymentSignalStore.readBody(store, sig.signalsSheetName);
    var historyRows = CoreDeploymentSignalStore.readBody(store, sig.signalHistorySheetName);
    return CoreDeploymentSignalPersistence._processSubmittedRows_(
      cfg, runRows, signalRows, historyRows, {
        writeCurrent: function (rows) {
          CoreDeploymentSignalStore.replaceBody(
            store, sig.signalsSheetName,
            CoreDeploymentSignalStore.currentHeaders(), rows);
        },
        appendHistory: function (rows) {
          var existing = CoreDeploymentSignalStore.readBody(
            store, sig.signalHistorySheetName);
          var has = {};
          existing.forEach(function (h) {
            has[h.signal_run_id + '|' + h.deployment_id + '|' + h.history_event_type] = true;
          });
          var toAppend = (rows || []).filter(function (r) {
            var k = r.signal_run_id + '|' + r.deployment_id + '|' + r.history_event_type;
            return !has[k];
          });
          CoreDeploymentSignalStore.appendRows(
            store, sig.signalHistorySheetName,
            CoreDeploymentSignalStore.historyHeaders(), toAppend);
        },
        updateRun: function (runId, patch) {
          var rows = CoreDeploymentSignalStore.readBody(store, sig.signalRunsSheetName);
          for (var i = rows.length - 1; i >= 0; i--) {
            if (String(rows[i].signal_run_id) === runId) {
              rows[i] = Object.assign({}, rows[i], patch);
              break;
            }
          }
          CoreDeploymentSignalStore.replaceBody(
            store, sig.signalRunsSheetName,
            CoreDeploymentSignalStore.runHeaders(), rows);
        },
        readHistory: function () {
          return CoreDeploymentSignalStore.readBody(store, sig.signalHistorySheetName);
        }
      }, options);
  },

  /** @private */
  _processSubmittedRows_: function (cfg, runRows, signalRows, historyRows, io, options) {
    options = options || {};
    var pending = CoreDeploymentSignalPersistence._pendingSubmittedRuns_(runRows);
    if (!pending.length) {
      return { ok: true, processed: [], outcome: 'NO_SUBMITTED_RUNS' };
    }

    pending.sort(function (a, b) {
      var da = Date.parse(a.signal_as_of) || 0;
      var db = Date.parse(b.signal_as_of) || 0;
      if (da !== db) return da - db;
      return String(a.signal_run_id).localeCompare(String(b.signal_run_id));
    });

    var validIds = CoreDeploymentSignalPersistence._resolveValidDeploymentIds_(cfg, options);
    var processed = [];
    var priorCurrent = signalRows.filter(function (r) {
      return String(r.signal_status) !== CoreDeploymentSignalStore.SIGNAL_STATUS_SUBMITTED;
    });

    for (var i = 0; i < pending.length; i++) {
      var runRow = pending[i];
      var runId = String(runRow.signal_run_id).trim();
      var latest = CoreDeploymentSignalStore.findLatestRunRow(runRows, runId);
      if (latest && String(latest.run_status) === CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
        processed.push({ signal_run_id: runId, idempotentReplay: true });
        continue;
      }

      var validation = CoreDeploymentSignalPersistence.validateSubmittedSignalRunUnit(
        runRow, signalRows, validIds);
      if (!validation.ok) {
        var validationErr = validation.errors.join('; ');
        CoreDeploymentSignalPersistence._tryUpdateRunFailed_(
          io, runId, validationErr);
        return {
          ok: false,
          error: validationErr,
          failed_run_id: runId,
          processed: processed
        };
      }

      var submittedForRun = signalRows.filter(function (r) {
        return String(r.signal_run_id) === runId &&
          String(r.signal_status) === CoreDeploymentSignalStore.SIGNAL_STATUS_SUBMITTED;
      });
      var records = submittedForRun.map(function (row) {
        return CoreDeploymentSignalPersistence._submittedRowToRecord_(row);
      });

      var runInput = {
        signal_run_id: runId,
        signal_as_of: runRow.signal_as_of,
        deployments_evaluated: runRow.deployments_evaluated,
        signals_proposed: runRow.signals_proposed,
        no_signal_count: runRow.no_signal_count,
        source_reasoning_run_ref: runRow.source_reasoning_run_ref,
        context_schema_version: runRow.context_schema_version,
        agent_reference: runRow.agent_reference,
        received_at: runRow.received_at || runRow.started_at,
        records: records
      };

      var historyForRun = (historyRows || []).filter(function (h) {
        return String(h.signal_run_id) === runId;
      });
      var skipHistory = historyForRun.length > 0;

      var result = CoreDeploymentSignalPersistence._executeSubmittedPersist_(
        cfg, runInput, {
          priorCurrent: priorCurrent,
          skipHistoryAppend: skipHistory,
          io: io
        }, options);

      if (!result.ok) {
        var persistErr = result.error || 'persist failed';
        CoreDeploymentSignalPersistence._tryUpdateRunFailed_(io, runId, persistErr);
        return { ok: false, error: persistErr, failed_run_id: runId, processed: processed };
      }

      var emailHandoff = CoreNotify.applyDeploymentSignalPostCompleteHandoff(
        cfg, result.run, result.current || [], { dryRun: true });
      io.updateRun(runId, {
        signals_persisted: result.signals_persisted,
        lifecycle_new_count: (result.lifecycle_counts && result.lifecycle_counts.NEW) || 0,
        lifecycle_continuing_count:
          (result.lifecycle_counts && result.lifecycle_counts.CONTINUING) || 0,
        lifecycle_escalated_count:
          (result.lifecycle_counts && result.lifecycle_counts.ESCALATED) || 0,
        lifecycle_de_escalated_count:
          (result.lifecycle_counts && result.lifecycle_counts.DE_ESCALATED) || 0,
        lifecycle_resolved_count:
          (result.lifecycle_counts && result.lifecycle_counts.RESOLVED) || 0,
        persisted_at: result.run.persisted_at,
        run_status: CoreDeploymentSignalStore.RUN_STATUS_COMPLETE,
        persistence_status: 'COMPLETE',
        normalization_version: CoreDeploymentSignalStore.NORMALIZATION_VERSION,
        error_message: '',
        email_status: emailHandoff.email_status
      });

      priorCurrent = result.current || [];
      processed.push({
        signal_run_id: runId,
        lifecycle_counts: result.lifecycle_counts,
        signals_persisted: result.signals_persisted,
        email_status: emailHandoff.email_status
      });
    }

    return { ok: true, processed: processed };
  },

  /** @private */
  _pendingSubmittedRuns_: function (runRows) {
    var ids = {};
    (runRows || []).forEach(function (row) {
      var id = String(row.signal_run_id || '').trim();
      if (id) ids[id] = true;
    });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var row = CoreDeploymentSignalStore.findLatestRunRow(runRows, id);
      if (!row) return;
      var status = String(row.run_status || '').trim();
      var persist = String(row.persistence_status || '').trim();
      if (status === CoreDeploymentSignalStore.RUN_STATUS_SUBMITTED &&
          persist === 'SUBMITTED') {
        out.push(row);
      }
    });
    return out;
  },

  /** @private */
  _submittedRowToRecord_: function (row) {
    return {
      deployment_id: row.deployment_id,
      attention: row.attention,
      signal_type: row.signal_type,
      observation: row.observation,
      interpretation: row.interpretation,
      why_it_matters: row.why_it_matters,
      leadership_question: row.leadership_question,
      confidence: row.confidence,
      evidence_limitations: row.evidence_limitations,
      context_ref: row.context_ref,
      reasoning_prose_original: row.reasoning_prose_original,
      current_health: row.current_health,
      stage: row.stage
    };
  },

  /** @private */
  _executePersist_: function (cfg, runInput, options, sheetNames, signalRunId, io) {
    var nowIso = new Date().toISOString();
    var receivedAt = runInput.received_at || runInput.receivedAt || nowIso;
    var signalAsOf = runInput.signal_as_of || runInput.signalAsOf ||
      nowIso.slice(0, 10);

    var norm = CoreDeploymentSignalNormalize.normalizeApprovedRun(runInput, options);
    if (!norm.ok) {
      return CoreDeploymentSignalPersistence._fail_(norm.errors.join('; '));
    }

    var validIds = CoreDeploymentSignalPersistence._resolveValidDeploymentIds_(cfg, options);
    var identityErrors = [];
    norm.records.forEach(function (rec, idx) {
      var id = CoreData.canonicalDeploymentId(rec.deployment_id);
      rec.deployment_id = id;
      if (!validIds[id]) {
        identityErrors.push('record[' + idx + ']: unknown deployment ' + id);
      }
    });
    if (identityErrors.length) {
      return CoreDeploymentSignalPersistence._fail_(identityErrors.join('; '));
    }

    var priorCurrent = io.readCurrent();
    priorCurrent.forEach(function (row) {
      if (!row.identity_key && row.deployment_id && row.signal_type) {
        row.identity_key = CoreDeploymentSignalNormalize.identityKey(
          row.deployment_id, row.signal_type);
      }
    });

    var runMeta = {
      signal_run_id: signalRunId,
      signal_as_of: signalAsOf,
      source_reasoning_run_ref: String(
        runInput.source_reasoning_run_ref || runInput.reasoningRunRef || '').trim(),
      context_schema_version: String(
        runInput.context_schema_version || 'deployment-signal-context-v1').trim(),
      agent_reference: String(runInput.agent_reference || '').trim()
    };

    var plan = CoreDeploymentSignalLifecycle.buildPlan({
      priorCurrent: priorCurrent,
      incomingRecords: norm.records,
      runMeta: runMeta,
      timestamps: { receivedAt: receivedAt, persistedAt: nowIso },
      makeSignalId: function (key) {
        return CoreDeploymentSignalPersistence._newSignalId_(key);
      }
    });

    var inProgressRun = CoreDeploymentSignalPersistence._buildRunRow_({
      signal_run_id: signalRunId,
      signal_as_of: signalAsOf,
      started_at: receivedAt,
      received_at: receivedAt,
      persisted_at: '',
      deployments_evaluated: runInput.deployments_evaluated || 0,
      signals_proposed: norm.meta.proposed_count || norm.records.length,
      signals_persisted: 0,
      no_signal_count: runInput.no_signal_count || 0,
      lifecycleCounts: {},
      run_status: CoreDeploymentSignalStore.RUN_STATUS_IN_PROGRESS,
      persistence_status: 'WRITING',
      context_schema_version: runMeta.context_schema_version,
      agent_reference: runMeta.agent_reference,
      source_reasoning_run_ref: runMeta.source_reasoning_run_ref,
      error_message: ''
    });
    io.appendRun(inProgressRun);

    try {
      io.appendHistory(plan.historyEvents);
      io.writeCurrent(plan.nextCurrent);
      var completeRun = CoreDeploymentSignalPersistence._buildRunRow_({
        signal_run_id: signalRunId,
        signal_as_of: signalAsOf,
        started_at: receivedAt,
        received_at: receivedAt,
        persisted_at: nowIso,
        deployments_evaluated: runInput.deployments_evaluated || 0,
        signals_proposed: norm.meta.proposed_count || norm.records.length,
        signals_persisted: plan.signalsPersisted,
        no_signal_count: runInput.no_signal_count || 0,
        lifecycleCounts: plan.lifecycleCounts,
        run_status: CoreDeploymentSignalStore.RUN_STATUS_COMPLETE,
        persistence_status: 'COMPLETE',
        context_schema_version: runMeta.context_schema_version,
        agent_reference: runMeta.agent_reference,
        source_reasoning_run_ref: runMeta.source_reasoning_run_ref,
        error_message: ''
      });
      io.updateRunStatus(completeRun);
      return {
        ok: true,
        idempotentReplay: false,
        signal_run_id: signalRunId,
        signals_persisted: plan.signalsPersisted,
        lifecycle_counts: plan.lifecycleCounts,
        resolutions: plan.resolutions,
        run: completeRun
      };
    } catch (writeErr) {
      var failedRun = CoreDeploymentSignalPersistence._buildRunRow_({
        signal_run_id: signalRunId,
        signal_as_of: signalAsOf,
        started_at: receivedAt,
        received_at: receivedAt,
        persisted_at: nowIso,
        deployments_evaluated: runInput.deployments_evaluated || 0,
        signals_proposed: norm.meta.proposed_count || norm.records.length,
        signals_persisted: 0,
        no_signal_count: runInput.no_signal_count || 0,
        lifecycleCounts: {},
        run_status: CoreDeploymentSignalStore.RUN_STATUS_FAILED,
        persistence_status: 'FAILED',
        context_schema_version: runMeta.context_schema_version,
        agent_reference: runMeta.agent_reference,
        source_reasoning_run_ref: runMeta.source_reasoning_run_ref,
        error_message: String(writeErr)
      });
      io.updateRunStatus(failedRun);
      return CoreDeploymentSignalPersistence._fail_(String(writeErr));
    }
  },

  /**
   * Persist a Sana SUBMITTED run already present in workbook sheets (no new run append).
   *
   * @param {AppConfig} cfg
   * @param {Object} runInput
   * @param {Object} ctx { priorCurrent, skipHistoryAppend, io }
   * @param {Object=} options
   * @return {Object}
   * @private
   */
  _executeSubmittedPersist_: function (cfg, runInput, ctx, options) {
    options = options || {};
    ctx = ctx || {};
    var nowIso = new Date().toISOString();
    var signalRunId = String(runInput.signal_run_id || '').trim();
    var receivedAt = runInput.received_at || runInput.receivedAt || nowIso;
    var signalAsOf = runInput.signal_as_of || runInput.signalAsOf ||
      nowIso.slice(0, 10);

    var proposedCount = parseInt(runInput.signals_proposed, 10);
    var norm;
    if (proposedCount === 0) {
      norm = {
        ok: true,
        records: [],
        errors: [],
        meta: { proposed_count: 0, normalized_count: 0 }
      };
    } else {
      norm = CoreDeploymentSignalNormalize.normalizeApprovedRun(runInput, options);
      if (!norm.ok) {
        return CoreDeploymentSignalPersistence._fail_(norm.errors.join('; '));
      }
    }

    var validIds = CoreDeploymentSignalPersistence._resolveValidDeploymentIds_(cfg, options);
    var identityErrors = [];
    norm.records.forEach(function (rec, idx) {
      var id = CoreData.canonicalDeploymentId(rec.deployment_id);
      rec.deployment_id = id;
      if (!validIds[id]) {
        identityErrors.push('record[' + idx + ']: unknown deployment ' + id);
      }
    });
    if (identityErrors.length) {
      return CoreDeploymentSignalPersistence._fail_(identityErrors.join('; '));
    }

    var priorCurrent = (ctx.priorCurrent || []).filter(function (row) {
      return String(row.signal_status) !== CoreDeploymentSignalStore.SIGNAL_STATUS_SUBMITTED;
    });
    priorCurrent.forEach(function (row) {
      if (!row.identity_key && row.deployment_id && row.signal_type) {
        row.identity_key = CoreDeploymentSignalNormalize.identityKey(
          row.deployment_id, row.signal_type);
      }
    });

    var runMeta = {
      signal_run_id: signalRunId,
      signal_as_of: signalAsOf,
      source_reasoning_run_ref: String(
        runInput.source_reasoning_run_ref || runInput.reasoningRunRef || '').trim(),
      context_schema_version: String(
        runInput.context_schema_version || 'deployment-signal-context-v1').trim(),
      agent_reference: String(runInput.agent_reference || '').trim()
    };

    var plan = CoreDeploymentSignalLifecycle.buildPlan({
      priorCurrent: priorCurrent,
      incomingRecords: norm.records,
      runMeta: runMeta,
      timestamps: { receivedAt: receivedAt, persistedAt: nowIso },
      makeSignalId: function (key) {
        return CoreDeploymentSignalPersistence._newSignalId_(key);
      }
    });

    try {
      if (!ctx.skipHistoryAppend) {
        ctx.io.appendHistory(plan.historyEvents);
      }
      ctx.io.writeCurrent(plan.nextCurrent);
      var completeRun = CoreDeploymentSignalPersistence._buildRunRow_({
        signal_run_id: signalRunId,
        signal_as_of: signalAsOf,
        started_at: receivedAt,
        received_at: receivedAt,
        persisted_at: nowIso,
        deployments_evaluated: runInput.deployments_evaluated || 0,
        signals_proposed: norm.meta.proposed_count || norm.records.length,
        signals_persisted: plan.signalsPersisted,
        no_signal_count: runInput.no_signal_count || 0,
        lifecycleCounts: plan.lifecycleCounts,
        run_status: CoreDeploymentSignalStore.RUN_STATUS_COMPLETE,
        persistence_status: 'COMPLETE',
        context_schema_version: runMeta.context_schema_version,
        agent_reference: runMeta.agent_reference,
        source_reasoning_run_ref: runMeta.source_reasoning_run_ref,
        error_message: ''
      });
      return {
        ok: true,
        signal_run_id: signalRunId,
        signals_persisted: plan.signalsPersisted,
        lifecycle_counts: plan.lifecycleCounts,
        run: completeRun,
        current: plan.nextCurrent
      };
    } catch (writeErr) {
      return CoreDeploymentSignalPersistence._fail_(String(writeErr));
    }
  },

  /** @private */
  _persistToStore_: function (cfg, runInput, options, sheetNames, signalRunId) {
    var store = options.store;
    var existing = CoreDeploymentSignalStore.findRunById(
      store, sheetNames.runs, signalRunId);
    if (existing && String(existing.run_status) ===
        CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
      return {
        ok: true,
        idempotentReplay: true,
        signal_run_id: signalRunId,
        run: existing
      };
    }
    return CoreDeploymentSignalPersistence._executePersist_(
      cfg, runInput, options, sheetNames, signalRunId, {
        readCurrent: function () {
          return CoreDeploymentSignalStore.readBody(store, sheetNames.current);
        },
        writeCurrent: function (rows) {
          CoreDeploymentSignalStore.replaceBody(
            store, sheetNames.current,
            CoreDeploymentSignalStore.currentHeaders(), rows);
        },
        appendHistory: function (rows) {
          CoreDeploymentSignalStore.appendRows(
            store, sheetNames.history,
            CoreDeploymentSignalStore.historyHeaders(), rows);
        },
        appendRun: function (row) {
          CoreDeploymentSignalStore.appendRows(
            store, sheetNames.runs,
            CoreDeploymentSignalStore.runHeaders(), [row]);
        },
        updateRunStatus: function (row) {
          CoreDeploymentSignalStore.appendRows(
            store, sheetNames.runs,
            CoreDeploymentSignalStore.runHeaders(), [row]);
        }
      });
  },

  /** @private */
  _resolveValidDeploymentIds_: function (cfg, options) {
    if (options.validDeploymentIds) {
      var map = {};
      var list = options.validDeploymentIds;
      if (list.forEach) {
        list.forEach(function (id) {
          map[CoreData.canonicalDeploymentId(id)] = true;
        });
      } else {
        Object.keys(list).forEach(function (k) { map[k] = true; });
      }
      return map;
    }
    var activeStatus = (cfg.salesforce && cfg.salesforce.statusValues &&
      cfg.salesforce.statusValues.active) || 'Active';
    var raw = CoreData.readSfdcDeploymentsRaw(cfg) || [];
    var map = {};
    raw.forEach(function (row) {
      if (String(row.overallStatus || row.status || '').trim() !== activeStatus) return;
      var id = CoreData.canonicalDeploymentId(row.deploymentId);
      if (id) map[id] = true;
    });
    return map;
  },

  /** @private */
  _newSignalId_: function (identityKey) {
    var digest = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        String(identityKey),
        Utilities.Charset.UTF_8))
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 12);
    return 'SIG-' + digest;
  },

  /** @private */
  _buildRunRow_: function (p) {
    var lc = p.lifecycleCounts || {};
    return {
      signal_run_id: p.signal_run_id,
      signal_as_of: p.signal_as_of,
      started_at: p.started_at,
      received_at: p.received_at,
      persisted_at: p.persisted_at,
      deployments_evaluated: p.deployments_evaluated,
      signals_proposed: p.signals_proposed,
      signals_persisted: p.signals_persisted,
      no_signal_count: p.no_signal_count,
      lifecycle_new_count: lc.NEW || 0,
      lifecycle_continuing_count: lc.CONTINUING || 0,
      lifecycle_escalated_count: lc.ESCALATED || 0,
      lifecycle_de_escalated_count: lc.DE_ESCALATED || 0,
      lifecycle_resolved_count: lc.RESOLVED || 0,
      run_status: p.run_status,
      persistence_status: p.persistence_status,
      context_schema_version: p.context_schema_version,
      signal_schema_version: CoreDeploymentSignalStore.SIGNAL_SCHEMA_VERSION,
      normalization_version: CoreDeploymentSignalStore.NORMALIZATION_VERSION,
      agent_reference: p.agent_reference,
      source_reasoning_run_ref: p.source_reasoning_run_ref,
      error_message: p.error_message,
      email_status: 'PENDING'
    };
  },

  /** @private */
  _readCurrentRows_: function (cfg, store) {
    if (store) {
      return CoreDeploymentSignalStore.readBody(
        store, cfg.deploymentSignal.signalsSheetName);
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(cfg.deploymentSignal.signalsSheetName);
    if (!sh) return [];
    return CoreDeploymentSignalStore.readDataRows(
      sh, CoreDeploymentSignalStore.currentHeaders());
  },

  /** @private */
  _readHistoryRows_: function (cfg, store) {
    if (store) {
      return CoreDeploymentSignalStore.readBody(
        store, cfg.deploymentSignal.signalHistorySheetName);
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(cfg.deploymentSignal.signalHistorySheetName);
    if (!sh) return [];
    return CoreDeploymentSignalStore.readDataRows(
      sh, CoreDeploymentSignalStore.historyHeaders());
  },

  /** @private */
  _readRunRows_: function (cfg, store) {
    if (store) {
      return CoreDeploymentSignalStore.readBody(
        store, cfg.deploymentSignal.signalRunsSheetName);
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(cfg.deploymentSignal.signalRunsSheetName);
    if (!sh) return [];
    return CoreDeploymentSignalStore.readDataRows(
      sh, CoreDeploymentSignalStore.runHeaders());
  },

  /** @private */
  _assertSlgPersistence_: function (cfg) {
    if (!CoreDeploymentSignalPersistence.isEnabled(cfg)) {
      throw new Error('SLG Signal persistence is not enabled for this app');
    }
  },

  /** @private */
  _fail_: function (message) {
    Logger.log('CoreDeploymentSignalPersistence: FAIL ' + message);
    return { ok: false, error: message };
  },

  /**
   * Record FAILED on the run row without masking the original persistence error.
   *
   * @param {{ updateRun: function(string, Object) }} io
   * @param {string} runId
   * @param {string} errorMessage
   * @private
   */
  _tryUpdateRunFailed_: function (io, runId, errorMessage) {
    try {
      io.updateRun(runId, {
        run_status: CoreDeploymentSignalStore.RUN_STATUS_FAILED,
        persistence_status: 'FAILED',
        error_message: errorMessage
      });
    } catch (updateErr) {
      Logger.log('CoreDeploymentSignalPersistence._tryUpdateRunFailed_: could not write' +
        ' FAILED status for run ' + runId + ': ' + updateErr);
    }
  }
};
