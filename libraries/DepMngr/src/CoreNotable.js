/**
 * CoreNotable.gs
 *
 * Notable Deployments backend module for DepMngr.
 *
 * Responsibilities:
 *  - Read notable deployment rows from Mariah's shared peer sheet.
 *  - Join peer rows with each app's effective (local) deployments on
 *    15-character Deployment ID prefix.
 *  - Allow power users to add new notable rows or update existing ones
 *    (10 editable fields only).
 *  - Write audit entries to OverrideAudit in the current app spreadsheet.
 *  - Send email notifications on add/update.
 *  - Config-driven per app via cfg.notable (see CoreConfig.withDefaults).
 *
 * Part 1 scope: server-side only. No WebApp endpoints or UI.
 * Part 5 scope: _warmNotable(cfg) pre-warm hook for 5-minute trigger.
 *
 * Sheets consumed:
 *  - Peer sheet: SpreadsheetApp.openById(cfg.notable.sheetId),
 *                tab cfg.notable.tabName (default 'FY27 MASTER_Curated')
 *  - OverrideAudit: SpreadsheetApp.getActiveSpreadsheet() — local app sheet
 *
 * Public surface:
 *  getNotableForApp(cfg)
 *  updateNotableDeployment(cfg, deploymentId, fieldUpdates, notes)
 *  addNotableDeployment(cfg, deploymentId, fieldUpdates, notes)
 *  _clearNotableCache(cfg)
 */

var CoreNotable = (function () {

  // Per-execution in-memory cache.
  var _cache = {
    peerRows:  null,  // Array of peer row objects keyed by header name + _rowIndex
    headerMap: null   // { lowercaseHeaderName: colIndex1Based }
  };

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Returns an array of notable deployments for this app, joining Mariah's
   * peer sheet with the app's effective deployments on 15-char Deployment ID
   * prefix match.
   *
   * Sorting: Region Restricted rows last, then accountName ascending.
   *
   * Each record contains all peer fields plus a `local` sub-object:
   *   { deploymentName, partner, health, stage, mtpDate, servicesApproach }
   *
   * @param {AppConfig} config
   * @return {Array<Object>}
   */
  function getNotableForApp(config) {
    var cfg = CoreConfig.withDefaults(config);
    Logger.log('CoreNotable.getNotableForApp: reading peer sheet for app ' + cfg.appId);

    var peerRows = readPeerSheet_(cfg);
    var localDeployments = CoreData.getAllEffectiveDeployments(cfg);
    Logger.log('CoreNotable.getNotableForApp: peerRows=' + peerRows.length +
               ', localDeployments=' + localDeployments.length);

    return joinAndSort_(peerRows, localDeployments, cfg);
  }

  /**
   * Updates the 10 editable fields on an existing notable peer row.
   *
   * Guard: requires power-user access (CoreUsers.requirePowerUser_).
   *
   * @param {AppConfig} config
   * @param {string}    deploymentId   Full or 15-char-prefix Deployment ID.
   * @param {Object}    fieldUpdates   Map of editable header name -> new value.
   * @param {string=}   notes          Optional change notes for audit trail.
   * @return {{ success: boolean, rowIndex: number }}
   */
  function updateNotableDeployment(config, deploymentId, fieldUpdates, notes) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);

    var shortId = String(deploymentId || '').trim().slice(0, 15);
    if (!shortId) throw new Error('CoreNotable.updateNotableDeployment: deploymentId is required.');

    // Find the peer row.
    var peerRows = readPeerSheet_(cfg);
    var targetRow = null;
    for (var i = 0; i < peerRows.length; i++) {
      var pid = String(peerRows[i][cfg.notable.deploymentIdHeader] || '').trim();
      if (pid.slice(0, 15) === shortId) {
        targetRow = peerRows[i];
        break;
      }
    }
    if (!targetRow) {
      throw new Error('CoreNotable.updateNotableDeployment: no peer row found for deployment: ' + deploymentId);
    }

    var rowIndex = targetRow._rowIndex;

    // Open the peer sheet for writing.
    var peerSs;
    try {
      peerSs = SpreadsheetApp.openById(cfg.notable.sheetId);
    } catch (err) {
      throw new Error('CoreNotable.updateNotableDeployment: cannot open peer sheet: ' + err);
    }
    var peerSheet = peerSs.getSheetByName(cfg.notable.tabName);
    if (!peerSheet) {
      throw new Error('CoreNotable.updateNotableDeployment: tab "' + cfg.notable.tabName + '" not found.');
    }

    var headerMap = buildHeaderMap_(peerSheet, cfg.notable.headerRow);

    // Build a set of allowed editable headers for quick lookup.
    var editableSet = {};
    for (var e = 0; e < cfg.notable.editableColumnHeaders.length; e++) {
      editableSet[cfg.notable.editableColumnHeaders[e]] = true;
    }

    var oldValues = {};
    var newValues = {};
    var fieldsChanged = [];

    for (var key in fieldUpdates) {
      if (!Object.prototype.hasOwnProperty.call(fieldUpdates, key)) continue;
      if (!editableSet[key]) {
        Logger.log('CoreNotable.updateNotableDeployment: skipping non-editable field "' + key + '".');
        continue;
      }
      var colIdx = getColIdx_(headerMap, key);
      if (!colIdx) {
        Logger.log('CoreNotable.updateNotableDeployment: header "' + key + '" not found in peer sheet; skipping.');
        continue;
      }
      var oldVal = String(targetRow[key] !== undefined ? targetRow[key] : '');
      var newVal = String(fieldUpdates[key] !== undefined ? fieldUpdates[key] : '');
      if (oldVal === newVal) continue;

      peerSheet.getRange(rowIndex, colIdx).setValue(newVal);
      oldValues[key] = oldVal;
      newValues[key] = newVal;
      fieldsChanged.push(key);
    }

    var accountName = String(targetRow['Customer (Account) Name'] || '');

    writeAuditRow_(cfg, {
      action:           'NOTABLE_UPDATE',
      overrideType:     'notable',
      deploymentId:     deploymentId,
      accountName:      accountName,
      fieldsAffected:   fieldsChanged,
      oldValueSnapshot: JSON.stringify(oldValues),
      newValueSnapshot: JSON.stringify(newValues),
      notes:            notes || ''
    });

    notify_(cfg, {
      action:        'update',
      accountName:   accountName,
      deploymentId:  deploymentId,
      fieldsChanged: fieldsChanged,
      oldValues:     oldValues,
      newValues:     newValues,
      notes:         notes || ''
    });

    _clearNotableCache(cfg);

    Logger.log('CoreNotable.updateNotableDeployment: updated row ' + rowIndex +
               ', fields=' + fieldsChanged.join(','));
    return { success: true, rowIndex: rowIndex };
  }

  /**
   * Appends a new row to Mariah's peer sheet for a deployment that exists in
   * this app's effective deployments but is not yet notable.
   *
   * Guard: requires power-user access.
   * Duplicate check: throws DUPLICATE: ... if a peer row already exists.
   *
   * @param {AppConfig} config
   * @param {string}    deploymentId   Full or 15-char-prefix Deployment ID.
   * @param {Object}    fieldUpdates   Field overrides; must include 'Notability Trigger'.
   * @param {string=}   notes          Optional change notes for audit trail.
   * @return {{ success: boolean, rowIndex: number }}
   */
  function addNotableDeployment(config, deploymentId, fieldUpdates, notes) {
    var cfg = CoreConfig.withDefaults(config);
    CoreUsers.requirePowerUser_(cfg);

    var shortId = String(deploymentId || '').trim().slice(0, 15);
    if (!shortId) throw new Error('CoreNotable.addNotableDeployment: deploymentId is required.');

    if (!fieldUpdates || !String(fieldUpdates['Notability Trigger'] || '').trim()) {
      throw new Error('CoreNotable.addNotableDeployment: fieldUpdates["Notability Trigger"] is required.');
    }

    // Verify deployment exists in this app's effective deployments.
    var localDeployments = CoreData.getAllEffectiveDeployments(cfg);
    var localRow = null;
    for (var i = 0; i < localDeployments.length; i++) {
      var lid = String(localDeployments[i].deploymentId || '').trim();
      if (lid.slice(0, 15) === shortId) {
        localRow = localDeployments[i];
        break;
      }
    }
    if (!localRow) {
      throw new Error('CoreNotable.addNotableDeployment: deploymentId not found in ' +
                      cfg.appId + ' effective deployments: ' + deploymentId);
    }

    // Duplicate check: fail fast if a peer row already exists.
    var peerRows = readPeerSheet_(cfg);
    for (var j = 0; j < peerRows.length; j++) {
      var pid = String(peerRows[j][cfg.notable.deploymentIdHeader] || '').trim();
      if (pid.slice(0, 15) === shortId) {
        throw new Error('DUPLICATE: a notable row already exists for deployment ' + deploymentId);
      }
    }

    // Open the peer sheet for writing.
    var peerSs;
    try {
      peerSs = SpreadsheetApp.openById(cfg.notable.sheetId);
    } catch (err) {
      throw new Error('CoreNotable.addNotableDeployment: cannot open peer sheet: ' + err);
    }
    var peerSheet = peerSs.getSheetByName(cfg.notable.tabName);
    if (!peerSheet) {
      throw new Error('CoreNotable.addNotableDeployment: tab "' + cfg.notable.tabName + '" not found.');
    }

    var headerMap = buildHeaderMap_(peerSheet, cfg.notable.headerRow);
    var numCols = peerSheet.getLastColumn();

    // Build an empty row array.
    var newRow = [];
    for (var c = 0; c < numCols; c++) newRow.push('');

    // Auto-fill from local deployment data.
    var autoFill = {
      'Customer (Account) Name': localRow.accountName   || '',
      'Industry':                localRow.industry      || '',
      'PS Region New':           localRow.subRegion     || '',
      'Deployment(s) Name':      localRow.deploymentName || '',
      'Deployment Partner Name': localRow.partner       || '',
      'Deployment Health':       localRow.health        || '',
      'Deployment Status':       'Active',
      'Target MTP Date':         localRow.mtpDate       || ''
    };
    // Deployment ID goes in column AM (cfg.notable.deploymentIdHeader).
    autoFill[cfg.notable.deploymentIdHeader] = String(deploymentId).trim();
    // Default Data Validation Status to Raw/Unverified if caller did not supply it.
    if (!String((fieldUpdates || {})['Data Validation Status'] || '').trim()) {
      autoFill['Data Validation Status'] = cfg.notable.validationStatusOptions[0];
    }

    setRowValues_(newRow, headerMap, autoFill);

    // Overlay fieldUpdates on top (user values win over auto-fill).
    if (fieldUpdates) setRowValues_(newRow, headerMap, fieldUpdates);

    peerSheet.appendRow(newRow);
    var newRowIndex = peerSheet.getLastRow();

    var accountName = String(newRow[getColIdx_(headerMap, 'Customer (Account) Name') - 1] || localRow.accountName || '');

    writeAuditRow_(cfg, {
      action:           'NOTABLE_ADD',
      overrideType:     'notable',
      deploymentId:     deploymentId,
      accountName:      accountName,
      fieldsAffected:   Object.keys(fieldUpdates || {}),
      oldValueSnapshot: JSON.stringify({}),
      newValueSnapshot: JSON.stringify(fieldUpdates || {}),
      notes:            notes || ''
    });

    notify_(cfg, {
      action:             'add',
      accountName:        accountName,
      deploymentId:       deploymentId,
      notabilityTrigger:  String(fieldUpdates['Notability Trigger'] || ''),
      fieldsChanged:      Object.keys(fieldUpdates || {}),
      notes:              notes || ''
    });

    _clearNotableCache(cfg);

    Logger.log('CoreNotable.addNotableDeployment: appended row ' + newRowIndex + ' for ' + deploymentId);
    return { success: true, rowIndex: newRowIndex };
  }

  /**
   * Clears the per-execution in-memory cache.
   * Part 1: in-memory only. Part 5 will integrate with _PerfCache if needed.
   *
   * @param {AppConfig} config  (accepted for future use; not consumed in Part 1)
   */
  function _clearNotableCache(config) {  // eslint-disable-line no-unused-vars
    _cache.peerRows  = null;
    _cache.headerMap = null;
    Logger.log('CoreNotable._clearNotableCache: cache cleared.');
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS — PEER SHEET
  // ---------------------------------------------------------------------------

  /**
   * Reads all data rows from the peer sheet (Mariah's sheet) and returns
   * an array of objects keyed by header name plus _rowIndex (1-based).
   * Results are cached per execution.
   *
   * @param {AppConfig} cfg  (already defaulted)
   * @return {Array<Object>}
   * @private
   */
  function readPeerSheet_(cfg) {
    if (_cache.peerRows) return _cache.peerRows;

    var ss;
    try {
      ss = SpreadsheetApp.openById(cfg.notable.sheetId);
    } catch (err) {
      Logger.log('CoreNotable.readPeerSheet_: openById failed: ' + err);
      return [];
    }

    var sheet = ss.getSheetByName(cfg.notable.tabName);
    if (!sheet) {
      Logger.log('CoreNotable.readPeerSheet_: tab "' + cfg.notable.tabName + '" not found in peer sheet.');
      return [];
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < cfg.notable.dataStartRow) return [];

    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return [];

    var headerValues = sheet.getRange(cfg.notable.headerRow, 1, 1, lastCol).getValues()[0];
    var headers = headerValues.map(function (h) { return String(h || '').trim(); });

    var numDataRows = lastRow - cfg.notable.dataStartRow + 1;
    var dataValues = sheet.getRange(cfg.notable.dataStartRow, 1, numDataRows, lastCol).getValues();

    var rows = dataValues.map(function (row, idx) {
      var obj = { _rowIndex: cfg.notable.dataStartRow + idx };
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) obj[headers[c]] = row[c];
      }
      return obj;
    });

    _cache.peerRows = rows;
    Logger.log('CoreNotable.readPeerSheet_: cached ' + rows.length + ' rows.');
    return rows;
  }

  /**
   * Joins peer rows with local effective deployments on 15-char ID prefix.
   * Peer rows without a matching local deployment are excluded.
   *
   * @param {Array<Object>} peerRows
   * @param {Array<Object>} localDeployments
   * @param {AppConfig}     cfg  (already defaulted)
   * @return {Array<Object>}
   * @private
   */
  function joinAndSort_(peerRows, localDeployments, cfg) {
    // Build local-deployment lookup by 15-char prefix.
    var localMap = {};
    for (var i = 0; i < localDeployments.length; i++) {
      var ld = localDeployments[i];
      var shortId = String(ld.deploymentId || '').trim().slice(0, 15);
      if (shortId) localMap[shortId] = ld;
    }

    var joined = [];
    for (var j = 0; j < peerRows.length; j++) {
      var peer = peerRows[j];
      var peerId = String(peer[cfg.notable.deploymentIdHeader] || '').trim();
      if (!peerId) continue;
      var peerShortId = peerId.slice(0, 15);
      var local = localMap[peerShortId];
      if (!local) continue;

      var record = {};
      // Copy all peer fields (including _rowIndex).
      for (var key in peer) {
        if (Object.prototype.hasOwnProperty.call(peer, key)) record[key] = peer[key];
      }
      // Attach local sub-object.
      record.local = {
        deploymentName:   local.deploymentName   || '',
        partner:          local.partner          || '',
        health:           local.health           || '',
        stage:            local.stage            || '',
        mtpDate:          local.mtpDate          || '',
        servicesApproach: local.servicesApproach || ''
      };
      joined.push(record);
    }

    // Sort: Region Restricted last, then accountName ascending.
    var restrictedStatus = cfg.notable.validationStatusOptions[2]; // 'Region Restricted'
    joined.sort(function (a, b) {
      var aRestricted = String(a['Data Validation Status'] || '').trim() === restrictedStatus;
      var bRestricted = String(b['Data Validation Status'] || '').trim() === restrictedStatus;
      if (aRestricted !== bRestricted) return aRestricted ? 1 : -1;
      var aName = String(a['Customer (Account) Name'] || '').toLowerCase();
      var bName = String(b['Customer (Account) Name'] || '').toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });

    return joined;
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS — COLUMN MAPPING
  // ---------------------------------------------------------------------------

  /**
   * Reads the header row from a sheet and returns a map of
   * lowercased header name -> 1-based column index.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {number} headerRow  1-based row number of the header row.
   * @return {Object<string, number>}
   * @private
   */
  function buildHeaderMap_(sheet, headerRow) {
    var lastCol = sheet.getLastColumn();
    var headerValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
    var map = {};
    for (var c = 0; c < headerValues.length; c++) {
      var h = String(headerValues[c] || '').trim();
      if (h) map[h.toLowerCase()] = c + 1;
    }
    return map;
  }

  /**
   * Returns the 1-based column index for a header name, or 0 if not found.
   * Comparison is case-insensitive.
   *
   * @param {Object<string, number>} headerMap
   * @param {string} headerName
   * @return {number}
   * @private
   */
  function getColIdx_(headerMap, headerName) {
    return headerMap[String(headerName || '').trim().toLowerCase()] || 0;
  }

  /**
   * Sets values in a row array for each key in valueMap, using headerMap
   * to resolve column indices. Keys not found in headerMap are silently skipped.
   *
   * @param {Array}             rowArr     Mutable row array (0-indexed).
   * @param {Object<string,number>} headerMap  Lowercase header -> 1-based col index.
   * @param {Object}            valueMap   Header name -> value.
   * @private
   */
  function setRowValues_(rowArr, headerMap, valueMap) {
    for (var key in valueMap) {
      if (!Object.prototype.hasOwnProperty.call(valueMap, key)) continue;
      var colIdx = getColIdx_(headerMap, key);
      if (colIdx > 0 && colIdx <= rowArr.length) {
        rowArr[colIdx - 1] = valueMap[key] !== undefined ? valueMap[key] : '';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS — AUDIT
  // ---------------------------------------------------------------------------

  /**
   * Appends a row to OverrideAudit in the current app spreadsheet.
   * Best-effort: failure is logged but does not propagate.
   * Matches the column layout used by CoreData.writeAuditRow_.
   *
   * @param {AppConfig} cfg
   * @param {Object}    entry
   * @param {string}    entry.action
   * @param {string}    entry.overrideType
   * @param {string}    entry.deploymentId
   * @param {string}    entry.accountName
   * @param {Array<string>|string} entry.fieldsAffected
   * @param {string}    entry.oldValueSnapshot
   * @param {string}    entry.newValueSnapshot
   * @param {string}    entry.notes
   * @private
   */
  function writeAuditRow_(cfg, entry) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('OverrideAudit');
      if (!sheet) {
        Logger.log('CoreNotable.writeAuditRow_: OverrideAudit sheet not found; audit skipped.');
        return;
      }
      var fieldsAffected = Array.isArray(entry.fieldsAffected)
        ? entry.fieldsAffected.join(',')
        : String(entry.fieldsAffected || '');
      var userEmail = CoreUsers.getCurrentUserAccess(cfg).email || '';
      sheet.appendRow([
        new Date(),                                    // A: Timestamp
        userEmail,                                     // B: User
        String(entry.action        || ''),             // C: Action
        String(entry.overrideType  || ''),             // D: OverrideType
        String(entry.deploymentId  || ''),             // E: DeploymentID
        String(entry.accountName   || ''),             // F: AccountName
        fieldsAffected,                                // G: FieldsAffected
        String(entry.oldValueSnapshot || ''),          // H: OldValueSnapshot
        String(entry.newValueSnapshot || ''),          // I: NewValueSnapshot
        String(entry.notes         || '')              // J: Notes
      ]);
    } catch (err) {
      Logger.log('CoreNotable.writeAuditRow_: failed: ' + err);
    }
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS — NOTIFICATION
  // ---------------------------------------------------------------------------

  /**
   * Sends an email notification for a notable add or update.
   * Recipient is controlled by cfg.notable.notify.useTestMode.
   * Slack fields exist in config but are no-op in Part 1.
   * Failure is logged but does not propagate.
   *
   * @param {AppConfig} cfg
   * @param {Object}    payload
   * @param {string}    payload.action           'add' | 'update'
   * @param {string}    payload.accountName
   * @param {string}    payload.deploymentId
   * @param {string=}   payload.notabilityTrigger  (add only)
   * @param {Array<string>=} payload.fieldsChanged
   * @param {Object=}   payload.oldValues
   * @param {Object=}   payload.newValues
   * @param {string=}   payload.notes
   * @private
   */
  function notify_(cfg, payload) {
    var notifyCfg = (cfg.notable && cfg.notable.notify) || {};
    var recipient = notifyCfg.useTestMode
      ? (notifyCfg.testEmail || '')
      : (notifyCfg.email || '');

    if (!recipient) {
      Logger.log('CoreNotable.notify_: no recipient configured; notification skipped.');
      return;
    }

    var appId = cfg.appId || 'Unknown';
    var peerSheetUrl = 'https://docs.google.com/spreadsheets/d/' +
                       (cfg.notable.sheetId || '') + '/edit';
    var actionLabel = payload.action === 'add' ? 'Added' : 'Updated';

    var subject = '[' + appId + '] Notable Deployment ' + actionLabel +
                  ': ' + (payload.accountName || payload.deploymentId || '');

    var lines = [
      'App: ' + appId,
      'Account: ' + (payload.accountName || ''),
      'Deployment ID: ' + (payload.deploymentId || ''),
      'Action: ' + (payload.action || '')
    ];

    if (payload.action === 'add' && payload.notabilityTrigger) {
      lines.push('Notability Trigger: ' + payload.notabilityTrigger);
    }

    var changed = payload.fieldsChanged || [];
    if (changed.length) {
      lines.push('Fields Changed: ' + changed.join(', '));
    }

    if (payload.notes) {
      lines.push('Notes: ' + payload.notes);
    }

    lines.push('');
    lines.push('Peer Sheet: ' + peerSheetUrl);

    try {
      MailApp.sendEmail({
        to:      recipient,
        subject: subject,
        body:    lines.join('\n')
      });
      Logger.log('CoreNotable.notify_: sent to ' + recipient +
                 ' (testMode=' + !!notifyCfg.useTestMode + ')');
    } catch (err) {
      Logger.log('CoreNotable.notify_: email send failed: ' + err);
    }
  }

  // ---------------------------------------------------------------------------
  // PRE-WARM
  // ---------------------------------------------------------------------------

  /**
   * Pre-warms the in-memory cache for this app's notable deployments.
   * Clears the current cache, reads the peer sheet raw rows, then builds
   * the joined view so the next user-triggered endpoint hits warm data.
   * Called by CoreSalesforce._warmCaches on every 5-minute background run.
   *
   * @param {AppConfig} config
   * @return {{ ok: boolean, peerRows: number, matched: number }}
   */
  function _warmNotable(config) {
    try {
      var cfg = CoreConfig.withDefaults(config);
      // Reset in-memory cache to force a fresh read from the peer sheet.
      _cache.peerRows  = null;
      _cache.headerMap = null;
      // Populate raw peer sheet rows (also fills _cache.peerRows).
      var peerRows = readPeerSheet_(cfg);
      // Build and return the joined view for this app's portfolio.
      var joined = getNotableForApp(cfg);
      var n = peerRows.length;
      var m = joined.length;
      Logger.log('CoreNotable._warmNotable(' + cfg.appId + '): ' + n +
                 ' peer rows, ' + m + ' matched for this app.');
      return { ok: true, peerRows: n, matched: m };
    } catch (err) {
      Logger.log('CoreNotable._warmNotable: error: ' + err);
      return { ok: false };
    }
  }

  // ---------------------------------------------------------------------------
  // EXPORTS
  // ---------------------------------------------------------------------------

  return {
    getNotableForApp:        getNotableForApp,
    updateNotableDeployment: updateNotableDeployment,
    addNotableDeployment:    addNotableDeployment,
    _clearNotableCache:      _clearNotableCache,
    _warmNotable:            _warmNotable
  };

})();
