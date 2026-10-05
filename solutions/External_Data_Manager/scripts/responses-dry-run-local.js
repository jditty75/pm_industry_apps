/**
 * Local-only aggregate dry-run (no PII in stdout). Usage:
 *   node scripts/responses-dry-run-local.js path\to\responses.csv
 */
const fs = require('fs');
const path = require('path');
const { loadEdmGlobals } = require('../test/loadGasSrc');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/responses-dry-run-local.js <csvPath>');
  process.exit(1);
}

const g = loadEdmGlobals();
const csv = fs.readFileSync(path.resolve(file), 'utf8');
const kind = g.QualtricsSourceClassifier.classifyCsvText(csv);
const built = g.QualtricsResponsesTransform.transformCsvText(csv);
const outcome = g.EdmQualtricsResponsesProcessor.processCsvJob(csv, {
  filename: path.basename(file)
}, { dryRun: true, skipDuplicateCheck: true });

const routeCounts = {};
if (built.ok) {
  built.rows.forEach((r) => {
    routeCounts[r.sub_region] = (routeCounts[r.sub_region] || 0) + 1;
  });
  const types = { PGL: 0, MDS: 0 };
  built.rows.forEach((r) => {
    types[r.survey_type] = (types[r.survey_type] || 0) + 1;
  });
  console.log(JSON.stringify({
    classifier: kind.kind,
    sourceRowCount: built.sourceRowCount,
    canonicalRowCount: built.rows.length,
    uniqueResponseIds: new Set(built.rows.map((r) => r.response_id)).size,
    routeCounts,
    surveyTypes: types,
    warningCounts: built.warningCounts,
    processorOk: outcome.result.ok,
    destinations: (outcome.result.destinationResults || []).map((d) => ({
      appId: d.appId,
      inputRows: d.inputRows
    }))
  }, null, 2));
} else {
  console.log(JSON.stringify({ classifier: kind.kind, errors: built.errors }, null, 2));
  process.exit(2);
}
