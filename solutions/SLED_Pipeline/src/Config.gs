/**
 * APP_CONFIG — Central configuration for SLED Pipeline Analysis.
 * Sheet names, column maps, UI tabs/labels, feature flags.
 * All consumers read from this object; never hardcode sheet names or headers elsewhere.
 */
var APP_CONFIG = {
  appId: 'sledPipeline',

  sheets: {
    sfdcOpps: 'SFDC_Opps'
  },

  /**
   * Column definitions keyed by logical name.
   * header: exact SFDC API header (matched case-insensitively at runtime).
   * optional: if true, missing column yields null instead of throwing.
   */
  columns: {
    id:                 { header: 'Id' },
    name:               { header: 'Name' },
    recordType:         { header: 'RecordType.Name' },
    stage:              { header: 'StageName' },
    amount:             { header: 'Amount' },
    fiscalPeriod:       { header: 'Fiscal_Period__c' },
    industry:           { header: 'Industry__c' },
    relatedServiceId:   { header: 'APTS_Related_Services_Opportunity__c' },
    // optional:
    ownerName:          { header: 'Owner.Name',                       optional: true },
    workdayServices:    { header: 'Workday_Services__c',              optional: true },
    probability:        { header: 'Probability',                      optional: true },
    createdDate:        { header: 'CreatedDate',                      optional: true },
    estProjectStart:    { header: 'Estimated_Project_Start_Date__c',  optional: true },
    deploymentApproach: { header: 'Deployment_Approach__c',           optional: true },
    deploymentPhase:    { header: 'Deployment_Phase__c',              optional: true },
    primaryPartner:     { header: 'Primary_Partner__c',               optional: true },
    psSubRegion:        { header: 'PS_Sub_Region__c',                 optional: true }
  },

  ui: {
    appTitle: 'SLED Pipeline Analysis',
    tabs: [
      { id: 'overview',    label: 'Overview' },
      { id: 'subServices', label: 'Subscription + Services' },
      { id: 'trends',      label: 'Trends' },
      { id: 'detail',      label: 'Opportunity Detail' }
    ]
  }
};
