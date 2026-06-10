/*************** NOTIFICATIONS ***************/
/**
 * All email notification logic lives here.
 *
 * Provider-agnostic dispatcher (sendNotification_) so the underlying
 * mail mechanism can change without touching the rest of the app.
 * Today: MailApp only. Tomorrow: SendGrid, MS Graph, etc.
 *
 * Failure handling: every send attempt is logged to the Notifications
 * sheet tab. Failures are caught and never propagate to callers.
 */

const NOTIFICATIONS_TAB = 'Notifications';
const NOTIFICATIONS_HEADERS = [
  'Timestamp', 'Type', 'Recipients', 'Subject', 'Status', 'Error'
];

/*************** SCHEMA MIGRATION ***************/
/**
 * Ensures the Notifications tab exists with the canonical headers.
 * Idempotent. Called from doGet via migrateAllSchemas_.
 */
function migrateNotificationsSchema_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(NOTIFICATIONS_TAB);
  if (!sh) {
    sh = ss.insertSheet(NOTIFICATIONS_TAB);
    sh.getRange(1, 1, 1, NOTIFICATIONS_HEADERS.length).setValues([NOTIFICATIONS_HEADERS]);
    sh.setFrozenRows(1);
    return;
  }
  const lastCol = Math.max(1, sh.getLastColumn());
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = NOTIFICATIONS_HEADERS.filter(h => existing.indexOf(h) === -1);
  if (missing.length) {
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
}

function runMigrateNotificationsSchema() {
  migrateNotificationsSchema_();
  Logger.log('Notifications schema migration complete.');
}

/*************** ADMIN RECIPIENTS ***************/
/**
 * Returns the canonical admin email list, parsed from the Config tab.
 * Single source of truth — same parsing as isAdmin_().
 */
function getAdminEmails_() {
  return getConfig_('Admins')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/*************** PUBLIC: TEST EMAIL ***************/
/**
 * Sends a test email to the calling admin only. Useful for verifying
 * deliverability and confirming the From address.
 * Admin-only; surfaces any underlying error to the UI for diagnosis.
 */
function sendTestNotification() {
  const user = requireAdmin_();
  const subject = '[Consulting Hub] Test notification';
  const html = renderEmail_({
    title: 'Test notification',
    intro: 'This is a test email from the SLG Consulting Topic Hub. ' +
           'If you can read this, notifications are working correctly.',
    rows: [
      ['Sent to',   user.email],
      ['Sent at',   new Date().toLocaleString()],
      ['Provider',  getConfig_('EmailProvider') || 'mailapp']
    ]
  });
  // For the test path we want the error visible to the caller, so we
  // call the dispatcher directly without swallowing.
  const result = sendNotification_({
    type: 'test',
    to: [user.email],
    subject: subject,
    html: html,
    swallow: false
  });
  return result;
}

/*************** PUBLIC TRIGGERS ***************/
/**
 * Called from createTopic() after a successful append.
 * Notifies all admins. Errors are swallowed and logged.
 */
function notifyTopicCreated_(topic) {
  if (!notificationsEnabled_()) return;
  const recipients = getAdminEmails_();
  if (!recipients.length) return;

  const subject = '[Consulting Hub] New topic submitted: ' + topic.Title;
  const areasLabel = (topic.Areas && topic.Areas.length)
    ? topic.Areas.join(', ')
    : (topic.Area || '');
  const html = renderEmail_({
    title: 'New topic submitted',
    intro: '<strong>' + escapeHtmlEmail_(topic.SubmitterName || topic.SubmitterEmail || 'A consultant') +
           '</strong> just submitted a new topic to the Consulting Hub.',
    rows: [
      ['Topic ID',     topic.ID],
      ['Title',        topic.Title],
      ['Area(s)',      areasLabel],
      ['Submitted by', (topic.SubmitterName || '') + ' (' + (topic.SubmitterEmail || '') + ')'],
      ['Submitted at', shortLocalDate_(topic.CreatedAt)]
    ],
    body: topic.Description,
    bodyLabel: 'Description'
  });

  sendNotification_({
    type: 'topic_created',
    to: recipients,
    subject: subject,
    html: html,
    swallow: true
  });
}

/**
 * Called from updateTopic() when the Presenter field changes.
 * Notifies all admins. Errors are swallowed and logged.
 */
function notifyPresenterChanged_(topic, oldPresenter, newPresenter) {
  if (!notificationsEnabled_()) return;
  const recipients = getAdminEmails_();
  if (!recipients.length) return;

  const action = !oldPresenter && newPresenter ? 'assigned'
              : oldPresenter && !newPresenter  ? 'unassigned'
              : 'changed';

  const subject = '[Consulting Hub] Presenter ' + action + ': ' + topic.Title;
  const html = renderEmail_({
    title: 'Presenter ' + action,
    intro: 'The presenter for topic <strong>' + escapeHtmlEmail_(topic.Title) +
           '</strong> was just ' + action + '.',
    rows: [
      ['Topic ID',          topic.ID],
      ['Title',             topic.Title],
      ['Previous presenter', oldPresenter || '—'],
      ['New presenter',      newPresenter || '—'],
      ['Target month',       formatTargetMonthEmail_(topic.TargetMonth)],
      ['Priority',           topic.Priority || '—'],
      ['Updated by',         topic.LastEditedBy || ''],
      ['Updated at',         shortLocalDate_(topic.LastEditedAt)]
    ]
  });

  sendNotification_({
    type: 'presenter_changed',
    to: recipients,
    subject: subject,
    html: html,
    swallow: true
  });
}

/*************** DISPATCHER ***************/
/**
 * Provider-agnostic send dispatcher.
 * opts: { type, to:[], subject, html, swallow:bool }
 * Returns: { ok, status, error } — error is the message string when ok=false.
 * If swallow=true, errors are caught and logged but do not throw.
 */
function sendNotification_(opts) {
  const provider = (getConfig_('EmailProvider') || 'mailapp').toLowerCase();
  const recipients = (opts.to || []).filter(Boolean);
  const result = { ok: false, status: '', error: '' };

  if (!recipients.length) {
    result.status = 'skipped';
    result.error = 'No recipients';
    logNotification_(opts.type, recipients, opts.subject, 'skipped', 'No recipients');
    return result;
  }

  try {
    switch (provider) {
      case 'mailapp':
        sendViaMailApp_(recipients, opts.subject, opts.html);
        break;
      // Future providers slot in here:
      // case 'sendgrid': sendViaSendGrid_(recipients, opts.subject, opts.html); break;
      // case 'graph':    sendViaMSGraph_(recipients, opts.subject, opts.html); break;
      default:
        throw new Error('Unknown email provider: ' + provider);
    }
    result.ok = true;
    result.status = 'sent';
    logNotification_(opts.type, recipients, opts.subject, 'sent', '');
    return result;
  } catch (e) {
    result.ok = false;
    result.status = 'failed';
    result.error = String(e && e.message || e);
    logNotification_(opts.type, recipients, opts.subject, 'failed', result.error);
    if (opts.swallow) {
      return result; // never bubble — calling code should not break on email failures
    }
    throw e;
  }
}

/*************** PROVIDERS ***************/
/**
 * MailApp transport. Sends a single message with all admins on the To: line.
 * For an admin-only audience this is fine; if we ever email consultants,
 * switch to BCC or per-recipient sends.
 */
function sendViaMailApp_(recipients, subject, html) {
  MailApp.sendEmail({
    to:      recipients.join(','),
    subject: subject,
    htmlBody: html,
    name:    'SLG Consulting Topic Hub'
  });
}

/*************** LOGGING ***************/
function logNotification_(type, recipients, subject, status, error) {
  try {
    const sh = sh_(NOTIFICATIONS_TAB);
    if (!sh) return;
    sh.appendRow([
      new Date().toISOString(),
      String(type || ''),
      (recipients || []).join('; '),
      String(subject || ''),
      String(status || ''),
      String(error || '')
    ]);
  } catch (e) {
    // Last-resort: never throw from the logger itself.
    Logger.log('logNotification_ failed: ' + e);
  }
}

function notificationsEnabled_() {
  const v = String(getConfig_('NotificationsEnabled') || 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

/*************** EMAIL TEMPLATING ***************/
/**
 * Renders a notification email body with the navy header bar matching
 * AgendaTemplate. opts:
 *   title     (string)  - the H1 in the navy bar
 *   intro     (HTML)    - lead paragraph (sanitize before passing!)
 *   rows      ([[k,v]]) - simple key/value table
 *   body      (string)  - optional long-form body text (will be escaped + pre-wrapped)
 *   bodyLabel (string)  - heading above body
 */
function renderEmail_(opts) {
  opts = opts || {};
  const rowsHtml = (opts.rows || [])
    .filter(r => r && r.length === 2 && (r[1] !== '' && r[1] != null))
    .map(r =>
      '<tr>' +
        '<td style="padding:6px 12px 6px 0;color:#666;font-size:13px;white-space:nowrap;vertical-align:top">' +
          escapeHtmlEmail_(r[0]) +
        '</td>' +
        '<td style="padding:6px 0;font-size:14px;color:#222;vertical-align:top">' +
          escapeHtmlEmail_(r[1]) +
        '</td>' +
      '</tr>'
    ).join('');

  const bodyBlock = opts.body
    ? '<div style="margin-top:14px">' +
        (opts.bodyLabel
          ? '<div style="font-weight:600;font-size:13px;color:#374151;margin-bottom:4px">' +
              escapeHtmlEmail_(opts.bodyLabel) + '</div>'
          : '') +
        '<div style="font-size:14px;line-height:1.5;white-space:pre-wrap;color:#222;' +
        'background:#f8fafc;border:1px solid #e1e4ea;border-radius:6px;padding:12px">' +
          escapeHtmlEmail_(opts.body) +
        '</div>' +
      '</div>'
    : '';

  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222">' +
      '<div style="background:#1f3a5f;color:#fff;padding:18px 20px;border-radius:6px 6px 0 0">' +
        '<h1 style="margin:0;font-size:20px">' + escapeHtmlEmail_(opts.title || 'Consulting Hub') + '</h1>' +
      '</div>' +
      '<div style="border:1px solid #e1e4ea;border-top:none;padding:20px;border-radius:0 0 6px 6px">' +
        (opts.intro
          ? '<p style="margin:0 0 14px 0;font-size:14px;line-height:1.5">' + opts.intro + '</p>'
          : '') +
        (rowsHtml
          ? '<table style="border-collapse:collapse;width:100%">' + rowsHtml + '</table>'
          : '') +
        bodyBlock +
        '<hr style="border:none;border-top:1px solid #e1e4ea;margin:20px 0">' +
        '<div style="font-size:12px;color:#888">' +
          'Sent automatically by the SLG Consulting Topic Hub.' +
        '</div>' +
      '</div>' +
    '</div>';
}

/*************** SMALL HELPERS ***************/
/**
 * Plain-text HTML escape, kept local so this file is self-contained
 * and matches the email-safe escaping pattern (no fancy entities).
 */
function escapeHtmlEmail_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function shortLocalDate_(s) {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/dd/yy HH:mm');
  } catch (e) {
    return String(s);
  }
}

function formatTargetMonthEmail_(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  return m ? (m[2] + '/' + m[1].slice(2)) : (ym || '—');
}