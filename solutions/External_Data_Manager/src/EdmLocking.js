/**
 * Lock boundaries for concurrent Qualtrics / external-data jobs.
 * @namespace EdmLocking
 */
var EdmLocking = (function () {
  'use strict';

  var QUALTRICS_INGEST_LOCK_KEY = 'EDM_QUALTRICS_INGEST';

  /**
   * @param {string} lockKey
   * @param {Object} lockService LockService or test double
   * @param {number} [waitMs]
   * @return {{ acquired: boolean, lock?: Object, release?: function() }}
   */
  function tryAcquire(lockKey, lockService, waitMs) {
    var wait = waitMs == null ? 30000 : waitMs;
    var lock = lockService.getScriptLock();
    var acquired = lock.tryLock(wait);
    if (!acquired) {
      return { acquired: false };
    }
    return {
      acquired: true,
      lock: lock,
      release: function () {
        try {
          lock.releaseLock();
        } catch (e) {
          Logger.log('EdmLocking.tryAcquire: release failed: ' + e);
        }
      }
    };
  }

  return {
    QUALTRICS_INGEST_LOCK_KEY: QUALTRICS_INGEST_LOCK_KEY,
    tryAcquire: tryAcquire
  };
})();
