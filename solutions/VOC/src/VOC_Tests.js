/** Run these after installing VOC V1.5; no source writes. */
function testVOCV15Classification() {
  const samples = [
    [{industry:'HENP', name:'Student implementation', children:[]}, true],
    [{industry:'HENP', name:'Finance', children:[{Product_Area__c:' Student '}]}, true],
    [{industry:'HENP', name:'Finance', children:[{Product_Area__c:'Student Financial Aid'}]}, false],
    [{industry:'HC', name:'Student implementation', children:[{Product_Area__c:'Student'}]}, false],
    [{industry:'HENP', name:'Finance', children:[{Product_Area__c:'Financial Management'}]}, false]
  ];
  samples.forEach(([item, expected], i) => {
    if (vocIsStudentDeployment_(item) !== expected) throw new Error('Student classification test failed: ' + i);
  });
  console.log('VOC V1.5 Student classification tests passed');
}

function testVOCV15Snapshot() {
  const snapshot = vocCacheReadSnapshot_();
  if (snapshot.data.schema !== 3 || !snapshot.data.sanaByKey) {
    throw new Error('Run vocRefreshCache() to initialize the V1.5 snapshot');
  }
  const forecast = snapshot.data.forecast;
  const studentCount = forecast.deployments.filter(vocIsStudentDeployment_).length;
  const summaries = Object.keys(snapshot.data.sanaByKey).length;
  const missingMatches = Object.keys(snapshot.data.sanaByKey).filter(key =>
    !forecast.deployments.some(d => d.key === key)).length;
  console.log(JSON.stringify({refreshedAt:snapshot.meta.refreshedAt,
    activeDeployments:forecast.deployments.length,henpStudentDeployments:studentCount,
    sanaSummaries:summaries,summariesWithoutActiveDeployment:missingMatches},null,2));
}

/**
 * @param {Object} parentOverrides
 * @param {Object[]} children
 * @return {ReturnType<typeof vocBuildForecast_>}
 */
function vocTestBuildForecastFixture_(parentOverrides, children) {
  const parent = {
    Id: '001TESTDEP',
    Name: 'Fixture Deployment',
    'Customer__r.Name': 'Fixture Customer',
    Deployment_Partner_Name__c: 'Workday Professional Services',
    Overall_Status__c: 'Active',
    Deployment_Start_Date__c: '2024-01-01',
    Current_MTP_Date__c: '2025-09-01',
    First_Move_to_Production_Date_Actual__c: null,
    _vocIndustry: 'HC',
    ...parentOverrides
  };
  const productFunctions = (children || []).map((c, i) => ({
    Id: 'pf' + i,
    Deployment__c: parent.Id,
    _vocIndustry: 'HC',
    Product_Area__c: 'HCM',
    Function__c: 'Core',
    Production_Move_Date_Target__c: null,
    Production_Move_Date_Actual__c: null,
    ...c
  }));
  return vocBuildForecast_({ deployments: [parent], productFunctions });
}

function vocTestDeployment_(forecast) {
  const d = forecast.deployments[0];
  if (!d) throw new Error('Fixture produced no deployments');
  return d;
}

function vocTestInsightCodes_(insights) {
  return (insights || []).map(i => i.code);
}

/** Sanitized HC-style fixtures; no source workbook writes. */
function testVOCSurveyOpportunityInsights() {
  const octPglMonth = vocPglDate_(vocDate_('2026-08-18')).slice(0, 7);

  // 1. CareOregon-style later product-function actual MTP (Rule 1)
  const careOregon = vocTestBuildForecastFixture_({
    Name: 'CareOregon-style',
    First_Move_to_Production_Date_Actual__c: '2025-09-15',
    Current_MTP_Date__c: '2025-09-01'
  }, [
    { Product_Area__c: 'HCM', Function__c: 'A', Production_Move_Date_Target__c: '2025-09-01',
      Production_Move_Date_Actual__c: '2025-09-15' },
    { Product_Area__c: 'HCM', Function__c: 'B', Production_Move_Date_Target__c: '2026-08-01',
      Production_Move_Date_Actual__c: '2026-08-18' },
    { Product_Area__c: 'HCM', Function__c: 'C', Production_Move_Date_Target__c: '2026-08-01',
      Production_Move_Date_Actual__c: '2026-08-18' },
    { Product_Area__c: 'HCM', Function__c: 'D', Production_Move_Date_Target__c: '2026-08-01',
      Production_Move_Date_Actual__c: '2026-08-18' },
    { Product_Area__c: 'HCM', Function__c: 'E', Production_Move_Date_Target__c: '2026-08-01',
      Production_Move_Date_Actual__c: '2026-08-18' },
    { Product_Area__c: 'HCM', Function__c: 'F', Production_Move_Date_Target__c: '2026-08-01',
      Production_Move_Date_Actual__c: '2026-08-18' }
  ]);
  const careDep = vocTestDeployment_(careOregon);
  const careInsights = vocCollectSurveyOpportunityInsights_(careDep, octPglMonth);
  if (!careInsights.some(i => i.code === 'ADDITIONAL_PRODUCT_GO_LIVE')) {
    throw new Error('CareOregon-style Rule 1 expected for month ' + octPglMonth);
  }
  if (careInsights.some(i => i.code === 'COMPLETED_PRODUCT_DEPLOYMENT')) {
    throw new Error('CareOregon-style should not trigger Rule 2 while Active');
  }

  // 2–3. Highmark / Phelps-style completed focused single-product cohort (Rule 2)
  const highmarkPgl = vocPglDate_(vocDate_('2025-03-10'));
  const highmarkMonth = highmarkPgl.slice(0, 7);
  const highmark = vocTestBuildForecastFixture_({
    Name: 'HiredScore-style',
    Overall_Status__c: 'Complete',
    Current_MTP_Date__c: '2025-03-01',
    First_Move_to_Production_Date_Actual__c: '2025-03-10'
  }, [
    { Product_Area__c: 'Recruiting', Function__c: 'HiredScore',
      Production_Move_Date_Target__c: '2025-03-01', Production_Move_Date_Actual__c: '2025-03-10' }
  ]);
  const highDep = vocTestDeployment_(highmark);
  if (!highDep.pglForecastOnly) throw new Error('Complete deployment should remain PGL forecast only');
  const highInsights = vocCollectSurveyOpportunityInsights_(highDep, highmarkMonth);
  if (!highInsights.some(i => i.code === 'COMPLETED_PRODUCT_DEPLOYMENT')) {
    throw new Error('Highmark-style Rule 2 expected');
  }

  const phelpsPgl = vocPglDate_(vocDate_('2024-11-20'));
  const phelpsMonth = phelpsPgl.slice(0, 7);
  const phelps = vocTestBuildForecastFixture_({
    Name: 'Planning-style',
    Overall_Status__c: 'Complete',
    Current_MTP_Date__c: '2024-11-01',
    First_Move_to_Production_Date_Actual__c: '2024-11-20'
  }, [
    { Product_Area__c: 'Planning', Function__c: 'Adaptive',
      Production_Move_Date_Target__c: '2024-11-01', Production_Move_Date_Actual__c: '2024-11-20' }
  ]);
  const phelpsInsights = vocCollectSurveyOpportunityInsights_(vocTestDeployment_(phelps), phelpsMonth);
  if (!phelpsInsights.some(i => i.code === 'COMPLETED_PRODUCT_DEPLOYMENT')) {
    throw new Error('Phelps-style Rule 2 expected');
  }

  // 4. LHMSH Evisort-style — same Rule 2 logic, no customer exclusion
  const lhmshPgl = vocPglDate_(vocDate_('2025-07-05'));
  const lhmshMonth = lhmshPgl.slice(0, 7);
  const lhmsh = vocTestBuildForecastFixture_({
    Name: 'LHMSH Evisort',
    Overall_Status__c: 'Complete',
    Current_MTP_Date__c: '2025-07-01',
    First_Move_to_Production_Date_Actual__c: '2025-07-05'
  }, [
    { Product_Area__c: 'Legal', Function__c: 'Evisort',
      Production_Move_Date_Target__c: '2025-07-01', Production_Move_Date_Actual__c: '2025-07-05' }
  ]);
  const lhmshInsights = vocCollectSurveyOpportunityInsights_(vocTestDeployment_(lhmsh), lhmshMonth);
  if (!lhmshInsights.some(i => i.code === 'COMPLETED_PRODUCT_DEPLOYMENT')) {
    throw new Error('LHMSH-style Rule 2 expected with consistent cohort logic');
  }

  // 5. No Rule 1 when parent actual MTP missing
  const noParentActual = vocTestBuildForecastFixture_({
    First_Move_to_Production_Date_Actual__c: null
  }, [
    { Production_Move_Date_Target__c: '2025-09-01', Production_Move_Date_Actual__c: '2025-09-15' },
    { Production_Move_Date_Target__c: '2026-08-01', Production_Move_Date_Actual__c: '2026-08-18' }
  ]);
  const noParentInsights = vocCollectSurveyOpportunityInsights_(vocTestDeployment_(noParentActual), octPglMonth);
  if (noParentInsights.some(i => i.code === 'ADDITIONAL_PRODUCT_GO_LIVE')) {
    throw new Error('Rule 1 must not fire without parent actual MTP');
  }

  // 6. No Rule 1 from target-only dates
  const targetOnly = vocTestBuildForecastFixture_({
    First_Move_to_Production_Date_Actual__c: '2025-09-15'
  }, [
    { Production_Move_Date_Target__c: '2025-09-01', Production_Move_Date_Actual__c: '2025-09-15' },
    { Production_Move_Date_Target__c: '2026-08-01', Production_Move_Date_Actual__c: null }
  ]);
  const targetOnlyInsights = vocCollectSurveyOpportunityInsights_(vocTestDeployment_(targetOnly), octPglMonth);
  if (targetOnlyInsights.some(i => i.code === 'ADDITIONAL_PRODUCT_GO_LIVE')) {
    throw new Error('Rule 1 must not fire from target-only PGL');
  }

  // 7. Multi-deliverable Complete — no Rule 2 unless Rule 1 applies independently
  const multiComplete = vocTestBuildForecastFixture_({
    Overall_Status__c: 'Complete',
    First_Move_to_Production_Date_Actual__c: '2025-09-15',
    Current_MTP_Date__c: '2025-09-01'
  }, [
    { Production_Move_Date_Target__c: '2025-09-01', Production_Move_Date_Actual__c: '2025-09-15' },
    { Production_Move_Date_Target__c: '2026-08-01', Production_Move_Date_Actual__c: null }
  ]);
  const multiDep = vocTestDeployment_(multiComplete);
  const multiMonth = multiDep.events.filter(e => e.type === 'PGL')[0].surveyDate.slice(0, 7);
  const multiInsights = vocCollectSurveyOpportunityInsights_(multiDep, multiMonth);
  if (multiInsights.some(i => i.code === 'COMPLETED_PRODUCT_DEPLOYMENT')) {
    throw new Error('Rule 2 must not apply to multi-deliverable Complete deployment');
  }

  // 8. Unrelated forecast month
  if (vocCollectSurveyOpportunityInsights_(careDep, '2020-01').length) {
    throw new Error('Insights must not appear for unrelated forecast months');
  }

  // 9–10. Both rules — one list indicator conceptually (two insight objects for drawer)
  const bothRulesPgl = vocPglDate_(vocDate_('2025-06-15'));
  const bothMonth = bothRulesPgl.slice(0, 7);
  const bothRules = vocTestBuildForecastFixture_({
    Overall_Status__c: 'Complete',
    First_Move_to_Production_Date_Actual__c: '2025-01-10',
    Current_MTP_Date__c: '2025-06-01'
  }, [
    { Product_Area__c: 'HCM', Function__c: 'Only',
      Production_Move_Date_Target__c: '2025-06-01', Production_Move_Date_Actual__c: '2025-06-15' }
  ]);
  const bothDep = vocTestDeployment_(bothRules);
  const bothInsights = vocCollectSurveyOpportunityInsights_(bothDep, bothMonth);
  if (bothInsights.length < 2) {
    throw new Error('Expected both Rule 1 and Rule 2 for combined fixture');
  }
  if (vocTestInsightCodes_(bothInsights).indexOf('ADDITIONAL_PRODUCT_GO_LIVE') < 0 ||
    vocTestInsightCodes_(bothInsights).indexOf('COMPLETED_PRODUCT_DEPLOYMENT') < 0) {
    throw new Error('Combined fixture must include both insight codes');
  }

  // 11–13. Forecast outputs unchanged by insight collection
  const baselineEvents = careDep.events.length;
  const baselineFlags = careDep.flags.length;
  const baselineMds = careDep.events.filter(e => e.type === 'MDS').length;
  vocCollectSurveyOpportunityInsights_(careDep, octPglMonth);
  if (careDep.events.length !== baselineEvents || careDep.flags.length !== baselineFlags) {
    throw new Error('Insight detection must not mutate deployment flags or events');
  }
  if (careDep.events.filter(e => e.type === 'MDS').length !== baselineMds) {
    throw new Error('MDS event counts must remain unchanged');
  }
  if (!highDep.infoNotices || !highDep.infoNotices.length) {
    throw new Error('Completed-deployment PGL inclusion notice must remain');
  }

  // 14. Duration / classification fields untouched
  if (careDep.duration.available !== true || careDep.delivery.classification !== 'MULTI_DELIVERABLE') {
    throw new Error('Cohort classification and duration must remain unchanged');
  }

  // 15. About VoC documentation (static HTML check when run in GAS with HtmlService unavailable — skip in node)
  if (typeof HtmlService !== 'undefined') {
    const aboutHtml = HtmlService.createHtmlOutputFromFile('VOC_Index').getContent();
    if (!aboutHtml.includes('Survey Opportunity Insights') ||
      !aboutHtml.includes('Additional Product Go-Live') ||
      !aboutHtml.includes('Completed Product Deployment')) {
      throw new Error('About VoC missing Survey Opportunity Insights documentation');
    }
  }

  // 16. Insights do not depend on Sana payloads
  for (const ins of bothInsights) {
    if (JSON.stringify(ins).toLowerCase().includes('sana')) {
      throw new Error('Survey insights must not introduce Sana dependencies');
    }
  }

  console.log('VOC Survey Opportunity Insights tests passed');
}

function testVOCDateMathAndInsights() {
  testVOCDateMath();
  testVOCSurveyOpportunityInsights();
  testVOCPartnerClassification();
  console.log('VOC local regression bundle passed');
}
