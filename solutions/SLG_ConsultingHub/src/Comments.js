/*************** COMMENTS ***************/
/**
 * Topic comments v2
 *
 * Flat comment threads per topic (no nesting), plain text only.
 * Any authenticated user may add comments; everyone can read them.
 * Users may edit their own comments indefinitely; admins may delete.
 *
 * Storage: Comments sheet with one row per comment.
 */

const COMMENTS_TAB = 'Comments';

const COMMENTS_HEADERS = [
  'CommentID',   // string (UUID)
  'TopicID',     // string (foreign key to Topics.ID)
  'AuthorEmail', // string
  'AuthorName',  // string (display name)
  'Body',        // string (plain text)
  'CreatedAt',   // ISO timestamp
  'UpdatedAt',   // ISO timestamp
  'EditedBy',    // string (email)
  'Deleted'      // boolean
];

/*************** SCHEMA MIGRATION ***************/
/**
 * Ensures the Comments sheet exists with canonical headers.
 * Safe to run repeatedly. Called from migrateAllSchemas_().
 */
function migrateCommentsSchema_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(COMMENTS_TAB);
  if (!sh) {
    sh = ss.insertSheet(COMMENTS_TAB);
    sh.getRange(1, 1, 1, COMMENTS_HEADERS.length).setValues([COMMENTS_HEADERS]);
    sh.setFrozenRows(1);
    return;
  }

  const lastCol = Math.max(1, sh.getLastColumn());
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = COMMENTS_HEADERS.filter(h => existing.indexOf(h) === -1);
  if (missing.length) {
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
}

function runMigrateCommentsSchema() {
  migrateCommentsSchema_();
  Logger.log('Comments schema migration complete.');
}

/*************** PUBLIC API ***************/
/**
 * Returns all non-deleted comments for a topic, sorted oldest → newest.
 * Anyone may call this (read-only).
 */
function listComments(topicId) {
  if (!topicId) throw new Error('Missing topic ID.');

  migrateCommentsSchema_();

  const sh = sh_(COMMENTS_TAB);
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];

  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const comments = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[idx.TopicID]) !== String(topicId)) continue;

    const deleted = String(r[idx.Deleted] || '').toLowerCase() === 'true';

    comments.push({
      CommentID:   String(r[idx.CommentID] || ''),
      TopicID:     String(r[idx.TopicID] || ''),
      AuthorEmail: String(r[idx.AuthorEmail] || ''),
      AuthorName:  String(r[idx.AuthorName] || ''),
      Body:        String(r[idx.Body] || ''),
      CreatedAt:   formatCell_(r[idx.CreatedAt]),
      UpdatedAt:   formatCell_(r[idx.UpdatedAt]),
      EditedBy:    String(r[idx.EditedBy] || ''),
      Deleted:     deleted
    });
  }

  comments.sort((a, b) => String(a.CreatedAt).localeCompare(String(b.CreatedAt)));
  return comments;
}

/**
 * Creates a new comment on a topic. Any authenticated user may comment.
 */
function addComment(topicId, body) {
  const user = getCurrentUser();
  if (!user.email) throw new Error('You must be signed in to comment.');
  if (!topicId) throw new Error('Missing topic ID.');

  body = String(body || '').trim();
  if (!body) throw new Error('Comment cannot be empty.');
  if (body.length > 2000) throw new Error('Comment must be 2000 characters or fewer.');

  migrateCommentsSchema_();

  // Light existence check: ensure the topic exists.
  const topics = rowsToObjects_(sh_(TOPICS_TAB));
  const exists = topics.some(t => String(t.ID) === String(topicId));
  if (!exists) throw new Error('Topic not found: ' + topicId);

  const sh = sh_(COMMENTS_TAB);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  const id = Utilities.getUuid();
  const now = new Date().toISOString();

  // Prefer Users-sheet-based display name, fallback to email local part
  const displayName =
    (user.displayName && String(user.displayName).trim()) ||
    (user.email ? String(user.email).split('@')[0] : '');

  const valByHeader = {
    CommentID:   id,
    TopicID:     topicId,
    AuthorEmail: user.email,
    AuthorName:  displayName,
    Body:        body,
    CreatedAt:   now,
    UpdatedAt:   now,
    EditedBy:    user.email,
    Deleted:     false
  };

  const row = headers.map(h => valByHeader.hasOwnProperty(h) ? valByHeader[h] : '');
  sh.appendRow(row);

  // No notifications yet — we'll wire those into v2.x/v3.
  return { ok: true, CommentID: id, CreatedAt: now };
}

/**
 * Updates an existing comment's body.
 * Only the original author or an admin may edit, even after long periods.
 */
function updateComment(commentId, newBody) {
  const user = getCurrentUser();
  if (!user.email) throw new Error('You must be signed in to edit comments.');
  if (!commentId) throw new Error('Missing comment ID.');

  newBody = String(newBody || '').trim();
  if (!newBody) throw new Error('Comment cannot be empty.');
  if (newBody.length > 2000) throw new Error('Comment must be 2000 characters or fewer.');

  migrateCommentsSchema_();

  const sh = sh_(COMMENTS_TAB);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error('Comment not found.');

  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx.CommentID]) !== String(commentId)) continue;

    const deleted = String(data[i][idx.Deleted] || '').toLowerCase() === 'true';
    if (deleted) throw new Error('Cannot edit a deleted comment.');

    const authorEmail = String(data[i][idx.AuthorEmail] || '').toLowerCase();
    const isAuthor = authorEmail === String(user.email || '').toLowerCase();
    if (!isAuthor && !user.isAdmin) {
      throw new Error('Only the author or an admin may edit this comment.');
    }

    const now = new Date().toISOString();
    sh.getRange(i + 1, idx.Body + 1).setValue(newBody);
    if (idx.UpdatedAt !== undefined) {
      sh.getRange(i + 1, idx.UpdatedAt + 1).setValue(now);
    }
    if (idx.EditedBy !== undefined) {
      // Keep EditedBy as email for audit consistency.
      sh.getRange(i + 1, idx.EditedBy + 1).setValue(user.email);
    }

    return { ok: true, UpdatedAt: now };
  }

  throw new Error('Comment not found.');
}

/**
 * Soft-delete a comment. Admin-only.
 * Marks Deleted = true and updates EditedBy/UpdatedAt.
 */
function deleteComment(commentId) {
  const user = requireAdmin_();
  if (!commentId) throw new Error('Missing comment ID.');

  migrateCommentsSchema_();

  const sh = sh_(COMMENTS_TAB);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error('Comment not found.');

  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx.CommentID]) !== String(commentId)) continue;

    const now = new Date().toISOString();

    if (idx.Deleted !== undefined) {
      sh.getRange(i + 1, idx.Deleted + 1).setValue(true);
    }
    if (idx.UpdatedAt !== undefined) {
      sh.getRange(i + 1, idx.UpdatedAt + 1).setValue(now);
    }
    if (idx.EditedBy !== undefined) {
      sh.getRange(i + 1, idx.EditedBy + 1).setValue(user.email);
    }

    return { ok: true };
  }

  throw new Error('Comment not found.');
}

/*************** COMMENT COUNTS ***************/
/**
 * Returns a map of TopicID -> commentCount (non-deleted only).
 * Used by listTopics() to surface per-topic counts without extra formulas.
 */
function getCommentCounts_() {
  migrateCommentsSchema_();

  const sh = sh_(COMMENTS_TAB);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return {};

  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const counts = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const deleted = String(r[idx.Deleted] || '').toLowerCase() === 'true';
    if (deleted) continue;

    const topicId = String(r[idx.TopicID] || '');
    if (!topicId) continue;

    counts[topicId] = (counts[topicId] || 0) + 1;
  }

  return counts;
}