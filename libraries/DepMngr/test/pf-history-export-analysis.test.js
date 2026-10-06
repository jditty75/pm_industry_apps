const { test } = require('node:test');
const assert = require('node:assert/strict');
const pf = require('../diagnostics/pfHistoryExportAnalysis');

test('classify target transitions', () => {
  assert.equal(pf.classifyTargetTransition('', '2026-01-01'), 'blank_to_date');
  assert.equal(pf.classifyTargetTransition('2026-01-01', '2026-02-01'), 'date_to_date');
  assert.equal(pf.classifyTargetTransition('2026-01-01', ''), 'date_to_blank');
  assert.equal(pf.isMeaningfulTargetMovement('', '2026-01-01'), false);
  assert.equal(pf.isMeaningfulTargetMovement('2026-01-01', '2026-02-01'), true);
});

test('analyze export aggregates matched and unresolved', () => {
  var pfRows = [{ Id: 'PF0000000000001AA' }];
  var idSet = pf.productFunctionIdSetFromExport(pfRows);
  var hist = [
    { ParentId: 'PF0000000000001', Field: pf.PF_TARGET, OldValue: '', NewValue: '2026-03-01' },
    { ParentId: 'PF0000000000001', Field: pf.PF_ACTUAL, OldValue: '', NewValue: '2026-04-01' },
    { ParentId: 'PF9999999999999', Field: pf.PF_TARGET, OldValue: '', NewValue: '2026-05-01' }
  ];
  var r = pf.analyzeProductFunctionHistoryExport(hist, idSet);
  assert.equal(r.matchedToCurrentProductFunctions, 2);
  assert.equal(r.unresolvedParentIds, 1);
  assert.equal(r.meaningfulTargetMovementsUnderCurrentRules, 0);
  assert.equal(r.targetTransitionCounts.blank_to_date, 1);
});
