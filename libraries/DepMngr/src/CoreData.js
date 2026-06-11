/**
 * CoreData.gs
 *
 * Shared data access + effective "view" builders for:
 *   - Active deployments (Red/Yellow effective view, or full-portfolio per viewMode)
 *   - Go Lives (recent/all, grouped by account)
 *   - Upcoming Go Lives (90-day window)
 *   - Meta + override updates (DeploymentsMeta, DeploymentOverrides, GoLivesOverrides)
 *   - Phase 2: Audit trail writes, bulk-clear endpoints, classification reads/writes,
 *     viewMode-aware filtering via CoreUsers.
 *
 * Phase 2 notes:
 *   - Backward compatible. Existing callers without viewMode args continue to
 *     work (treated as 'all' mode).
 *   - Every mutation endpoint writes an OverrideAudit row. Audit-write failures
 *     are logged but do not throw — the mutation succeeds regardless.
 *   - Bulk-clear endpoints check the current user's role and reject non-PM
 *     callers.
 *
 * Phase 3a notes (v11):
 *   - getUpcomingGoLives() now calls CoreSalesforce.getDeploymentEnrichmentMap()
 *     to get phased deployment detail. Returns one row per deployment (not per
 *     account+date). Each row gains: upcomingDates[], isPhased, nextGoLiveDate.
 *   - getAllDeployments() injects isPhased from the enrichment map so the
 *     Deployments tab can show the "Phased" pill.
 *   - Both functions degrade gracefully when the SFDC_DeploymentProductFunctions
 *     sheet is absent: enrichment map returns {}, fallback path runs unchanged.
 */

var CoreData = (function () {

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  function getSpreadsheet_() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  function getCurrentUserEmail_() {
    try {
      var e = Session.getActiveUser().getEmail();
      if (e) return e;
      e = Session.getEffectiveUser().getEmail();
      if (e) return e;
    } catch (err) {
      // Fall through
    }
    return 'unknown@workday.com';
  }

  function getDeploymentsMetaMap_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentsMeta);
    var map = {};
    if (!sheet) return map;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return map;

    values.slice(1).forEach(function (row) {
      var id = String(row[0] || '').trim();
      if (!id) return;
      map[id] = {
        deliveryDirector: row[1] || '',
        ddNotes:          row[2] || '',
        username:         row[3] || '',
        timestamp:        row[4] ? CoreUtils.formatDateToIsoString(row[4]) : ''
      };
    });
    return map;
  }

  function getDeploymentOverridesMap_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentOverrides);
    var map = {};
    if (!sheet) return map;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return map;

    var headers = values[0];
    var idxId        = headers.indexOf('DeploymentID');
    var idxHealth    = headers.indexOf('Override_Health');
    var idxMtpDate   = headers.indexOf('Override_MTPDate');
    var idxStage     = headers.indexOf('Override_Stage');
    var idxAcct      = headers.indexOf('Override_Account');
    var idxDepName   = headers.indexOf('Override_Deployment');
    var idxCurrUpd   = headers.indexOf('Override_CurrentUpdate');
    var idxExclude   = headers.indexOf('Exclude_From_Report');
    var idxUser      = headers.indexOf('LastEditedBy');
    var idxTime      = headers.indexOf('LastEditedAt');
    var idxClass     = headers.indexOf('Classification'); // Phase 2

    values.slice(1).forEach(function (row) {
      var id = String(row[idxId] || '').trim();
      if (!id) return;
      map[id] = {
        overrideHealth:        idxHealth   >= 0 ? (row[idxHealth] || '') : '',
        overrideMtp:           idxMtpDate  >= 0 ? row[idxMtpDate] : null,
        overrideStage:         idxStage    >= 0 ? (row[idxStage] || '') : '',
        overrideAccount:       idxAcct     >= 0 ? (row[idxAcct] || '') : '',
        overrideName:          idxDepName  >= 0 ? (row[idxDepName] || '') : '',
        overrideCurrentUpdate: idxCurrUpd  >= 0 ? (row[idxCurrUpd] || '') : '',
        exclude:               idxExclude  >= 0 ? Boolean(row[idxExclude]) : false,
        lastEditedBy:          idxUser     >= 0 ? (row[idxUser] || '') : '',
        lastEditedAt:          (idxTime    >= 0 && row[idxTime]) ? CoreUtils.formatDateToIsoString(row[idxTime]) : '',
        classification:        normalizeClassification_(idxClass >= 0 ? row[idxClass] : '')
      };
    });
    return map;
  }

  function getGoLivesOverridesMap_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.goLivesOverrides);
    var map = {};
    if (!sheet) return map;

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return map;

    var headers = values[0];
    var idxAcct    = headers.indexOf('AccountName');
    var idxExclude = headers.indexOf('Exclude_From_Report');
    var idxDate    = headers.indexOf('Override_GoLiveDate');
    var idxPartner = headers.indexOf('Override_Partner');
    var idxUser    = headers.indexOf('LastEditedBy');
    var idxTime    = headers.indexOf('LastEditedAt');
    var idxClass   = headers.indexOf('Classification'); // Phase 2

    values.slice(1).forEach(function (row) {
      var acct = String(row[idxAcct] || '').trim();
      if (!acct) return;
      map[acct] = {
        exclude:         idxExclude >= 0 ? Boolean(row[idxExclude]) : false,
        overrideDate:    idxDate    >= 0 ? row[idxDate] : null,
        overridePartner: idxPartner >= 0 ? (row[idxPartner] || '') : '',
        lastEditedBy:    idxUser    >= 0 ? (row[idxUser] || '') : '',
        lastEditedAt:    (idxTime   >= 0 && row[idxTime]) ? CoreUtils.formatDateToIsoString(row[idxTime]) : '',
        classification:  normalizeClassification_(idxClass >= 0 ? row[idxClass] : '')
      };
    });
    return map;
  }

  /**
   * Normalize a Classification cell value. Blank/unknown returns 'Monthly'.
   * @param {any} v
   * @return {string}  'Monthly' | 'Structural'
   * @private
   */
  function normalizeClassification_(v) {
    var s = String(v || '').trim().toLowerCase();
    if (s === 'structural') return 'Structural';
    return 'Monthly';
  }

  function buildEffectiveDeploymentRow_(rawRow, overridesMap) {
    var ov = overridesMap[rawRow.deploymentId] || {};
    return Object.assign({}, rawRow, {
      accountName:       ov.overrideAccount || rawRow.accountName,
      deploymentName:    ov.overrideName || rawRow.deploymentName,
      health:            ov.overrideHealth || rawRow.health,
      mtpDate:           ov.overrideMtp ? CoreUtils.formatDateToIsoString(ov.overrideMtp) : rawRow.mtpDate,
      stage:             ov.overrideStage || rawRow.stage,
      currentUpdate:     ov.overrideCurrentUpdate || rawRow.currentUpdate,
      excludeFromReport: !!ov.exclude,
      reviewUsername:    ov.lastEditedBy || rawRow.metaUsername || '',
      reviewTimestamp:   ov.lastEditedAt || rawRow.metaTimestamp || ''
    });
  }

  function getAllEffectiveDeployments_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.activeDeployments);
    if (!sheet) {
      throw new Error('ActiveDeployments sheet not found: ' + cfg.sheets.activeDeployments);
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var metaMap = getDeploymentsMetaMap_(cfg);
    var overridesMap = getDeploymentOverridesMap_(cfg);

    var cols = cfg.columns.deployments;
    var lastCol = sheet.getLastColumn();
    var usedCols = Math.max(lastCol, cols.DEPLOYMENT_ID);
    var dataRange = sheet.getRange(2, 1, lastRow - 1, usedCols);
    var values = dataRange.getValues();

    // Phase 3b: honour DEPLOYMENT_PHASE as a fallback when SERVICES_APPROACH is
    // not defined in the app's column config (e.g. SLG uses DEPLOYMENT_PHASE).
    var approachColNum = cols.SERVICES_APPROACH || cols.DEPLOYMENT_PHASE;

    var raw = values.map(function (row, index) {
      var deploymentId = String(row[cols.DEPLOYMENT_ID - 1] || '').trim();
      var meta = metaMap[deploymentId] || {};
      return {
        rowIndex:         index + 2,
        deploymentId:     deploymentId,
        accountName:      String(row[cols.ACCOUNT_NAME - 1] || ''),
        deploymentName:   String(row[cols.DEPLOYMENT_NAME - 1] || ''),
        servicesApproach: approachColNum ? String(row[approachColNum - 1] || '') : '',
        industry:         String(row[cols.INDUSTRY - 1] || ''),
        subRegion:        String(row[cols.SUB_REGION - 1] || ''),
        partner:          String(row[cols.PARTNER - 1] || ''),
        stage:            String(row[cols.DEPLOYMENT_STAGE - 1] || ''),
        health:           String(row[cols.DEPLOYMENT_HEALTH - 1] || ''),
        mtpDate:          row[cols.CURRENT_MTP_DATE - 1] ? CoreUtils.formatDateToIsoString(row[cols.CURRENT_MTP_DATE - 1]) : '',
        dam:              String(row[cols.DAM_FULL_NAME - 1] || ''),
        wdEngManager:     String(row[cols.WD_ENG_MANAGER - 1] || ''),
        currentUpdate:    String(row[cols.CURRENT_DEPLOYMENT_UPDATE - 1] || ''),
        deliveryDirector: meta.deliveryDirector || '',
        ddNotes:          meta.ddNotes || '',
        metaUsername:     meta.username || '',
        metaTimestamp:    meta.timestamp || ''
      };
    });

    return raw
      .map(function (r) { return buildEffectiveDeploymentRow_(r, overridesMap); })
      .filter(function (r) {
        if (!r || !r.deploymentId) return false;
        return !!(r.accountName || r.deploymentName);
      });
  }

  /**
   * Apply viewMode personalization filtering to a row set.
   * @private
   */
  function applyViewModeFilter_(cfg, rows, viewModeOpts) {
    if (!viewModeOpts || !viewModeOpts.viewMode || viewModeOpts.viewMode === 'all') {
      return rows;
    }
    if (viewModeOpts.viewMode === 'my') {
      var ddName = String(viewModeOpts.ddDisplayName || '').trim();
      if (!ddName) return [];
      return CoreUsers.filterRowsByAccountOwner(cfg, rows, ddName);
    }
    return rows;
  }

  // ===========================================================================
  // AUDIT TRAIL HELPERS
  // ===========================================================================

  /**
   * Writes a row to the OverrideAudit sheet. Best-effort: failure is logged
   * but does not throw.
   * @private
   */
  function writeAuditRow_(cfg, entry) {
    try {
      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName('OverrideAudit');
      if (!sheet) {
        Logger.log('CoreData.writeAuditRow_: OverrideAudit sheet not found; audit skipped.');
        return;
      }
      var fieldsAffected = Array.isArray(entry.fieldsAffected)
        ? entry.fieldsAffected.join(',')
        : String(entry.fieldsAffected || '');
      sheet.appendRow([
        new Date(),                              // A: Timestamp
        getCurrentUserEmail_(),                  // B: User
        String(entry.action || ''),              // C: Action
        String(entry.overrideType || ''),        // D: OverrideType
        String(entry.deploymentId || ''),        // E: DeploymentID
        String(entry.accountName || ''),         // F: AccountName
        fieldsAffected,                          // G: FieldsAffected
        String(entry.oldValueSnapshot || ''),    // H: OldValueSnapshot
        String(entry.newValueSnapshot || ''),    // I: NewValueSnapshot
        String(entry.notes || '')                // J: Notes
      ]);
    } catch (err) {
      Logger.log('CoreData.writeAuditRow_: failed: ' + err);
    }
  }

  function lookupAccountForDeployment_(cfg, deploymentId) {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.activeDeployments);
    if (!sheet) return '';
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';
    var cols = cfg.columns.deployments;
    var idValues   = sheet.getRange(2, cols.DEPLOYMENT_ID, lastRow - 1, 1).getValues();
    var acctValues = sheet.getRange(2, cols.ACCOUNT_NAME,  lastRow - 1, 1).getValues();
    var target = String(deploymentId).trim();
    for (var i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0]).trim() === target) {
        return String(acctValues[i][0] || '');
      }
    }
    return '';
  }

  function snapshotDeploymentOverride_(cfg, deploymentId) {
    var map = getDeploymentOverridesMap_(cfg);
    var row = map[String(deploymentId).trim()];
    if (!row) return { isEmpty: true };
    return {
      isEmpty: false,
      Override_Health:        row.overrideHealth || '',
      Override_MTPDate:       row.overrideMtp ? CoreUtils.formatDateToIsoString(row.overrideMtp) : '',
      Override_Stage:         row.overrideStage || '',
      Override_Account:       row.overrideAccount || '',
      Override_Deployment:    row.overrideName || '',
      Override_CurrentUpdate: row.overrideCurrentUpdate || '',
      Exclude_From_Report:    !!row.exclude,
      Classification:         row.classification || 'Monthly'
    };
  }

  function snapshotGoLivesOverride_(cfg, accountName) {
    var map = getGoLivesOverridesMap_(cfg);
    var row = map[String(accountName).trim()];
    if (!row) return { isEmpty: true };
    return {
      isEmpty: false,
      Override_GoLiveDate: row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
      Override_Partner:    row.overridePartner || '',
      Exclude_From_Report: !!row.exclude,
      Classification:      row.classification || 'Monthly'
    };
  }

  function diffSnapshotFields_(before, after) {
    var changed = [];
    Object.keys(after).forEach(function (k) {
      if (k === 'isEmpty') return;
      if (String(before[k] || '') !== String(after[k] || '')) changed.push(k);
    });
    return changed;
  }

  // ===========================================================================
  // PUBLIC: ACTIVE DEPLOYMENTS
  // ===========================================================================

  function getActiveDeployments(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var allEffective = getAllEffectiveDeployments_(cfg);

    var redYellow = allEffective
      .filter(function (r) {
        if (r.health !== 'Red' && r.health !== 'Yellow') return false;
        if (cfg.report.redYellowPartnerFilter) {
          return r.partner === cfg.report.redYellowPartnerFilter;
        }
        return true;
      })
      .sort(function (a, b) {
        if (a.health === b.health) return 0;
        return a.health < b.health ? -1 : 1;
      });

    return applyViewModeFilter_(cfg, redYellow, viewModeOpts);
  }

  /**
   * Phase 2: Returns ALL effective deployments (Red, Yellow, Green) for
   * the Expanded Deployments tab. Caller-side filtering by Health is done in JS.
   *
   * Phase 3a: Injects `isPhased` on each row using CoreSalesforce enrichment.
   * Rows not found in the enrichment map get isPhased = false.
   */
  function getAllDeployments(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var allEffective = getAllEffectiveDeployments_(cfg);

    // Phase 3a: enrich with isPhased. Degrade gracefully when sheet is absent.
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData.getAllDeployments: CoreSalesforce enrichment failed — ' +
                 'isPhased will default to false. Error: ' + err);
    }

    var sorted = allEffective.map(function (row) {
      var enrichment = enrichmentMap[row.deploymentId];
      return Object.assign({}, row, {
        isPhased: enrichment ? !!enrichment.isPhased : false
      });
    }).sort(function (a, b) {
      var rank = { 'Red': 0, 'Yellow': 1, 'Green': 2 };
      var ar = rank[a.health] !== undefined ? rank[a.health] : 99;
      var br = rank[b.health] !== undefined ? rank[b.health] : 99;
      if (ar !== br) return ar - br;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    return applyViewModeFilter_(cfg, sorted, viewModeOpts);
  }

  // ===========================================================================
  // PUBLIC: GO LIVES
  // ===========================================================================

  function getGoLives(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.goLives);
    if (!sheet) throw new Error('Go Lives sheet not found: ' + cfg.sheets.goLives);

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var dataRange = sheet.getRange(2, 1, lastRow - 1, 10);
    var values = dataRange.getValues();
    var cols = cfg.columns.goLives;

    var now = new Date();
    var windowDays = cfg.report.goLivesWindowDays;
    var windowStart = null;
    var windowEnd = null;
    if (windowDays && windowDays > 0) {
      windowEnd = now;
      windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    }

    var allGoLives = values
      .map(function (row, index) {
        var rawDate = row[cols.GO_LIVE_DATE_ACTUAL - 1];
        var dateObj = null;
        var dateString = '';
        if (rawDate) {
          dateObj = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
          if (!isNaN(dateObj.getTime())) {
            dateString = CoreUtils.formatDateToIsoString(dateObj);
          }
        }
        return {
          rowIndex:         index + 2,
          accountName:      String(row[cols.ACCOUNT_NAME - 1] || ''),
          industry:         String(row[cols.INDUSTRY - 1] || ''),
          dam:              String(row[cols.DAM_FULL_NAME - 1] || ''),
          wdEngManager:     String(row[cols.WD_ENG_MANAGER - 1] || ''),
          partner:          String(row[cols.PARTNER - 1] || ''),
          deploymentName:   String(row[cols.DEPLOYMENT_NAME - 1] || ''),
          approach:         String(row[cols.SERVICES_APPROACH - 1] || ''),
          productArea:      String(row[cols.PRODUCT_AREA - 1] || ''),
          dateObj:          dateObj,
          goLiveDateString: dateString,
          inProduction:     String(row[cols.IN_PRODUCTION - 1] || '')
        };
      })
      .filter(function (row) {
        if (!(row.accountName || row.deploymentName) || !row.dateObj) return false;
        if (isNaN(row.dateObj.getTime())) return false;
        if (windowStart && windowEnd) {
          return row.dateObj >= windowStart && row.dateObj <= windowEnd;
        }
        return true;
      });

    var groupedByAccount = {};
    allGoLives.forEach(function (row) {
      var key = row.accountName;
      if (!groupedByAccount[key]) {
        groupedByAccount[key] = {
          accountName:        row.accountName,
          industry:           row.industry,
          dam:                row.dam,
          wdEngManager:       row.wdEngManager,
          partner:            row.partner,
          deploymentName:     row.deploymentName,
          approach:           row.approach,
          productAreas:       [],
          earliestDate:       row.dateObj,
          earliestDateString: row.goLiveDateString,
          inProduction:       row.inProduction
        };
      }
      if (row.productArea && groupedByAccount[key].productAreas.indexOf(row.productArea) === -1) {
        groupedByAccount[key].productAreas.push(row.productArea);
      }
      if (row.dateObj && row.dateObj < groupedByAccount[key].earliestDate) {
        groupedByAccount[key].earliestDate = row.dateObj;
        groupedByAccount[key].earliestDateString = row.goLiveDateString;
      }
    });

    var overrides = getGoLivesOverridesMap_(cfg);
    var effective = Object.keys(groupedByAccount)
      .map(function (acct) {
        var row = groupedByAccount[acct];
        var ov = overrides[acct] || {};
        if (ov.exclude) return null;
        var effDate = ov.overrideDate
          ? CoreUtils.formatDateToIsoString(ov.overrideDate)
          : row.earliestDateString;
        return {
          accountName:       row.accountName,
          industry:          row.industry,
          dam:               row.dam,
          wdEngManager:      row.wdEngManager,
          partner:           ov.overridePartner || row.partner,
          deploymentName:    row.deploymentName,
          approach:          row.approach,
          productArea:       row.productAreas.join(', '),
          goLiveDate:        effDate,
          inProduction:      row.inProduction,
          excludeFromReport: !!ov.exclude,
          reviewUsername:    ov.lastEditedBy || '',
          reviewTimestamp:   ov.lastEditedAt || ''
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return new Date(a.goLiveDate) - new Date(b.goLiveDate); });

    return applyViewModeFilter_(cfg, effective, viewModeOpts);
  }

  /**
   * Phase 3a: Returns upcoming go-live rows for the 90-day window.
   *
   * Strategy:
   *   Pass 1 — deployments found in the CoreSalesforce enrichment map:
   *     One row per deployment, with upcomingDates[], isPhased, nextGoLiveDate.
   *   Pass 2 — fallback for deployments NOT in the enrichment map:
   *     Use Current_MTP_Date__c from ActiveDeployments (preserves Phase 1/2 behavior).
   *     upcomingDates = single-entry array, isPhased = false.
   *
   * GoLivesOverrides (exclusion + partner/date override) are applied in both passes.
   *
   * Backward-compatible output shape — adds new fields alongside existing ones:
   *   { ...existing..., deploymentId, upcomingDates[], isPhased, nextGoLiveDate }
   *   mtpDate is set to nextGoLiveDate for backward compatibility with callers
   *   that still use row.mtpDate.
   */
  function getUpcomingGoLives(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);

    // Get the effective view of all deployments (post-meta + post-overrides).
    var allEffective = getAllEffectiveDeployments_(cfg);

    // Get GoLives overrides (exclusion, partner override, date override).
    var goLivesOverrides = getGoLivesOverridesMap_(cfg);

    // Get Salesforce enrichment. Degrade gracefully on any error.
    var enrichmentMap = {};
    try {
      enrichmentMap = CoreSalesforce.getDeploymentEnrichmentMap(cfg);
    } catch (err) {
      Logger.log('CoreData.getUpcomingGoLives: CoreSalesforce enrichment failed — ' +
                 'running in fallback-only mode. Error: ' + err);
    }

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var windowDays = (cfg.salesforce && cfg.salesforce.upcomingWindowDays) || 90;
    var windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    var results = [];
    var seenDeploymentIds = {};

    // -----------------------------------------------------------------------
    // Pass 1: enrichment map — one row per deployment with product-function data.
    // -----------------------------------------------------------------------
    allEffective.forEach(function (dep) {
      if (!dep.deploymentId) return;

      var enrichment = enrichmentMap[dep.deploymentId];
      if (!enrichment) return;

      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;

      // Filter upcomingDates to those within the window.
      var datesInWindow = (enrichment.upcomingDates || []).filter(function (ud) {
        if (!ud.date) return false;
        var d = new Date(ud.date);
        return !isNaN(d.getTime()) && d >= now && d <= windowEnd;
      });
      if (datesInWindow.length === 0) return;

      // Apply override date to nextGoLiveDate if set.
      var nextGoLiveDate = ov.overrideDate
        ? CoreUtils.formatDateToIsoString(ov.overrideDate)
        : datesInWindow[0].date;

      seenDeploymentIds[dep.deploymentId] = true;
      results.push({
        rowIndex:          dep.rowIndex,
        deploymentId:      dep.deploymentId,
        accountName:       dep.accountName,
        deploymentName:    dep.deploymentName,
        servicesApproach:  dep.servicesApproach,
        industry:          dep.industry,
        subRegion:         dep.subRegion,
        partner:           ov.overridePartner || dep.partner,
        stage:             dep.stage,
        health:            dep.health,
        dam:               dep.dam,
        wdEngManager:      dep.wdEngManager,
        deliveryDirector:  dep.deliveryDirector,
        ddNotes:           dep.ddNotes,
        upcomingDates:     datesInWindow,
        isPhased:          enrichment.isPhased,
        nextGoLiveDate:    nextGoLiveDate,
        mtpDate:           nextGoLiveDate,  // backward compat alias
        excludeFromReport: !!ov.exclude,
        reviewUsername:    ov.lastEditedBy || dep.reviewUsername || '',
        reviewTimestamp:   ov.lastEditedAt || dep.reviewTimestamp || ''
      });
    });

    // -----------------------------------------------------------------------
    // Pass 2: fallback — deployments not in the enrichment map,
    // using Current_MTP_Date__c from ActiveDeployments.
    // -----------------------------------------------------------------------
    allEffective.forEach(function (dep) {
      if (!dep.deploymentId) return;
      if (seenDeploymentIds[dep.deploymentId]) return;

      var ov = goLivesOverrides[dep.accountName] || {};
      if (ov.exclude) return;

      var mtpDate = ov.overrideDate
        ? CoreUtils.formatDateToIsoString(ov.overrideDate)
        : dep.mtpDate;
      if (!mtpDate) return;

      var d = new Date(mtpDate);
      if (isNaN(d.getTime())) return;
      if (d < now || d > windowEnd) return;

      results.push({
        rowIndex:          dep.rowIndex,
        deploymentId:      dep.deploymentId,
        accountName:       dep.accountName,
        deploymentName:    dep.deploymentName,
        servicesApproach:  dep.servicesApproach,
        industry:          dep.industry,
        subRegion:         dep.subRegion,
        partner:           ov.overridePartner || dep.partner,
        stage:             dep.stage,
        health:            dep.health,
        dam:               dep.dam,
        wdEngManager:      dep.wdEngManager,
        deliveryDirector:  dep.deliveryDirector,
        ddNotes:           dep.ddNotes,
        upcomingDates:     [{ date: mtpDate, products: [] }],
        isPhased:          false,
        nextGoLiveDate:    mtpDate,
        mtpDate:           mtpDate,
        excludeFromReport: !!ov.exclude,
        reviewUsername:    ov.lastEditedBy || dep.reviewUsername || '',
        reviewTimestamp:   ov.lastEditedAt || dep.reviewTimestamp || ''
      });
    });

    // Sort by nextGoLiveDate ascending.
    results.sort(function (a, b) {
      return new Date(a.nextGoLiveDate) - new Date(b.nextGoLiveDate);
    });

    Logger.log('CoreData.getUpcomingGoLives: ' + results.length + ' upcoming rows ' +
               '(pass1=' + Object.keys(seenDeploymentIds).length + ', ' +
               'pass2=' + (results.length - Object.keys(seenDeploymentIds).length) + ').');

    return applyViewModeFilter_(cfg, results, viewModeOpts);
  }

    // ===========================================================================
  // PUBLIC: META & OVERRIDES UPDATES (Phase 2 — wrapped with audit writes)
  // ===========================================================================

  /**
   * Update or insert meta data for a deployment in DeploymentsMeta.
   * Meta data is separate from overrides — no audit write here (audit log
   * is for overrides only; meta changes are tracked via LastEditedBy/At
   * columns on the meta sheet itself).
   */
  function updateDeploymentMeta(config, deploymentId, metaData) {
    var cfg = CoreConfig.withDefaults(config);
    if (!deploymentId) throw new Error('updateDeploymentMeta: deploymentId is required');

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentsMeta);
    if (!sheet) {
      throw new Error('DeploymentsMeta sheet not found: ' + cfg.sheets.deploymentsMeta);
    }

    var targetId = String(deploymentId).trim();
    var lastRow = sheet.getLastRow();
    var rowIndex = -1;

    if (lastRow >= 2) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) {
        return String(r[0] || '').trim();
      });
      var idx = ids.indexOf(targetId);
      if (idx >= 0) rowIndex = 2 + idx;
    }

    if (rowIndex === -1) {
      rowIndex = lastRow >= 1 ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(targetId);
    }

    var user = getCurrentUserEmail_();
    var now = new Date();

    if (metaData && metaData.deliveryDirector !== undefined) {
      sheet.getRange(rowIndex, 2).setValue(metaData.deliveryDirector);
    }
    if (metaData && metaData.ddNotes !== undefined) {
      sheet.getRange(rowIndex, 3).setValue(metaData.ddNotes);
    }
    sheet.getRange(rowIndex, 4).setValue(user);
    sheet.getRange(rowIndex, 5).setValue(now);

    return { success: true };
  }

  /**
   * Update or insert a deployment override in DeploymentOverrides.
   * Phase 2: writes an OverrideAudit row capturing before/after state.
   * Phase 3d: accepts optional notes (override reason) forwarded to the audit row.
   */
  function updateDeploymentOverride(config, deploymentId, overrideData, notes) {
    var cfg = CoreConfig.withDefaults(config);
    if (!deploymentId) throw new Error('deploymentId required');

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.deploymentOverrides);
    if (!sheet) throw new Error('DeploymentOverrides sheet not found: ' + cfg.sheets.deploymentOverrides);

    // Capture before-snapshot for audit
    var before = snapshotDeploymentOverride_(cfg, deploymentId);
    var accountName = lookupAccountForDeployment_(cfg, deploymentId);

    var values = sheet.getDataRange().getValues();
    var rowIndex = -1;
    if (values.length > 1) {
      var ids = values.slice(1).map(function (r) { return String(r[0] || '').trim(); });
      var idx = ids.indexOf(String(deploymentId).trim());
      if (idx >= 0) rowIndex = idx + 2;
    }
    if (rowIndex === -1) {
      var lastRow = sheet.getLastRow();
      rowIndex = (lastRow >= 1) ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(deploymentId);
    }

    var headers = values[0] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var setCell = function (header, value) {
      var col = headers.indexOf(header);
      if (col >= 0 && value !== undefined) {
        sheet.getRange(rowIndex, col + 1).setValue(value);
      }
    };

    setCell('Override_Health', overrideData.overrideHealth);
    setCell('Override_MTPDate', overrideData.overrideMtpDate ? new Date(overrideData.overrideMtpDate) : '');
    setCell('Override_Stage', overrideData.overrideStage);
    setCell('Override_Account', overrideData.overrideAccount);
    setCell('Override_Deployment', overrideData.overrideDeployment);
    setCell('Override_CurrentUpdate', overrideData.overrideCurrentUpdate);
    setCell('Exclude_From_Report', overrideData.excludeFromReport);
    // Phase 2: classification
    if (overrideData.classification !== undefined) {
      setCell('Classification', normalizeClassification_(overrideData.classification));
    }

    var user = getCurrentUserEmail_();
    setCell('LastEditedBy', user);
    setCell('LastEditedAt', new Date());

    // Capture after-snapshot and write audit row
    var after = snapshotDeploymentOverride_(cfg, deploymentId);
    var changed = diffSnapshotFields_(before, after);
    writeAuditRow_(cfg, {
      action:           before.isEmpty ? 'CREATE' : 'UPDATE',
      overrideType:     'deployment',
      deploymentId:     deploymentId,
      accountName:      accountName,
      fieldsAffected:   changed,
      oldValueSnapshot: JSON.stringify(before),
      newValueSnapshot: JSON.stringify(after),
      notes:            String(notes || '')   // Phase 3d
    });

    return { success: true };
  }

  /**
   * Phase 3d: accepts an optional notes (override reason) string and threads
   * it through to writeAuditRow_.
   */
  function updateDeploymentWithMetaAndOverride(config, deploymentId, metaData, overrideData, notes) {
    updateDeploymentMeta(config, deploymentId, metaData);
    updateDeploymentOverride(config, deploymentId, overrideData, notes);
    return { success: true };
  }

  /**
   * Update or insert a Go Lives override row (keyed by AccountName).
   * Phase 2: writes audit row.
   * Phase 3d: accepts optional notes (override reason) forwarded to the audit row.
   */
  function updateGoLivesOverride(config, accountName, overrideData, notes) {
    var cfg = CoreConfig.withDefaults(config);
    if (!accountName) throw new Error('accountName required');

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(cfg.sheets.goLivesOverrides);
    if (!sheet) throw new Error('GoLivesOverrides sheet not found: ' + cfg.sheets.goLivesOverrides);

    var before = snapshotGoLivesOverride_(cfg, accountName);

    var values = sheet.getDataRange().getValues();
    var rowIndex = -1;
    if (values.length > 1) {
      var accts = values.slice(1).map(function (r) { return String(r[0] || '').trim(); });
      var idx = accts.indexOf(String(accountName).trim());
      if (idx >= 0) rowIndex = idx + 2;
    }
    if (rowIndex === -1) {
      var lastRow = sheet.getLastRow();
      rowIndex = (lastRow >= 1) ? lastRow + 1 : 2;
      sheet.getRange(rowIndex, 1).setValue(accountName);
    }

    var headers = values[0] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var setCell = function (header, value) {
      var col = headers.indexOf(header);
      if (col >= 0 && value !== undefined) {
        sheet.getRange(rowIndex, col + 1).setValue(value);
      }
    };

    setCell('Override_GoLiveDate', overrideData.overrideDate ? new Date(overrideData.overrideDate) : '');
    setCell('Override_Partner', overrideData.overridePartner);
    setCell('Exclude_From_Report', overrideData.excludeFromReport);
    if (overrideData.classification !== undefined) {
      setCell('Classification', normalizeClassification_(overrideData.classification));
    }

    var user = getCurrentUserEmail_();
    setCell('LastEditedBy', user);
    setCell('LastEditedAt', new Date());

    var after = snapshotGoLivesOverride_(cfg, accountName);
    var changed = diffSnapshotFields_(before, after);
    writeAuditRow_(cfg, {
      action:           before.isEmpty ? 'CREATE' : 'UPDATE',
      overrideType:     'golives',
      deploymentId:     accountName,
      accountName:      accountName,
      fieldsAffected:   changed,
      oldValueSnapshot: JSON.stringify(before),
      newValueSnapshot: JSON.stringify(after),
      notes:            String(notes || '')   // Phase 3d
    });

    return { success: true };
  }

  // ===========================================================================
  // PHASE 2: MANAGE OVERRIDES ENDPOINTS
  // ===========================================================================

  /**
   * Returns a unified list of all active overrides from DeploymentOverrides
   * and GoLivesOverrides. One row per override (not per source row).
   * Honors viewMode personalization filtering.
   *
   * Shape:
   *   {
   *     type: 'deployment' | 'golives',
   *     accountName: string,
   *     deploymentId: string,  // for deployment; accountName for golives
   *     fieldsSet: Array<string>,  // names of override fields that are non-empty
   *     currentValues: Object,  // the override values
   *     setBy: string,
   *     setAt: string (ISO),
   *     classification: 'Monthly' | 'Structural'
   *   }
   */
  function getAllActiveOverrides(config, viewModeOpts) {
    var cfg = CoreConfig.withDefaults(config);
    var out = [];

    var depMap = getDeploymentOverridesMap_(cfg);
    Object.keys(depMap).forEach(function (id) {
      var row = depMap[id];
      var fieldsSet = [];
      if (row.overrideHealth)        fieldsSet.push('Override_Health');
      if (row.overrideMtp)           fieldsSet.push('Override_MTPDate');
      if (row.overrideStage)         fieldsSet.push('Override_Stage');
      if (row.overrideAccount)       fieldsSet.push('Override_Account');
      if (row.overrideName)          fieldsSet.push('Override_Deployment');
      if (row.overrideCurrentUpdate) fieldsSet.push('Override_CurrentUpdate');
      if (row.exclude)               fieldsSet.push('Exclude_From_Report');
      if (fieldsSet.length === 0) return;

      out.push({
        type:           'deployment',
        accountName:    lookupAccountForDeployment_(cfg, id),
        deploymentId:   id,
        fieldsSet:      fieldsSet,
        currentValues: {
          health:            row.overrideHealth || '',
          mtpDate:           row.overrideMtp ? CoreUtils.formatDateToIsoString(row.overrideMtp) : '',
          stage:             row.overrideStage || '',
          account:           row.overrideAccount || '',
          deployment:        row.overrideName || '',
          currentUpdate:     row.overrideCurrentUpdate || '',
          excludeFromReport: !!row.exclude
        },
        setBy:          row.lastEditedBy || '',
        setAt:          row.lastEditedAt || '',
        classification: row.classification || 'Monthly'
      });
    });

    var golivesMap = getGoLivesOverridesMap_(cfg);
    Object.keys(golivesMap).forEach(function (acct) {
      var row = golivesMap[acct];
      var fieldsSet = [];
      if (row.overrideDate)    fieldsSet.push('Override_GoLiveDate');
      if (row.overridePartner) fieldsSet.push('Override_Partner');
      if (row.exclude)         fieldsSet.push('Exclude_From_Report');
      if (fieldsSet.length === 0) return;

      out.push({
        type:           'golives',
        accountName:    acct,
        deploymentId:   acct,
        fieldsSet:      fieldsSet,
        currentValues: {
          goLiveDate:        row.overrideDate ? CoreUtils.formatDateToIsoString(row.overrideDate) : '',
          partner:           row.overridePartner || '',
          excludeFromReport: !!row.exclude
        },
        setBy:          row.lastEditedBy || '',
        setAt:          row.lastEditedAt || '',
        classification: row.classification || 'Monthly'
      });
    });

    // Sort by setAt (most recent first)
    out.sort(function (a, b) {
      var ta = a.setAt ? new Date(a.setAt).getTime() : 0;
      var tb = b.setAt ? new Date(b.setAt).getTime() : 0;
      return tb - ta;
    });

    return applyViewModeFilter_(cfg, out, viewModeOpts);
  }

  /**
   * Returns OverrideAudit rows.
   *
   * @param {AppConfig} config
   * @param {Object=} opts  Optional. { sinceDays?: number, limit?: number }
   *   sinceDays — only rows with Timestamp >= now minus this many days
   *   limit — return at most this many rows (most recent first)
   * @return {Array<Object>}
   */
  function getOverrideAuditLog(config, opts) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName('OverrideAudit');
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    var sinceDays = (opts && opts.sinceDays) || 0;
    var limit = (opts && opts.limit) || 0;

    var cutoff = null;
    if (sinceDays > 0) {
      cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    }

    var rows = values
      .map(function (row) {
        var ts = row[0];
        var dateObj = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(dateObj.getTime())) return null;
        return {
          timestamp:        CoreUtils.formatDateToIsoString(dateObj),
          timestampMs:      dateObj.getTime(),
          user:             String(row[1] || ''),
          action:           String(row[2] || ''),
          overrideType:     String(row[3] || ''),
          deploymentId:     String(row[4] || ''),
          accountName:      String(row[5] || ''),
          fieldsAffected:   String(row[6] || ''),
          oldValueSnapshot: String(row[7] || ''),
          newValueSnapshot: String(row[8] || ''),
          notes:            String(row[9] || '')
        };
      })
      .filter(function (r) { return r !== null; })
      .filter(function (r) {
        if (!cutoff) return true;
        return r.timestampMs >= cutoff.getTime();
      });

    rows.sort(function (a, b) { return b.timestampMs - a.timestampMs; });

    if (limit > 0 && rows.length > limit) {
      rows = rows.slice(0, limit);
    }

    return rows;
  }

  /**
   * Flip the Classification of a single override row. Used by the Manage
   * Overrides tab to promote/demote individual overrides without going
   * through the full edit modal.
   *
   * PM-only — non-PM callers get rejected.
   */
  function setOverrideClassification(config, type, idOrAccount, classification) {
    var cfg = CoreConfig.withDefaults(config);
    requirePm_(cfg, 'setOverrideClassification');

    var newClassification = normalizeClassification_(classification);
    var ss = getSpreadsheet_();
    var sheetName = type === 'deployment' ? cfg.sheets.deploymentOverrides : cfg.sheets.goLivesOverrides;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { success: false, message: 'No rows in override sheet' };

    var headers = values[0];
    var idxKey   = headers.indexOf(type === 'deployment' ? 'DeploymentID' : 'AccountName');
    var idxClass = headers.indexOf('Classification');
    var idxUser  = headers.indexOf('LastEditedBy');
    var idxTime  = headers.indexOf('LastEditedAt');

    if (idxKey < 0 || idxClass < 0) {
      throw new Error('Required columns not found on ' + sheetName);
    }

    var target = String(idOrAccount).trim();
    var rowIndex = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][idxKey] || '').trim() === target) {
        rowIndex = r + 1;
        break;
      }
    }
    if (rowIndex < 0) {
      return { success: false, message: 'Override row not found for: ' + target };
    }

    // Capture before/after for audit
    var before = type === 'deployment'
      ? snapshotDeploymentOverride_(cfg, target)
      : snapshotGoLivesOverride_(cfg, target);

    sheet.getRange(rowIndex, idxClass + 1).setValue(newClassification);
    if (idxUser >= 0) sheet.getRange(rowIndex, idxUser + 1).setValue(getCurrentUserEmail_());
    if (idxTime >= 0) sheet.getRange(rowIndex, idxTime + 1).setValue(new Date());

    var after = type === 'deployment'
      ? snapshotDeploymentOverride_(cfg, target)
      : snapshotGoLivesOverride_(cfg, target);

    var accountName = type === 'deployment' ? lookupAccountForDeployment_(cfg, target) : target;

    writeAuditRow_(cfg, {
      action:           'UPDATE',
      overrideType:     type,
      deploymentId:     target,
      accountName:      accountName,
      fieldsAffected:   ['Classification'],
      oldValueSnapshot: JSON.stringify(before),
      newValueSnapshot: JSON.stringify(after)
    });

    return { success: true };
  }

  /**
   * Clears all overrides classified as 'Monthly' whose LastEditedAt falls
   * within the supplied yearMonth (or current calendar month if omitted).
   * Structural overrides are not affected.
   *
   * PM-only.
   *
   * @param {AppConfig} config
   * @param {Object=} opts  { yearMonth?: 'YYYY-MM' }
   * @return {{ success:boolean, cleared:number, deploymentCount:number, golivesCount:number }}
   */
  function bulkClearMonthlyOverrides(config, opts) {
    var cfg = CoreConfig.withDefaults(config);
    requirePm_(cfg, 'bulkClearMonthlyOverrides');

    var yearMonth = (opts && opts.yearMonth) || formatYearMonth_(new Date());
    var ym = String(yearMonth);  // 'YYYY-MM'

    var depCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.deploymentOverrides,
      'deployment',
      function (row, headers) {
        var idxClass = headers.indexOf('Classification');
        var idxTime  = headers.indexOf('LastEditedAt');
        if (idxClass < 0 || idxTime < 0) return false;
        var classification = normalizeClassification_(row[idxClass]);
        if (classification !== 'Monthly') return false;
        var ts = row[idxTime];
        if (!ts) return false;
        var d = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(d.getTime())) return false;
        return formatYearMonth_(d) === ym;
      }
    );

    var golivesCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.goLivesOverrides,
      'golives',
      function (row, headers) {
        var idxClass = headers.indexOf('Classification');
        var idxTime  = headers.indexOf('LastEditedAt');
        if (idxClass < 0 || idxTime < 0) return false;
        var classification = normalizeClassification_(row[idxClass]);
        if (classification !== 'Monthly') return false;
        var ts = row[idxTime];
        if (!ts) return false;
        var d = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(d.getTime())) return false;
        return formatYearMonth_(d) === ym;
      }
    );

    return {
      success:         true,
      cleared:         depCleared + golivesCleared,
      deploymentCount: depCleared,
      golivesCount:    golivesCleared
    };
  }

  /**
   * Clears EVERY override on both sheets, regardless of classification or date.
   * Each cleared row writes a BULK_CLEAR audit entry.
   *
   * PM-only.
   *
   * @param {AppConfig} config
   * @return {{ success:boolean, cleared:number, deploymentCount:number, golivesCount:number }}
   */
  function bulkClearAllOverrides(config) {
    var cfg = CoreConfig.withDefaults(config);
    requirePm_(cfg, 'bulkClearAllOverrides');

    var depCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.deploymentOverrides,
      'deployment',
      function () { return true; }
    );

    var golivesCleared = clearOverrideRowsByPredicate_(
      cfg,
      cfg.sheets.goLivesOverrides,
      'golives',
      function () { return true; }
    );

    return {
      success:         true,
      cleared:         depCleared + golivesCleared,
      deploymentCount: depCleared,
      golivesCount:    golivesCleared
    };
  }

  // ===========================================================================
  // INTERNAL: BULK CLEAR HELPERS
  // ===========================================================================

  /**
   * Walks the override sheet bottom-to-top, deletes rows where predicate(row,
   * headers) returns true, and writes a BULK_CLEAR audit row per deletion.
   * Bottom-to-top iteration so row indices don't shift mid-loop.
   *
   * @private
   */
  function clearOverrideRowsByPredicate_(cfg, sheetName, overrideType, predicate) {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return 0;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;

    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var idxKey = headers.indexOf(overrideType === 'deployment' ? 'DeploymentID' : 'AccountName');
    if (idxKey < 0) {
      Logger.log('clearOverrideRowsByPredicate_: key column not found in ' + sheetName);
      return 0;
    }

    var cleared = 0;
    // Iterate bottom-to-top so row deletion doesn't shift downstream indices.
    for (var r = values.length - 1; r >= 1; r--) {
      var row = values[r];
      if (!predicate(row, headers)) continue;

      var keyValue = String(row[idxKey] || '').trim();
      if (!keyValue) continue;

      // Capture snapshot before delete for audit
      var before = overrideType === 'deployment'
        ? snapshotDeploymentOverride_(cfg, keyValue)
        : snapshotGoLivesOverride_(cfg, keyValue);

      var accountName = overrideType === 'deployment'
        ? lookupAccountForDeployment_(cfg, keyValue)
        : keyValue;

      // Delete the row (1-based row index in the sheet = r + 1)
      sheet.deleteRow(r + 1);

      writeAuditRow_(cfg, {
        action:           'BULK_CLEAR',
        overrideType:     overrideType,
        deploymentId:     keyValue,
        accountName:      accountName,
        fieldsAffected:   ['*'],
        oldValueSnapshot: JSON.stringify(before),
        newValueSnapshot: JSON.stringify({ isEmpty: true })
      });

      cleared++;
    }

    return cleared;
  }

  /**
   * Format a Date as 'YYYY-MM'.
   * @private
   */
  function formatYearMonth_(date) {
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  /**
   * Enforces PM-only access. Throws on non-PM callers.
   * @private
   */
  function requirePm_(cfg, fnName) {
    var me = CoreUsers.getCurrentUser(cfg);
    if (!me || !me.isAdmin) {
      throw new Error(fnName + ': PM role required. Current user: ' +
        (me ? (me.email || 'unknown') : 'anonymous'));
    }
  }

  // ===========================================================================
  // PHASE 3f: INLINE AUDIT SUMMARY
  // ===========================================================================

  /**
   * Returns the last N audit events for a specific deployment ID.
   * Used by the expanded row detail to show an inline "Recent Activity" summary.
   * Visible to all roles (no PM gate).
   *
   * @param {AppConfig} config
   * @param {string}    deploymentId  Salesforce deployment ID or accountName
   * @param {number=}   limit         Max rows to return. Default 3.
   * @return {Array<Object>}
   */
  function getDeploymentAuditSummary(config, deploymentId, limit) {
    var cfg     = CoreConfig.withDefaults(config);
    var maxRows = (typeof limit === 'number' && limit > 0) ? limit : 3;
    var targetId = String(deploymentId || '').trim();
    if (!targetId) return [];

    var allAudit = getOverrideAuditLog(cfg, { sinceDays: 0, limit: 0 });
    var filtered = allAudit.filter(function (row) {
      return row.deploymentId === targetId || row.accountName === targetId;
    });

    // getOverrideAuditLog already returns newest-first
    return filtered.slice(0, maxRows);
  }

  // ===========================================================================
  // EXPORTS
  // ===========================================================================

  return {
    // Phase 1 surface — preserved unchanged for backward compatibility
    getActiveDeployments:                getActiveDeployments,
    getAllEffectiveDeployments:          getAllEffectiveDeployments_,
    getGoLives:                          getGoLives,
    getUpcomingGoLives:                  getUpcomingGoLives,
    updateDeploymentMeta:                updateDeploymentMeta,
    updateDeploymentOverride:            updateDeploymentOverride,
    updateDeploymentWithMetaAndOverride: updateDeploymentWithMetaAndOverride,
    updateGoLivesOverride:               updateGoLivesOverride,

    // Phase 2 additions
    getAllDeployments:           getAllDeployments,
    getAllActiveOverrides:       getAllActiveOverrides,
    getOverrideAuditLog:         getOverrideAuditLog,
    setOverrideClassification:   setOverrideClassification,
    bulkClearMonthlyOverrides:   bulkClearMonthlyOverrides,
    bulkClearAllOverrides:       bulkClearAllOverrides,

    // Phase 3f addition
    getDeploymentAuditSummary:   getDeploymentAuditSummary
  };
})();