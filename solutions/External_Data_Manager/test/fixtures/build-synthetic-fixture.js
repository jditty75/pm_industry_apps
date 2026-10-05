/**
 * One-shot builder for synthetic-qualtrics.csv (run: node test/fixtures/build-synthetic-fixture.js)
 */
const fs = require('fs');
const path = require('path');

const COLS = [
  'Survey_ID', 'Program_Type', 'Sub Region', 'Account_ID', 'Account_Name',
  'Customer_Segment_[Persistent]', 'First_name', 'Last_name', 'Email', 'Contact_ID',
  'Deployment_Contact_Role', 'Deployment_ID', 'Deployment_Name', 'Deployment_Stage',
  'Normalized Deployment Type', 'Normalized Services Approach', 'Priming_Partner', 'Partner Name',
  'Engagement Manager Name', 'Deployment_Engagement_Manager_Email', 'Distribution Type',
  'Distribution Channel', 'expiration_date', 'Email Sent', 'Email Opened', 'Email Bounced',
  'Survey Bounced', 'Survey Started', 'Survey Finished', 'Survey Partial Recorded',
  'Email Sent Time (+00:00 GMT)', 'Email Opened Time (+00:00 GMT)',
  'Survey Started Time (+00:00 GMT)', 'Survey Finished Time (+00:00 GMT)',
  'Recorded Date (+00:00 GMT)', 'Response ID', 'Recipient ID', 'Post_Go-Live_NPS',
  'Overall Satisfaction', '#PGL Satisfaction', '#MDS Satisfaction'
];

function row(overrides) {
  const base = Object.fromEntries(COLS.map((c) => [c, '']));
  Object.assign(base, {
    'Program_Type': 'MDS',
    'Account_ID': 'ACC-EXAMPLE-001',
    'Account_Name': 'Test Health System',
    'Customer_Segment_[Persistent]': 'Example Segment',
    'Deployment_Contact_Role': 'Executive Sponsor',
    'Deployment_Stage': 'Active',
    'Normalized Deployment Type': 'Example Type',
    'Normalized Services Approach': 'Example Approach',
    'Priming_Partner': 'Example Partner',
    'Partner Name': 'Example County',
    'Engagement Manager Name': 'Alex Example',
    'Deployment_Engagement_Manager_Email': 'alex.example@example.com',
    'Distribution Type': 'Standard',
    'Distribution Channel': 'Email',
    'expiration_date': '2026-12-31',
    'Email Sent': '1'
  }, overrides);
  return COLS.map((c) => {
    const v = base[c] == null ? '' : String(base[c]);
    if (v.includes(',') || v.includes('"')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }).join(',');
}

const lines = [COLS.join(',')];

lines.push(row({
  'Survey_ID': 'SRV-HC-001',
  'Sub Region': 'US Healthcare',
  'First_name': 'Alex',
  'Last_name': 'Example',
  'Email': 'alex.example@example.com',
  'Contact_ID': 'CNT-HC-001',
  'Deployment_ID': 'DEP-HC-001',
  'Deployment_Name': 'Example HC Deployment',
  'Email Opened': '1',
  'Survey Started': '1',
  'Survey Finished': '1',
  'Email Sent Time (+00:00 GMT)': '2026-01-10 12:00:00',
  'Email Opened Time (+00:00 GMT)': '2026-01-10 13:00:00',
  'Survey Started Time (+00:00 GMT)': '2026-01-10 13:05:00',
  'Survey Finished Time (+00:00 GMT)': '2026-01-10 13:20:00',
  'Recorded Date (+00:00 GMT)': '2026-01-10 13:20:00',
  'Response ID': 'RSP-HC-001',
  'Recipient ID': 'RCP-HC-001',
  'Post_Go-Live_NPS': '9',
  'Overall Satisfaction': '5'
}));

lines.push(row({
  'Survey_ID': 'SRV-SLED-001',
  'Sub Region': 'US SLED',
  'Account_Name': 'Sample University',
  'First_name': 'Bella',
  'Last_name': 'Sample',
  'Email': 'bella.sample@example.com',
  'Contact_ID': 'CNT-SLED-001',
  'Deployment_ID': 'DEP-SLED-001',
  'Deployment_Name': 'Example SLED Deployment',
  'Email Sent Time (+00:00 GMT)': '2026-02-01 09:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-DUP',
  'Sub Region': 'US Healthcare',
  'First_name': 'Dup',
  'Last_name': 'Contact',
  'Email': 'dup.contact@example.com',
  'Contact_ID': 'CNT-DUP',
  'Deployment_ID': 'DEP-HC-DUP',
  'Deployment_Name': 'Dup HC Deployment',
  'Email Sent Time (+00:00 GMT)': '2026-03-01 08:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-DUP',
  'Sub Region': 'US Healthcare',
  'First_name': 'Dup',
  'Last_name': 'Contact',
  'Email': 'dup.contact@example.com',
  'Contact_ID': 'CNT-DUP',
  'Deployment_ID': 'DEP-HC-DUP',
  'Deployment_Name': 'Dup HC Deployment',
  'Survey Finished': '1',
  'Email Sent Time (+00:00 GMT)': '2026-03-05 08:00:00',
  'Survey Finished Time (+00:00 GMT)': '2026-03-05 09:00:00',
  'Response ID': 'RSP-DUP-WIN'
}));

lines.push(row({
  'Survey_ID': 'SRV-BOUNCE',
  'Sub Region': 'US SLED',
  'First_name': 'Bounce',
  'Last_name': 'Test',
  'Email': 'bounce.test@example.com',
  'Contact_ID': 'CNT-BOUNCE',
  'Deployment_ID': 'DEP-SLED-BOUNCE',
  'Deployment_Name': 'Bounce Deployment',
  'Email Bounced': '1',
  'Email Sent Time (+00:00 GMT)': '2026-04-01 10:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-PARTIAL',
  'Sub Region': 'US SLED',
  'First_name': 'Pat',
  'Last_name': 'Partial',
  'Email': 'pat.partial@example.com',
  'Contact_ID': 'CNT-PARTIAL',
  'Deployment_ID': 'DEP-SLED-PARTIAL',
  'Deployment_Name': 'Partial Deployment',
  'Survey Partial Recorded': '1',
  'Email Sent Time (+00:00 GMT)': '2026-04-02 10:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-STARTED',
  'Sub Region': 'US Healthcare',
  'First_name': 'Stu',
  'Last_name': 'Started',
  'Email': 'stu.started@example.com',
  'Contact_ID': 'CNT-STARTED',
  'Deployment_ID': 'DEP-HC-STARTED',
  'Deployment_Name': 'Started Deployment',
  'Survey Started': '1',
  'Email Sent Time (+00:00 GMT)': '2026-04-03 10:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-OPENED',
  'Sub Region': 'US Healthcare',
  'First_name': 'Opal',
  'Last_name': 'Opened',
  'Email': 'opal.opened@example.com',
  'Contact_ID': 'CNT-OPENED',
  'Deployment_ID': 'DEP-HC-OPENED',
  'Deployment_Name': 'Opened Deployment',
  'Email Opened': '1',
  'Email Sent Time (+00:00 GMT)': '2026-04-04 10:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-SENT',
  'Sub Region': 'US SLED',
  'First_name': 'Sam',
  'Last_name': 'Sent',
  'Email': 'sam.sent@example.com',
  'Contact_ID': 'CNT-SENT',
  'Deployment_ID': 'DEP-SLED-SENT',
  'Deployment_Name': 'Sent Deployment',
  'Email Sent Time (+00:00 GMT)': '2026-04-05 10:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-UNKNOWN',
  'Sub Region': 'US Healthcare',
  'First_name': 'Una',
  'Last_name': 'Known',
  'Email': 'una.known@example.com',
  'Contact_ID': 'CNT-UNKNOWN',
  'Deployment_ID': 'DEP-HC-UNKNOWN',
  'Deployment_Name': 'Unknown Deployment',
  'Email Sent': ''
}));

lines.push(row({
  'Survey_ID': 'SRV-BLANK-TS',
  'Sub Region': 'US SLED',
  'First_name': 'Blank',
  'Last_name': 'Timestamp',
  'Email': 'blank.ts@example.com',
  'Contact_ID': 'CNT-BLANK-TS',
  'Deployment_ID': 'DEP-SLED-BLANKTS',
  'Deployment_Name': 'Blank TS Deployment'
}));

lines.push(row({
  'Survey_ID': 'SRV-SCORES',
  'Sub Region': 'US Healthcare',
  'First_name': 'Score',
  'Last_name': 'Valid',
  'Email': 'score.valid@example.com',
  'Contact_ID': 'CNT-SCORES',
  'Deployment_ID': 'DEP-HC-SCORES',
  'Deployment_Name': 'Scores Deployment',
  'Email Sent Time (+00:00 GMT)': '2026-05-01 10:00:00',
  'Post_Go-Live_NPS': '10',
  '#MDS Satisfaction': '4.5'
}));

lines.push(row({
  'Survey_ID': 'SRV-BAD-SCORE',
  'Sub Region': 'US SLED',
  'First_name': 'Score',
  'Last_name': 'Invalid',
  'Email': 'score.invalid@example.com',
  'Contact_ID': 'CNT-BAD-SCORE',
  'Deployment_ID': 'DEP-SLED-BADSCORE',
  'Deployment_Name': 'Bad Score Deployment',
  'Email Sent Time (+00:00 GMT)': '2026-05-02 10:00:00',
  'Overall Satisfaction': 'not-a-number'
}));

lines.push(row({
  'Survey_ID': 'SRV-BLANK-NAME',
  'Sub Region': 'US Healthcare',
  'First_name': '',
  'Last_name': 'Example',
  'Email': 'blank.name@example.com',
  'Contact_ID': 'CNT-BLANK-NAME',
  'Deployment_ID': 'DEP-HC-BLANKNAME',
  'Deployment_Name': 'Blank Name Deployment',
  'Email Sent Time (+00:00 GMT)': '2026-05-03 10:00:00'
}));

lines.push(row({
  'Survey_ID': 'SRV-BAD-DATE',
  'Sub Region': 'US SLED',
  'First_name': 'Bad',
  'Last_name': 'Date',
  'Email': 'bad.date@example.com',
  'Contact_ID': 'CNT-BAD-DATE',
  'Deployment_ID': 'DEP-SLED-BADDATE',
  'Deployment_Name': 'Bad Date Deployment',
  'Email Sent Time (+00:00 GMT)': 'not-a-real-date'
}));

const outPath = path.join(__dirname, 'synthetic-qualtrics.csv');
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log('Wrote', outPath, 'rows', lines.length - 1);
