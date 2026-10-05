/**
 * Builds synthetic 288-column Qualtrics Responses CSV fixtures for Node tests.
 * Run: node test/fixtures/build-synthetic-responses-fixture.js
 */
const fs = require('fs');
const path = require('path');

const classification = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'analysis',
  'csat-subsystem',
  'source-field-classification.json'
));

const HEADERS = new Array(288);
classification.columns.forEach((c) => {
  HEADERS[c.index] = c.header;
});

/**
 * @param {Object} valuesByHeader
 * @return {string[]}
 */
function buildRow(valuesByHeader) {
  const row = HEADERS.map(() => '');
  Object.keys(valuesByHeader).forEach((h) => {
    const idx = HEADERS.indexOf(h);
    if (idx >= 0) {
      row[idx] = valuesByHeader[h] == null ? '' : String(valuesByHeader[h]);
    }
  });
  return row;
}

function escCell(v) {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsvLine(row) {
  return row.map(escCell).join(',');
}

const basePgl = {
  'Survey_ID': 'R_SYNPGLHC001',
  '_sourceId': 'SV_SYN_PGL',
  '_sourceType': 'survey',
  'Program_Type': 'Post Go-Live Survey',
  'Responsedate (+00:00 GMT)': '2026-03-01 12:00:00',
  'Deployment_ID': '001SYNHC0000001AA',
  'Deployment_Name': 'Synthetic HC Deployment',
  'Account_ID': '001SYNACC0000001AA',
  'Account_Name': 'Synthetic Health Org',
  'Sub Region': 'US Healthcare',
  'Deployment_Stage': 'Complete',
  'Normalized Deployment Type': 'Initial',
  'Services_Approach': 'Launch',
  'Priming_Partner': 'Workday',
  'Deployment_Partner_Name': 'Synthetic Partner LLC',
  'Deployment_Engagement_Manager': 'Synthetic Manager',
  'Product Area': 'Core HCM, Payroll',
  'Deployment_Contact_Role': 'Executive Sponsor',
  'Overall Satisfaction': '5',
  '#PGL Satisfaction': '5',
  'Post_Go-Live_NPS': '10',
  'What_are_the_main_reasons_for_your_score?': 'Synthetic positive feedback only.',
  '_cachedDate (+00:00 GMT)': '2026-03-02 08:00:00'
};

const rows = [
  buildRow(basePgl),
  buildRow(Object.assign({}, basePgl, {
    'Survey_ID': 'R_SYNMDSSLG001',
    '_sourceId': 'SV_SYN_MDS',
    'Program_Type': 'Mid-Deployment Survey',
    'Sub Region': 'Government',
    '#PGL Satisfaction': '',
    'Post_Go-Live_NPS': '',
    '#MDS Satisfaction': '4',
    'Overall Satisfaction': '4',
    'What_could_we_improve_moving_forward?': '=HYPERLINK("http://evil.example")'
  })),
  buildRow(Object.assign({}, basePgl, {
    'Survey_ID': 'R_SYNPGLHENP01',
    'Sub Region': 'Higher Ed & Student',
    'Product Area': 'Financials, Planning, Unknown Area Token'
  })),
  buildRow(Object.assign({}, basePgl, {
    'Survey_ID': 'R_SYNDUPA00001',
    'Responsedate (+00:00 GMT)': '2026-02-01 10:00:00',
    'Overall Satisfaction': '3'
  })),
  buildRow(Object.assign({}, basePgl, {
    'Survey_ID': 'R_SYNDUPA00001',
    'Responsedate (+00:00 GMT)': '2026-04-01 10:00:00',
    'Overall Satisfaction': '4'
  }))
];

const inflightRow = buildRow({
  'Survey_ID': 'SV_SYN_INFLIGHT_01',
  '_sourceType': 'des-qds',
  '_sourceId': 'SV_SYN_INFLIGHT_01',
  'Program_Type': 'Mid-Deployment Survey',
  'Sub Region': 'US Healthcare',
  'Deployment_ID': '001SYNHC0000001AA',
  'Account_Name': 'Synthetic Health Org',
  'Email Sent': '1',
  'Responsedate (+00:00 GMT)': ''
});

const outDir = __dirname;
const responsesCsv = [toCsvLine(HEADERS)].concat(rows.map(toCsvLine)).join('\n');
const crossFeedCsv = [toCsvLine(HEADERS), toCsvLine(inflightRow)].join('\n');

fs.writeFileSync(path.join(outDir, 'synthetic-qualtrics-responses.csv'), responsesCsv);
fs.writeFileSync(path.join(outDir, 'synthetic-inflight-crossfeed-288.csv'), crossFeedCsv);
console.log('Wrote synthetic-qualtrics-responses.csv rows=' + rows.length);
console.log('Wrote synthetic-inflight-crossfeed-288.csv');
