/**
 * Verifies DM preview mock: isolated google.script.run chains + M2 go-lives/overrides.
 * Run: node preview_dm_runtime_smoke.mjs
 */
const fixture = {
  identityBoot: {
    user: { email: 'preview.user@workday.com', displayName: 'Preview User', role: 'PM', active: true },
    activeUsers: [],
    access: { email: 'preview.user@workday.com', role: 'ADMIN', canViewApp: true },
  },
  freshness: { status: 'fresh', ageHours: 1, lastRefresh: '2026-10-03T08:00:00.000Z' },
  deployments: [
    {
      deploymentId: 'PREVIEW_DEP_0001',
      accountName: 'Example County',
      deploymentName: 'Preview Deployment 1',
      health: 'Green',
      stage: 'Test',
      partner: 'Preview Partner LLC',
    },
  ],
  overview: {
    executiveWatchEnabled: true,
    totals: { totalActive: 12, red: 2, yellow: 2, green: 8, executiveWatch: 1 },
    topHighRisk: [],
    upcomingGoLives: {
      total: 1,
      items: [{ accountName: 'Example County', currentMtp: '2026-10-18', deploymentName: 'X' }],
    },
    lifecycleBuckets: {
      starting: { count: 1, percent: 10 },
      building: { count: 8, percent: 80 },
      landing: { count: 3, percent: 10 },
    },
  },
  recentGoLives: [
    {
      deploymentId: 'PREVIEW_DEP_0001',
      accountName: 'Example County',
      partner: 'Preview Partner LLC',
      lastGoLiveDate: '2026-09-20',
      recordType: 'completed',
    },
  ],
  upcomingGoLives: [
    {
      deploymentId: 'PREVIEW_DEP_0001',
      accountName: 'Example County',
      partner: 'Preview Partner LLC',
      mtpDate: '2026-10-18',
      recordType: 'upcoming',
    },
  ],
  golivesExplorer: {
    valid: true,
    rows: [],
    totalCount: 0,
    kpiSummary: { contextLine: '', cards: [] },
    timeline: [],
    filterOptions: { partners: [], health: [], regions: [], productAreas: [], engagementManagers: [], fiscalYears: [] },
  },
  activeOverrides: [
    {
      type: 'deployment',
      accountName: 'Example County',
      deploymentId: 'PREVIEW_DEP_0001',
      classification: 'Monthly',
      hasOperationalOverride: true,
      fieldsSet: ['Override_Health'],
      currentValues: { health: 'Yellow' },
      sourceValues: { health: 'Green' },
      effectiveValues: { health: 'Yellow' },
      hasReportExclusion: false,
      category: 'operational',
    },
  ],
  overrideAuditLog: [],
  notableDeployments: [
    {
      deploymentId: 'PREVIEW_DEP_0001',
      accountName: 'Example County',
      validationStatus: 'Region Approved',
      notabilityTrigger: 'Smoke notable row',
      latestUpdate: '10/01/2026',
      regionalOwner: 'Preview Owner',
      local: {
        deploymentName: 'Preview Deployment 1',
        partner: 'Preview Partner LLC',
        health: 'Green',
        stage: 'Test',
        mtpDate: '2026-10-18',
      },
    },
  ],
  notablePicker: [
    {
      deploymentId: 'PREVIEW_DEP_0001',
      accountName: 'Example County',
      deploymentName: 'Preview Deployment 1',
      view: 'recent',
      goLiveDate: '2026-09-20',
    },
    {
      deploymentId: 'PREVIEW_DEP_0002',
      accountName: 'Sample Health System',
      deploymentName: 'Preview Deployment 2',
      view: 'upcoming',
      mtpDate: '2026-11-01',
    },
  ],
};

const M3_PLUS = ['getTrendsDashboardData'];

function installMock(handlersForScenario, stateRef) {
  const STATE_KEY = 'preview-dm-override-state-v1-test';
  const loadMutableState = () => stateRef.current;
  const saveMutableState = (st) => {
    stateRef.current = st;
  };

  const HANDLERS = {
    getIdentityBoot: () => handlersForScenario().identityBoot,
    getDataFreshnessForUI: () => handlersForScenario().freshness,
    getAllDeploymentsForUI: () => handlersForScenario().deployments,
    getOverviewData: () => handlersForScenario().overview,
    getRecentGoLivesData: () => handlersForScenario().recentGoLives || [],
    getUpcomingGoLivesData: () => handlersForScenario().upcomingGoLives || [],
    getGoLivesExplorerDataForUI: () => handlersForScenario().golivesExplorer,
    getAllActiveOverridesForUI: () => {
      const st = loadMutableState();
      const base = handlersForScenario().activeOverrides || [];
      return st.extraOverride ? base.concat([st.extraOverride]) : base;
    },
    clearSingleOverrideForUI: (type, id) => {
      const st = loadMutableState();
      if (id === 'MISSING') return { success: false, cleared: 0 };
      st.cleared = { type, id };
      saveMutableState(st);
      return { success: true, cleared: 1 };
    },
    updateDeploymentWithMetaAndOverride: (_ri, depId, _meta, overrideData) => {
      if (!overrideData.classification) throw new Error('classification required');
      const st = loadMutableState();
      st.extraOverride = {
        type: 'deployment',
        accountName: 'New Override',
        deploymentId: depId,
        classification: overrideData.classification,
        hasOperationalOverride: true,
      };
      saveMutableState(st);
    },
    getNotableData: () => handlersForScenario().notableDeployments || [],
    getGoLivesForNotablePicker: () => handlersForScenario().notablePicker || [],
  };

  function runCall(method, args) {
    if (HANDLERS[method]) return HANDLERS[method](...(args || []));
    if (M3_PLUS.includes(method)) throw new Error('M3');
    throw new Error('unimplemented');
  }

  function createGoogleScriptRun() {
    const handlers = { success: null, failure: null };
    const chain = {};
    const proxy = new Proxy(chain, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') {
          return (fn) => {
            handlers.success = fn;
            return proxy;
          };
        }
        if (prop === 'withFailureHandler') {
          return (fn) => {
            handlers.failure = fn;
            return proxy;
          };
        }
        if (prop === 'withUserObject') {
          return () => proxy;
        }
        if (typeof prop === 'string' && prop !== 'then') {
          return function (...args) {
            setTimeout(() => {
              try {
                const result = runCall(prop, args);
                if (handlers.success) handlers.success(result);
              } catch (e) {
                if (handlers.failure) handlers.failure(String(e.message || e));
              }
            }, 0);
          };
        }
      },
    });
    return proxy;
  }

  globalThis.google = { script: {} };
  Object.defineProperty(globalThis.google.script, 'run', {
    configurable: true,
    enumerable: true,
    get() {
      return createGoogleScriptRun();
    },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const stateRef = { current: { extraOverride: null, cleared: null } };
  const pack = () => fixture;
  installMock(pack, stateRef);
  const results = {
    identity: null,
    recent: null,
    upcoming: null,
    overrides: null,
    clearFail: null,
    clearOk: null,
    writeOk: null,
    notable: null,
    notablePicker: null,
  };

  globalThis.google.script.run.withSuccessHandler((d) => { results.identity = d; }).getIdentityBoot();
  globalThis.google.script.run.withSuccessHandler((d) => { results.recent = d; }).getRecentGoLivesData();
  globalThis.google.script.run.withSuccessHandler((d) => { results.upcoming = d; }).getUpcomingGoLivesData();
  globalThis.google.script.run.withSuccessHandler((d) => { results.overrides = d; }).getAllActiveOverridesForUI();
  globalThis.google.script.run.withSuccessHandler((d) => { results.notable = d; }).getNotableData();
  globalThis.google.script.run.withSuccessHandler((d) => { results.notablePicker = d; }).getGoLivesForNotablePicker();
  globalThis.google.script.run
    .withSuccessHandler((d) => { results.clearFail = d; })
    .clearSingleOverrideForUI('deployment', 'MISSING');
  globalThis.google.script.run
    .withSuccessHandler(() => {
      globalThis.google.script.run
        .withSuccessHandler((d) => { results.overridesAfterWrite = d; })
        .getAllActiveOverridesForUI();
    })
    .updateDeploymentWithMetaAndOverride(null, 'PREVIEW_DEP_0001', {}, { overrideHealth: 'Red', classification: 'Monthly' }, '');

  await sleep(40);

  if (!results.identity?.user?.email) {
    console.error('FAIL: identity boot not delivered');
    process.exit(1);
  }
  if (!Array.isArray(results.recent) || results.recent.length < 1) {
    console.error('FAIL: recent go lives', results.recent);
    process.exit(1);
  }
  if (!Array.isArray(results.upcoming) || results.upcoming.length < 1) {
    console.error('FAIL: upcoming go lives', results.upcoming);
    process.exit(1);
  }
  if (!Array.isArray(results.overrides) || results.overrides.length < 1) {
    console.error('FAIL: active overrides', results.overrides);
    process.exit(1);
  }
  if (!Array.isArray(results.notable) || results.notable.length < 1) {
    console.error('FAIL: notable data', results.notable);
    process.exit(1);
  }
  if (!Array.isArray(results.notablePicker) || results.notablePicker.length < 2) {
    console.error('FAIL: notable picker', results.notablePicker);
    process.exit(1);
  }
  if (results.clearFail?.success !== false) {
    console.error('FAIL: clear missing override should return success:false', results.clearFail);
    process.exit(1);
  }
  if (!results.overridesAfterWrite || results.overridesAfterWrite.length < 2) {
    console.error('FAIL: write override should increase list', results.overridesAfterWrite);
    process.exit(1);
  }
  let m3Err = null;
  globalThis.google.script.run
    .withFailureHandler((e) => { m3Err = e; })
    .getTrendsDashboardData();
  await sleep(20);
  if (!m3Err || !String(m3Err).includes('M3')) {
    console.error('FAIL: M3+ method should fail', m3Err);
    process.exit(1);
  }
  console.log('PASS preview_dm_runtime_smoke');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
