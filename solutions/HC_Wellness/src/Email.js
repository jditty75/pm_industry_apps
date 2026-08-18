/***********************************
 * Gmail-native agenda distribution
 * Email.gs
 ***********************************/

/** @type {string[]} */
var EMAIL_GROUP_ORDER_ = ['DEPLOYMENT', 'CSAT', 'QUALTRIX', 'BUDGET_EAC', 'MANUAL'];

/** @type {Object<string, string>} */
var EMAIL_GROUP_LABELS_ = {
  DEPLOYMENT: 'Deployment Reviews',
  CSAT: 'Customer Satisfaction Reviews',
  QUALTRIX: 'Qualtrics',
  BUDGET_EAC: 'Budget / EAC',
  MANUAL: 'Additional / Manual Topics'
};

/**
 * Format Meeting Date setting for display.
 * @return {string}
 */
function getMeetingDateFormatted_() {
  var raw = getSetting_('Meeting Date');
  var d;
  if (raw) {
    d = new Date(raw);
    if (isNaN(d.getTime())) d = new Date();
  } else {
    d = new Date();
  }
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEEE, MMMM dd, yyyy');
}

/**
 * Read Submission Deadline setting.
 * @return {string}
 */
function getDeadlineFormatted_() {
  return getSetting_('Submission Deadline') || '';
}

/**
 * Replace {meetingDate} and {deadline} tokens in a string.
 * @param {string} str
 * @return {string}
 */
function applyTokens_(str) {
  if (!str) return '';
  return String(str)
    .replace(/\{meetingDate\}/g, getMeetingDateFormatted_())
    .replace(/\{deadline\}/g, getDeadlineFormatted_());
}

/**
 * Whether a Recipients row Active value qualifies for send.
 * @param {*} val
 * @return {boolean}
 */
function isRecipientActive_(val) {
  var a = String(val == null ? '' : val).trim().toUpperCase();
  return a === '' || a === 'Y' || a === 'YES' || a === 'TRUE';
}

/**
 * Load active recipients from the Recipients sheet.
 * @return {Array<{name:string,email:string,role:string}>}
 */
function getRecipients_() {
  var rows;
  try {
    rows = getSheetData_('Recipients');
  } catch (e) {
    Logger.log('getRecipients_: ' + e.message);
    return [];
  }

  return rows
    .filter(function (r) {
      var email = String(r['Email'] || '').trim();
      return email && isRecipientActive_(r['Active']);
    })
    .map(function (r) {
      return {
        name: String(r['Name'] || '').trim(),
        email: String(r['Email'] || '').trim(),
        role: String(r['Role'] || '').trim()
      };
    });
}

/**
 * KPI label strings from Settings with code defaults.
 * @return {{redDep:string,yellowDep:string,unfavCsat:string,neutralCsat:string}}
 */
function getKpiLabels_() {
  return {
    redDep: getSetting_('KPI Label Red Deployments') || 'Red Deployments',
    yellowDep: getSetting_('KPI Label Yellow Deployments') || 'Yellow Deployments',
    unfavCsat: getSetting_('KPI Label Unfavorable CSAT') || 'Unfavorable CSAT',
    neutralCsat: getSetting_('KPI Label Neutral CSAT') || 'Neutral CSAT'
  };
}

/**
 * Build maps of agenda DEPLOYMENT/CSAT items with live overlay applied.
 * @return {{dep:Object<string,Object>,csat:Object<string,Object>}}
 */
function getAgendaOverlayMaps_() {
  var agendaItems = applyLiveOverlayToAgendaItems_(getAgendaItemsOrdered_());
  var dep = {};
  var csat = {};

  agendaItems.forEach(function (item) {
    var src = String(item.source || '').toUpperCase();
    var id = String(item.id || '');
    if (!id) return;
    if (src === 'DEPLOYMENT') dep[id] = item;
    if (src === 'CSAT') csat[id] = item;
  });

  return { dep: dep, csat: csat };
}

/**
 * Count deployment and CSAT health indicators from live SOQL feeds.
 * Resolved agenda items (no longer in feed) are excluded from counts.
 * @return {{depRed:number,depYellow:number,csatUnfav:number,csatNeutral:number}}
 */
function getAgendaKpis_() {
  var depRows = getSheetData_('Deployments_SOQL');
  var csatRows = getSheetData_('CSAT_SOQL');
  var maps = getAgendaOverlayMaps_();
  var depRed = 0;
  var depYellow = 0;
  var csatUnfav = 0;
  var csatNeutral = 0;

  depRows.forEach(function (r) {
    var id = String(r['Id'] || '');
    var onAgenda = maps.dep[id];
    if (onAgenda && onAgenda.resolved) return;

    var h = String(r['Overall_Health__c'] || '').toLowerCase();
    if (onAgenda) {
      h = String(onAgenda.healthStatus || '').toLowerCase();
    }
    if (h === 'red') depRed++;
    else if (h === 'yellow') depYellow++;
  });

  csatRows.forEach(function (r) {
    var id = String(r['Id'] || '');
    var onAgenda = maps.csat[id];
    if (onAgenda && onAgenda.resolved) return;

    var h = String(r['Overall_Health_Status__c'] || '').toLowerCase();
    if (onAgenda) {
      h = String(onAgenda.healthStatus || '').toLowerCase();
    }
    if (h === 'unfavorable') csatUnfav++;
    else if (h === 'neutral') csatNeutral++;
  });

  return {
    depRed: depRed,
    depYellow: depYellow,
    csatUnfav: csatUnfav,
    csatNeutral: csatNeutral
  };
}

/**
 * Classify an agenda item into one of five email render groups.
 * @param {{source?:string,id?:string}} item
 * @return {string}
 */
function classifyEmailGroup_(item) {
  var id = String(item.id || '');
  var src = String(item.source || '').toUpperCase();
  var known = {
    DEPLOYMENT: true,
    CSAT: true,
    QUALTRIX: true,
    BUDGET_EAC: true,
    MANUAL: true
  };

  if (id.indexOf('MANUAL-') === 0) {
    if (known[src] && src !== 'MANUAL') return src;
    return 'MANUAL';
  }
  if (known[src]) return src;
  return 'MANUAL';
}

/**
 * Build escaped agenda groups for the email template.
 * @param {Array<Object>} items
 * @return {Array<{key:string,label:string,items:Array<Object>}>}
 */
function buildAgendaEmailGroups_(items) {
  /** @type {Object<string, Array<Object>>} */
  var buckets = {};
  EMAIL_GROUP_ORDER_.forEach(function (k) {
    buckets[k] = [];
  });

  (items || []).forEach(function (item) {
    var key = classifyEmailGroup_(item);
    var health = item.healthStatus || '';
    buckets[key].push({
      account: escapeHtml_(item.account || ''),
      lead: escapeHtml_(item.lead || ''),
      healthStatus: escapeHtml_(health),
      healthChipStyle: healthChipStyle_(health),
      currentState: escapeHtml_(item.currentState || ''),
      desiredOutcome: escapeHtml_(item.desiredOutcome || ''),
      futureState: escapeHtml_(item.futureState || '')
    });
  });

  var groups = [];
  EMAIL_GROUP_ORDER_.forEach(function (key) {
    if (buckets[key].length > 0) {
      groups.push({
        key: key,
        label: EMAIL_GROUP_LABELS_[key],
        items: buckets[key]
      });
    }
  });
  return groups;
}

/**
 * Inline style for health status chip in Gmail HTML.
 * @param {string} health
 * @return {string}
 */
function healthChipStyle_(health) {
  var resolvedLabel = getResolvedChipLabel_();
  if (health === resolvedLabel) {
    return 'background-color:#ecfdf3;color:#15803d;border:1px solid #bbf7d0;';
  }

  var h = String(health || '').toUpperCase();
  if (h === 'UNFAVORABLE' || h === 'RED') {
    return 'background-color:#fef2f2;color:#b91c1c;border:1px solid #fecaca;';
  }
  if (h === 'FAVORABLE' || h === 'GREEN') {
    return 'background-color:#ecfdf3;color:#15803d;border:1px solid #bbf7d0;';
  }
  if (h === 'NEUTRAL' || h === 'YELLOW') {
    return 'background-color:#fefce8;color:#92400e;border:1px solid #facc15;';
  }
  return 'background-color:#f3f4f6;color:#374151;border:1px solid #d1d5db;';
}

/**
 * Append a row to the Send Log sheet.
 * @param {'AGENDA'|'REMINDER'|'CLOSEOUT'} type
 * @param {number} count
 */
function logSend_(type, count) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Send Log');
  if (!sheet) {
    Logger.log('logSend_: Send Log sheet not found');
    return;
  }

  var me = Session.getActiveUser().getEmail();
  var meetingDate = getSetting_('Meeting Date');
  if (!meetingDate) {
    meetingDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  sheet.appendRow([new Date(), type, count, me, meetingDate]);
}

/**
 * Build Gmail-safe agenda email HTML from AgendaEmail.html with live overlay.
 * @return {string}
 */
function buildAgendaEmailHtml_() {
  var items = applyLiveOverlayToAgendaItems_(getAgendaItemsOrdered_());
  var kpis = getAgendaKpis_();
  var kpiLabels = getKpiLabels_();
  var groups = buildAgendaEmailGroups_(items);

  var t = HtmlService.createTemplateFromFile('AgendaEmail');
  t.meetingDate = escapeHtml_(getMeetingDateFormatted_());
  t.intro = escapeHtml_(getSetting_('Agenda Intro') || '');
  t.kpi = kpis;
  t.kpiLabels = {
    redDep: escapeHtml_(kpiLabels.redDep),
    yellowDep: escapeHtml_(kpiLabels.yellowDep),
    unfavCsat: escapeHtml_(kpiLabels.unfavCsat),
    neutralCsat: escapeHtml_(kpiLabels.neutralCsat)
  };
  t.groups = groups;
  t.generatedAt = escapeHtml_(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss z')
  );

  return t.evaluate().getContent();
}

/**
 * Build Gmail-safe reminder email HTML from ReminderEmail.html.
 * @return {string}
 */
function buildReminderEmailHtml_() {
  var items = getAgendaItemsOrdered_();
  var appUrl = '';
  try {
    appUrl = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    Logger.log('buildReminderEmailHtml_: ' + e.message);
  }

  var t = HtmlService.createTemplateFromFile('ReminderEmail');
  t.intro = escapeHtml_(getSetting_('Reminder Intro') || '');
  t.meetingDate = escapeHtml_(getMeetingDateFormatted_());
  t.deadline = escapeHtml_(getDeadlineFormatted_());
  t.submittedCount = items.length;
  t.appUrl = escapeHtml_(appUrl);
  t.hasAppUrl = !!appUrl;

  return t.evaluate().getContent();
}

/**
 * Build closeout reminder email HTML from CloseoutEmail.html.
 * @return {string}
 */
function buildCloseoutEmailHtml_() {
  var appUrl = '';
  try {
    appUrl = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    Logger.log('buildCloseoutEmailHtml_: ' + e.message);
  }

  var t = HtmlService.createTemplateFromFile('CloseoutEmail');
  t.intro = escapeHtml_(getSetting_('Closeout Intro') || '');
  t.meetingDate = escapeHtml_(getMeetingDateFormatted_());
  t.status = escapeHtml_(getSetting_('Meeting Status') || 'OPEN');
  t.appUrl = escapeHtml_(appUrl);
  t.hasAppUrl = !!appUrl;

  return t.evaluate().getContent();
}

/**
 * Return count of active recipients.
 * @return {number}
 */
function getRecipientCount() {
  return getRecipients_().length;
}

/**
 * Send agenda email via Gmail (To: sender, BCC: active recipients).
 * @return {{sent:boolean,recipientCount:number}}
 */
function sendAgendaEmail() {
  var recipients = getRecipients_();
  if (!recipients.length) {
    throw new Error('No active recipients found. Add recipients to the Recipients sheet.');
  }

  var bcc = recipients.map(function (r) { return r.email; }).join(',');
  var me = Session.getActiveUser().getEmail();
  var subjectSetting = getSetting_('Agenda Email Subject');
  var subject = applyTokens_(subjectSetting || 'HC Wellness Leadership Agenda');
  var htmlBody = buildAgendaEmailHtml_();
  var plainFallback = 'Please view this message in HTML format to see the Healthcare Wellness Leadership Agenda.';

  try {
    GmailApp.sendEmail(me, subject, plainFallback, {
      htmlBody: htmlBody,
      bcc: bcc,
      name: 'HC Wellness Solution'
    });
  } catch (e) {
    Logger.log('sendAgendaEmail: ' + e.message);
    throw e;
  }

  setSetting_(
    'Agenda Sent At',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );
  setSetting_('Meeting Status', 'AGENDA_SENT');

  logSend_('AGENDA', recipients.length);
  return { sent: true, recipientCount: recipients.length };
}

/**
 * Send agenda submission reminder email via Gmail.
 * @return {{sent:boolean,recipientCount:number}}
 */
function sendAgendaReminderEmail() {
  var recipients = getRecipients_();
  if (!recipients.length) {
    throw new Error('No active recipients found. Add recipients to the Recipients sheet.');
  }

  var bcc = recipients.map(function (r) { return r.email; }).join(',');
  var me = Session.getActiveUser().getEmail();
  var subjectSetting = getSetting_('Reminder Email Subject');
  var subject = applyTokens_(
    subjectSetting || 'Reminder: Submit HC Wellness Agenda Items'
  );
  var htmlBody = buildReminderEmailHtml_();
  var plainFallback = 'Please view this message in HTML format for agenda submission details.';

  try {
    GmailApp.sendEmail(me, subject, plainFallback, {
      htmlBody: htmlBody,
      bcc: bcc,
      name: 'HC Wellness Solution'
    });
  } catch (e) {
    Logger.log('sendAgendaReminderEmail: ' + e.message);
    throw e;
  }

  setSetting_(
    'Reminder Sent At',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );

  logSend_('REMINDER', recipients.length);
  return { sent: true, recipientCount: recipients.length };
}

/**
 * Send stale-meeting closeout reminder to the active user (Jeff).
 * @return {{sent:boolean}}
 */
function sendMeetingCloseoutReminder() {
  var me = Session.getActiveUser().getEmail();
  if (!me) {
    throw new Error('No active user email available for closeout reminder.');
  }

  var subjectSetting = getSetting_('Closeout Email Subject');
  var subject = applyTokens_(
    subjectSetting || 'Action Required: Close HC Wellness Meeting ({meetingDate})'
  );
  var htmlBody = buildCloseoutEmailHtml_();
  var plainFallback = 'Please close the HC Wellness meeting in the agenda app before preparing the next cycle.';

  try {
    GmailApp.sendEmail(me, subject, plainFallback, {
      htmlBody: htmlBody,
      name: 'HC Wellness Solution'
    });
  } catch (e) {
    Logger.log('sendMeetingCloseoutReminder: ' + e.message);
    throw e;
  }

  logSend_('CLOSEOUT', 1);
  return { sent: true };
}
