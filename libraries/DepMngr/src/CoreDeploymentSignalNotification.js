/**
 * CoreDeploymentSignalNotification.js
 *
 * Leadership Signal email eligibility and payload contract (renderer optional).
 */

var CoreDeploymentSignalNotification = {

  NOTIFICATION_KEY: 'deployment_signal_leadership',

  /**
   * @param {Object} runRow completed run row
   * @return {boolean}
   */
  isNotificationEligible: function (runRow) {
    if (!runRow) return false;
    if (String(runRow.run_status) !== CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
      return false;
    }
    var newCount = parseInt(runRow.lifecycle_new_count, 10) || 0;
    var escCount = parseInt(runRow.lifecycle_escalated_count, 10) || 0;
    return newCount > 0 || escCount > 0;
  },

  /**
   * @param {Object} runRow
   * @param {Array<Object>} currentSignals active signals after persist
   * @param {AppConfig} appConfig
   * @return {Object}
   */
  buildPayload: function (runRow, currentSignals, appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var signals = currentSignals || [];
    var newSignals = [];
    var escalatedSignals = [];
    signals.forEach(function (s) {
      if (s.signal_status !== 'ACTIVE') return;
      if (s.lifecycle_state === 'NEW') newSignals.push(s);
      if (s.lifecycle_state === 'ESCALATED') escalatedSignals.push(s);
    });
    var ui = (cfg.ui && cfg.ui.webApp) || {};
    return {
      notificationKey: CoreDeploymentSignalNotification.NOTIFICATION_KEY,
      signal_run_id: runRow.signal_run_id,
      signal_as_of: runRow.signal_as_of,
      lifecycle_new_count: parseInt(runRow.lifecycle_new_count, 10) || 0,
      lifecycle_escalated_count: parseInt(runRow.lifecycle_escalated_count, 10) || 0,
      lifecycle_continuing_count: parseInt(runRow.lifecycle_continuing_count, 10) || 0,
      lifecycle_de_escalated_count: parseInt(runRow.lifecycle_de_escalated_count, 10) || 0,
      lifecycle_resolved_count: parseInt(runRow.lifecycle_resolved_count, 10) || 0,
      new_signals: newSignals,
      escalated_signals: escalatedSignals,
      signal_ui_url: ui.baseUrl || '',
      test_mode: true
    };
  },

  /**
   * Apply email_status on a completed run without sending unless notify rule exists.
   *
   * @param {AppConfig} appConfig
   * @param {Object} runRow
   * @param {Array<Object>} currentSignals
   * @param {Object=} options { dryRun: boolean }
   * @return {{ email_status: string, payload: (Object|null), sent: boolean }}
   */
  applyPostCompleteHandoff: function (appConfig, runRow, currentSignals, options) {
    options = options || {};
    if (!CoreDeploymentSignalNotification.isNotificationEligible(runRow)) {
      return {
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_NOT_REQUIRED,
        payload: null,
        sent: false
      };
    }
    var payload = CoreDeploymentSignalNotification.buildPayload(
      runRow, currentSignals, appConfig);
    if (options.dryRun || options.testMode) {
      Logger.log('CoreDeploymentSignalNotification.applyPostCompleteHandoff: ' +
        'eligible payload prepared (no send)');
      return {
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        payload: payload,
        sent: false
      };
    }
    return {
      email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
      payload: payload,
      sent: false
    };
  }
};
