const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const vocSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'CoreCsatVoc.js'), 'utf8');
const sandbox = {
  CoreCsatVoc: null,
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const mm = m < 10 ? '0' + m : String(m);
      if (fmt === 'yyyy-MM') return y + '-' + mm;
      return y + '-' + mm + '-01';
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(vocSrc, sandbox);
const V = sandbox.CoreCsatVoc;

const hashFn = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

function baseRow(overrides) {
  return Object.assign({
    response_id: 'R_SYN_001',
    survey_type: 'MDS',
    response_ts_utc: '2026-01-15T12:00:00Z',
    deployment_id: '001DEP000000001AA',
    account_id: '001ACC000000001AA',
    account_name: 'Synthetic Account',
    deployment_name: 'Synthetic Deployment',
    respondent_role: 'Project Manager',
    overall_satisfaction: 4,
    aspect_methodology: 5,
    agree_sales_transition: 4,
    comment_reasons: 'Line one\n\nLine two',
    comment_improve: '',
    reasons_sentiment: 'Positive',
    reasons_parent_topics: 'Communication'
  }, overrides || {});
}

test('MDS detail includes comments and omits NPS', () => {
  const detail = V.buildResponseDetailDto(baseRow(), {});
  assert.equal(detail.surveyType, 'MDS');
  assert.equal(detail.npsScore, null);
  assert.ok(detail.sections.customerFeedback.length >= 1);
  assert.ok(detail.sections.customerFeedback[0].text.indexOf('Line one') >= 0);
  assert.ok(!detail.sections.customerFeedback.some((c) => c.question.indexOf('improve moving forward') < 0 && c.text === ''));
});

test('PGL detail includes NPS and additional comment only', () => {
  const detail = V.buildResponseDetailDto(baseRow({
    survey_type: 'PGL',
    nps_score: 9,
    pgl_satisfaction: 5,
    comment_additional: 'Thanks.',
    comment_improve: 'Should not show for PGL'
  }), {});
  assert.equal(detail.surveyType, 'PGL');
  const overviewNps = detail.sections.overview.filter((o) => String(o.question).indexOf('recommend') >= 0);
  assert.equal(overviewNps.length, 1);
  assert.equal(overviewNps[0].value, 9);
  const improveQ = detail.sections.customerFeedback.filter((c) => c.question.indexOf('improve moving forward') >= 0);
  assert.equal(improveQ.length, 0);
});

test('Executive business case hidden for non-ES when unanswered', () => {
  const detail = V.buildResponseDetailDto(baseRow({
    survey_type: 'PGL',
    respondent_role: 'Project Manager',
    agree_met_business_case: ''
  }), {});
  const bc = detail.sections.expectations.filter((e) => e.question.indexOf('business case') >= 0);
  assert.equal(bc.length, 0);
});

test('buildUpcomingBatchMonthKeys is forward-only', () => {
  const anchor = new Date(2026, 2, 7); // March 7, 2026 local
  const keys = V.buildUpcomingBatchMonthKeys(3, anchor, 'America/New_York');
  assert.equal(keys.length, 3);
  assert.equal(keys[0], '2026-03');
  assert.equal(keys[1], '2026-04');
  assert.equal(keys[2], '2026-05');
});
