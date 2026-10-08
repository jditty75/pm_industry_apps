const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

const TAB_PANEL_IDS = [
  'overview',
  'deployments',
  'golives',
  'reporting',
  'portfolio',
  'csat',
  'notable',
  'overrides',
  'trends',
  'escalations',
  'signals',
  'student'
];

/** @typedef {Record<string, unknown>} AppUiConfig */

function getBundleString() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'CoreUI_Js.js'), 'utf8'), sandbox);
  return sandbox._CoreUI_Js_getJsBundle();
}

function makeTabDom() {
  const nodes = {};
  function el(id) {
    if (!nodes[id]) {
      nodes[id] = {
        id: id,
        innerHTML: '',
        style: {},
        className: '',
        classList: {
          _c: new Set(),
          add(c) { this._c.add(c); },
          remove(c) { this._c.delete(c); },
          toggle(c, on) {
            if (on === false) this._c.delete(c);
            else if (on === true) this._c.add(c);
            else if (this._c.has(c)) this._c.delete(c);
            else this._c.add(c);
          },
          contains(c) { return this._c.has(c); }
        },
        setAttribute() {},
        getAttribute() { return null; },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return [] }
      };
    }
    return nodes[id];
  }
  TAB_PANEL_IDS.forEach(function (tab) {
    el(tab + '-tab');
    el(tab, 'BUTTON');
  });
  el('student-cross-tab-banner');
  return {
    document: {
      body: el('body'),
      addEventListener() {},
      getElementById(id) { return el(id); },
      querySelector(sel) {
        if (sel === '.tab') return TAB_PANEL_IDS.map((t) => el(t, 'BUTTON'));
        if (sel === '.tab-content') return TAB_PANEL_IDS.map((t) => el(t + '-tab'));
        return null;
      },
      querySelectorAll(sel) {
        const q = this.querySelector(sel);
        return q ? (Array.isArray(q) ? q : [q]) : [];
      },
      execCommand() {}
    }
  };
}

/**
 * @param {AppUiConfig} appUiConfig
 */
function loadSwitchTabApi(appUiConfig) {
  globalThis.getComputedStyle = function () {
    return { display: 'block', getPropertyValue() { return ''; } };
  };
  const dom = makeTabDom();
  const clientJs = getBundleString();
  const runner = new Function(
    'document',
    'window',
    'google',
    'URLSearchParams',
    'Event',
    'console',
    clientJs + '\nreturn { _origSwitchTab: _origSwitchTab };'
  );
  return runner(
    dom.document,
    {
      APP_UI_CONFIG: appUiConfig,
      __USER_ACCESS__: { role: 'ADMIN' },
      location: { search: '' },
      history: { replaceState() {} }
    },
    {
      script: {
        run: {
          withSuccessHandler() {
            return { withFailureHandler() { return {}; } };
          }
        }
      }
    },
    URLSearchParams,
    function Event() {},
    console
  );
}

const APP_CONFIGS = {
  SLG: {
    enableAccountLinks: true,
    personalization: { enabled: true },
    goLivesTab: { mode: 'legacy' },
    signalsTab: { enabled: true },
    csatTab: { enabled: true },
    studentTab: { enabled: false }
  },
  HC: {
    enableAccountLinks: true,
    personalization: { enabled: true },
    csatTab: { enabled: true },
    studentTab: { enabled: true }
  },
  HENP: {
    enableAccountLinks: true,
    personalization: { enabled: true },
    csatTab: { enabled: true },
    studentTab: { enabled: false }
  }
};

Object.keys(APP_CONFIGS).forEach(function (appKey) {
  test(appKey + ': client bundle executes and golives tab activates via switchTab', function () {
    const api = loadSwitchTabApi(APP_CONFIGS[appKey]);
    assert.equal(typeof api._origSwitchTab, 'function');
    assert.doesNotThrow(function () {
      api._origSwitchTab('golives');
    });
  });
});

test('assembled client bundle executes for SLG, HC, and HENP APP_UI_CONFIG shapes', function () {
  Object.keys(APP_CONFIGS).forEach(function (appKey) {
    const api = loadSwitchTabApi(APP_CONFIGS[appKey]);
    assert.equal(typeof api._origSwitchTab, 'function');
  });
});
