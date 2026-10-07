/**
 * CoreDeploymentSignalSubmittedProcessor.js
 *
 * Status-driven processor for Sana SUBMITTED runs written directly to workbook sheets.
 */

var CoreDeploymentSignalSubmittedProcessor = {

  /**
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  isEnabled: function (appConfig) {
    return CoreDeploymentSignalPersistence.isEnabled(appConfig);
  },

  /**
   * @param {Object} runRow
   * @param {Array<Object>} signalRows
   * @param {Object} validIds map deploymentId -> true
   * @return {{ ok: boolean, errors: Array<string> }}
   */
  validateSubmittedRunUnit: function (runRow, signalRows, validIds) {
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
        CoreDeploymentSignalSubmittedProcessor._submittedRowToRecord_(row));
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
    if (!CoreDeploymentSignalSubmittedProcessor.isEnabled(cfg)) {
      return { ok: true, processed: [], skipped: true, reason: 'disabled' };
    }

    if (options.store) {
      return CoreDeploymentSignalSubmittedProcessor._processStore_(cfg, options);
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

      return CoreDeploymentSignalSubmittedProcessor._processRows_(
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
      Logger.log('CoreDeploymentSignalSubmittedProcessor.processSubmittedSlgSignalRuns: ' + err);
      return { ok: false, error: String(err) };
    } finally {
      lock.releaseLock();
    }
  },

  /** @private */
  _processStore_: function (cfg, options) {
    var store = options.store;
    var sig = cfg.deploymentSignal;
    var runRows = CoreDeploymentSignalStore.readBody(store, sig.signalRunsSheetName);
    var signalRows = CoreDeploymentSignalStore.readBody(store, sig.signalsSheetName);
    var historyRows = CoreDeploymentSignalStore.readBody(store, sig.signalHistorySheetName);
    return CoreDeploymentSignalSubmittedProcessor._processRows_(
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
  _processRows_: function (cfg, runRows, signalRows, historyRows, io, options) {
    options = options || {};
    var pending = CoreDeploymentSignalSubmittedProcessor._pendingSubmittedRuns_(runRows);
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

      var validation = CoreDeploymentSignalSubmittedProcessor.validateSubmittedRunUnit(
        runRow, signalRows, validIds);
      if (!validation.ok) {
        io.updateRun(runId, {
          run_status: CoreDeploymentSignalStore.RUN_STATUS_FAILED,
          persistence_status: 'FAILED',
          error_message: validation.errors.join('; ')
        });
        return {
          ok: false,
          error: validation.errors.join('; '),
          failed_run_id: runId,
          processed: processed
        };
      }

      var submittedForRun = signalRows.filter(function (r) {
        return String(r.signal_run_id) === runId &&
          String(r.signal_status) === CoreDeploymentSignalStore.SIGNAL_STATUS_SUBMITTED;
      });
      var records = submittedForRun.map(function (row) {
        return CoreDeploymentSignalSubmittedProcessor._submittedRowToRecord_(row);
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
        io.updateRun(runId, {
          run_status: CoreDeploymentSignalStore.RUN_STATUS_FAILED,
          persistence_status: 'FAILED',
          error_message: result.error || 'persist failed'
        });
        return { ok: false, error: result.error, failed_run_id: runId, processed: processed };
      }

      var emailHandoff = CoreDeploymentSignalNotification.applyPostCompleteHandoff(
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
  }
};
