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

function minimalDomStub() {
  const el = {
    style: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    setAttribute: function () {},
    getAttribute: function () { return null; },
    addEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  return {
    addEventListener: function () {},
    getElementById: function () { return el; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    execCommand: function () {}
  };
}

function loadParseDeepLinkFn() {
  const js = getBundleString();
  const google = {
    script: {
      run: {
        withSuccessHandler: function () {
          return {
            withFailureHandler: function () {
              return {};
            }
          };
        }
      }
    }
  };
  const runner = new Function(
    'URLSearchParams',
    'document',
    'window',
    'google',
    'Event',
    js + '\nreturn parseDeploymentManagerDeepLinkParams_;'
  );
  return runner(URLSearchParams, minimalDomStub(), {}, google, function Event() {});
}

test('CoreUI client JS bundle parses as executable script', () => {
  const js = getBundleString();
  assert.doesNotThrow(() => {
    new Function(js);
  });
});

test('VoC client surfaces include Responses and Administration', () => {
  const js = getBundleString();
  assert.ok(js.includes('renderVocResponses_'));
  assert.ok(js.includes('switchVocAdminView'));
  assert.ok(js.includes('Loading VoC data'));
  assert.ok(js.includes('setVocNeedsAttentionFilter'));
});

test('Signals detail HTML builder string is syntactically closed', () => {
  const js = getBundleString();
  assert.ok(js.includes('\'Open deployment</button></div>\';'));
  assert.ok(!js.includes('\n    Open deployment</button>'));
});

test('parseDeploymentManagerDeepLinkParams_ treats query values as data', () => {
  const parse = loadParseDeepLinkFn();
  const q = '?tab=signals&deploymentId=DEP%27X&signalId=SIG%20A';
  const out = parse(q);
  assert.equal(out.tab, 'signals');
  assert.equal(out.deploymentId, "DEP'X");
  assert.equal(out.signalId, 'SIG A');
});

test('parseDeploymentManagerDeepLinkParams_ empty search', () => {
  const parse = loadParseDeepLinkFn();
  assert.deepEqual(parse(''), {
    tab: '',
    deploymentId: '',
    signalId: ''
  });
});

test('SLG signals UI config JSON does not break when embedded as literal', () => {
  const uiCfg = {
    signalsTab: { enabled: true, label: 'Signals' },
    deploymentIntelligence: { displayName: "SLG Deployment Intelligence — Jeff's pilot" }
  };
  const literal = JSON.stringify(uiCfg);
  const script = 'var APP_UI_CONFIG = ' + literal + ';';
  new Function(script);
  assert.ok(literal.includes('Jeff'));
});
