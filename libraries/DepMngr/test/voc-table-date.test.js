const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreUtils.js'), 'utf8');
const sandbox = {
  CoreUtils: null,
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${y}-${m}-${day}`;
      return `${y}-${m}-${day}`;
    }
  },
  Session: { getScriptTimeZone: () => 'America/New_York' }
};
vm.createContext(sandbox);
vm.runInContext(utilsSrc, sandbox);
const U = sandbox.CoreUtils;

test('formatVocTableDate — ISO timestamp', () => {
  assert.equal(U.formatVocTableDate('2026-02-09T17:47:30Z', 'America/New_York'), '2/09/26');
});

test('formatVocTableDate — date-only', () => {
  assert.equal(U.formatVocTableDate('2025-12-04'), '12/04/25');
});

test('formatVocTableDate — single-digit month', () => {
  assert.equal(U.formatVocTableDate('2026-09-21T18:45:36Z', 'America/New_York'), '9/21/26');
});

test('formatVocTableDate — null and invalid', () => {
  assert.equal(U.formatVocTableDate(null), '\u2014');
  assert.equal(U.formatVocTableDate('not-a-date'), '\u2014');
});
