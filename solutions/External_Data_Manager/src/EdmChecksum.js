/**
 * Content checksum helpers (GAS Utilities.computeDigest in production).
 * @namespace EdmChecksum
 */
var EdmChecksum = (function () {
  'use strict';

  /**
   * @param {string} text UTF-8 text
   * @param {{ computeDigest?: function(string, string, string): number[] }} [deps]
   * @return {string} lowercase hex SHA-256
   */
  function sha256Hex(text, deps) {
    if (deps && deps.computeDigest) {
      var bytes = deps.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
      return bytes.map(function (b) {
        var h = (b < 0 ? b + 256 : b).toString(16);
        return h.length === 1 ? '0' + h : h;
      }).join('');
    }
    throw new Error('EdmChecksum.sha256Hex: no digest implementation (use Node test shim)');
  }

  return {
    sha256Hex: sha256Hex
  };
})();
