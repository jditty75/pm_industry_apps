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
});
