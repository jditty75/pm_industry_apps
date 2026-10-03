/**
 * Verifies DM preview mock: each google.script.run chain gets isolated handlers.
 * Run: node preview_dm_runtime_smoke.mjs
 */
const fixture = {
  identityBoot: {
    user: { email: 'preview.user@workday.com', displayName: 'Preview User', role: 'PM', active: true },
    activeUsers: [],
    access: { email: 'preview.user@workday.com', role: 'ADMIN', canViewApp: true },
  },
  freshness: { status: 'fresh', ageHours: 1, lastRefresh: '2026-10-03T08:00:00.000Z' },
  deployments: [{ deploymentId: 'PREVIEW_DEP_0001', accountName: 'Example County', health: 'Green' }],
  overview: {
    executiveWatchEnabled: true,
    totals: { totalActive: 12, red: 2, yellow: 2, green: 8, executiveWatch: 1 },
    topHighRisk: [],
    upcomingGoLives: { total: 1, items: [{ accountName: 'Example County', currentMtp: '2026-10-18', deploymentName: 'X' }] },
    lifecycleBuckets: {
      starting: { count: 1, percent: 10 },
      building: { count: 8, percent: 80 },
      landing: { count: 3, percent: 10 },
    },
  },
};

const M2_PLUS = ['getUpcomingGoLivesData'];

function installMock(handlersForScenario) {
  const HANDLERS = {
    getIdentityBoot: () => handlersForScenario().identityBoot,
    getDataFreshnessForUI: () => handlersForScenario().freshness,
    getAllDeploymentsForUI: () => handlersForScenario().deployments,
    getOverviewData: () => handlersForScenario().overview,
  };

  function runCall(method) {
    if (HANDLERS[method]) return HANDLERS[method]();
    if (M2_PLUS.includes(method)) throw new Error('M2');
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
          return function () {
            setTimeout(() => {
              try {
                const result = runCall(prop);
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
  const pack = () => fixture;
  installMock(pack);
  const results = { identity: null, freshness: null, overview: null };

  globalThis.google.script.run
    .withSuccessHandler((d) => { results.identity = d; })
    .getIdentityBoot();
  globalThis.google.script.run
    .withSuccessHandler((d) => { results.freshness = d; })
    .getDataFreshnessForUI();
  globalThis.google.script.run
    .withSuccessHandler((d) => { results.overview = d; })
    .getOverviewData();

  await sleep(30);

  if (!results.identity?.user?.email) {
    console.error('FAIL: identity boot not delivered');
    process.exit(1);
  }
  if (results.freshness?.status !== 'fresh') {
    console.error('FAIL: freshness handler wrong', results.freshness);
    process.exit(1);
  }
  if (results.overview?.totals?.totalActive !== 12) {
    console.error('FAIL: overview handler wrong', results.overview);
    process.exit(1);
  }
  console.log('PASS preview_dm_runtime_smoke');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
