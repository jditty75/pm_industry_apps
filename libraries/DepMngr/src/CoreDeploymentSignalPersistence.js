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
   * Deployment Signals landing payload for SLG UI (active intelligence; COMPLETE runs only).
   *
   * @param {AppConfig} appConfig
   * @param {Object=} viewModeOpts
   * @param {Object=} productOpts
   * @param {Object=} options { store, includeResolved }
   * @return {Object}
   */
  getDeploymentSignalsLandingForUI: function (appConfig, viewModeOpts, productOpts, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreConfig.isDeploymentSignalsUiEnabled(cfg)) {
      return { ok: true, enabled: false, status: 'disabled' };
    }
    var depIndex = CoreDeploymentSignalPersistence._buildDeploymentIndexForUi_(
      cfg, viewModeOpts, productOpts);
    var scopeIds = depIndex.scopeIds;

    var signals = CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(cfg, {
      store: options.store,
      activeOnly: true
    });
    if (scopeIds) {
      signals = signals.filter(function (s) {
        return !!scopeIds[String(s.deployment_id || '').trim()];
      });
    }

    if (options.includeResolved) {
      var resolved = CoreDeploymentSignalPersistence._readRecentResolvedForUi_(
        cfg, options.store, 40);
      if (scopeIds) {
        resolved = resolved.filter(function (s) {
          return !!scopeIds[String(s.deployment_id || '').trim()];
        });
      }
      var seen = {};
      signals.forEach(function (s) { seen[String(s.signal_id)] = true; });
      resolved.forEach(function (s) {
        if (!seen[s.signal_id]) signals.push(s);
      });
    }

    signals = signals.map(function (row) {
      return CoreDeploymentSignalPersistence._enrichSignalRowForUi_(row, depIndex.byId);
    });
    signals = CoreDeploymentSignalNormalize.sortSignalsForLanding(signals);

    var latestRun = CoreDeploymentSignalPersistence.getLatestApprovedSlgSignalRun(
      cfg, options);
    var lifecycleSummary = CoreDeploymentSignalPersistence._lifecycleSummaryFromSignals_(signals);
    if (latestRun) {
      lifecycleSummary.fromLatestRun = {
        new: parseInt(latestRun.lifecycle_new_count, 10) || 0,
        continuing: parseInt(latestRun.lifecycle_continuing_count, 10) || 0,
        escalated: parseInt(latestRun.lifecycle_escalated_count, 10) || 0,
        deEscalated: parseInt(latestRun.lifecycle_de_escalated_count, 10) || 0,
        resolved: parseInt(latestRun.lifecycle_resolved_count, 10) || 0
      };
    }

    return {
      ok: true,
      enabled: true,
      status: signals.length ? 'ready' : 'quiet',
      signals: signals,
      activeCount: signals.filter(function (s) {
        return String(s.signal_status) === CoreDeploymentSignalStore.SIGNAL_STATUS_ACTIVE;
      }).length,
      lifecycleSummary: lifecycleSummary,
      latestRun: latestRun ? CoreDeploymentSignalPersistence._publicRunMeta_(latestRun) : null,
      evidenceFreshness: CoreDeploymentSignalPersistence._signalEvidenceFreshness_(cfg)
    };
  },

  /**
   * Bounded deployment Signal history for UI timeline (on demand).
   *
   * @param {AppConfig} appConfig
   * @param {string} deploymentId
   * @param {Object=} options { store, signalId, limit }
   * @return {Object}
   */
  getDeploymentSignalHistoryForUI: function (appConfig, deploymentId, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreConfig.isDeploymentSignalsUiEnabled(cfg)) {
      return { ok: true, enabled: false, events: [] };
    }
    var depId = String(deploymentId || '').trim();
    if (!depId) {
      return { ok: false, enabled: true, error: 'deployment_id required', events: [] };
    }
    var limit = options.limit != null ? options.limit : 80;
    var rows = CoreDeploymentSignalPersistence.getSlgDeploymentSignalHistory(cfg, {
      store: options.store,
      deploymentId: depId,
      limit: limit
    });
    var signalFilter = String(options.signalId || '').trim();
    if (signalFilter) {
      rows = rows.filter(function (r) {
        return String(r.signal_id) === signalFilter;
      });
    }
    rows.sort(function (a, b) {
      var ta = String(a.history_event_at || a.persisted_at || a.signal_as_of || '');
      var tb = String(b.history_event_at || b.persisted_at || b.signal_as_of || '');
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    var events = rows.map(function (row) {
      return CoreDeploymentSignalPersistence._enrichHistoryEventForUi_(row);
    });
    return { ok: true, enabled: true, deploymentId: depId, events: events };
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
  _publicRunMeta_: function (runRow) {
    runRow = runRow || {};
    return {
      signal_run_id: runRow.signal_run_id,
      signal_as_of: runRow.signal_as_of,
      persisted_at: runRow.persisted_at,
      received_at: runRow.received_at,
      run_status: runRow.run_status,
      deployments_evaluated: runRow.deployments_evaluated,
      signals_persisted: runRow.signals_persisted
    };
  },

  /** @private */
  _enrichSignalRowForUi_: function (row, depById) {
    row = row || {};
    var dep = depById[String(row.deployment_id || '').trim()] || {};
    var conf = CoreDeploymentSignalNormalize.formatConfidenceForUi(
      row.confidence, row.confidence);
    return Object.assign({}, row, {
      deployment_name: dep.deploymentName || dep.deployment_name || '',
      account_name: dep.accountName || dep.account_name || '',
      signal_type_label: CoreDeploymentSignalNormalize.formatSignalTypeLabel(row.signal_type),
      confidence_tier: conf.tier,
      confidence_label: conf.label,
      confidence_detail: conf.detail,
      takeaway: String(row.why_it_matters || row.interpretation || '').trim()
    });
  },

  /** @private */
  _enrichHistoryEventForUi_: function (row) {
    row = row || {};
    var conf = CoreDeploymentSignalNormalize.formatConfidenceForUi(
      row.confidence, row.confidence);
    return {
      signal_id: row.signal_id,
      signal_run_id: row.signal_run_id,
      signal_as_of: row.signal_as_of,
      lifecycle_state: row.lifecycle_state,
      attention: row.attention,
      signal_type: row.signal_type,
      signal_type_label: CoreDeploymentSignalNormalize.formatSignalTypeLabel(row.signal_type),
      observation: row.observation,
      interpretation: row.interpretation,
      why_it_matters: row.why_it_matters,
      leadership_question: row.leadership_question,
      confidence_label: conf.label,
      confidence_detail: conf.detail,
      evidence_limitations: row.evidence_limitations,
      history_event_at: row.history_event_at,
      history_event_type: row.history_event_type
    };
  },

  /** @private */
  _lifecycleSummaryFromSignals_: function (signals) {
    var counts = { NEW: 0, CONTINUING: 0, ESCALATED: 0, DE_ESCALATED: 0, RESOLVED: 0 };
    (signals || []).forEach(function (s) {
      var lc = String(s.lifecycle_state || '').trim();
      if (counts[lc] !== undefined) counts[lc]++;
    });
    return { counts: counts };
  },

  /** @private */
  _buildDeploymentIndexForUi_: function (cfg, viewModeOpts, productOpts) {
    var byId = {};
    var scopeIds = null;
    try {
      if (typeof CoreData !== 'undefined' &&
          typeof CoreData.getAllDeploymentsForUI === 'function') {
        var payload = CoreData.getAllDeploymentsForUI(
          cfg, viewModeOpts || {}, productOpts || {});
        var rows = payload && payload.rows ? payload.rows : payload;
        if (Array.isArray(rows)) {
          scopeIds = {};
          rows.forEach(function (r) {
            var id = String(r.deploymentId || r.deployment_id || '').trim();
            if (!id) return;
            scopeIds[id] = true;
            byId[id] = r;
          });
        }
      }
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence._buildDeploymentIndexForUi_: ' + err);
    }
    return { byId: byId, scopeIds: scopeIds };
  },

  /** @private */
  _readRecentResolvedForUi_: function (cfg, store, limit) {
    limit = limit || 30;
    var rows = CoreDeploymentSignalPersistence._readHistoryRows_(cfg, store);
    var out = [];
    var seen = {};
    for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
      var row = rows[i];
      if (String(row.lifecycle_state) !== CoreDeploymentSignalLifecycle.LIFECYCLE_RESOLVED) {
        continue;
      }
      var sid = String(row.signal_id || '').trim();
      if (!sid || seen[sid]) continue;
      seen[sid] = true;
      out.push(Object.assign({}, row, {
        signal_status: CoreDeploymentSignalStore.SIGNAL_STATUS_RESOLVED
      }));
    }
    return out;
  },

  /** @private */
  _signalEvidenceFreshness_: function (cfg) {
    var sig = cfg.deploymentSignal || {};
    var sheets = sig.signalEvidenceSourceSheets || [];
    if (!sheets.length) return null;
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss || !CoreFreshnessMonitor ||
          typeof CoreFreshnessMonitor.getLatestSuccessRefreshBySheet !== 'function') {
        return null;
      }
      var bundle = CoreFreshnessMonitor.getLatestSuccessRefreshBySheet(ss, {
        requiredSheets: sheets
      });
      var bySheet = bundle.latestSuccessBySheet || {};
      var oldestIso = null;
      sheets.forEach(function (sheetName) {
        var entry = bySheet[sheetName];
        if (!entry || !entry.refreshIso) return;
        if (!oldestIso || entry.refreshIso < oldestIso) oldestIso = entry.refreshIso;
      });
      return oldestIso ? { oldestSourceRefreshAt: oldestIso } : null;
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence._signalEvidenceFreshness_: ' + err);
      return null;
    }
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

  DEPLOYMENT_INTELLIGENCE_ARTIFACT_VERSION: 'deployment-intelligence-v1',

  /**
   * Idempotent intelligence runs sheet (headers only).
   *
   * @param {AppConfig} appConfig
   * @return {{ sheets: Array<string> }}
   */
  initializeDeploymentIntelligenceSheets: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreConfig.isDeploymentIntelligenceEnabled(cfg)) {
      throw new Error('Deployment Intelligence is not enabled for this app');
    }
    var sheetName = cfg.deploymentIntelligence.intelligenceRunsSheetName;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    CoreDeploymentSignalStore.ensureSheetHeaders(
      ss, sheetName, CoreDeploymentSignalStore.intelligenceRunHeaders());
    Logger.log('CoreDeploymentSignalPersistence.initializeDeploymentIntelligenceSheets: PASS');
    return { sheets: [sheetName] };
  },

  /**
   * Pure builder for the canonical Deployment Intelligence artifact.
   *
   * @param {AppConfig} appConfig
   * @param {Object} signalRunRow COMPLETE signal run row
   * @param {Object=} options { store, viewModeOpts, productOpts, getContextPacketForDeployment }
   * @return {Object}
   */
  buildDeploymentIntelligenceReadModel: function (appConfig, signalRunRow, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    signalRunRow = signalRunRow || {};
    if (String(signalRunRow.run_status) !== CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
      throw new Error('Deployment Intelligence requires a COMPLETE signal run');
    }

    var signalRunId = String(signalRunRow.signal_run_id || '').trim();
    var intelligenceRunId = 'INT-' + signalRunId;
    var asOfDate = String(signalRunRow.signal_as_of || '').trim() ||
      new Date().toISOString().slice(0, 10);

    var priorReady = CoreDeploymentSignalPersistence._findPriorReadyIntelligence_(
      cfg, options.store, intelligenceRunId);
    var isBaseline = !priorReady;

    var portfolioPulse = CorePortfolioHealth.buildDeploymentIntelligencePortfolioPulse(
      cfg, options.viewModeOpts, options.productOpts);

    var depIndex = CoreDeploymentSignalPersistence._buildDeploymentIndexForUi_(
      cfg, options.viewModeOpts, options.productOpts);
    var countRows = CoreDeploymentSignalPersistence._intelligenceCountRows_(cfg, options.productOpts);

    var currentSignals = CoreDeploymentSignalPersistence.getCurrentSlgDeploymentSignals(cfg, {
      store: options.store,
      activeOnly: true
    });
    var historyRows = CoreDeploymentSignalPersistence._readHistoryRows_(cfg, options.store);
    var runHistory = historyRows.filter(function (h) {
      return String(h.signal_run_id || '').trim() === signalRunId;
    });

    var signalMovement = CoreDeploymentSignalPersistence._buildIntelligenceSignalMovement_(
      signalRunRow, runHistory, currentSignals, isBaseline);

    var leadershipVisibleIds = CoreDeploymentSignalPersistence
      ._leadershipVisibleDeploymentIds_(currentSignals, countRows, portfolioPulse);

    var getPacketFn = options.getContextPacketForDeployment;
    if (!getPacketFn) {
      getPacketFn = function (depId) {
        return CoreDeploymentSignalPersistence._getProductionContextPacketForDeployment_(
          cfg, depId);
      };
    }

    var stewardshipByDep = CoreDeploymentSignalPersistence._intelligenceDataConfidence_(
      cfg, leadershipVisibleIds, getPacketFn);

    var priorArtifact = priorReady ?
      CoreDeploymentSignalPersistence.parseArtifactFromRunRow(priorReady) : null;
    var portfolioMovement = null;
    if (!isBaseline && priorArtifact && priorArtifact.portfolioPulse) {
      portfolioMovement = CoreDeploymentSignalPersistence._portfolioMovementDelta_(
        portfolioPulse, priorArtifact.portfolioPulse);
    }

    var weekCharacter = CoreDeploymentSignalPersistence._classifyIntelligenceWeek_(
      isBaseline, signalMovement.leadership, portfolioMovement);

    var talkingPoints = CoreDeploymentSignalPersistence._selectIntelligenceTalkingPoints_(
      cfg, runHistory, currentSignals, depIndex.byId, stewardshipByDep, isBaseline,
      weekCharacter);

    var redActive = 0;
    var yellowActive = 0;
    var continuingActive = 0;
    currentSignals.forEach(function (s) {
      if (String(s.signal_status) !== CoreDeploymentSignalStore.SIGNAL_STATUS_ACTIVE) return;
      var lc = String(s.lifecycle_state || '');
      if (lc === 'CONTINUING') continuingActive++;
      var h = String(s.current_health || '').trim();
      if (h === 'Red') redActive++;
      else if (h === 'Yellow') yellowActive++;
    });

    var exploreUrl = CoreConfig.buildDeploymentManagerInvestigationUrl(cfg, { tab: 'signals' });
    var displayName = (cfg.deploymentIntelligence && cfg.deploymentIntelligence.displayName) ||
      'Deployment Intelligence';

    var artifact = {
      identity: {
        intelligence_run_id: intelligenceRunId,
        signal_run_id: signalRunId,
        app_id: String(cfg.appId || '').trim(),
        as_of_date: asOfDate,
        is_baseline: isBaseline,
        display_name: displayName,
        week_character: weekCharacter,
        artifact_schema_version:
          CoreDeploymentSignalPersistence.DEPLOYMENT_INTELLIGENCE_ARTIFACT_VERSION
      },
      portfolioPulse: portfolioPulse,
      portfolioMovement: portfolioMovement,
      portfolioMovementBaselineCopy: isBaseline ?
        'Initial Deployment Intelligence baseline established.' : null,
      signalMovement: signalMovement,
      currentAttention: {
        redDeployments: redActive,
        yellowDeployments: yellowActive,
        continuingSignals: continuingActive
      },
      talkingPoints: talkingPoints,
      dataConfidence: stewardshipByDep.summary,
      links: {
        exploreDeploymentIntelligenceUrl: exploreUrl
      },
      distributionState: {
        intelligence_status: CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        slack_status: CoreDeploymentSignalStore.SLACK_STATUS_PENDING
      }
    };
    artifact.editorial = CoreDeploymentSignalPersistence._buildIntelligenceEditorial_(artifact);
    return artifact;
  },

  /**
   * Add leadership editorial copy to an artifact (idempotent). Used by previews/tests.
   *
   * @param {Object} artifact
   * @return {Object}
   */
  enrichDeploymentIntelligenceEditorial: function (artifact) {
    if (!artifact) return artifact;
    if (!artifact.editorial) {
      artifact.editorial = CoreDeploymentSignalPersistence._buildIntelligenceEditorial_(artifact);
    }
    return artifact;
  },

  /**
   * Finalize and persist a weekly Deployment Intelligence run.
   *
   * @param {AppConfig} appConfig
   * @param {Object=} options { signal_run_id, store, viewModeOpts, productOpts, getContextPacketForDeployment }
   * @return {Object}
   */
  finalizeDeploymentIntelligenceRun: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreConfig.isDeploymentIntelligenceEnabled(cfg)) {
      return CoreDeploymentSignalPersistence._fail_('Deployment Intelligence is not enabled');
    }

    var signalRunId = String(options.signal_run_id || '').trim();
    if (!signalRunId) {
      var latest = CoreDeploymentSignalPersistence.getLatestApprovedSlgSignalRun(cfg, options);
      if (!latest) {
        return CoreDeploymentSignalPersistence._fail_('no COMPLETE signal run available');
      }
      signalRunId = String(latest.signal_run_id || '').trim();
    }

    var intelligenceRunId = 'INT-' + signalRunId;
    var sheetName = cfg.deploymentIntelligence.intelligenceRunsSheetName;
    var headers = CoreDeploymentSignalStore.intelligenceRunHeaders();

    var existingRows = CoreDeploymentSignalPersistence._readIntelligenceRows_(cfg, options.store);
    var prior = CoreDeploymentSignalPersistence._findIntelligenceByKeys_(
      existingRows, intelligenceRunId, signalRunId);
    if (prior && String(prior.intelligence_status) ===
        CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY) {
      var artifactReplay = CoreDeploymentSignalPersistence.parseArtifactFromRunRow(prior);
      return {
        ok: true,
        idempotentReplay: true,
        intelligence_run_id: intelligenceRunId,
        signal_run_id: signalRunId,
        run: prior,
        artifact: artifactReplay
      };
    }

    var runRows = CoreDeploymentSignalPersistence._readRunRows_(cfg, options.store);
    var signalRun = CoreDeploymentSignalStore.findLatestRunRow(runRows, signalRunId);
    if (!signalRun) {
      return CoreDeploymentSignalPersistence._fail_('signal run not found: ' + signalRunId);
    }
    if (String(signalRun.run_status) === CoreDeploymentSignalStore.RUN_STATUS_SUBMITTED) {
      return CoreDeploymentSignalPersistence._fail_(
        'SUBMITTED signal runs cannot finalize Deployment Intelligence');
    }
    if (String(signalRun.run_status) !== CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
      return CoreDeploymentSignalPersistence._fail_('signal run is not COMPLETE');
    }

    var nowIso = new Date().toISOString();
    try {
      var artifact = CoreDeploymentSignalPersistence.buildDeploymentIntelligenceReadModel(
        cfg, signalRun, options);
      var row = {
        intelligence_run_id: intelligenceRunId,
        app_id: String(cfg.appId || '').trim(),
        signal_run_id: signalRunId,
        as_of_date: artifact.identity.as_of_date,
        is_baseline: artifact.identity.is_baseline,
        intelligence_status: CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY,
        artifact_schema_version: artifact.identity.artifact_schema_version,
        artifact_json: JSON.stringify(artifact),
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        email_sent_at: '',
        slack_status: CoreDeploymentSignalStore.SLACK_STATUS_PENDING,
        slack_sent_at: '',
        finalized_at: nowIso,
        updated_at: nowIso
      };

      if (options.store) {
        CoreDeploymentSignalStore.appendRows(options.store, sheetName, headers, [row]);
      } else {
        var lock = LockService.getDocumentLock();
        if (!lock.tryLock(30000)) {
          return CoreDeploymentSignalPersistence._fail_('could not acquire document lock');
        }
        try {
          CoreDeploymentSignalPersistence.initializeDeploymentIntelligenceSheets(cfg);
          var ss = SpreadsheetApp.getActiveSpreadsheet();
          var sh = ss.getSheetByName(sheetName);
          CoreDeploymentSignalStore.appendBodyRows(sh, headers, [row]);
        } finally {
          lock.releaseLock();
        }
      }

      return {
        ok: true,
        idempotentReplay: false,
        intelligence_run_id: intelligenceRunId,
        signal_run_id: signalRunId,
        run: row,
        artifact: artifact
      };
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence.finalizeDeploymentIntelligenceRun: ' + err);
      var failedRow = {
        intelligence_run_id: intelligenceRunId,
        app_id: String(cfg.appId || '').trim(),
        signal_run_id: signalRunId,
        as_of_date: String(signalRun.signal_as_of || '').trim(),
        is_baseline: false,
        intelligence_status: CoreDeploymentSignalStore.INTELLIGENCE_STATUS_FAILED,
        artifact_schema_version:
          CoreDeploymentSignalPersistence.DEPLOYMENT_INTELLIGENCE_ARTIFACT_VERSION,
        artifact_json: '',
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_NOT_REQUIRED,
        email_sent_at: '',
        slack_status: CoreDeploymentSignalStore.SLACK_STATUS_NOT_REQUIRED,
        slack_sent_at: '',
        finalized_at: nowIso,
        updated_at: nowIso
      };
      if (options.store) {
        CoreDeploymentSignalStore.appendRows(options.store, sheetName, headers, [failedRow]);
      }
      return CoreDeploymentSignalPersistence._fail_(String(err));
    }
  },

  /**
   * Latest READY intelligence row for this app.
   *
   * @param {AppConfig} appConfig
   * @param {Object=} options { store }
   * @return {Object|null}
   */
  getLatestReadyDeploymentIntelligence: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreConfig.isDeploymentIntelligenceEnabled(cfg)) return null;
    var appId = String(cfg.appId || '').trim();
    var rows = CoreDeploymentSignalPersistence._readIntelligenceRows_(cfg, options.store);
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (String(r.app_id || '').trim() !== appId) continue;
      if (String(r.intelligence_status) === CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY) {
        return r;
      }
    }
    return null;
  },

  /**
   * @param {Object} row intelligence run row
   * @return {Object|null}
   */
  parseArtifactFromRunRow: function (row) {
    if (!row || !row.artifact_json) return null;
    try {
      return JSON.parse(String(row.artifact_json));
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence.parseArtifactFromRunRow: ' + err);
      return null;
    }
  },

  /** @private */
  _readIntelligenceRows_: function (cfg, store) {
    var sheetName = cfg.deploymentIntelligence.intelligenceRunsSheetName;
    if (store) {
      return CoreDeploymentSignalStore.readBody(store, sheetName);
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return [];
    return CoreDeploymentSignalStore.readDataRows(
      sh, CoreDeploymentSignalStore.intelligenceRunHeaders());
  },

  /** @private */
  _findIntelligenceByKeys_: function (rows, intelligenceRunId, signalRunId) {
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (String(r.intelligence_run_id || '').trim() === intelligenceRunId) return r;
      if (String(r.signal_run_id || '').trim() === signalRunId &&
          String(r.intelligence_status) === CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY) {
        return r;
      }
    }
    return null;
  },

  /** @private */
  _findPriorReadyIntelligence_: function (cfg, store, excludeIntelligenceRunId) {
    var appId = String(cfg.appId || '').trim();
    var rows = CoreDeploymentSignalPersistence._readIntelligenceRows_(cfg, store);
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (String(r.intelligence_run_id || '').trim() === excludeIntelligenceRunId) continue;
      if (String(r.app_id || '').trim() !== appId) continue;
      if (String(r.intelligence_status) === CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY) {
        return r;
      }
    }
    return null;
  },

  /** @private */
  _intelligenceCountRows_: function (cfg, productOpts) {
    return CoreData.getActiveCountDeployments(cfg, productOpts)
      .filter(function (r) { return !r.excludeFromReport; })
      .filter(function (r) {
        return CoreData.filterDeploymentsByStudent_([r], 'exclude', cfg).length > 0;
      });
  },

  /** @private */
  _portfolioMovementDelta_: function (current, prior) {
    return {
      totalActiveDelta: (current.totalActive || 0) - (prior.totalActive || 0),
      greenPctPointsDelta: (current.greenPct || 0) - (prior.greenPct || 0),
      yellowPctPointsDelta: (current.yellowPct || 0) - (prior.yellowPct || 0),
      redPctPointsDelta: (current.redPct || 0) - (prior.redPct || 0),
      mtpWithin90DaysDelta: (current.mtpWithin90Days || 0) - (prior.mtpWithin90Days || 0)
    };
  },

  /** @private */
  _buildIntelligenceSignalMovement_: function (runRow, runHistory, currentSignals, isBaseline) {
    var raw = {
      new: parseInt(runRow.lifecycle_new_count, 10) || 0,
      escalated: parseInt(runRow.lifecycle_escalated_count, 10) || 0,
      continuing: parseInt(runRow.lifecycle_continuing_count, 10) || 0,
      deEscalated: parseInt(runRow.lifecycle_de_escalated_count, 10) || 0,
      resolved: parseInt(runRow.lifecycle_resolved_count, 10) || 0
    };
    var leadership = {
      new: isBaseline ? 0 : raw.new,
      escalated: raw.escalated,
      continuing: raw.continuing,
      deEscalated: raw.deEscalated,
      resolved: raw.resolved
    };
    function listFor(state) {
      return runHistory.filter(function (h) {
        return String(h.lifecycle_state || '') === state;
      }).map(function (h) {
        return {
          signal_id: h.signal_id,
          deployment_id: h.deployment_id,
          attention: h.attention,
          signal_type: h.signal_type
        };
      });
    }
    return {
      raw: raw,
      leadership: leadership,
      lists: {
        new: listFor('NEW'),
        escalated: listFor('ESCALATED'),
        deEscalated: listFor('DE_ESCALATED'),
        resolved: listFor('RESOLVED')
      },
      baselineSuppressNewForLeadership: isBaseline
    };
  },

  /**
   * Leadership-visible deployments for Data Confidence intersection.
   * NEW, ESCALATED, HIGH-attention active Signals; Red in scope; non-Green MTP<=90d.
   *
   * @private
   */
  _leadershipVisibleDeploymentIds_: function (currentSignals, countRows, portfolioPulse) {
    var ids = {};
    (currentSignals || []).forEach(function (s) {
      if (String(s.signal_status) !== CoreDeploymentSignalStore.SIGNAL_STATUS_ACTIVE) return;
      var lc = String(s.lifecycle_state || '');
      var att = String(s.attention || '').trim();
      if (lc === 'NEW' || lc === 'ESCALATED' || att === 'HIGH') {
        var dep = String(s.deployment_id || '').trim();
        if (dep) ids[dep] = true;
      }
    });
    var tz = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    (countRows || []).forEach(function (r) {
      var depId = String(r.deploymentId || r.deployment_id || '').trim();
      if (!depId) return;
      var h = String(r.health || '').trim();
      if (h === 'Red') {
        ids[depId] = true;
        return;
      }
      if (h !== 'Green') {
        var mtpRaw = r.currentMtp || r.goLiveDate || r.mtpDate || '';
        if (!mtpRaw) return;
        var days = TrajectoryMetrics.signedDaysBetween(todayStr, String(mtpRaw).slice(0, 10));
        if (days !== null && days >= 0 && days <= 90) ids[depId] = true;
      }
    });
    return ids;
  },

  /** @private */
  _intelligenceDataConfidence_: function (cfg, leadershipVisibleIds, getPacketFn) {
    var items = [];
    var depIds = Object.keys(leadershipVisibleIds || {});
    depIds.sort();
    depIds.forEach(function (depId) {
      if (!getPacketFn) return;
      var packet = getPacketFn(depId);
      if (!packet) return;
      var analyzed = CoreDeploymentDataStewardship.analyzePacket(packet);
      (analyzed.deployment_data_stewardship || []).forEach(function (cond) {
        if (String(cond.lane) !== CoreDeploymentDataStewardship.LANE_STEWARDSHIP) return;
        items.push({
          deployment_id: depId,
          condition_code: cond.condition_code,
          observation: cond.observation,
          affected_domain: cond.affected_domain
        });
      });
    });
    return {
      summary: {
        leadershipVisibleDeploymentCount: depIds.length,
        deploymentsWithStewardshipCount: items.length ?
          CoreDeploymentSignalPersistence._uniqueDepIds_(items).length : 0,
        items: items
      }
    };
  },

  /** @private */
  _uniqueDepIds_: function (items) {
    var set = {};
    items.forEach(function (it) {
      if (it.deployment_id) set[it.deployment_id] = true;
    });
    return Object.keys(set);
  },

  /**
   * Production trajectory/context packet for Data Stewardship (shared path).
   *
   * @param {AppConfig} cfg
   * @param {string} deploymentId
   * @return {Object|null}
   * @private
   */
  _getProductionContextPacketForDeployment_: function (cfg, deploymentId) {
    var depId = String(deploymentId || '').trim();
    if (!depId) return null;
    try {
      if (typeof CoreDeploymentSignalContext === 'undefined' ||
          typeof CoreDeploymentSignalContext.buildDeploymentSignalContext !== 'function') {
        return null;
      }
      return CoreDeploymentSignalContext.buildDeploymentSignalContext(cfg, depId, {});
    } catch (err) {
      Logger.log('CoreDeploymentSignalPersistence._getProductionContextPacketForDeployment_: ' +
        depId + ' ' + err);
      return null;
    }
  },

  /** @private */
  _classifyIntelligenceWeek_: function (isBaseline, leadership, movement) {
    leadership = leadership || {};
    if (isBaseline) return 'baseline';
    var n = parseInt(leadership.new, 10) || 0;
    var e = parseInt(leadership.escalated, 10) || 0;
    var de = parseInt(leadership.deEscalated, 10) || 0;
    var res = parseInt(leadership.resolved, 10) || 0;
    if (n > 0 || e > 0) return 'active';
    if (de > 0 || res > 0) {
      if (movement) {
        var greenUp = (movement.greenPctPointsDelta || 0) > 0;
        var redDown = (movement.redPctPointsDelta || 0) < 0;
        var yellowDown = (movement.yellowPctPointsDelta || 0) < 0;
        if (greenUp || redDown || yellowDown) return 'improving';
      }
      return 'improving';
    }
    return 'quiet';
  },

  /** @private */
  _talkingPointHeadlineAndSummary_: function (takeaway, displayName) {
    var text = String(takeaway || '').trim();
    if (!text) {
      return {
        headline: displayName + ' warrants leadership awareness this week.',
        leadership_summary: ''
      };
    }
    var sentenceMatch = text.match(/^(.+?[.!?])(?:\s+([\s\S]+))?$/);
    if (sentenceMatch && sentenceMatch[1] && sentenceMatch[1].length <= 200) {
      var headline = sentenceMatch[1].trim();
      var rest = (sentenceMatch[2] || '').trim();
      if (!rest || rest === headline) {
        return { headline: headline, leadership_summary: '' };
      }
      return { headline: headline, leadership_summary: rest };
    }
    if (text.length <= 160) {
      return { headline: text, leadership_summary: '' };
    }
    return {
      headline: text.slice(0, 157).trim() + '…',
      leadership_summary: text
    };
  },

  /** @private */
  _formatTalkingPointRow_: function (cfg, signalRow, depById, stewByDep) {
    var depId = String(signalRow.deployment_id || '').trim();
    var dep = depById[depId] || {};
    var displayName = String(
      dep.accountName || dep.deploymentName || depId || 'Deployment').trim();
    var takeaway = String(signalRow.why_it_matters || signalRow.interpretation || '').trim();
    var parts = CoreDeploymentSignalPersistence._talkingPointHeadlineAndSummary_(
      takeaway, displayName);
    var stew = stewByDep[depId] || [];
    var sorNote = '';
    if (stew.length) {
      sorNote = 'System-of-record: ' + String(stew[0].observation || '').trim();
    }
    return {
      deployment_display_name: displayName,
      deployment_id: depId,
      signal_id: signalRow.signal_id,
      lifecycle_state: signalRow.lifecycle_state,
      attention: signalRow.attention,
      signal_type_label: CoreDeploymentSignalNormalize.formatSignalTypeLabel(
        signalRow.signal_type),
      headline: parts.headline,
      leadership_summary: parts.leadership_summary,
      leadership_takeaway: takeaway,
      leadership_question: String(signalRow.leadership_question || '').trim(),
      system_of_record_note: sorNote,
      data_confidence_note: stew.length ? stew[0].observation : '',
      investigation_url: CoreConfig.buildDeploymentManagerInvestigationUrl(cfg, {
        tab: 'signals',
        deploymentId: depId,
        signalId: signalRow.signal_id
      }),
      attention_sort: CoreDeploymentSignalPersistence._attentionSortKey_(signalRow.attention)
    };
  },

  /** @private */
  _selectIntelligenceTalkingPoints_: function (
    cfg, runHistory, currentSignals, depById, stewardshipBundle, isBaseline, weekCharacter) {
    if (isBaseline) return [];

    var di = cfg.deploymentIntelligence || {};
    var maxTp = parseInt(di.talkingPointMax, 10) || 5;
    var minTp = parseInt(di.talkingPointMin, 10) || 3;
    var stewardshipItems = (stewardshipBundle && stewardshipBundle.summary &&
      stewardshipBundle.summary.items) || [];
    var stewByDep = {};
    stewardshipItems.forEach(function (it) {
      if (!stewByDep[it.deployment_id]) stewByDep[it.deployment_id] = [];
      stewByDep[it.deployment_id].push(it);
    });

    if (weekCharacter === 'quiet') return [];

    var pools = {
      escalated: [],
      new: [],
      deEscalated: [],
      highContinuing: [],
      positiveContinuing: []
    };

    runHistory.forEach(function (h) {
      var lc = String(h.lifecycle_state || '');
      if (lc === 'ESCALATED') pools.escalated.push(h);
      else if (lc === 'NEW') pools.new.push(h);
      else if (lc === 'DE_ESCALATED') pools.deEscalated.push(h);
    });

    currentSignals.forEach(function (s) {
      if (String(s.signal_status) !== CoreDeploymentSignalStore.SIGNAL_STATUS_ACTIVE) return;
      var lc = String(s.lifecycle_state || '');
      var att = String(s.attention || '').trim();
      if (lc === 'CONTINUING' && att === 'HIGH') pools.highContinuing.push(s);
      if (lc === 'CONTINUING' && att === 'POSITIVE') pools.positiveContinuing.push(s);
    });

    function sortPool(rows) {
      rows.sort(function (a, b) {
        var att = CoreDeploymentSignalPersistence._attentionSortKey_(a.attention) -
          CoreDeploymentSignalPersistence._attentionSortKey_(b.attention);
        if (att !== 0) return att;
        var an = String(a.deployment_id || '');
        var bn = String(b.deployment_id || '');
        return an.localeCompare(bn);
      });
    }
    sortPool(pools.escalated);
    sortPool(pools.new);
    sortPool(pools.deEscalated);
    sortPool(pools.highContinuing);
    sortPool(pools.positiveContinuing);

    var ordered = [];
    if (weekCharacter === 'improving') {
      pools.deEscalated.forEach(function (r) { ordered.push(r); });
      pools.positiveContinuing.forEach(function (r) { ordered.push(r); });
      pools.highContinuing.forEach(function (r) { ordered.push(r); });
    } else {
      pools.escalated.forEach(function (r) { ordered.push(r); });
      pools.new.forEach(function (r) { ordered.push(r); });
      pools.highContinuing.forEach(function (r) { ordered.push(r); });
      pools.deEscalated.forEach(function (r) { ordered.push(r); });
    }

    var seen = {};
    var unique = [];
    ordered.forEach(function (row) {
      var sid = String(row.signal_id || row.deployment_id + row.signal_type);
      if (seen[sid]) return;
      seen[sid] = true;
      unique.push(row);
    });

    var take = Math.min(maxTp, unique.length);
    if (weekCharacter === 'active' && unique.length >= minTp && take < minTp) {
      take = minTp;
    }
    if (weekCharacter === 'improving' && take > 0 && take < Math.min(3, unique.length)) {
      take = Math.min(3, unique.length);
    }

    return unique.slice(0, take).map(function (row) {
      return CoreDeploymentSignalPersistence._formatTalkingPointRow_(
        cfg, row, depById, stewByDep);
    });
  },

  /** @private */
  _formatPctPointPhrase_: function (delta) {
    var v = Math.round((Number(delta) || 0) * 10) / 10;
    var abs = Math.abs(v);
    var unit = abs === 1 ? 'pt' : 'pts';
    if (v > 0) return '+' + v + ' ' + unit;
    if (v < 0) return String(v) + ' ' + unit;
    return '0 ' + unit;
  },

  /** @private */
  _buildIntelligenceEditorial_: function (artifact) {
    artifact = artifact || {};
    var identity = artifact.identity || {};
    var pulse = artifact.portfolioPulse || {};
    var movement = artifact.portfolioMovement;
    var signalMv = artifact.signalMovement || {};
    var leadership = signalMv.leadership || {};
    var attention = artifact.currentAttention || {};
    var dataConf = artifact.dataConfidence || {};
    var weekCharacter = identity.week_character || 'active';
    var isBaseline = !!identity.is_baseline;

    var pulseLine = String(pulse.totalActive || 0) + ' active deployments · ' +
      String(pulse.greenPct || 0) + '% Green · ' +
      String(pulse.yellowPct || 0) + '% Yellow · ' +
      String(pulse.redPct || 0) + '% Red · ' +
      String(pulse.mtpWithin90Days || 0) + ' approaching MTP (90 days)';

    var portfolioMovementNarrative = null;
    if (movement && !isBaseline) {
      var g = movement.greenPctPointsDelta || 0;
      var y = movement.yellowPctPointsDelta || 0;
      var r = movement.redPctPointsDelta || 0;
      var ta = movement.totalActiveDelta || 0;
      var mtpD = movement.mtpWithin90DaysDelta || 0;
      if (g === 0 && y === 0 && r === 0 && ta === 0 && mtpD === 0) {
        movement = null;
      }
    }
    if (movement && !isBaseline) {
      g = movement.greenPctPointsDelta || 0;
      y = movement.yellowPctPointsDelta || 0;
      r = movement.redPctPointsDelta || 0;
      var improved = g > 0 && (y <= 0 || r <= 0);
      var declined = g < 0 || r > 0;
      var headline = improved && !declined ?
        'Portfolio health improved this week' :
        (declined && !improved ? 'Portfolio health softened this week' :
          'Portfolio health shifted this week');
      var detail = 'Green ' + CoreDeploymentSignalPersistence._formatPctPointPhrase_(g) +
        ' to ' + String(pulse.greenPct || 0) + '%';
      if (y !== 0 || r !== 0) {
        var parts = [];
        if (y !== 0) parts.push('Yellow ' + CoreDeploymentSignalPersistence._formatPctPointPhrase_(y));
        if (r !== 0) parts.push('Red ' + CoreDeploymentSignalPersistence._formatPctPointPhrase_(r));
        detail += ', while ' + parts.join(' and ');
      }
      portfolioMovementNarrative = { headline: headline, detail: detail };
    }

    var n = parseInt(leadership.new, 10) || 0;
    var e = parseInt(leadership.escalated, 10) || 0;
    var de = parseInt(leadership.deEscalated, 10) || 0;
    var res = parseInt(leadership.resolved, 10) || 0;
    var attentionTotal = n + e;
    var whatChanged = {
      headline: '',
      sublines: [],
      portfolioMovement: portfolioMovementNarrative
    };

    if (isBaseline) {
      whatChanged.headline = artifact.portfolioMovementBaselineCopy ||
        'Initial Deployment Intelligence baseline established.';
      whatChanged.sublines = [
        'This establishes the portfolio state and active intelligence that future weekly updates ' +
        'will measure against.'
      ];
    } else if (attentionTotal > 0) {
      whatChanged.headline = attentionTotal === 1 ?
        '1 condition warrants new attention' :
        attentionTotal + ' conditions warrant new attention';
      var bits = [];
      if (n > 0) bits.push(n + ' new');
      if (e > 0) bits.push(e + ' escalated');
      if (bits.length) whatChanged.sublines.push(bits.join(' · '));
    } else if (weekCharacter === 'improving') {
      whatChanged.headline = 'Conditions are improving this week';
      var imp = [];
      if (de > 0) imp.push(de + ' de-escalated');
      if (res > 0) imp.push(res + ' resolved');
      if (imp.length) whatChanged.sublines.push(imp.join(' · '));
    } else if (weekCharacter === 'quiet') {
      whatChanged.headline = 'A relatively quiet week for emerging deployment intelligence';
      whatChanged.sublines = [
        'No new or escalated conditions surfaced. Existing conditions remain under observation ' +
        'as summarized below.'
      ];
    } else {
      whatChanged.headline = 'No new or escalated conditions this week';
    }

    if (!isBaseline && de > 0 && attentionTotal === 0 && weekCharacter !== 'quiet') {
      whatChanged.sublines.push(de + ' condition' + (de === 1 ? '' : 's') + ' improving');
    }
    if (!isBaseline && res > 0 && attentionTotal === 0) {
      whatChanged.sublines.push(res + ' resolved');
    }

    var dataRequiringAttention = null;
    var stewCount = parseInt(dataConf.deploymentsWithStewardshipCount, 10) || 0;
    if (stewCount > 0) {
      dataRequiringAttention = {
        headline: 'Data requiring attention',
        body: stewCount === 1 ?
          '1 deployment discussed this week has a material system-of-record condition requiring review.' :
          stewCount + ' deployments discussed this week have material system-of-record conditions ' +
          'requiring review.'
      };
    }

    var talkingSectionTitle = '3 things to know this week';
    if (weekCharacter === 'baseline') {
      talkingSectionTitle = 'Establishing the baseline';
    } else if ((artifact.talkingPoints || []).length === 0) {
      talkingSectionTitle = '';
    }

    return {
      weekCharacter: weekCharacter,
      portfolioPulseLine: pulseLine,
      whatChanged: whatChanged,
      talkingSectionTitle: talkingSectionTitle,
      quietWeek: weekCharacter === 'quiet',
      baselineFollowUp: isBaseline ?
        'Future weekly briefings will measure change from this baseline.' : null,
      dataRequiringAttention: dataRequiringAttention,
      currentAttentionLine: String(attention.redDeployments || 0) + ' Red · ' +
        String(attention.yellowDeployments || 0) + ' Yellow · ' +
        String(attention.continuingSignals || 0) + ' continuing conditions under observation'
    };
  },

  /** @private */
  _attentionSortKey_: function (attention) {
    var a = String(attention || '').trim();
    if (a === 'HIGH') return 0;
    if (a === 'WATCH') return 1;
    if (a === 'INFORMATIONAL') return 2;
    if (a === 'POSITIVE') return 3;
    return 4;
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
