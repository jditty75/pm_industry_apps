const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_PATH = path.join(__dirname, '..', 'src', 'Code.js');
const JS_PATH = path.join(__dirname, '..', 'src', 'JavaScript.html');

/**
 * Load pure DriveLinks helpers from Code.js (same source as GAS).
 * @return {Record<string, Function>}
 */
function loadDriveLinksHelpersFromCode() {
  const code = fs.readFileSync(CODE_PATH, 'utf8');
  const start = code.indexOf(
    '/*************** DRIVE LINKS HELPERS ***************/'
  );
  const end = code.indexOf('/*************** TOPIC MAPPING ***************/');
  assert.ok(start >= 0 && end > start, 'DriveLinks helper region in Code.js');
  const snippet = code.slice(start, end);
  const sandbox = { Logger: { log: () => {} } };
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  return sandbox;
}

/**
 * Load Manage-modal DriveLinks omission helper from JavaScript.html.
 * @return {Function}
 */
function loadShouldOmitHelperFromClient() {
  const html = fs.readFileSync(JS_PATH, 'utf8');
  const match = html.match(
    /function shouldOmitDriveLinksFromManageSave_\([\s\S]*?\n\}/
  );
  assert.ok(match, 'shouldOmitDriveLinksFromManageSave_ in JavaScript.html');
  const sandbox = { state: { manage: {} } };
  vm.createContext(sandbox);
  vm.runInContext(match[0], sandbox);
  return sandbox.shouldOmitDriveLinksFromManageSave_;
}

const H = loadDriveLinksHelpersFromCode();
const shouldOmit = loadShouldOmitHelperFromClient();
const testUser = { displayName: 'Admin User', email: 'admin@example.com' };
const validUrl = 'https://drive.google.com/file/d/abc123/view';

test('normalizeDriveLinksForStorage_: empty links serialize to []', () => {
  assert.equal(H.normalizeDriveLinksForStorage_([], testUser), '[]');
});

test('normalizeDriveLinksForStorage_: valid link round trip', () => {
  const stored = H.normalizeDriveLinksForStorage_(
    [{ url: validUrl, title: 'Deck' }],
    testUser
  );
  const parsed = JSON.parse(stored);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].url, validUrl);
  assert.equal(parsed[0].title, 'Deck');
  assert.equal(parsed[0].addedBy, 'Admin User');
  assert.ok(parsed[0].addedAt);
  const roundTrip = H.parseDriveLinks_(stored);
  assert.equal(roundTrip.length, 1);
  assert.equal(roundTrip[0].url, validUrl);
  assert.equal(roundTrip[0].title, 'Deck');
});

test('normalizeDriveLinksForStorage_: rejects invalid URL', () => {
  assert.throws(
    () =>
      H.normalizeDriveLinksForStorage_(
        [{ url: 'http://evil.com/x' }],
        testUser
      ),
    /Invalid Drive link URL/
  );
});

test('driveLinksCellIsMalformed_: detects corrupt cell values', () => {
  assert.equal(H.driveLinksCellIsMalformed_(''), false);
  assert.equal(H.driveLinksCellIsMalformed_('[]'), false);
  assert.equal(
    H.driveLinksCellIsMalformed_(
      JSON.stringify([{ url: validUrl, title: 'x' }])
    ),
    false
  );
  assert.equal(H.driveLinksCellIsMalformed_('[object Object]'), true);
  assert.equal(H.driveLinksCellIsMalformed_('not-json'), true);
  assert.equal(H.driveLinksCellIsMalformed_('{"x":1}'), true);
});

test('createTopicFromAdmin uses JSON storage (contract)', () => {
  const code = fs.readFileSync(CODE_PATH, 'utf8');
  assert.match(
    code,
    /DriveLinks:\s*normalizeDriveLinksForStorage_\(/,
    'createTopicFromAdmin must serialize DriveLinks before appendRow'
  );
});

test('shouldOmitDriveLinksFromManageSave_: preserve malformed until touched', () => {
  assert.equal(shouldOmit(true, false), true);
  assert.equal(shouldOmit(true, true), false);
  assert.equal(shouldOmit(false, false), false);
});

test('saveManageModal omits DriveLinks when preserving malformed cell', () => {
  const html = fs.readFileSync(JS_PATH, 'utf8');
  assert.match(html, /const omitDriveLinks = shouldOmitDriveLinksFromManageSave_/);
  assert.match(html, /if \(!omitDriveLinks\) \{\s*patch\.DriveLinks/);
});
