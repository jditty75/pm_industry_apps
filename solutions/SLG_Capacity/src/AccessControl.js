// ============================================================
// AccessControl.gs — RESTRICTED_DOMAIN access enforcement
// ============================================================
//
// Authorization model: a user is authorized if their email is in
//   Config_SLG_Managers (any active row), OR
//   Config_Settings.admin_emails (comma-separated list).
//
// Enforcement is gated by Config_Settings.app_access_restricted:
//   false (default) — _requireAuthorized_ is a no-op (visible state
//                     can still be inspected via api_getCurrentUserAccess).
//   true            — _requireAuthorized_ throws on unauthorized.
//
// Diagnostics functions retain their existing _dbg_requireAdmin_
// owner-only enforcement and are NOT affected by this layer.
// ============================================================

/**
 * One-time migration: rename recognized_non_manager_emails to
 * admin_emails in Config_Settings if the old key exists.
 * Idempotent — safe to run multiple times.
 */
function _migrateAdminEmailsSetting_() {
  var settings = readSettings_();
  if (settings['recognized_non_manager_emails'] !== undefined &&
      settings['admin_emails'] === undefined) {
    api_saveSettings([
      { key: 'admin_emails', value: settings['recognized_non_manager_emails'] },
      { key: 'recognized_non_manager_emails', value: '' }
    ]);
    Logger.log('_migrateAdminEmailsSetting_: Migrated recognized_non_manager_emails → admin_emails');
  }
}

/**
 * Return the current user's access state.
 * @return {{canViewApp:boolean, email:string, emailDomain:string}}
 */
function getCurrentUserAccess() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; }
  catch (e) { email = ''; }

  var domain = email.indexOf('@') >= 0
    ? email.split('@')[1].toLowerCase()
    : '';

  // Reports the real authorization result regardless of the
  // restriction flag. The flag only controls enforcement, not
  // reporting. This allows previewing the would-be-blocked state.
  var canView = false;
  if (email && domain === 'workday.com') {
    canView = isAuthorized_(email);
  }

  return { canViewApp: canView, email: email, emailDomain: domain };
}

/**
 * Determine if an email is in the authorized list.
 * Source of truth: Config_SLG_Managers.email + Config_Settings.admin_emails.
 * Case-insensitive matching.
 */
function isAuthorized_(email) {
  if (!email) return false;
  var lc = String(email).toLowerCase().trim();

  // Check SLG Managers list.
  try {
    var mgrRows = readConfigSlgManagers_() || [];
    for (var i = 0; i < mgrRows.length; i++) {
      if (String(mgrRows[i].email || '').toLowerCase().trim() === lc) {
        return true;
      }
    }
  } catch (e) { /* fall through */ }

  // Check admin_emails comma-separated list.
  try {
    var settings = readSettings_() || {};
    var raw = String(settings['admin_emails'] || '');
    if (raw) {
      var entries = raw.split(',').map(function (e) {
        return String(e || '').toLowerCase().trim();
      });
      if (entries.indexOf(lc) >= 0) return true;
    }
  } catch (e) { /* fall through */ }

  return false;
}

/**
 * Guard helper called at the top of every client-callable api_* function.
 * When restriction is off, no-op. When on, throws if unauthorized.
 */
function _requireAuthorized_() {
  var settings = readSettings_() || {};
  var restricted = String(settings['app_access_restricted'] || 'false')
                      .toLowerCase().trim() === 'true';
  if (!restricted) return;

  var access = getCurrentUserAccess();
  if (!access.canViewApp) {
    throw new Error('NOT_AUTHORIZED');
  }
}

/**
 * Client-callable wrapper. Note: api_getCurrentUserAccess does NOT call
 * _requireAuthorized_ on itself, because the client needs to call it
 * BEFORE knowing whether it's allowed in. It's the only api_* function
 * with this exemption.
 */
function api_getCurrentUserAccess() {
  _migrateAdminEmailsSetting_();  // one-time migration on first call
  return getCurrentUserAccess();
}
