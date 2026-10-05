/**
 * Load GAS-style global scripts into Node for unit tests.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

const FILES = [
  'EdmJobTypes.js',
  'EdmJob.js',
  'EdmChecksum.js',
  'EdmDuplicateGuard.js',
  'EdmLocking.js',
  'EdmDriveFolders.js',
  'EdmAuditLedger.js',
  'qualtrics/QualtricsSchema.js',
  'qualtrics/QualtricsCsv.js',
  'qualtrics/QualtricsTransform.js',
  'qualtrics/QualtricsRoutingConfig.js',
  'qualtrics/QualtricsRoute.js',
  'qualtrics/QualtricsPipeline.js',
  'EdmOrchestrator.js'
];

/**
 * @return {Record<string, unknown>}
 */
function loadEdmGlobals() {
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    Error,
    RegExp,
    Logger: { log: () => {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: () => {
        throw new Error('Use EdmChecksum with Node shim');
      }
    }
  };

  vm.createContext(sandbox);
  for (const rel of FILES) {
    const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  sandbox.EdmChecksum.sha256Hex = function (text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  };
  return sandbox;
}

module.exports = { loadEdmGlobals, SRC };
