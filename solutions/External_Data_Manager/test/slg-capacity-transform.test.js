const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEdmGlobals } = require('./loadGasSrc');

test('SLG Capacity batch resolver accepts canonical four-file names', () => {
  const g = loadEdmGlobals();
  const names = [
    'Forecast.csv',
    'WoW_Export_SLG_Actuals_PrevQ_Current.csv',
    'WoW_Export_SLG_Actuals_Historical.csv',
    'SLG Utilization Export_Quarter.csv'
  ];
  const resolved = g.SlgCapacityPipeline.resolveBatchFromFileNames(names);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.batch.forecast, 'Forecast.csv');
});

test('SLG Capacity batch resolver rejects ambiguous forecast files', () => {
  const g = loadEdmGlobals();
  const names = [
    'Forecast.csv',
    'Forecast_backup.csv',
    'WoW_Export_SLG_Actuals_PrevQ_Current.csv',
    'WoW_Export_SLG_Actuals_Historical.csv',
    'SLG Utilization Export_Quarter.csv'
  ];
  const resolved = g.SlgCapacityPipeline.resolveBatchFromFileNames(names);
  assert.equal(resolved.ok, false);
  assert.ok((resolved.errors || []).join(' ').indexOf('Ambiguous') >= 0);
});

test('SLG Capacity run-date seam matches transform_v4 Saturday rule', () => {
  const g = loadEdmGlobals();
  var seam = g.SlgCapacityTransform.computeSeam('2026-05-07');
  assert.equal(g.SlgCapacityTransform.weekKeyYmd(seam.seamCut), '2026-05-02');
  assert.equal(g.SlgCapacityTransform.weekKeyYmd(seam.seamStart), '2026-05-09');
});

test('SLG Capacity ISO run date parses as calendar date (no UTC shift)', () => {
  const g = loadEdmGlobals();
  var seam = g.SlgCapacityTransform.computeSeam('2026-10-12');
  assert.equal(g.SlgCapacityTransform.weekKeyYmd(seam.seamCut), '2026-10-10');
  assert.equal(g.SlgCapacityTransform.weekKeyYmd(seam.seamStart), '2026-10-17');
});

test('SLG Capacity batch accepts forecast horizon beyond actuals reporting week', () => {
  const g = loadEdmGlobals();
  var fc = 'Worker ID,Worker,Week End Transaction Date,Forecasted Hours,Customer Name,Project,Project Role Category,Specialty - Text,Job Profile,Worker Region,Project Region,Worker\'s Manager\n' +
    '1,Alice,10/31/2026,8,Acct,P1,Role,Spec,JP,Government,GR,M\n' +
    '1,Alice,07/31/2027,8,Acct,P1,Role,Spec,JP,Government,GR,M\n';
  var ac = 'Worker ID,Worker,Week End Transaction Date,ICP Hours,Customer Name,Project,Project Role Category,Specialty - Text,Job Profile,Worker Region,Project Region,Worker\'s Manager\n' +
    '1,Alice,10/31/2026,8,Acct,P1,Role,Spec,JP,Government,GR,M\n';
  var hist = 'Worker ID,Worker,Region as of Date Worked,Supervisory Organization as of Date Worked,Specialty Practice,Sub-Specialty Practice,Project,Project Role Category,Worked Hours,Non-Billable Hours,ICP Hours,Fiscal Qtr\n';
  var util = 'h1,h2\n2026-Q1,2026-Q2\nm1,m2\n';
  var validation = g.SlgCapacityPipeline.validateBatch(
    { forecast: 'f', actualsPrevCurrent: 'a', actualsHistorical: 'h', utilization: 'u' },
    { forecast: fc, actualsPrevCurrent: ac, actualsHistorical: hist, utilization: util }
  );
  assert.equal(validation.ok, true);
  assert.ok((validation.warnings || []).join(' ').indexOf('beyond actuals') >= 0);
});

test('SLG Capacity parseDate accepts US slash dates with optional time suffix', () => {
  const g = loadEdmGlobals();
  var d = g.SlgCapacityTransform.parseDate('05/02/2026 12:00:00 AM');
  assert.equal(g.SlgCapacityTransform.weekKeyYmd(d), '2026-05-02');
  d = g.SlgCapacityTransform.parseDate('5/9/2026');
  assert.equal(g.SlgCapacityTransform.weekKeyYmd(d), '2026-05-09');
});

test('SLG Capacity reporting week resolves Week Ending Date on Actuals export', () => {
  const g = loadEdmGlobals();
  var fc = 'Worker ID,Worker,Week End Transaction Date,Forecasted Hours,Customer Name,Project,Project Role Category,Specialty - Text,Job Profile,Worker Region,Project Region,Worker\'s Manager\n' +
    '1,Alice,10/31/2026,8,Acct,P1,Role,Spec,JP,Government,GR,M\n';
  var ac = 'Worker ID,Worker,Week Ending Date,ICP Hours,Customer Name,Project,Project Role Category,Specialty - Text,Job Profile,Worker Region,Project Region,Worker\'s Manager\n' +
    '1,Alice,10/31/2026,8,Acct,P1,Role,Spec,JP,Government,GR,M\n';
  var hist = 'Worker ID,Worker,Region as of Date Worked,Supervisory Organization as of Date Worked,Specialty Practice,Sub-Specialty Practice,Project,Project Role Category,Worked Hours,Non-Billable Hours,ICP Hours,Fiscal Qtr\n';
  var util = 'h1,h2\n2026-Q1,2026-Q2\nm1,m2\n';
  var validation = g.SlgCapacityPipeline.validateBatch(
    { forecast: 'f', actualsPrevCurrent: 'a', actualsHistorical: 'h', utilization: 'u' },
    { forecast: fc, actualsPrevCurrent: ac, actualsHistorical: hist, utilization: util }
  );
  assert.equal(validation.ok, true);
});

test('SLG Capacity processor preserves dryRun flag on validation failure', () => {
  const g = loadEdmGlobals();
  var outcome = g.EdmSlgCapacityProcessor.processBatchJob(
    {
      forecast: 'Worker ID\n',
      actualsPrevCurrent: 'Worker ID\n',
      actualsHistorical: 'Worker ID\n',
      utilization: 'h\n'
    },
    {
      batchLabel: 'test',
      batchFiles: {
        forecast: 'f.csv',
        actualsPrevCurrent: 'a.csv',
        actualsHistorical: 'h.csv',
        utilization: 'u.csv'
      }
    },
    { dryRun: true, skipDuplicateCheck: true }
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.dryRun, true);
});

test('SLG Capacity transform rejects mixed reporting cycle', () => {
  const g = loadEdmGlobals();
  var fc = 'Worker ID,Worker,Week End Transaction Date,Forecasted Hours,Customer Name,Project,Project Role Category,Specialty - Text,Job Profile,Worker Region,Project Region,Worker\'s Manager\n' +
    '1,Alice,05/09/2026,8,Acct,P1,Role,Spec,JP,Government,GR,M\n';
  var ac = 'Worker ID,Worker,Week End Transaction Date,ICP Hours,Customer Name,Project,Project Role Category,Specialty - Text,Job Profile,Worker Region,Project Region,Worker\'s Manager\n' +
    '1,Alice,02/01/2026,8,Acct,P1,Role,Spec,JP,Government,GR,M\n';
  var hist = 'Worker ID,Worker,Region as of Date Worked,Supervisory Organization as of Date Worked,Specialty Practice,Sub-Specialty Practice,Project,Project Role Category,Worked Hours,Non-Billable Hours,ICP Hours,Fiscal Qtr\n';
  var util = 'h1,h2\n2026-Q1,2026-Q2\nm1,m2\n';
  var validation = g.SlgCapacityPipeline.validateBatch(
    { forecast: 'f', actualsPrevCurrent: 'a', actualsHistorical: 'h', utilization: 'u' },
    { forecast: fc, actualsPrevCurrent: ac, actualsHistorical: hist, utilization: util }
  );
  assert.equal(validation.ok, false);
  assert.ok((validation.errors || []).join(' ').indexOf('Actuals latest week end') >= 0);
});
