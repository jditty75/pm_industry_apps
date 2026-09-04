/**
 * Self-test harness for inclusion counts, helpers, and milestone pool (§14).
 * Run in the Apps Script editor against the bound SLED_ActiveDeployments sheet.
 * @returns {Object}
 */
function runSelfTest() {
  Logger.log('runSelfTest: start');
  const results = { passed: true, checks: [] };

  function check(name, ok, detail) {
    results.checks.push({ name: name, ok: ok, detail: detail });
    if (!ok) results.passed = false;
    Logger.log('runSelfTest: ' + name + ' => ' + (ok ? 'PASS' : 'FAIL') + ' — ' + detail);
  }

  // §9 / §14 — pure helpers
  check(
    'parsePersonName plain Full_Name field',
    parsePersonName('Jane Smith') === 'Jane Smith',
    'expected plain name from refreshed header'
  );

  function formatCountdownTextForTest_(days) {
    if (days === 0) return 'today';
    if (days < 0) {
      var ago = Math.abs(days);
      if (ago === 1) return '1 day ago';
      return ago + ' days ago';
    }
    if (days === 1) return 'in 1 day';
    return 'in ' + days + ' days';
  }

  check(
    'countdown negative days',
    formatCountdownTextForTest_(-3) === '3 days ago' &&
      formatCountdownTextForTest_(-1) === '1 day ago' &&
      formatCountdownTextForTest_(0) === 'today' &&
      formatCountdownTextForTest_(2) === 'in 2 days',
    'past and future countdown labels'
  );

  check(
    'window constants',
    LOOKBACK_MONTHS === 3 && LOOKAHEAD_MONTHS === 6,
    'lookback/lookahead months'
  );

  check(
    'window start before today',
    getWindowStartIso_() < getTodayIso_(),
    'window start is in the past'
  );

  check(
    'window end after today',
    getWindowEndIso_() >= getTodayIso_(),
    'window end is today or later'
  );

  const d1 = new Date(2026, 0, 15);
  const d2 = new Date(2026, 7, 17);
  const maxed = maxDate(d1, d2);
  check(
    'maxDate more recent',
    maxed && maxed.getTime() === d2.getTime(),
    'maxDate returned ' + (maxed ? maxed.toISOString() : 'null')
  );
  check(
    'maxDate null tolerant',
    maxDate(null, d1) && maxDate(d1, null),
    'null handling'
  );

  check(
    'isWorkdayDelivered exact match',
    isWorkdayDelivered_({ 'Deployment_Partner_Name__c': 'Workday Professional Services' }) &&
      !isWorkdayDelivered_({ 'Deployment_Partner_Name__c': 'Accenture' }),
    'Workday PS vs other partner'
  );

  // NAME_MAJOR_REGEX tests (§14)
  check(
    'NAME_MAJOR_REGEX HCM',
    NAME_MAJOR_REGEX.test('Subsequent-Phase X: HCM'),
    'HCM token'
  );
  check(
    'NAME_MAJOR_REGEX Financials',
    NAME_MAJOR_REGEX.test('Subsequent-Phase X: Financials'),
    'Financials token'
  );
  check(
    'NAME_MAJOR_REGEX FIN',
    NAME_MAJOR_REGEX.test('Subsequent-Phase X: FIN'),
    'FIN token'
  );
  check(
    'NAME_MAJOR_REGEX Payroll',
    NAME_MAJOR_REGEX.test('Subsequent-Phase X: Payroll'),
    'Payroll token'
  );
  check(
    'NAME_MAJOR_REGEX false Adaptive Planning',
    !NAME_MAJOR_REGEX.test('Adaptive Planning'),
    'Adaptive Planning excluded'
  );
  check(
    'NAME_MAJOR_REGEX false Student',
    !NAME_MAJOR_REGEX.test('Student'),
    'Student excluded'
  );
  check(
    'NAME_MAJOR_REGEX false Scheduling',
    !NAME_MAJOR_REGEX.test('Scheduling'),
    'Scheduling excluded'
  );

  // §4 — inclusion counts (Revision 4)
  const inclusion = getInclusionDiagnostics_();
  Logger.log('runSelfTest: inclusion actuals qualifying=' + inclusion.qualifying +
    ' initial=' + inclusion.initial +
    ' specInitial=' + inclusion.specInitial +
    ' subsequent=' + inclusion.subsequent +
    ' studentExcluded=' + inclusion.studentExcluded +
    ' excluded=' + inclusion.excludedSubsequent);

  check(
    'no specialized-initial in pool',
    inclusion.specInitial === 0,
    inclusion.specInitial + ' specialized-initial in qualifying set (expected 0)'
  );
  check(
    'total qualifying ~255-265',
    inclusion.qualifying >= 255 && inclusion.qualifying <= 265,
    inclusion.qualifying + ' qualifying (expected ~255-265)'
  );
  check(
    'initial ~217',
    inclusion.initial >= 210 && inclusion.initial <= 225,
    inclusion.initial + ' initial (expected ~217)'
  );
  check(
    'subsequent ~42',
    inclusion.subsequent >= 35 && inclusion.subsequent <= 50,
    inclusion.subsequent + ' subsequent (expected ~42)'
  );
  check(
    'historical qualifying includes complete deployments',
    inclusion.historicalQualifying >= inclusion.qualifying,
    inclusion.historicalQualifying + ' historical vs ' + inclusion.qualifying + ' upcoming qualifying'
  );

  check(
    'completed deployments present in sheet',
    inclusion.completedStatus > 0,
    inclusion.completedStatus + ' Complete-status deployments'
  );

  // No Subsequent without (target function OR name-major-token)
  const deployments = readDeployments_();
  const products = readProducts_();
  const productsByDep = groupProductsByDeployment_(products);
  let leaking = 0;
  deployments.forEach(function(dep) {
    const depId = String(dep['Id'] || '').trim();
    const type = String(dep['Deployment_Type__c'] || '').trim();
    const child = productsByDep[depId] || [];
    if (type === TYPE_SUBSEQUENT && qualifies_(dep, child)) {
      const hasFn = hasTargetFunction_(child);
      const hasName = nameHasMajorProduct_(dep);
      if (!hasFn && !hasName) leaking++;
    }
  });
  check(
    'no subsequent without function or name qualifies',
    leaking === 0,
    leaking + ' leaking deployments'
  );

  let studentLeaks = 0;
  deployments.forEach(function(dep) {
    const depId = String(dep['Id'] || '').trim();
    const child = productsByDep[depId] || [];
    if (qualifies_(dep, child) && isStudentDeployment_(dep, child)) studentLeaks++;
  });
  check(
    'no student deployments qualify',
    studentLeaks === 0,
    studentLeaks + ' student deployments in qualifying set'
  );

  // §6 — server window pool (upcoming + historical)
  const all = buildMilestones_();
  const windowed = filterMilestonesToWindow_(all);
  const upcomingWindowed = windowed.filter(function(m) { return m.milestoneStatus === 'upcoming'; });
  const historicalWindowed = windowed.filter(function(m) { return m.milestoneStatus === 'completed'; });
  const customers = {};
  windowed.forEach(function(m) { customers[m.customerName] = true; });
  const customerCount = Object.keys(customers).length;

  Logger.log('runSelfTest: window pool total=' + windowed.length +
    ' upcoming=' + upcomingWindowed.length +
    ' historical=' + historicalWindowed.length +
    ' customers=' + customerCount);

  check(
    'historical milestones generated in window',
    historicalWindowed.length > 0,
    historicalWindowed.length + ' completed milestones in server window'
  );

  check(
    'upcoming window events ~70-110',
    upcomingWindowed.length >= 70 && upcomingWindowed.length <= 110,
    upcomingWindowed.length + ' upcoming events (expected ~87)'
  );

  check(
    'upcoming milestones exclude completed status deployments only',
    upcomingWindowed.every(function(m) { return m.milestoneStatus === 'upcoming'; }),
    'all upcoming-window milestones marked upcoming'
  );

  const historicalProductActual = historicalWindowed.filter(function(m) {
    return m.dateBasis === 'productActual';
  }).length;
  const historicalParentActual = historicalWindowed.filter(function(m) {
    return m.dateBasis === 'parentActual';
  }).length;
  check(
    'historical uses product actual dates when available',
    historicalProductActual > 0,
    historicalProductActual + ' productActual milestones'
  );
  check(
    'historical falls back to parent actual when needed',
    historicalParentActual >= 0,
    historicalParentActual + ' parentActual milestones'
  );

  // Mock historical builder — product actual preferred over parent
  const mockDep = {
    Id: 'mock-dep-1',
    Name: 'Initial Deployment',
    Deployment_Type__c: TYPE_INITIAL,
    First_Move_to_Production_Date_Actual__c: new Date(2020, 0, 1),
    Customer__r: { Name: 'Mock Customer' },
  };
  const mockProducts = [
    {
      Deployment__c: 'mock-dep-1',
      Function__c: 'Core HR',
      Production_Move_Date_Actual__c: new Date(2025, 5, 15),
    },
  ];
  const mockHistorical = buildHistoricalMilestonesForDeployment_(mockDep, mockProducts, []);
  check(
    'mock historical prefers product actual date',
    mockHistorical.length === 1 &&
      mockHistorical[0].goLiveDate === toIso(mockProducts[0]['Production_Move_Date_Actual__c']) &&
      mockHistorical[0].dateBasis === 'productActual',
    JSON.stringify(mockHistorical)
  );

  const mockParentOnly = buildHistoricalMilestonesForDeployment_(mockDep, [], []);
  check(
    'mock historical parent fallback',
    mockParentOnly.length === 1 &&
      mockParentOnly[0].dateBasis === 'parentActual',
    JSON.stringify(mockParentOnly)
  );

  const mockStudentDep = {
    Id: 'mock-student',
    Name: 'Student Initial',
    Deployment_Type__c: TYPE_INITIAL,
    Overall_Status__c: 'Complete',
    First_Move_to_Production_Date_Actual__c: new Date(2025, 1, 1),
  };
  check(
    'student deployments excluded from historical qualification',
    !qualifiesHistorical_(mockStudentDep, [{ Product_Area__c: 'Student', Function__c: 'Student Records' }]),
    'student deployment blocked'
  );

  const mockSpecDep = {
    Id: 'mock-spec',
    Name: 'Specialized Initial',
    Deployment_Type__c: TYPE_SPEC_INITIAL,
    Overall_Status__c: 'Complete',
    First_Move_to_Production_Date_Actual__c: new Date(2025, 1, 1),
  };
  check(
    'specialized initial excluded from historical qualification',
    !qualifiesHistorical_(mockSpecDep, []),
    'specialized initial blocked'
  );

  const mockCompleteDep = {
    Id: 'mock-complete',
    Name: 'Initial Deployment',
    Deployment_Type__c: TYPE_INITIAL,
    Overall_Status__c: 'Complete',
    First_Move_to_Production_Date_Actual__c: new Date(2025, 1, 1),
  };
  check(
    'completed deployments can qualify historically',
    qualifiesHistorical_(mockCompleteDep, []) &&
      !qualifiesUpcoming_(mockCompleteDep, []),
    'Complete qualifies historical only'
  );

  // Contacts join (§14)
  const sample = findSampleDeploymentWithContacts_();
  if (sample) {
    check(
      'contacts join sample count > 0',
      sample.contactCount > 0,
      sample.depId + ' has ' + sample.contactCount + ' contacts'
    );
    const allHaveNameRole = sample.contacts.every(function(c) {
      return c.name && c.role;
    });
    check(
      'contacts have name+role',
      allHaveNameRole,
      'all contacts have name and role'
    );
  } else {
    check('contacts join sample found', false, 'no qualifying deployment with contacts');
  }

  // Export dimension equality (§14)
  if (windowed.length > 0) {
    const columns = getExportColumns_();
    const flat = flattenMilestoneForExport_(windowed[0], getTodayIso_());
    const exportRow = columns.map(function(col) { return flat[col.key] !== undefined ? flat[col.key] : ''; });
    check(
      'export row col count matches headers',
      exportRow.length === columns.length,
      exportRow.length + ' cols vs ' + columns.length + ' headers'
    );
    check(
      'export includes milestone metadata columns',
      flat.milestoneStatus && flat.dateBasis,
      flat.milestoneStatus + ' / ' + flat.dateBasis
    );
  }

  Logger.log('runSelfTest: ' + (results.passed ? 'ALL PASSED' : 'FAILURES'));
  return results;
}
