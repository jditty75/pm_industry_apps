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
    if (isWellnessDeploymentExcludedFromSourceList_(r['Deployment_Name__c'])) return;

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
 * Plain text for HtmlService email templates (AgendaEmail.html uses <?= ?>).
 * @param {*} value
 * @return {string}
 */
function emailTemplateText_(value) {
  return normalizeSourceText_(value);
}

/**
 * CSS class suffix for agenda health badge (AgendaEmail.html).
 * @param {string} health
 * @return {string}
 */
function healthBadgeClass_(health) {
  var resolvedLabel = getResolvedChipLabel_();
  if (health === resolvedLabel) {
    return 'green';
  }

  var h = String(health || '').toUpperCase();
  if (h === 'UNFAVORABLE' || h === 'RED') {
    return 'red';
  }
  if (h === 'FAVORABLE' || h === 'GREEN') {
    return 'green';
  }
  if (h === 'NEUTRAL' || h === 'YELLOW') {
    return 'yellow';
  }
  return 'neutral';
}

/**
 * Account and partner display for email headings (health kept separate).
 * @param {{account?:string,partner?:string}} item
 * @return {{accountName:string,partnerName:string,titleText:string}}
 */
function deploymentEmailTitleParts_(item) {
  var partnerRaw = String(item.partner || '').trim();
  var partnerName = emailTemplateText_(partnerRaw);
  var accountCombined = emailTemplateText_(item.account || '');
  var accountName = accountCombined;

  if (partnerName && accountCombined) {
    var sep = ' \u00b7 ' + partnerName;
    if (accountCombined.slice(-sep.length) === sep) {
      accountName = emailTemplateText_(accountCombined.slice(0, accountCombined.length - sep.length));
    } else if (accountCombined === partnerName) {
      accountName = '';
    }
  }

  var titleText = accountCombined;
  if (partnerName) {
    titleText = accountName
      ? accountName + ' \u00b7 ' + partnerName
      : partnerName;
  } else {
    titleText = accountName;
  }

  return {
    accountName: accountName,
    partnerName: partnerName,
    titleText: titleText
  };
}

/**
 * Build agenda groups for the email template (escaped once by <?= ?> at render).
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
    var titleParts = deploymentEmailTitleParts_(item);
    buckets[key].push({
      account: titleParts.titleText || emailTemplateText_(item.account || ''),
      accountName: titleParts.accountName,
      partnerName: titleParts.partnerName,
      titleText: titleParts.titleText,
      lead: emailTemplateText_(item.lead || ''),
      healthStatus: emailTemplateText_(health),
      healthClass: healthBadgeClass_(health),
      healthChipStyle: healthChipStyle_(health),
      currentState: emailTemplateText_(item.currentState || ''),
      desiredOutcome: emailTemplateText_(item.desiredOutcome || ''),
      futureState: emailTemplateText_(item.futureState || '')
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
  t.meetingDate = emailTemplateText_(getMeetingDateFormatted_());
  t.intro = emailTemplateText_(getSetting_('Agenda Intro') || '');
  t.kpi = kpis;
  t.kpiLabels = {
    redDep: emailTemplateText_(kpiLabels.redDep),
    yellowDep: emailTemplateText_(kpiLabels.yellowDep),
    unfavCsat: emailTemplateText_(kpiLabels.unfavCsat),
    neutralCsat: emailTemplateText_(kpiLabels.neutralCsat)
  };
  t.groups = groups;
  t.generatedAt = emailTemplateText_(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss z')
  );

  return t.evaluate().getContent();
}

/**
 * Public entry point for the web app Preview Agenda modal (google.script.run).
 * @return {string}
 */
function getAgendaEmailPreviewHtml() {
  if (typeof buildAgendaEmailHtml_ !== 'function') {
    throw new Error('Agenda email preview is unavailable (server helper missing).');
  }
  try {
    var html = buildAgendaEmailHtml_();
    if (typeof html !== 'string' || !html.trim()) {
      throw new Error('Agenda preview HTML was empty.');
    }
    return html;
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    throw new Error('Unable to build agenda email preview: ' + msg);
  }
}

/**
 * Whether deployment health qualifies for the presentation red watchlist.
 * @param {string} health
 * @return {boolean}
 */
function isPresentAgendaRed_(health) {
  return String(health || '').trim().toLowerCase() === 'red';
}

/**
 * Whether CSAT health qualifies for the unfavorable watchlist.
 * @param {string} health
 * @return {boolean}
 */
function isPresentAgendaUnfavorable_(health) {
  var h = String(health || '').trim().toLowerCase();
  return h === 'unfavorable' || h.indexOf('unfavorable') !== -1;
}

/**
 * Human-readable source label for watchlist cards.
 * @param {string} source
 * @return {string}
 */
function presentWatchlistSourceLabel_(source) {
  var s = String(source || '').toUpperCase();
  if (s === 'CSAT') {
    return 'CSAT';
  }
  if (s === 'QUALTRIX') {
    return 'Qualtrics';
  }
  return emailTemplateText_(source);
}

/**
 * CSS modifier class for presentation watchlist badges.
 * @param {string} health
 * @return {string}
 */
function presentBadgeModifier_(health) {
  if (isPresentAgendaRed_(health)) {
    return 'red';
  }
  if (isPresentAgendaUnfavorable_(health)) {
    return 'unfavorable';
  }
  var cls = healthBadgeClass_(health);
  if (cls === 'yellow') {
    return 'yellow';
  }
  if (cls === 'green') {
    return 'green';
  }
  return 'neutral';
}

/**
 * Normalize account name for watchlist deduplication.
 * @param {string} name
 * @return {string}
 */
function presentWatchlistAccountKey_(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * Build red deployment and unfavorable CSAT watchlists from live source feeds
 * (Deployments_SOQL, CSAT_SOQL) — not agenda selection or Qualtrics.
 * @return {{redDeployments:Array<Object>,unfavorableCsat:Array<Object>}}
 */
function buildPresentAgendaWatchlistFromSources_() {
  var depRows = getSheetData_('Deployments_SOQL');
  var csatRows = getSheetData_('CSAT_SOQL');
  var maps = getAgendaOverlayMaps_();
  var redDeployments = [];
  var unfavorableByAccount = {};

  depRows.forEach(function (r) {
    if (isWellnessDeploymentExcludedFromSourceList_(r['Deployment_Name__c'])) {
      return;
    }

    var id = String(r['Id'] || '');
    var onAgenda = maps.dep[id];
    if (onAgenda && onAgenda.resolved) {
      return;
    }

    var health = String(r['Overall_Health__c'] || '');
    if (onAgenda) {
      health = String(onAgenda.healthStatus || health);
    }
    if (!isPresentAgendaRed_(health)) {
      return;
    }

    var account = String(r['Customer_name__c'] || '').trim();
    var partner = String(r['Deployment_Partner_Name__c'] || '').trim();
    var em = String(r['Workday_Engagement_Manager__r'] || '').trim();
    var lead = em;
    if (onAgenda && String(onAgenda.lead || '').trim()) {
      lead = String(onAgenda.lead || '').trim();
    }

    redDeployments.push({
      sortKey: presentWatchlistAccountKey_(account),
      accountName: emailTemplateText_(account),
      partnerName: emailTemplateText_(partner),
      lead: emailTemplateText_(lead),
      badgeText: 'Red',
      badgeMod: 'red'
    });
  });

  redDeployments.sort(function (a, b) {
    if (a.sortKey < b.sortKey) return -1;
    if (a.sortKey > b.sortKey) return 1;
    return 0;
  });

  csatRows.forEach(function (r) {
    var id = String(r['Id'] || '');
    var onAgenda = maps.csat[id];
    if (onAgenda && onAgenda.resolved) {
      return;
    }

    var health = String(r['Overall_Health_Status__c'] || '');
    if (onAgenda) {
      health = String(onAgenda.healthStatus || health);
    }
    if (!isPresentAgendaUnfavorable_(health)) {
      return;
    }

    var account = String(r['Account__r.Name'] || '').trim();
    var csmName = '';
    if (r['Plan_Owner__r.Name']) {
      csmName = String(r['Plan_Owner__r.Name']).trim();
    } else {
      var rawCsm =
        r['CSM__c'] ||
        r['CSM'] ||
        r['Account__r.Customer_Success_Manager__r'] ||
        '';
      csmName = parseCsmName_(rawCsm);
    }
    var lead = csmName;
    if (onAgenda && String(onAgenda.lead || '').trim()) {
      lead = String(onAgenda.lead || '').trim();
    }

    var key = presentWatchlistAccountKey_(account);
    if (!key) {
      key = 'csat:' + id;
    }
    unfavorableByAccount[key] = {
      sortKey: presentWatchlistAccountKey_(account) || account,
      accountName: emailTemplateText_(account),
      lead: emailTemplateText_(lead),
      sourceLabel: emailTemplateText_('CSAT'),
      badgeText: 'Unfavorable',
      badgeMod: 'unfavorable'
    };
  });

  var unfavorableCsat = Object.keys(unfavorableByAccount).map(function (k) {
    var row = unfavorableByAccount[k];
    return {
      sortKey: row.sortKey,
      accountName: row.accountName,
      lead: row.lead,
      sourceLabel: row.sourceLabel,
      badgeText: row.badgeText,
      badgeMod: row.badgeMod
    };
  });

  unfavorableCsat.sort(function (a, b) {
    var ak = String(a.sortKey || '');
    var bk = String(b.sortKey || '');
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    return 0;
  });

  return {
    redDeployments: redDeployments,
    unfavorableCsat: unfavorableCsat
  };
}

/**
 * Summary counts for the presentation view header strip.
 * @param {Array<Object>} items
 * @param {{redDeployments:Array<Object>,unfavorableCsat:Array<Object>}} watchlist
 * @return {{totalItems:number,deploymentReviews:number,redDeployments:number,unfavorableCsat:number}}
 */
function buildPresentAgendaSummary_(items, watchlist) {
  var deploymentReviews = 0;
  (items || []).forEach(function (item) {
    if (String(item.source || '').toUpperCase() === 'DEPLOYMENT') {
      deploymentReviews++;
    }
  });

  return {
    totalItems: (items || []).length,
    deploymentReviews: deploymentReviews,
    redDeployments: watchlist.redDeployments.length,
    unfavorableCsat: watchlist.unfavorableCsat.length
  };
}

/**
 * Build full-screen presentation HTML for Zoom / screen-share (google.script.run).
 * @return {string}
 */
function buildPresentAgendaHtmlForUI() {
  try {
    var items = applyLiveOverlayToAgendaItems_(getAgendaItemsOrdered_());
    var watchlist = buildPresentAgendaWatchlistFromSources_();
    var summary = buildPresentAgendaSummary_(items, watchlist);
    var groups = buildAgendaEmailGroups_(items);
    var meetingDate = getMeetingDateFormatted_();
    var updatedAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'h:mm a z'
    );

    var t = HtmlService.createTemplateFromFile('PresentAgenda');
    t.meetingDate = emailTemplateText_(meetingDate);
    t.subtitle = emailTemplateText_(meetingDate + ' \u00b7 Last updated ' + updatedAt);
    t.watchlist = watchlist;
    t.summary = summary;
    t.groups = groups;
    t.hasGroups = groups && groups.length > 0;

    var html = t.evaluate().getContent();
    if (typeof html !== 'string' || !html.trim()) {
      throw new Error('Presentation HTML was empty.');
    }
    return html;
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    Logger.log('buildPresentAgendaHtmlForUI: ' + msg);
    throw new Error('Unable to build presentation agenda: ' + msg);
  }
}

/**
 * Extract inner HTML from a full document string (for nesting agenda in reminder).
 * @param {string} html
 * @return {string}
 */
function extractBodyInnerHtml_(html) {
  var s = String(html || '');
  var match = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return s.trim();
}

/**
 * Build Gmail-safe reminder email HTML: short intro + full agenda body.
 * @return {string}
 */
function buildReminderEmailHtml_() {
  var appUrl = '';
  try {
    appUrl = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    Logger.log('buildReminderEmailHtml_: ' + e.message);
  }

  var agendaInner = extractBodyInnerHtml_(buildAgendaEmailHtml_());
  var introSetting = getSetting_('Reminder Intro') || '';
  if (!String(introSetting).trim()) {
    introSetting = 'Please review the agenda below before the meeting.';
  }

  var t = HtmlService.createTemplateFromFile('ReminderWithAgenda');
  t.intro = emailTemplateText_(introSetting);
  t.meetingDate = emailTemplateText_(getMeetingDateFormatted_());
  t.deadline = emailTemplateText_(getDeadlineFormatted_());
  t.agendaHtml = agendaInner;
  t.appUrl = emailTemplateText_(appUrl);
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
  t.intro = emailTemplateText_(getSetting_('Closeout Intro') || '');
  t.meetingDate = emailTemplateText_(getMeetingDateFormatted_());
  t.status = emailTemplateText_(getSetting_('Meeting Status') || 'OPEN');
  t.appUrl = emailTemplateText_(appUrl);
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
 * Basic email validation for send lists.
 * @param {string} email
 * @return {boolean}
 */
function isValidEmailForSend_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * Deduplicate and validate active recipients for broadcast send.
 * @return {{to:Array<{name:string,email:string,role:string,display:string}>,warnings:string[]}}
 */
function normalizeRecipientsForSend_() {
  var raw = getRecipients_();
  var warnings = [];
  var seen = {};
  var to = [];
  var invalidSkipped = 0;
  var dupSkipped = 0;

  raw.forEach(function (r) {
    var email = String(r.email || '').trim();
    if (!email) return;
    if (!isValidEmailForSend_(email)) {
      invalidSkipped++;
      warnings.push('Skipped invalid email: ' + email);
      return;
    }
    var key = email.toLowerCase();
    if (seen[key]) {
      dupSkipped++;
      warnings.push('Removed duplicate: ' + email);
      return;
    }
    seen[key] = true;
    var name = String(r.name || '').trim();
    var display = name ? name + ' <' + email + '>' : email;
    to.push({
      name: name,
      email: email,
      role: String(r.role || '').trim(),
      display: display
    });
  });

  if (dupSkipped) {
    warnings.unshift(dupSkipped + ' duplicate recipient(s) removed.');
  }
  if (invalidSkipped) {
    warnings.unshift(invalidSkipped + ' invalid email(s) skipped.');
  }
  if (!raw.length) {
    warnings.push('No active recipients found on the Recipients sheet.');
  }

  return { to: to, warnings: warnings };
}

/**
 * Rough plain-text fallback from HTML for Gmail multipart.
 * @param {string} html
 * @return {string}
 */
function plainBodyFromHtml_(html) {
  var text = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return 'Please view this message in HTML format to see the Healthcare Wellness Leadership Agenda.';
  }
  if (text.length > 12000) {
    text = text.substring(0, 12000) + '…';
  }
  return text;
}

/**
 * Split recipient editor text into tokens (supports Name <email> per line).
 * @param {string} toText
 * @return {string[]}
 */
function splitRecipientTokensFromUiText_(toText) {
  var tokens = [];
  String(toText || '')
    .split(/\r?\n/)
    .forEach(function (line) {
      line = String(line || '').trim();
      if (!line) return;
      if (line.indexOf('<') >= 0 && line.indexOf('>') > line.indexOf('<')) {
        tokens.push(line);
        return;
      }
      line.split(',').forEach(function (part) {
        part = String(part || '').trim();
        if (part) tokens.push(part);
      });
    });
  return tokens;
}

/**
 * Parse one recipient token from the review modal.
 * @param {string} token
 * @return {{name:string,email:string,display:string}|{error:string}}
 */
function parseRecipientTokenFromUi_(token) {
  var raw = String(token || '').trim();
  if (!raw) {
    return { error: '(empty entry)' };
  }
  var angle = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (angle) {
    var name = String(angle[1] || '').trim();
    var email = String(angle[2] || '').trim();
    if (!isValidEmailForSend_(email)) {
      return { error: raw };
    }
    var display = name ? name + ' <' + email + '>' : email;
    return { name: name, email: email, display: display };
  }
  if (isValidEmailForSend_(raw)) {
    return { name: '', email: raw, display: raw };
  }
  return { error: raw };
}

/**
 * Parse, validate, and dedupe recipients from the web app composer.
 * @param {string} toText
 * @return {{recipients:Array<{name:string,email:string,display:string}>,errors:string[],warnings:string[]}}
 */
function parseRecipientsFromUiText_(toText) {
  var tokens = splitRecipientTokensFromUiText_(toText);
  var errors = [];
  var warnings = [];
  var seen = {};
  var recipients = [];

  if (!tokens.length) {
    errors.push('Enter at least one recipient.');
    return { recipients: recipients, errors: errors, warnings: warnings };
  }

  tokens.forEach(function (token) {
    var parsed = parseRecipientTokenFromUi_(token);
    if (parsed.error) {
      errors.push('Invalid recipient: ' + parsed.error);
      return;
    }
    var key = parsed.email.toLowerCase();
    if (seen[key]) {
      warnings.push('Removed duplicate: ' + parsed.email);
      return;
    }
    seen[key] = true;
    recipients.push({
      name: parsed.name,
      email: parsed.email,
      display: parsed.display
    });
  });

  if (!recipients.length && !errors.length) {
    errors.push('No valid recipients after parsing.');
  }

  return { recipients: recipients, errors: errors, warnings: warnings };
}

/**
 * Validate UI send payload (subject, body, recipients).
 * @param {Object} payload
 * @return {{recipients:Array<{name:string,email:string,display:string}>,subject:string,htmlBody:string,plainBody:string,warnings:string[]}}
 */
function validateEmailSendPayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Email send payload is missing.');
  }
  var parsed = parseRecipientsFromUiText_(payload.toText);
  if (parsed.errors.length) {
    throw new Error(parsed.errors.join('\n'));
  }
  var subject = String(payload.subject == null ? '' : payload.subject).trim();
  if (!subject) {
    throw new Error('Email subject is required.');
  }
  var htmlBody = String(payload.htmlBody == null ? '' : payload.htmlBody).trim();
  if (!htmlBody) {
    throw new Error('Email HTML body is required.');
  }
  var plainBody = plainBodyFromHtml_(htmlBody);
  return {
    recipients: parsed.recipients,
    subject: subject,
    htmlBody: htmlBody,
    plainBody: plainBody,
    warnings: parsed.warnings
  };
}

/**
 * Meeting / reminder metadata for email review UI.
 * @return {Object}
 */
function getEmailPreviewMetadata_() {
  return {
    meetingDate: getMeetingDateFormatted_(),
    meetingDateRaw: getSetting_('Meeting Date') || '',
    reminderDate: getSetting_('Reminder Date') || '',
    deliveryDate: getSetting_('Delivery Date') || '',
    deadline: getDeadlineFormatted_()
  };
}

/**
 * Build agenda email subject and bodies (shared by preview and send).
 * @return {{subject:string,htmlBody:string,plainBody:string}}
 */
function buildAgendaEmailContent_() {
  var subjectSetting = getSetting_('Agenda Email Subject');
  var subject = applyTokens_(subjectSetting || 'HC Wellness Leadership Agenda');
  var htmlBody = buildAgendaEmailHtml_();
  var plainBody = plainBodyFromHtml_(htmlBody);
  if (!subject || !String(subject).trim()) {
    throw new Error('Agenda email subject is empty.');
  }
  if (!htmlBody || !String(htmlBody).trim()) {
    throw new Error('Agenda email HTML body is empty.');
  }
  return { subject: subject, htmlBody: htmlBody, plainBody: plainBody };
}

/**
 * Build reminder email subject and bodies (shared by preview and send).
 * @return {{subject:string,htmlBody:string,plainBody:string}}
 */
function buildReminderEmailContent_() {
  var subjectSetting = getSetting_('Reminder Email Subject');
  var subject = applyTokens_(
    subjectSetting || 'Reminder: Submit HC Wellness Agenda Items'
  );
  var htmlBody = buildReminderEmailHtml_();
  var plainBody = plainBodyFromHtml_(htmlBody);
  if (!subject || !String(subject).trim()) {
    throw new Error('Reminder email subject is empty.');
  }
  if (!htmlBody || !String(htmlBody).trim()) {
    throw new Error('Reminder email HTML body is empty.');
  }
  return { subject: subject, htmlBody: htmlBody, plainBody: plainBody };
}

/**
 * Send wellness broadcast email with all recipients in the To field.
 * @param {Array<{email:string}>} recipients
 * @param {string} subject
 * @param {string} plainBody
 * @param {string} htmlBody
 */
function sendWellnessBroadcastEmail_(recipients, subject, plainBody, htmlBody) {
  if (!recipients || !recipients.length) {
    throw new Error('No recipients to send to.');
  }
  var toCsv = recipients.map(function (r) { return r.email; }).join(',');
  try {
    GmailApp.sendEmail(toCsv, subject, plainBody, {
      htmlBody: htmlBody,
      name: 'HC Wellness Solution'
    });
  } catch (e) {
    Logger.log('sendWellnessBroadcastEmail_: ' + e.message);
    throw e;
  }
}

/**
 * Build normalized agenda email preview for the web app review modal.
 * @return {Object}
 */
function buildAgendaEmailPreviewForUI() {
  var norm = normalizeRecipientsForSend_();
  if (!norm.to.length) {
    throw new Error('No active recipients found. Add recipients to the Recipients sheet.');
  }
  var content = buildAgendaEmailContent_();
  var meta = getEmailPreviewMetadata_();
  return {
    type: 'agenda',
    to: norm.to,
    recipientCount: norm.to.length,
    subject: content.subject,
    htmlBody: content.htmlBody,
    plainBody: content.plainBody,
    metadata: {
      meetingDate: meta.meetingDate,
      meetingDateRaw: meta.meetingDateRaw,
      reminderDate: meta.reminderDate,
      deliveryDate: meta.deliveryDate,
      submissionDeadline: meta.deadline
    },
    meetingDate: meta.meetingDate,
    meetingDateRaw: meta.meetingDateRaw,
    reminderDate: meta.reminderDate,
    deliveryDate: meta.deliveryDate,
    deadline: meta.deadline,
    warnings: norm.warnings
  };
}

/**
 * Build normalized reminder email preview for the web app review modal.
 * @return {Object}
 */
function buildReminderEmailPreviewForUI() {
  var norm = normalizeRecipientsForSend_();
  if (!norm.to.length) {
    throw new Error('No active recipients found. Add recipients to the Recipients sheet.');
  }
  var content = buildReminderEmailContent_();
  var meta = getEmailPreviewMetadata_();
  return {
    type: 'reminder',
    to: norm.to,
    recipientCount: norm.to.length,
    subject: content.subject,
    htmlBody: content.htmlBody,
    plainBody: content.plainBody,
    metadata: {
      meetingDate: meta.meetingDate,
      meetingDateRaw: meta.meetingDateRaw,
      reminderDate: meta.reminderDate,
      deliveryDate: meta.deliveryDate,
      submissionDeadline: meta.deadline
    },
    meetingDate: meta.meetingDate,
    meetingDateRaw: meta.meetingDateRaw,
    reminderDate: meta.reminderDate,
    deliveryDate: meta.deliveryDate,
    deadline: meta.deadline,
    warnings: norm.warnings
  };
}

/**
 * Send agenda or reminder email using values edited in the web app review modal.
 * @param {Object} payload
 * @param {'AGENDA'|'REMINDER'} logType
 * @param {function()} afterSendHook
 * @return {{ok:boolean,sent:boolean,sentTo:string[],recipientCount:number,subject:string,warnings:string[]}}
 */
function sendWellnessEmailFromUIPayload_(payload, logType, afterSendHook) {
  var validated = validateEmailSendPayload_(payload);

  sendWellnessBroadcastEmail_(
    validated.recipients,
    validated.subject,
    validated.plainBody,
    validated.htmlBody
  );

  if (typeof afterSendHook === 'function') {
    afterSendHook();
  }

  logSend_(logType, validated.recipients.length);
  var sentTo = validated.recipients.map(function (r) {
    return r.email;
  });
  return {
    ok: true,
    sent: true,
    sentTo: sentTo,
    recipientCount: validated.recipients.length,
    subject: validated.subject,
    warnings: validated.warnings
  };
}

/**
 * Send agenda email after web app review (uses edited client payload).
 * @param {Object} payload
 * @return {{ok:boolean,sent:boolean,sentTo:string[],recipientCount:number,subject:string,warnings:string[]}}
 */
function sendAgendaEmailForUI(payload) {
  return sendWellnessEmailFromUIPayload_(payload, 'AGENDA', function () {
    setSetting_(
      'Agenda Sent At',
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    );
    setSetting_('Meeting Status', 'AGENDA_SENT');
  });
}

/**
 * Send reminder email after web app review (uses edited client payload).
 * @param {Object} payload
 * @return {{ok:boolean,sent:boolean,sentTo:string[],recipientCount:number,subject:string,warnings:string[]}}
 */
function sendReminderEmailForUI(payload) {
  return sendWellnessEmailFromUIPayload_(payload, 'REMINDER', function () {
    setSetting_(
      'Reminder Sent At',
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    );
  });
}

/**
 * Debug summary for agenda email preview (Apps Script editor / logs).
 * @return {Object}
 */
function debugAgendaEmailPreviewForUI() {
  var preview = buildAgendaEmailPreviewForUI();
  var out = {
    recipientCount: preview.recipientCount,
    toCount: preview.to.length,
    bccCount: 0,
    subject: preview.subject,
    hasHtmlBody: !!(preview.htmlBody && String(preview.htmlBody).trim()),
    hasPlainBody: !!(preview.plainBody && String(preview.plainBody).trim()),
    warnings: preview.warnings || []
  };
  Logger.log('debugAgendaEmailPreviewForUI: ' + JSON.stringify(out));
  return out;
}

/**
 * Debug summary for reminder email preview (Apps Script editor / logs).
 * @return {Object}
 */
function debugReminderEmailPreviewForUI() {
  var preview = buildReminderEmailPreviewForUI();
  var out = {
    recipientCount: preview.recipientCount,
    toCount: preview.to.length,
    bccCount: 0,
    subject: preview.subject,
    hasHtmlBody: !!(preview.htmlBody && String(preview.htmlBody).trim()),
    hasPlainBody: !!(preview.plainBody && String(preview.plainBody).trim()),
    warnings: preview.warnings || []
  };
  Logger.log('debugReminderEmailPreviewForUI: ' + JSON.stringify(out));
  return out;
}

/**
 * Send agenda email via Gmail (all active recipients in To).
 * @return {{sent:boolean,recipientCount:number,sentTo:string[],subject:string}}
 */
function sendAgendaEmail() {
  var norm = normalizeRecipientsForSend_();
  if (!norm.to.length) {
    throw new Error('No active recipients found. Add recipients to the Recipients sheet.');
  }

  var content = buildAgendaEmailContent_();

  sendWellnessBroadcastEmail_(
    norm.to,
    content.subject,
    content.plainBody,
    content.htmlBody
  );

  setSetting_(
    'Agenda Sent At',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );
  setSetting_('Meeting Status', 'AGENDA_SENT');

  logSend_('AGENDA', norm.to.length);
  var sentTo = norm.to.map(function (r) { return r.email; });
  return {
    sent: true,
    recipientCount: norm.to.length,
    sentTo: sentTo,
    subject: content.subject
  };
}

/**
 * Send agenda submission reminder email via Gmail (all active recipients in To).
 * @return {{sent:boolean,recipientCount:number,sentTo:string[],subject:string}}
 */
function sendAgendaReminderEmail() {
  var norm = normalizeRecipientsForSend_();
  if (!norm.to.length) {
    throw new Error('No active recipients found. Add recipients to the Recipients sheet.');
  }

  var content = buildReminderEmailContent_();

  sendWellnessBroadcastEmail_(
    norm.to,
    content.subject,
    content.plainBody,
    content.htmlBody
  );

  setSetting_(
    'Reminder Sent At',
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );

  logSend_('REMINDER', norm.to.length);
  var sentTo = norm.to.map(function (r) { return r.email; });
  return {
    sent: true,
    recipientCount: norm.to.length,
    sentTo: sentTo,
    subject: content.subject
  };
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
