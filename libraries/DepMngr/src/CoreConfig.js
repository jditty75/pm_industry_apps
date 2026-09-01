/**
 * CoreConfig.gs
 *
 * Shared configuration model for SLG, HENP, HC.
 *
 * Each app defines a global APP_CONFIG object that conforms to AppConfig,
 * then passes it into CoreLib modules (CoreData, CoreAnalytics, CoreReport,
 * CoreExecSummary, CoreUI, CoreUsers).
 *
 * Phase history:
 *   Phase 0 (v8): introduced cfg.ui block with all Phase 0/Phase 1 visual config.
 *   Phase 1 (v9): no schema additions — design tokens live entirely in CoreUI_Css.
 *   Phase 2 (v10): adds cfg.ui.goLivesTab, cfg.ui.manageOverrides, expands
 *                  cfg.ui.personalization and cfg.ui.deploymentsTable.
 *   Phase 3a (v11): adds cfg.sheets.sfdcDeploymentProductFunctions and
 *                   cfg.salesforce block (upcomingWindowDays).
 *   Phase 3i:       adds cfg.sheets.deployments (SFDC_Deployments unified source),
 *                   cfg.salesforce.recentWindowDays, cfg.salesforce.statusValues.
 */

/**
 * @typedef {Object} AppSheetsConfig
 * @property {string} activeDeployments
 * @property {string} goLives
 * @property {string} deploymentOverrides
 * @property {string} goLivesOverrides
 * @property {string} deploymentsMeta
 * @property {string} changeLog
 * @property {string} execSummary
 * @property {string} healthReportSnapshots
 * @property {string} healthMonthlySummary
 * @property {string} healthYtdSummary
 * @property {string} dashboard
 * @property {string} appUsers                          Phase 2: "AppUsers"
 * @property {string} ddAssignment                      Phase 2: "DD Assignment"
 * @property {string} sfdcDeploymentProductFunctions    Phase 3a: "SFDC_DeploymentProductFunctions"
 * @property {string} deployments                       Phase 3i: "SFDC_Deployments" (Active + Complete)
 * @property {string} deploymentContacts                MGM/PGL patch: "SFDC_DeploymentContacts"
 * @property {string} [sfdcContacts]                    D1: "SFDC_DeploymentContacts" (SLG only; absent = D1 no-op)
 */

/**
 * @typedef {Object} StudentConfig  S1
 * @property {boolean}  enabled           true activates all Student behavior; absent = off
 * @property {string}   productAreaMatch  Exact Product_Area__c value (e.g. 'Student')
 * @property {{ studentData: string }}   sheets
 * @property {{ id: string, label: string, insertAfter: string }} tab
 * @property {{ defaultStatusFilter: string, defaultHealthFilter: ?string,
 *              columns: Array<string>, searchPlaceholder: string,
 *              expandableRows: boolean }} table
 * @property {{ allowedRoles: Array<string>, notesMaxChars: number }} editModal
 * @property {{ enabled: boolean, copy: string, showOnTabs: Array<string>,
 *              linkToken: string }} banner
 * @property {{ enabled: boolean, copy: string }} reportDisclosure
 */

/**
 * @typedef {Object} SalesforceConfig  (Phase 3a, extended in Phase 3i)
 * @property {number} upcomingWindowDays  Days ahead to consider for upcoming go-live dates.
 * @property {number} recentWindowDays    Phase 3i: Days back to consider for recent go-live dates.
 * @property {{ active: string, complete: string }} statusValues  Phase 3i: Overall_Status__c values.
 */

// (Other typedefs unchanged from Phase 1 — kept inline below for completeness.)

/**
 * @typedef {Object} AppNamedRangesConfig
 * @property {string} healthTotal
 */

/**
 * @typedef {Object} DeploymentColsConfig
 * @property {number} ACCOUNT_NAME
 * @property {number} DEPLOYMENT_NAME
 * @property {number} SERVICES_APPROACH
 * @property {number} INDUSTRY
 * @property {number} SUB_REGION
 * @property {number} PARTNER
 * @property {number} DEPLOYMENT_STAGE
 * @property {number} DEPLOYMENT_HEALTH
 * @property {number} CURRENT_MTP_DATE
 * @property {number} PROF_SERVICES_LOCS
 * @property {number} PROF_SERVICES_DETAILS
 * @property {number} DAM_FULL_NAME
 * @property {number} WD_ENG_MANAGER
 * @property {number} CURRENT_DEPLOYMENT_UPDATE
 * @property {number} DEPLOYMENT_ID
 */

/**
 * @typedef {Object} GoLivesColsConfig
 * @property {number} ACCOUNT_NAME
 * @property {number} INDUSTRY
 * @property {number} DAM_FULL_NAME
 * @property {number} WD_ENG_MANAGER
 * @property {number} PARTNER
 * @property {number} DEPLOYMENT_NAME
 * @property {number} SERVICES_APPROACH
 * @property {number} PRODUCT_AREA
 * @property {number} GO_LIVE_DATE_ACTUAL
 * @property {number} IN_PRODUCTION
 */

/**
 * @typedef {Object} ColumnsConfig
 * @property {DeploymentColsConfig} deployments
 * @property {GoLivesColsConfig}    goLives
 */

/**
 * @typedef {Object} ReportConfig
 * @property {string}  inlineFilename
 * @property {string}  outlookFilename
 * @property {string}  v2ExportFilename
 * @property {string}  title
 * @property {string}  headerLogoUrl
 * @property {string}  sanaLogoUrl
 * @property {string}  footerAttribution
 * @property {Array<Object>} tables
 * @property {Object}  barConfig
 * @property {number|null} goLivesWindowDays
 * @property {number} recentWindowDays       V2.6: report-only recent go-live window (default 30).
 * @property {number} upcomingWindowDays     V2.6: report-only upcoming go-live window (default 60).
 * @property {string|null} redYellowPartnerFilter
 * @property {boolean} includeIndustryRedYellow
 * @property {boolean} includeIndustryGoLives
 * @property {Object}  portfolioHealth
 */

/**
 * @typedef {Object} MomentumChartConfig
 * @property {Object<string,string>} colors            Platform code → hex color.
 * @property {number}                inProgressOpacity 0–1 opacity for current-FY bars (default 0.55).
 */

/**
 * @typedef {Object} TrendsConfig   T1
 * @property {number} cacheTtlSeconds              CacheService TTL for Trends metrics. Default 3600.
 * @property {number} trendsWindowMonths           Rolling window for benchmarks. Default 12.
 * @property {number} timeInStageOutlierMultiple   Multiplier for outlier detection. Default 2.
 * @property {number} timeInStageMinSampleSize     Min sample size for outlier flags. Default 10.
 * @property {number} byPartnerMinSampleSize       Min sample size for by-partner rollups. Default 5.
 */

/**
 * @typedef {Object} MomentumProductFilterConfig
 * Product-scope filter for EVI/AI momentum mode.
 * @property {string|Array<string>} Product_Area__c   Exact Product_Area__c match(es).
 * @property {string|Array<string>} Deployment_Name   SQL-like patterns (% wildcards).
 */

/**
 * @typedef {Object} MomentumKpiLabelsConfig
 * @property {string} label1  Total go-lives tile label ({FY} token supported).
 * @property {string} label2  Distinct accounts tile label ({FY} token supported).
 * @property {string} label3  Avg annual growth tile label.
 * @property {string} label4  Fastest-growing tile label.
 */

/**
 * @typedef {Object} MomentumConfig
 * P2: Portfolio Momentum sub-view config.
 *
 * Platform mode (HC/SLG/HENP): platforms + productAreaMapping.
 * Product mode (EVI/AI): productFilter + chartLegend + kpiLabels.
 *
 * @property {boolean}                      enabled             Set true to show the Momentum sub-view.
 * @property {Array<string>}                platforms           Platform codes, e.g. ['HCM','FIN','PAY'].
 * @property {Object<string,Array>}         productAreaMapping  Code → array of Product_Area__c values.
 * @property {MomentumProductFilterConfig}  productFilter       EVI/AI product scope filter.
 * @property {string}                       dataSource          SFDC object key, e.g. Deployment_Product_Function__c.
 * @property {MomentumKpiLabelsConfig}      kpiLabels           Custom KPI tile labels.
 * @property {Array<string>}                chartLegend         Chart legend series labels.
 * @property {string|number}                timeRange           e.g. "LAST_N_YEARS:5" or numeric years.
 * @property {string}                       growthMetricSeries  Series code for KPI 3 in platform mode.
 * @property {number}                       historicalYears     FYs of history (fallback when timeRange unset).
 * @property {MomentumChartConfig}          chart               Chart appearance config.
 */

/**
 * @typedef {Object} UITabConfig
 * @property {string} id     // 'deployments' | 'golives' | 'execsummary' | 'report' | 'portfolio' | 'overrides'
 * @property {string} label  // user-facing tab label
 */

/**
 * @typedef {Object} UIDeploymentsTableConfig
 * @property {boolean} showIndustry
 * @property {boolean} showEmColumn
 * @property {string}  ownerColumnLabel
 * @property {boolean} showMissingDDHighlight
 * @property {string}  missingDDMessage
 * @property {string}  searchPlaceholder
 * @property {Array<string>} defaultHealthFilter  Phase 2: e.g. ['Red','Yellow']
 * @property {boolean} showStageColumn            Phase 2
 * @property {boolean} expandableRows             Phase 2
 */

/**
 * @typedef {Object} UIGoLivesTableConfig
 * @property {boolean} showIndustry
 * @property {boolean} showProductAreas
 * @property {boolean} showDeploymentName
 * @property {string}  searchPlaceholder
 */

/**
 * @typedef {Object} UIGoLivesTabConfig  (Phase 2)
 * @property {string} defaultView          'recent' | 'upcoming' | 'all'
 * @property {number} recentWindowDays
 * @property {number} upcomingWindowDays
 */

/**
 * @typedef {Object} UIManageOverridesConfig  (Phase 2)
 * @property {boolean}        showAuditTrail
 * @property {Array<string>}  bulkClearScopes
 */

/**
 * @typedef {Object} UIEditModalConfig
 * @property {string}        ownerFieldLabel
 * @property {('dropdown'|'datalist'|'text')} ownerInputType
 * @property {Array<string>} ownerOptions
 */

/**
 * @typedef {Object} UIPersonalizationConfig
 * @property {boolean}       enabled
 * @property {string}        defaultViewMode               'myPortfolio' | 'allDeployments'
 * @property {Array<string>} affectsTabs                   Phase 2: ['deployments','golives','overrides']
 * @property {boolean}       welcomeMessageEnabled
 * @property {boolean}       showFullPortfolioIndicator
 */

/**
 * @typedef {Object} UIConfig
 * @property {string}                    appTitle
 * @property {string}                    headerTitle
 * @property {string}                    headerSubtitle
 * @property {Array<UITabConfig>}        tabs
 * @property {UIDeploymentsTableConfig}  deploymentsTable
 * @property {UIGoLivesTableConfig}      goLivesTable
 * @property {UIGoLivesTabConfig}        [goLivesTab]      Phase 2
 * @property {UIManageOverridesConfig}   [manageOverrides] Phase 2
 * @property {UIEditModalConfig}         editModal
 * @property {UIPersonalizationConfig}   personalization
 */

/**
 * @typedef {Object} AppConfig
 * @property {string}                appId
 * @property {AppSheetsConfig}       sheets
 * @property {AppNamedRangesConfig}  namedRanges
 * @property {ColumnsConfig}         columns
 * @property {ReportConfig}          report
 * @property {SalesforceConfig}      [salesforce]  Phase 3a
 * @property {UIConfig}              [ui]
 * @property {StudentConfig}         [student]     S1: HENP Student tab. Absent = off (SLG/HC safety guarantee).
 */

var CoreConfig = (function () {

  function withDefaults(appConfig) {
    if (!appConfig) {
      throw new Error('CoreConfig.withDefaults: appConfig is required');
    }

    var cfg = JSON.parse(JSON.stringify(appConfig));

    // -------------------------------------------------------------------------
    // Sheets
    // -------------------------------------------------------------------------
    cfg.sheets = cfg.sheets || {};
    if (!cfg.sheets.deploymentOverrides)   cfg.sheets.deploymentOverrides   = 'DeploymentOverrides';
    if (!cfg.sheets.goLivesOverrides)      cfg.sheets.goLivesOverrides      = 'GoLivesOverrides';
    if (!cfg.sheets.deploymentsMeta)       cfg.sheets.deploymentsMeta       = 'DeploymentsMeta';
    if (!cfg.sheets.execSummary)           cfg.sheets.execSummary           = 'ExecSummary';
    if (!cfg.sheets.healthReportSnapshots) cfg.sheets.healthReportSnapshots = 'HealthReportSnapshots';
    if (!cfg.sheets.dashboard)             cfg.sheets.dashboard             = 'Dashboard';
    if (!cfg.sheets.appUsers)              cfg.sheets.appUsers              = 'AppUsers';
    if (!cfg.sheets.ddAssignment)          cfg.sheets.ddAssignment          = 'DD Assignment';
    // Phase 3a
    if (!cfg.sheets.sfdcDeploymentProductFunctions)
      cfg.sheets.sfdcDeploymentProductFunctions = 'SFDC_DeploymentProductFunctions';
    // Phase 3i: unified deployment source (Active + Complete)
    if (!cfg.sheets.deployments)
      cfg.sheets.deployments = 'SFDC_Deployments';
    // MGM/PGL patch: contacts sheet
    if (!cfg.sheets.deploymentContacts)
      cfg.sheets.deploymentContacts = 'SFDC_DeploymentContacts';
    if (!cfg.sheets.wellness)
      cfg.sheets.wellness = 'SFDC_Wellness';
    if (!cfg.sheets.csatInFlight)
      cfg.sheets.csatInFlight = 'CSAT_InFlight';

    // -------------------------------------------------------------------------
    // Salesforce (Phase 3a, extended Phase 3i)
    // -------------------------------------------------------------------------
    cfg.salesforce = cfg.salesforce || {};
    if (cfg.salesforce.upcomingWindowDays === undefined || cfg.salesforce.upcomingWindowDays === null)
      cfg.salesforce.upcomingWindowDays = 90;
    // Phase 3i additions
    if (cfg.salesforce.recentWindowDays === undefined || cfg.salesforce.recentWindowDays === null)
      cfg.salesforce.recentWindowDays = 60;
    if (!cfg.salesforce.statusValues || typeof cfg.salesforce.statusValues !== 'object') {
      cfg.salesforce.statusValues = { active: 'Active', complete: 'Complete' };
    } else {
      if (!cfg.salesforce.statusValues.active)   cfg.salesforce.statusValues.active   = 'Active';
      if (!cfg.salesforce.statusValues.complete) cfg.salesforce.statusValues.complete = 'Complete';
    }

    // -------------------------------------------------------------------------
    // Named ranges
    // -------------------------------------------------------------------------
    cfg.namedRanges = cfg.namedRanges || {};
    if (!cfg.namedRanges.healthTotal) cfg.namedRanges.healthTotal = 'HealthTotal';

    // -------------------------------------------------------------------------
    // Columns
    // -------------------------------------------------------------------------
    cfg.columns = cfg.columns || {};
    cfg.columns.deployments = cfg.columns.deployments || {
      ACCOUNT_NAME: 1, DEPLOYMENT_NAME: 2, SERVICES_APPROACH: 3, INDUSTRY: 4,
      SUB_REGION: 5,   PARTNER: 6,         DEPLOYMENT_STAGE: 7, DEPLOYMENT_HEALTH: 8,
      CURRENT_MTP_DATE: 9, PROF_SERVICES_LOCS: 10, PROF_SERVICES_DETAILS: 11,
      DAM_FULL_NAME: 12, WD_ENG_MANAGER: 13, CURRENT_DEPLOYMENT_UPDATE: 14,
      DEPLOYMENT_ID: 15
    };
    cfg.columns.goLives = cfg.columns.goLives || {
      ACCOUNT_NAME: 1, INDUSTRY: 2, DAM_FULL_NAME: 3, WD_ENG_MANAGER: 4,
      PARTNER: 5, DEPLOYMENT_NAME: 6, SERVICES_APPROACH: 7, PRODUCT_AREA: 8,
      GO_LIVE_DATE_ACTUAL: 9, IN_PRODUCTION: 10
    };

    // -------------------------------------------------------------------------
    // Overview tab
    // -------------------------------------------------------------------------
    cfg.overviewTab = cfg.overviewTab || {};
    if (cfg.overviewTab.enabled === undefined)              cfg.overviewTab.enabled             = true;
    if (cfg.overviewTab.topRedCount === undefined)          cfg.overviewTab.topRedCount         = 5;
    if (cfg.overviewTab.upcomingGoLiveDays === undefined)   cfg.overviewTab.upcomingGoLiveDays  = 30;
    if (cfg.overviewTab.recentGoLiveDays === undefined)     cfg.overviewTab.recentGoLiveDays    = 30;

    // -------------------------------------------------------------------------
    // Report
    // -------------------------------------------------------------------------
    cfg.report = cfg.report || {};
    if (!cfg.report.v2ExportFilename)
      cfg.report.v2ExportFilename = (cfg.appId || 'App') + '_DeploymentHealth_Report_V2.html';
    if (cfg.report.goLivesWindowDays === undefined)        cfg.report.goLivesWindowDays = 30;
    if (cfg.report.recentWindowDays === undefined)         cfg.report.recentWindowDays = 30;
    if (cfg.report.upcomingWindowDays === undefined)       cfg.report.upcomingWindowDays = 60;
    if (cfg.report.redYellowPartnerFilter === undefined)   cfg.report.redYellowPartnerFilter = null;
    if (cfg.report.includeIndustryRedYellow === undefined) cfg.report.includeIndustryRedYellow = false;
    if (cfg.report.includeIndustryGoLives === undefined)   cfg.report.includeIndustryGoLives = false;
    if (cfg.report.redYellowOwnerLabel === undefined)      cfg.report.redYellowOwnerLabel = 'Owner';

    // Phase 3b: disclaimer text shown below code-computed breakdown tables when
    // data is incomplete. Apps may override these strings in their APP_CONFIG.
    cfg.report.disclaimers = cfg.report.disclaimers || {};
    var _defaultDisclaimer = 'Counts reflect available data. Deployments that are onboarding ' +
      'or have incomplete data may impact totals.';
    if (!cfg.report.disclaimers.healthBreakdown)
      cfg.report.disclaimers.healthBreakdown  = _defaultDisclaimer;
    if (!cfg.report.disclaimers.partnerBreakdown)
      cfg.report.disclaimers.partnerBreakdown = _defaultDisclaimer;
    if (!cfg.report.disclaimers.approachBreakdown)
      cfg.report.disclaimers.approachBreakdown = _defaultDisclaimer;

    cfg.report.portfolioHealth = cfg.report.portfolioHealth || {};
    if (!cfg.report.portfolioHealth.title)
      cfg.report.portfolioHealth.title = 'Portfolio Health';
    if (!cfg.report.portfolioHealth.workdayPartner)
      cfg.report.portfolioHealth.workdayPartner = 'Workday Professional Services';
    if (!cfg.report.portfolioHealth.workdayLabel)
      cfg.report.portfolioHealth.workdayLabel = 'Workday';
    if (!cfg.report.portfolioHealth.otherLabel)
      cfg.report.portfolioHealth.otherLabel = 'Partners/Other';
    if (!cfg.report.portfolioHealth.industryMode)
      cfg.report.portfolioHealth.industryMode = 'bucketed';
    if (!cfg.report.portfolioHealth.industryDisplayMode)
      cfg.report.portfolioHealth.industryDisplayMode = 'bucketed';
    if (
      cfg.report.portfolioHealth.industryTopN === undefined ||
      cfg.report.portfolioHealth.industryTopN === null
    ) {
      cfg.report.portfolioHealth.industryTopN = 10;
    }
    if (!Array.isArray(cfg.report.portfolioHealth.industryBuckets))
      cfg.report.portfolioHealth.industryBuckets = [];
    if (cfg.report.portfolioHealth.recentGoLivesWindowDays === undefined)
      cfg.report.portfolioHealth.recentGoLivesWindowDays = cfg.report.goLivesWindowDays || 60;
    if (cfg.report.portfolioHealth.historyWindowMonths === undefined)
      cfg.report.portfolioHealth.historyWindowMonths = 6;
    if (cfg.report.portfolioHealth.slideExportEnabled === undefined)
      cfg.report.portfolioHealth.slideExportEnabled = true;

    // N8: V2 report sections + native Gmail distribution defaults.
    cfg.report.sections = cfg.report.sections || {};
    if (cfg.report.sections.approach === undefined)
      cfg.report.sections.approach = true;

    cfg.report.distribution = cfg.report.distribution || {};
    if (cfg.report.distribution.enabled === undefined)
      cfg.report.distribution.enabled = false;
    if (cfg.report.distribution.fromAlias === undefined)
      cfg.report.distribution.fromAlias = '';
    if (!Array.isArray(cfg.report.distribution.to))
      cfg.report.distribution.to = [];
    if (!Array.isArray(cfg.report.distribution.cc))
      cfg.report.distribution.cc = [];
    if (typeof cfg.report.distribution.bcc === 'undefined')
      cfg.report.distribution.bcc = '';
    if (!Array.isArray(cfg.report.distribution.allowedSenders)) {
      cfg.report.distribution.allowedSenders = ['jeffrey.ditty@workday.com'];
    }
    if (!cfg.report.distribution.subjectTemplate) {
      cfg.report.distribution.subjectTemplate =
        '{{appTitle}} \u2014 Monthly Deployment Health Report \u2014 {{monthLabel}}';
    }
    if (!cfg.report.distribution.logSheet)
      cfg.report.distribution.logSheet = 'ReportDistributionLog';

    // V2 monthly report product scope (no-op unless enabled in app config).
    cfg.report.productScope = cfg.report.productScope || {};
    cfg.report.productScope.enabled = cfg.report.productScope.enabled === true;
    if (!Array.isArray(cfg.report.productScope.includeAreas))
      cfg.report.productScope.includeAreas = [];
    if (!Array.isArray(cfg.report.productScope.nameTokens))
      cfg.report.productScope.nameTokens = [];
    if (typeof cfg.report.productScope.aliases !== 'object' || cfg.report.productScope.aliases === null)
      cfg.report.productScope.aliases = {};

    // -------------------------------------------------------------------------
    // Data freshness (N4)
    // -------------------------------------------------------------------------
    cfg.freshness = cfg.freshness || {};
    if (cfg.freshness.enabled === undefined) cfg.freshness.enabled = true;
    if (cfg.freshness.refreshCycleHours === undefined) cfg.freshness.refreshCycleHours = 8;
    if (cfg.freshness.graceHours === undefined) cfg.freshness.graceHours = 1;
    if (cfg.freshness.amberHours === undefined) cfg.freshness.amberHours = null; // null = derive
    if (cfg.freshness.redHours === undefined) cfg.freshness.redHours = null;
    if (cfg.freshness.alertHours === undefined) cfg.freshness.alertHours = null;
    if (!cfg.freshness.watchSheet) cfg.freshness.watchSheet = 'SFDC_Deployments';
    if (!cfg.freshness.alertRecipient) cfg.freshness.alertRecipient = 'jeffrey.ditty@workday.com';
    if (!cfg.freshness.logSheet) cfg.freshness.logSheet = 'Auto Refresh Execution Log';
    if (cfg.freshness.warningHours === undefined || cfg.freshness.warningHours === null) {
      cfg.freshness.warningHours = 12;
    }
    if (cfg.freshness.criticalHours === undefined || cfg.freshness.criticalHours === null) {
      cfg.freshness.criticalHours = 24;
    }
    if (!Array.isArray(cfg.freshness.expectedSheets)) {
      cfg.freshness.expectedSheets = [];
    }

    // -------------------------------------------------------------------------
    // MDS/PGL notifications (N7)
    // -------------------------------------------------------------------------
    cfg.notify = cfg.notify || {};
    if (cfg.notify.enabled === undefined) cfg.notify.enabled = true;
    if (!cfg.notify.configSheet) cfg.notify.configSheet = 'NotificationConfig';
    if (!cfg.notify.testDefaultRecipient)
      cfg.notify.testDefaultRecipient = 'jeffrey.ditty@workday.com';
    if (!Array.isArray(cfg.notify.allowedFromAliases)) {
      cfg.notify.allowedFromAliases = ['jeffrey.ditty@workday.com'];
    }
    if (typeof cfg.notify.fromAliasNames !== 'object' || cfg.notify.fromAliasNames === null) {
      cfg.notify.fromAliasNames = {};
    }

    // -------------------------------------------------------------------------
    // Notable (Part 1)
    // -------------------------------------------------------------------------
    cfg.notable = cfg.notable || {};
    if (!cfg.notable.sheetId)
      cfg.notable.sheetId = '1iZJgKhqGIli-n93hCDRxM2v5Yzwfzn0_3e2FI8HuKjQ';
    if (!cfg.notable.tabName)
      cfg.notable.tabName = 'FY27 MASTER_Curated';
    if (cfg.notable.headerRow === undefined || cfg.notable.headerRow === null)
      cfg.notable.headerRow = 4;
    if (cfg.notable.dataStartRow === undefined || cfg.notable.dataStartRow === null)
      cfg.notable.dataStartRow = 5;
    if (!cfg.notable.deploymentIdHeader)
      cfg.notable.deploymentIdHeader = 'Deployment ID';
    if (!Array.isArray(cfg.notable.editableColumnHeaders)) {
      cfg.notable.editableColumnHeaders = [
        'Data Validation Status',
        'Latest Update',
        'Regional Owner or Delegate',
        'Notability Trigger',
        'Fit-for-Purpose',
        'Scope (Human Summary)',
        'Story Blurb / Executive Summary',
        'Link(s) to Supporting Material',
        'Business Outcomes / Scope',
        'Standout Team Members'
      ];
    }
    if (!Array.isArray(cfg.notable.validationStatusOptions)) {
      cfg.notable.validationStatusOptions = [
        'Raw/Unverified',
        'Region Approved',
        'Region Restricted'
      ];
    }
    cfg.notable.notify = cfg.notable.notify || {};
    if (!cfg.notable.notify.email)
      cfg.notable.notify.email = 'mariah.maxie@workday.com';
    if (!cfg.notable.notify.testEmail)
      cfg.notable.notify.testEmail = 'jeffrey.ditty@workday.com';
    if (cfg.notable.notify.useTestMode === undefined || cfg.notable.notify.useTestMode === null)
      cfg.notable.notify.useTestMode = true;
    if (cfg.notable.notify.slackWebhookUrl === undefined)
      cfg.notable.notify.slackWebhookUrl = '';
    if (cfg.notable.notify.slackWebhookUrlTest === undefined)
      cfg.notable.notify.slackWebhookUrlTest = '';
    if (cfg.notable.restrictedHideEnabled === undefined || cfg.notable.restrictedHideEnabled === null)
      cfg.notable.restrictedHideEnabled = true;
    if (cfg.notable.pickerLookbackDays === undefined || cfg.notable.pickerLookbackDays === null)
      cfg.notable.pickerLookbackDays = 180;

    // -------------------------------------------------------------------------
    // UI
    // -------------------------------------------------------------------------
    cfg.ui = cfg.ui || {};
    if (!cfg.ui.appTitle)       cfg.ui.appTitle       = (cfg.appId || 'App') + ' Deployment Health Manager';
    if (!cfg.ui.headerTitle)    cfg.ui.headerTitle    = cfg.ui.appTitle;
    if (!cfg.ui.headerSubtitle) cfg.ui.headerSubtitle = 'Review and manage deployment data across all stages';

    if (!Array.isArray(cfg.ui.tabs) || !cfg.ui.tabs.length) {
      // Phase 2 default tab order.
      cfg.ui.tabs = [
        { id: 'deployments', label: 'Deployments' },
        { id: 'golives',     label: 'Go Lives' },
        { id: 'execsummary', label: 'Executive Summary' },
        { id: 'report',      label: 'Monthly Report Preview' },
        { id: 'portfolio',   label: 'Portfolio Health' },
        { id: 'overrides',   label: 'Manage Overrides' }
      ];
    }

    // V2.8: migrate legacy mgmPgl tab id to unified csat tab.
    cfg.ui.tabs = cfg.ui.tabs.map(function (t) {
      if (t.id === 'mgmPgl') {
        return { id: 'csat', label: (t.label && t.label !== 'MDS/PGL' && t.label !== 'MGM / PGL')
          ? t.label : 'CSAT' };
      }
      return t;
    });

    // Deployments table — Phase 1 keys + Phase 2 additions
    cfg.ui.deploymentsTable = cfg.ui.deploymentsTable || {};
    if (cfg.ui.deploymentsTable.showIndustry === undefined)
      cfg.ui.deploymentsTable.showIndustry = false;
    if (cfg.ui.deploymentsTable.showEmColumn === undefined)
      cfg.ui.deploymentsTable.showEmColumn = false;
    if (!cfg.ui.deploymentsTable.ownerColumnLabel)
      cfg.ui.deploymentsTable.ownerColumnLabel = 'Delivery Director';
    if (cfg.ui.deploymentsTable.showMissingDDHighlight === undefined)
      cfg.ui.deploymentsTable.showMissingDDHighlight = true;
    if (!cfg.ui.deploymentsTable.missingDDMessage)
      cfg.ui.deploymentsTable.missingDDMessage = 'Delivery Director needs assigned';
    if (!cfg.ui.deploymentsTable.searchPlaceholder)
      cfg.ui.deploymentsTable.searchPlaceholder = 'Search by account, deployment name, partner...';
    // Phase 2
    if (!Array.isArray(cfg.ui.deploymentsTable.defaultHealthFilter))
      cfg.ui.deploymentsTable.defaultHealthFilter = ['Red', 'Yellow'];
    if (cfg.ui.deploymentsTable.showStageColumn === undefined)
      cfg.ui.deploymentsTable.showStageColumn = false;
    if (cfg.ui.deploymentsTable.expandableRows === undefined)
      cfg.ui.deploymentsTable.expandableRows = true;

    // Go Lives table (per-row visual config)
    cfg.ui.goLivesTable = cfg.ui.goLivesTable || {};
    if (cfg.ui.goLivesTable.showIndustry === undefined)
      cfg.ui.goLivesTable.showIndustry = false;
    if (cfg.ui.goLivesTable.showProductAreas === undefined)
      cfg.ui.goLivesTable.showProductAreas = true;
    if (cfg.ui.goLivesTable.showDeploymentName === undefined)
      cfg.ui.goLivesTable.showDeploymentName = false;
    if (!cfg.ui.goLivesTable.searchPlaceholder)
      cfg.ui.goLivesTable.searchPlaceholder = 'Search by account name...';

    // Phase 2: Go Lives tab-level config (consolidated tab toggle)
    cfg.ui.goLivesTab = cfg.ui.goLivesTab || {};
    if (!cfg.ui.goLivesTab.defaultView)        cfg.ui.goLivesTab.defaultView = 'recent';
    if (!cfg.ui.goLivesTab.recentWindowDays)   cfg.ui.goLivesTab.recentWindowDays = 60;
    if (!cfg.ui.goLivesTab.upcomingWindowDays) cfg.ui.goLivesTab.upcomingWindowDays = 90;

    // MDS/PGL tab defaults (MDS-PGL Redesign 2026-06) — retained as csatTab alias (V2.8)
    cfg.ui.mgmPglTab = cfg.ui.mgmPglTab || {};
    if (cfg.ui.mgmPglTab.enabled === undefined) cfg.ui.mgmPglTab.enabled = true;
    if (!cfg.ui.mgmPglTab.defaultHorizon) cfg.ui.mgmPglTab.defaultHorizon = 3;
    if (!Array.isArray(cfg.ui.mgmPglTab.horizonOptions))
      cfg.ui.mgmPglTab.horizonOptions = [3, 6];
    cfg.ui.csatTab = cfg.ui.csatTab || cfg.ui.mgmPglTab;
    if (cfg.ui.csatTab.enabled === undefined) cfg.ui.csatTab.enabled = true;
    if (!cfg.ui.csatTab.defaultHorizon) cfg.ui.csatTab.defaultHorizon = 3;
    if (!Array.isArray(cfg.ui.csatTab.horizonOptions))
      cfg.ui.csatTab.horizonOptions = [3, 6];

    // Stage 1: Role-based tab visibility.
    // Maps access role -> list of tab IDs the user is allowed to see.
    // CoreUI_Markup uses this to render only allowed tabs server-side.
    // Apps may override this in their APP_CONFIG.ui.roleVisibility block.
    cfg.ui.roleVisibility = cfg.ui.roleVisibility || {};
    if (!Array.isArray(cfg.ui.roleVisibility.READ_ONLY)) {
      cfg.ui.roleVisibility.READ_ONLY = ['deployments', 'golives', 'portfolio'];
    }
    if (!Array.isArray(cfg.ui.roleVisibility.POWER_USER)) {
      cfg.ui.roleVisibility.POWER_USER = [
        'deployments', 'golives', 'csat', 'mgmPgl', 'execsummary',
        'report', 'portfolio', 'overrides', 'trends', 'notable'
      ];
    } else {
      // V2.8: ensure csat is allowed; retain mgmPgl as fallback alias.
      var _pu = cfg.ui.roleVisibility.POWER_USER;
      if (_pu.indexOf('csat') === -1 && _pu.indexOf('mgmPgl') !== -1) {
        _pu.splice(_pu.indexOf('mgmPgl') + 1, 0, 'csat');
      } else if (_pu.indexOf('csat') === -1) {
        _pu.push('csat');
      }
      if (_pu.indexOf('mgmPgl') === -1 && _pu.indexOf('csat') !== -1) {
        _pu.splice(_pu.indexOf('csat') + 1, 0, 'mgmPgl');
      }
    }
    if (!Array.isArray(cfg.ui.roleVisibility.ADMIN)) {
      cfg.ui.roleVisibility.ADMIN = cfg.ui.roleVisibility.POWER_USER.slice();
    }

    // Phase 2: Manage Overrides tab config
    cfg.ui.manageOverrides = cfg.ui.manageOverrides || {};
    if (cfg.ui.manageOverrides.showAuditTrail === undefined)
      cfg.ui.manageOverrides.showAuditTrail = true;
    if (!Array.isArray(cfg.ui.manageOverrides.bulkClearScopes))
      cfg.ui.manageOverrides.bulkClearScopes = ['monthly', 'all'];

    cfg.ui.editModal = cfg.ui.editModal || {};
    if (!cfg.ui.editModal.ownerFieldLabel)
      cfg.ui.editModal.ownerFieldLabel = 'Delivery Director';
    if (!cfg.ui.editModal.ownerInputType)
      cfg.ui.editModal.ownerInputType = 'text';
    if (!Array.isArray(cfg.ui.editModal.ownerOptions))
      cfg.ui.editModal.ownerOptions = [];

    cfg.ui.personalization = cfg.ui.personalization || {};
    if (cfg.ui.personalization.enabled === undefined)
      cfg.ui.personalization.enabled = false;
    if (!cfg.ui.personalization.defaultViewMode)
      cfg.ui.personalization.defaultViewMode = 'myPortfolio';
    if (!Array.isArray(cfg.ui.personalization.affectsTabs))
      cfg.ui.personalization.affectsTabs = ['deployments', 'golives', 'overrides'];
    if (cfg.ui.personalization.welcomeMessageEnabled === undefined)
      cfg.ui.personalization.welcomeMessageEnabled = true;
    if (cfg.ui.personalization.showFullPortfolioIndicator === undefined)
      cfg.ui.personalization.showFullPortfolioIndicator = true;

    cfg.ui.productFilter = cfg.ui.productFilter || {};
    if (cfg.ui.productFilter.enabled === undefined)
      cfg.ui.productFilter.enabled = false;
    if (!Array.isArray(cfg.ui.productFilter.areas))
      cfg.ui.productFilter.areas = [];
    if (!Array.isArray(cfg.ui.productFilter.affectsTabs))
      cfg.ui.productFilter.affectsTabs = ['deployments', 'golives', 'csat', 'portfolio', 'overview'];
    if (!cfg.ui.productFilter.defaultProduct)
      cfg.ui.productFilter.defaultProduct = 'all';
    if (typeof cfg.ui.productFilter.aliases !== 'object' || cfg.ui.productFilter.aliases === null)
      cfg.ui.productFilter.aliases = {};
    if (typeof cfg.ui.productFilter.nameTokens !== 'object' || cfg.ui.productFilter.nameTokens === null)
      cfg.ui.productFilter.nameTokens = {};
    if (cfg.ui.productFilter.hidden === undefined)
      cfg.ui.productFilter.hidden = false;

    // -------------------------------------------------------------------------
    // Trends (T1)
    // -------------------------------------------------------------------------
    if (cfg.trends) {
      if (cfg.trends.cacheTtlSeconds === undefined)            cfg.trends.cacheTtlSeconds            = 3600;
      if (cfg.trends.trendsWindowMonths === undefined)         cfg.trends.trendsWindowMonths         = 12;
      if (cfg.trends.timeInStageOutlierMultiple === undefined) cfg.trends.timeInStageOutlierMultiple = 2;
      if (cfg.trends.timeInStageMinSampleSize === undefined)   cfg.trends.timeInStageMinSampleSize   = 10;
      if (cfg.trends.byPartnerMinSampleSize === undefined)     cfg.trends.byPartnerMinSampleSize     = 5;
    }
    if (cfg.sheets && !cfg.sheets.deploymentHistory) {
      cfg.sheets.deploymentHistory = 'SFDC_DeploymentHistory';
    }

    // -------------------------------------------------------------------------
    // Portfolio Momentum (P2)
    // -------------------------------------------------------------------------
    cfg.momentum = cfg.momentum || {};
    if (cfg.momentum.enabled === undefined) cfg.momentum.enabled = false;
    if (!Array.isArray(cfg.momentum.platforms)) cfg.momentum.platforms = [];
    if (!cfg.momentum.productAreaMapping || typeof cfg.momentum.productAreaMapping !== 'object') {
      cfg.momentum.productAreaMapping = {};
    }
    if (!cfg.momentum.productFilter || typeof cfg.momentum.productFilter !== 'object') {
      cfg.momentum.productFilter = {};
    }
    if (!Array.isArray(cfg.momentum.chartLegend)) cfg.momentum.chartLegend = [];
    if (!cfg.momentum.kpiLabels || typeof cfg.momentum.kpiLabels !== 'object') {
      cfg.momentum.kpiLabels = null;
    }
    if (cfg.momentum.historicalYears === undefined) cfg.momentum.historicalYears = 5;
    cfg.momentum.chart = cfg.momentum.chart || {};
    if (!cfg.momentum.chart.colors || typeof cfg.momentum.chart.colors !== 'object') {
      cfg.momentum.chart.colors = {};
    }
    if (cfg.momentum.chart.inProgressOpacity === undefined) {
      cfg.momentum.chart.inProgressOpacity = 0.55;
    }

    return cfg;
  }

  return { withDefaults: withDefaults };
})();