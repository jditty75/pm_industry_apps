/**
 * Qualtrics raw-export schema and normalized output contract.
 * Behavioral oracle: external Qualtrics.py (see test/oracle and docs).
 * @namespace QualtricsSchema
 */
var QualtricsSchema = (function () {
  'use strict';

  /** @type {string} */
  var ROW_GRAIN = 'latest_per_contact';

  /** @type {Object.<string, string>} */
  var COLMAP = {
    'Survey_ID': 'survey_id',
    'Program_Type': 'survey_type',
    'Sub Region': 'app',
    'Account_ID': 'account_id',
    'Account_Name': 'account_name',
    'Customer_Segment_[Persistent]': 'customer_segment',
    'First_name': 'first_name',
    'Last_name': 'last_name',
    'Email': 'contact_email',
    'Contact_ID': 'contact_id',
    'Deployment_Contact_Role': 'contact_role',
    'Deployment_ID': 'deployment_id',
    'Deployment_Name': 'deployment_name',
    'Deployment_Stage': 'deployment_stage',
    'Normalized Deployment Type': 'deployment_type',
    'Normalized Services Approach': 'services_approach',
    'Priming_Partner': 'priming_partner',
    'Partner Name': 'partner_name',
    'Engagement Manager Name': 'engagement_manager',
    'Deployment_Engagement_Manager_Email': 'engagement_manager_email',
    'Distribution Type': 'last_send_type',
    'Distribution Channel': 'channel',
    'expiration_date': 'survey_expires',
    'Email Sent': 'f_email_sent',
    'Email Opened': 'f_email_opened',
    'Email Bounced': 'f_email_bounced',
    'Survey Bounced': 'f_survey_bounced',
    'Survey Started': 'f_survey_started',
    'Survey Finished': 'f_survey_finished',
    'Survey Partial Recorded': 'f_survey_partial',
    'Email Sent Time (+00:00 GMT)': 'ts_email_sent',
    'Email Opened Time (+00:00 GMT)': 'ts_email_opened',
    'Survey Started Time (+00:00 GMT)': 'ts_survey_started',
    'Survey Finished Time (+00:00 GMT)': 'ts_survey_finished',
    'Recorded Date (+00:00 GMT)': 'ts_response_recorded',
    'Response ID': 'response_id',
    'Recipient ID': 'recipient_id',
    'Post_Go-Live_NPS': 'nps',
    'Overall Satisfaction': 'overall_satisfaction',
    '#PGL Satisfaction': 'pgl_satisfaction',
    '#MDS Satisfaction': 'mds_satisfaction'
  };

  /** @type {string[]} */
  var SOURCE_COLUMNS = Object.keys(COLMAP);

  /** @type {string[]} */
  var FLAG_COLS = [
    'f_email_sent', 'f_email_opened', 'f_email_bounced', 'f_survey_bounced',
    'f_survey_started', 'f_survey_finished', 'f_survey_partial'
  ];

  /** @type {string[]} */
  var TS_COLS = [
    'ts_email_sent', 'ts_email_opened', 'ts_survey_started',
    'ts_survey_finished', 'ts_response_recorded'
  ];

  /** @type {string[]} */
  var SCORE_COLS = ['nps', 'overall_satisfaction', 'pgl_satisfaction', 'mds_satisfaction'];

  /** @type {string[]} */
  var OUT_ORDER = [
    'app', 'survey_type', 'survey_id', 'account_id', 'account_name', 'customer_segment',
    'contact_id', 'full_name', 'first_name', 'last_name', 'contact_email', 'contact_role',
    'deployment_id', 'deployment_name', 'deployment_stage', 'deployment_type',
    'services_approach', 'priming_partner', 'partner_name',
    'engagement_manager', 'engagement_manager_email',
    'last_send_type', 'channel', 'survey_expires',
    'tracking_status', 'response_received', 'response_id', 'recipient_id',
    'ts_email_sent', 'ts_email_opened', 'ts_survey_started', 'ts_survey_finished',
    'ts_response_recorded',
    'nps', 'overall_satisfaction', 'pgl_satisfaction', 'mds_satisfaction'
  ];

  /** @type {Object.<string, boolean>} */
  var VALID_APPS = {
    'US Healthcare': true,
    'US SLED': true
  };

  /** Population labels after first-level routing (not DM app ids). */
  var POPULATION_HEALTHCARE = 'Healthcare';
  var POPULATION_SLED = 'SLED';

  return {
    ROW_GRAIN: ROW_GRAIN,
    COLMAP: COLMAP,
    SOURCE_COLUMNS: SOURCE_COLUMNS,
    FLAG_COLS: FLAG_COLS,
    TS_COLS: TS_COLS,
    SCORE_COLS: SCORE_COLS,
    OUT_ORDER: OUT_ORDER,
    VALID_APPS: VALID_APPS,
    POPULATION_HEALTHCARE: POPULATION_HEALTHCARE,
    POPULATION_SLED: POPULATION_SLED
  };
})();
