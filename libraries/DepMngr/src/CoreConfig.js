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
 *   ESC1:           adds cfg.escalations (executive Escalations tab foundation; default off).
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
 * @property {string}   [mode]            S2: 'separate'|'integrated'; absent = 'separate' when enabled
 * @property {string}   productAreaMatch  Exact Product_Area__c value (e.g. 'Student')
 * @property {{ studentData: string }}   sheets
 * @property {{ id: string, label: string, insertAfter: string }} tab
 * @property {{ defaultStatusFilter: string, defaultHealthFilter: ?string,
 *              columns: Array<string>, searchPlaceholder: string,
 *              expandableRows: boolean }} table
 * @property {{ allowedRoles: Array<string>, notesMaxChars: number }} editModal
 * @property {{ enabled: boolean, copy: string, showOnTabs: Array<string>,
 *              linkToken: string }} banner
 * @property {{ enabled: boolean, copy: string }} [reportDisclosure]  Deprecated; use report.topMessage.
 */

/**
 * @typedef {Object} ReportTopMessageConfig
 * @property {string} [text]      Escaped plain text; blank/absent = no banner.
 * @property {string} [linkText]  Link label (requires linkUrl).
 * @property {string} [linkUrl]   Must begin with https:// to render a link.
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
 * Portfolio Health Slides export destination (app config overrides folderId).
 * @typedef {Object} PortfolioHealthSlidesExportConfig
 * @property {'root'|'folder'} destinationMode  'root' = deployer My Drive root (default).
 * @property {string}            folderId         Shared folder ID when destinationMode is 'folder'.
 * @property {'inherit'}         shareMode        Reserved for future sharing; 'inherit' uses folder ACLs.
 * @property {string}            filename         Title template; tokens: {appName},{appId},{userEmail},{date},{timestamp},{deckType}.
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
 * @property {ReportTopMessageConfig} [topMessage]  Monthly report banner (opt-in per app).
 */

/**
 * @typedef {Object} MomentumChartConfig
 * @property {Object<string,string>} colors            Platform code → hex color.
 * @property {number}                inProgressOpacity 0–1 opacity for current-FY bars (default 0.55).
 */

/**
 * @typedef {Object} TrendsConfig   T1
 * @property {number}  cacheTtlSeconds              CacheService TTL for Trends metrics. Default 3600.
 * @property {number}  trendsWindowMonths           Rolling window for benchmarks. Default 12.
 * @property {number}  timeInStageOutlierMultiple   Multiplier for outlier detection. Default 2.
 * @property {number}  timeInStageMinSampleSize     Min sample size for outlier flags. Default 10.
 * @property {number}  byPartnerMinSampleSize       Min sample size for by-partner rollups. Default 5.
 * @property {boolean} vNextEnabled                 Trends v1 bundled UI (ProductMode or IndustryMode). Default false.
 * @property {string}  defaultWindow                Default time window key: '12m' | '24m' | '60m'. Default '12m'.
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
 * @typedef {Object} EscalationsFieldAliases
 * @property {string[]} [id]
 * @property {string[]} [channelId]
 * @property {string[]} [workspaceId]
 * @property {string[]} [channelName]
 * @property {string[]} [customer]
 * @property {string[]} [status]
 * @property {string[]} [severity]
 * @property {string[]} [openedAt]
 * @property {string[]} [executiveSummary]
 * @property {string[]} [customerImpact]
 * @property {string[]} [businessImpact]
 * @property {string[]} [technicalStatus]
 * @property {string[]} [latestDevelopment]
 * @property {string[]} [nextSteps]
 * @property {string[]} [openActions]
 * @property {string[]} [actionOwners]
 * @property {string[]} [keyRisks]
 * @property {string[]} [decisionsRequired]
 * @property {string[]} [execAttention]
 * @property {string[]} [execAttentionReason]
 * @property {string[]} [lastActivityAt]
 * @property {string[]} [lastAnalysisAt]
 * @property {string[]} [lastSheetUpdateAt]
 * @property {string[]} [informationGaps]
 * @property {string[]} [recordVersion]
 * @property {string[]} [deploymentId]
 * @property {string[]} [channelUrl]
 * @property {string[]} [registeredAt]
 * @property {string[]} [closedAt]
 * @property {string[]} [registeredBy]
 * @property {string[]} [processedAt]
 * @property {string[]} [sourceEventId]
 * @property {string[]} [sourceMessageTimestamp]
 * @property {string[]} [outcome]
 * @property {string[]} [reasonCode]
 * @property {string[]} [detail]
 * @property {string[]} [retryable]
 * @property {string[]} [workflowVersion]
 * @property {string[]} [historyId]
 * @property {string[]} [escalationId]
 * @property {string[]} [updatedAt]
 * @property {string[]} [updateType]
 * @property {string[]} [changeSummary]
 * @property {string[]} [previousValues]
 * @property {string[]} [newValues]
 * @property {string[]} [sanaProcessedAt]
 * @property {string[]} [confidence]
 */

/**
 * @typedef {Object} EscalationsConfig  ESC1
 * @property {boolean} enabled
 * @property {{ label: string, insertAfter: string }} tab
 * @property {{ currentState: string, channelRegistry: string, processingLog: string, updateHistory: string }} sheets
 * @property {{ newWindowDays: number, updatedWindowHours: number, updatedField: string, noUpdateDaysThreshold: number, quietNoticeHours: number }} kpi
 * @property {{ closedStatusValues: string[] }} status
 * @property {{ tones: Object<string,string> }} severity
 * @property {{ maxRows: number, summaryMaxChars: number, textMaxChars: number, placeholderPatterns: string[] }} display
 * @property {{ currentState: EscalationsFieldAliases, channelRegistry: EscalationsFieldAliases, processingLog: EscalationsFieldAliases, updateHistory: EscalationsFieldAliases }} fields
 * @property {{ enabled: boolean }} updateHistory
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
 * @property {string}                       periodView          historicalFyAndCurrentRunningTotal (platform) | previousFyAndCurrentHalves (product).
 * @property {string}                       dateStrategy        actualOnly | actualThenTarget | targetOnly (product mode).
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
 * @property {string}  mode                  'legacy' | 'classic' (alias) | 'explorer' — Go Lives tab UI
 * @property {string}  defaultView           Legacy toggle default ('recent'|'upcoming'|'all'); explorer uses defaultTimePeriod/defaultGoLiveType
 * @property {number}  recentWindowDays
 * @property {number}  upcomingWindowDays
 * @property {string}  [defaultTimePeriod]   Explorer: 'next90' | 'last60' | 'rolling12' | 'fiscalYearQuarter' | …
 * @property {string}  [defaultGoLiveType]   Explorer: 'all' | 'completed' | 'upcoming'
 * @property {boolean} [kpiStripEnabled]
 * @property {number}  [initialRenderRows]
 * @property {number}  [loadMoreIncrement]
 * @property {number}  [maxRenderRows]
 * @property {number}  [searchResultCap]
 * @property {number}  [customRangeMaxMonths]
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
 * @property {EscalationsConfig}     [escalations] ESC1: executive Escalations tab. Default off.
 */

var CoreConfig = (function () {

  /**
   * Per-field alias merge for cfg.escalations.fields.* — app overrides win when present.
   * @param {Object<string, string[]>} appMap
   * @param {Object<string, string[]>} defaultMap
   * @return {Object<string, string[]>}
   * @private
   */
  function mergeEscalationsFieldMap_(appMap, defaultMap) {
    var out = {};
    Object.keys(defaultMap).forEach(function (key) {
      if (appMap && Object.prototype.hasOwnProperty.call(appMap, key) &&
          Array.isArray(appMap[key])) {
        out[key] = appMap[key];
      } else {
        out[key] = defaultMap[key].slice();
      }
    });
    if (appMap) {
      Object.keys(appMap).forEach(function (extraKey) {
        if (!Object.prototype.hasOwnProperty.call(out, extraKey) &&
            Array.isArray(appMap[extraKey])) {
          out[extraKey] = appMap[extraKey];
        }
      });
    }
    return out;
  }

  /**
   * @return {Object}
   * @private
   */
  function defaultEscalationsFields_() {
    return {
      currentState: {
        id: ['Escalation ID'],
        channelId: ['Slack Channel ID'],
        workspaceId: ['Slack Workspace ID'],
        channelName: ['Slack Channel Name'],
        customer: ['Customer'],
        status: ['Escalation Status', 'Status'],
        severity: ['Severity'],
        openedAt: ['Escalation Opened Date/Time'],
        executiveSummary: ['Executive Summary'],
        customerImpact: ['Customer Impact'],
        businessImpact: ['Business Impact'],
        technicalStatus: ['Technical Status'],
        latestDevelopment: ['Latest Significant Development'],
        nextSteps: ['Next Steps'],
        openActions: ['Open Actions'],
        actionOwners: ['Action Owners'],
        keyRisks: ['Key Risks'],
        decisionsRequired: ['Decisions Required'],
        execAttention: ['Executive Attention Required'],
        execAttentionReason: ['Executive Attention Reason'],
        lastActivityAt: ['Last Significant Activity Date/Time'],
        lastAnalysisAt: ['Last Sana Analysis Date/Time'],
        lastSheetUpdateAt: ['Last Sheet Update Date/Time'],
        informationGaps: ['Information Gaps / Uncertainty'],
        recordVersion: ['Record Version'],
        deploymentId: ['Deployment ID', 'Salesforce Deployment ID']
      },
      channelRegistry: {
        channelUrl: ['Slack Channel URL'],
        channelId: ['Slack Channel ID'],
        channelName: ['Channel Name'],
        customer: ['Customer'],
        status: ['Status'],
        registeredAt: ['Registered Date'],
        closedAt: ['Closed Date'],
        registeredBy: ['Registered By']
      },
      processingLog: {
        processedAt: ['Processed Date/Time'],
        channelId: ['Slack Channel ID'],
        sourceEventId: ['Source Event ID'],
        sourceMessageTimestamp: ['Source Message Timestamp'],
        outcome: ['Outcome'],
        reasonCode: ['Reason Code'],
        detail: ['Detail'],
        retryable: ['Retryable'],
        workflowVersion: ['Workflow Version']
      },
      updateHistory: {
        historyId: ['History ID'],
        escalationId: ['Escalation ID'],
        channelId: ['Slack Channel ID'],
        updatedAt: ['Update Date/Time'],
        updateType: ['Update Type'],
        changeSummary: ['Change Summary'],
        previousValues: ['Previous Value(s)'],
        newValues: ['New Value(s)'],
        execAttention: ['Executive Attention Required'],
        sanaProcessedAt: ['Sana Processed Date/Time'],
        recordVersion: ['Record Version'],
        confidence: ['Confidence']
      }
    };
  }

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
    // Deployment Health Plan (DHP) — opt-in per app; safe defaults for all apps
    // -------------------------------------------------------------------------
    cfg.deploymentHealthPlan = cfg.deploymentHealthPlan || {};
    if (cfg.deploymentHealthPlan.enabled === undefined)
      cfg.deploymentHealthPlan.enabled = false;
    if (!cfg.deploymentHealthPlan.sheetName)
      cfg.deploymentHealthPlan.sheetName = 'SFDC_DHP';
    if (cfg.deploymentHealthPlan.chipEnabled === undefined)
      cfg.deploymentHealthPlan.chipEnabled = true;
    if (cfg.deploymentHealthPlan.expandedDetailsEnabled === undefined)
      cfg.deploymentHealthPlan.expandedDetailsEnabled = true;
    if (cfg.deploymentHealthPlan.metricsEnabled === undefined)
      cfg.deploymentHealthPlan.metricsEnabled = false;
    if (!cfg.deploymentHealthPlan.issueCategoryDelimiter)
      cfg.deploymentHealthPlan.issueCategoryDelimiter = ';';

    // -------------------------------------------------------------------------
    // Executive Watch (SFDC_Wellness) — enabled by default for all apps
    // -------------------------------------------------------------------------
    cfg.executiveWatch = cfg.executiveWatch || {};
    if (cfg.executiveWatch.enabled === undefined)
      cfg.executiveWatch.enabled = true;

    // -------------------------------------------------------------------------
    // Active deployments (ProductMode union — EVI/AI opt-in)
    // -------------------------------------------------------------------------
    cfg.activeDeployments = cfg.activeDeployments || {};
    if (cfg.activeDeployments.productModeUnionEnabled === undefined) {
      cfg.activeDeployments.productModeUnionEnabled = false;
    }
    if (!cfg.activeDeployments.productModeSourceMode) {
      cfg.activeDeployments.productModeSourceMode = 'parent';
    }
    if (!Array.isArray(cfg.activeDeployments.productModeUnionStatuses)) {
      cfg.activeDeployments.productModeUnionStatuses = ['Active'];
    }
    if (!Array.isArray(cfg.activeDeployments.productModeStructuredProductAreas)) {
      cfg.activeDeployments.productModeStructuredProductAreas = [];
    }
    if (!Array.isArray(cfg.activeDeployments.productModeDeploymentNameIncludes)) {
      cfg.activeDeployments.productModeDeploymentNameIncludes = [];
    }
    if (!Array.isArray(cfg.activeDeployments.productModeDeploymentNameExcludes)) {
      cfg.activeDeployments.productModeDeploymentNameExcludes =
        cfg.activeDeployments.productModeUnionEnabled ? ['Legacy'] : [];
    }
    if (!cfg.activeDeployments.productModeNameMatch ||
        typeof cfg.activeDeployments.productModeNameMatch !== 'object') {
      cfg.activeDeployments.productModeNameMatch = {
        field: 'deploymentName',
        caseInsensitive: true
      };
    } else {
      if (!cfg.activeDeployments.productModeNameMatch.field) {
        cfg.activeDeployments.productModeNameMatch.field = 'deploymentName';
      }
      if (cfg.activeDeployments.productModeNameMatch.caseInsensitive === undefined) {
        cfg.activeDeployments.productModeNameMatch.caseInsensitive = true;
      }
    }
    if (!Array.isArray(cfg.activeDeployments.productModeDefaultSurfaceStatuses)) {
      cfg.activeDeployments.productModeDefaultSurfaceStatuses = ['Active'];
    }
    if (!Array.isArray(cfg.activeDeployments.productModeTrendsStatuses)) {
      cfg.activeDeployments.productModeTrendsStatuses =
        (Array.isArray(cfg.activeDeployments.productModeUnionStatuses) &&
         cfg.activeDeployments.productModeUnionStatuses.length)
          ? cfg.activeDeployments.productModeUnionStatuses.slice()
          : ['Active', 'Complete'];
    }
    if (cfg.activeDeployments.allowPfRowsWithoutParentStatus === undefined) {
      cfg.activeDeployments.allowPfRowsWithoutParentStatus = false;
    }
    if (!Array.isArray(cfg.activeDeployments.productModeExcludePhases)) {
      cfg.activeDeployments.productModeExcludePhases = [];
    }
    if (cfg.activeDeployments.productModeExcludeCustomer360 === undefined) {
      cfg.activeDeployments.productModeExcludeCustomer360 = false;
    }
    if (!cfg.activeDeployments.productModeDataSource) {
      cfg.activeDeployments.productModeDataSource =
        cfg.activeDeployments.productModeUnionEnabled ? 'productFunction' : 'parent';
    }
    if (!cfg.activeDeployments.productModeHistoricalSource) {
      cfg.activeDeployments.productModeHistoricalSource =
        cfg.activeDeployments.productModeUnionEnabled ? 'productFunction' : 'parent';
    }
    if (!cfg.activeDeployments.productModeGoLiveSource) {
      cfg.activeDeployments.productModeGoLiveSource =
        cfg.activeDeployments.productModeUnionEnabled ? 'productFunction' : 'parent';
    }
    if (!cfg.activeDeployments.productModeDisplayGrain) {
      cfg.activeDeployments.productModeDisplayGrain = 'pfRow';
    }
    // Count grain is independent of display grain. Unset preserves prior
    // behavior by following display grain (IndustryMode never uses this).
    if (!cfg.activeDeployments.productModeCountGrain) {
      cfg.activeDeployments.productModeCountGrain = cfg.activeDeployments.productModeDisplayGrain;
    }
    if (!cfg.activeDeployments.productModeGoLiveGrain) {
      cfg.activeDeployments.productModeGoLiveGrain = 'accountDate';
    }
    // ProductMode PF / union apps: canonical parent-deployment grain (Deployment__r.Id).
    if (cfg.activeDeployments.productModeUnionEnabled &&
        (cfg.activeDeployments.productModeDataSource === 'productFunction' ||
         cfg.activeDeployments.productModeSourceMode === 'pfOnly' ||
         cfg.activeDeployments.productModeSourceMode === 'parentAndProductFunctionUnion')) {
      if (!cfg.activeDeployments.productModeDisplayGrain ||
          cfg.activeDeployments.productModeDisplayGrain === 'deploymentProduct' ||
          cfg.activeDeployments.productModeDisplayGrain === 'pfRow') {
        cfg.activeDeployments.productModeDisplayGrain = 'parentDeployment';
      }
      if (!cfg.activeDeployments.productModeCountGrain ||
          cfg.activeDeployments.productModeCountGrain === 'pfRow' ||
          cfg.activeDeployments.productModeCountGrain === 'deploymentProduct') {
        cfg.activeDeployments.productModeCountGrain = 'parentDeployment';
      }
    }

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
    cfg.report.portfolioHealth.partnerAnalysis =
      cfg.report.portfolioHealth.partnerAnalysis || {};
    if (!Array.isArray(cfg.report.portfolioHealth.partnerAnalysis.excludePartners)) {
      cfg.report.portfolioHealth.partnerAnalysis.excludePartners = [];
    }
    if (cfg.report.portfolioHealth.slideExportEnabled === undefined)
      cfg.report.portfolioHealth.slideExportEnabled = true;
    cfg.report.portfolioHealth.slidesExport = cfg.report.portfolioHealth.slidesExport || {};
    if (!cfg.report.portfolioHealth.slidesExport.destinationMode)
      cfg.report.portfolioHealth.slidesExport.destinationMode = 'root';
    if (cfg.report.portfolioHealth.slidesExport.folderId === undefined)
      cfg.report.portfolioHealth.slidesExport.folderId = '';
    if (!cfg.report.portfolioHealth.slidesExport.shareMode)
      cfg.report.portfolioHealth.slidesExport.shareMode = 'inherit';
    if (!cfg.report.portfolioHealth.slidesExport.filename)
      cfg.report.portfolioHealth.slidesExport.filename =
        '{appName} Portfolio Health - {userEmail} - {timestamp}';

    // N8: V2 report sections + native Gmail distribution defaults.
    cfg.report.sections = cfg.report.sections || {};
    if (cfg.report.sections.approach === undefined)
      cfg.report.sections.approach = true;

    cfg.report.distribution = cfg.report.distribution || {};
    if (cfg.report.distribution.enabled === undefined)
      cfg.report.distribution.enabled = false;
    if (cfg.report.distribution.fromAlias === undefined)
      cfg.report.distribution.fromAlias = '';
    if (cfg.report.distribution.fromName === undefined)
      cfg.report.distribution.fromName = '';
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
    // ProductMode apps: both SFDC source sheets matter for union membership.
    if (cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled) {
      var pfFreshnessSheet = cfg.sheets.sfdcDeploymentProductFunctions ||
        'SFDC_DeploymentProductFunctions';
      var depFreshnessSheet = cfg.sheets.deployments || 'SFDC_Deployments';
      if (!cfg.freshness.primarySheet) {
        cfg.freshness.primarySheet = pfFreshnessSheet;
      }
      if (!cfg.freshness.watchSheet) {
        cfg.freshness.watchSheet = pfFreshnessSheet;
      }
      if (cfg.activeDeployments.productModeSourceMode === 'parentAndProductFunctionUnion') {
        if (cfg.freshness.expectedSheets.indexOf(depFreshnessSheet) < 0) {
          cfg.freshness.expectedSheets.push(depFreshnessSheet);
        }
        if (cfg.freshness.expectedSheets.indexOf(pfFreshnessSheet) < 0) {
          cfg.freshness.expectedSheets.push(pfFreshnessSheet);
        }
      }
    }

    // -------------------------------------------------------------------------
    // MDS/PGL notifications (N7)
    // -------------------------------------------------------------------------
    cfg.notify = cfg.notify || {};
    if (cfg.notify.enabled === undefined) cfg.notify.enabled = true;
    if (!cfg.notify.configSheet) cfg.notify.configSheet = 'NotificationConfig';
    if (!cfg.notify.testDefaultRecipient)
      cfg.notify.testDefaultRecipient = 'jeffrey.ditty@workday.com';
    if (!Array.isArray(cfg.notify.allowedFromAliases) || !cfg.notify.allowedFromAliases.length) {
      cfg.notify.allowedFromAliases = [
        'jeffrey.ditty@workday.com'
      ];
    }
    cfg.notify.ddDigest = cfg.notify.ddDigest || {};
    if (cfg.notify.ddDigest.partnerFilterEnabled === undefined) {
      cfg.notify.ddDigest.partnerFilterEnabled = false;
    }
    if (!Array.isArray(cfg.notify.ddDigest.partnerNames)) {
      cfg.notify.ddDigest.partnerNames = [];
    }

    // -------------------------------------------------------------------------
    // Student (S1/S2) — default mode when enabled; absent cfg.student = off
    // -------------------------------------------------------------------------
    if (cfg.student && cfg.student.enabled === true && !cfg.student.mode) {
      cfg.student.mode = 'separate';
    }
    if (cfg.student && cfg.student.enabled === true) {
      cfg.ui = cfg.ui || {};
      cfg.ui.student = Object.assign(
        {
          enabled: true,
          mode: cfg.student.mode || 'separate'
        },
        cfg.ui.student || {},
        {
          enabled: cfg.student.enabled,
          mode: cfg.student.mode || 'separate'
        }
      );
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
        'Latest Update [MM/DD/Year]',
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
    // Escalations (ESC1) — default off; PDX pilot enables in app config later
    // -------------------------------------------------------------------------
    cfg.escalations = cfg.escalations || {};
    if (cfg.escalations.enabled === undefined) cfg.escalations.enabled = false;

    cfg.escalations.tab = cfg.escalations.tab || {};
    if (!cfg.escalations.tab.label) cfg.escalations.tab.label = 'Escalations';
    if (!cfg.escalations.tab.insertAfter) cfg.escalations.tab.insertAfter = 'portfolio';

    cfg.escalations.sheets = cfg.escalations.sheets || {};
    if (!cfg.escalations.sheets.currentState)
      cfg.escalations.sheets.currentState = 'Current Escalation State';
    if (!cfg.escalations.sheets.channelRegistry)
      cfg.escalations.sheets.channelRegistry = 'Channel Registry';
    if (!cfg.escalations.sheets.processingLog)
      cfg.escalations.sheets.processingLog = 'Processing Log';
    if (!cfg.escalations.sheets.updateHistory)
      cfg.escalations.sheets.updateHistory = 'Escalation Update History';

    cfg.escalations.kpi = cfg.escalations.kpi || {};
    if (cfg.escalations.kpi.newWindowDays === undefined) cfg.escalations.kpi.newWindowDays = 7;
    if (cfg.escalations.kpi.updatedWindowHours === undefined) {
      cfg.escalations.kpi.updatedWindowHours = 24;
    }
    if (!cfg.escalations.kpi.updatedField) cfg.escalations.kpi.updatedField = 'lastSheetUpdateAt';
    if (cfg.escalations.kpi.noUpdateDaysThreshold === undefined) {
      cfg.escalations.kpi.noUpdateDaysThreshold = 7;
    }
    if (cfg.escalations.kpi.quietNoticeHours === undefined) {
      cfg.escalations.kpi.quietNoticeHours = 72;
    }

    cfg.escalations.status = cfg.escalations.status || {};
    if (!Array.isArray(cfg.escalations.status.closedStatusValues)) {
      cfg.escalations.status.closedStatusValues = [
        'closed', 'resolved', 'cancelled', 'canceled', 'complete', 'completed', 'inactive'
      ];
    }

    cfg.escalations.severity = cfg.escalations.severity || {};
    cfg.escalations.severity.tones = cfg.escalations.severity.tones || {};
    var defaultTones = {
      critical: 'red',
      high: 'red',
      medium: 'yellow',
      moderate: 'yellow',
      low: 'green'
    };
    Object.keys(defaultTones).forEach(function (toneKey) {
      if (!cfg.escalations.severity.tones[toneKey]) {
        cfg.escalations.severity.tones[toneKey] = defaultTones[toneKey];
      }
    });

    cfg.escalations.display = cfg.escalations.display || {};
    if (cfg.escalations.display.maxRows === undefined) cfg.escalations.display.maxRows = 200;
    if (cfg.escalations.display.summaryMaxChars === undefined) {
      cfg.escalations.display.summaryMaxChars = 280;
    }
    if (cfg.escalations.display.textMaxChars === undefined) {
      cfg.escalations.display.textMaxChars = 4000;
    }
    if (!Array.isArray(cfg.escalations.display.placeholderPatterns)) {
      cfg.escalations.display.placeholderPatterns = [
        'not specified', 'to be configured', 'unknown'
      ];
    }

    var escFieldDefaults = defaultEscalationsFields_();
    cfg.escalations.fields = cfg.escalations.fields || {};
    cfg.escalations.fields.currentState = mergeEscalationsFieldMap_(
      cfg.escalations.fields.currentState, escFieldDefaults.currentState
    );
    cfg.escalations.fields.channelRegistry = mergeEscalationsFieldMap_(
      cfg.escalations.fields.channelRegistry, escFieldDefaults.channelRegistry
    );
    cfg.escalations.fields.processingLog = mergeEscalationsFieldMap_(
      cfg.escalations.fields.processingLog, escFieldDefaults.processingLog
    );
    cfg.escalations.fields.updateHistory = mergeEscalationsFieldMap_(
      cfg.escalations.fields.updateHistory, escFieldDefaults.updateHistory
    );

    cfg.escalations.updateHistory = cfg.escalations.updateHistory || {};
    if (cfg.escalations.updateHistory.enabled === undefined) {
      cfg.escalations.updateHistory.enabled = false;
    }

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

    // ProductMode UI flag + deployments table defaults (EVI/AI and future ProductMode apps).
    // Force ProductMode table behavior even when APP_CONFIG still carries IndustryMode
    // deploymentsTable keys (e.g. showMissingDDHighlight: true from legacy shells).
    cfg.ui.isProductModeApp = isProductModeApp(cfg);
    if (cfg.ui.isProductModeApp) {
      cfg.ui.deploymentsTable.metaInfoMode = 'minimal';
      cfg.ui.deploymentsTable.hideDeliveryDirectorColumn = true;
      cfg.ui.deploymentsTable.showMissingDDHighlight = false;
      if (cfg.ui.deploymentsTable.showEngagementManagerColumn === undefined)
        cfg.ui.deploymentsTable.showEngagementManagerColumn = true;
      if (cfg.ui.deploymentsTable.showPsRegionColumn === undefined)
        cfg.ui.deploymentsTable.showPsRegionColumn = true;
      if (!cfg.ui.deploymentsTable.ownerFilterLabel)
        cfg.ui.deploymentsTable.ownerFilterLabel = 'Engagement Manager';
      if (!cfg.ui.portfolioGrouping) {
        cfg.ui.portfolioGrouping = { field: 'region', label: 'PS Region' };
      }
    }

    // Notable tab toggle (mirrors trendsTab.enabled pattern).
    cfg.ui.notable = cfg.ui.notable || {};
    if (cfg.ui.notable.enabled === undefined)
      cfg.ui.notable.enabled = true;

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

    // Phase 2: Go Lives tab-level config (Go-Live Explorer)
    cfg.ui.goLivesTab = cfg.ui.goLivesTab || {};
    if (!cfg.ui.goLivesTab.defaultView)        cfg.ui.goLivesTab.defaultView = 'recent';
    if (!cfg.ui.goLivesTab.recentWindowDays)   cfg.ui.goLivesTab.recentWindowDays = 60;
    if (!cfg.ui.goLivesTab.upcomingWindowDays) cfg.ui.goLivesTab.upcomingWindowDays = 90;
    if (!cfg.ui.goLivesTab.defaultTimePeriod)   cfg.ui.goLivesTab.defaultTimePeriod = 'next90';
    if (!cfg.ui.goLivesTab.defaultGoLiveType)   cfg.ui.goLivesTab.defaultGoLiveType = 'upcoming';
    if (cfg.ui.goLivesTab.kpiStripEnabled === undefined)
      cfg.ui.goLivesTab.kpiStripEnabled = true;
    if (!cfg.ui.goLivesTab.initialRenderRows)  cfg.ui.goLivesTab.initialRenderRows = 50;
    if (!cfg.ui.goLivesTab.loadMoreIncrement)  cfg.ui.goLivesTab.loadMoreIncrement = 50;
    if (!cfg.ui.goLivesTab.maxRenderRows)      cfg.ui.goLivesTab.maxRenderRows = 400;
    if (!cfg.ui.goLivesTab.searchResultCap)    cfg.ui.goLivesTab.searchResultCap = 250;
    if (!cfg.ui.goLivesTab.customRangeMaxMonths) cfg.ui.goLivesTab.customRangeMaxMonths = 12;
    if (!cfg.ui.goLivesTab.mode) {
      cfg.ui.goLivesTab.mode = 'legacy';
    } else {
      var goLivesTabMode = String(cfg.ui.goLivesTab.mode).toLowerCase();
      if (goLivesTabMode === 'classic') goLivesTabMode = 'legacy';
      if (goLivesTabMode !== 'legacy' && goLivesTabMode !== 'explorer') {
        Logger.log('applyConfigDefaults: invalid ui.goLivesTab.mode "' +
          cfg.ui.goLivesTab.mode + '", using legacy');
        goLivesTabMode = 'legacy';
      }
      cfg.ui.goLivesTab.mode = goLivesTabMode;
    }

    // MDS/PGL tab defaults (MDS-PGL Redesign 2026-06) — retained as csatTab alias (V2.8)
    cfg.ui.mgmPglTab = cfg.ui.mgmPglTab || {};
    if (cfg.ui.mgmPglTab.enabled === undefined) cfg.ui.mgmPglTab.enabled = true;
    if (!cfg.ui.mgmPglTab.defaultHorizon) cfg.ui.mgmPglTab.defaultHorizon = 3;
    if (!Array.isArray(cfg.ui.mgmPglTab.horizonOptions))
      cfg.ui.mgmPglTab.horizonOptions = [3, 6];
    cfg.ui.mgmPglTab.goLiveEventClusterDays =
      normalizeMgmPglGoLiveEventClusterDays_(cfg.ui.mgmPglTab.goLiveEventClusterDays);
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
    cfg.ui.viewAsReadOnly = cfg.ui.viewAsReadOnly || {};
    if (cfg.ui.viewAsReadOnly.enabled === undefined) {
      cfg.ui.viewAsReadOnly.enabled = true;
    }

    cfg.ui.webApp = cfg.ui.webApp || {};
    normalizeUiWebApp_(cfg);

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

    // Mirror deploymentHealthPlan to ui for client-side APP_UI_CONFIG access.
    cfg.ui.deploymentHealthPlan = Object.assign(
      {},
      cfg.deploymentHealthPlan,
      cfg.ui.deploymentHealthPlan || {}
    );

    // Mirror executiveWatch to ui for client-side APP_UI_CONFIG access.
    cfg.ui.executiveWatch = Object.assign(
      {},
      cfg.executiveWatch,
      cfg.ui.executiveWatch || {}
    );

    // -------------------------------------------------------------------------
    // Trends (T1)
    // -------------------------------------------------------------------------
    cfg.trends = cfg.trends || {};
    if (cfg.trends.cacheTtlSeconds === undefined)            cfg.trends.cacheTtlSeconds            = 3600;
    if (cfg.trends.trendsWindowMonths === undefined)         cfg.trends.trendsWindowMonths         = 12;
    if (cfg.trends.timeInStageOutlierMultiple === undefined) cfg.trends.timeInStageOutlierMultiple = 2;
    if (cfg.trends.timeInStageMinSampleSize === undefined)   cfg.trends.timeInStageMinSampleSize   = 10;
    if (cfg.trends.byPartnerMinSampleSize === undefined)     cfg.trends.byPartnerMinSampleSize     = 5;
    if (cfg.trends.vNextEnabled === undefined)               cfg.trends.vNextEnabled               = false;
    if (!cfg.trends.defaultWindow)                           cfg.trends.defaultWindow              = '12m';

    // Mirror trends config to ui for client-side APP_UI_CONFIG access.
    cfg.ui.trendsTab = cfg.ui.trendsTab || {};
    if (cfg.trends.vNextEnabled && cfg.ui.trendsTab.vNextEnabled === undefined) {
      cfg.ui.trendsTab.vNextEnabled = cfg.trends.vNextEnabled;
    }
    if (cfg.trends.defaultWindow && !cfg.ui.trendsTab.defaultWindow) {
      cfg.ui.trendsTab.defaultWindow = cfg.trends.defaultWindow;
    }
    cfg.ui.trends = Object.assign({}, cfg.trends, cfg.ui.trends || {});
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
    if (cfg.momentum.chartLegend != null && !Array.isArray(cfg.momentum.chartLegend)) {
      cfg.momentum.chartLegend = [];
    }
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

    // -------------------------------------------------------------------------
    // Deployment Signal / Trajectory (SLG pilot — default off)
    // -------------------------------------------------------------------------
    cfg.deploymentSignal = cfg.deploymentSignal || {};
    if (cfg.deploymentSignal.enabled === undefined) {
      cfg.deploymentSignal.enabled = false;
    }
    if (!cfg.deploymentSignal.trajectorySheetName) {
      cfg.deploymentSignal.trajectorySheetName = 'Deployment_Trajectory';
    }
    if (!cfg.deploymentSignal.actionHistorySheetName) {
      cfg.deploymentSignal.actionHistorySheetName = 'SFDC_DHPActionHistory';
    }
    if (!cfg.deploymentSignal.healthEventsSheetName) {
      cfg.deploymentSignal.healthEventsSheetName = 'Deployment_Trajectory_HealthEvents';
    }
    if (!cfg.deploymentSignal.mtpEventsSheetName) {
      cfg.deploymentSignal.mtpEventsSheetName = 'Deployment_Trajectory_MtpEvents';
    }
    if (!cfg.deploymentSignal.actionHistoryIndexSheetName) {
      cfg.deploymentSignal.actionHistoryIndexSheetName =
        'Deployment_Trajectory_ActionHistory_Index';
    }
    if (!cfg.deploymentSignal.productFunctionsSheetName) {
      cfg.deploymentSignal.productFunctionsSheetName =
        'SFDC_DeploymentProductFunctions';
    }
    if (!cfg.deploymentSignal.productFunctionHistorySheetName) {
      cfg.deploymentSignal.productFunctionHistorySheetName =
        'SFDC_DeploymentProductFunctionHistory';
    }
    if (cfg.deploymentSignal.schemaVersion === undefined) {
      cfg.deploymentSignal.schemaVersion = 2;
    }
    if (cfg.deploymentSignal.persistenceEnabled === undefined) {
      cfg.deploymentSignal.persistenceEnabled = false;
    }
    if (!cfg.deploymentSignal.signalsSheetName) {
      cfg.deploymentSignal.signalsSheetName = 'Deployment_Signals';
    }
    if (!cfg.deploymentSignal.signalHistorySheetName) {
      cfg.deploymentSignal.signalHistorySheetName = 'Deployment_Signal_History';
    }
    if (!cfg.deploymentSignal.signalRunsSheetName) {
      cfg.deploymentSignal.signalRunsSheetName = 'Deployment_Signal_Runs';
    }
    if (!cfg.deploymentSignal.signalRecordSchemaVersion) {
      cfg.deploymentSignal.signalRecordSchemaVersion = 'deployment-signal-v1';
    }

    return cfg;
  }

  /**
   * True when Executive Watch (SFDC_Wellness) is enabled for this app.
   * Default true — only explicit `executiveWatch.enabled === false` disables.
   *
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  function isExecutiveWatchEnabled(appConfig) {
    var cfg = withDefaults(appConfig || {});
    return cfg.executiveWatch.enabled !== false;
  }

  /**
   * True when the Notable Deployments feature is enabled for this app.
   * Default true — only explicit `ui.notable.enabled === false` disables.
   *
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  function isNotableEnabled(appConfig) {
    var cfg = withDefaults(appConfig || {});
    return cfg.ui.notable.enabled !== false;
  }

  /**
   * True when the Escalations feature is enabled for this app (ESC1).
   * Default false — only explicit `escalations.enabled === true` enables.
   *
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  function isEscalationsEnabled(appConfig) {
    var cfg = withDefaults(appConfig || {});
    return cfg.escalations.enabled === true;
  }

  /**
   * True when the app uses ProductMode union (EVI, AI, and future ProductMode apps).
   *
   * @param {AppConfig} appConfig
   * @return {boolean}
   */
  function isProductModeApp(appConfig) {
    var cfg = appConfig && appConfig.activeDeployments ? appConfig : withDefaults(appConfig || {});
    return !!(cfg.activeDeployments && cfg.activeDeployments.productModeUnionEnabled === true);
  }

  /**
   * Normalized deployment row field used for portfolio grouping/filtering/reporting.
   * ProductMode apps use PS Region (`region`); IndustryMode apps use `industry`.
   *
   * @param {AppConfig} appConfig
   * @return {'region'|'industry'}
   */
  function getPortfolioGroupingField(appConfig) {
    var cfg = withDefaults(appConfig || {});
    if (cfg.ui && cfg.ui.portfolioGrouping && cfg.ui.portfolioGrouping.field) {
      return cfg.ui.portfolioGrouping.field === 'region' ? 'region' : 'industry';
    }
    return isProductModeApp(cfg) ? 'region' : 'industry';
  }

  /**
   * User-facing label for the portfolio grouping dimension.
   *
   * @param {AppConfig} appConfig
   * @return {string}
   */
  function getPortfolioGroupingLabel(appConfig) {
    var cfg = withDefaults(appConfig || {});
    if (cfg.ui && cfg.ui.portfolioGrouping && cfg.ui.portfolioGrouping.label) {
      return cfg.ui.portfolioGrouping.label;
    }
    return isProductModeApp(cfg) ? 'PS Region' : 'Industry';
  }

  /**
   * Normalizes mgmPglTab.goLiveEventClusterDays (non-negative integer; default 0).
   * @param {*} raw
   * @return {number}
   */
  function normalizeMgmPglGoLiveEventClusterDays_(raw) {
    if (raw === undefined || raw === null || raw === '') return 0;
    var n = parseInt(String(raw), 10);
    if (isNaN(n) || n < 0) return 0;
    return n;
  }

  /**
   * Resolved go-live event cluster window for MDS/PGL (calendar days).
   * @param {AppConfig} appConfig
   * @return {number}
   */
  function getMgmPglGoLiveEventClusterDays(appConfig) {
    var cfg = withDefaults(appConfig || {});
    var tab = (cfg.ui && cfg.ui.mgmPglTab) || (cfg.ui && cfg.ui.csatTab) || {};
    return normalizeMgmPglGoLiveEventClusterDays_(tab.goLiveEventClusterDays);
  }

  /**
   * Parses a web app URL or base URL; strips /exec or /dev suffix when present.
   * @param {*} raw
   * @return {{ baseUrl: string, endpoint: string }}
   * @private
   */
  function parseWebAppUrlInput_(raw) {
    var s = String(raw || '').trim();
    if (!s) return { baseUrl: '', endpoint: '' };
    var q = s.indexOf('?');
    if (q >= 0) s = s.substring(0, q);
    s = s.replace(/\/+$/, '');
    var endpoint = '';
    if (s.length > 5 && s.slice(-5) === '/exec') {
      endpoint = 'exec';
      s = s.substring(0, s.length - 5);
    } else if (s.length > 4 && s.slice(-4) === '/dev') {
      endpoint = 'dev';
      s = s.substring(0, s.length - 4);
    }
    return { baseUrl: s.replace(/\/+$/, ''), endpoint: endpoint };
  }

  /**
   * Normalizes cfg.ui.webApp (baseUrl + defaultEndpoint). Does not invent baseUrl.
   * @param {AppConfig} cfg
   * @private
   */
  function normalizeUiWebApp_(cfg) {
    var wa = cfg.ui.webApp || {};
    cfg.ui.webApp = wa;

    if (wa.baseUrl) {
      var fromBase = parseWebAppUrlInput_(wa.baseUrl);
      wa.baseUrl = fromBase.baseUrl;
      if (fromBase.endpoint && !wa.defaultEndpoint) {
        wa.defaultEndpoint = fromBase.endpoint;
      }
    }

    if (!wa.baseUrl) {
      var legacySources = [
        cfg.ui.webAppUrl,
        cfg.webAppUrl,
        cfg.ui.webAppBaseUrl,
        cfg.webAppBaseUrl
      ];
      for (var i = 0; i < legacySources.length; i++) {
        if (!legacySources[i]) continue;
        var parsed = parseWebAppUrlInput_(legacySources[i]);
        if (parsed.baseUrl) {
          wa.baseUrl = parsed.baseUrl;
          if (parsed.endpoint && !wa.defaultEndpoint) {
            wa.defaultEndpoint = parsed.endpoint;
          }
          break;
        }
      }
    }

    wa.baseUrl = String(wa.baseUrl || '').trim().replace(/\/+$/, '');
    var ep = String(wa.defaultEndpoint || 'exec').trim().toLowerCase();
    if (ep !== 'exec' && ep !== 'dev') ep = 'exec';
    wa.defaultEndpoint = ep;
  }

  /**
   * Deployed web app entry URL: baseUrl + '/' + defaultEndpoint (no query).
   * @param {AppConfig} appConfig
   * @return {string}
   */
  function getWebAppEntryUrl(appConfig) {
    var cfg = withDefaults(appConfig || {});
    var wa = cfg.ui.webApp || {};
    if (!wa.baseUrl) return '';
    return wa.baseUrl + '/' + wa.defaultEndpoint;
  }

  /**
   * Href for view-as-read-only anchor links (target="_top").
   * @param {AppConfig} appConfig
   * @param {boolean} withReadOnlyPreview
   * @return {string}
   */
  function buildWebAppViewAsHref(appConfig, withReadOnlyPreview) {
    var entry = getWebAppEntryUrl(appConfig);
    if (!entry) return '';
    return withReadOnlyPreview ? entry + '?viewAs=READ_ONLY' : entry;
  }

  /**
   * Partner names excluded from Partner Analysis widgets only (trimmed config values).
   * @param {AppConfig} appConfig
   * @return {string[]}
   */
  function getPartnerAnalysisExcludePartners(appConfig) {
    var cfg = withDefaults(appConfig || {});
    var list = cfg.report.portfolioHealth.partnerAnalysis.excludePartners || [];
    if (!Array.isArray(list) || !list.length) return [];
    var out = [];
    list.forEach(function (name) {
      var trimmed = String(name || '').trim();
      if (trimmed) out.push(trimmed);
    });
    return out;
  }

  /**
   * Case-insensitive exclude lookup for partner field values.
   * @param {string} partnerName
   * @param {Object<string, boolean>} excludeLowerSet
   * @return {boolean}
   * @private
   */
  function isPartnerExcludedForAnalysis_(partnerName, excludeLowerSet) {
    if (!excludeLowerSet || !Object.keys(excludeLowerSet).length) return false;
    var key = String(partnerName || '').trim().toLowerCase();
    if (!key) return false;
    return !!excludeLowerSet[key];
  }

  /**
   * Builds lowercase-key set for partner-analysis exclusion matching.
   * @param {AppConfig} appConfig
   * @return {Object<string, boolean>}
   * @private
   */
  function getPartnerAnalysisExcludeLowerSet_(appConfig) {
    var list = getPartnerAnalysisExcludePartners(appConfig);
    var set = {};
    list.forEach(function (name) {
      set[String(name).toLowerCase()] = true;
    });
    return set;
  }

  /**
   * Filters deployment rows for Partner Analysis calculations only.
   * @param {Array<Object>} rows
   * @param {AppConfig} appConfig
   * @return {Array<Object>}
   */
  function filterRowsForPartnerAnalysis_(rows, appConfig) {
    var excludeSet = getPartnerAnalysisExcludeLowerSet_(appConfig);
    if (!Object.keys(excludeSet).length) return rows || [];
    return (rows || []).filter(function (row) {
      return !isPartnerExcludedForAnalysis_(row && row.partner, excludeSet);
    });
  }

  /**
   * HTML note shown when Partner Analysis exclusions are configured.
   * @param {AppConfig} appConfig
   * @return {string}
   */
  function buildPartnerAnalysisExcludeNoteHtml_(appConfig) {
    var list = getPartnerAnalysisExcludePartners(appConfig);
    if (!list.length) return '';
    var escaped = list.map(function (name) {
      return CoreUtils.escapeHtml(name);
    }).join(', ');
    return '<p style="font-size:10px;color:#64748b;margin:6px 0 0 0;font-family:Arial,sans-serif;">' +
      'Excludes: ' + escaped + '</p>';
  }

  return {
    withDefaults: withDefaults,
    isExecutiveWatchEnabled: isExecutiveWatchEnabled,
    isNotableEnabled: isNotableEnabled,
    isEscalationsEnabled: isEscalationsEnabled,
    isProductModeApp: isProductModeApp,
    getPortfolioGroupingField: getPortfolioGroupingField,
    getPortfolioGroupingLabel: getPortfolioGroupingLabel,
    getMgmPglGoLiveEventClusterDays: getMgmPglGoLiveEventClusterDays,
    normalizeMgmPglGoLiveEventClusterDays_: normalizeMgmPglGoLiveEventClusterDays_,
    getWebAppEntryUrl: getWebAppEntryUrl,
    buildWebAppViewAsHref: buildWebAppViewAsHref,
    getPartnerAnalysisExcludePartners: getPartnerAnalysisExcludePartners,
    filterRowsForPartnerAnalysis_: filterRowsForPartnerAnalysis_,
    buildPartnerAnalysisExcludeNoteHtml_: buildPartnerAnalysisExcludeNoteHtml_
  };
})();