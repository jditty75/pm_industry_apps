/**
 * CoreDeploymentSignalSchema.js
 *
 * deployment-signal-v1 workbook headers and schema constants (SLG persistence).
 */

var CoreDeploymentSignalSchema = {

  SIGNAL_SCHEMA_VERSION: 'deployment-signal-v1',
  NORMALIZATION_VERSION: 1,

  SIGNAL_STATUS_ACTIVE: 'ACTIVE',
  SIGNAL_STATUS_RESOLVED: 'RESOLVED',

  RUN_STATUS_COMPLETE: 'COMPLETE',
  RUN_STATUS_FAILED: 'FAILED',
  RUN_STATUS_IN_PROGRESS: 'IN_PROGRESS',

  /**
   * @return {Array<string>}
   */
  currentHeaders: function () {
    return [
      'schema_version',
      'signal_id',
      'deployment_id',
      'signal_run_id',
      'signal_as_of',
      'lifecycle_state',
      'attention',
      'signal_type',
      'observation',
      'interpretation',
      'why_it_matters',
      'leadership_question',
      'confidence',
      'evidence_limitations',
      'current_health',
      'stage',
      'signal_status',
      'context_ref',
      'source_reasoning_run_ref',
      'prior_signal_id',
      'normalization_version',
      'reasoning_prose_original',
      'first_active_at',
      'last_updated_at',
      'persisted_at'
    ];
  },

  /**
   * @return {Array<string>}
   */
  historyHeaders: function () {
    return CoreDeploymentSignalSchema.currentHeaders().concat([
      'history_event_at',
      'history_event_type'
    ]);
  },

  /**
   * @return {Array<string>}
   */
  runHeaders: function () {
    return [
      'signal_run_id',
      'signal_as_of',
      'started_at',
      'received_at',
      'persisted_at',
      'deployments_evaluated',
      'signals_proposed',
      'signals_persisted',
      'no_signal_count',
      'lifecycle_new_count',
      'lifecycle_continuing_count',
      'lifecycle_escalated_count',
      'lifecycle_de_escalated_count',
      'lifecycle_resolved_count',
      'run_status',
      'persistence_status',
      'context_schema_version',
      'signal_schema_version',
      'normalization_version',
      'agent_reference',
      'source_reasoning_run_ref',
      'error_message',
      'email_status'
    ];
  }
};
