const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function makeSignalsDom() {
  const nodes = {};
  function el(id) {
    if (!nodes[id]) {
      nodes[id] = {
        id: id,
        innerHTML: '',
        className: '',
        classList: {
          _c: new Set(),
          add: function (c) { this._c.add(c); },
          remove: function (c) { this._c.delete(c); },
          toggle: function (c, on) {
            if (on === false) this._c.delete(c);
            else if (on === true) this._c.add(c);
            else if (this._c.has(c)) this._c.delete(c);
            else this._c.add(c);
          },
          contains: function (c) { return this._c.has(c); }
        },
        setAttribute: function () {},
        getAttribute: function () { return null; }
      };
    }
    return nodes[id];
  }
  return {
    nodes: nodes,
    document: {
      addEventListener: function () {},
      createElement: function () {
        return { textContent: '', innerHTML: '' };
      },
      getElementById: function (id) { return el(id); },
      querySelectorAll: function () { return []; }
    }
  };
}

function loadSignalsClientApi() {
  const dom = makeSignalsDom();
  const js = fs.readFileSync(path.join(SRC, 'CoreUI_Js.js'), 'utf8');
  const sandbox = {
    document: dom.document,
    window: {},
    google: {
      script: {
        run: {
          withSuccessHandler: function () {
            return { withFailureHandler: function () { return {}; } };
          }
        }
      }
    },
    URLSearchParams: URLSearchParams,
    Event: function Event() {}
  };
  vm.createContext(sandbox);
  const bundle = vm.runInContext(js, sandbox);
  const clientJs = sandbox._CoreUI_Js_getJsBundle();
  const runner = new Function(
    'document',
    'window',
    'google',
    'URLSearchParams',
    'Event',
    clientJs +
      '\nreturn {' +
      'normalizeSignalsLandingPayload_: normalizeSignalsLandingPayload_,' +
      'coerceSignalsArray_: coerceSignalsArray_,' +
      'signalsLandingHasRenderableWorklist_: signalsLandingHasRenderableWorklist_,' +
      'getFilteredSignals_: getFilteredSignals_,' +
      'renderSignalsDashboard_: renderSignalsDashboard_,' +
      'renderSignalsList_: renderSignalsList_,' +
      'signalsUiFilters: signalsUiFilters,' +
      'setSignalsLandingData_: function (d) { signalsLandingData = d; }' +
      '};'
  );
  const api = runner(
    dom.document,
    sandbox.window,
    sandbox.google,
    URLSearchParams,
    sandbox.Event
  );
  return { api, dom };
}

function baseSignal(i, overrides) {
  return Object.assign({
    schema_version: 'deployment-signal-v1',
    signal_id: 'SIG-' + i,
    deployment_id: 'a0X0000000ABC' + String(i).padStart(2, '0'),
    signal_run_id: 'RUN-1',
    signal_as_of: '2026-10-05',
    lifecycle_state: 'NEW',
    attention: i % 3 === 0 ? 'WATCH' : 'HIGH',
    signal_type: 'COMPOUND',
    signal_type_label: 'Compound',
    observation: 'Evidence line.',
    why_it_matters: 'Takeaway line.',
    signal_status: 'ACTIVE',
    account_name: 'Account ' + i,
    deployment_name: 'Deployment ' + i
  }, overrides || {});
}

function productionLandingFixture(n) {
  const signals = [];
  for (let i = 0; i < n; i++) signals.push(baseSignal(i));
  return {
    ok: true,
    enabled: true,
    status: 'ready',
    activeCount: n,
    signals: signals,
    lifecycleSummary: {
      counts: { NEW: n, CONTINUING: 0, ESCALATED: 0, DE_ESCALATED: 0, RESOLVED: 0 },
      fromLatestRun: { new: 0, continuing: 0, escalated: 0, deEscalated: 0, resolved: 0 }
    },
    latestRun: {
      signal_run_id: 'RUN-1',
      signal_as_of: '2026-10-05',
      run_status: 'COMPLETE'
    },
    evidenceFreshness: { oldestSourceRefreshAt: '2026-10-05T12:00:00Z' }
  };
}

test('normalize unwraps nested data and array-like signals objects', () => {
  const { api } = loadSignalsClientApi();
  const row = baseSignal(1);
  const nested = api.normalizeSignalsLandingPayload_({
    ok: true,
    data: { enabled: true, activeCount: 1, signals: [row] }
  });
  assert.equal(nested.signals.length, 1);

  const arrayLike = api.normalizeSignalsLandingPayload_({
    ok: true,
    enabled: true,
    activeCount: 1,
    signals: { 0: row }
  });
  assert.equal(arrayLike.signals.length, 1);
});

test('baseline NEW lifecycle rows render in default investigative filters', () => {
  const { api, dom } = loadSignalsClientApi();
  ['sig-list', 'sig-quiet', 'sig-loading', 'sig-freshness', 'sig-change-strip', 'sig-filter-chips']
    .forEach(function (id) { dom.document.getElementById(id); });

  const raw = productionLandingFixture(16);
  const landing = api.normalizeSignalsLandingPayload_(raw);
  api.setSignalsLandingData_(landing);
  api.signalsUiFilters.lifecycle = 'all';
  api.signalsUiFilters.attention = 'all';
  api.signalsUiFilters.includeResolved = false;

  api.renderSignalsDashboard_(landing);
  assert.equal(api.getFilteredSignals_().length, 16);
  assert.equal(dom.nodes['sig-quiet'].classList.contains('hidden'), true);
  assert.ok(dom.nodes['sig-list'].innerHTML.includes('sig-item'));

  api.signalsUiFilters.lifecycle = 'NEW';
  assert.equal(api.getFilteredSignals_().length, 16);

  api.signalsUiFilters.lifecycle = 'all';
  api.signalsUiFilters.attention = 'HIGH';
  assert.ok(api.getFilteredSignals_().length > 0);

  api.signalsUiFilters.attention = 'WATCH';
  assert.ok(api.getFilteredSignals_().length > 0);
});

test('activeCount wins over stale quiet status when signals present', () => {
  const { api, dom } = loadSignalsClientApi();
  ['sig-list', 'sig-quiet', 'sig-loading', 'sig-freshness', 'sig-change-strip', 'sig-filter-chips']
    .forEach(function (id) { dom.document.getElementById(id); });

  const landing = api.normalizeSignalsLandingPayload_(
    Object.assign(productionLandingFixture(16), { status: 'quiet' }));
  api.setSignalsLandingData_(landing);
  api.renderSignalsDashboard_(landing);
  assert.equal(dom.nodes['sig-quiet'].classList.contains('hidden'), true);
  assert.ok(dom.nodes['sig-list'].innerHTML.includes('sig-item'));
});

test('missing signal_status on wire still renders when activeCount matches', () => {
  const { api, dom } = loadSignalsClientApi();
  ['sig-list', 'sig-quiet', 'sig-loading', 'sig-freshness', 'sig-change-strip', 'sig-filter-chips']
    .forEach(function (id) { dom.document.getElementById(id); });

  const signals = productionLandingFixture(16).signals.map(function (s) {
    const copy = Object.assign({}, s);
    delete copy.signal_status;
    return copy;
  });
  const landing = api.normalizeSignalsLandingPayload_({
    ok: true,
    enabled: true,
    status: 'ready',
    activeCount: 16,
    signals: signals
  });
  api.setSignalsLandingData_(landing);
  api.renderSignalsDashboard_(landing);
  assert.equal(api.getFilteredSignals_().length, 16);
  assert.ok(dom.nodes['sig-list'].innerHTML.includes('sig-item'));
});

test('include resolved retains RESOLVED rows when enabled', () => {
  const { api } = loadSignalsClientApi();
  const landing = api.normalizeSignalsLandingPayload_({
    ok: true,
    enabled: true,
    activeCount: 1,
    signals: [
      baseSignal(1, { signal_status: 'ACTIVE' }),
      baseSignal(2, { signal_status: 'RESOLVED', lifecycle_state: 'RESOLVED' })
    ]
  });
  api.setSignalsLandingData_(landing);
  api.signalsUiFilters.includeResolved = false;
  assert.equal(api.getFilteredSignals_().length, 1);
  api.signalsUiFilters.includeResolved = true;
  assert.equal(api.getFilteredSignals_().length, 2);
});
