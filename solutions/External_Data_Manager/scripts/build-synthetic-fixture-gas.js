/**
 * Writes src/EdmSyntheticQualtricsFixture.js from test fixture (dev tooling).
 */
const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'test', 'fixtures', 'synthetic-qualtrics.csv');
const outPath = path.join(__dirname, '..', 'src', 'EdmSyntheticQualtricsFixture.js');
const csv = fs.readFileSync(csvPath, 'utf8');

const body = `/**
 * Synthetic Qualtrics CSV for controlled GAS dry-runs (mirrors test/fixtures).
 * @namespace EdmSyntheticQualtricsFixture
 */
var EdmSyntheticQualtricsFixture = (function () {
  'use strict';

  var SYNTHETIC_QUALTRICS_CSV = ${JSON.stringify(csv)};

  /**
   * @return {string}
   */
  function getCsvText() {
    return SYNTHETIC_QUALTRICS_CSV;
  }

  return {
    FILENAME: 'synthetic-qualtrics-dryrun.csv',
    getCsvText: getCsvText
  };
})();
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log('Wrote', outPath);
