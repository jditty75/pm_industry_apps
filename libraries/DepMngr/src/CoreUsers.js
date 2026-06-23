/**
 * CoreUsers.gs
 *
 * Shared user/identity + DD-assignment lookups for Phase 2 personalization.
 *
 * Phase 0: STUBS ONLY (no-op functions returning null/[]).
 * Phase 2 (CoreLib v10): Full implementation.
 *
 * Sheets consumed:
 *   - cfg.sheets.appUsers      (default name: "AppUsers")
 *       | Email | DisplayName | Role | Active |
 *       Roles: DD, VP, PM. PM has isAdmin=true.
 *
 *   - cfg.sheets.ddAssignment  (default name: "DD Assignment")
 *       | AccountName | DD DisplayName | Active |
 *       AccountName must exactly match ActiveDeployments.AccountName.
 *       DD DisplayName must exactly match AppUsers.DisplayName.
 *
 * Identity source:
 *   - Session.getActiveUser().getEmail() (reliable in the Workday Workspace
 *     environment).
 *
 * Approved by Jeff in Phase 2 Design Brief 7joemhuqDkrv on 2026-06-09 14:07 EDT.
 */

var CoreUsers = (function () {

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  /**
   * Returns the current user record from AppUsers, or null if the email cannot
   * be resolved or the user is not found / not active.
   *
   * Resolution flow (per §3.1 of the Phase 2 design brief):
   *   1. Try Session.getActiveUser().getEmail().
   *   2. If empty/throws: return null (anonymous — UI degrades gracefully).
   *   3. If returned but not in AppUsers OR not Active: return a special
   *      "unknown" record so the UI can show a "we don't have a record for you"
   *      banner. The unknown record has role: null and isAdmin: false.
   *   4. If found and Active: return the full record.
   *
   * Return shape on success:
   *   {
   *     email: string,           // lowercased
   *     displayName: string,
   *     role: 'DD' | 'VP' | 'PM',
   *     isAdmin: boolean,        // true iff role === 'PM'
   *     active: true
   *   }
   *
   * Return shape on "unknown user" (email resolved but not in AppUsers):
   *   {
   *     email: string,           // lowercased
   *     displayName: '',
   *     role: null,
   *     isAdmin: false,
   *     active: false,
   *     unknown: true            // discriminator flag
   *   }
   *
   * Return null on "anonymous" (no email).
   *
   * @param {AppConfig} config
   * @return {?Object}
   */
  function getCurrentUser(config) {
    var cfg = CoreConfig.withDefaults(config);

    var email = '';
    try {
      email = Session.getActiveUser().getEmail() || '';
    } catch (e) {
      Logger.log('CoreUsers.getCurrentUser: Session.getActiveUser() threw: ' + e);
      return null;
    }

    if (!email) {
      // Try effective user as a fallback (script owner context).
      try {
        email = Session.getEffectiveUser().getEmail() || '';
      } catch (e2) {
        // Ignore — fall through to anonymous.
      }
    }

    if (!email) return null;

    var normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail) return null;

    var users = getActiveUsers(cfg);
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === normalizedEmail) {
        return {
          email:       users[i].email,
          displayName: users[i].displayName,
          role:        users[i].role,
          isAdmin:     users[i].role === 'PM',
          active:      true
        };
      }
    }

    // Email resolved but user not in AppUsers (or not Active).
    return {
      email:       normalizedEmail,
      displayName: '',
      role:        null,
      isAdmin:     false,
      active:      false,
      unknown:     true
    };
  }

  // ---------------------------------------------------------------------------
  // Directory
  // ---------------------------------------------------------------------------

  /**
   * Returns all active users from AppUsers.
   *
   * Reads the sheet specified by cfg.sheets.appUsers. Tolerates:
   *   - Missing sheet (returns []).
   *   - Header row variations (case-insensitive header match).
   *   - Active column as TRUE/FALSE text OR boolean checkbox.
   *   - Empty rows / partial rows (skipped silently).
   *   - Whitespace in email (trimmed and lowercased on read).
   *
   * @param {AppConfig} config
   * @return {Array<{email:string, displayName:string, role:string, active:boolean}>}
   */
  function getActiveUsers(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(cfg.sheets.appUsers);
    if (!sheet) {
      Logger.log('CoreUsers.getActiveUsers: sheet "' + cfg.sheets.appUsers + '" not found.');
      return [];
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var lastCol = sheet.getLastColumn();
    if (lastCol < 4) {
      Logger.log('CoreUsers.getActiveUsers: sheet has fewer than 4 columns; expected Email|DisplayName|Role|Active.');
      return [];
    }

    var values = sheet.getRange(1, 1, lastRow, 4).getValues();
    var headers = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

    var idxEmail   = headers.indexOf('email');
    var idxDisplay = headers.indexOf('displayname');
    var idxRole    = headers.indexOf('role');
    var idxActive  = headers.indexOf('active');

    if (idxEmail < 0 || idxDisplay < 0 || idxRole < 0 || idxActive < 0) {
      Logger.log('CoreUsers.getActiveUsers: required headers missing. Found: ' + headers.join(', '));
      return [];
    }

    var out = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var email = String(row[idxEmail] || '').trim().toLowerCase();
      if (!email) continue;

      var displayName = String(row[idxDisplay] || '').trim();
      var role = String(row[idxRole] || '').trim().toUpperCase();
      if (role !== 'DD' && role !== 'VP' && role !== 'PM') {
        Logger.log('CoreUsers.getActiveUsers: row ' + (r + 1) + ' has invalid role "' + role + '"; skipping.');
        continue;
      }

      if (!isTruthyBool_(row[idxActive])) continue;

      out.push({
        email:       email,
        displayName: displayName,
        role:        role,
        active:      true
      });
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // DD Assignment mapping
  // ---------------------------------------------------------------------------

  /**
   * Returns the canonical Account -> DD-DisplayName mapping from the
   * "DD Assignment" sheet, including only Active rows.
   *
   * Reads the sheet specified by cfg.sheets.ddAssignment. Same tolerance
   * as getActiveUsers (missing sheet returns {}, etc.).
   *
   * Note: account names are kept verbatim (not lowercased) because
   * ActiveDeployments.AccountName is also case-sensitive in the matching
   * logic. If you need case-insensitive matching later, normalize here.
   *
   * @param {AppConfig} config
   * @return {Object<string,string>}  // { 'City of Cleveland': 'Steve Rogers', ... }
   */
  function getDDAssignmentMap(config) {
    var cfg = CoreConfig.withDefaults(config);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(cfg.sheets.ddAssignment);
    if (!sheet) {
      Logger.log('CoreUsers.getDDAssignmentMap: sheet "' + cfg.sheets.ddAssignment + '" not found.');
      return {};
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};

    var lastCol = sheet.getLastColumn();
    if (lastCol < 3) {
      Logger.log('CoreUsers.getDDAssignmentMap: sheet has fewer than 3 columns; expected AccountName|DD DisplayName|Active.');
      return {};
    }

    var values = sheet.getRange(1, 1, lastRow, 3).getValues();
    var headers = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });

    var idxAccount = headers.indexOf('accountname');
    // DD DisplayName has a space; tolerate either "dd displayname" or "dddisplayname".
    var idxDD = headers.indexOf('dd displayname');
    if (idxDD < 0) idxDD = headers.indexOf('dddisplayname');
    var idxActive = headers.indexOf('active');

    if (idxAccount < 0 || idxDD < 0 || idxActive < 0) {
      Logger.log('CoreUsers.getDDAssignmentMap: required headers missing. Found: ' + headers.join(', '));
      return {};
    }

    var map = {};
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var accountName = String(row[idxAccount] || '').trim();
      var ddName      = String(row[idxDD]      || '').trim();
      if (!accountName || !ddName) continue;
      if (!isTruthyBool_(row[idxActive])) continue;
      // Last write wins if duplicate account assignments exist.
      map[accountName] = ddName;
    }

    return map;
  }

  /**
   * Returns the list of unique account names owned by the supplied DD,
   * derived from getDDAssignmentMap.
   *
   * Comparison is case-sensitive on display name. If you change AppUsers
   * to differ from DD Assignment in casing, this will silently miss.
   *
   * @param {AppConfig} config
   * @param {string} ddDisplayName
   * @return {Array<string>}
   */
  function getAccountsOwnedBy(config, ddDisplayName) {
    var cfg = CoreConfig.withDefaults(config);
    var target = String(ddDisplayName || '').trim();
    if (!target) return [];

    var map = getDDAssignmentMap(cfg);
    var accounts = [];
    Object.keys(map).forEach(function (acct) {
      if (map[acct] === target) accounts.push(acct);
    });
    accounts.sort();
    return accounts;
  }

  // ---------------------------------------------------------------------------
  // Row filtering / data-quality
  // ---------------------------------------------------------------------------

  /**
   * Filters deployment/go-live row objects down to those whose accountName
   * is owned by the supplied DD (per the DD Assignment mapping).
   *
   * Rows are expected to have an `accountName` property. Rows whose
   * accountName is not in DD Assignment are filtered out (silent — use
   * findAccountOrphanedRows to surface orphans).
   *
   * @param {AppConfig} config
   * @param {Array<Object>} rows
   * @param {string} ddDisplayName
   * @return {Array<Object>}
   */
  function filterRowsByAccountOwner(config, rows, ddDisplayName) {
    var cfg = CoreConfig.withDefaults(config);
    if (!rows || !rows.length) return [];
    var target = String(ddDisplayName || '').trim();
    if (!target) return [];

    var map = getDDAssignmentMap(cfg);
    return rows.filter(function (row) {
      if (!row || !row.accountName) return false;
      return map[row.accountName] === target;
    });
  }

  /**
   * Returns rows whose accountName is NOT present in the DD Assignment sheet.
   * Used by the Manage Overrides tab (PM-only) to surface data-quality flags.
   *
   * @param {AppConfig} config
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   */
  function findAccountOrphanedRows(config, rows) {
    var cfg = CoreConfig.withDefaults(config);
    if (!rows || !rows.length) return [];
    var map = getDDAssignmentMap(cfg);
    return rows.filter(function (row) {
      if (!row || !row.accountName) return false;
      return !(row.accountName in map);
    });
  }

  /**
   * Returns rows whose row-level DD (row.deliveryDirector) does not match
   * the account's canonical DD per DD Assignment.
   *
   * Rows whose account is not in DD Assignment are NOT returned here (they're
   * orphans, surfaced via findAccountOrphanedRows). Only rows where both
   * exist but disagree are returned.
   *
   * @param {AppConfig} config
   * @param {Array<Object>} rows
   * @return {Array<Object>}
   */
  function findAccountDDMismatchRows(config, rows) {
    var cfg = CoreConfig.withDefaults(config);
    if (!rows || !rows.length) return [];
    var map = getDDAssignmentMap(cfg);
    return rows.filter(function (row) {
      if (!row || !row.accountName) return false;
      var canonical = map[row.accountName];
      if (!canonical) return false;  // orphan — not a mismatch
      var rowDD = String(row.deliveryDirector || '').trim();
      if (!rowDD) return false;  // missing DD — handled by missing-DD highlight, not here
      return canonical !== rowDD;
    });
  }

  // ---------------------------------------------------------------------------
  // Access Control (Stage 1)
  // ---------------------------------------------------------------------------

  // Per-execution cache for access-resolution.
  var _accessCache = null;

  /**
   * Returns the current user's access context for this app.
   *
   * Resolution flow:
   *   1. Resolve email via Session APIs.
   *   2. Validate domain (must end in @workday.com).
   *   3. Look up Role in AppUsers (via existing getCurrentUser) and map to AccessRole:
   *        Role = PM       -> 'ADMIN'
   *        Role = DD, VP   -> 'POWER_USER'
   *        anything else,
   *        not in AppUsers -> 'READ_ONLY'
   *
   * canViewApp is false only when the email is missing OR not @workday.com.
   * Anonymous and non-workday users see an access-denied screen.
   * All other users (read-only included) get canViewApp = true.
   *
   * @param {AppConfig} config
   * @return {{ email:string, role:('ADMIN'|'POWER_USER'|'READ_ONLY'), canViewApp:boolean }}
   */
  function getCurrentUserAccess(config) {
    if (_accessCache !== null) return _accessCache;
    var cfg = CoreConfig.withDefaults(config);

    var email = '';
    try { email = Session.getActiveUser().getEmail() || ''; }
    catch (e) {
      try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e2) {}
    }
    email = String(email || '').trim().toLowerCase();

    // Anonymous or non-workday domain -> access denied.
    if (!email || !email.endsWith('@workday.com')) {
      _accessCache = { email: email, role: 'READ_ONLY', canViewApp: false };
      return _accessCache;
    }

    // Look up Role in AppUsers via existing getCurrentUser plumbing.
    var user = getCurrentUser(cfg);
    var sourceRole = (user && user.role) ? String(user.role).toUpperCase() : '';

    var accessRole;
    if (sourceRole === 'PM') {
      accessRole = 'ADMIN';
    } else if (sourceRole === 'DD' || sourceRole === 'VP') {
      accessRole = 'POWER_USER';
    } else {
      accessRole = 'READ_ONLY';
    }

    _accessCache = { email: email, role: accessRole, canViewApp: true };
    return _accessCache;
  }

  /**
   * Convenience: returns true if the caller is ADMIN or POWER_USER.
   *
   * @param {AppConfig} config
   * @return {boolean}
   */
  function isPowerUser(config) {
    var access = getCurrentUserAccess(config);
    return access.role === 'ADMIN' || access.role === 'POWER_USER';
  }

  /**
   * Guard for mutation endpoints. Throws if the caller does not have
   * power-user access. Called as the first statement in every mutation
   * function in CoreData / CoreExecSummary.
   *
   * @param {AppConfig} config
   * @throws {Error} if caller is READ_ONLY or cannot view the app
   */
  function requirePowerUser_(config) {
    var access = getCurrentUserAccess(config);
    if (!access.canViewApp || access.role === 'READ_ONLY') {
      throw new Error(
        'Access denied: this action requires power-user privileges. ' +
        'User: ' + (access.email || 'unknown') + ', role: ' + access.role
      );
    }
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the supplied cell value represents truthy boolean.
   * Tolerates both literal TRUE/FALSE text and checkbox booleans, plus
   * common variants (true/false, yes/no, 1/0).
   *
   * @param {any} v
   * @return {boolean}
   * @private
   */
  function isTruthyBool_(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1' || s === 'y';
  }

  // ---------------------------------------------------------------------------
  // EXPORTS
  // ---------------------------------------------------------------------------

  return {
    getCurrentUser:               getCurrentUser,
    getActiveUsers:               getActiveUsers,
    getDDAssignmentMap:           getDDAssignmentMap,
    getAccountsOwnedBy:           getAccountsOwnedBy,
    filterRowsByAccountOwner:     filterRowsByAccountOwner,
    findAccountOrphanedRows:      findAccountOrphanedRows,
    findAccountDDMismatchRows:    findAccountDDMismatchRows,
    // Stage 1: Access Control
    getCurrentUserAccess:         getCurrentUserAccess,
    isPowerUser:                  isPowerUser,
    requirePowerUser_:            requirePowerUser_
  };
})();