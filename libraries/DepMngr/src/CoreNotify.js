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

  var SEED_KEYS_ = ['em_reminder_first', 'em_reminder_final', 'dd_digest'];

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
   * @param {Array<Object>} rows
   * @param {string} tz
   * @return {string}
   * @private
   */
  function _buildUpcomingListHtml_(rows, tz) {
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
      byDd[dd].sort(function (a, b) {
        return String(a.accountName || '').localeCompare(String(b.accountName || ''));
      }).forEach(function (row) {
        var dateStr = row.eventDate ?
          Utilities.formatDate(new Date(row.eventDate), tz, 'yyyy-MM-dd') : 'n/a';
        parts.push('<li>' + _escapeHtml_(row.accountName || '') + ' — ' +
          _escapeHtml_(row.deploymentName || '') + ' (' +
          _escapeHtml_(row.surveyType || '') + ', ' + dateStr + ')</li>');
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
   * @param {AppConfig=} cfg
   * @param {string} fromAlias
   * @return {string}
   * @private
   */
  function _resolveFromDisplayName_(cfg, fromAlias) {
    var names = (cfg && cfg.notify && cfg.notify.fromAliasNames) || {};
    return names[String(fromAlias || '').trim()] || '';
  }

  /**
   * @param {string} fromAlias
   * @param {string} fromName
   * @return {string}
   * @private
   */
  function _formatFromHeader_(fromAlias, fromName) {
    var email = String(fromAlias || '').trim();
    var name = String(fromName || '').trim();
    if (!name) return email;
    var safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '"' + safeName + '" <' + email + '>';
  }

  /**
   * @param {string} to
   * @param {string} subject
   * @param {string} htmlBody
   * @param {string} fromAlias
   * @param {string} cc
   * @param {Array<string>} allowedAliases
   * @param {AppConfig=} cfg
   * @return {boolean}
   * @private
   */
  function _gmailSend_(to, subject, htmlBody, fromAlias, cc, allowedAliases, cfg) {
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

    var fromName = _resolveFromDisplayName_(cfg, from);
    var opts = { htmlBody: htmlBody, from: from };
    if (fromName) opts.name = fromName;
    var ccStr = String(cc || '').trim();
    if (ccStr) opts.cc = ccStr;

    var plain = String(htmlBody || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      GmailApp.sendEmail(toStr, subject, plain, opts);
      Logger.log('CoreNotify._gmailSend_: sent to ' + toStr + ' from ' + from);
      return true;
    } catch (e) {
      Logger.log('CoreNotify._gmailSend_: send failed: ' + e);
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
   * @return {string}
   * @private
   */
  function _buildRfc2822Mime_(from, to, cc, bcc, subject, htmlBody) {
    var lines = [
      'From: ' + from,
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
   * @param {AppConfig=} cfg
   * @return {{ok: boolean, messageId: string, threadId: string,
   *           captureMethod: 'advanced'|'heuristic'|'none'}}
   * @private
   */
  function _gmailSendWithIds_(to, subject, htmlBody, fromAlias, cc, allowedAliases, bcc, cfg) {
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

    try {
      if (typeof Gmail === 'undefined' || !Gmail || !Gmail.Users || !Gmail.Users.Messages) {
        throw new ReferenceError('Gmail advanced service is not enabled');
      }

      var fromName = _resolveFromDisplayName_(cfg, from);
      var fromHeader = _formatFromHeader_(from, fromName);
      var rawMime = _buildRfc2822Mime_(fromHeader, toStr, ccStr, bccStr, subject, bodyWithToken);
      var encoded = _base64UrlEncodeMime_(rawMime);
      var response = Gmail.Users.Messages.send({ raw: encoded }, 'me');
      var messageId = response && response.id ? String(response.id) : '';
      var threadId = response && response.threadId ? String(response.threadId) : '';

      if (!messageId) {
        throw new Error('Gmail.Users.Messages.send returned empty id');
      }

      Logger.log('CoreNotify._gmailSendWithIds_: advanced send to ' + toStr +
                 ' from ' + from + ', messageId=' + messageId);
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

    var fallbackFromName = _resolveFromDisplayName_(cfg, from);
    var opts = { htmlBody: bodyWithToken, from: from };
    if (fallbackFromName) opts.name = fallbackFromName;
    if (ccStr) opts.cc = ccStr;
    if (bccStr) opts.bcc = bccStr;
    var plain = String(bodyWithToken).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    try {
      GmailApp.sendEmail(toStr, subject, plain, opts);
    } catch (e) {
      Logger.log('CoreNotify._gmailSendWithIds_: GmailApp fallback send failed: ' + e);
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

    var sent = _gmailSend_(to, subject, body, row.fromAlias, cc, cfg.notify.allowedFromAliases, cfg);
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

    var sent = _gmailSend_(to, subject, body, row.fromAlias, cc, cfg.notify.allowedFromAliases, cfg);
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
      if (['em_reminder', 'dd_digest'].indexOf(type) < 0) errors.push('invalid type');

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

      var allowedTokens = type === 'dd_digest' ? DIGEST_TOKENS_ : EM_TOKENS_;
      _extractTokens_(row.subject).forEach(function (t) {
        if (allowedTokens.indexOf(t) < 0) errors.push('unknown token in subject: {{' + t + '}}');
      });
      _extractTokens_(row.bodyTemplate).forEach(function (t) {
        if (allowedTokens.indexOf(t) < 0) errors.push('unknown token in body: {{' + t + '}}');
      });

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
      }) : [{
        accountName: 'Sample Account',
        deploymentName: 'Sample Deployment',
        deliveryDirector: 'Sample DD',
        surveyType: 'PGL',
        eventDate: today,
        deploymentId: 'TEST'
      }];

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
      .requireValueInList(['em_reminder', 'dd_digest'], true).build();
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

    return [
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

  return {
    readNotificationConfig_:       readNotificationConfig_,
    validateNotificationConfig:    validateNotificationConfig,
    runNotifications:              runNotifications,
    sendTestNotification:          sendTestNotification,
    initNotificationConfigSheet:   initNotificationConfigSheet,
    getNotificationKeysForMenu:    getNotificationKeysForMenu,
    upsertNotificationRule:        upsertNotificationRule,
    _resolveRecipients_:           _resolveRecipients_,
    _renderTemplate_:              _renderTemplate_,
    _gmailSend_:                   _gmailSend_,
    _gmailSendWithIds_:            _gmailSendWithIds_
  };
})();
