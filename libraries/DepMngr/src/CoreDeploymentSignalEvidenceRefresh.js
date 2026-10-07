/**
 * CoreDeploymentSignalEvidenceRefresh.js
 *
 * Source-aware deterministic Signal evidence refresh (trajectory build).
 */

var CoreDeploymentSignalEvidenceRefresh = {

  /**
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  isEnabled: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var sig = cfg.deploymentSignal || {};
    return sig.enabled === true && cfg.appId === 'SLG';
  },

  /**
   * Authoritative SLG Signal source sheet names from configuration.
   *
   * @param {AppConfig} appConfig
   * @return {Array<string>}
   */
  resolveRequiredSourceSheets: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var sig = cfg.deploymentSignal || {};
    if (Array.isArray(sig.signalEvidenceSourceSheets) &&
        sig.signalEvidenceSourceSheets.length) {
      return sig.signalEvidenceSourceSheets.slice();
    }
    return [];
  },

  /**
   * @param {AppConfig} appConfig
   * @return {string}
   * @private
   */
  _markersPropertyKey_: function (appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    return 'deploymentSignal_sourceMarkers_v1_' + (cfg.appId || 'APP');
  },

  /**
   * @param {AppConfig} appConfig
   * @param {Object=} options { properties: ScriptProperties-like }
   * @return {Object<string,string>} sheetName -> ISO timestamp
   */
  getConsumedSourceMarkers: function (appConfig, options) {
    options = options || {};
    var props = options.properties || PropertiesService.getScriptProperties();
    var key = CoreDeploymentSignalEvidenceRefresh._markersPropertyKey_(appConfig);
    try {
      var raw = props.getProperty(key);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      Logger.log('CoreDeploymentSignalEvidenceRefresh.getConsumedSourceMarkers: ' + e);
      return {};
    }
  },

  /**
   * @param {AppConfig} appConfig
   * @param {Object<string,string>} markers
   * @param {Object=} options
   */
  setConsumedSourceMarkers: function (appConfig, markers, options) {
    options = options || {};
    var props = options.properties || PropertiesService.getScriptProperties();
    var key = CoreDeploymentSignalEvidenceRefresh._markersPropertyKey_(appConfig);
    props.setProperty(key, JSON.stringify(markers || {}));
  },

  /**
   * Compare log freshness vs consumed markers.
   *
   * @param {AppConfig} appConfig
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
   * @param {Object=} options
   * @return {Object}
   */
  evaluateRefreshDecision: function (appConfig, ss, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var required = CoreDeploymentSignalEvidenceRefresh.resolveRequiredSourceSheets(cfg);
    var logSheet = (cfg.freshness && cfg.freshness.logSheet) ||
      CoreAutoRefreshExecutionLog.DEFAULT_LOG_SHEET;
    var logState = CoreAutoRefreshExecutionLog.getLatestSuccessRefreshBySheet(ss, {
      logSheetName: logSheet,
      requiredSheets: required
    });
    if (logState.sourceNotReady.length) {
      return {
        outcome: 'SIGNAL_REFRESH_BLOCKED',
        source_not_ready: logState.sourceNotReady.slice()
      };
    }

    var consumed = CoreDeploymentSignalEvidenceRefresh.getConsumedSourceMarkers(
      cfg, options);
    var sourcesChanged = [];
    required.forEach(function (sheetName) {
      var latest = logState.latestSuccessBySheet[sheetName];
      if (!latest) return;
      var prior = consumed[sheetName] || '';
      if (!prior || latest.refreshIso !== prior) {
        sourcesChanged.push(sheetName);
      }
    });

    if (!sourcesChanged.length) {
      return { outcome: 'SIGNAL_REFRESH_NO_OP' };
    }
    return {
      outcome: 'SIGNAL_REFRESH_REBUILD',
      sources_changed: sourcesChanged,
      latest_by_sheet: logState.latestSuccessBySheet
    };
  },

  /**
   * Refresh trajectory/evidence when required connector sources advanced.
   *
   * @param {AppConfig} appConfig
   * @param {Object=} options
   * @return {Object}
   */
  refreshIfNeeded: function (appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreDeploymentSignalEvidenceRefresh.isEnabled(cfg)) {
      return { outcome: 'SIGNAL_REFRESH_SKIPPED', reason: 'disabled' };
    }

    var ss = options.spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
    var decision = CoreDeploymentSignalEvidenceRefresh.evaluateRefreshDecision(
      cfg, ss, options);
    if (decision.outcome === 'SIGNAL_REFRESH_BLOCKED') {
      Logger.log('CoreDeploymentSignalEvidenceRefresh.refreshIfNeeded: BLOCKED ' +
        JSON.stringify(decision.source_not_ready));
      return decision;
    }
    if (decision.outcome === 'SIGNAL_REFRESH_NO_OP') {
      Logger.log('CoreDeploymentSignalEvidenceRefresh.refreshIfNeeded: NO_OP');
      return decision;
    }

    var summary = CoreDeploymentTrajectory.refresh(cfg);
    if (summary && summary.skipped) {
      return {
        outcome: 'SIGNAL_REFRESH_BLOCKED',
        error: summary.reason || 'trajectory_refresh_skipped'
      };
    }

    var markers = {};
    var required = CoreDeploymentSignalEvidenceRefresh.resolveRequiredSourceSheets(cfg);
    required.forEach(function (sheetName) {
      var latest = decision.latest_by_sheet[sheetName];
      if (latest) markers[sheetName] = latest.refreshIso;
    });
    CoreDeploymentSignalEvidenceRefresh.setConsumedSourceMarkers(cfg, markers, options);

    var builtAt = (summary && summary.trajectory_built_at) || new Date().toISOString();
    Logger.log('CoreDeploymentSignalEvidenceRefresh.refreshIfNeeded: COMPLETE ' +
      JSON.stringify({ sources_changed: decision.sources_changed, build_timestamp: builtAt }));
    return {
      outcome: 'SIGNAL_REFRESH_COMPLETE',
      sources_changed: decision.sources_changed,
      build_timestamp: builtAt,
      trajectory_summary: summary
    };
  }
};
