/*************** CONFIG ***************/
const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const TOPICS_TAB = 'Topics';
const VOTES_TAB = 'Votes';
const MEETINGS_TAB = 'Meetings';
const CONFIG_TAB = 'Config';
const USERS_TAB = 'Users';
const AREAS = ['HCM', 'FIN', 'PATT'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const STATUSES = ['Proposed', 'Scheduled', 'Discussed', 'Archived'];

// Canonical Topics schema. migrateTopicsSchema_() ensures these headers exist.
const TOPICS_HEADERS = [
  'ID',
  'Area',
  'Title',
  'Description',
  'SubmitterName',
  'SubmitterEmail',
  'CreatedAt',
  'UpdatedAt',
  'Status',
  'Votes',
  'DiscussedOn',
  'AgendaIds',
  'Tags',
  // --- v1 admin extension fields ---
  'Presenter',
  'TargetMonth',
  'Priority',
  'Notes',
  'DriveLinks',
  'LastEditedBy',
  'LastEditedAt'
];

/*************** WEB APP ENTRYPOINT ***************/
function doGet(e) {
  migrateAllSchemas_(); // safe, idempotent
  const t = HtmlService.createTemplateFromFile('Index');
  const user = getCurrentUser();
  t.user = user;
  t.sheetUrl = SpreadsheetApp.openById(SHEET_ID).getUrl();
  return t
    .evaluate()
    .setTitle('SLG Consulting Topic Hub')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/*************** USER / ADMIN ***************/
function getCurrentUser() {
  const email =
    Session.getActiveUser().getEmail() ||
    Session.getEffectiveUser().getEmail();
  const profile = lookupUserByEmail_(email);
  const nameFromEmail = email ? String(email).split('@')[0] : '';
  const displayName =
    (profile && profile.name) ? profile.name : nameFromEmail;
  return {
    email: email,
    name: profile ? profile.name : '',
    displayName: displayName,
    isAdmin: isAdmin_(email)
  };
}

function isAdmin_(email) {
  if (!email) return false;
  const admins = getConfig_('Admins')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.indexOf(String(email).toLowerCase()) !== -1;
}

function requireAdmin_() {
  const u = getCurrentUser();
  if (!u.isAdmin) throw new Error('Admin privilege required.');
  return u;
}

function getConfig_(key) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(CONFIG_TAB);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return String(data[i][1]);
  }
  return '';
}

/*************** DIAGNOSTIC HELPER ***************/
function whoAmI() {
  const u = getCurrentUser();
  Logger.log(JSON.stringify(u));
  return u;
}

/*************** CACHING ***************/
const CACHE_NS = 'topics:v1';

function cacheGet_(key) {
  const raw = CacheService.getScriptCache().get(CACHE_NS + ':' + key);
  return raw ? JSON.parse(raw) : null;
}

function cachePut_(key, val) {
  const secs = parseInt(getConfig_('CacheSeconds') || '60', 10);
  CacheService.getScriptCache().put(
    CACHE_NS + ':' + key,
    JSON.stringify(val),
    secs
  );
}

function cacheBust_() {
  CacheService.getScriptCache().removeAll([
    CACHE_NS + ':all',
    CACHE_NS + ':all_admin',
    CACHE_NS + ':all_user',
    CACHE_NS + ':meetings'
  ]);
}

function runCacheBust() {
  cacheBust_();
  Logger.log('Cache cleared.');
}

/*************** HELPERS ***************/
function sh_(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function rowsToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  return values.map(r => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
}

function splitList_(s) {
  return String(s || '')
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);
}

function nextTopicId_() {
  const sh = sh_(TOPICS_TAB);
  const last = sh.getLastRow();
  if (last < 2) return 'TPC-0001';
  const ids = sh
    .getRange(2, 1, last - 1, 1)
    .getValues()
    .flat()
    .map(s => parseInt(String(s).replace('TPC-', ''), 10))
    .filter(n => !isNaN(n));
  const next = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
  return 'TPC-' + String(next).padStart(4, '0');
}

function formatCell_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(
      v,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }
  return String(v);
}

/*************** USERS HELPERS ***************/
/**
 * Load Users from the USERS_TAB.
 * Robust to extra rows above the actual header (e.g. a distribution list row).
 * Expects some row that contains both a name-ish and email-ish column.
 */
function loadUsers_() {
  const sh = sh_(USERS_TAB);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  let headerRowIndex = -1;
  let headers = [];
  let idx = {};

  // Find the first row that looks like it has name + email columns
  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(c => String(c || ''));
    const rowIdx = {};
    row.forEach((h, i) => (rowIdx[h] = i));
    const nameKey = Object.keys(rowIdx).find(
      h => h.toLowerCase().indexOf('name') !== -1
    );
    const emailKey = Object.keys(rowIdx).find(
      h => h.toLowerCase().indexOf('email') !== -1
    );
    if (nameKey && emailKey) {
      headerRowIndex = r;
      headers = row;
      idx = rowIdx;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // Could not find a header row with both "name" and "email" columns.
    return [];
  }

  const nameKey = Object.keys(idx).find(
    h => h.toLowerCase().indexOf('name') !== -1
  );
  const emailKey = Object.keys(idx).find(
    h => h.toLowerCase().indexOf('email') !== -1
  );
  const nameCol = idx[nameKey];
  const emailCol = idx[emailKey];

  const out = [];
  for (let r = headerRowIndex + 1; r < values.length; r++) {
    const row = values[r];
    const name = String(row[nameCol] || '').trim();
    const email = String(row[emailCol] || '').trim();
    if (!email) continue;
    out.push({ name: name, email: email.toLowerCase() });
  }
  return out;
}

function lookupUserByEmail_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  const users = loadUsers_();
  for (let i = 0; i < users.length; i++) {
    if (users[i].email === email) return users[i];
  }
  return null;
}

/**
 * Public RPC: returns [{ name, email }, ...] sorted by name/email.
 * Used on the client to populate the Presenter autocomplete.
 */
function listUsers() {
  const users = loadUsers_();
  users.sort((a, b) => {
    const an = (a.name || a.email).toLowerCase();
    const bn = (b.name || b.email).toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
  return users;
}

/*************** SCHEMA MIGRATION ***************/
/**
 * Runs every schema migration we know about. Idempotent.
 * Called from doGet so users always see an up-to-date schema.
 */
function migrateAllSchemas_() {
  migrateTopicsSchema_();
  migrateNotificationsSchema_(); // from Notifications.gs
  migrateCommentsSchema_(); // from Comments.gs
}

function runMigrateAllSchemas() {
  migrateAllSchemas_();
  Logger.log('All schema migrations complete.');
}

/**
 * Ensures the Topics sheet has all canonical headers in TOPICS_HEADERS.
 * Adds any missing columns to the right. Safe to run repeatedly.
 */
function migrateTopicsSchema_() {
  const sh = sh_(TOPICS_TAB);
  if (!sh) return;
  const lastCol = Math.max(1, sh.getLastColumn());
  const existing = sh
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(String);
  const missing = TOPICS_HEADERS.filter(
    h => existing.indexOf(h) === -1
  );
  if (!missing.length) return;
  sh.getRange(1, lastCol + 1, 1, missing.length).setValues([
    missing
  ]);
  cacheBust_();
}

function runMigrateTopicsSchema() {
  migrateTopicsSchema_();
  Logger.log('Topics schema migration complete.');
}

/*************** DRIVE LINKS HELPERS ***************/
function parseDriveLinks_(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(l => ({
        url: String(l.url || ''),
        title: String(l.title || ''),
        addedBy: String(l.addedBy || ''),
        addedAt: String(l.addedAt || '')
      }))
      .filter(l => l.url);
  } catch (e) {
    return [];
  }
}

function validateDriveUrl_(url) {
  const s = String(url || '').trim();
  if (!/^https:\/\//i.test(s)) return false;
  return /(drive|docs|script|sites)\.google\.com/i.test(s);
}

/**
 * Best-effort metadata lookup. Returns { title } or empty object on failure.
 * Useful when an admin pastes a Drive URL and we want to auto-fill the title.
 */
function lookupDriveMeta(url) {
  try {
    const m = String(url || '').match(/[-\w]{25,}/);
    if (!m) return {};
    const f = DriveApp.getFileById(m[0]);
    return { title: f.getName() };
  } catch (e) {
    return {};
  }
}

/*************** TOPIC MAPPING ***************/
function mapTopicRow_(t, isAdmin, commentCounts) {
  const areaRaw = String(t.Area || '');
  const areas = areaRaw
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean);
  const primaryArea = areas[0] || '';
  const driveLinks = parseDriveLinks_(t.DriveLinks);
  const commentsCount =
    commentCounts && commentCounts[t.ID]
      ? commentCounts[t.ID]
      : 0;

  // Normalize TargetMonth to 'YYYY-MM' for the UI
  let tm = t.TargetMonth;
  if (tm) {
    if (
      Object.prototype.toString.call(tm) === '[object Date]'
    ) {
      tm = Utilities.formatDate(
        tm,
        Session.getScriptTimeZone(),
        'yyyy-MM'
      );
    } else {
      tm = String(tm).slice(0, 7); // handles 'YYYY-MM' or 'YYYY-MM-DD'
    }
  }

  const obj = {
    ID: String(t.ID || ''),
    Area: primaryArea,
    Areas: areas,
    Title: String(t.Title || ''),
    Description: String(t.Description || ''),
    SubmitterName: String(t.SubmitterName || ''),
    SubmitterEmail: String(t.SubmitterEmail || ''),
    CreatedAt: formatCell_(t.CreatedAt),
    UpdatedAt: formatCell_(t.UpdatedAt),
    Status: String(t.Status || 'Proposed'),
    Votes: Number(t.Votes) || 0,
    DiscussedOn: String(t.DiscussedOn || ''),
    AgendaIds: String(t.AgendaIds || ''),
    Tags: String(t.Tags || ''),
    Presenter: String(t.Presenter || ''),
    TargetMonth: String(tm || ''),
    Priority: String(t.Priority || ''),
    DriveLinks: driveLinks,
    LastEditedBy: String(t.LastEditedBy || ''),
    LastEditedAt: formatCell_(t.LastEditedAt),
    CommentsCount: commentsCount
  };

  if (isAdmin) {
    obj.Notes = String(t.Notes || '');
  }

  return obj;
}

/*************** TOPICS ***************/
function listTopics(filter) {
  filter = filter || {};
  const user = getCurrentUser();

  // Cache the raw mapped list per-role to avoid leaking Notes.
  const cacheKey = user.isAdmin ? 'all_admin' : 'all_user';
  let topics = cacheGet_(cacheKey);
  if (!topics) {
    const raw = rowsToObjects_(sh_(TOPICS_TAB));
    const counts = getCommentCounts_(); // from Comments.gs
    topics = raw.map(t =>
      mapTopicRow_(t, user.isAdmin, counts)
    );
    cachePut_(cacheKey, topics);
  }

  const includeArchived = !!filter.includeArchived;
  return topics
    .filter(
      t => includeArchived || t.Status !== 'Archived'
    )
    .filter(
      t =>
        !filter.area ||
        t.Areas.indexOf(filter.area) !== -1
    )
    .filter(
      t =>
        !filter.status || t.Status === filter.status
    )
    .filter(
      t =>
        !filter.priority ||
        t.Priority === filter.priority
    )
    .filter(
      t =>
        !filter.targetMonth ||
        t.TargetMonth === filter.targetMonth
    )
    .filter(
      t =>
        !filter.q ||
        (
          (t.Title +
            ' ' +
            t.Description +
            ' ' +
            t.Tags +
            ' ' +
            t.Presenter)
            .toLowerCase()
            .includes(
              String(filter.q).toLowerCase()
            )
        )
    )
    .sort(
      (a, b) =>
        (Number(b.Votes) || 0) -
        (Number(a.Votes) || 0)
    );
}

/**
 * Returns a single full topic record. Admin callers also receive Notes.
 */
function getTopic(id) {
  if (!id) throw new Error('Missing topic ID.');
  const user = getCurrentUser();
  const raw = rowsToObjects_(sh_(TOPICS_TAB));
  const row = raw.find(
    r => String(r.ID) === String(id)
  );
  if (!row) throw new Error('Topic not found.');
  const counts = getCommentCounts_();
  return mapTopicRow_(row, user.isAdmin, counts);
}

function createTopic(payload) {
  const user = getCurrentUser();
  if (!user.email)
    throw new Error('You must be signed in.');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(TOPICS_TAB);
  if (!sh) throw new Error('Topics sheet not found.');

  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  const areas =
    payload.areas && payload.areas.length
      ? payload.areas
      : String(payload.area || '')
          .split(/[;,]/)
          .map(s => s.trim())
          .filter(Boolean);
  const areaLabel = areas[0] || '';
  const submitterName =
    String(payload.submitterName || '').trim() ||
    user.displayName ||
    '';

  const topic = {
    ID: id,
    Area: areaLabel,
    Areas: areas,
    Title: String(payload.title || ''),
    Description: String(payload.description || ''),
    SubmitterName: submitterName,
    SubmitterEmail: user.email,
    Status: 'Proposed',
    Tags: '',
    Presenter: '',
    TargetMonth: '',
    Priority: '',
    Notes: '',
    CreatedAt: now,
    LastEditedAt: now,
    LastEditedBy: user.displayName || user.email,
    Votes: 0,
    CommentsCount: 0,
    DriveLinks: []
  };

  const headers = sh
    .getRange(1, 1, 1, sh.getLastColumn())
    .getValues()[0]
    .map(String);
  const row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(
      topic,
      h
    )
      ? topic[h]
      : '';
  });
  sh.appendRow(row);

  // Clear cached topic lists so the new topic appears immediately
  cacheBust_();

  // Notify all admins of the new topic (errors swallowed + logged)
  notifyTopicCreated_(topic);
  return { ok: true, id: id };
}

/**
 * Unified update endpoint.
 * Admins may edit any field listed in adminFields.
 * Submitters may still edit the original limited subset.
 * Patch fields (all optional):
 * Area (string), Areas (array), Title, Description, Status, Tags,
 * Presenter, TargetMonth, Priority, Notes, DriveLinks (array),
 * SubmitterName
 */
function updateTopic(id, patch) {
  migrateAllSchemas_();
  const user = getCurrentUser();
  const sh = sh_(TOPICS_TAB);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => (idx[h] = i));

  for (let i = 1; i < data.length; i++) {
    if (data[i][idx.ID] !== id) continue;

    const submitterEmail = String(
      data[i][idx.SubmitterEmail] || ''
    ).toLowerCase();
    const isOwner =
      submitterEmail ===
      String(user.email || '').toLowerCase();

    if (!user.isAdmin && !isOwner) {
      throw new Error(
        'Only the submitter or an admin may edit this topic.'
      );
    }

    // Capture the prior Presenter so we can detect changes.
    const oldPresenter =
      idx.Presenter !== undefined
        ? String(data[i][idx.Presenter] || '')
        : '';

    // Field allow-lists by role.
    const ownerFields = [
      'Area',
      'Title',
      'Description',
      'Status',
      'Tags'
    ];
    const adminFields = ownerFields.concat([
      'SubmitterName',
      'Presenter',
      'TargetMonth',
      'Priority',
      'Notes',
      'DriveLinks'
    ]);
    const allowed = user.isAdmin
      ? adminFields
      : ownerFields;

    // Normalize Areas array -> Area string if provided.
    if (Array.isArray(patch.Areas) && patch.Areas.length) {
      patch.Area = patch.Areas
        .map(s => String(s).trim())
        .filter(Boolean)
        .join(', ');
    }

    // Validation
    if (
      patch.Status !== undefined &&
      STATUSES.indexOf(patch.Status) === -1
    ) {
      throw new Error(
        'Invalid status: ' + patch.Status
      );
    }

    if (
      patch.Priority !== undefined &&
      patch.Priority !== '' &&
      PRIORITIES.indexOf(patch.Priority) === -1
    ) {
      throw new Error(
        'Invalid priority: ' + patch.Priority
      );
    }

    if (
      patch.TargetMonth !== undefined &&
      patch.TargetMonth !== '' &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(
        String(patch.TargetMonth)
      )
    ) {
      throw new Error(
        'Target month must be in YYYY-MM format.'
      );
    }

    if (
      patch.Notes !== undefined &&
      String(patch.Notes).length > 5000
    ) {
      throw new Error(
        'Notes must be 5000 characters or fewer.'
      );
    }

    if (patch.Area !== undefined) {
      const areas = String(patch.Area)
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(Boolean);
      if (!areas.length)
        throw new Error(
          'At least one functional area is required.'
        );
      areas.forEach(a => {
        if (AREAS.indexOf(a) === -1)
          throw new Error('Invalid area: ' + a);
      });
      patch.Area = areas.join(', ');
    }

    if (patch.DriveLinks !== undefined) {
      const links = Array.isArray(patch.DriveLinks)
        ? patch.DriveLinks
        : [];
      const cleaned = links.map(l => {
        const url = String(
          (l && l.url) || ''
        ).trim();
        if (!validateDriveUrl_(url)) {
          throw new Error(
            'Invalid Drive link URL: ' + url
          );
        }
        return {
          url: url,
          title: String(
            (l && l.title) || ''
          ).trim(),
          addedBy: String(
            (l && l.addedBy) ||
              user.displayName ||
              user.email ||
              ''
          ).trim(),
          addedAt: String(
            (l && l.addedAt) ||
              new Date().toISOString()
          )
        };
      });
      patch.DriveLinks = JSON.stringify(cleaned);
    }

    // Apply allowed fields.
    allowed.forEach(k => {
      if (patch[k] === undefined) return;
      const col = idx[k];
      if (col === undefined) return;
      sh.getRange(i + 1, col + 1).setValue(patch[k]);
    });

    // Audit + UpdatedAt
    const nowIso = new Date().toISOString();
    if (idx.UpdatedAt !== undefined) {
      sh.getRange(i + 1, idx.UpdatedAt + 1).setValue(
        nowIso
      );
    }
    if (idx.LastEditedAt !== undefined) {
      sh.getRange(i + 1, idx.LastEditedAt + 1).setValue(
        nowIso
      );
    }
    if (idx.LastEditedBy !== undefined) {
      const editor = user.displayName || user.email;
      sh.getRange(i + 1, idx.LastEditedBy + 1).setValue(
        editor
      );
    }

    cacheBust_();

    // ---- Notification: presenter assigned/changed/unassigned ----
    if (user.isAdmin && patch.Presenter !== undefined) {
      const newPresenter = String(
        patch.Presenter || ''
      );
      const same =
        oldPresenter.trim().toLowerCase() ===
        newPresenter.trim().toLowerCase();
      if (!same) {
        try {
          // Reread the row to capture all post-write values for the email.
          const updatedRow = sh
            .getRange(i + 1, 1, 1, headers.length)
            .getValues()[0];
          const updatedObj = {};
          headers.forEach(
            (h, j) => (updatedObj[h] = updatedRow[j])
          );
          notifyPresenterChanged_(
            {
              ID: String(updatedObj.ID || id),
              Title: String(
                updatedObj.Title || ''
              ),
              TargetMonth: String(
                updatedObj.TargetMonth || ''
              ),
              Priority: String(
                updatedObj.Priority || ''
              ),
              LastEditedBy: String(
                updatedObj.LastEditedBy ||
                  user.displayName ||
                  user.email
              ),
              LastEditedAt:
                formatCell_(
                  updatedObj.LastEditedAt
                ) || nowIso
            },
            oldPresenter,
            newPresenter
          );
        } catch (e) {
          Logger.log(
            'notifyPresenterChanged_ threw despite swallow: ' +
              e
          );
        }
      }
    }

    return { ok: true };
  }

  throw new Error('Topic not found.');
}

function createTopicFromAdmin(patch) {
  const user = requireAdmin_();
  if (!patch) throw new Error('Missing payload.');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(TOPICS_TAB);
  if (!sh) throw new Error('Topics sheet not found.');

  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  const areas =
    Array.isArray(patch.Areas) && patch.Areas.length
      ? patch.Areas
      : [];
  const submitterName =
    String(patch.SubmitterName || '').trim() ||
    user.displayName ||
    '';

  const topic = {
    ID: id,
    Area: areas[0] || '',
    Areas: areas,
    Title: String(patch.Title || ''),
    Description: String(patch.Description || ''),
    SubmitterName: submitterName,
    SubmitterEmail: user.email,
    Status: patch.Status || 'Proposed',
    Tags: String(patch.Tags || ''),
    Presenter: String(patch.Presenter || ''),
    TargetMonth: String(patch.TargetMonth || ''),
    Priority: String(patch.Priority || ''),
    Notes: String(patch.Notes || ''),
    CreatedAt: now,
    LastEditedAt: now,
    LastEditedBy: user.displayName || user.email,
    Votes: 0,
    CommentsCount: 0,
    DriveLinks: patch.DriveLinks || []
  };

  const headers = sh
    .getRange(1, 1, 1, sh.getLastColumn())
    .getValues()[0]
    .map(String);
  const row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(
      topic,
      h
    )
      ? topic[h]
      : '';
  });
  sh.appendRow(row);

  // Clear cached topic lists so admin-created topic appears immediately
  cacheBust_();

  // Notify admins of the new topic (errors swallowed & logged)
  notifyTopicCreated_(topic);
  return { ok: true, id: id };
}

/**
 * Soft delete: set Status = 'Archived'.
 * Admin-only.
 */
function archiveTopic(id) {
  requireAdmin_();
  return updateTopic(id, { Status: 'Archived' });
}

/**
 * Restore an archived topic back to Proposed. Admin-only.
 */
function restoreTopic(id) {
  requireAdmin_();
  return updateTopic(id, { Status: 'Proposed' });
}

/**
 * Hard delete retained for emergency use only. Admin-only.
 * Prefer archiveTopic.
 */
function deleteTopic(id) {
  requireAdmin_();
  const sh = sh_(TOPICS_TAB);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sh.deleteRow(i + 1);
      cacheBust_();
      return { ok: true };
    }
  }
  throw new Error('Topic not found.');
}

/*************** VOTES ***************/
function toggleVote(topicId) {
  const user = getCurrentUser();
  if (!user.email)
    throw new Error('You must be signed in to vote.');
  const vSh = sh_(VOTES_TAB);
  const rows = vSh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (
      rows[i][1] === topicId &&
      String(rows[i][2]).toLowerCase() ===
        String(user.email).toLowerCase()
    ) {
      vSh.deleteRow(i + 1);
      recountVotes_(topicId);
      cacheBust_();
      return { ok: true, voted: false };
    }
  }
  vSh.appendRow([
    Utilities.getUuid(),
    topicId,
    user.email,
    new Date().toISOString()
  ]);
  recountVotes_(topicId);
  cacheBust_();
  return { ok: true, voted: true };
}

function recountVotes_(topicId) {
  const vRows = sh_(VOTES_TAB).getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < vRows.length; i++)
    if (vRows[i][1] === topicId) count++;
  const tSh = sh_(TOPICS_TAB);
  const data = tSh.getDataRange().getValues();
  const headers = data[0];
  const votesCol = headers.indexOf('Votes') + 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === topicId) {
      tSh.getRange(i + 1, votesCol).setValue(count);
      return;
    }
  }
}

/*************** SAMPLE DATA ***************/
function seedSampleData() {
  migrateAllSchemas_();
  const topicsRows = [
    [
      'TPC-0001',
      'HCM',
      'Security Role Auditing Best Practices',
      'Walk through a repeatable approach to auditing security role assignments post go-live, including common pitfalls with constrained vs. unconstrained roles and how to document exceptions for audit.',
      'Priya Shah',
      'priya.shah@workday.com',
      '2026-02-03T10:15:00.000Z',
      '2026-02-03T10:15:00.000Z',
      'Proposed',
      7,
      '',
      '',
      'audit;security'
    ],
    [
      'TPC-0002',
      'HCM',
      'Business Process Framework Deep Dive',
      'Review BP configuration patterns that consistently cause performance issues or user confusion, with before/after examples from recent deployments.',
      'Marcus Lee',
      'marcus.lee@workday.com',
      '2026-02-11T14:22:00.000Z',
      '2026-03-12T09:00:00.000Z',
      'Scheduled',
      12,
      '2026-03-12',
      'MTG-20260312-HCM',
      'bp;performance'
    ],
    [
      'TPC-0003',
      'HCM',
      'Integrating Core HCM with Third-Party Benefits Vendors',
      'Lessons learned from three recent client engagements integrating HCM with external benefits providers; covers EIB vs. Core Connector vs. Studio trade-offs.',
      'Elena Ortiz',
      'elena.ortiz@workday.com',
      '2026-03-05T08:40:00.000Z',
      '2026-03-05T08:40:00.000Z',
      'Proposed',
      4,
      '',
      '',
      'integrations;benefits'
    ],
    [
      'TPC-0004',
      'FIN',
      'Accounting Center Use Cases Beyond Payroll',
      "Explore non-payroll use cases for Accounting Center — procurement, expenses, revenue — and when it's the right tool vs. custom accounting rules.",
      'David Nguyen',
      'david.nguyen@workday.com',
      '2026-01-28T11:05:00.000Z',
      '2026-02-12T16:30:00.000Z',
      'Discussed',
      15,
      '2026-02-12',
      'MTG-20260212-FIN',
      'accounting-center'
    ],
    [
      'TPC-0005',
      'FIN',
      'Supplier Contracts and Spend Visibility',
      'How to configure supplier contracts to give FP&A real-time spend visibility without over-engineering approval chains.',
      'Rachel Kim',
      'rachel.kim@workday.com',
      '2026-02-19T09:50:00.000Z',
      '2026-02-19T09:50:00.000Z',
      'Proposed',
      6,
      '',
      '',
      'procurement;spend'
    ],
    [
      'TPC-0006',
      'FIN',
      'Financial Reporting Performance Tuning',
      'Practical techniques for speeding up slow financial reports — dimension design, ledger scope, caching strategies, and when to move to Prism.',
      'Tomás Alvarez',
      'tomas.alvarez@workday.com',
      '2026-03-10T13:12:00.000Z',
      '2026-04-09T10:00:00.000Z',
      'Scheduled',
      9,
      '2026-04-09',
      'MTG-20260409-FIN',
      'reporting;performance'
    ],
    [
      'TPC-0007',
      'PATT',
      'Retro Pay Scenarios Clients Always Miss',
      'Top five retro pay situations (mid-period comp changes, late terminations, union back-pay, etc.) and how to configure rules to handle them gracefully.',
      'Aisha Brown',
      'aisha.brown@workday.com',
      '2026-01-15T15:00:00.000Z',
      '2026-02-12T16:30:00.000Z',
      'Discussed',
      18,
      '2026-02-12',
      'MTG-20260212-PATT',
      'retro;payroll'
    ],
    [
      'TPC-0008',
      'PATT',
      'Parallel Testing Strategy for Payroll Go-Lives',
      'A template for structuring three-cycle parallel testing, including variance thresholds, root-cause tracking, and sign-off criteria.',
      'Jordan Miller',
      'jordan.miller@workday.com',
      '2026-03-18T08:20:00.000Z',
      '2026-03-18T08:20:00.000Z',
      'Proposed',
      11,
      '',
      '',
      'testing;go-live'
    ],
    [
      'TPC-0009',
      'PATT',
      'Year-End Readiness Checklist 2026',
      'Updated year-end checklist reflecting recent regulatory changes and Workday release notes, with a sample client communication plan.',
      'Samira Patel',
      'samira.patel@workday.com',
      '2026-04-01T12:00:00.000Z',
      '2026-04-01T12:00:00.000Z',
      'Proposed',
      3,
      '',
      '',
      'year-end;compliance'
    ]
  ];

  const meetingsRows = [
    [
      'MTG-20260212-FIN',
      'FIN',
      '2026-02-12',
      'jeffrey.ditty@workday.com',
      '2026-02-12T17:00:00.000Z',
      'TPC-0004',
      '',
      'Discussed',
      '2026-02-12T18:45:00.000Z'
    ],
    [
      'MTG-20260212-PATT',
      'PATT',
      '2026-02-12',
      'jeffrey.ditty@workday.com',
      '2026-02-12T17:30:00.000Z',
      'TPC-0007',
      '',
      'Discussed',
      '2026-02-12T19:15:00.000Z'
    ],
    [
      'MTG-20260312-HCM',
      'HCM',
      '2026-03-12',
      'jeffrey.ditty@workday.com',
      '2026-03-12T14:00:00.000Z',
      'TPC-0002',
      '',
      'Planned',
      ''
    ],
    [
      'MTG-20260409-FIN',
      'FIN',
      '2026-04-09',
      'jeffrey.ditty@workday.com',
      '2026-04-09T14:00:00.000Z',
      'TPC-0006',
      '',
      'Planned',
      ''
    ]
  ];

  const tSh = sh_(TOPICS_TAB);
  tSh
    .getRange(
      tSh.getLastRow() + 1,
      1,
      topicsRows.length,
      topicsRows[0].length
    )
    .setValues(topicsRows);

  const mSh = sh_(MEETINGS_TAB);
  mSh
    .getRange(
      mSh.getLastRow() + 1,
      1,
      meetingsRows.length,
      meetingsRows[0].length
    )
    .setValues(meetingsRows);

  cacheBust_();

  SpreadsheetApp.getActive().toast(
    'Seed data loaded: ' +
      topicsRows.length +
      ' topics, ' +
      meetingsRows.length +
      ' meetings.'
  );
}