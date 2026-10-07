/**
 * CoreNotify.js
 *
 * N7 — MDS/PGL config-driven email notifications (GmailApp send-as).
 * Reads per-app NotificationConfig sheet; reuses getMdsPglBatchView and
 * getDdAssignmentsFromContacts_ for data. Anti-spam via Script Properties.
 */

var CoreNotify = (function () {

  var HEADERS_ = [
    'notificationKey', 'enabled', 'type', 'toRole', 'to', 'cc', 'fromAlias',
    'grouping', 'leadDays', 'finalDays', 'windowDays', 'cadence', 'sendDay',
    'subject', 'bodyTemplate', 'status'
  ];

  var EM_TOKENS_ = ['emName', 'account', 'deploymentName', 'surveyType', 'eventDate', 'dd', 'daysUntil', 'mtpDate', 'contactList'];
  var DIGEST_TOKENS_ = ['ddName', 'upcomingList', 'windowDays', 'periodLabel'];

  var SEED_KEYS_ = [
    'em_reminder_first', 'em_reminder_final', 'dd_digest', 'deployment_intelligence_weekly'
  ];

  // ---------------------------------------------------------------------------
  // Sheet helpers
  // ---------------------------------------------------------------------------

  /**
   * @param {AppConfig} cfg
   * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
   * @private
   */
  function _getConfigSheet_(cfg) {
    var sheetName = cfg.notify.configSheet || 'NotificationConfig';
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  }

  /**
   * @param {AppConfig} cfg
   * @return {number} 1-based header row index
   * @private
   */
  function _headerRowIndex_(cfg) {
    return 2;
  }

  /**
   * Reads NotificationConfig rows. Missing sheet → [] (skip+log).
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function readNotificationConfig_(cfg) {
    var sheet = _getConfigSheet_(cfg);
    if (!sheet) {
      Logger.log('CoreNotify.readNotificationConfig_: sheet "' +
                 (cfg.notify.configSheet || 'NotificationConfig') + '" not found; no notifications configured.');
      return [];
    }

    var headerRow = _headerRowIndex_(cfg);
    var lastRow = sheet.getLastRow();
    if (lastRow < headerRow + 1) return [];

    var lastCol = Math.max(sheet.getLastColumn(), HEADERS_.length);
    var values = sheet.getRange(headerRow, 1, lastRow, lastCol).getValues();
    var headerCells = values[0].map(function (h) { return String(h || '').trim(); });
    var colMap = {};
    for (var i = 0; i < HEADERS_.length; i++) {
      var idx = headerCells.indexOf(HEADERS_[i]);
      colMap[HEADERS_[i]] = idx >= 0 ? idx : i;
    }

    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var raw = values[r];
      if (!String(raw[colMap.notificationKey] || '').trim()) continue;
      var row = {};
      for (var h = 0; h < HEADERS_.length; h++) {
        var key = HEADERS_[h];
        row[key] = raw[colMap[key]];
      }
      row._sheetRow = headerRow + r;
      rows.push(row);
    }
    return rows;
  }

  /**
   * @param {*} val
   * @return {boolean}
   * @private
   */
  function _isEnabled_(val) {
    if (val === true) return true;
    if (val === false) return false;
    var s = String(val || '').trim().toUpperCase();
    return s === 'TRUE' || s === 'YES' || s === '1';
  }

  /**
   * @param {string} str
   * @return {Array<string>}
   * @private
   */
  function _extractTokens_(str) {
    var tokens = [];
    var re = /\{\{(\w+)\}\}/g;
    var m;
    while ((m = re.exec(String(str || ''))) !== null) {
      tokens.push(m[1]);
    }
    return tokens;
  }

  /**
   * @param {string} email
   * @return {boolean}
   * @private
   */
  function _isValidEmail_(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  /**
   * @param {string} csv
   * @return {Array<string>}
   * @private
   */
  function _parseEmailList_(csv) {
    if (!csv) return [];
    return String(csv).split(',').map(function (e) { return e.trim(); }).filter(function (e) { return !!e; });
  }

  /**
   * @param {AppConfig} cfg
   * @return {Object<string, Array<{email:string,name:string}>>}
   * @private
   */
  function _getDdContactsMap_(cfg) {
    try {
      if (typeof getDdAssignmentsFromContacts_ === 'function') {
        return getDdAssignmentsFromContacts_(cfg) || {};
      }
    } catch (e) {
      Logger.log('CoreNotify._getDdContactsMap_: getDdAssignmentsFromContacts_ failed: ' + e);
    }
    return {};
  }

  /**
   * @param {Object} dep  Batch-view or deployment row
   * @param {Object} contactsMap
   * @param {Object} ddMap
   * @return {Array<string>}
   * @private
   */
  function _emailsForEngagementManagers_(dep, contactsMap) {
    var contacts = (dep && dep.contacts) ||
      (contactsMap && dep && contactsMap[dep.deploymentId]) || null;
    var emails = [];
    if (contacts && Array.isArray(contacts.engagementManagers)) {
      contacts.engagementManagers.forEach(function (c) {
        if (c && c.email && _isValidEmail_(c.email)) emails.push(c.email.trim());
      });
    }
    return emails;
  }

  /**
   * @param {Object} dep
   * @param {Object} ddMap
   * @return {Array<string>}
   * @private
   */
  function _emailsForDeliveryDirector_(dep, ddMap) {
    var emails = [];
    var depId = dep && dep.deploymentId;
    if (!depId) return emails;

    var list = (dep.ddContacts && Array.isArray(dep.ddContacts)) ? dep.ddContacts : (ddMap[depId] || []);
    list.forEach(function (c) {
      if (c && c.email && _isValidEmail_(c.email)) emails.push(c.email.trim());
    });
    return emails;
  }

  /**
   * Resolves to/cc recipients. Literal wins over role.
   * @param {Object} row       NotificationConfig row
   * @param {Object|null} dep  Deployment context (optional for digest-all)
   * @param {Object} contactsMap
   * @param {AppConfig} cfg
   * @param {string} field       'to' | 'cc'
   * @return {Array<string>}
   * @private
   */
  function _resolveRecipients_(row, dep, contactsMap, cfg, field) {
    field = field || 'to';
    var literal = String(row[field] || '').trim();
    var roleField = field === 'cc' ? 'ccRole' : 'toRole';
    var role = String(row[roleField] || row.toRole || '').trim();

    if (literal) {
      var parsed = _parseEmailList_(literal);
      var valid = parsed.filter(_isValidEmail_);
      if (valid.length !== parsed.length) {
        Logger.log('CoreNotify._resolveRecipients_: invalid email in literal ' + field);
      }
      return valid;
    }

    if (!role) return [];

    var ddMap = _getDdContactsMap_(cfg);

    if (role === 'engagementManager') {
      if (!dep) return [];
      return _emailsForEngagementManagers_(dep, contactsMap);
    }

    if (role === 'deliveryDirector') {
      if (dep) {
        return _emailsForDeliveryDirector_(dep, ddMap);
      }
      // Digest-all: union of all DD emails across ddMap
      var all = {};
      Object.keys(ddMap).forEach(function (depId) {
        (ddMap[depId] || []).forEach(function (c) {
          if (c && c.email && _isValidEmail_(c.email)) all[c.email.trim()] = true;
        });
      });
      return Object.keys(all);
    }

    Logger.log('CoreNotify._resolveRecipients_: unrecognized role "' + role + '"');
    return [];
  }

  /**
   * Dry-run recipient resolution for validation.
   * @param {Object} row
   * @param {AppConfig} cfg
   * @param {Array<Object>} sampleDeps
   * @param {Object} contactsMap
   * @return {Array<string>}
   * @private
   */
  function _dryRunRecipients_(row, cfg, sampleDeps, contactsMap) {
    var type = String(row.type || '').trim();
    if (type === 'em_reminder') {
      var dep = sampleDeps.length ? sampleDeps[0] : null;
      return _resolveRecipients_(row, dep, contactsMap, cfg, 'to');
    }
    if (type === 'dd_digest') {
      var grouping = String(row.grouping || 'all').trim();
      if (grouping === 'perRecipient') {
        var ddMap = _getDdContactsMap_(cfg);
        var emails = {};
        Object.keys(ddMap).forEach(function (depId) {
          _emailsForDeliveryDirector_({ deploymentId: depId, ddContacts: ddMap[depId] }, ddMap)
            .forEach(function (e) { emails[e] = true; });
        });
        return Object.keys(emails);
      }
      return _resolveRecipients_(row, null, contactsMap, cfg, 'to');
    }
    return [];
  }

  /**
   * @param {string} templateStr
   * @param {Object<string,string>} tokenValues
   * @param {Array<string>} allowedTokens
   * @return {{html:string, errors:Array<string>}}
   * @private
   */
  function _renderTemplate_(templateStr, tokenValues, allowedTokens) {
    var errors = [];
    var found = _extractTokens_(templateStr);
    for (var i = 0; i < found.length; i++) {
      if (allowedTokens.indexOf(found[i]) < 0) {
        errors.push('unknown token {{' + found[i] + '}}');
      }
    }
    if (errors.length) return { html: '', errors: errors };

    var html = String(templateStr || '');
    Object.keys(tokenValues).forEach(function (key) {
      var re = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
      html = html.replace(re, tokenValues[key] != null ? String(tokenValues[key]) : '');
    });

    var remaining = _extractTokens_(html);
    if (remaining.length) {
      errors.push('unsubstituted tokens: ' + remaining.map(function (t) { return '{{' + t + '}}'; }).join(', '));
    }
    return { html: html, errors: errors };
  }

  /**
   * @param {Date} eventDate
   * @param {Date} today
   * @return {number}
   * @private
   */
  function _daysUntil_(eventDate, today) {
    var ev = new Date(eventDate);
    ev.setHours(0, 0, 0, 0);
    var t = new Date(today);
    t.setHours(0, 0, 0, 0);
    return Math.round((ev.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
  }

  /**
   * @param {Object} payload  getMdsPglBatchView result
   * @return {Array<Object>}
   * @private
   */
  function _flattenBatchRows_(payload) {
    var rows = [];
    (payload.groups || []).forEach(function (g) {
      (g.mdsRows || []).forEach(function (r) { rows.push(r); });
      (g.pglRows || []).forEach(function (r) { rows.push(r); });
    });
    return rows;
  }

  /**
   * DD Digest only — scopes upcoming rows to notify.ddDigest.partnerNames when enabled.
   * @param {AppConfig} cfg
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   * @private
   */
  function _filterDdDigestPartnerRows_(cfg, rows) {
    var filterCfg = (cfg.notify && cfg.notify.ddDigest) || {};
    if (!filterCfg.partnerFilterEnabled) return rows;
    var before = (rows || []).length;
    var filtered = CoreData.filterMdsPglRowsForDdDigestPartner(cfg, rows);
    Logger.log('CoreNotify._filterDdDigestPartnerRows_: ' + before + ' -> ' + filtered.length);
    return filtered;
  }

  /**
   * @param {AppConfig} cfg
   * @return {Array<Object>}
   * @private
   */
  function _getUpcomingBatchRows_(cfg, windowDays) {
    var horizon = windowDays > 90 ? 6 : 3;
    var payload = CoreData.getMdsPglBatchView(cfg, null, horizon);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return _flattenBatchRows_(payload).filter(function (row) {
      if (!row.eventDate) return false;
      var du = _daysUntil_(row.eventDate, today);
      return du >= 0 && du <= windowDays;
    });
  }

  /**
   * @param {string} notificationKey
   * @return {'first'|'final'}
   * @private
   */
  function _reminderStage_(notificationKey) {
    if (notificationKey === 'em_reminder_final') return 'final';
    return 'first';
  }

  /**
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _sentStateKey_(cfg) {
    return 'notifySentKeys:' + (cfg.appId || 'default');
  }

  /**
   * @param {AppConfig} cfg
   * @return {Object<string,string>}
   * @private
   */
  function _loadSentKeys_(cfg) {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(_sentStateKey_(cfg));
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      Logger.log('CoreNotify._loadSentKeys_: parse error: ' + e);
      return {};
    }
  }

  /**
   * @param {AppConfig} cfg
   * @param {Object<string,string>} sent
   * @private
   */
  function _saveSentKeys_(cfg, sent) {
    PropertiesService.getScriptProperties().setProperty(_sentStateKey_(cfg), JSON.stringify(sent));
  }

  /**
   * @param {string} cadence
   * @param {number} sendDay
   * @param {Date} today
   * @return {boolean}
   * @private
   */
  function _isDigestSendDay_(cadence, sendDay, today) {
    var targetDay = parseInt(sendDay, 10) || 1;
    var daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    var effectiveDay = Math.min(targetDay, daysInMonth);
    if (today.getDate() !== effectiveDay) return false;
    if (cadence === 'bimonthly') {
      return (today.getMonth() + 1) % 2 === 1;
    }
    return true;
  }

  /**
   * @param {Date} today
   * @param {string} tz
   * @return {string}
   * @private
   */
  function _periodLabel_(today, tz) {
    return Utilities.formatDate(today, tz, 'MMMM yyyy');
  }

  /**
   * @param {Date} today
   * @param {string} tz
   * @return {string}
   * @private
   */
  function _periodKey_(today, tz) {
    return Utilities.formatDate(today, tz, 'yyyy-MM');
  }

  /**
   * @param {Object} row
   * @return {number|null}  Midnight-local ms for sort, or null if unparseable/missing
   * @private
   */
  function _digestEventSortTime_(row) {
    if (!row || !row.eventDate) return null;
    var d = new Date(row.eventDate);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * @param {Object} a
   * @param {Object} b
   * @return {number}
   * @private
   */
  function _compareDigestEventsByDate_(a, b) {
    var ta = _digestEventSortTime_(a);
    var tb = _digestEventSortTime_(b);
    if (ta == null && tb == null) {
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    }
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return ta - tb;
    var byAccount = String(a.accountName || '').localeCompare(String(b.accountName || ''));
    if (byAccount !== 0) return byAccount;
    return String(a.deploymentName || '').localeCompare(String(b.deploymentName || ''));
  }

  /**
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   * @private
   */
  function _sortDigestEvents_(rows) {
    return rows.slice().sort(_compareDigestEventsByDate_);
  }

  /**
   * @param {string} id
   * @return {string}
   * @private
   */
  function _canonicalDigestDeploymentId_(id) {
    var s = String(id || '').trim();
    return s.length >= 18 ? s.slice(0, 18) : s;
  }

  /**
   * @param {string} s
   * @return {string}
   * @private
   */
  function _normalizeDigestText_(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Merge key for DD Digest display: same deployment + event date (+ DD + deployment name).
   * Does not include survey type so MDS/PGL pairs collapse to one bullet.
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _ddDigestMergeRowKey_(row) {
    var dateMs = _digestEventSortTime_(row);
    var datePart = dateMs == null ? 'nodate' : String(dateMs);
    var depName = _normalizeDigestText_(row.deploymentName);
    var dd = _normalizeDigestText_(row.deliveryDirector || '(Unassigned)') || '(unassigned)';
    var depId = _canonicalDigestDeploymentId_(row.deploymentId);
    if (depId) {
      return depId + '|' + datePart + '|' + depName + '|' + dd;
    }
    var account = _normalizeDigestText_(row.accountName);
    var partner = _normalizeDigestText_(row.partner);
    return 'nodep|' + account + '|' + depName + '|' + datePart + '|' + partner + '|' + dd;
  }

  /**
   * Survey type label for digest bullets (MDS, PGL, or MDS/PGL when merged).
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _digestSurveyTypeLabel_(row) {
    if (row.surveyTypes && row.surveyTypes.length) {
      return row.surveyTypes.join('/');
    }
    return String(row.surveyType || '').trim();
  }

  /**
   * DD Digest display-only merge: one bullet per deployment + event date (+ DD).
   * @param {Array<Object>} rows
   * @param {number=} sampleLimit
   * @return {{ rows: Array<Object>, beforeCount: number, afterCount: number,
   *   duplicateMergedCount: number, sampleMergedDuplicates: Array<Object> }}
   * @private
   */
  function _mergeDdDigestDuplicateEvents_(rows, sampleLimit) {
    var input = rows || [];
    var beforeCount = input.length;
    var limit = parseInt(sampleLimit, 10);
    if (!limit || limit < 1) limit = 8;

    var groups = {};
    var order = [];
    var duplicateMergedCount = 0;
    var sampleMergedDuplicates = [];

    input.forEach(function (row) {
      var key = _ddDigestMergeRowKey_(row);
      var st = String(row.surveyType || '').trim().toUpperCase();

      if (!groups[key]) {
        var g0 = {
          base: Object.assign({}, row),
          types: {},
          typeOrder: []
        };
        if (st === 'MDS' || st === 'PGL') {
          g0.types[st] = true;
          g0.typeOrder.push(st);
        }
        groups[key] = g0;
        order.push(key);
        return;
      }

      duplicateMergedCount++;
      var g = groups[key];
      if ((st === 'MDS' || st === 'PGL') && !g.types[st]) {
        g.types[st] = true;
        g.typeOrder.push(st);
      }
      if (sampleMergedDuplicates.length < limit) {
        var typesMerged = [];
        if (g.types.MDS) typesMerged.push('MDS');
        if (g.types.PGL) typesMerged.push('PGL');
        sampleMergedDuplicates.push({
          accountName: g.base.accountName || row.accountName || '',
          deploymentName: g.base.deploymentName || row.deploymentName || '',
          deploymentId: g.base.deploymentId || row.deploymentId || '',
          eventDate: g.base.eventDate || row.eventDate || null,
          eventTypesMerged: typesMerged,
          deliveryDirector: g.base.deliveryDirector || row.deliveryDirector || ''
        });
      }
    });

    var merged = order.map(function (key) {
      var g = groups[key];
      var typeList = [];
      if (g.types.MDS) typeList.push('MDS');
      if (g.types.PGL) typeList.push('PGL');
      if (!typeList.length) {
        var fallback = String(g.base.surveyType || '').trim();
        if (fallback) typeList.push(fallback);
      }
      g.base.surveyTypes = typeList;
      g.base.surveyType = typeList.join('/');
      return g.base;
    });

    return {
      rows: merged,
      beforeCount: beforeCount,
      afterCount: merged.length,
      duplicateMergedCount: duplicateMergedCount,
      sampleMergedDuplicates: sampleMergedDuplicates
    };
  }

  /**
   * Account label for digest list items: bold customer name; partner parenthetical unbolded.
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _digestAccountLabelHtml_(row) {
    var account = String(row.accountName || '').trim();
    var partner = String(row.partner || '').trim();

    if (!account) {
      return '<strong></strong>';
    }

    if (partner) {
      var parenPartner = '(' + partner + ')';
      var idx = account.indexOf(parenPartner);
      if (idx > 0) {
        return '<strong>' + _escapeHtml_(account.substring(0, idx).trim()) + '</strong> ' +
          _escapeHtml_(account.substring(idx));
      }
      if (account.indexOf(partner) < 0) {
        return '<strong>' + _escapeHtml_(account) + '</strong> (' + _escapeHtml_(partner) + ')';
      }
    }

    var trailing = account.match(/^(.+?)\s+(\([^)]+\))\s*$/);
    if (trailing) {
      return '<strong>' + _escapeHtml_(trailing[1].trim()) + '</strong> ' +
        _escapeHtml_(trailing[2]);
    }

    return '<strong>' + _escapeHtml_(account) + '</strong>';
  }

  /**
   * @param {Object} row
   * @param {string} tz
   * @return {string}
   * @private
   */
  function _formatDigestEventLineHtml_(row, tz) {
    var hasDate = !!row.eventDate;
    var dateStr = hasDate ?
      Utilities.formatDate(new Date(row.eventDate), tz, 'yyyy-MM-dd') : 'n/a';
    var dateHtml = hasDate ?
      '<strong>' + _escapeHtml_(dateStr) + '</strong>' : _escapeHtml_(dateStr);
    return _digestAccountLabelHtml_(row) + ' — ' +
      _escapeHtml_(row.deploymentName || '') + ' (' +
      _escapeHtml_(_digestSurveyTypeLabel_(row)) + ', ' + dateHtml + ')';
  }

  /**
   * @param {Array<Object>} rows
   * @param {string} tz
   * @return {string}
   * @private
   */
  function _buildUpcomingListHtml_(rows, tz) {
    var mergeResult = _mergeDdDigestDuplicateEvents_(rows);
    rows = mergeResult.rows;
    if (mergeResult.duplicateMergedCount > 0) {
      Logger.log('CoreNotify._buildUpcomingListHtml_: display merge ' +
                 mergeResult.beforeCount + ' -> ' + mergeResult.afterCount + ' rows (' +
                 mergeResult.duplicateMergedCount + ' merged).');
    }

    if (!rows.length) {
      return '<p><em>No upcoming MDS/PGL events in this window.</em></p>';
    }

    var byDd = {};
    rows.forEach(function (row) {
      var dd = String(row.deliveryDirector || '(Unassigned)').trim() || '(Unassigned)';
      if (!byDd[dd]) byDd[dd] = [];
      byDd[dd].push(row);
    });

    var ddNames = Object.keys(byDd).sort();
    var parts = ['<ul>'];
    ddNames.forEach(function (dd) {
      parts.push('<li><strong>' + _escapeHtml_(dd) + '</strong><ul>');
      _sortDigestEvents_(byDd[dd]).forEach(function (row) {
        parts.push('<li>' + _formatDigestEventLineHtml_(row, tz) + '</li>');
      });
      parts.push('</ul></li>');
    });
    parts.push('</ul>');
    return parts.join('');
  }

  /**
   * @param {string} s
   * @return {string}
   * @private
   */
  function _escapeHtml_(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {{name?: string, email?: string}|null} c
   * @return {string}
   * @private
   */
  function _contactLineHtml_(c) {
    if (!c) return '';
    var name = String(c.name || '').trim();
    var email = String(c.email || '').trim();
    if (!name && !email) return '';
    if (name && email) return _escapeHtml_(name) + ' — ' + _escapeHtml_(email);
    return _escapeHtml_(name || email);
  }

  /**
   * Renders grouped deployment contacts (excludes Delivery Director).
   * @param {Object|null} contacts  getDeploymentContactsMap_ shape
   * @return {string}
   * @private
   */
  function _buildContactListHtml_(contacts) {
    contacts = contacts || {};
    var roleGroups = [
      { label: 'Project Managers', list: contacts.projectManagers },
      { label: 'Executive Sponsors', list: contacts.execSponsors },
      { label: 'Deployment Sponsor', single: contacts.wdSponsor },
      { label: 'Engagement Managers', list: contacts.engagementManagers }
    ];

    var parts = [];
    var hasAny = false;
    roleGroups.forEach(function (g) {
      var lines = [];
      if (g.single) {
        var singleLine = _contactLineHtml_(g.single);
        if (singleLine) lines.push(singleLine);
      } else {
        (g.list || []).forEach(function (c) {
          var line = _contactLineHtml_(c);
          if (line) lines.push(line);
        });
      }
      if (!lines.length) return;
      hasAny = true;
      parts.push('<li><strong>' + _escapeHtml_(g.label) + '</strong><ul>');
      lines.forEach(function (line) {
        parts.push('<li>' + line + '</li>');
      });
      parts.push('</ul></li>');
    });

    if (!hasAny) return '(no contacts on file)';
    return '<ul>' + parts.join('') + '</ul>';
  }

  /**
   * @param {Object} dep
   * @param {Object} contactsMap
   * @param {string} tz
   * @param {number} daysUntil
   * @param {AppConfig} cfg
   * @return {Object<string,string>}
   * @private
   */
  function _emTokenValues_(dep, contactsMap, tz, daysUntil, cfg) {
    var contacts = dep.contacts || contactsMap[dep.deploymentId] || {};
    var emNames = [];
    if (contacts.engagementManagers) {
      contacts.engagementManagers.forEach(function (c) {
        if (c && c.name) emNames.push(c.name);
      });
    }
    var eventDateStr = dep.eventDate ?
      Utilities.formatDate(new Date(dep.eventDate), tz, 'yyyy-MM-dd') : '';

    var mtpDateStr = '';
    if (cfg && dep && dep.deploymentId) {
      var effectiveByDeploymentId = {};
      try {
        CoreData.getAllEffectiveDeployments(cfg).forEach(function (r) {
          if (r.deploymentId) effectiveByDeploymentId[r.deploymentId] = r;
        });
      } catch (e) {
        Logger.log('CoreNotify._emTokenValues_: getAllEffectiveDeployments failed: ' + e);
      }
      var effective = effectiveByDeploymentId[dep.deploymentId];
      if (effective && effective.mtpDate) {
        var d = new Date(effective.mtpDate);
        if (!isNaN(d.getTime())) {
          mtpDateStr = Utilities.formatDate(d, tz, 'MMM d, yyyy');
        }
      }
    }

    return {
      emName: emNames.join(', ') || 'Engagement Manager',
      account: dep.accountName || '',
      deploymentName: dep.deploymentName || '',
      surveyType: dep.surveyType || '',
      eventDate: eventDateStr,
      dd: dep.deliveryDirector || '',
      daysUntil: String(daysUntil != null ? daysUntil : ''),
      mtpDate: mtpDateStr,
      contactList: _buildContactListHtml_(contacts)
    };
  }

  /**
   * RFC 5322 From header with optional display name.
   *
   * @param {string} fromEmail
   * @param {string=} fromName
   * @return {string}
   * @private
   */
  function _formatFromHeader_(fromEmail, fromName) {
    var addr = String(fromEmail || '').trim();
    var name = String(fromName || '').trim();
    if (!addr) return '';
    if (!name) return addr;
    var escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '"' + escaped + '" <' + addr + '>';
  }

  /**
   * @param {string} to
   * @param {string} subject
   * @param {string} htmlBody
   * @param {string} fromAlias
   * @param {string} cc
   * @param {Array<string>} allowedAliases
   * @param {string=} fromName Gmail advanced option `name` (friendly sender display)
   * @return {boolean}
   * @private
   */
  function _gmailSend_(to, subject, htmlBody, fromAlias, cc, allowedAliases, fromName) {
    var toStr = String(to || '').trim();
    if (!toStr) {
      Logger.log('CoreNotify._gmailSend_: empty to; skipped.');
      return false;
    }

    var from = String(fromAlias || '').trim();
    if (!from || allowedAliases.indexOf(from) < 0) {
      Logger.log('CoreNotify._gmailSend_: fromAlias "' + from + '" not in allowed list; skipped.');
      return false;
    }

    var opts = { htmlBody: htmlBody, from: from };
    var displayName = String(fromName || '').trim();
    if (displayName) opts.name = displayName;
    var ccStr = String(cc || '').trim();
    if (ccStr) opts.cc = ccStr;

    var plain = String(htmlBody || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      GmailApp.sendEmail(toStr, subject, plain, opts);
      Logger.log('CoreNotify._gmailSend_: sent to ' + toStr + ' from ' + from +
        (displayName ? ' (' + displayName + ')' : ''));
      return true;
    } catch (e) {
      Logger.log('CoreNotify._gmailSend_: send failed fromAlias=' + from +
        ' (container app needs https://mail.google.com/ oauthScope and a verified Gmail send-as alias): ' +
        e);
      return false;
    }
  }

  /**
   * @param {string} bodyHtml
   * @param {string} token
   * @return {string}
   * @private
   */
  function _embedTrackingToken_(bodyHtml, token) {
    var span = '<span style="display:none!important;visibility:hidden;font-size:0;' +
      'line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;" ' +
      'data-dhm-track="' + token + '">' + token + '</span>';
    var html = String(bodyHtml || '');
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, span + '</body>');
    }
    return html + span;
  }

  /**
   * @param {string} from
   * @param {string} to
   * @param {string} cc
   * @param {string} subject
   * @param {string} htmlBody
   * @param {string=} fromName
   * @return {string}
   * @private
   */
  function _buildRfc2822Mime_(from, to, cc, bcc, subject, htmlBody, fromName) {
    var fromHeader = _formatFromHeader_(from, fromName);
    var lines = [
      'From: ' + fromHeader,
      'To: ' + to
    ];
    var ccStr = String(cc || '').trim();
    if (ccStr) lines.push('Cc: ' + ccStr);
    var bccStr = String(bcc || '').trim();
    if (bccStr) lines.push('Bcc: ' + bccStr);
    lines.push('Subject: ' + subject);
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(htmlBody);
    return lines.join('\r\n');
  }

  /**
   * @param {string} rawMime
   * @return {string}
   * @private
   */
  function _base64UrlEncodeMime_(rawMime) {
    var bytes = Utilities.newBlob(String(rawMime), 'text/plain', 'UTF-8').getBytes();
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  }

  /**
   * @param {string} fromAlias
   * @param {string} token
   * @return {{messageId: string, threadId: string, captureMethod: string}}
   * @private
   */
  function _heuristicCaptureIds_(fromAlias, token) {
    var result = { messageId: '', threadId: '', captureMethod: 'none' };
    try {
      var q = 'in:sent newer_than:2m from:' + fromAlias + ' "' + token + '"';
      var threads = GmailApp.search(q, 0, 1);
      if (!threads.length) return result;
      var thread = threads[0];
      result.threadId = thread.getId();
      var messages = thread.getMessages();
      if (messages.length) {
        result.messageId = messages[messages.length - 1].getId();
      }
      result.captureMethod = result.messageId ? 'heuristic' : 'none';
    } catch (e) {
      Logger.log('CoreNotify._heuristicCaptureIds_: search failed: ' + e);
    }
    return result;
  }

  /**
   * Sends HTML email and returns Gmail message/thread IDs when available.
   * Primary: Advanced Gmail API (Gmail.Users.Messages.send).
   * Fallback: GmailApp.sendEmail + token-based GmailApp.search.
   *
   * @param {string} to
   * @param {string} subject
   * @param {string} htmlBody
   * @param {string} fromAlias
   * @param {string} cc
   * @param {Array<string>} allowedAliases
   * @param {string=} bcc
   * @param {string=} fromName Gmail display name (MIME From + GmailApp `name`)
   * @return {{ok: boolean, messageId: string, threadId: string,
   *           captureMethod: 'advanced'|'heuristic'|'none'}}
   * @private
   */
  function _gmailSendWithIds_(to, subject, htmlBody, fromAlias, cc, allowedAliases, bcc, fromName) {
    var fail = { ok: false, messageId: '', threadId: '', captureMethod: 'none' };
    var toStr = String(to || '').trim();
    if (!toStr) {
      Logger.log('CoreNotify._gmailSendWithIds_: empty to; skipped.');
      return fail;
    }

    var from = String(fromAlias || '').trim();
    if (!from || allowedAliases.indexOf(from) < 0) {
      Logger.log('CoreNotify._gmailSendWithIds_: fromAlias "' + from +
                 '" not in allowed list; skipped.');
      return fail;
    }

    var token = Utilities.getUuid();
    var bodyWithToken = _embedTrackingToken_(htmlBody, token);
    var ccStr = String(cc || '').trim();
    var bccStr = String(bcc || '').trim();
    var displayName = String(fromName || '').trim();

    try {
      if (typeof Gmail === 'undefined' || !Gmail || !Gmail.Users || !Gmail.Users.Messages) {
        throw new ReferenceError('Gmail advanced service is not enabled');
      }

      var rawMime = _buildRfc2822Mime_(from, toStr, ccStr, bccStr, subject, bodyWithToken,
        displayName);
      var encoded = _base64UrlEncodeMime_(rawMime);
      var response = Gmail.Users.Messages.send({ raw: encoded }, 'me');
      var messageId = response && response.id ? String(response.id) : '';
      var threadId = response && response.threadId ? String(response.threadId) : '';

      if (!messageId) {
        throw new Error('Gmail.Users.Messages.send returned empty id');
      }

      Logger.log('CoreNotify._gmailSendWithIds_: advanced send to ' + toStr +
                 ' from ' + from + (displayName ? ' (' + displayName + ')' : '') +
                 ', messageId=' + messageId);
      return {
        ok: true,
        messageId: messageId,
        threadId: threadId,
        captureMethod: 'advanced'
      };
    } catch (advancedErr) {
      Logger.log('CoreNotify._gmailSendWithIds_: advanced path failed (' +
                 advancedErr + '); falling back to GmailApp.');
    }

    var opts = { htmlBody: bodyWithToken, from: from };
    if (displayName) opts.name = displayName;
    if (ccStr) opts.cc = ccStr;
    if (bccStr) opts.bcc = bccStr;
    var plain = String(bodyWithToken).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    try {
      GmailApp.sendEmail(toStr, subject, plain, opts);
    } catch (e) {
      Logger.log('CoreNotify._gmailSendWithIds_: GmailApp fallback send failed fromAlias=' + from +
        ' (container app needs https://mail.google.com/ oauthScope and a verified Gmail send-as alias): ' +
        e);
      return fail;
    }

    var captured = _heuristicCaptureIds_(from, token);
    Logger.log('CoreNotify._gmailSendWithIds_: heuristic send to ' + toStr +
               ' from ' + from + ', captureMethod=' + captured.captureMethod +
               ', messageId=' + captured.messageId);
    return {
      ok: true,
      messageId: captured.messageId,
      threadId: captured.threadId,
      captureMethod: captured.captureMethod
    };
  }

  /**
   * Appends a CSAT survey notification audit row to ReportDistributionLog.
   * @param {AppConfig} cfg
   * @param {Object} opts
   * @private
   */
  function _logSurveyNotification_(cfg, opts) {
    opts = opts || {};
    var toList = String(opts.toList || opts.to || '').trim();
    var ccList = String(opts.ccList || opts.cc || '').trim();
    var toArr = _parseEmailList_(toList);
    var ccArr = _parseEmailList_(ccList);
    try {
      CoreDistribute.appendDistributionLogRow(cfg, {
        timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
          'yyyy-MM-dd HH:mm:ss'),
        appId: cfg.appId || '',
        category: 'Survey Notification',
        notificationKey: String(opts.notificationKey || '').trim(),
        monthLabel: String(opts.periodLabel || opts.monthLabel || '').trim(),
        fromAlias: String(opts.fromAlias || '').trim(),
        subject: String(opts.subject || '').trim(),
        toCount: toArr.length,
        ccCount: ccArr.length,
        toList: toList,
        ccList: ccList,
        status: String(opts.status || 'sent').trim(),
        error: String(opts.error || '').trim(),
        messageId: String(opts.messageId || '').trim(),
        threadId: String(opts.threadId || '').trim(),
        captureMethod: String(opts.captureMethod || '').trim(),
        sentBy: Session.getActiveUser().getEmail() ||
                Session.getEffectiveUser().getEmail() || 'unknown',
        mode: String(opts.mode || 'prod').trim()
      });
    } catch (e) {
      Logger.log('CoreNotify._logSurveyNotification_: append failed: ' + e);
    }
  }

  /**
   * @param {Object} row
   * @param {Object} dep
   * @param {Object} contactsMap
   * @param {AppConfig} cfg
   * @param {boolean} isTest
   * @param {string} testRecipient
   * @param {number} daysUntil
   * @return {boolean}
   * @private
   */
  function _sendEmReminder_(row, dep, contactsMap, cfg, isTest, testRecipient, daysUntil) {
    var tz = Session.getScriptTimeZone();
    var tokens = _emTokenValues_(dep, contactsMap, tz, daysUntil, cfg);
    var subjResult = _renderTemplate_(row.subject, tokens, EM_TOKENS_);
    var bodyResult = _renderTemplate_(row.bodyTemplate, tokens, EM_TOKENS_);
    if (subjResult.errors.length || bodyResult.errors.length) {
      Logger.log('CoreNotify._sendEmReminder_: template error: ' +
                 subjResult.errors.concat(bodyResult.errors).join('; '));
      return false;
    }

    var recipients = _resolveRecipients_(row, dep, contactsMap, cfg, 'to');
    var ccList = _resolveRecipients_(row, dep, contactsMap, cfg, 'cc');
    if (!isTest && !recipients.length) {
      Logger.log('CoreNotify._sendEmReminder_: 0 recipients for ' + dep.deploymentId + '; skipped.');
      return false;
    }

    var to = isTest ? testRecipient : recipients.join(',');
    var cc = isTest ? '' : (ccList.length ? ccList.join(',') : String(row.cc || '').trim());
    var subject = isTest ? '[TEST] ' + subjResult.html : subjResult.html;
    var body = bodyResult.html;
    if (isTest) {
      body = '<p style="background:#fff3cd;border:1px solid #ffc107;padding:8px;"><strong>[TEST]</strong> ' +
        'This is a test notification. Production recipients: ' +
        _escapeHtml_(recipients.join(', ') || '(none)') + '</p>' + body;
    }

    var sent = _gmailSend_(to, subject, body, row.fromAlias, cc, cfg.notify.allowedFromAliases);
    _logSurveyNotification_(cfg, {
      notificationKey: String(row.notificationKey || '').trim(),
      fromAlias: row.fromAlias,
      subject: subject,
      toList: to,
      ccList: cc,
      status: sent ? 'sent' : 'failed',
      error: sent ? '' : 'Gmail send failed',
      mode: isTest ? 'test' : 'prod',
      periodLabel: dep && dep.eventDate ? String(dep.eventDate) : ''
    });
    return sent;
  }

  /**
   * @param {Object} row
   * @param {AppConfig} cfg
   * @param {Array<Object>} upcomingRows
   * @param {Object} contactsMap
   * @param {boolean} isTest
   * @param {string} testRecipient
   * @param {string} ddName   For perRecipient
   * @param {Array<Object>} filteredRows
   * @return {boolean}
   * @private
   */
  function _sendDdDigest_(row, cfg, upcomingRows, contactsMap, isTest, testRecipient, ddName, filteredRows) {
    var tz = Session.getScriptTimeZone();
    var today = new Date();
    var windowDays = parseInt(row.windowDays, 10) || 30;
    var rows = filteredRows || upcomingRows;
    var tokens = {
      ddName: ddName || 'Delivery Director',
      upcomingList: _buildUpcomingListHtml_(rows, tz),
      windowDays: String(windowDays),
      periodLabel: _periodLabel_(today, tz)
    };

    var subjResult = _renderTemplate_(row.subject, tokens, DIGEST_TOKENS_);
    var bodyResult = _renderTemplate_(row.bodyTemplate, tokens, DIGEST_TOKENS_);
    if (subjResult.errors.length || bodyResult.errors.length) {
      Logger.log('CoreNotify._sendDdDigest_: template error: ' +
                 subjResult.errors.concat(bodyResult.errors).join('; '));
      return false;
    }

    var depCtx = rows.length ? rows[0] : null;
    var recipients = _resolveRecipients_(row, depCtx, contactsMap, cfg, 'to');
    if (row.grouping === 'perRecipient' && ddName && depCtx) {
      recipients = _emailsForDeliveryDirector_(depCtx, _getDdContactsMap_(cfg));
    }

    if (!isTest && !recipients.length) {
      Logger.log('CoreNotify._sendDdDigest_: 0 recipients' +
                 (ddName ? ' for DD ' + ddName : '') + '; skipped.');
      return false;
    }

    var to = isTest ? testRecipient : recipients.join(',');
    var ccList = _resolveRecipients_(row, depCtx, contactsMap, cfg, 'cc');
    var cc = isTest ? '' : (ccList.length ? ccList.join(',') : String(row.cc || '').trim());
    var subject = isTest ? '[TEST] ' + subjResult.html : subjResult.html;
    var body = bodyResult.html;
    if (isTest) {
      body = '<p style="background:#fff3cd;border:1px solid #ffc107;padding:8px;"><strong>[TEST]</strong> ' +
        'This is a test digest. Production recipients: ' +
        _escapeHtml_(recipients.join(', ') || '(none)') + '</p>' + body;
    }

    var sent = _gmailSend_(to, subject, body, row.fromAlias, cc, cfg.notify.allowedFromAliases);
    _logSurveyNotification_(cfg, {
      notificationKey: String(row.notificationKey || '').trim(),
      fromAlias: row.fromAlias,
      subject: subject,
      toList: to,
      ccList: cc,
      status: sent ? 'sent' : 'failed',
      error: sent ? '' : 'Gmail send failed',
      mode: isTest ? 'test' : 'prod',
      periodLabel: tokens.periodLabel
    });
    return sent;
  }

  /**
   * Validates every NotificationConfig row; writes status column.
   * @param {AppConfig} config
   * @return {{valid:Array<Object>, invalid:Array<Object>}}
   */
  function validateNotificationConfig(config) {
    var cfg = CoreConfig.withDefaults(config);
    Logger.log('CoreNotify.validateNotificationConfig: appId=' + cfg.appId);

    var sheet = _getConfigSheet_(cfg);
    if (!sheet) {
      Logger.log('CoreNotify.validateNotificationConfig: sheet missing; nothing to validate.');
      return { valid: [], invalid: [] };
    }

    var rows = readNotificationConfig_(cfg);
    var contactsMap = {};
    try {
      contactsMap = CoreData.getDeploymentContactsMap_(cfg) || {};
    } catch (e) {
      Logger.log('CoreNotify.validateNotificationConfig: contacts map failed: ' + e);
    }

    var sampleDeps = [];
    try {
      sampleDeps = _getUpcomingBatchRows_(cfg, 30);
    } catch (e) {
      Logger.log('CoreNotify.validateNotificationConfig: sample deps failed: ' + e);
    }

    var valid = [];
    var invalid = [];
    var statusCol = HEADERS_.indexOf('status') + 1;
    var headerRow = _headerRowIndex_(cfg);

    rows.forEach(function (row) {
      var errors = [];
      var type = String(row.type || '').trim();
      var key = String(row.notificationKey || '').trim();

      if (!key) errors.push('missing notificationKey');
      if (['em_reminder', 'dd_digest', 'deployment_intelligence'].indexOf(type) < 0) {
        errors.push('invalid type');
      }

      var enabledVal = row.enabled;
      if (enabledVal !== true && enabledVal !== false &&
          ['TRUE', 'FALSE', 'true', 'false', ''].indexOf(String(enabledVal).trim()) < 0 &&
          String(enabledVal).trim() !== '') {
        errors.push('enabled must be TRUE or FALSE');
      }

      var grouping = String(row.grouping || '').trim();
      if (type === 'dd_digest' && grouping && ['all', 'perRecipient'].indexOf(grouping) < 0) {
        errors.push('invalid grouping');
      }

      var toRole = String(row.toRole || '').trim();
      if (toRole && ['engagementManager', 'deliveryDirector'].indexOf(toRole) < 0) {
        errors.push('invalid toRole');
      }

      var toLiteral = String(row.to || '').trim();
      if (toLiteral) {
        _parseEmailList_(toLiteral).forEach(function (e) {
          if (!_isValidEmail_(e)) errors.push('invalid to email: ' + e);
        });
      }

      var ccLiteral = String(row.cc || '').trim();
      if (ccLiteral && _parseEmailList_(ccLiteral).some(function (e) { return !_isValidEmail_(e); })) {
        errors.push('invalid cc email');
      }

      if (type === 'em_reminder') {
        var ld = row.leadDays;
        if (ld !== '' && ld != null && isNaN(parseInt(ld, 10))) errors.push('leadDays must be numeric');
        var fd = row.finalDays;
        if (fd !== '' && fd != null && isNaN(parseInt(fd, 10))) errors.push('finalDays must be numeric');
      }

      if (type === 'dd_digest') {
        var wd = row.windowDays;
        if (wd !== '' && wd != null && isNaN(parseInt(wd, 10))) errors.push('windowDays must be numeric');
        var cadence = String(row.cadence || 'monthly').trim();
        if (['monthly', 'bimonthly'].indexOf(cadence) < 0) errors.push('invalid cadence');
        var sd = row.sendDay;
        if (sd !== '' && sd != null && isNaN(parseInt(sd, 10))) errors.push('sendDay must be numeric');
      }

      if (type !== 'deployment_intelligence') {
        var allowedTokens = type === 'dd_digest' ? DIGEST_TOKENS_ : EM_TOKENS_;
        _extractTokens_(row.subject).forEach(function (t) {
          if (allowedTokens.indexOf(t) < 0) errors.push('unknown token in subject: {{' + t + '}}');
        });
        _extractTokens_(row.bodyTemplate).forEach(function (t) {
          if (allowedTokens.indexOf(t) < 0) errors.push('unknown token in body: {{' + t + '}}');
        });
      }

      var fromAlias = String(row.fromAlias || '').trim();
      if (!fromAlias) {
        errors.push('fromAlias required');
      } else if (cfg.notify.allowedFromAliases.indexOf(fromAlias) < 0) {
        errors.push('fromAlias not in allowed list');
      }

      if (!toLiteral && toRole) {
        var dryRecipients = _dryRunRecipients_(row, cfg, sampleDeps, contactsMap);
        if (!dryRecipients.length) {
          errors.push('role resolved to 0 recipients');
        }
      }

      var status = errors.length ? ('⚠ error: ' + errors.join('; ')) : '✓ valid';
      if (row._sheetRow) {
        sheet.getRange(row._sheetRow, statusCol).setValue(status);
      }

      row.status = status;
      if (errors.length) {
        invalid.push(row);
        Logger.log('CoreNotify.validateNotificationConfig: invalid row ' + key + ': ' + status);
      } else {
        valid.push(row);
      }
    });

    return { valid: valid, invalid: invalid };
  }

  /**
   * Daily trigger entry point.
   * @param {AppConfig} config
   * @return {void}
   */
  function runNotifications(config) {
    var cfg = CoreConfig.withDefaults(config);
    Logger.log('CoreNotify.runNotifications: start appId=' + cfg.appId);

    if (!cfg.notify.enabled) {
      Logger.log('CoreNotify.runNotifications: master toggle disabled; skipped.');
      return;
    }

    var validation = validateNotificationConfig(cfg);
    var rows = validation.valid.filter(function (row) { return _isEnabled_(row.enabled); });

    if (!rows.length) {
      Logger.log('CoreNotify.runNotifications: no enabled valid rows; done.');
      return;
    }

    var tz = Session.getScriptTimeZone();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var contactsMap = {};
    try {
      // Batch rows carry embedded contacts; build map lazily from batch view
      var batchPayload = CoreData.getMdsPglBatchView(cfg, null, 6);
      _flattenBatchRows_(batchPayload).forEach(function (r) {
        if (r.deploymentId && r.contacts) contactsMap[r.deploymentId] = r.contacts;
      });
    } catch (e) {
      Logger.log('CoreNotify.runNotifications: contacts map build failed: ' + e);
    }

    var sent = _loadSentKeys_(cfg);
    var allBatchRows = [];
    try {
      allBatchRows = _flattenBatchRows_(CoreData.getMdsPglBatchView(cfg, null, 6));
    } catch (e) {
      Logger.log('CoreNotify.runNotifications: getMdsPglBatchView failed: ' + e);
      return;
    }

    rows.forEach(function (row) {
      var type = String(row.type || '').trim();
      var key = String(row.notificationKey || '').trim();

      if (type === 'deployment_intelligence') {
        var diResults = processDeploymentIntelligenceEmailQueue(cfg, {
          notificationRow: row,
          productionSend: true
        });
        if (diResults && diResults.sentCount) {
          Logger.log('CoreNotify.runNotifications: deployment_intelligence sent=' +
            diResults.sentCount);
        }
        return;
      }

      if (type === 'em_reminder') {
        var stage = _reminderStage_(key);
        var targetDays = stage === 'final' ?
          (parseInt(row.finalDays, 10) || 3) :
          (parseInt(row.leadDays, 10) || 10);

        allBatchRows.forEach(function (dep) {
          if (!dep.eventDate) return;
          var daysUntil = _daysUntil_(dep.eventDate, today);
          if (daysUntil !== targetDays) return;

          var antiKey = dep.deploymentId + '|' +
            Utilities.formatDate(new Date(dep.eventDate), tz, 'yyyy-MM-dd') + '|' +
            dep.surveyType + '|' + stage;
          if (sent[antiKey]) {
            Logger.log('CoreNotify.runNotifications: already sent ' + antiKey);
            return;
          }

          var recipients = _resolveRecipients_(row, dep, contactsMap, cfg, 'to');
          if (!recipients.length) {
            Logger.log('CoreNotify.runNotifications: 0 recipients for ' + antiKey + '; skipped.');
            return;
          }

          if (_sendEmReminder_(row, dep, contactsMap, cfg, false, '', daysUntil)) {
            sent[antiKey] = new Date().toISOString();
            Logger.log('CoreNotify.runNotifications: sent em_reminder ' + antiKey);
          }
        });
      }

      if (type === 'dd_digest') {
        var cadence = String(row.cadence || 'monthly').trim();
        var sendDay = parseInt(row.sendDay, 10) || 1;
        if (!_isDigestSendDay_(cadence, sendDay, today)) {
          Logger.log('CoreNotify.runNotifications: dd_digest not due today for ' + key);
          return;
        }

        var windowDays = parseInt(row.windowDays, 10) || 30;
        var upcoming = allBatchRows.filter(function (dep) {
          if (!dep.eventDate) return false;
          var du = _daysUntil_(dep.eventDate, today);
          return du >= 0 && du <= windowDays;
        });
        upcoming = _filterDdDigestPartnerRows_(cfg, upcoming);

        var periodKey = key + '|' + _periodKey_(today, tz) + '|' + String(row.grouping || 'all');
        if (sent[periodKey]) {
          Logger.log('CoreNotify.runNotifications: digest already sent ' + periodKey);
          return;
        }

        var grouping = String(row.grouping || 'all').trim();
        var sentAny = false;

        if (grouping === 'perRecipient') {
          var byDd = {};
          upcoming.forEach(function (dep) {
            var dd = String(dep.deliveryDirector || '(Unassigned)').trim() || '(Unassigned)';
            if (!byDd[dd]) byDd[dd] = [];
            byDd[dd].push(dep);
          });

          Object.keys(byDd).forEach(function (dd) {
            var ddRows = byDd[dd];
            var ddPeriodKey = periodKey + '|' + dd;
            if (sent[ddPeriodKey]) return;

            var recipients = _resolveRecipients_(row, ddRows[0], contactsMap, cfg, 'to');
            if (!recipients.length) {
              Logger.log('CoreNotify.runNotifications: 0 DD recipients for ' + dd + '; skipped.');
              return;
            }

            if (_sendDdDigest_(row, cfg, upcoming, contactsMap, false, '', dd, ddRows)) {
              sent[ddPeriodKey] = new Date().toISOString();
              sentAny = true;
            }
          });
        } else {
          var allRecipients = _resolveRecipients_(row, null, contactsMap, cfg, 'to');
          if (!allRecipients.length) {
            Logger.log('CoreNotify.runNotifications: 0 digest recipients; skipped.');
            return;
          }
          if (_sendDdDigest_(row, cfg, upcoming, contactsMap, false, '', '', upcoming)) {
            sent[periodKey] = new Date().toISOString();
            sentAny = true;
          }
        }

        if (sentAny) {
          Logger.log('CoreNotify.runNotifications: sent dd_digest ' + periodKey);
        }
      }
    });

    _saveSentKeys_(cfg, sent);
    Logger.log('CoreNotify.runNotifications: done.');
  }

  /**
   * Side-effect-free test send via production render path.
   * @param {AppConfig} config
   * @param {string} notificationKey
   * @param {string=} testRecipient
   * @return {boolean}
   */
  function sendTestNotification(config, notificationKey, testRecipient) {
    var cfg = CoreConfig.withDefaults(config);
    var recipient = String(testRecipient || cfg.notify.testDefaultRecipient || '').trim();
    if (!recipient) recipient = 'jeffrey.ditty@workday.com';

    Logger.log('CoreNotify.sendTestNotification: key=' + notificationKey + ' to=' + recipient);

    var rows = readNotificationConfig_(cfg);
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].notificationKey || '').trim() === notificationKey) {
        row = rows[i];
        break;
      }
    }
    if (!row) {
      Logger.log('CoreNotify.sendTestNotification: key not found: ' + notificationKey);
      return false;
    }

    var validation = validateNotificationConfig(cfg);
    var isValid = validation.valid.some(function (r) {
      return String(r.notificationKey).trim() === notificationKey;
    });
    if (!isValid) {
      Logger.log('CoreNotify.sendTestNotification: row invalid; aborting test send.');
      return false;
    }

    var tz = Session.getScriptTimeZone();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var contactsMap = {};
    var sampleDeps = [];
    try {
      sampleDeps = _flattenBatchRows_(CoreData.getMdsPglBatchView(cfg, null, 6));
      sampleDeps.forEach(function (r) {
        if (r.deploymentId && r.contacts) contactsMap[r.deploymentId] = r.contacts;
      });
    } catch (e) {
      Logger.log('CoreNotify.sendTestNotification: batch view failed: ' + e);
    }

    var type = String(row.type || '').trim();
    if (type === 'em_reminder') {
      var dep = sampleDeps.length ? sampleDeps[0] : {
        deploymentId: 'TEST',
        accountName: 'Sample Account',
        deploymentName: 'Sample Deployment',
        deliveryDirector: 'Sample DD',
        surveyType: 'MDS',
        eventDate: today,
        contacts: { engagementManagers: [{ name: 'Sample EM', email: recipient }] }
      };
      var daysUntil = dep.eventDate ? _daysUntil_(dep.eventDate, today) : 10;
      return _sendEmReminder_(row, dep, contactsMap, cfg, true, recipient, daysUntil);
    }

    if (type === 'dd_digest') {
      var windowDays = parseInt(row.windowDays, 10) || 30;
      var upcoming = sampleDeps.length ? sampleDeps.filter(function (dep) {
        if (!dep.eventDate) return false;
        var du = _daysUntil_(dep.eventDate, today);
        return du >= 0 && du <= windowDays;
      }) : [];
      upcoming = _filterDdDigestPartnerRows_(cfg, upcoming);
      if (!upcoming.length) {
        upcoming = [{
          accountName: 'Sample Account',
          deploymentName: 'Sample Deployment',
          deliveryDirector: 'Sample DD',
          surveyType: 'PGL',
          eventDate: today,
          deploymentId: 'TEST'
        }];
      }

      var grouping = String(row.grouping || 'all').trim();
      if (grouping === 'perRecipient') {
        var dd = upcoming.length ?
          String(upcoming[0].deliveryDirector || 'Sample DD') : 'Sample DD';
        return _sendDdDigest_(row, cfg, upcoming, contactsMap, true, recipient, dd, upcoming);
      }
      return _sendDdDigest_(row, cfg, upcoming, contactsMap, true, recipient, '', upcoming);
    }

    Logger.log('CoreNotify.sendTestNotification: unknown type ' + type);
    return false;
  }

  /**
   * Creates or repairs the NotificationConfig sheet (idempotent).
   * @param {AppConfig} config
   * @return {void}
   */
  function initNotificationConfigSheet(config) {
    var cfg = CoreConfig.withDefaults(config);
    var sheetName = cfg.notify.configSheet || 'NotificationConfig';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    var aliases = cfg.notify.allowedFromAliases.join(', ');

    if (sheet) {
      Logger.log('CoreNotify.initNotificationConfigSheet: sheet exists; repairing headers/validation only.');
      _repairConfigSheet_(sheet, cfg, aliases);
      return;
    }

    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, HEADERS_.length).merge();
    sheet.getRange(1, 1).setValue(
      'Allowed fromAlias values (must be verified Gmail send-as aliases): ' + aliases
    );
    sheet.getRange(2, 1, 1, HEADERS_.length).setValues([HEADERS_]);
    sheet.setFrozenRows(2);
    sheet.getRange(2, 1, 1, HEADERS_.length).setFontWeight('bold');

    var seedRows = _defaultSeedRows_(cfg);
    if (seedRows.length) {
      sheet.getRange(3, 1, seedRows.length, HEADERS_.length).setValues(seedRows);
    }

    _applyConfigValidations_(sheet, 3, 2 + seedRows.length);
    Logger.log('CoreNotify.initNotificationConfigSheet: created sheet with ' + seedRows.length + ' seed rows.');
  }

  /**
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {AppConfig} cfg
   * @param {string} aliasNote
   * @private
   */
  function _repairConfigSheet_(sheet, cfg, aliasNote) {
    var headerRow = _headerRowIndex_(cfg);
    var note = 'Allowed fromAlias values (must be verified Gmail send-as aliases): ' + aliasNote;
    if (sheet.getRange(1, 1).getValue() !== note) {
      sheet.getRange(1, 1, 1, HEADERS_.length).merge();
      sheet.getRange(1, 1).setValue(note);
    }

    var existingHeaders = sheet.getRange(headerRow, 1, headerRow, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });

    var missing = HEADERS_.filter(function (h) { return existingHeaders.indexOf(h) < 0; });
    if (missing.length) {
      var startCol = existingHeaders.length + 1;
      sheet.getRange(headerRow, startCol, 1, missing.length)
        .setValues([missing]);
    }

    var lastRow = Math.max(sheet.getLastRow(), headerRow);
    _applyConfigValidations_(sheet, headerRow + 1, lastRow);

    var keysPresent = {};
    if (lastRow > headerRow) {
      var keyCol = existingHeaders.indexOf('notificationKey') + 1;
      if (keyCol < 1) keyCol = 1;
      var keyVals = sheet.getRange(headerRow + 1, keyCol, lastRow, keyCol).getValues();
      keyVals.forEach(function (kv) {
        keysPresent[String(kv[0] || '').trim()] = true;
      });
    }

    var toAdd = [];
    _defaultSeedRows_(cfg).forEach(function (seed) {
      if (!keysPresent[seed[0]]) toAdd.push(seed);
    });
    if (toAdd.length) {
      var insertRow = lastRow + 1;
      sheet.getRange(insertRow, 1, toAdd.length, HEADERS_.length).setValues(toAdd);
      _applyConfigValidations_(sheet, insertRow, insertRow + toAdd.length - 1);
      Logger.log('CoreNotify.initNotificationConfigSheet: added missing seed rows: ' +
                 toAdd.map(function (r) { return r[0]; }).join(', '));
    }
  }

  /**
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {number} startRow
   * @param {number} endRow
   * @private
   */
  function _applyConfigValidations_(sheet, startRow, endRow) {
    if (endRow < startRow) return;

    var col = function (name) { return HEADERS_.indexOf(name) + 1; };

    var enabledRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['TRUE', 'FALSE'], true).build();
    sheet.getRange(startRow, col('enabled'), endRow, col('enabled')).setDataValidation(enabledRule);

    var typeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['em_reminder', 'dd_digest', 'deployment_intelligence'], true).build();
    sheet.getRange(startRow, col('type'), endRow, col('type')).setDataValidation(typeRule);

    var roleRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['', 'engagementManager', 'deliveryDirector'], true).build();
    sheet.getRange(startRow, col('toRole'), endRow, col('toRole')).setDataValidation(roleRule);

    var groupingRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['all', 'perRecipient'], true).build();
    sheet.getRange(startRow, col('grouping'), endRow, col('grouping')).setDataValidation(groupingRule);
  }

  /**
   * @param {AppConfig} cfg
   * @return {Array<Array>}
   * @private
   */
  function _defaultSeedRows_(cfg) {
    var fromAlias = cfg.notify.allowedFromAliases[0] || 'jeffrey.ditty@workday.com';
    var testTo = cfg.notify.testDefaultRecipient || 'jeffrey.ditty@workday.com';

    var rows = [
      [
        'em_reminder_first', 'FALSE', 'em_reminder', 'engagementManager', testTo, '',
        fromAlias, '', 10, 3, '', '', '',
        'Reminder: {{surveyType}} survey for {{account}} in {{daysUntil}} days',
        '<p>Hi {{emName}},</p><p>This is a reminder that a <strong>{{surveyType}}</strong> survey ' +
        'for <strong>{{account}}</strong> ({{deploymentName}}) is coming up on <strong>{{eventDate}}</strong> ' +
        '({{daysUntil}} days).</p><p>Delivery Director: {{dd}}</p>',
        ''
      ],
      [
        'em_reminder_final', 'FALSE', 'em_reminder', 'engagementManager', testTo, '',
        fromAlias, '', 10, 3, '', '', '',
        'Final reminder: {{surveyType}} survey for {{account}} in {{daysUntil}} days',
        '<p>Hi {{emName}},</p><p><strong>Final reminder:</strong> the <strong>{{surveyType}}</strong> survey ' +
        'for <strong>{{account}}</strong> ({{deploymentName}}) is on <strong>{{eventDate}}</strong> ' +
        '({{daysUntil}} days).</p><p>Delivery Director: {{dd}}</p>',
        ''
      ],
      [
        'dd_digest', 'FALSE', 'dd_digest', 'deliveryDirector', testTo, '',
        fromAlias, 'all', '', '', 30, 'monthly', 1,
        'Upcoming MDS/PGL events — {{periodLabel}}',
        '<p>Hi {{ddName}},</p><p>Here are upcoming MDS/PGL events in the next {{windowDays}} days ' +
        '({{periodLabel}}):</p>{{upcomingList}}',
        ''
      ]
    ];
    if (CoreConfig.isDeploymentIntelligenceEnabled(cfg)) {
      var diLabel = (cfg.deploymentIntelligence && cfg.deploymentIntelligence.displayName) ||
        'Deployment Intelligence';
      rows.push([
        'deployment_intelligence_weekly', 'FALSE', 'deployment_intelligence', '', testTo, '',
        fromAlias, '', '', '', '', '', '',
        diLabel + ' — weekly',
        '',
        ''
      ]);
    }
    return rows;
  }

  /**
   * Edits an EXISTING NotificationConfig rule (matched by notificationKey).
   * Rejects unknown keys (no UI-created rules). Writes provided columns, then
   * re-validates and returns the row's validation result.
   * @param {AppConfig} config
   * @param {Object} rule { notificationKey, enabled, toRole, to, cc, fromAlias,
   *                        grouping, leadDays, finalDays, windowDays, cadence,
   *                        sendDay, subject, bodyTemplate }
   * @return {{success:boolean, updated:boolean, status:string, error?:string}}
   */
  function upsertNotificationRule(config, rule) {
    var cfg = CoreConfig.withDefaults(config);
    Logger.log('CoreNotify.upsertNotificationRule: key=' + (rule && rule.notificationKey));

    if (!rule || !String(rule.notificationKey || '').trim()) {
      return { success: false, updated: false, status: '', error: 'missing notificationKey' };
    }

    var key = String(rule.notificationKey).trim();
    var rows = readNotificationConfig_(cfg);
    var match = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].notificationKey || '').trim() === key) {
        match = rows[i];
        break;
      }
    }
    if (!match) {
      return { success: false, updated: false, status: '', error: 'unknown notificationKey' };
    }

    var sheet = _getConfigSheet_(cfg);
    if (!sheet) {
      return { success: false, updated: false, status: '', error: 'sheet missing' };
    }

    var headerRow = _headerRowIndex_(cfg);
    var lastCol = Math.max(sheet.getLastColumn(), HEADERS_.length);
    var headerCells = sheet.getRange(headerRow, 1, headerRow, lastCol).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    var colMap = {};
    for (var h = 0; h < HEADERS_.length; h++) {
      var idx = headerCells.indexOf(HEADERS_[h]);
      colMap[HEADERS_[h]] = idx >= 0 ? idx + 1 : h + 1;
    }

    var writable = [
      'enabled', 'toRole', 'to', 'cc', 'fromAlias', 'grouping',
      'leadDays', 'finalDays', 'windowDays', 'cadence', 'sendDay', 'subject', 'bodyTemplate'
    ];
    var sheetRow = match._sheetRow;

    writable.forEach(function (col) {
      if (!Object.prototype.hasOwnProperty.call(rule, col)) return;
      var val = rule[col];
      if (col === 'enabled') {
        val = _isEnabled_(val) ? 'TRUE' : 'FALSE';
      }
      sheet.getRange(sheetRow, colMap[col]).setValue(val);
    });

    var validation = validateNotificationConfig(cfg);
    var allRows = validation.valid.concat(validation.invalid);
    var status = '';
    for (var j = 0; j < allRows.length; j++) {
      if (String(allRows[j].notificationKey || '').trim() === key) {
        status = String(allRows[j].status || '');
        break;
      }
    }

    return { success: true, updated: true, status: status };
  }

  /**
   * Returns notification keys for menu building.
   * @param {AppConfig} config
   * @return {Array<string>}
   */
  function getNotificationKeysForMenu(config) {
    var rows = readNotificationConfig_(CoreConfig.withDefaults(config));
    if (rows.length) {
      return rows.map(function (r) { return String(r.notificationKey || '').trim(); }).filter(Boolean);
    }
    return SEED_KEYS_.slice();
  }

  /**
   * No-send diagnostic: DD Digest display merge (MDS/PGL same deployment/date).
   * @param {AppConfig} config
   * @param {number=} windowDays  Default 30
   * @return {Object}
   */
  function debugDdDigestDedupeForUI(config, windowDays) {
    var cfg = CoreConfig.withDefaults(config);
    var appId = cfg.appId || 'default';
    var horizonDays = parseInt(windowDays, 10) || 30;
    var tz = Session.getScriptTimeZone();
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var upcoming = _getUpcomingBatchRows_(cfg, horizonDays);
    var prePartnerCount = upcoming.length;
    upcoming = _filterDdDigestPartnerRows_(cfg, upcoming);
    var postPartnerCount = upcoming.length;

    var mergeResult = _mergeDdDigestDuplicateEvents_(upcoming, 12);
    var assignmentSummary = {};
    try {
      assignmentSummary = CoreData.debugDdDigestAssignmentsForUI(cfg, horizonDays) || {};
    } catch (e) {
      Logger.log('CoreNotify.debugDdDigestDedupeForUI: assignments diagnostic failed: ' + e);
    }

    var summary = {
      appId: appId,
      horizonDays: horizonDays,
      prePartnerFilterRowCount: prePartnerCount,
      postPartnerFilterRowCount: postPartnerCount,
      preDedupeRowCount: mergeResult.beforeCount,
      postDedupeRowCount: mergeResult.afterCount,
      duplicateMergedCount: mergeResult.duplicateMergedCount,
      sampleMergedDuplicates: mergeResult.sampleMergedDuplicates,
      partnerFilterEnabled: !!(assignmentSummary.partnerFilterEnabled),
      partnerNames: assignmentSummary.partnerNames || [],
      assignedToDd: assignmentSummary.assignedToDd,
      unassigned: assignmentSummary.unassigned
    };

    Logger.log('CoreNotify.debugDdDigestDedupeForUI(' + appId + '): ' + JSON.stringify(summary));
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Deployment Signal leadership notification boundary
  // ---------------------------------------------------------------------------

  var DEPLOYMENT_SIGNAL_NOTIFICATION_KEY_ = 'deployment_signal_leadership';

  /**
   * @param {Object} runRow completed run row
   * @return {boolean}
   */
  function isDeploymentSignalNotificationEligible(runRow) {
    if (!runRow) return false;
    if (String(runRow.run_status) !== CoreDeploymentSignalStore.RUN_STATUS_COMPLETE) {
      return false;
    }
    var newCount = parseInt(runRow.lifecycle_new_count, 10) || 0;
    var escCount = parseInt(runRow.lifecycle_escalated_count, 10) || 0;
    return newCount > 0 || escCount > 0;
  }

  /**
   * @param {Object} runRow
   * @param {Array<Object>} currentSignals active signals after persist
   * @param {AppConfig} appConfig
   * @return {Object}
   */
  function buildDeploymentSignalNotificationPayload(runRow, currentSignals, appConfig) {
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
      notificationKey: DEPLOYMENT_SIGNAL_NOTIFICATION_KEY_,
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
  }

  /**
   * Apply email_status on a completed run without sending unless notify rule exists.
   *
   * @param {AppConfig} appConfig
   * @param {Object} runRow
   * @param {Array<Object>} currentSignals
   * @param {Object=} options { dryRun: boolean }
   * @return {{ email_status: string, payload: (Object|null), sent: boolean }}
   */
  var DEPLOYMENT_INTELLIGENCE_NOTIFICATION_KEY = 'deployment_intelligence_weekly';
  var DEPLOYMENT_INTELLIGENCE_EMAIL_MAX_ATTEMPTS_ = 5;

  /**
   * @param {Object=} options
   * @return {Date}
   * @private
   */
  function _dispatchNow_(options) {
    return options && options.now ? new Date(options.now) : new Date();
  }

  /**
   * @param {string} message
   * @return {string}
   * @private
   */
  function _sanitizeDiEmailError_(message) {
    var s = String(message || '').trim();
    if (!s) return 'send_failed';
    if (s.length > 240) s = s.slice(0, 240);
    return s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
  }

  /**
   * @param {AppConfig} cfg
   * @return {number}
   * @private
   */
  function _diNotBeforeHour_(cfg) {
    var h = parseInt((cfg.deploymentIntelligence || {}).sendNotBeforeHourLocal, 10);
    if (isNaN(h) || h < 0) return 8;
    if (h > 23) return 23;
    return h;
  }

  /**
   * GAS formatDate u: Sunday=1 … Saturday=7.
   *
   * @param {string} tz
   * @param {Date} now
   * @return {{ weekday: number, hour: number }}
   * @private
   */
  function _localWeekdayAndHour_(tz, now) {
    return {
      weekday: parseInt(Utilities.formatDate(now, tz, 'u'), 10) || 1,
      hour: parseInt(Utilities.formatDate(now, tz, 'H'), 10) || 0
    };
  }

  /**
   * @param {Object} notificationRow
   * @param {string} tz
   * @param {Date} now
   * @return {boolean}
   * @private
   */
  function _isDiWeeklySendDay_(notificationRow, tz, now) {
    var sdRaw = notificationRow && notificationRow.sendDay;
    if (sdRaw === '' || sdRaw == null) return false;
    var target = parseInt(sdRaw, 10);
    if (isNaN(target) || target < 1 || target > 7) return false;
    return _localWeekdayAndHour_(tz, now).weekday === target;
  }

  /**
   * @param {AppConfig} cfg
   * @param {string} tz
   * @param {Date} now
   * @return {boolean}
   * @private
   */
  function _isDiNotBeforeHourMet_(cfg, tz, now) {
    return _localWeekdayAndHour_(tz, now).hour >= _diNotBeforeHour_(cfg);
  }

  /**
   * @param {AppConfig} cfg
   * @param {Object=} options
   * @return {Object|null}
   * @private
   */
  function _resolveExpectedIntelligenceRun_(cfg, options) {
    var latest = CoreDeploymentSignalPersistence.getLatestApprovedSlgSignalRun(
      cfg, options || {});
    if (!latest) return null;
    var expectedId = 'INT-' + String(latest.signal_run_id || '').trim();
    if (!expectedId || expectedId === 'INT-') return null;
    var rows = CoreDeploymentSignalPersistence._readIntelligenceRows_(cfg, options.store);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].intelligence_run_id || '').trim() === expectedId) {
        return rows[i];
      }
    }
    return null;
  }

  /**
   * @param {Object} row
   * @return {boolean}
   * @private
   */
  function _diEmailStatusEligibleForAuto_(row) {
    var st = String(row.email_status || '').trim();
    if (st === CoreDeploymentSignalStore.EMAIL_STATUS_SENT) return false;
    if (st === CoreDeploymentSignalStore.EMAIL_STATUS_NOT_REQUIRED) return false;
    if (st === CoreDeploymentSignalStore.EMAIL_STATUS_PENDING) return true;
    if (st === CoreDeploymentSignalStore.EMAIL_STATUS_FAILED) {
      var attempts = parseInt(row.email_attempt_count, 10) || 0;
      return attempts < DEPLOYMENT_INTELLIGENCE_EMAIL_MAX_ATTEMPTS_;
    }
    return false;
  }

  /**
   * @param {Object} notificationRow
   * @param {AppConfig} cfg
   * @return {boolean}
   * @private
   */
  function _diProductionRecipientsNonEmpty_(notificationRow, cfg) {
    if (!notificationRow || !_isEnabled_(notificationRow.enabled)) return false;
    return _resolveRecipients_(notificationRow, null, {}, cfg, 'to').length > 0;
  }

  /**
   * Production automatic Deployment Intelligence email gates (schedule, audience, artifact).
   *
   * @param {AppConfig} cfg
   * @param {Object} runRow
   * @param {Object|null} notificationRow
   * @param {Object=} options
   * @return {boolean}
   * @private
   */
  function _deploymentIntelligenceAutoSendEligible_(cfg, runRow, notificationRow, options) {
    options = options || {};
    if (options.explicitTestSend) return true;
    if (!options.productionSend) return true;
    if (!CoreConfig.isDeploymentIntelligenceEnabled(cfg)) return false;
    if (!isDeploymentIntelligenceEmailEligible(runRow, cfg)) return false;
    if (!_diEmailStatusEligibleForAuto_(runRow)) return false;
    if (!_diProductionRecipientsNonEmpty_(notificationRow, cfg)) return false;

    var isBaseline = runRow.is_baseline === true ||
      String(runRow.is_baseline).toUpperCase() === 'TRUE';
    if (isBaseline && cfg.deploymentIntelligence.autoSendBaseline !== true) {
      return false;
    }

    if (!options.intelligence_run_id) {
      var expected = _resolveExpectedIntelligenceRun_(cfg, options);
      if (!expected || String(expected.intelligence_run_id) !==
          String(runRow.intelligence_run_id)) {
        return false;
      }
    }

    var tz = Session.getScriptTimeZone();
    var now = _dispatchNow_(options);
    if (!_isDiWeeklySendDay_(notificationRow, tz, now)) return false;
    if (!_isDiNotBeforeHourMet_(cfg, tz, now)) return false;
    return true;
  }

  /**
   * Hourly scheduled notification dispatcher (one lock per invocation).
   *
   * @param {AppConfig} appConfig
   * @param {Object=} options { store, now }
   * @return {Object}
   */
  function runScheduledNotificationDispatch(appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    Logger.log('CoreNotify.runScheduledNotificationDispatch: start appId=' + cfg.appId);
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) {
      Logger.log('CoreNotify.runScheduledNotificationDispatch: lock timeout');
      return { ok: false, reason: 'lock_timeout' };
    }
    try {
      if (!cfg.notify.enabled) {
        return { ok: true, skipped: true, reason: 'notify_master_disabled' };
      }
      var validation = validateNotificationConfig(cfg);
      var enabledRows = validation.valid.filter(function (row) {
        return _isEnabled_(row.enabled);
      });
      var dispatchResults = [];
      enabledRows.forEach(function (row) {
        var type = String(row.type || '').trim();
        if (type === 'deployment_intelligence') {
          var di = processDeploymentIntelligenceEmailQueue(cfg, {
            productionSend: true,
            notificationRow: row,
            store: options.store,
            now: options.now
          });
          dispatchResults.push({
            type: type,
            notificationKey: row.notificationKey,
            sentCount: di.sentCount,
            results: di.results
          });
        }
      });
      return { ok: true, results: dispatchResults };
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Weekly Deployment Intelligence email is eligible when intelligence is READY (even quiet weeks).
   *
   * @param {Object} runRow intelligence run row or artifact distributionState
   * @param {AppConfig=} appConfig
   * @return {boolean}
   */
  function isDeploymentIntelligenceEmailEligible(runRow, appConfig) {
    if (!runRow) return false;
    var cfg = CoreConfig.withDefaults(appConfig || {});
    if (!CoreConfig.isDeploymentIntelligenceEnabled(cfg)) return false;
    var status = String(runRow.intelligence_status || runRow.distributionState &&
      runRow.distributionState.intelligence_status || '').trim();
    return status === CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY;
  }

  /**
   * @param {Object} artifact canonical Deployment Intelligence artifact
   * @param {AppConfig} appConfig
   * @return {string}
   */
  function buildDeploymentIntelligenceEmailHtml(artifact, appConfig) {
    var cfg = CoreConfig.withDefaults(appConfig || {});
    artifact = artifact || {};
    if (!artifact.editorial &&
        typeof CoreDeploymentSignalPersistence !== 'undefined' &&
        CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial) {
      CoreDeploymentSignalPersistence.enrichDeploymentIntelligenceEditorial(artifact);
    }
    var identity = artifact.identity || {};
    var di = cfg.deploymentIntelligence || {};
    var title = String(identity.display_name || di.displayName || 'Deployment Intelligence');
    var editorial = artifact.editorial || {};
    var pulse = artifact.portfolioPulse || {};
    var talkingPoints = artifact.talkingPoints || [];
    var links = artifact.links || {};
    var whatChanged = editorial.whatChanged || {};
    var dataRA = editorial.dataRequiringAttention;

    var sectionLabel = 'font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;' +
      'color:#64748b;margin:28px 0 10px 0;';
    var h1Style = 'font-size:22px;font-weight:700;margin:0 0 6px 0;color:#0f172a;line-height:1.25;';
    var leadStyle = 'margin:0 0 20px 0;font-size:15px;color:#334155;line-height:1.45;';
    var bodyStyle = 'font-size:14px;color:#334155;line-height:1.5;margin:0;';
    var subtleStyle = 'font-size:13px;color:#64748b;line-height:1.45;margin:6px 0 0 0;';
    var linkStyle = 'color:#0875e1;text-decoration:none;font-weight:600;';
    var cardStyle = 'background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;';

    var parts = [];
    parts.push('<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:660px;' +
      'margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;' +
      'padding:28px 24px 32px 24px;">');
    parts.push('<h1 style="' + h1Style + '">' + _escapeHtml_(title) + '</h1>');
    parts.push('<p style="' + leadStyle + '">Here are your talking points for this week.</p>');
    parts.push('<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 4px 0;"/>');

    parts.push('<p style="' + sectionLabel + '">Portfolio pulse</p>');
    if (identity.is_baseline && artifact.portfolioMovementBaselineCopy) {
      parts.push('<p style="font-size:14px;color:#334155;margin:0 0 10px 0;font-style:italic;">' +
        _escapeHtml_(artifact.portfolioMovementBaselineCopy) + '</p>');
    }
    parts.push('<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="' +
      cardStyle + 'margin-bottom:4px;"><tr>');
    function pulseCell(label, value, sub) {
      return '<td style="vertical-align:top;padding:4px 8px;text-align:center;width:20%;">' +
        '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">' +
        _escapeHtml_(label) + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:4px;">' +
        _escapeHtml_(value) + '</div>' +
        (sub ? '<div style="font-size:11px;color:#64748b;margin-top:2px;">' +
          _escapeHtml_(sub) + '</div>' : '') +
        '</td>';
    }
    parts.push(pulseCell('Active', String(pulse.totalActive || 0), ''));
    parts.push(pulseCell('Green', String(pulse.greenPct || 0) + '%', ''));
    parts.push(pulseCell('Yellow', String(pulse.yellowPct || 0) + '%', ''));
    parts.push(pulseCell('Red', String(pulse.redPct || 0) + '%', ''));
    parts.push(pulseCell('MTP ≤90d', String(pulse.mtpWithin90Days || 0), ''));
    parts.push('</tr></table>');
    if (editorial.portfolioPulseLine) {
      parts.push('<p style="' + subtleStyle + '">' + _escapeHtml_(editorial.portfolioPulseLine) + '</p>');
    }

    parts.push('<p style="' + sectionLabel + '">What changed</p>');
    if (whatChanged.headline) {
      parts.push('<p style="' + bodyStyle + 'font-weight:600;">' +
        _escapeHtml_(whatChanged.headline) + '</p>');
    }
    (whatChanged.sublines || []).forEach(function (line) {
      parts.push('<p style="' + subtleStyle + '">' + _escapeHtml_(line) + '</p>');
    });
    if (whatChanged.portfolioMovement && whatChanged.portfolioMovement.detail) {
      parts.push('<p style="' + subtleStyle + '"><strong>' +
        _escapeHtml_(whatChanged.portfolioMovement.headline || '') + '.</strong> ' +
        _escapeHtml_(whatChanged.portfolioMovement.detail) + '.</p>');
    }
    if (editorial.baselineFollowUp) {
      parts.push('<p style="' + subtleStyle + '">' + _escapeHtml_(editorial.baselineFollowUp) + '</p>');
    }

    var tpTitle = editorial.talkingSectionTitle ||
      (talkingPoints.length ? '3 things to know this week' : '');
    if (tpTitle) {
      parts.push('<p style="' + sectionLabel + '">' + _escapeHtml_(tpTitle) + '</p>');
    }
    if (talkingPoints.length) {
      talkingPoints.forEach(function (tp, idx) {
        var headline = tp.headline || tp.leadership_takeaway || tp.deployment_display_name;
        parts.push('<div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid #f1f5f9;">');
        parts.push('<p style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#0f172a;line-height:1.35;">' +
          _escapeHtml_(headline) + '</p>');
        if (tp.leadership_summary) {
          parts.push('<p style="margin:0 0 8px 0;font-size:14px;color:#334155;line-height:1.45;">' +
            _escapeHtml_(tp.leadership_summary) + '</p>');
        } else if (tp.leadership_takeaway && tp.leadership_takeaway !== headline) {
          parts.push('<p style="margin:0 0 8px 0;font-size:14px;color:#334155;line-height:1.45;">' +
            _escapeHtml_(tp.leadership_takeaway) + '</p>');
        }
        if (tp.leadership_question) {
          parts.push('<p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">' +
            '<span style="font-weight:600;">Leadership question:</span> ' +
            _escapeHtml_(tp.leadership_question) + '</p>');
        }
        var sor = tp.system_of_record_note || tp.data_confidence_note;
        if (sor) {
          parts.push('<p style="margin:0 0 8px 0;font-size:13px;color:#b45309;">' +
            _escapeHtml_(sor.indexOf('System-of-record:') >= 0 ? sor :
              'System-of-record: ' + sor) + '</p>');
        }
        if (tp.investigation_url) {
          parts.push('<p style="margin:0;"><a style="' + linkStyle + '" href="' +
            _escapeHtml_(tp.investigation_url) + '">Investigate →</a></p>');
        }
        parts.push('</div>');
      });
    }

    if (dataRA && dataRA.body) {
      parts.push('<p style="' + sectionLabel + '">' +
        _escapeHtml_(dataRA.headline || 'Data requiring attention') + '</p>');
      parts.push('<p style="' + bodyStyle + '">' + _escapeHtml_(dataRA.body) + '</p>');
    }

    parts.push('<p style="' + sectionLabel + '">Current attention</p>');
    parts.push('<p style="' + bodyStyle + '">' +
      _escapeHtml_(editorial.currentAttentionLine || '') + '</p>');

    parts.push('<p style="' + sectionLabel + '">Investigation</p>');
    if (links.exploreDeploymentIntelligenceUrl) {
      parts.push('<p style="margin:0 0 8px 0;"><a style="' + linkStyle + 'font-size:15px;" href="' +
        _escapeHtml_(links.exploreDeploymentIntelligenceUrl) +
        '">Explore Deployment Intelligence →</a></p>');
    }
    parts.push('</div>');
    return parts.join('');
  }

  /**
   * Prepare (or dry-run) weekly Deployment Intelligence email. Does not production-send in v1.
   *
   * @param {AppConfig} appConfig
   * @param {Object} artifact
   * @param {Object=} options { dryRun, testMode, runRow }
   * @return {{ sent: boolean, email_status: string, html: string }}
   */
  /**
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _deploymentIntelligenceTestRecipient_(cfg) {
    var di = cfg.deploymentIntelligence || {};
    var notable = (cfg.notable && cfg.notable.notify) || {};
    return String(di.testEmail || notable.testEmail ||
      cfg.notify.testDefaultRecipient || 'jeffrey.ditty@workday.com').trim();
  }

  /**
   * @param {AppConfig} cfg
   * @param {Object} notificationRow
   * @return {string}
   * @private
   */
  function _deploymentIntelligenceSubject_(cfg, notificationRow) {
    var di = cfg.deploymentIntelligence || {};
    var fromRow = notificationRow && String(notificationRow.subject || '').trim();
    if (fromRow) return fromRow;
    var label = String(di.displayName || 'Deployment Intelligence').trim();
    return label + ' — weekly';
  }

  /**
   * Deliver READY intelligence emails (production config or explicit test send).
   *
   * @param {AppConfig} appConfig
   * @param {Object=} options
   * @param {boolean=} options.explicitTestSend send only to configured test recipient
   * @param {boolean=} options.productionSend honor NotificationConfig when enabled
   * @param {string=} options.intelligence_run_id optional single-run target
   * @param {Object=} options.notificationRow NotificationConfig row (production)
   * @return {{ sentCount: number, results: Array<Object> }}
   */
  function processDeploymentIntelligenceEmailQueue(appConfig, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var results = [];
    var sentCount = 0;
    if (!CoreConfig.isDeploymentIntelligenceEnabled(cfg)) {
      return { sentCount: 0, results: results };
    }

    var appId = String(cfg.appId || '').trim();
    var targetId = String(options.intelligence_run_id || '').trim();
    if (options.productionSend && !options.explicitTestSend && !targetId) {
      var expectedRow = _resolveExpectedIntelligenceRun_(cfg, options);
      if (!expectedRow) {
        results.push({ skipped: true, reason: 'expected_artifact_missing' });
        return { sentCount: 0, results: results };
      }
      targetId = String(expectedRow.intelligence_run_id || '').trim();
    }

    var notificationRow = options.notificationRow || null;
    if (options.productionSend && !options.explicitTestSend && !notificationRow) {
      var configRows = readNotificationConfig_(cfg);
      var notifyKey = (cfg.deploymentIntelligence &&
          cfg.deploymentIntelligence.emailNotificationKey) ||
        DEPLOYMENT_INTELLIGENCE_NOTIFICATION_KEY;
      for (var ni = 0; ni < configRows.length; ni++) {
        if (String(configRows[ni].notificationKey || '').trim() === notifyKey) {
          notificationRow = configRows[ni];
          break;
        }
      }
    }

    var rows = CoreDeploymentSignalPersistence._readIntelligenceRows_(
      cfg, options.store);
    rows.forEach(function (row) {
      if (String(row.app_id || '').trim() !== appId) return;
      if (targetId && String(row.intelligence_run_id || '').trim() !== targetId) return;
      if (String(row.intelligence_status) !== CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY) {
        return;
      }
      if (!options.explicitTestSend &&
          !_deploymentIntelligenceAutoSendEligible_(cfg, row, notificationRow, options)) {
        results.push({
          intelligence_run_id: row.intelligence_run_id,
          skipped: true,
          reason: 'production_send_not_eligible'
        });
        return;
      }

      var artifact = CoreDeploymentSignalPersistence.parseArtifactFromRunRow(row);
      if (!artifact) return;

      var sendOpts = {
        runRow: row,
        dryRun: false,
        testMode: !!options.explicitTestSend,
        explicitTestSend: !!options.explicitTestSend,
        productionSend: !!options.productionSend && !options.explicitTestSend,
        notificationRow: notificationRow
      };
      var outcome = sendDeploymentIntelligenceEmail(cfg, artifact, sendOpts);
      results.push({
        intelligence_run_id: row.intelligence_run_id,
        sent: outcome.sent,
        email_status: outcome.email_status
      });
      if (outcome.sent) {
        sentCount++;
        var sentAt = new Date().toISOString();
        CoreDeploymentSignalPersistence.updateIntelligenceRunRow(
          cfg, row.intelligence_run_id, {
            email_status: CoreDeploymentSignalStore.EMAIL_STATUS_SENT,
            email_sent_at: sentAt,
            updated_at: sentAt,
            email_last_error: ''
          }, options.store);
      } else if (options.productionSend && !options.explicitTestSend &&
          outcome.email_status === CoreDeploymentSignalStore.EMAIL_STATUS_FAILED) {
        var attempts = (parseInt(row.email_attempt_count, 10) || 0) + 1;
        CoreDeploymentSignalPersistence.updateIntelligenceRunRow(
          cfg, row.intelligence_run_id, {
            email_status: CoreDeploymentSignalStore.EMAIL_STATUS_FAILED,
            email_last_error: _sanitizeDiEmailError_(outcome.error),
            email_attempt_count: attempts,
            updated_at: new Date().toISOString()
          }, options.store);
      }
    });
    return { sentCount: sentCount, results: results };
  }

  function sendDeploymentIntelligenceEmail(appConfig, artifact, options) {
    options = options || {};
    var cfg = CoreConfig.withDefaults(appConfig || {});
    var runRow = options.runRow || {};
    var dist = artifact && artifact.distributionState ? artifact.distributionState : {};
    if (String(runRow.email_status || dist.email_status) ===
        CoreDeploymentSignalStore.EMAIL_STATUS_SENT) {
      return {
        sent: false,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_SENT,
        html: buildDeploymentIntelligenceEmailHtml(artifact, cfg)
      };
    }
    if (!isDeploymentIntelligenceEmailEligible(
      Object.assign({}, runRow, { intelligence_status: dist.intelligence_status ||
        CoreDeploymentSignalStore.INTELLIGENCE_STATUS_READY }), cfg)) {
      return {
        sent: false,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_NOT_REQUIRED,
        html: ''
      };
    }
    var html = buildDeploymentIntelligenceEmailHtml(artifact, cfg);
    var key = (cfg.deploymentIntelligence && cfg.deploymentIntelligence.emailNotificationKey) ||
      DEPLOYMENT_INTELLIGENCE_NOTIFICATION_KEY;
    Logger.log('CoreNotify.sendDeploymentIntelligenceEmail: key=' + key +
      ' dryRun=' + !!(options.dryRun && !options.explicitTestSend) +
      ' explicitTestSend=' + !!options.explicitTestSend);

    if ((options.dryRun || options.testMode) && !options.explicitTestSend) {
      return {
        sent: false,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        html: html
      };
    }
    if (options.noSend) {
      return {
        sent: false,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        html: html
      };
    }

    var notificationRow = options.notificationRow || null;
    if (!notificationRow && options.productionSend) {
      var configRows = readNotificationConfig_(cfg);
      for (var i = 0; i < configRows.length; i++) {
        if (String(configRows[i].notificationKey || '').trim() === key) {
          notificationRow = configRows[i];
          break;
        }
      }
    }
    if (options.productionSend && (!notificationRow || !_isEnabled_(notificationRow.enabled))) {
      return {
        sent: false,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        html: html
      };
    }

    var toList = [];
    if (options.explicitTestSend) {
      toList = [_deploymentIntelligenceTestRecipient_(cfg)];
    } else if (notificationRow) {
      toList = _resolveRecipients_(notificationRow, null, {}, cfg, 'to');
    }
    if (!toList.length) {
      return {
        sent: false,
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_PENDING,
        html: html
      };
    }

    var fromAlias = notificationRow ?
      String(notificationRow.fromAlias || '').trim() :
      String((cfg.notify.allowedFromAliases || [])[0] || '').trim();
    var subject = _deploymentIntelligenceSubject_(cfg, notificationRow);
    var cc = notificationRow ? String(notificationRow.cc || '').trim() : '';
    var sentOk = _gmailSend_(
      toList.join(','), subject, html, fromAlias, cc, cfg.notify.allowedFromAliases, '');
    return {
      sent: sentOk,
      email_status: sentOk ? CoreDeploymentSignalStore.EMAIL_STATUS_SENT :
        CoreDeploymentSignalStore.EMAIL_STATUS_FAILED,
      html: html,
      error: sentOk ? '' : 'gmail_send_failed'
    };
  }

  function applyDeploymentSignalPostCompleteHandoff(appConfig, runRow, currentSignals, options) {
    options = options || {};
    if (!isDeploymentSignalNotificationEligible(runRow)) {
      return {
        email_status: CoreDeploymentSignalStore.EMAIL_STATUS_NOT_REQUIRED,
        payload: null,
        sent: false
      };
    }
    var payload = buildDeploymentSignalNotificationPayload(
      runRow, currentSignals, appConfig);
    if (options.dryRun || options.testMode) {
      Logger.log('CoreNotify.applyDeploymentSignalPostCompleteHandoff: ' +
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

  return {
    readNotificationConfig_:       readNotificationConfig_,
    validateNotificationConfig:    validateNotificationConfig,
    runNotifications:              runNotifications,
    sendTestNotification:          sendTestNotification,
    initNotificationConfigSheet:   initNotificationConfigSheet,
    getNotificationKeysForMenu:    getNotificationKeysForMenu,
    upsertNotificationRule:        upsertNotificationRule,
    debugDdDigestDedupeForUI:      debugDdDigestDedupeForUI,
    isDeploymentSignalNotificationEligible: isDeploymentSignalNotificationEligible,
    buildDeploymentSignalNotificationPayload: buildDeploymentSignalNotificationPayload,
    DEPLOYMENT_INTELLIGENCE_NOTIFICATION_KEY: DEPLOYMENT_INTELLIGENCE_NOTIFICATION_KEY,
    isDeploymentIntelligenceEmailEligible: isDeploymentIntelligenceEmailEligible,
    buildDeploymentIntelligenceEmailHtml: buildDeploymentIntelligenceEmailHtml,
    sendDeploymentIntelligenceEmail: sendDeploymentIntelligenceEmail,
    processDeploymentIntelligenceEmailQueue: processDeploymentIntelligenceEmailQueue,
    runScheduledNotificationDispatch: runScheduledNotificationDispatch,
    DEPLOYMENT_INTELLIGENCE_EMAIL_MAX_ATTEMPTS:
      DEPLOYMENT_INTELLIGENCE_EMAIL_MAX_ATTEMPTS_,
    applyDeploymentSignalPostCompleteHandoff: applyDeploymentSignalPostCompleteHandoff,
    _resolveRecipients_:           _resolveRecipients_,
    _renderTemplate_:              _renderTemplate_,
    _gmailSend_:                   _gmailSend_,
    _gmailSendWithIds_:            _gmailSendWithIds_
  };
})();
