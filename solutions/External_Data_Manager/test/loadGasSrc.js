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
  'EdmProperties.js',
  'EdmDestinationRegistry.js',
  'EdmDmConfigResolver.js',
  'EdmJob.js',
  'EdmChecksum.js',
  'EdmDuplicateGuard.js',
  'EdmLocking.js',
  'EdmDriveFolders.js',
  'EdmAuditLedger.js',
  'EdmAuditLedgerSheet.js',
  'EdmJobHistory.js',
  'EdmQualtricsDriveSetup.js',
  'EdmIngestAdapter.js',
  'qualtrics/QualtricsSchema.js',
  'qualtrics/QualtricsCsv.js',
  'qualtrics/QualtricsTransform.js',
  'qualtrics/QualtricsRoutingConfig.js',
  'qualtrics/QualtricsRoute.js',
  'qualtrics/QualtricsPipeline.js',
  'EdmOrchestrator.js',
  'EdmQualtricsProcessor.js',
  'EdmQualtricsInbox.js'
];

/**
 * All .js files under src/ (relative paths), sorted like typical GAS filename order.
 * @return {string[]}
 */
function listAllEdmSrcJsFiles() {
  /** @param {string} dir @return {string[]} */
  function walk(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) {
        out.push(...walk(full));
      } else if (name.isFile() && name.name.endsWith('.js')) {
        out.push(path.relative(SRC, full).split(path.sep).join('/'));
      }
    }
    return out;
  }
  return walk(SRC).sort((a, b) => {
    const baseCmp = path.basename(a).localeCompare(path.basename(b));
    if (baseCmp !== 0) {
      return baseCmp;
    }
    return a.localeCompare(b);
  });
}

/**
 * @return {Record<string, unknown>}
 */
function createEdmSandbox() {
  return {
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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {}
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: () => {
        throw new Error('Use EdmChecksum with Node shim');
      }
    }
  };
}

/**
 * Load EDM globals in an explicit file order (simulates Apps Script load order).
 * @param {string[]} relPaths relative paths under src/
 * @return {Record<string, unknown>}
 */
function loadEdmGlobalsInFileOrder(relPaths) {
  const sandbox = createEdmSandbox();
  vm.createContext(sandbox);
  for (const rel of relPaths) {
    const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  if (sandbox.EdmChecksum) {
    sandbox.EdmChecksum.sha256Hex = function (text) {
      return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    };
  }
  return sandbox;
}

/**
 * @return {Record<string, unknown>}
 */
function loadEdmGlobals() {
  return loadEdmGlobalsInFileOrder(FILES);
}

module.exports = {
  loadEdmGlobals,
  loadEdmGlobalsInFileOrder,
  listAllEdmSrcJsFiles,
  createEdmSandbox,
  FILES,
  SRC
};
