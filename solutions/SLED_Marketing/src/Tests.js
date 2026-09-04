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
    'parsePersonName',
    parsePersonName('{attributes={...}, Name=John Waugh}') === 'John Waugh',
    'expected John Waugh'
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
    'no bad subsequent in pool',
    inclusion.badSubsequent.length === 0,
    inclusion.badSubsequent.length + ' unexpected types'
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

  // §6 — 6-month window pool (soft range)
  const all = buildMilestones_();
  const windowed = filterMilestonesToWindow_(all);
  const customers = {};
  windowed.forEach(function(m) { customers[m.customerName] = true; });
  const customerCount = Object.keys(customers).length;

  Logger.log('runSelfTest: window pool events=' + windowed.length + ' customers=' + customerCount +
    ' (expected ~87 / ~85)');

  check(
    'window events ~70-110',
    windowed.length >= 70 && windowed.length <= 110,
    windowed.length + ' events (expected ~87)'
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
  }

  Logger.log('runSelfTest: ' + (results.passed ? 'ALL PASSED' : 'FAILURES'));
  return results;
}
