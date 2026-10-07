/**
 * SLG App configuration for CoreLib.
 *
 * Phase history:
 *   Phase 0 (v8): introduced cfg.ui block with header, tabs, table config, etc.
 *   Phase 1 (v9): tab labels harmonized to canonical Phase 1 forms.
 *   Phase 2 (v10): tab structure restructured (Deployments rename, Go Lives
 *                  consolidation, Manage Overrides added); personalization
 *                  enabled; new goLivesTab, manageOverrides blocks; deployments
 *                  table gains expandable rows and default Health filter preset.
 *   Phase 3a (v11): salesforce block added; SFDC_DeploymentProductFunctions
 *                   sheet registered; isPhased / upcomingDates enrichment
 *                   flows through CoreData → UI.
 *   Phase 3i:       SFDC_Deployments unified sheet registered; salesforce block
 *                   gains statusValues and recentWindowDays; getRecentGoLives()
 *                   supersedes legacy getGoLives() for the Recent Go Lives view.
 *
 * NOTE:
 *   - Assumes the Core library is added as "CoreLib" in Project → Libraries.
 *   - Reuses SLG's existing TABLES and BAR_CONFIG constants from Code.gs.
 *   - Phase 2 personalization requires AppUsers and DD Assignment sheets in
 *     the SLG Google Sheet (created manually by Jeff).
 */

/** @type {AppConfig} */
var APP_CONFIG = {
  appId: 'SLG',

  executiveWatch: {
  enabled: true
  },

  deploymentHealthPlan: {
    enabled: true,
    sheetName: 'SFDC_DHP',
    chipEnabled: true,
    expandedDetailsEnabled: true,
    metricsEnabled: false,
    issueCategoryDelimiter: ';'
  },

  deploymentSignal: {
    enabled: true,
    persistenceEnabled: true,
    trajectorySheetName: 'Deployment_Trajectory',
    actionHistorySheetName: 'SFDC_DHPActionHistory',
    healthEventsSheetName: 'Deployment_Trajectory_HealthEvents',
    mtpEventsSheetName: 'Deployment_Trajectory_MtpEvents',
    actionHistoryIndexSheetName: 'Deployment_Trajectory_ActionHistory_Index',
    productFunctionsSheetName: 'SFDC_DeploymentProductFunctions',
    productFunctionHistorySheetName: 'SFDC_DeploymentProductFunctionHistory',
    signalsSheetName: 'Deployment_Signals',
    signalHistorySheetName: 'Deployment_Signal_History',
    signalRunsSheetName: 'Deployment_Signal_Runs',
    schemaVersion: 2,
    signalRecordSchemaVersion: 'deployment-signal-v1',
    // Authoritative SFDC/source tabs whose successful connector refresh can change deterministic evidence.
    signalEvidenceSourceSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentHistory',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentProductFunctionHistory',
      'SFDC_DHP',
      'SFDC_DHPActionHistory'
    ]
  },

  deploymentIntelligence: {
    enabled: true,
    displayName: 'SLG Deployment Intelligence',
    sendNotBeforeHourLocal: 8
  },
  
  sheets: {
    activeDeployments:     'ActiveDeployments',
    goLives:               'Go Lives',
    deploymentOverrides:   'DeploymentOverrides',
    goLivesOverrides:      'GoLivesOverrides',
    deploymentsMeta:       'DeploymentsMeta',
    changeLog:             'ChangeLog',
    execSummary:           'ExecSummary',
    healthReportSnapshots: 'HealthReportSnapshots',
    healthMonthlySummary:  'HealthMonthlySummary',
    healthYtdSummary:      'HealthYtdSummary',
    dashboard:             'Dashboard',
    // Phase 2 sheets
    appUsers:              'AppUsers',
    ddAssignment:          'DD Assignment',
    // Phase 3a: Salesforce deployment product-function detail
    sfdcDeploymentProductFunctions: 'SFDC_DeploymentProductFunctions',
    // Phase 3i: unified deployment source (Active + Complete deployments)
    deployments: 'SFDC_Deployments',
    // MGM/PGL patch: contacts from SFDC
    deploymentContacts: 'SFDC_DeploymentContacts',
    // D1: Delivery Director from SFDC_Contacts
    sfdcContacts: 'SFDC_DeploymentContacts',
    // T1: Trends history sheet (populated by SOQL)
    deploymentHistory: 'SFDC_DeploymentHistory'
  },

  namedRanges: {
    healthTotal: 'HealthTotal'
  },

  columns: {
    DEPLOYMENT_ID:              1,
    DEPLOYMENT_NAME:            2,
    ACCOUNT_ID:                 3,
    ACCOUNT_NAME:               4,
    INDUSTRY:                   5,
    REGION:                     6,
    SUB_REGION:                 7,
    SUB_REGION_ALT:             8,
    BILLING_STATE:              9,
    BILLING_CITY:              10,
    DEPLOYMENT_START_DATE:     11,
    CURRENT_MTP_DATE:          12,
    FIRST_MTP_DATE:            13,
    OVERALL_STATUS:            14,
    DEPLOYMENT_PHASE:          15,
    DEPLOYMENT_STAGE:          16,
    DEPLOYMENT_HEALTH:         17,
    COMPLETION_DATE:           18,
    WD_ENG_MANAGER:            19,
    DAM_FULL_NAME:             20,
    PRIMING_PARTNER:           21,
    IMPL_PARTNER:              22,
    PARTNER:                   23,
    CURRENT_DEPLOYMENT_UPDATE: 24
  },

  report: {
    inlineFilename:  'SLG_DeploymentHealth_Dashboard.html',
    outlookFilename: 'SLG_DeploymentHealth_Dashboard_Outlook.html',

    title: 'State & Local Government Deployment Health Report',
    headerLogoUrl: 'https://cdn.brandfetch.io/id0V-YF4nE/w/2048/h/2048/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1761286530298',
    sanaLogoUrl:   'https://emoji.slack-edge.com/T7U335QS3/sana-labs/1746635f6808c56a.png',
    footerAttribution: 'Generated by the SLG Program Management team',

    tables:    TABLES,
    barConfig: BAR_CONFIG,

    goLivesWindowDays: 60,
    redYellowPartnerFilter: null,
    includeIndustryRedYellow: false,
    includeIndustryGoLives:   false,
    redYellowOwnerLabel: 'Delivery Director',

    portfolioHealth: {
      title: 'Portfolio Health',
      workdayPartner: 'Workday Professional Services',
      workdayLabel: 'Workday',
      otherLabel: 'Partners/Other',
      recentGoLivesWindowDays: 60,
      industryBuckets: [
        { label: 'SLG',               match: ['State & Local Government'] },
        { label: 'Special Districts', match: ['Special Districts'] }
      ]
    },

    sections: { approach: true },

    // N9 — monthly report distribution (Jeff fills these per app):
    // enabled:        true when ready to send from this app
    // to:             ['<app-google-group>@workday.com']   // the app's leadership distribution group
    // fromAlias:      '<verified send-as alias>'            // MUST be in this app's notify.allowedFromAliases and configured as a Gmail send-as alias for the executing user
    // cc:             []                                    // optional default CC
    // bcc:            'jeffrey.ditty@workday.com'           // BCC self by default
    // allowedSenders: ['jeffrey.ditty@workday.com']         // emails permitted to send
    distribution: {
      enabled: false,
      fromAlias: 'windsel.mccray@workday.com',
      fromName: 'Windsel McCray',
      to: [],
      cc: [],
      bcc: 'jeffrey.ditty@workday.com',
      allowedSenders: ['jeffrey.ditty@workday.com'],
      subjectTemplate: 'State & Local Government Deployment Status -  {{monthLabel}}',
      logSheet: 'ReportDistributionLog'
    }
  },

  // ---------------------------------------------------------------------------
  // Salesforce enrichment (Phase 3a). Consumed by CoreLib.CoreSalesforce.
  // Phase 3i: adds statusValues and recentWindowDays.
  // ---------------------------------------------------------------------------
  salesforce: {
    upcomingWindowDays: 90,
    // Phase 3i: window for recent go-lives (days back from today)
    recentWindowDays: 60,
    // Phase 3i: Overall_Status__c values used to split Active vs Complete rows
    statusValues: {
      active:   'Active',
      complete: 'Complete'
    }
  },

  // ---------------------------------------------------------------------------
  // UI configuration (Phase 2). Consumed by CoreLib.CoreUI.
  // ---------------------------------------------------------------------------
  ui: {
    appTitle:       'SLG Deployment Health Manager',
    headerTitle:    'SLG Deployment Health Manager',
    headerSubtitle: 'Review and manage deployment data across all stages',

    webApp: {
      baseUrl: 'https://script.google.com/a/macros/workday.com/s/AKfycby-jfATrWku_C29_Ia_q9pJMeBL0aoybzugY4gOhlf_Tcw_HH88wf3CbxwqhyBMJp4tEA',
      defaultEndpoint: 'exec'
    },

    // Phase 2 canonical tab structure. Note: 'upcoming' tab removed (merged
    // into 'golives'); 'overrides' tab added at end.
    // MGM/PGL tab added (feature/mgm-pgl).
    signalsTab: {
      enabled: true,
      label: 'Signals',
      insertAfter: 'deployments'
    },

    tabs: [
      { id: 'deployments', label: 'Deployments' },
      { id: 'golives',     label: 'Go Lives' },
      { id: 'execsummary', label: 'Executive Summary' },
      { id: 'report',      label: 'Monthly Report Preview' },
      { id: 'portfolio',   label: 'Portfolio Health' },
      { id: 'trends',      label: 'Trends' },
      { id: 'mgmPgl',      label: 'VoC' },
      { id: 'notable', label: 'Notable Deployments' },
      { id: 'overrides',   label: 'Manage Overrides' },
      
    ],

    // MGM / PGL tab configuration (feature/mgm-pgl).
    mgmPglTab: {
      enabled: true
    },
    // T1: Trends tab — v1 enabled for SLG pilot.
    trendsTab: { enabled: true, vNextEnabled: true, defaultWindow: '12m' },
    enableAccountLinks: true,
    deploymentsTable: {
      showIndustry: false,
      showEmColumn: false,
      ownerColumnLabel: 'Delivery Director',
      showMissingDDHighlight: true,
      missingDDMessage: 'Delivery Director needs assigned',
      searchPlaceholder: 'Search by account, deployment name, partner...',
      // Phase 2 additions
      defaultHealthFilter: ['Red', 'Yellow'],
      showStageColumn: false,
      expandableRows: true,
      // D1: use SFDC_Contacts as DD source (SLG V1 only)
      useDdFromContacts: true
    },

    // Phase 2: per-row visual config for the Go Lives table (preserves the
    // existing Phase 1 shape). Tab-level config lives in goLivesTab below.
    goLivesTable: {
      showIndustry: false,
      showProductAreas: true,
      showDeploymentName: false,
      searchPlaceholder: 'Search by account name...'
    },

    // Phase 2: consolidated Go Lives tab settings
    goLivesTab: {
      mode: 'explorer',
      defaultView: 'recent',
      recentWindowDays: 60,
      upcomingWindowDays: 90
    },
    manageOverrides: {
      showAuditTrail: true,
      bulkClearScopes: ['monthly', 'all']
    },

    editModal: {
      ownerFieldLabel: 'Delivery Director',
      ownerInputType: 'dropdown',
      ownerOptions: ['Steve Rogers', 'Roman Cortes', 'Lakshmi Visvanathan']
    },

    // Phase 2: personalization activated
    personalization: {
      enabled: true,
      defaultViewMode: 'myPortfolio',
      affectsTabs: ['deployments', 'golives', 'mgmPgl', 'overrides'],
      welcomeMessageEnabled: true,
      showFullPortfolioIndicator: true
    }
  },

  notable: {
    notify: {
      email:               'mariah.maxie@workday.com',
      testEmail:           'jeffrey.ditty@workday.com',
      useTestMode:         true,
      slackWebhookUrl:     '',
      slackWebhookUrlTest: ''
    }
  },

  notify: {
    allowedFromAliases: [
      'jeffrey.ditty@workday.com',
      'windsel.mccray@workday.com'
    ],
    ddDigest: {
      partnerFilterEnabled: true,
      partnerNames: ['Workday Professional Services']
    }
  },

  // ---------------------------------------------------------------------------
  // N4: Salesforce Connector data freshness monitoring.
  // ---------------------------------------------------------------------------
  freshness: {
    enabled: true,
    refreshCycleHours: 8,
    graceHours: 1,
    warningHours: 12,
    criticalHours: 24,
    logSheet: 'Auto Refresh Execution Log',
    expectedSheets: [
      'SFDC_Deployments',
      'SFDC_DeploymentProductFunctions',
      'SFDC_DeploymentContacts',
      'SFDC_DeploymentHistory'
    ],
    alertRecipient: 'jeffrey.ditty@workday.com'
  },

  // ---------------------------------------------------------------------------
  // T1: Trends tab configuration.
  // ---------------------------------------------------------------------------
  trends: {
    cacheTtlSeconds:              3600,
    trendsWindowMonths:           12,
    timeInStageOutlierMultiple:   2,
    timeInStageMinSampleSize:     10,
    byPartnerMinSampleSize:       5,
    vNextEnabled:                 true,
    defaultWindow:                '12m'
  },

  // ---------------------------------------------------------------------------
  // P2: Portfolio Momentum sub-view configuration.
  // ---------------------------------------------------------------------------
  /** @type {MomentumConfig} */
  momentum: {
    enabled: true,
    platforms: ['HCM', 'FIN', 'PAY'],
    productAreaMapping: {
      HCM: ['Core HCM', 'Human Capital Management'],
      FIN: ['Financials', 'Financial Management'],
      PAY: ['Payroll']
    },
    historicalYears: 5,  // was 6 — reduced to drop FY21 (incomplete SOQL data)
    chart: {
      colors: {
        HCM: '#0F4C81',
        FIN: '#F46821',
        PAY: '#47E6C1'
      },
      inProgressOpacity: 0.55
    }
  }
};

/**
 * Smoke test for Phase 3a CoreSalesforce module.
 * Runs against SLG's actual APP_CONFIG.
 */
function _test_phase3a_SLG() {
  var map = CoreLib.CoreSalesforce.getDeploymentEnrichmentMap(APP_CONFIG);
  Logger.log('Enrichment map size: ' + Object.keys(map).length);

  var phasedCount = 0;
  var sampleId = null;
  Object.keys(map).forEach(function(id) {
    if (map[id].isPhased) phasedCount++;
    if (!sampleId && map[id].isPhased) sampleId = id;
  });
  Logger.log('Phased count: ' + phasedCount);

  if (sampleId) {
    Logger.log('Sample phased deployment: ' + JSON.stringify(map[sampleId], null, 2));
  } else {
    Logger.log('No phased deployments found in this enrichment map.');
  }
}
