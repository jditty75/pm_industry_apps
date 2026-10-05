const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  loadEdmGlobalsInFileOrder,
  listAllEdmSrcJsFiles
} = require('./loadGasSrc');

/** @param {string[]} files */
function shuffleInPlace(files, seed) {
  let s = seed;
  for (let i = files.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = files[i];
    files[i] = files[j];
    files[j] = tmp;
  }
}

/**
 * @param {Record<string, unknown>} g
 */
function assertEdmNamespacesInitialized(g) {
  assert.ok(g.EdmJobTypes && g.EdmJobTypes.JobStatus);
  assert.ok(g.EdmJob);
  const job = g.EdmJob.createJob('qualtrics', { filename: 'x.csv', checksum: 'abc' });
  assert.equal(job.status, g.EdmJobTypes.JobStatus.RECEIVED);
  assert.ok(g.EdmAuditLedgerSheet);
  assert.ok(g.EdmAuditLedgerSheet.EXTENDED_HEADERS.length > g.EdmAuditLedger.LEDGER_HEADERS.length);
}

test('GAS filename order loads all src without top-level errors', () => {
  const gasOrder = listAllEdmSrcJsFiles();
  assert.ok(gasOrder.indexOf('EdmJob.js') < gasOrder.indexOf('EdmJobTypes.js'));
  const g = loadEdmGlobalsInFileOrder(gasOrder);
  assertEdmNamespacesInitialized(g);
});

test('EdmJob before EdmJobTypes (alphabetical GAS order) still initializes', () => {
  const g = loadEdmGlobalsInFileOrder(['EdmJob.js', 'EdmJobTypes.js']);
  assert.ok(g.EdmJobTypes && g.EdmJobTypes.JobStatus);
  const job = g.EdmJob.createJob('qualtrics', { filename: 'x.csv', checksum: 'abc' });
  assert.equal(job.status, g.EdmJobTypes.JobStatus.RECEIVED);
});

test('randomized load orders initialize EDM namespaces', () => {
  const all = listAllEdmSrcJsFiles();
  for (let seed = 1; seed <= 40; seed += 1) {
    const order = all.slice();
    shuffleInPlace(order, seed);
    const g = loadEdmGlobalsInFileOrder(order);
    assertEdmNamespacesInitialized(g);
  }
});

test('reverse full src order still initializes', () => {
  const order = listAllEdmSrcJsFiles().slice().reverse();
  const g = loadEdmGlobalsInFileOrder(order);
  assertEdmNamespacesInitialized(g);
});
