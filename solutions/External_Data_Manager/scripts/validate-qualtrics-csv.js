#!/usr/bin/env node
/**
 * Local Qualtrics source dry-run (counts/metadata only; no row payloads).
 * Usage: node scripts/validate-qualtrics-csv.js <absolute-path-to-export.csv>
 */
const fs = require('fs');
const path = require('path');
const { loadEdmGlobals } = require('../test/loadGasSrc');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/validate-qualtrics-csv.js <absolute-csv-path>');
  process.exit(1);
}

const g = loadEdmGlobals();
const csv = fs.readFileSync(csvPath, 'utf8');
const lines = csv.split(/\r?\n/).filter((l) => l.length);
const v = g.QualtricsPipeline.validateSource(csv);
const n = g.QualtricsTransform.buildCanonicalDataset(csv);
const route = g.QualtricsRoute.validateRoutableRows(n.rows);
const chk = g.EdmChecksum.sha256Hex(csv);
const populations = { healthcare: 0, sled: 0, other: 0, blank: 0 };
n.rows.forEach((r) => {
  const a = r.app || '';
  if (a === 'US Healthcare') populations.healthcare++;
  else if (a === 'US SLED') populations.sled++;
  else if (!a.trim()) populations.blank++;
  else populations.other++;
});
const out = g.EdmQualtricsProcessor.processCsvJob(
  csv,
  { filename: path.basename(csvPath), skipDuplicateCheck: true },
  {
    dryRun: true,
    ingestEnabled: false,
    deps: { checksumFn: (t) => g.EdmChecksum.sha256Hex(t) }
  }
);
const dests = (out.result && out.result.destinationResults) || [];
console.log(
  JSON.stringify(
    {
      file: path.basename(csvPath),
      fileBytes: Buffer.byteLength(csv, 'utf8'),
      validateOk: v.ok,
      validateErrors: (v.errors || []).slice(0, 5),
      sourceLineCount: lines.length - 1,
      canonicalRowCount: n.rows.length,
      populations,
      routingOk: route.ok,
      routingIssueCount: (route.issues || []).length,
      checksumPrefix: chk.slice(0, 16),
      jobStatus: out.job.status,
      healthcareCount: out.job.healthcareCount,
      sledCount: out.job.sledCount,
      destinations: dests.map((d) => ({
        appId: d.appId,
        inputRows: d.inputRows,
        status: d.status
      }))
    },
    null,
    2
  )
);
