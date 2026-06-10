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
 * @property {string} appUsers           Phase 2: "AppUsers"
 * @property {string} ddAssignment       Phase 2: "DD Assignment"
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
 * @property {string}  title
 * @property {string}  headerLogoUrl
 * @property {string}  sanaLogoUrl
 * @property {string}  footerAttribution
 * @property {Array<Object>} tables
 * @property {Object}  barConfig
 * @property {number|null} goLivesWindowDays
 * @property {string|null} redYellowPartnerFilter
 * @property {boolean} includeIndustryRedYellow
 * @property {boolean} includeIndustryGoLives
 * @property {Object}  portfolioHealth
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
 * @property {UIConfig}              [ui]
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
    if (!cfg.sheets.activeDeployments)     cfg.sheets.activeDeployments     = 'ActiveDeployments';
    if (!cfg.sheets.goLives)               cfg.sheets.goLives               = 'Go Lives';
    if (!cfg.sheets.deploymentOverrides)   cfg.sheets.deploymentOverrides   = 'DeploymentOverrides';
    if (!cfg.sheets.goLivesOverrides)      cfg.sheets.goLivesOverrides      = 'GoLivesOverrides';
    if (!cfg.sheets.deploymentsMeta)       cfg.sheets.deploymentsMeta       = 'DeploymentsMeta';
    if (!cfg.sheets.changeLog)             cfg.sheets.changeLog             = 'ChangeLog';
    if (!cfg.sheets.execSummary)           cfg.sheets.execSummary           = 'ExecSummary';
    if (!cfg.sheets.healthReportSnapshots) cfg.sheets.healthReportSnapshots = 'HealthReportSnapshots';
    if (!cfg.sheets.healthMonthlySummary)  cfg.sheets.healthMonthlySummary  = 'HealthMonthlySummary';
    if (!cfg.sheets.healthYtdSummary)      cfg.sheets.healthYtdSummary      = 'HealthYtdSummary';
    if (!cfg.sheets.dashboard)             cfg.sheets.dashboard             = 'Dashboard';
    if (!cfg.sheets.appUsers)              cfg.sheets.appUsers              = 'AppUsers';
    if (!cfg.sheets.ddAssignment)          cfg.sheets.ddAssignment          = 'DD Assignment';

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
    // Report
    // -------------------------------------------------------------------------
    cfg.report = cfg.report || {};
    if (cfg.report.goLivesWindowDays === undefined)        cfg.report.goLivesWindowDays = 30;
    if (cfg.report.redYellowPartnerFilter === undefined)   cfg.report.redYellowPartnerFilter = null;
    if (cfg.report.includeIndustryRedYellow === undefined) cfg.report.includeIndustryRedYellow = false;
    if (cfg.report.includeIndustryGoLives === undefined)   cfg.report.includeIndustryGoLives = false;

    cfg.report.portfolioHealth = cfg.report.portfolioHealth || {};
    if (!cfg.report.portfolioHealth.title)
      cfg.report.portfolioHealth.title = 'Portfolio Health';
    if (!cfg.report.portfolioHealth.workdayPartner)
      cfg.report.portfolioHealth.workdayPartner = 'Workday Professional Services';
    if (!cfg.report.portfolioHealth.workdayLabel)
      cfg.report.portfolioHealth.workdayLabel = 'Workday';
    if (!cfg.report.portfolioHealth.otherLabel)
      cfg.report.portfolioHealth.otherLabel = 'Partners/Other';
    if (!Array.isArray(cfg.report.portfolioHealth.industryBuckets))
      cfg.report.portfolioHealth.industryBuckets = [];
    if (cfg.report.portfolioHealth.recentGoLivesWindowDays === undefined)
      cfg.report.portfolioHealth.recentGoLivesWindowDays = cfg.report.goLivesWindowDays || 60;
    if (cfg.report.portfolioHealth.historyWindowMonths === undefined)
      cfg.report.portfolioHealth.historyWindowMonths = 6;

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

    return cfg;
  }

  return { withDefaults: withDefaults };
})();