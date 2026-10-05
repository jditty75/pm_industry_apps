/**
 * Shared external-data job model (pipeline-agnostic).
 * @namespace EdmJobTypes
 */
var EdmJobTypes = (function () {
  'use strict';

  /** @enum {string} */
  var JobStatus = {
    RECEIVED: 'RECEIVED',
    VALIDATING: 'VALIDATING',
    TRANSFORMING: 'TRANSFORMING',
    ROUTING: 'ROUTING',
    READY_FOR_INGESTION: 'READY_FOR_INGESTION',
    INGESTING_HC: 'INGESTING_HC',
    INGESTING_SLG: 'INGESTING_SLG',
    INGESTING_HENP: 'INGESTING_HENP',
    VERIFYING: 'VERIFYING',
    SUCCESS: 'SUCCESS',
    PARTIAL_FAILURE: 'PARTIAL_FAILURE',
    FAILED: 'FAILED'
  };

  /**
   * @typedef {Object} EdmSourceMetadata
   * @property {string} pipelineId
   * @property {string} [filename]
   * @property {string} [checksum]
   * @property {string} [exportTimestamp] ISO-8601 when known
   * @property {number} [byteLength]
   */

  /**
   * @typedef {Object} EdmValidationResult
   * @property {boolean} ok
   * @property {string[]} [errors]
   * @property {string[]} [warnings]
   */

  /**
   * @typedef {Object} EdmTransformationResult
   * @property {boolean} ok
   * @property {Object} [payload]
   * @property {string} [error]
   */

  /**
   * @typedef {Object} EdmDestinationResult
   * @property {string} destinationId e.g. HC_DM
   * @property {string} status pending|success|failed|skipped
   * @property {number} [rowCount]
   * @property {string} [message]
   */

  /**
   * @typedef {Object} EdmJobRecord
   * @property {string} jobId
   * @property {string} pipelineId
   * @property {string} status
   * @property {EdmSourceMetadata} source
   * @property {string} createdAt
   * @property {string} [updatedAt]
   * @property {string} [transformerVersion]
   * @property {number} [sourceRowCount]
   * @property {number} [healthcareCount]
   * @property {number} [sledCount]
   * @property {EdmDestinationResult[]} [destinations]
   * @property {string} [errorCategory]
   * @property {string} [errorMessage]
   */

  return {
    JobStatus: JobStatus
  };
})();
