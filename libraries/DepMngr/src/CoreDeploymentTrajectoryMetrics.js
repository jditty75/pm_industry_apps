/**
 * CoreDeploymentTrajectoryMetrics.js
 *
 * Pure metric primitives for Deployment Trajectory v1 (no SpreadsheetApp).
 * Consumed by CoreDeploymentTrajectory and Node unit tests.
 */

var TrajectoryMetrics = {

  HEALTH_FIELD: 'Overall_Health__c',
  STAGE_FIELD: 'Deployment_Stage__c',
  MTP_FIELD: 'Current_MTP_Date__c',
  BASELINE_MTP_FIELD: 'Baseline_MTP_Date__c',

  /**
   * @param {string} health
   * @return {number|null}
   */
  healthRank: function (health) {
    var h = String(health || '').trim().toLowerCase();
    if (h === 'green') return 0;
    if (h === 'yellow') return 1;
    if (h === 'red') return 2;
    return null;
  },

  /**
   * @param {string} oldVal
   * @param {string} newVal
   * @return {'deterioration'|'improvement'|null}
   */
  classifyHealthTransition: function (oldVal, newVal) {
    var oldRank = TrajectoryMetrics.healthRank(oldVal);
    var newRank = TrajectoryMetrics.healthRank(newVal);
    if (oldRank === null || newRank === null) return null;
    if (newRank > oldRank) return 'deterioration';
    if (newRank < oldRank) return 'improvement';
    return null;
  },

  /**
   * Whole days from fromStr to toStr (signed). Invalid dates => null.
   * @param {string} fromStr YYYY-MM-DD
   * @param {string} toStr YYYY-MM-DD
   * @return {number|null}
   */
  signedDaysBetween: function (fromStr, toStr) {
    if (!fromStr || !toStr) return null;
    var from = new Date(fromStr + 'T00:00:00Z');
    var to = new Date(toStr + 'T00:00:00Z');
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  },

  /**
   * @param {string} dateStr
   * @param {string} todayStr YYYY-MM-DD
   * @return {boolean}
   */
  isOnOrAfterCutoff: function (dateStr, cutoffStr) {
    if (!dateStr || !cutoffStr) return false;
    return dateStr >= cutoffStr;
  },

  /**
   * @param {string} todayStr
   * @param {number} days
   * @return {string}
   */
  dateMinusDays: function (todayStr, days) {
    var d = new Date(todayStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  },

  /**
   * Build health trajectory metrics from chronological field events.
   * @param {Array<{atDate:string, old:string, new:string}>} events
   * @param {string} currentHealth
   * @param {string} todayStr
   * @return {Object}
   */
  computeHealthMetrics: function (events, currentHealth, todayStr) {
    events = events || [];
    var cutoff30 = TrajectoryMetrics.dateMinusDays(todayStr, 30);
    var cutoff90 = TrajectoryMetrics.dateMinusDays(todayStr, 90);

    var changes30 = 0;
    var changes90 = 0;
    var deteriorations90 = 0;
    var improvements90 = 0;
    var healthEventCount = events.length;
    var lastChangeDate = '';
    var previousHealth = '';

    events.forEach(function (ev, idx) {
      var atDate = ev.atDate || '';
      if (atDate) {
        lastChangeDate = atDate;
        previousHealth = ev.old || '';
      }
      if (TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff30)) changes30++;
      if (TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff90)) changes90++;

      var cls = TrajectoryMetrics.classifyHealthTransition(ev.old, ev.new);
      if (cls === 'deterioration' && TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff90)) {
        deteriorations90++;
      }
      if (cls === 'improvement' && TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff90)) {
        improvements90++;
      }
      if (idx === events.length - 1 && ev.old) {
        previousHealth = ev.old;
      }
    });

    if (!events.length) {
      previousHealth = '';
      lastChangeDate = '';
    } else if (events.length >= 1) {
      previousHealth = events[events.length - 1].old || '';
      lastChangeDate = events[events.length - 1].atDate || '';
    }

    var daysAtCurrent = 0;
    if (lastChangeDate) {
      var d = TrajectoryMetrics.signedDaysBetween(lastChangeDate, todayStr);
      daysAtCurrent = d !== null && d >= 0 ? d : 0;
    }

    return {
      previous_health: previousHealth,
      health_last_change_date: lastChangeDate,
      days_at_current_health: daysAtCurrent,
      health_changes_30d: changes30,
      health_changes_90d: changes90,
      health_changes_total: healthEventCount,
      health_deteriorations_90d: deteriorations90,
      health_improvements_90d: improvements90,
      health_event_count: healthEventCount,
      current_health: currentHealth || ''
    };
  },

  /**
   * @param {Array<{atDate:string, oldDate:string|null, newDate:string|null, movementDays:number|null}>} mtpEvents
   * @param {string} currentMtp
   * @param {string} baselineMtp
   * @param {string} todayStr
   * @return {Object}
   */
  computeMtpMetrics: function (mtpEvents, currentMtp, baselineMtp, todayStr) {
    mtpEvents = mtpEvents || [];
    var warnings = [];
    var cutoff30 = TrajectoryMetrics.dateMinusDays(todayStr, 30);
    var cutoff90 = TrajectoryMetrics.dateMinusDays(todayStr, 90);

    var validNewDates = [];
    mtpEvents.forEach(function (ev) {
      if (ev.newDate) validNewDates.push(ev.newDate);
    });

    var earliestRecorded = '';
    if (validNewDates.length) {
      earliestRecorded = validNewDates.slice().sort()[0];
    }

    var baseline = baselineMtp || '';
    var previousMtp = '';
    var lastChangeDate = '';
    var lastChangeDays = null;
    var changes30 = 0;
    var changes90 = 0;
    var slips90 = 0;
    var accelerations90 = 0;
    var slipDays90 = 0;
    var grossMovement = 0;

    if (mtpEvents.length) {
      var last = mtpEvents[mtpEvents.length - 1];
      previousMtp = last.oldDate || '';
      lastChangeDate = last.atDate || '';
      lastChangeDays = last.movementDays;
    }

    mtpEvents.forEach(function (ev) {
      var atDate = ev.atDate || '';
      if (TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff30)) changes30++;
      if (TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff90)) changes90++;

      if (ev.movementDays === null) {
        warnings.push('mtp_event_invalid_dates:' + atDate);
        return;
      }
      grossMovement += Math.abs(ev.movementDays);

      if (TrajectoryMetrics.isOnOrAfterCutoff(atDate, cutoff90)) {
        if (ev.movementDays > 0) {
          slips90++;
          slipDays90 += ev.movementDays;
        } else if (ev.movementDays < 0) {
          accelerations90++;
        }
      }
    });

    var comparisonPoint = earliestRecorded || baseline || '';
    var netMovement = null;
    var netComparisonUsed = '';
    if (currentMtp && comparisonPoint) {
      netMovement = TrajectoryMetrics.signedDaysBetween(comparisonPoint, currentMtp);
      netComparisonUsed = earliestRecorded ? 'earliest_recorded_current_mtp' : 'baseline_mtp';
    } else if (currentMtp && !comparisonPoint) {
      warnings.push('mtp_net_movement_missing_comparison_point');
    }

    var daysUntilCurrent = null;
    if (currentMtp) {
      daysUntilCurrent = TrajectoryMetrics.signedDaysBetween(todayStr, currentMtp);
      if (daysUntilCurrent === null) warnings.push('mtp_days_until_invalid_current');
    }

    return {
      baseline_mtp: baseline,
      earliest_recorded_mtp: earliestRecorded,
      previous_mtp: previousMtp,
      mtp_last_change_date: lastChangeDate,
      mtp_last_change_days: lastChangeDays,
      mtp_changes_30d: changes30,
      mtp_changes_90d: changes90,
      mtp_changes_total: mtpEvents.length,
      mtp_slips_90d: slips90,
      mtp_accelerations_90d: accelerations90,
      mtp_event_count: mtpEvents.length,
      mtp_net_movement_days: netMovement,
      mtp_net_movement_comparison: netComparisonUsed,
      mtp_gross_movement_days: grossMovement,
      mtp_slip_days_90d: slipDays90,
      days_until_current_mtp: daysUntilCurrent,
      mtp_warnings: warnings
    };
  },

  /**
   * @param {Array<{atDate:string, old:string, new:string}>} events
   * @param {string} currentStage
   * @param {string} todayStr
   * @return {Object}
   */
  computeStageMetrics: function (events, currentStage, todayStr) {
    events = events || [];
    var cutoff30 = TrajectoryMetrics.dateMinusDays(todayStr, 30);
    var cutoff90 = TrajectoryMetrics.dateMinusDays(todayStr, 90);
    var changes30 = 0;
    var changes90 = 0;
    var lastChangeDate = '';
    var previousStage = '';

    events.forEach(function (ev) {
      if (TrajectoryMetrics.isOnOrAfterCutoff(ev.atDate, cutoff30)) changes30++;
      if (TrajectoryMetrics.isOnOrAfterCutoff(ev.atDate, cutoff90)) changes90++;
    });

    if (events.length) {
      var last = events[events.length - 1];
      previousStage = last.old || '';
      lastChangeDate = last.atDate || '';
    }

    var daysInStage = 0;
    if (lastChangeDate) {
      var d = TrajectoryMetrics.signedDaysBetween(lastChangeDate, todayStr);
      daysInStage = d !== null && d >= 0 ? d : 0;
    }

    return {
      previous_stage: previousStage,
      stage_last_change_date: lastChangeDate,
      days_in_current_stage: daysInStage,
      stage_changes_30d: changes30,
      stage_changes_90d: changes90,
      stage_changes_total: events.length,
      current_stage: currentStage || ''
    };
  },

  /**
   * Parses Salesforce relationship Id cells (pure).
   * @param {string} raw
   * @return {string}
   */
  parseRelationshipIdField: function (raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^[a-zA-Z0-9]{15,18}$/.test(s)) return s;
    var match = s.match(/(?:^|[,{]\s*)Id=([a-zA-Z0-9]{15,18})/);
    if (match && match[1]) return match[1];
    return s;
  }
};
