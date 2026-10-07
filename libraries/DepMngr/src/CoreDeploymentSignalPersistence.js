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
    var names = [
      sig.signalsSheetName,
      sig.signalHistorySheetName,
      sig.signalRunsSheetName
    ];
    CoreDeploymentSignalWorkbook.ensureSheetHeaders(
      ss, sig.signalsSheetName, CoreDeploymentSignalSchema.currentHeaders());
    CoreDeploymentSignalWorkbook.ensureSheetHeaders(
      ss, sig.signalHistorySheetName, CoreDeploymentSignalSchema.historyHeaders());
    CoreDeploymentSignalWorkbook.ensureSheetHeaders(
      ss, sig.signalRunsSheetName, CoreDeploymentSignalSchema.runHeaders());
    Logger.log('CoreDeploymentSignalPersistence.initializeSignalSheets: ' +
      JSON.stringify(names));
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
      var priorRuns = CoreDeploymentSignalWorkbook.readDataRows(
        runsSheet, CoreDeploymentSignalSchema.runHeaders());
      var existing = priorRuns.filter(function (r) {
        return String(r.signal_run_id) === signalRunId &&
          String(r.run_status) === CoreDeploymentSignalSchema.RUN_STATUS_COMPLETE;
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
            return CoreDeploymentSignalWorkbook.readDataRows(
              sh, CoreDeploymentSignalSchema.currentHeaders());
          },
          writeCurrent: function (rows) {
            var sh = ss.getSheetByName(sheetNames.current);
            CoreDeploymentSignalWorkbook.replaceCurrentBody(
              sh, CoreDeploymentSignalSchema.currentHeaders(), rows);
          },
          appendHistory: function (rows) {
            var sh = ss.getSheetByName(sheetNames.history);
            CoreDeploymentSignalWorkbook.appendBodyRows(
              sh, CoreDeploymentSignalSchema.historyHeaders(), rows);
          },
          appendRun: function (row) {
            var sh = ss.getSheetByName(sheetNames.runs);
            CoreDeploymentSignalWorkbook.appendBodyRows(
              sh, CoreDeploymentSignalSchema.runHeaders(), [row]);
          },
          updateRunStatus: function (row) {
            CoreDeploymentSignalWorkbook.appendBodyRows(
              runsSheet, CoreDeploymentSignalSchema.runHeaders(), [row]);
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
      if (String(rows[i].run_status) === CoreDeploymentSignalSchema.RUN_STATUS_COMPLETE) {
        return rows[i];
      }
    }
    return null;
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
      run_status: CoreDeploymentSignalSchema.RUN_STATUS_IN_PROGRESS,
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
        run_status: CoreDeploymentSignalSchema.RUN_STATUS_COMPLETE,
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
        run_status: CoreDeploymentSignalSchema.RUN_STATUS_FAILED,
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

  /** @private */
  _persistToStore_: function (cfg, runInput, options, sheetNames, signalRunId) {
    var store = options.store;
    var existing = CoreDeploymentSignalStore.findRunById(
      store, sheetNames.runs, signalRunId);
    if (existing && String(existing.run_status) ===
        CoreDeploymentSignalSchema.RUN_STATUS_COMPLETE) {
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
            CoreDeploymentSignalSchema.currentHeaders(), rows);
        },
        appendHistory: function (rows) {
          CoreDeploymentSignalStore.appendRows(
            store, sheetNames.history,
            CoreDeploymentSignalSchema.historyHeaders(), rows);
        },
        appendRun: function (row) {
          CoreDeploymentSignalStore.appendRows(
            store, sheetNames.runs,
            CoreDeploymentSignalSchema.runHeaders(), [row]);
        },
        updateRunStatus: function (row) {
          CoreDeploymentSignalStore.appendRows(
            store, sheetNames.runs,
            CoreDeploymentSignalSchema.runHeaders(), [row]);
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
      signal_schema_version: CoreDeploymentSignalSchema.SIGNAL_SCHEMA_VERSION,
      normalization_version: CoreDeploymentSignalSchema.NORMALIZATION_VERSION,
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
    return CoreDeploymentSignalWorkbook.readDataRows(
      sh, CoreDeploymentSignalSchema.currentHeaders());
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
    return CoreDeploymentSignalWorkbook.readDataRows(
      sh, CoreDeploymentSignalSchema.historyHeaders());
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
    return CoreDeploymentSignalWorkbook.readDataRows(
      sh, CoreDeploymentSignalSchema.runHeaders());
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
  }
};
