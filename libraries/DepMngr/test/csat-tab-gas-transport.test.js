'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const vocSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreCsatVoc.js'), 'utf8');
const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreUtils.js'), 'utf8');

function loadVoc() {
  const sandbox = { CoreCsatVoc: null, CoreUtils: null, Utilities: null, Session: null };
  vm.createContext(sandbox);
  vm.runInContext(utilsSrc, sandbox);
  vm.runInContext(vocSrc, sandbox);
  return sandbox.CoreCsatVoc;
}

function assertGasTransportSafe(value, pathLabel) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new Error('unsupported transport value at ' + pathLabel + ': ' + t);
  }
  if (value instanceof Date) {
    throw new Error('native Date at ' + pathLabel);
  }
  if (Array.isArray(value)) {
    value.forEach(function (v, i) {
      assertGasTransportSafe(v, pathLabel + '[' + i + ']');
    });
    return;
  }
  if (value && t === 'object') {
    Object.keys(value).forEach(function (k) {
      assertGasTransportSafe(value[k], pathLabel + '.' + k);
    });
  }
}

/** Mirrors loadCsatTab success-handler gate in CoreUI_Js.js */
function clientCsatTabContractAccepts(resp) {
  return !!(resp && resp.success);
}

function sanitizeLikeCoreData(val) {
  if (val === undefined) return null;
  if (val === null) return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? '' : val.toISOString();
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeLikeCoreData);
  }
  if (typeof val === 'object') {
    const out = {};
    Object.keys(val).forEach(function (k) {
      out[k] = sanitizeLikeCoreData(val[k]);
    });
    return out;
  }
  return val;
}

function minimalCsatTabFixture(appId, responseRows) {
  return {
    success: true,
    productName: 'VoC',
    horizonMonths: 3,
    inFlightRows: [],
    upcomingBatches: {
      horizonMonths: 3,
      today: '2026-10-07',
      asOf: '2026-10-07T12:00:00.000Z',
      groups: [{
        yearMonth: '2026-10',
        monthLabel: 'October 2026',
        schedule: {
          yearMonth: '2026-10',
          surveyOpen: '2026-10-01',
          reminder1: '2026-10-08',
          reminder2: '2026-10-15',
          surveyClose: '2026-10-22',
          mdsOneThirdWindow: { start: '2026-07-01', end: '2026-09-30' },
          pglFirstMtpWindow: { start: '2026-08-01', end: '2026-10-31' },
          isProjected: false
        },
        mdsRows: [{
          deploymentId: 'DEP_SAN_' + appId,
          surveyType: 'MDS',
          cohortDate: '2026-09-15',
          surveyTargetDate: '2026-08-01',
          surveyOpen: '2026-10-01',
          awarenessConditions: []
        }],
        pglRows: [],
        counts: { mds: 1, pgl: 0 }
      }],
      exceptions: [{
        deploymentId: 'DEP_SAN_EX',
        missingType: 'ProductTargets',
        deploymentStartDate: new Date('2026-01-15T12:00:00.000Z'),
        awarenessConditions: [{ code: 'MISSING_PF_TARGET', message: 'Missing PF target' }]
      }]
    },
    exceptions: [],
    responseRows: responseRows,
    responseTotal: responseRows.length,
    notificationRules: [],
    notificationValidation: { valid: [], invalid: [] },
    headerSummary: {},
    kpis: {},
    coveragePct: 0,
    asOf: new Date().toISOString()
  };
}

test('buildResponseListItem coerces sheet Date fields for RPC', () => {
  const V = loadVoc();
  const sheetDate = new Date('2026-10-05T15:30:00.000Z');
  const item = V.buildResponseListItem(
    {
      response_id: 'R1',
      deployment_id: 'DEP_SAN_HC',
      survey_type: 'MDS',
      response_ts_utc: sheetDate,
      account_name: 'Acct',
      deployment_name: 'Dep'
    },
    { cohortDate: sheetDate, surveyEventId: 'SE_X', linkMethod: V.LINK_INFERRED_BATCH }
  );
  assert.equal(item.responseDate, sheetDate.toISOString());
  assert.equal(item.cohortDate, sheetDate.toISOString());
  assertGasTransportSafe(item, 'responseListItem');
});

['HENP', 'HC', 'SLG'].forEach(function (appId) {
  test(appId + '-like CSAT tab payload with populated Responses dates passes client contract after sanitize', () => {
    const V = loadVoc();
    const sheetDate = new Date('2026-09-20T12:00:00.000Z');
    const responseRows = [
      V.buildResponseListItem(
        {
          response_id: 'R_' + appId,
          deployment_id: 'DEP_SAN_' + appId,
          survey_type: 'PGL',
          response_ts_utc: sheetDate,
          target_go_live_date: sheetDate
        },
        { cohortDate: sheetDate, linkMethod: V.LINK_LEGACY_UNKNOWN }
      )
    ];
    const raw = minimalCsatTabFixture(appId, responseRows);
    assert.equal(clientCsatTabContractAccepts(raw), true);
    assert.throws(function () {
      assertGasTransportSafe(raw, 'raw');
    });
    const sanitized = sanitizeLikeCoreData(raw);
    assertGasTransportSafe(sanitized, 'sanitized');
    assert.equal(clientCsatTabContractAccepts(sanitized), true);
  });
});

test('empty Responses and zero awareness remain contract-complete', () => {
  const raw = minimalCsatTabFixture('EMPTY', []);
  raw.upcomingBatches.groups[0].mdsRows[0].awarenessConditions = [];
  raw.upcomingBatches.exceptions = [];
  const sanitized = sanitizeLikeCoreData(raw);
  assertGasTransportSafe(sanitized, 'sanitized');
  assert.equal(clientCsatTabContractAccepts(sanitized), true);
});
