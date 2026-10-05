/**
 * Qualtrics Responses export contract (canonical csat-response-v1 source mapping).
 * @namespace QualtricsResponsesSchema
 */
var QualtricsResponsesSchema = (function () {
  'use strict';

  var EXPECTED_COLUMN_COUNT = 288;
  var CONTRACT_VERSION = 'csat-response-v1';
  var TRANSFORMER_VERSION = 'qualtrics-responses-v1';

  /**
   * Positional signature checks (index + exact header text).
   * @type {{ index: number, header: string }[]}
   */
  var POSITION_CHECKS = [
    { index: 0, header: 'Survey_ID' },
    { index: 14, header: 'Responsedate (+00:00 GMT)' },
    { index: 282, header: 'Product Area' },
    { index: 283, header: '_cachedDate (+00:00 GMT)' },
    { index: 285, header: '_sourceId' },
    { index: 287, header: '_sourceType' }
  ];

  /** Headers read with duplicate coalescing (first non-empty wins per row, scan left-to-right). */
  var CANONICAL_SOURCE_HEADERS = {
    response_id: { header: 'Survey_ID', occurrence: 0 },
    survey_id: { header: '_sourceId', occurrence: 0 },
    survey_type: { header: 'Program_Type', occurrence: 0 },
    response_ts_utc: { header: 'Responsedate (+00:00 GMT)', occurrence: 0 },
    deployment_id: { header: 'Deployment_ID', occurrence: 0 },
    deployment_name: { header: 'Deployment_Name', occurrence: 0 },
    account_id: { header: 'Account_ID', occurrence: 0 },
    account_name: { header: 'Account_Name', occurrence: 0 },
    sub_region: { header: 'Sub Region', occurrence: 0 },
    deployment_stage_at_response: { header: 'Deployment_Stage', occurrence: 0 },
    deployment_type: { header: 'Normalized Deployment Type', occurrence: 0 },
    services_approach: { header: 'Services_Approach', occurrence: 0 },
    priming_partner_type: { header: 'Priming_Partner', occurrence: 0 },
    partner_name: { header: 'Deployment_Partner_Name', occurrence: 0 },
    engagement_manager: { header: 'Deployment_Engagement_Manager', occurrence: 0 },
    deployment_start_date: { header: 'Deployment_Start_Date (+00:00 GMT)', occurrence: 0 },
    target_go_live_date: { header: 'Deployment_First_Target_MTP (+00:00 GMT)', occurrence: 0 },
    product_areas: { header: 'Product Area', occurrence: 0 },
    respondent_role: { header: 'Deployment_Contact_Role', occurrence: 0 },
    overall_satisfaction: { header: 'Overall Satisfaction', occurrence: 0 },
    pgl_satisfaction: { header: '#PGL Satisfaction', occurrence: 0 },
    mds_satisfaction: { header: '#MDS Satisfaction', occurrence: 0 },
    nps_score: { header: 'Post_Go-Live_NPS', occurrence: 0 },
    aspect_methodology: { header: 'Aspect Workday Methodology', occurrence: 0 },
    aspect_schedule: { header: 'Aspect Schedule Management', occurrence: 0 },
    aspect_communications: { header: 'Aspect Communications', occurrence: 0 },
    aspect_value: { header: 'Aspect Value Delivered', occurrence: 0 },
    team_understanding: { header: 'Team Understanding Business Needs', occurrence: 0 },
    team_collaboration: { header: 'Team Collaboration', occurrence: 0 },
    team_responsiveness: { header: 'Team Responsiveness', occurrence: 0 },
    team_technical_competence: { header: 'Team Technical Competence', occurrence: 0 },
    team_guidance: { header: 'Team Guidance', occurrence: 0 },
    agree_sales_expectations: { header: 'Agreement Set Appropriate Expectations in Sales', occurrence: 0 },
    agree_prepared_go_live: { header: 'Agreement Prepared to go live', occurrence: 0 },
    agree_met_business_case: { header: 'Agreement Met Objectives of Business Case', occurrence: 0 },
    agree_sales_transition: { header: 'Agreement Transition from Sales', occurrence: 0 },
    comment_reasons: { header: 'What_are_the_main_reasons_for_your_score?', occurrence: 0 },
    comment_improve: { header: 'What_could_we_improve_moving_forward?', occurrence: 0 },
    comment_working_well: { header: 'What_is_working_well_that_you_would_like_to_continue?', occurrence: 0 },
    comment_additional: { header: "Is there anything else you'd like to share with us?", occurrence: 0 },
    test_data_flag: { header: 'Test Data Flag', occurrence: 0 },
    export_watermark: { header: '_cachedDate (+00:00 GMT)', occurrence: 0 }
  };

  var SENTIMENT_BLOCKS = [
    {
      prefix: 'reasons',
      questionHeader: 'What_are_the_main_reasons_for_your_score?',
      sentimentHeader: 'What_are_the_main_reasons_for_your_score? - Sentiment',
      sentimentScoreHeader: 'What_are_the_main_reasons_for_your_score? - Sentiment Score',
      parentTopicsHeader: 'What_are_the_main_reasons_for_your_score? - Parent Topics'
    },
    {
      prefix: 'improve',
      questionHeader: 'What_could_we_improve_moving_forward?',
      sentimentHeader: 'What_could_we_improve_moving_forward? - Sentiment',
      sentimentScoreHeader: 'What_could_we_improve_moving_forward? - Sentiment Score',
      parentTopicsHeader: 'What_could_we_improve_moving_forward? - Parent Topics'
    },
    {
      prefix: 'working_well',
      questionHeader: 'What_is_working_well_that_you_would_like_to_continue?',
      sentimentHeader: 'What_is_working_well_that_you_would_like_to_continue? - Sentiment',
      sentimentScoreHeader: 'What_is_working_well_that_you_would_like_to_continue? - Sentiment Score',
      parentTopicsHeader: 'What_is_working_well_that_you_would_like_to_continue? - Parent Topics'
    },
    {
      prefix: 'additional',
      questionHeader: "Is there anything else you'd like to share with us?",
      sentimentHeader: "Is there anything else you'd like to share with us? - Sentiment",
      sentimentScoreHeader: "Is there anything else you'd like to share with us? - Sentiment Score",
      parentTopicsHeader: "Is there anything else you'd like to share with us? - Parent Topics"
    }
  ];

  return {
    EXPECTED_COLUMN_COUNT: EXPECTED_COLUMN_COUNT,
    CONTRACT_VERSION: CONTRACT_VERSION,
    TRANSFORMER_VERSION: TRANSFORMER_VERSION,
    POSITION_CHECKS: POSITION_CHECKS,
    CANONICAL_SOURCE_HEADERS: CANONICAL_SOURCE_HEADERS,
    SENTIMENT_BLOCKS: SENTIMENT_BLOCKS
  };
})();
