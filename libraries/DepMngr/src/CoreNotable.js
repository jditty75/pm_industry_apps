/**
 * CoreNotable.gs
 *
 * Notable Deployments backend module for DepMngr.
 *
 * Responsibilities:
 *  - Read notable deployment rows from Mariah's shared peer sheet.
 *  - Join peer rows with each app's Notable-eligible deployments (Active ∪
 *    Complete, deduplicated by Deployment ID) on 15-character ID prefix.
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
   * peer sheet with the app's Notable-eligible deployments on 15-char Deployment ID
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
  var localDeployments = CoreData.getNotableEligibleDeployments(cfg);
  // S1: exclude Student deployments from Notable view (HENP only).
  localDeployments = CoreData.filterDeploymentsByStudent_(localDeployments, 'exclude', cfg);
  Logger.log('CoreNotable.getNotableForApp: peerRows=' + peerRows.length +
             ', localDeployments=' + localDeployments.length);

  var raw = joinAndSort_(peerRows, localDeployments, cfg);

  // Map raw peer-sheet-keyed objects to camelCase shape expected by client.
  // google.script.run cannot reliably serialize keys with spaces/parens/slashes.
  return raw.map(function(r) {
    var latestUpdate = '';
    var lu = r['Latest Update [MM/DD/Year]'];
    if (lu === undefined || lu === null || lu === '') {
      lu = r['Latest Update'];
    }
    if (lu instanceof Date) {
      latestUpdate = Utilities.formatDate(lu, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    } else if (lu) {
      latestUpdate = String(lu);
    }

    return {
      deploymentId:        String(r['Deployment ID']                    || ''),
      accountNumber:       String(r['Account Customer Number']          || ''),
      accountName:         String(r['Customer (Account) Name']          || (r.local && r.local.accountName) || ''),
      industry:            String(r['Industry']                         || (r.local && r.local.industry)    || ''),
      validationStatus:    String(r['Data Validation Status']           || ''),
      latestUpdate:        latestUpdate,
      regionalOwner:       String(r['Regional Owner or Delegate']       || ''),
      notabilityTrigger:   String(r['Notability Trigger']               || ''),
      fitForPurpose:       String(r['Fit-for-Purpose']                  || ''),
      scopeSummary:        String(r['Scope (Human Summary)']            || ''),
      storyBlurb:          String(r['Story Blurb / Executive Summary']  || ''),
      supportingLinks:     String(r['Link(s) to Supporting Material']   || ''),
      businessOutcomes:    String(r['Business Outcomes / Scope']        || ''),
      standoutTeamMembers: String(r['Standout Team Members']            || ''),
      goLiveQuarter:       String(r['Go-Live Quarter']                  || ''),
      deploymentType:      String(r['Deployment Type']                  || ''),
      peerRowIndex:        r._rowIndex || 0,
      local:               r.local || {}
    };
  });
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
      var resolvedHeader = resolveNotableEditableHeader_(key, headerMap, editableSet);
      if (!resolvedHeader) {
        Logger.log('CoreNotable.updateNotableDeployment: skipping non-editable field "' + key + '".');
        continue;
      }
      var colIdx = getColIdx_(headerMap, resolvedHeader);
      if (!colIdx) {
        Logger.log('CoreNotable.updateNotableDeployment: header "' + resolvedHeader + '" not found in peer sheet; skipping.');
        continue;
      }
      var oldVal = String(targetRow[resolvedHeader] !== undefined ? targetRow[resolvedHeader] : '');
      var newVal = String(fieldUpdates[key] !== undefined ? fieldUpdates[key] : '');
      if (oldVal === newVal) continue;

      peerSheet.getRange(rowIndex, colIdx).setValue(newVal);
      oldValues[resolvedHeader] = oldVal;
      newValues[resolvedHeader] = newVal;
      fieldsChanged.push(resolvedHeader);
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
    var localDeployments = CoreData.getNotableEligibleDeployments(cfg);
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
    var dataStartRow = cfg.notable.dataStartRow;
    if (lastRow < dataStartRow) return [];

    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return [];

    var headerValues = sheet.getRange(cfg.notable.headerRow, 1, 1, lastCol).getValues()[0];
    var headers = headerValues.map(function (h) { return String(h || '').trim(); });

    var numDataRows = Math.max(0, lastRow - dataStartRow + 1);
    if (numDataRows <= 0) return [];
    var dataValues = sheet.getRange(dataStartRow, 1, numDataRows, lastCol).getValues();

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
   * Resolves an incoming fieldUpdates key to the peer-sheet header name used for
   * writes. Handles Latest Update / Latest Update [MM/DD/Year] aliases.
   *
   * @param {string} key
   * @param {Object<string, number>} headerMap
   * @param {Object<string, boolean>} editableSet
   * @return {string|null}
   * @private
   */
  function resolveNotableEditableHeader_(key, headerMap, editableSet) {
    var k = String(key || '').trim();
    if (!k) return null;
    if (editableSet[k] && getColIdx_(headerMap, k)) return k;

    var latestAliases = ['Latest Update [MM/DD/Year]', 'Latest Update'];
    if (latestAliases.indexOf(k) !== -1) {
      var latestEditable = false;
      for (var i = 0; i < latestAliases.length; i++) {
        if (editableSet[latestAliases[i]]) {
          latestEditable = true;
          break;
        }
      }
      if (!latestEditable) return null;
      for (var j = 0; j < latestAliases.length; j++) {
        if (getColIdx_(headerMap, latestAliases[j])) return latestAliases[j];
      }
    }
    return null;
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
  // DEBUG (read-only)
  // ---------------------------------------------------------------------------

  /**
   * Finds a peer row whose Deployment ID matches the target (15-char prefix).
   *
   * @param {Array<Object>} peerRows
   * @param {string} targetId
   * @param {AppConfig} cfg
   * @return {{ peer: Object|null, index: number }}
   * @private
   */
  function _findPeerRowByDeploymentId_(peerRows, targetId, cfg) {
    var targetShort = String(targetId || '').trim().slice(0, 15);
    if (!targetShort) return { peer: null, index: -1 };
    var idHeader = cfg.notable.deploymentIdHeader;
    for (var i = 0; i < peerRows.length; i++) {
      var peerId = String(peerRows[i][idHeader] || '').trim();
      if (peerId && peerId.slice(0, 15) === targetShort) {
        return { peer: peerRows[i], index: i };
      }
    }
    return { peer: null, index: -1 };
  }

  /**
   * Read-only pipeline summary for Notable peer sheet join diagnostics.
   * Does not write to any spreadsheet.
   *
   * @param {AppConfig} config
   * @param {Array<string>=} trackDeploymentIds  Optional deployment IDs to trace in detail.
   * @return {Object}
   */
  function debugNotableDataPipelineForUI(config, trackDeploymentIds) {
    _clearNotableCache(config);
    var cfg = CoreConfig.withDefaults(config);
    var peerRows = readPeerSheet_(cfg);
    var activeDeployments = CoreData.getAllEffectiveDeployments(cfg) || [];
    var resolutionByShortId = CoreData.debugNotableEligibleResolutionByShortId(cfg) || {};
    var localDeployments = CoreData.getNotableEligibleDeployments(cfg);
    localDeployments = CoreData.filterDeploymentsByStudent_(localDeployments, 'exclude', cfg);

    var localMap = {};
    var localDuplicateShortIds = [];
    for (var i = 0; i < localDeployments.length; i++) {
      var ld = localDeployments[i];
      var shortId = String(ld.deploymentId || '').trim().slice(0, 15);
      if (!shortId) continue;
      if (localMap[shortId] && localDuplicateShortIds.indexOf(shortId) === -1) {
        localDuplicateShortIds.push(shortId);
      }
      localMap[shortId] = ld;
    }

    var joinedRows = joinAndSort_(peerRows, localDeployments, cfg);
    var notableDtoCount = joinedRows.length;

    var restrictedStatus = (cfg.notable.validationStatusOptions && cfg.notable.validationStatusOptions[2]) ||
      'Region Restricted';
    var regionApprovedStatus = (cfg.notable.validationStatusOptions && cfg.notable.validationStatusOptions[1]) ||
      'Region Approved';
    var restrictedHideEnabled = cfg.notable.restrictedHideEnabled !== false;

    var reasonCounts = {
      emptyDeploymentId: 0,
      noLocalMatch: 0,
      joined: 0,
      restricted: 0,
      regionApproved: 0,
      historical: 0
    };
    var peerRowsWithDeploymentIdCount = 0;
    var unmatchedSamples = [];
    var matchedSamples = [];

    for (var p = 0; p < peerRows.length; p++) {
      var peer = peerRows[p];
      var peerId = String(peer[cfg.notable.deploymentIdHeader] || '').trim();
      if (!peerId) {
        reasonCounts.emptyDeploymentId++;
        continue;
      }
      peerRowsWithDeploymentIdCount++;
      var valStatus = String(peer['Data Validation Status'] || '').trim();
      if (valStatus === restrictedStatus) reasonCounts.restricted++;
      if (valStatus === regionApprovedStatus) reasonCounts.regionApproved++;
      if (/historical/i.test(valStatus)) reasonCounts.historical++;

      var local = localMap[peerId.slice(0, 15)];
      if (!local) {
        reasonCounts.noLocalMatch++;
        if (unmatchedSamples.length < 8) {
          unmatchedSamples.push({
            deploymentId: peerId,
            peerShortId: peerId.slice(0, 15),
            accountName: String(peer['Customer (Account) Name'] || ''),
            accountNumber: String(peer['Account Customer Number'] || ''),
            validationStatus: valStatus,
            peerRowIndex: peer._rowIndex || 0,
            reason: 'no_matching_local_effective_deployment'
          });
        }
        continue;
      }
      reasonCounts.joined++;
      if (matchedSamples.length < 8) {
        matchedSamples.push({
          deploymentId: peerId,
          accountName: String(peer['Customer (Account) Name'] || ''),
          validationStatus: valStatus,
          peerRowIndex: peer._rowIndex || 0,
          regionalOwner: String(peer['Regional Owner or Delegate'] || ''),
          localResolutionSource: resolutionByShortId[peerId.slice(0, 15)] || 'active'
        });
      }
    }

    var joinedRestrictedCount = 0;
    for (var jr = 0; jr < joinedRows.length; jr++) {
      var jStatus = String(joinedRows[jr]['Data Validation Status'] || '').trim();
      if (jStatus === restrictedStatus) joinedRestrictedCount++;
    }
    var clientVisibleIfRestrictedHidden = notableDtoCount - joinedRestrictedCount;
    var clientVisibleIfRestrictedShown = notableDtoCount;

    var defaultTrackIds = [
      'a0rVT00000mT5KLYA0',
      'a0rVT00000tFsq1YAC',
      'a0rVT00000vtwYyYAI'
    ];
    var idsToTrack = Array.isArray(trackDeploymentIds) && trackDeploymentIds.length
      ? trackDeploymentIds
      : defaultTrackIds;

    var trackedDeployments = idsToTrack.map(function (trackId) {
      var found = _findPeerRowByDeploymentId_(peerRows, trackId, cfg);
      var peer = found.peer;
      var peerId = peer ? String(peer[cfg.notable.deploymentIdHeader] || '').trim() : '';
      var peerShortId = peerId ? peerId.slice(0, 15) : String(trackId || '').trim().slice(0, 15);
      var local = peerShortId ? localMap[peerShortId] : null;
      var valStatus = peer ? String(peer['Data Validation Status'] || '').trim() : '';
      var joinIncluded = !!(peer && local);
      var localResolutionSource = peerShortId && local
        ? (resolutionByShortId[peerShortId] || 'unresolved')
        : 'unresolved';
      var isRestricted = valStatus === restrictedStatus;
      var hiddenByRestrictedToggle = joinIncluded && isRestricted && restrictedHideEnabled;
      var reason = '';
      if (!peer) {
        reason = 'peer_row_not_read_or_id_mismatch';
      } else if (!peerId) {
        reason = 'empty_peer_deployment_id';
      } else if (!local) {
        reason = 'no_matching_local_effective_deployment';
      } else if (hiddenByRestrictedToggle) {
        reason = 'joined_but_hidden_by_default_restricted_toggle';
      } else {
        reason = 'joined_visible';
      }
      return {
        trackId: String(trackId || '').trim(),
        peerFound: !!peer,
        peerRowIndex: peer ? (peer._rowIndex || 0) : 0,
        peerAccountName: peer ? String(peer['Customer (Account) Name'] || '') : '',
        peerValidationStatus: valStatus,
        peerDeploymentId: peerId,
        peerShortId: peerShortId,
        localFound: !!local,
        localDeploymentId: local ? String(local.deploymentId || '') : '',
        localAccountName: local ? String(local.accountName || '') : '',
        localDeploymentName: local ? String(local.deploymentName || '') : '',
        localHealth: local ? String(local.health || '') : '',
        localStage: local ? String(local.stage || '') : '',
        localOverallStatus: local ? String(local.overallStatus || local.status || '') : '',
        localMtpDate: local ? (local.mtpDate || local.currentMtpDate || '') : '',
        joinIncluded: joinIncluded,
        localResolutionSource: localResolutionSource,
        hiddenByRestrictedToggle: hiddenByRestrictedToggle,
        reason: reason
      };
    });

    Logger.log('CoreNotable.debugNotableDataPipelineForUI: app=' + cfg.appId +
      ' peer=' + peerRows.length + ' withId=' + peerRowsWithDeploymentIdCount +
      ' joined=' + notableDtoCount + ' noLocal=' + reasonCounts.noLocalMatch);

    return {
      appId: cfg.appId,
      tabName: cfg.notable.tabName,
      headerRow: cfg.notable.headerRow,
      dataStartRow: cfg.notable.dataStartRow,
      peerRowCount: peerRows.length,
      peerRowsWithDeploymentIdCount: peerRowsWithDeploymentIdCount,
      localEffectiveDeploymentCount: localDeployments.length,
      localActiveEffectiveDeploymentCount: activeDeployments.length,
      localNotableEligibleDeploymentCount: localDeployments.length,
      localDuplicateShortIdCount: localDuplicateShortIds.length,
      joinedRowCount: notableDtoCount,
      matchedRowCount: reasonCounts.joined,
      unmatchedPeerCount: reasonCounts.noLocalMatch,
      emptyDeploymentIdCount: reasonCounts.emptyDeploymentId,
      restrictedCount: reasonCounts.restricted,
      historicalCount: reasonCounts.historical,
      clientVisibleRowCountEstimate: clientVisibleIfRestrictedHidden,
      clientVisibleIfRestrictedShown: clientVisibleIfRestrictedShown,
      clientVisibleIfRestrictedHidden: clientVisibleIfRestrictedHidden,
      restrictedHideEnabled: restrictedHideEnabled,
      reasonCounts: reasonCounts,
      trackedDeployments: trackedDeployments,
      unmatchedSamples: unmatchedSamples,
      matchedSamples: matchedSamples
    };
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
    getNotableForApp:                 getNotableForApp,
    updateNotableDeployment:          updateNotableDeployment,
    addNotableDeployment:             addNotableDeployment,
    debugNotableDataPipelineForUI:    debugNotableDataPipelineForUI,
    _clearNotableCache:               _clearNotableCache,
    _warmNotable:                     _warmNotable
  };

})();
