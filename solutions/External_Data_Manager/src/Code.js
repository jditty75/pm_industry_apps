/**
 * External Data Manager — entry points (V1A: no triggers, no Drive).
 */

/**
 * Manual test harness in Apps Script editor (V1A).
 * @param {string} [csvText] optional; when omitted returns usage string
 * @return {Object}
 */
function runQualtricsV1aHarness(csvText) {
  if (!csvText) {
    return {
      ok: false,
      message: 'Pass CSV text to runQualtricsV1aHarness(csvText). V1A does not read Drive.'
    };
  }
  try {
    var outcome = EdmOrchestrator.processQualtricsCsvJob(csvText, {
      filename: 'manual-harness.csv',
      skipDuplicateCheck: true,
      checksumFn: function (text) {
        return EdmChecksum.sha256Hex(text, { computeDigest: Utilities.computeDigest.bind(Utilities) });
      }
    });
    Logger.log('runQualtricsV1aHarness: status=' + outcome.job.status);
    return outcome;
  } catch (err) {
    Logger.log('runQualtricsV1aHarness: error ' + err);
    throw err;
  }
}
