const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEdmGlobals } = require('./loadGasSrc');
const { createGasSheetHarness } = require('./sheetMock');

/**
 * @param {ReturnType<typeof loadEdmGlobals>} g
 * @return {import('./loadGasSrc').EdmJobTypes.EdmJobRecord}
 */
function sampleJob(g, patch) {
  const job = g.EdmJob.createJob('qualtrics', {
    filename: 'synthetic.csv',
    checksum: 'deadbeef',
    exportTimestamp: '2026-01-01T00:00:00.000Z'
  });
  return Object.assign(job, patch || {});
}

test('brand-new ledger: headers only, one header row', () => {
  const g = loadEdmGlobals();
  const { sheet, spreadsheetApp } = createGasSheetHarness();
  const id = g.EdmAuditLedgerSheet.createLedgerSpreadsheet(spreadsheetApp);
  assert.ok(id);
  assert.equal(sheet.getLastRow(), 1);
  const headers = g.EdmAuditLedgerSheet.EXTENDED_HEADERS;
  assert.equal(headers.length, g.EdmAuditLedger.LEDGER_HEADERS.length + 6);
});

test('first job append after headers (regression: numRows must be 1 not next row index)', () => {
  const g = loadEdmGlobals();
  const { sheet, spreadsheetApp } = createGasSheetHarness();
  g.EdmAuditLedgerSheet.createLedgerSpreadsheet(spreadsheetApp);
  const job = sampleJob(g, {
    status: g.EdmJobTypes.JobStatus.READY_FOR_INGESTION,
    errorMessage: 'DRY_RUN',
    sourceRowCount: 10,
    healthcareCount: 4,
    sledCount: 3
  });
  g.EdmAuditLedgerSheet.appendJob(sheet, job, {
    sourceDisposition: 'INBOX',
    overrideFlags: '',
    hcEligible: 4,
    slgEligible: 3,
    henpEligible: 0
  });
  assert.equal(sheet.getLastRow(), 2);
});

test('second job append grows ledger by one row', () => {
  const g = loadEdmGlobals();
  const { sheet, spreadsheetApp } = createGasSheetHarness();
  g.EdmAuditLedgerSheet.createLedgerSpreadsheet(spreadsheetApp);
  g.EdmAuditLedgerSheet.appendJob(sheet, sampleJob(g, { jobId: 'job_a' }), { sourceDisposition: 'INBOX' });
  g.EdmAuditLedgerSheet.appendJob(sheet, sampleJob(g, { jobId: 'job_b' }), { sourceDisposition: 'INBOX' });
  assert.equal(sheet.getLastRow(), 3);
});

test('no upsert API — append-only ledger (documented behavior)', () => {
  const g = loadEdmGlobals();
  assert.equal(typeof g.EdmAuditLedgerSheet.appendJob, 'function');
  assert.equal(typeof g.EdmAuditLedgerSheet.updateJob, 'undefined');
});

test('readAllJobs returns rows after append with extended header keys', () => {
  const g = loadEdmGlobals();
  const { sheet, spreadsheetApp } = createGasSheetHarness();
  g.EdmAuditLedgerSheet.createLedgerSpreadsheet(spreadsheetApp);
  const job = sampleJob(g, {
    status: g.EdmJobTypes.JobStatus.SUCCESS,
    destinations: [{ destinationId: 'HC_DM', status: 'success' }]
  });
  g.EdmAuditLedgerSheet.appendJob(sheet, job, { sourceDisposition: 'INBOX' });
  const rows = g.EdmAuditLedgerSheet.readAllJobs(sheet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_id, job.jobId);
  assert.equal(rows[0].overall_status, g.EdmJobTypes.JobStatus.SUCCESS);
  assert.equal(rows[0].source_disposition, 'INBOX');
  assert.ok('henp_eligible' in rows[0]);
});

test('duplicate-success lookup via EdmJobHistory on ledger rows', () => {
  const g = loadEdmGlobals();
  const ledgerRows = [
    {
      overall_status: g.EdmJobTypes.JobStatus.READY_FOR_INGESTION,
      destination_statuses: 'HC_DM:pending',
      source_checksum: 'a'
    },
    {
      overall_status: g.EdmJobTypes.JobStatus.SUCCESS,
      destination_statuses: 'HC_DM:success;SLG_DM:success',
      source_checksum: 'b'
    }
  ];
  const refs = g.EdmJobHistory.toPriorJobRefs(ledgerRows);
  assert.equal(refs.length, 2);
  const dup = g.EdmDuplicateGuard.checkDuplicateSuccessful('b', refs);
  assert.equal(dup.allow, false);
  assert.ok(dup.reason);
  const lastHc = g.EdmJobHistory.lastSuccessfulDestination(ledgerRows, 'HC_DM');
  assert.equal(lastHc.source_checksum, 'b');
});

test('dry-run job row preserves DRY_RUN message and extended width', () => {
  const g = loadEdmGlobals();
  const job = sampleJob(g, {
    status: g.EdmJobTypes.JobStatus.READY_FOR_INGESTION,
    errorMessage: 'DRY_RUN'
  });
  const row = g.EdmAuditLedgerSheet.jobToExtendedRow(job, {
    sourceDisposition: 'INBOX',
    hcEligible: 1,
    slgEligible: 2,
    henpEligible: 0
  });
  assert.equal(row.length, g.EdmAuditLedgerSheet.EXTENDED_HEADERS.length);
  assert.equal(row[g.EdmAuditLedger.LEDGER_HEADERS.indexOf('error_message')], 'DRY_RUN');
});

test('extended-header width matches jobToExtendedRow for every append', () => {
  const g = loadEdmGlobals();
  const { sheet, spreadsheetApp } = createGasSheetHarness();
  g.EdmAuditLedgerSheet.createLedgerSpreadsheet(spreadsheetApp);
  const job = sampleJob(g);
  const row = g.EdmAuditLedgerSheet.jobToExtendedRow(job, {});
  assert.equal(row.length, g.EdmAuditLedgerSheet.EXTENDED_HEADERS.length);
  g.EdmAuditLedgerSheet.appendJob(sheet, job, {});
  assert.equal(sheet.getLastRow(), 2);
});

test('readAllJobs on header-only sheet returns empty array', () => {
  const g = loadEdmGlobals();
  const { sheet, spreadsheetApp } = createGasSheetHarness();
  g.EdmAuditLedgerSheet.createLedgerSpreadsheet(spreadsheetApp);
  assert.equal(g.EdmAuditLedgerSheet.readAllJobs(sheet).length, 0);
});
