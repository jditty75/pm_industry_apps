const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function getBundleString() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreUI_Js.js'), 'utf8'), sandbox);
  return sandbox._CoreUI_Js_getJsBundle();
}

/**
 * Pre-fix CoreLib 163 development artifact: continuation lines for VoC Details button
 * were emitted outside quoted string fragments, producing invalid JavaScript in the
 * monolithic client bundle (same failure class as Signals "Open deployment" regression).
 */
const BROKEN_VOC_DETAILS_SNIPPET =
  "      '<td><button type=\"button\" class=\"btn btn-link btn-sm voc-resp-expand-hint\" ' +\n" +
  '        onclick="event.stopPropagation(); openVocResponseDetailModal(\\\'\' + escapeJs(r.responseId) + \'\\\')">\' +\n' +
  "        Details</button></td>' +";

const FIXED_VOC_DETAILS_SNIPPET =
  "      '<td><button type=\"button\" class=\"btn btn-link btn-sm voc-resp-expand-hint\" ' +\n" +
  "        'onclick=\"event.stopPropagation(); openVocResponseDetailModal(\\\\\\'\\' + escapeJs(r.responseId) + \\'\\\\\\')\">' +\n" +
  "        'Details</button></td>' +";

test('production CoreUI bundle includes closed VoC Details button string fragments', () => {
  const js = getBundleString();
  assert.ok(js.includes("'Details</button></td>' +"));
  assert.ok(
    js.includes(
      "'onclick=\"event.stopPropagation(); openVocResponseDetailModal(\\'' + escapeJs(r.responseId) + '\\')\">' +"
    )
  );
  assert.ok(!js.includes(BROKEN_VOC_DETAILS_SNIPPET));
});

test('unquoted VoC Details continuation lines break monolithic bundle parse', () => {
  const js = getBundleString();
  const marker = "'Details</button></td>' +";
  const idx = js.indexOf(marker);
  assert.ok(idx > 0, 'expected fixed Details fragment in bundle');
  const broken = js.replace(
    "        'onclick=\"event.stopPropagation(); openVocResponseDetailModal(\\'' + escapeJs(r.responseId) + '\\')\">' +\n" +
      "        'Details</button></td>' +",
    BROKEN_VOC_DETAILS_SNIPPET
  );
  assert.notEqual(broken, js);
  assert.throws(
    () => {
      new Function(broken);
    },
    (err) => err instanceof SyntaxError
  );
});

test('fixed VoC Details fragment pattern parses inside minimal renderVocResponses_ wrapper', () => {
  const wrapper =
    'function renderVocResponses_() {\n' +
    '  return \'<tr>\' +\n' +
    FIXED_VOC_DETAILS_SNIPPET +
    '\n    \'</tr>\';\n' +
    '}\n' +
    'new Function("renderVocResponses_");';
  assert.doesNotThrow(() => {
    new Function(wrapper);
  });
});
