/**
 * CoreUI_Markup.gs
 *
 * Provides body shell and head scripts for the WebApp UI. Defines top-level
 * helper functions that CoreUI.gs calls on demand:
 *   - _CoreUI_Markup_getHeadScripts()
 *   - _CoreUI_Markup_getAppShell(cfg)
 *
 * Phase history:
 *   Phase 0 (v8): introduced as part of the CoreUI scaffolding.
 *   Phase 1 (v9): header redesigned to card+strip+W mark; pill status badges;
 *                 unified filter card.
 *   Phase 2 (v10): header gains right-side personalization toggle (DDs) or
 *                  DD-dropdown (VPs/PMs); welcome banner; Deployments tab
 *                  filter chips + drawer + expandable rows + dynamic KPI cards;
 *                  Go Lives consolidates into one tab with toggle; Upcoming
 *                  tab markup removed; Manage Overrides tab added; edit modal
 *                  gains classification selector; confirmation modal added.
 *   Phase 3a (v11): Portfolio Health gains "Phased Go-Lives" KPI tile.
 *                   Deployment row expanded-detail section updated to show
 *                   upcomingDates[] for phased rows (rendered by CoreUI_Js.js).
 *                   Phased pill badge injected by CoreUI_Js.js — no new columns.
 *   Phase 3g (v12): Trends tab added — five-tier layout: Time-in-Red KPI strip,
 *                   Health Trajectory + By-Partner stacked bars, Health by DD
 *                   table, Time-in-Stage / Time-to-Go-Live cards, and Go-Live
 *                   Outcome Patterns. Rendered entirely by JS after data fetch.
 *   Notable (Part 3): Notable Deployments tab added — tab shell, edit modal
 *                   (two-column layout with read-only context pane + editable
 *                   form), and add-picker modal. Modals rendered inside
 *                   buildNotableTab_ and gated by roleVisibility (POWER_USER
 *                   only). Registered in getAppShell after portfolio tab.
 *
 * Approved by Jeff in Phase 2 Design Brief 7joemhuqDkrv on 2026-06-09 14:07 EDT.
 *
 * IMPORTANT: This file is large enough that it ships across two chat messages
 * (Part A + Part B). Paste Part A first, then append Part B before saving.
 */

// ---------------------------------------------------------------------------
// HEAD SCRIPTS
// ---------------------------------------------------------------------------

function _CoreUI_Markup_getHeadScripts() {
  return '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>';
}

// ---------------------------------------------------------------------------
// APP SHELL ORCHESTRATOR
// ---------------------------------------------------------------------------

function _CoreUI_Markup_getAppShell(cfg, userAccess) {
  var ui = cfg.ui || {};
  var access = userAccess || { role: 'READ_ONLY', canViewApp: true, email: '' };
  var role = access.role || 'READ_ONLY';
  var isReadOnly = (role === 'READ_ONLY');

  // Stage 1: filter the tab list by roleVisibility before passing to builders.
  var roleVis = ui.roleVisibility || {};
  var allowedForRole = Array.isArray(roleVis[role]) ? roleVis[role] : null;
  var allowedSet = null;
  if (allowedForRole) {
    allowedSet = {};
    allowedForRole.forEach(function (id) { allowedSet[id] = true; });
  }
  function _isTabAllowed(id) {
    if (!allowedSet) return true; // no filter -> show everything
    return !!allowedSet[id];
  }

  // Pre-filter the tabs array so the tab BAR builder also reflects the filter.
  var filteredUi = Object.assign({}, ui, {
    tabs: (ui.tabs || []).filter(function (t) { return _isTabAllowed(t.id); }),
    // Read-only flag for builders that need to hide in-tab controls.
    _accessRole: role,
    _isReadOnly: isReadOnly,
    overviewTab: cfg.overviewTab || {}
  });

  var parts = [];

  parts.push(_CoreUI_Markup_buildHeader_(filteredUi));
  parts.push('<div class="container">');

  // Welcome banner placeholder — JS populates and shows/hides based on user role.
  parts.push(_CoreUI_Markup_buildWelcomeBannerPlaceholder_());

  parts.push(_CoreUI_Markup_buildTabBar_(filteredUi));

  var tabIds = filteredUi.tabs.map(function (t) { return t.id; });

  if (filteredUi.overviewTab && filteredUi.overviewTab.enabled !== false) parts.push(_CoreUI_Markup_buildOverviewTab_());
  if (tabIds.indexOf('deployments') !== -1) parts.push(_CoreUI_Markup_buildDeploymentsTab_(filteredUi));
  if (tabIds.indexOf('golives') !== -1) parts.push(_CoreUI_Markup_buildGoLivesTab_(filteredUi));
  if (tabIds.indexOf('mgmPgl') !== -1 && ui.mgmPglTab && ui.mgmPglTab.enabled) parts.push(_CoreUI_Markup_buildMgmPglTab_(filteredUi));
  if (tabIds.indexOf('execsummary') !== -1 || tabIds.indexOf('report') !== -1) parts.push(_CoreUI_Markup_buildReportingTab_(filteredUi, cfg));
  if (tabIds.indexOf('portfolio') !== -1) parts.push(_CoreUI_Markup_buildPortfolioTab_(filteredUi));
  if (tabIds.indexOf('notable') !== -1) parts.push(_CoreUI_Markup_buildNotableTab_(filteredUi));
  if (tabIds.indexOf('overrides') !== -1) parts.push(_CoreUI_Markup_buildOverridesTab_(filteredUi));
  if (tabIds.indexOf('trends') !== -1 && ui.trendsTab && ui.trendsTab.enabled) parts.push(_CoreUI_Markup_buildTrendsTab_(filteredUi));

  parts.push('</div>'); // .container

  // Executive Watch modal — informational, available to all roles.
  parts.push(_CoreUI_Markup_buildExecWatchModal_());

  // Modals — only included for power users (read-only never opens them).
  if (!isReadOnly) {
    parts.push(_CoreUI_Markup_buildMetaModal_(filteredUi));
    parts.push(_CoreUI_Markup_buildEditModal_(filteredUi));
    parts.push(_CoreUI_Markup_buildGoLivesModal_(filteredUi));
    parts.push(_CoreUI_Markup_buildConfirmModal_(filteredUi));
    parts.push(_CoreUI_Markup_buildAuditDetailModal_(filteredUi));
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// HEADER (Phase 1 + Phase 2 right-region for toggle/dropdown)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildHeader_(ui) {
  return [
    '<div class="header">',
    '  <div class="header-strip">',
    '    ' + _CoreUI_Markup_workdayWMarkSvg_(),
    '  </div>',
    '  <div class="header-body">',
    '    <h1>' + _CoreUI_Markup_esc_(ui.headerTitle || 'Deployment Health Manager') + '</h1>',
    '    <p>' + _CoreUI_Markup_esc_(ui.headerSubtitle || 'Review and manage deployment data across all stages') + '</p>',
    '  </div>',
    // Phase 2: right-side region. JS populates with toggle or dropdown depending
    // on user role. Hidden entirely for anonymous/unknown users.
    '  <div class="header-right hidden" id="header-right">',
    '    <div id="header-mode-control"></div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

function _CoreUI_Markup_workdayWMarkSvg_() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1540 2000" width="24" height="24" aria-label="Workday">',
    '  <g><g>',
    '    <path fill="#FFFFFF" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/>',
    '    <path fill="#FFFFFF" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/>',
    '  </g></g>',
    '</svg>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// WELCOME BANNER PLACEHOLDER (Phase 2)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildWelcomeBannerPlaceholder_() {
  // Hidden by default; JS shows it for DDs on first session.
  return [
    '<div id="welcome-banner" class="welcome-banner hidden">',
    '  <div class="welcome-banner-content">',
    '    <span id="welcome-banner-text"></span>',
    '  </div>',
    '  <button class="welcome-banner-close" onclick="dismissWelcomeBanner()" aria-label="Dismiss">&times;</button>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB BAR
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildTabBar_(ui) {
  var tabs = ui.tabs || [];
  var hasOverview = ui.overviewTab && ui.overviewTab.enabled !== false;
  var html = ['<div class="tabs">'];
  if (hasOverview) {
    html.push('  <button class="tab active" onclick="switchTab(\'overview\')">Overview</button>');
  }
  var reportingInjected = false;
  tabs.forEach(function (t) {
    // Merge the standalone execsummary + report tabs into one Reporting button.
    if (t.id === 'execsummary' || t.id === 'report') {
      if (!reportingInjected) {
        html.push('  <button class="tab" onclick="switchTab(\'reporting\')">Reporting</button>');
        reportingInjected = true;
      }
      return;
    }
    html.push(
      '  <button class="tab" onclick="switchTab(\'' + _CoreUI_Markup_esc_(t.id) + '\')">' +
      _CoreUI_Markup_esc_(t.label) +
      '</button>'
    );
  });
  html.push('</div>');
  return html.join('\n');
}

// ---------------------------------------------------------------------------
// TAB: DEPLOYMENTS (Phase 2 — full portfolio with filter chips + expandable rows)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildDeploymentsTab_(ui) {
  var dt = ui.deploymentsTable || {};
  var showIndustry = !!dt.showIndustry;
  var showEm       = !!dt.showEmColumn;
  var ownerLabel   = dt.ownerColumnLabel || 'Delivery Director';
  var searchPh     = dt.searchPlaceholder || 'Search by account, deployment name, partner...';
  var expandable   = dt.expandableRows !== false;  // default true

  // Build column headers. The leftmost column is the chevron when expandable.
  var headers = [];
  if (expandable) headers.push('<th style="width: 24px;"></th>');
  headers.push('<th>Health</th>');
  headers.push('<th>Account Name</th>');
  if (showIndustry) headers.push('<th>Industry</th>');
  headers.push('<th>Deployment Name</th>');
  headers.push('<th>Partner</th>');
  if (showEm) headers.push('<th>EM</th>');
  headers.push('<th>MTP Date</th>');
  if (!showEm) headers.push('<th>' + _CoreUI_Markup_esc_(ownerLabel) + '</th>');
  // Stage 1: hide Actions and Meta Info columns for read-only users.
  if (!ui._isReadOnly) {
    headers.push('<th>Actions</th>');
    headers.push('<th>Meta Info</th>');
  }

  return [
    '<div id="deployments-tab" class="tab-content">',
    '  <div class="info-banner">',
    '    📊 Review all deployments. Use filters below to narrow by health, partner, owner, stage, or industry.',
    '  </div>',
    // Dynamic KPI cards — populated by JS based on current filter state.
    '  <div class="stats-grid" id="deployments-stats-grid"></div>',
    // Filter card with primary row and collapsible drawer
    '  <div class="control-bar">',
    '    <div class="control-row">',
    '      <div class="search-box">',
    '        <span class="search-icon">🔍</span>',
    '        <input type="text" id="search-input" placeholder="' + _CoreUI_Markup_attr_(searchPh) + '" onkeyup="searchDeployments()">',
    '      </div>',
    '      <button class="btn btn-secondary" onclick="clearAllDeploymentFilters()">Clear</button>',
    '    </div>',
    '    <div class="control-row">',
    '      <span class="filter-label">Health:</span>',
    '      <div class="filter-group" id="health-chip-group">',
    // Health chips are rendered/wired by JS so the active set reflects defaultHealthFilter.
    '      </div>',
    '      <button id="exec-watch-chip" class="filter-chip" onclick="toggleExecWatchFilter()">&#x26A0; Executive Watch</button>',
    '      <span class="filter-label" style="margin-left: var(--space-3);">Owner:</span>',
    '      <select id="owner-filter" class="filter-select" onchange="onDeploymentFilterChange()"></select>',
    '      <button class="filter-drawer-toggle" id="filter-drawer-toggle" onclick="toggleFilterDrawer()">',
    '        <span id="filter-drawer-toggle-icon">⊕</span>',
    '        <span id="filter-drawer-toggle-text">More filters</span>',
    '        <span id="filter-drawer-toggle-badge" class="badge hidden">0</span>',
    '      </button>',
    '    </div>',
    '    <div class="filter-drawer" id="filter-drawer">',
    '      <span class="filter-label">Partner:</span>',
    '      <select id="partner-filter" class="filter-select" onchange="onDeploymentFilterChange()"></select>',
    '      <span class="filter-label">Stage:</span>',
    '      <select id="stage-filter" class="filter-select" onchange="onDeploymentFilterChange()"></select>',
    (showIndustry
      ? '      <span class="filter-label">Industry:</span>\n' +
        '      <select id="industry-filter" class="filter-select" onchange="onDeploymentFilterChange()"></select>'
      : ''),
    '    </div>',
    '  </div>',
    '  <div class="table-container">',
    '    <div class="table-wrapper">',
    '      <table id="deployments-table">',
    '        <thead><tr>' + headers.join('') + '</tr></thead>',
    '        <tbody id="deployments-tbody"></tbody>',
    '      </table>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: GO LIVES (Phase 2 — consolidated Recent/Upcoming/All with toggle)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildGoLivesTab_(ui) {
  var gt = ui.goLivesTable || {};
  var glt = ui.goLivesTab || {};
  var showIndustry = !!gt.showIndustry;
  var searchPh = gt.searchPlaceholder || 'Search by account name...';
  var defaultView = glt.defaultView || 'recent';
  var recentDays = glt.recentWindowDays || 60;
  var upcomingDays = glt.upcomingWindowDays || 90;

  // Toggle buttons — JS marks the right one active based on defaultView.
  function segBtn(id, label, isActive) {
    return '<button class="seg-control-btn' + (isActive ? ' active' : '') +
           '" data-golives-view="' + id + '" onclick="switchGoLivesView(\'' + id + '\')">' +
           _CoreUI_Markup_esc_(label) + '</button>';
  }

  // Column headers — context-sensitive labels set by JS based on current view.
  var headers = [
    '<th id="golives-date-header">Date</th>',
    '<th>Account Name</th>'
  ];
  if (showIndustry) headers.push('<th>Industry</th>');
  headers.push('<th id="golives-product-header">Product / Deployment</th>');
  headers.push('<th>Partner</th>');
  // Stage 1: hide Actions column for read-only users.
  if (!ui._isReadOnly) {
    headers.push('<th>Actions</th>');
  }

  return [
    '<div id="golives-tab" class="tab-content">',
    '  <div class="info-banner">',
    '    📅 Go Lives &mdash; recent past and upcoming, in one place.',
    '  </div>',
    '  <div class="seg-control" style="margin-bottom: var(--space-3);">',
    '    ' + segBtn('recent',   'Recent (' + recentDays + ' days)',   defaultView === 'recent'),
    '    ' + segBtn('upcoming', 'Upcoming (' + upcomingDays + ' days)', defaultView === 'upcoming'),
    '    ' + segBtn('all',      'All',                                  defaultView === 'all'),
    '  </div>',
    '  <div class="control-bar">',
    '    <div class="control-row">',
    '      <div class="search-box">',
    '        <span class="search-icon">🔍</span>',
    '        <input type="text" id="golives-search" placeholder="' + _CoreUI_Markup_attr_(searchPh) + '" onkeyup="searchGoLives()">',
    '      </div>',
    '      <button class="btn btn-secondary" onclick="clearGoLivesSearch()">Clear</button>',
    '    </div>',
    '  </div>',
    '  <div class="table-container">',
    '    <div class="table-wrapper">',
    '      <table id="golives-table">',
    '        <thead><tr>' + headers.join('') + '</tr></thead>',
    '        <tbody id="golives-tbody"></tbody>',
    '      </table>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: MGM / PGL (feature/mgm-pgl)
// ---------------------------------------------------------------------------

/**
 * Builds the MGM / PGL tab markup.
 * Two sections:
 *   1. Upcoming survey rows table (MGM + PGL within 30-day window).
 *   2. Exceptions table — Active deployments missing required target dates.
 *
 * @param {Object} ui  cfg.ui
 * @return {string}
 */
function _CoreUI_Markup_buildMgmPglTab_(ui) {
  return [
    '<div id="mgmPgl-tab" class="tab-content">',

    '  <!-- Info banner -->',
    '  <div class="info-banner">',
    '    \uD83D\uDCCB MDS / PGL &mdash; upcoming Mid-Deployment and Post-Go-Live surveys for Active deployments.',
    '    Toggle between <strong>My Portfolio</strong> and <strong>All</strong> using the control in the header.',
    '  </div>',

    '  <!-- Toolbar: refresh + loading indicator + as-of caption -->',
    '  <div class="trends-toolbar no-export">',
    '    <button class="btn btn-secondary" onclick="loadMgmPglTab()">&#x1F504; Refresh</button>',
    '    <span id="mgmpgl-loading-indicator" class="trends-loading hidden">',
    '      <span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px;"></span>',
    '      Loading&hellip;',
    '    </span>',
    '    <span id="mgmpgl-as-of" style="margin-left:auto;font-size:12px;color:var(--color-text-muted);"></span>',
    '  </div>',

    '  <!-- Time window segmented control -->',
    '  <div class="control-bar" style="margin-bottom:0;">',
    '    <div class="control-row">',
    '      <div class="seg-control" id="mgmPgl-window-toggle" role="group" aria-label="Time window">',
    '        <button class="seg-control-btn active" data-mgmPgl-window="next30"',
    '                onclick="setMgmPglWindow(\'next30\')">Next 30 days</button>',
    '        <button class="seg-control-btn" data-mgmPgl-window="thisMonth"',
    '                onclick="setMgmPglWindow(\'thisMonth\')">This Month</button>',
    '        <button class="seg-control-btn" data-mgmPgl-window="nextMonth"',
    '                onclick="setMgmPglWindow(\'nextMonth\')">Next Month</button>',
    '        <button class="seg-control-btn" data-mgmPgl-window="thisQuarter"',
    '                onclick="setMgmPglWindow(\'thisQuarter\')">This Quarter</button>',
    '        <button class="seg-control-btn" data-mgmPgl-window="nextQuarter"',
    '                onclick="setMgmPglWindow(\'nextQuarter\')">Next Quarter</button>',
    '      </div>',
    '    </div>',
    '  </div>',

    '  <!-- Filter bar: survey type + search -->',
    '  <div class="control-bar">',
    '    <div class="control-row">',
    '      <!-- Survey type segmented control -->',
    '      <div class="seg-control" role="group" aria-label="Survey type filter">',
    '        <button class="seg-control-btn active" data-mgmpgl-type="all"',
    '                onclick="setMgmPglFilterType(\'all\')">All</button>',
    '        <button class="seg-control-btn" data-mgmpgl-type="MGM"',
    '                onclick="setMgmPglFilterType(\'MGM\')">MDS</button>',
    '        <button class="seg-control-btn" data-mgmpgl-type="PGL"',
    '                onclick="setMgmPglFilterType(\'PGL\')">PGL</button>',
    '      </div>',
    '      <!-- Text search -->',
    '      <div class="search-box">',
    '        <span class="search-icon">&#x1F50D;</span>',
    '        <input type="text" id="mgmpgl-search"',
    '               placeholder="Search by account or deployment&hellip;"',
    '               onkeyup="searchMgmPgl()">',
    '      </div>',
    '      <button class="btn btn-secondary" onclick="clearMgmPglSearch()">Clear</button>',
    '    </div>',
    '  </div>',

    '  <!-- ================================================================ -->',
    '  <!-- SECTION 1: Upcoming Survey Rows                                  -->',
    '  <!-- ================================================================ -->',
    '  <div class="table-container">',
    '    <div class="table-wrapper">',
    '      <table id="mgmpgl-table">',
    '        <thead><tr>',
    '          <th>Schedule</th>',
    '          <th>In</th>',
    '          <th>Account</th>',
    '          <th>Deployment</th>',
    '          <th>Start</th>',
    '          <th>Target End</th>',
    '          <th>Contacts</th>',
    '        </tr></thead>',
    '        <tbody id="mgmpgl-tbody"></tbody>',
    '      </table>',
    '    </div>',
    '  </div>',

    '  <!-- ================================================================ -->',
    '  <!-- SECTION 2: Exceptions — Missing Target Dates                     -->',
    '  <!-- ================================================================ -->',
    '  <div class="trends-section" id="mgmpgl-exceptions-section" style="margin-top:var(--space-5);">',
    '    <div class="trends-section-header">',
    '      <span class="trends-section-title">Exceptions &mdash; Missing Target Dates</span>',
    '      <span class="trends-section-sub" id="mgmpgl-exceptions-sub"></span>',
    '    </div>',
    '    <p style="font-size:13px;color:var(--color-text-muted);margin:0 0 var(--space-3) 0;">',
    '      Active deployments that are missing dates needed to schedule surveys.',
    '      These records should be updated in Salesforce.',
    '    </p>',
    '    <div class="table-wrapper">',
    '      <table id="mgmpgl-exceptions-table">',
    '        <thead><tr>',
    '          <th>Account</th>',
    '          <th>Deployment</th>',
    '          <th>Missing</th>',
    '          <th>Type</th>',
    '          <th>Start Date</th>',
    '          <th>Delivery Director</th>',
    '        </tr></thead>',
    '        <tbody id="mgmpgl-exceptions-tbody"></tbody>',
    '      </table>',
    '    </div>',
    '  </div>',

    '</div>' // #mgmPgl-tab
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: OVERVIEW (App Enhancements Phase 1)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildOverviewTab_() {
  return [
    '<div id="overview-tab" class="tab-content active">',
    '  <div class="info-banner">',
    '    📋 Portfolio snapshot — KPIs, upcoming Go-Lives, and at-risk deployments. Data loads in the background.',
    '  </div>',
    '  <div class="stats-grid" id="overview-kpi-strip"></div>',
    '  <div class="stats-grid" id="overview-golives-strip" style="margin-top:var(--space-3);"></div>',
    '  <div id="overview-lists" style="display:flex; gap:var(--space-4); margin-top:var(--space-4); flex-wrap:wrap;">',
    '    <div style="flex:1; min-width:280px;">',
    '      <h3 style="margin:0 0 var(--space-2); font-size:0.875rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em;">Top Red — Soonest MTP</h3>',
    '      <div id="overview-top-red"></div>',
    '    </div>',
    '    <div style="flex:1; min-width:280px;">',
    '      <h3 style="margin:0 0 var(--space-2); font-size:0.875rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em;">Upcoming Go-Lives (Next 30d)</h3>',
    '      <div id="overview-upcoming"></div>',
    '    </div>',
    '  </div>',
    '  <div style="margin-top:var(--space-4);">',
    '    <h3 style="margin:0 0 var(--space-2); font-size:0.875rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em;">Deployments by Stage</h3>',
    '    <div id="overview-stage-strip" style="display:flex; flex-wrap:wrap; gap:var(--space-2);"></div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: EXECUTIVE SUMMARY (unchanged from Phase 1)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildExecSummaryTab_(ui) {
  return [
    '<div id="execsummary-tab" class="tab-content">',
    '  <div class="info-banner">',
    '    📝 Use this editor to draft or paste the monthly <strong>Executive Summary</strong>. The styled content is saved and included at the top of the Monthly HTML Report.',
    '  </div>',
    '  <div class="control-bar" style="align-items: flex-start;">',
    '    <div style="flex: 1; min-width: 250px;">',
    '      <p style="margin: 0 0 0.5rem 0; color: var(--color-text-muted); font-size: 12px;">',
    '        Paste or type formatted text below (headings, bold, lists, etc.).',
    '      </p>',
    '      <div id="exec-editor" contenteditable="true" style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); min-height: 200px; padding: 12px; font-size: 14px; line-height: 1.5; overflow-y: auto;"></div>',
    '    </div>',
    '    <div class="filter-group" style="flex-direction: column; align-items: flex-end; gap: 8px;">',
    '      <button class="btn btn-secondary" onclick="loadExecSummaryFromServer()">⬇ Load Saved</button>',
    '      <button class="btn btn-primary" onclick="saveExecSummaryToServer()">💾 Save Executive Summary</button>',
    '    </div>',
    '  </div>',
    '  <p style="font-size: 12px; color: var(--color-text-subtle); margin-top: 8px;">',
    '    Tip: You can paste formatted content from Docs/Word; most basic formatting (bold, italics, lists) will be preserved.',
    '  </p>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: MONTHLY REPORT PREVIEW (Phase 1 + Phase 2 full-portfolio indicator)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildReportTab_(ui, cfg) {
  var reportTitle = (cfg.report && cfg.report.title) || 'Deployment Health Status Report';
  var showIndicator = ui.personalization && ui.personalization.enabled &&
                      ui.personalization.showFullPortfolioIndicator !== false;
  return [
    '<div id="report-tab" class="tab-content">',
    (showIndicator
      ? '  <div class="full-portfolio-indicator">\u2139\uFE0F This view always reflects the full team \u2014 used for external communication.</div>'
      : ''),
    '  <div class="info-banner">',
    '    \uD83D\uDCC4 Preview of the monthly <strong>' + _CoreUI_Markup_esc_(reportTitle) + '</strong> \u2013 same HTML as the menu-based preview.',
    '  </div>',
    '  <div class="control-bar">',
    '    <div class="control-row" style="justify-content: space-between; align-items: center;">',
    '      <div class="seg-control" id="report-view-toggle" role="group" aria-label="Report view format">',
    '        <button class="seg-control-btn active" data-report-view="outlook" onclick="switchReportView(\'outlook\')">Outlook View</button>',
    '        <button class="seg-control-btn" data-report-view="inline" onclick="switchReportView(\'inline\')">Inline View</button>',
    '      </div>',
    '      <button class="btn btn-primary" onclick="loadReportPreview()">\uD83D\uDD04 Refresh Report</button>',
    '    </div>',
    '    <div class="control-row">',
    '      <p style="margin: 0; color: var(--color-text-muted); font-size: 13px;">',
    '        <strong>Outlook View</strong> is optimized for email clients. <strong>Inline View</strong> uses modern HTML for browser reading.',
    '      </p>',
    '    </div>',
    '  </div>',
    '  <div class="table-container" style="padding: 0;">',
    '    <div id="report-preview-container" style="padding: 24px; min-height: 400px;">',
    '      <div style="text-align: center; padding: 48px 24px; color: var(--color-text-subtle);">',
    '        <p>Click \u201cRefresh Report\u201d to load the monthly report preview</p>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: REPORTING — consolidated Executive Summary + Monthly Report Preview
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildReportingTab_(ui, cfg) {
  var reportTitle = (cfg.report && cfg.report.title) || 'Deployment Health Status Report';
  var showIndicator = ui.personalization && ui.personalization.enabled &&
                      ui.personalization.showFullPortfolioIndicator !== false;
  return [
    '<div id="reporting-tab" class="tab-content">',
    '  <div class="seg-control" style="margin-bottom: var(--space-3);">',
    '    <button class="seg-control-btn active" data-reporting-view="execsummary"',
    '            onclick="switchReportingView(\'execsummary\')">Executive Summary</button>',
    '    <button class="seg-control-btn" data-reporting-view="report"',
    '            onclick="switchReportingView(\'report\')">Monthly Report</button>',
    '  </div>',
    '  <div id="reporting-execsummary-section">',
    '    <div class="info-banner">',
    '      \uD83D\uDCDD Use this editor to draft or paste the monthly <strong>Executive Summary</strong>. The styled content is saved and included at the top of the Monthly HTML Report.',
    '    </div>',
    '    <div class="control-bar" style="align-items: flex-start;">',
    '      <div style="flex: 1; min-width: 250px;">',
    '        <p style="margin: 0 0 0.5rem 0; color: var(--color-text-muted); font-size: 12px;">',
    '          Paste or type formatted text below (headings, bold, lists, etc.).',
    '        </p>',
    '        <div id="exec-editor" contenteditable="true" style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); min-height: 200px; padding: 12px; font-size: 14px; line-height: 1.5; overflow-y: auto;"></div>',
    '      </div>',
    '      <div class="filter-group" style="flex-direction: column; align-items: flex-end; gap: 8px;">',
    '        <button class="btn btn-secondary" onclick="loadExecSummaryFromServer()">\u2B07 Load Saved</button>',
    '        <button class="btn btn-primary" onclick="saveExecSummaryToServer()">\uD83D\uDCBE Save Executive Summary</button>',
    '      </div>',
    '    </div>',
    '    <p style="font-size: 12px; color: var(--color-text-subtle); margin-top: 8px;">',
    '      Tip: You can paste formatted content from Docs/Word; most basic formatting (bold, italics, lists) will be preserved.',
    '    </p>',
    '  </div>',
    '  <div id="reporting-report-section" style="display:none;">',
    (showIndicator
      ? '    <div class="full-portfolio-indicator">\u2139\uFE0F This view always reflects the full team \u2014 used for external communication.</div>'
      : ''),
    '    <div class="info-banner">',
    '      \uD83D\uDCC4 Preview of the monthly <strong>' + _CoreUI_Markup_esc_(reportTitle) + '</strong> \u2013 same HTML as the menu-based preview.',
    '    </div>',
    '    <div class="control-bar">',
    '      <div class="control-row" style="justify-content: space-between; align-items: center;">',
    '        <div class="seg-control" id="report-view-toggle" role="group" aria-label="Report view format">',
    '          <button class="seg-control-btn active" data-report-view="outlook" onclick="switchReportView(\'outlook\')">Outlook View</button>',
    '          <button class="seg-control-btn" data-report-view="inline" onclick="switchReportView(\'inline\')">Inline View</button>',
    '        </div>',
    '        <button class="btn btn-primary" onclick="loadReportPreview()">\uD83D\uDD04 Refresh Report</button>',
    '      </div>',
    '      <div class="control-row">',
    '        <p style="margin: 0; color: var(--color-text-muted); font-size: 13px;">',
    '          <strong>Outlook View</strong> is optimized for email clients. <strong>Inline View</strong> uses modern HTML for browser reading.',
    '        </p>',
    '      </div>',
    '    </div>',
    '    <div class="table-container" style="padding: 0;">',
    '      <div id="report-preview-container" style="padding: 24px; min-height: 400px;">',
    '        <div style="text-align: center; padding: 48px 24px; color: var(--color-text-subtle);">',
    '          <p>Click \u201cRefresh Report\u201d to load the monthly report preview</p>',
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: PORTFOLIO HEALTH (Phase 1 + Phase 2 full-portfolio indicator)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildPortfolioTab_(ui) {
  var showIndicator = ui.personalization && ui.personalization.enabled &&
                      ui.personalization.showFullPortfolioIndicator !== false;
  return [
    '<div id="portfolio-tab" class="tab-content">',
    (showIndicator
      ? '  <div class="full-portfolio-indicator">\u2139\uFE0F This view always reflects the full team \u2014 used for external communication.</div>'
      : ''),
    '  <div class="info-banner">',
    '    📤 Snapshot of overall portfolio health. Use <strong>Download PNG</strong> to export a slide-ready image.',
    '  </div>',
    '  <div class="ph-toolbar no-export">',
    '    <button class="btn btn-secondary" onclick="loadPortfolioHealth()" style="margin-right: 8px;">🔄 Refresh</button>',
    (ui._isReadOnly ? '' : '    <button class="btn btn-primary" onclick="downloadPortfolioHealthPng()">⬇ Download PNG <span id="ph-spinner" class="spinner hidden"></span></button>'),
    '  </div>',
    '  <div id="ph-canvas" class="ph-canvas">',
    '    <div class="report-loading" id="ph-loading">',
    '      <div class="spinner-large"></div>',
    '      <p>Loading Portfolio Health&hellip;</p>',
    '    </div>',
    '    <div id="ph-content" class="hidden">',
    '      <div class="ph-header">',
    '        <div>',
    '          <div class="ph-title" id="ph-title">Portfolio Health</div>',
    '          <div class="ph-meta" id="ph-subtitle"></div>',
    '        </div>',
    '        <div class="ph-meta" id="ph-month"></div>',
    '      </div>',
    '      <div class="ph-kpis">',
    '        <div class="ph-kpi" data-key="total">',
    '          <div class="ph-kpi-label">Total Active</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-total">&ndash;</div>',
    '            <div class="ph-trend" id="ph-trend-total"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub">Green + Yellow + Red</div>',
    '          <svg class="ph-spark" id="ph-spark-total" preserveAspectRatio="none"></svg>',
    '        </div>',
    '        <div class="ph-kpi green" data-key="green">',
    '          <div class="ph-kpi-label">Green</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-green">&ndash;</div>',
    '            <div class="ph-trend" id="ph-trend-green"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub" id="ph-kpi-green-pct"></div>',
    '          <svg class="ph-spark" id="ph-spark-green" preserveAspectRatio="none"></svg>',
    '        </div>',
    '        <div class="ph-kpi yellow" data-key="yellow">',
    '          <div class="ph-kpi-label">Yellow</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-yellow">&ndash;</div>',
    '            <div class="ph-trend" id="ph-trend-yellow"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub" id="ph-kpi-yellow-pct"></div>',
    '          <svg class="ph-spark" id="ph-spark-yellow" preserveAspectRatio="none"></svg>',
    '        </div>',
    '        <div class="ph-kpi red" data-key="red">',
    '          <div class="ph-kpi-label">Red</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-red">&ndash;</div>',
    '            <div class="ph-trend" id="ph-trend-red"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub" id="ph-kpi-red-pct"></div>',
    '          <svg class="ph-spark" id="ph-spark-red" preserveAspectRatio="none"></svg>',
    '        </div>',
    // Phase 3a: Phased Go-Lives KPI tile
    '        <div class="ph-kpi phased" data-key="phased">',
    '          <div class="ph-kpi-label">Phased Go-Lives</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-phased">&ndash;</div>',
    '          </div>',
    '          <div class="ph-kpi-sub">Upcoming (' + (((ui || {}).goLivesTab || {}).upcomingWindowDays || 90) + ' days)</div>',
    '        </div>',
    '      </div>',
    '      <div class="ph-grid">',
    '        <div class="ph-col">',
    '          <div class="ph-card">',
    '            <div class="ph-card-title"><span>Current Red Projects</span><span class="ph-count" id="ph-red-count">0</span></div>',
    '            <div class="ph-list" id="ph-red-list"></div>',
    '          </div>',
    '          <div class="ph-card">',
    '            <div class="ph-card-title"><span>Current Yellow Projects</span><span class="ph-count" id="ph-yellow-count">0</span></div>',
    '            <div class="ph-list" id="ph-yellow-list"></div>',
    '          </div>',
    '          <div class="ph-card">',
    '            <div class="ph-card-title"><span id="ph-golives-title">WD Prime Go Lives &mdash; Last 60 Days</span><span class="ph-count" id="ph-golives-count">0</span></div>',
    '            <div class="ph-list" id="ph-golives-list"></div>',
    '          </div>',
    '        </div>',
    '        <div class="ph-col">',
    '          <div class="ph-card">',
    '            <div class="ph-card-title"><span>Health Distribution</span></div>',
    '            <div class="ph-stacked" id="ph-stacked"></div>',
    '            <div class="ph-stacked-legend">',
    '              <span><span class="ph-legend-swatch" style="background: #10b981;"></span>Green</span>',
    '              <span><span class="ph-legend-swatch" style="background: #f59e0b;"></span>Yellow</span>',
    '              <span><span class="ph-legend-swatch" style="background: #ef4444;"></span>Red</span>',
    '            </div>',
    '          </div>',
    '          <div class="ph-card">',
    '            <div class="ph-card-title"><span>Workday vs Partners/Other</span></div>',
    '            <table class="ph-split-table" id="ph-partner-table"></table>',
    '            <div class="ph-stacked-legend">',
    '              <span><span class="ph-legend-swatch" style="background: #0f4c81;"></span><span id="ph-workday-legend">Workday</span></span>',
    '              <span><span class="ph-legend-swatch" style="background: #64748b;"></span><span id="ph-other-legend">Partners/Other</span></span>',
    '            </div>',
    '          </div>',
    '          <div class="ph-card">',
    '            <div class="ph-card-title"><span>Industry Analysis</span></div>',
    '            <table class="ph-split-table" id="ph-industry-table"></table>',
    '            <div class="ph-stacked-legend" id="ph-industry-legend"></div>',
    '          </div>',
    '        </div>',
    '      </div>',
    '      <div class="ph-footer">',
    '        <span class="ph-confidential">Workday Confidential</span>',
    '        <span id="ph-generated"></span>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: MANAGE OVERRIDES (Phase 2 — entirely new)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildOverridesTab_(ui) {
  var mo = ui.manageOverrides || {};
  var showAuditTrail = mo.showAuditTrail !== false;  // default true

  // Active Overrides section: filters above, table below. JS populates both.
  var activeOverridesSection = [
    '<div class="overrides-section">',
    '  <div class="overrides-section-title">Active Overrides</div>',
    '  <div class="control-row" style="margin-bottom: var(--space-3);">',
    '    <span class="filter-label">Type:</span>',
    '    <select id="overrides-type-filter" class="filter-select" onchange="onOverridesFilterChange()">',
    '      <option value="all">All</option>',
    '      <option value="deployment">Deployment</option>',
    '      <option value="golives">Go Lives</option>',
    '    </select>',
    '    <span class="filter-label">Classification:</span>',
    '    <select id="overrides-classification-filter" class="filter-select" onchange="onOverridesFilterChange()">',
    '      <option value="all">All</option>',
    '      <option value="Monthly">Monthly</option>',
    '      <option value="Structural">Structural</option>',
    '    </select>',
    '    <button class="btn btn-secondary" onclick="refreshOverridesTab()" style="margin-left: auto;">🔄 Refresh</button>',
    '  </div>',
    '  <div class="table-wrapper">',
    '    <table>',
    '      <thead><tr>',
    '        <th>Type</th>',
    '        <th>Account</th>',
    '        <th>Field</th>',
    '        <th>Current Value</th>',
    '        <th>Set By</th>',
    '        <th>Set At</th>',
    '        <th>Classification</th>',
    '      </tr></thead>',
    '      <tbody id="active-overrides-tbody"></tbody>',
    '    </table>',
    '  </div>',
    '</div>'
  ].join('\n');

  // Bulk Actions section: two destructive buttons + warning
  var bulkActionsSection = [
    '<div class="overrides-section">',
    '  <div class="overrides-section-title">Bulk Actions</div>',
    '  <div class="bulk-actions">',
    '    <button class="btn btn-destructive" onclick="confirmBulkClearMonthly()" id="bulk-clear-monthly-btn">',
    '      Clear all monthly overrides for <span id="bulk-clear-month-label">this month</span>',
    '    </button>',
    '    <button class="btn btn-destructive-strong" onclick="confirmBulkClearAll()" id="bulk-clear-all-btn">',
    '      Clear all overrides',
    '    </button>',
    '  </div>',
    '  <div class="overrides-warning">',
    '    ⚠️ Bulk clear cannot be undone. Audit log preserved.',
    '  </div>',
    '</div>'
  ].join('\n');

  // Audit Trail section: 30-day rolling window with "show all" expansion
  var auditTrailSection = !showAuditTrail ? '' : [
    '<div class="overrides-section">',
    '  <div class="overrides-section-title">Audit Trail <span id="audit-trail-window-label" style="font-weight: 400; font-size: 11px; color: var(--color-text-subtle); margin-left: var(--space-2); text-transform: none; letter-spacing: 0;">(last 30 days)</span></div>',
    '  <div class="table-wrapper">',
    '    <table class="audit-log">',
    '      <thead><tr>',
    '        <th class="audit-mono">When</th>',
    '        <th class="audit-mono">Who</th>',
    '        <th>Action</th>',
    '        <th>Account</th>',
    '        <th>Type</th>',
    '        <th>Fields Affected</th>',
    '        <th>Reason</th>',
    '      </tr></thead>',
    '      <tbody id="audit-trail-tbody"></tbody>',
    '    </table>',
    '  </div>',
    '  <div style="margin-top: var(--space-3); text-align: center;">',
    '    <button class="btn btn-secondary" onclick="toggleAuditTrailWindow()" id="audit-trail-toggle-btn">Show all history</button>',
    '  </div>',
    '</div>'
  ].join('\n');

  return [
    '<div id="overrides-tab" class="tab-content">',
    '  <div class="info-banner">',
    '    ⚙️ Manage active overrides on deployments and go lives. Bulk actions are PM-only.',
    '  </div>',
    activeOverridesSection,
    bulkActionsSection,
    auditTrailSection,
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MODAL: EXECUTIVE WATCH (App Enhancements Phase 1)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildExecWatchModal_() {
  return [
    '<div id="exec-watch-modal" class="modal-overlay">',
    '  <div class="modal-card" style="max-width:480px;">',
    '    <div class="modal-header">',
    '      <span class="modal-title">&#x26A0; Executive Watch</span>',
    '      <button class="modal-close" onclick="closeExecWatchModal()">&#x2715;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="modal-field-group">',
    '        <label class="modal-label">CX Leader</label>',
    '        <div id="exec-watch-cx-leader" class="modal-value"></div>',
    '      </div>',
    '      <div class="modal-field-group" style="margin-top:var(--space-3);">',
    '        <label class="modal-label">Executive Summary</label>',
    '        <div id="exec-watch-summary" class="modal-value"',
    '             style="white-space:pre-wrap;"></div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MODAL: META VIEW (Phase 1 — unchanged)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildMetaModal_(ui) {
  var ownerLabel = (ui.editModal && ui.editModal.ownerFieldLabel) || 'Delivery Director';
  var showEm     = !!(ui.deploymentsTable && ui.deploymentsTable.showEmColumn);

  var emField = '';
  if (showEm) {
    emField =
      '      <div class="form-group">' +
      '        <label class="form-label">EM</label>' +
      '        <input type="text" id="meta-em" class="form-input" readonly>' +
      '      </div>';
  }

  return [
    '<div id="meta-modal" class="modal-overlay">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>Deployment Meta Information</h2>',
    '      <button class="modal-close" onclick="closeMetaModal()">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="form-grid">',
    '        <div class="form-group"><label class="form-label">Account Name</label><input type="text" id="meta-account" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Deployment Name</label><input type="text" id="meta-deployment" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">' + _CoreUI_Markup_esc_(ownerLabel) + '</label><input type="text" id="meta-delivery-director" class="form-input" readonly></div>',
    emField,
    '        <div class="form-group full-width"><label class="form-label">DD Notes</label><textarea id="meta-dd-notes" class="form-textarea" readonly></textarea></div>',
    '        <div class="form-group"><label class="form-label">Last Updated By</label><input type="text" id="meta-username" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Last Updated At</label><input type="text" id="meta-timestamp" class="form-input" readonly></div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeMetaModal()">Close</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MODAL: EDIT DEPLOYMENT (Phase 1 + Phase 2 classification selector)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildEditModal_(ui) {
  var em = ui.editModal || {};
  var ownerLabel = em.ownerFieldLabel || 'Delivery Director';
  var ownerType  = em.ownerInputType  || 'text';
  var ownerOpts  = Array.isArray(em.ownerOptions) ? em.ownerOptions : [];
  var showEm     = !!(ui.deploymentsTable && ui.deploymentsTable.showEmColumn);

  var emField = '';
  if (showEm) {
    emField =
      '        <div class="form-group">' +
      '          <label class="form-label">EM (source)</label>' +
      '          <input type="text" id="edit-em" class="form-input" readonly>' +
      '        </div>';
  }

  var ownerField;
  if (ownerType === 'dropdown') {
    var options = ['<option value="">(Select ' + _CoreUI_Markup_esc_(ownerLabel) + ')</option>'];
    ownerOpts.forEach(function (opt) {
      options.push('<option value="' + _CoreUI_Markup_attr_(opt) + '">' + _CoreUI_Markup_esc_(opt) + '</option>');
    });
    ownerField =
      '        <div class="form-group">' +
      '          <label class="form-label">' + _CoreUI_Markup_esc_(ownerLabel) + '</label>' +
      '          <select id="edit-delivery-director" class="form-select">' +
      options.join('') +
      '          </select>' +
      '        </div>';
  } else if (ownerType === 'datalist') {
    var dlOpts = ownerOpts.map(function (opt) {
      return '<option value="' + _CoreUI_Markup_attr_(opt) + '"></option>';
    }).join('');
    ownerField =
      '        <div class="form-group">' +
      '          <label class="form-label">' + _CoreUI_Markup_esc_(ownerLabel) + '</label>' +
      '          <input type="text" id="edit-delivery-director" class="form-input" list="deployment-executive-list" placeholder="Select or type name">' +
      '          <datalist id="deployment-executive-list">' + dlOpts + '</datalist>' +
      '        </div>';
  } else {
    ownerField =
      '        <div class="form-group">' +
      '          <label class="form-label">' + _CoreUI_Markup_esc_(ownerLabel) + '</label>' +
      '          <input type="text" id="edit-delivery-director" class="form-input" placeholder="Enter name">' +
      '        </div>';
  }

  return [
    '<div id="edit-modal" class="modal-overlay">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>Edit Deployment (Report View)</h2>',
    '      <button class="modal-close" onclick="closeEditModal()">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <form id="edit-form" class="form-grid">',
    '        <input type="hidden" id="edit-row-index">',
    '        <div class="form-group"><label class="form-label">Account Name (source)</label><input type="text" id="edit-account" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Deployment Name (source)</label><input type="text" id="edit-deployment" class="form-input" readonly></div>',
    emField,
    '        <div class="form-group">',
    '          <label class="form-label">Health (override)</label>',
    '          <select id="edit-health" class="form-select">',
    '            <option value="">(use source)</option>',
    '            <option value="Green">Green</option>',
    '            <option value="Yellow">Yellow</option>',
    '            <option value="Red">Red</option>',
    '          </select>',
    '        </div>',
    '        <div class="form-group"><label class="form-label">Stage (override)</label><input type="text" id="edit-stage" class="form-input" placeholder="Leave blank to use source stage"></div>',
    '        <div class="form-group"><label class="form-label">Override MTP Date</label><input type="date" id="edit-mtp" class="form-input"></div>',
    '        <div class="form-group full-width"><label class="form-label">Current Deployment Update (override)</label><textarea id="edit-update" class="form-textarea" placeholder="Override current update used in report..."></textarea></div>',
    '        <div class="form-group full-width"><label class="form-label"><input type="checkbox" id="edit-exclude-report" /> Exclude from HTML Report</label></div>',
    // Phase 2: classification selector
    '        <div class="form-group full-width">',
    '          <label class="form-label">Override applies:</label>',
    '          <div class="classification-selector">',
    '            <label><input type="radio" name="edit-classification" value="Monthly" checked> Monthly (clears at month-end)</label>',
    '            <label><input type="radio" name="edit-classification" value="Structural"> Structural (persists)</label>',
    '          </div>',
    '        </div>',
    ownerField,
    '        <div class="form-group full-width"><label class="form-label">DD Notes</label><textarea id="edit-notes" class="form-textarea" placeholder="DD notes stored in DeploymentsMeta..."></textarea></div>',
    // Phase 3d: override reason captured per save and stored in OverrideAudit.Notes
    '        <div class="form-group full-width"><label class="form-label">Reason for override <span style="font-weight:400; color:var(--color-text-muted);">(optional)</span></label><textarea id="edit-override-reason" class="form-textarea" placeholder="Why is this override being applied? Helps reviewers understand context." maxlength="500" style="min-height:72px;"></textarea></div>',
    '      </form>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>',
    '      <button class="btn btn-primary" onclick="saveDeployment()">',
    '        <span id="save-btn-text">Save Changes</span>',
    '        <span id="save-spinner" class="spinner hidden"></span>',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MODAL: GO LIVES (Phase 2 — unified for past + future + classification selector)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildGoLivesModal_(ui) {
  return [
    '<div id="golives-modal" class="modal-overlay">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>Edit Go Live (Report View)</h2>',
    '      <button class="modal-close" onclick="closeGoLivesModal()">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="form-grid">',
    '        <div class="form-group"><label class="form-label">Account Name</label><input type="text" id="golives-account" class="form-input" readonly></div>',
    // Date label is dynamic — JS switches between "Override Go Live Date" (past)
    // and "Override MTP Date" (future) based on the row's date relative to today.
    '        <div class="form-group"><label class="form-label" id="golives-date-label">Override Date</label><input type="date" id="golives-date" class="form-input"></div>',
    '        <div class="form-group full-width"><label class="form-label" id="golives-product-label">Product / Deployment (source)</label><textarea id="golives-product" class="form-textarea" readonly></textarea></div>',
    '        <div class="form-group"><label class="form-label">Override Partner</label><input type="text" id="golives-partner" class="form-input"></div>',
    '        <div class="form-group full-width"><label class="form-label"><input type="checkbox" id="golives-exclude-report" /> Exclude from HTML Report</label></div>',
    // Phase 2: classification selector
    '        <div class="form-group full-width">',
    '          <label class="form-label">Override applies:</label>',
    '          <div class="classification-selector">',
    '            <label><input type="radio" name="golives-classification" value="Monthly" checked> Monthly (clears at month-end)</label>',
    '            <label><input type="radio" name="golives-classification" value="Structural"> Structural (persists)</label>',
    '          </div>',
    '        </div>',
    // Phase 3d: override reason captured per save and stored in OverrideAudit.Notes
    '        <div class="form-group full-width"><label class="form-label">Reason for override <span style="font-weight:400; color:var(--color-text-muted);">(optional)</span></label><textarea id="golives-override-reason" class="form-textarea" placeholder="Why is this override being applied? Helps reviewers understand context." maxlength="500" style="min-height:72px;"></textarea></div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeGoLivesModal()">Cancel</button>',
    '      <button class="btn btn-primary" onclick="saveGoLives()">',
    '        <span id="golives-save-text">Save Changes</span>',
    '        <span id="golives-spinner" class="spinner hidden"></span>',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MODAL: CONFIRMATION (Phase 2 — used for bulk clear actions)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildConfirmModal_(ui) {
  return [
    '<div id="confirm-modal" class="modal-overlay">',
    '  <div class="modal modal-sm">',
    '    <div class="modal-header">',
    '      <h2 id="confirm-modal-title">Confirm</h2>',
    '      <button class="modal-close" onclick="closeConfirmModal()">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div id="confirm-modal-body"></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeConfirmModal()">Cancel</button>',
    '      <button class="btn btn-destructive" id="confirm-modal-confirm-btn" onclick="confirmModalConfirm()">',
    '        <span id="confirm-modal-confirm-text">Confirm</span>',
    '        <span id="confirm-modal-spinner" class="spinner hidden"></span>',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MODAL: AUDIT DETAIL (Phase 2 — used when clicking an audit log row)
// ---------------------------------------------------------------------------

function _CoreUI_Markup_buildAuditDetailModal_(ui) {
  return [
    '<div id="audit-detail-modal" class="modal-overlay">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>Audit Entry Detail</h2>',
    '      <button class="modal-close" onclick="closeAuditDetailModal()">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="form-grid">',
    '        <div class="form-group"><label class="form-label">When</label><input type="text" id="audit-detail-when" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Who</label><input type="text" id="audit-detail-who" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Action</label><input type="text" id="audit-detail-action" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Type</label><input type="text" id="audit-detail-type" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Account</label><input type="text" id="audit-detail-account" class="form-input" readonly></div>',
    '        <div class="form-group"><label class="form-label">Deployment ID</label><input type="text" id="audit-detail-deployment-id" class="form-input" readonly></div>',
    '        <div class="form-group full-width"><label class="form-label">Fields Affected</label><input type="text" id="audit-detail-fields" class="form-input" readonly></div>',
    '        <div class="form-group full-width"><label class="form-label">Before</label><textarea id="audit-detail-before" class="form-textarea audit-mono" readonly style="min-height: 120px;"></textarea></div>',
    '        <div class="form-group full-width"><label class="form-label">After</label><textarea id="audit-detail-after" class="form-textarea audit-mono" readonly style="min-height: 120px;"></textarea></div>',
    // Phase 3d: override reason stored in OverrideAudit column J
    '        <div class="form-group full-width"><label class="form-label">Reason</label><textarea id="audit-detail-notes" class="form-textarea" readonly style="min-height: 56px;"></textarea></div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeAuditDetailModal()">Close</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: TRENDS (Phase 3g — five-tier analytics tab; content rendered by JS)
// ---------------------------------------------------------------------------

/**
 * Builds the Trends tab shell.  All data fetching and DOM rendering are
 * handled client-side by `_trends_*` functions in CoreUI_Js.js.
 *
 * Five-tier layout (spec §3g):
 *   Tier 1  — Time-in-Red KPI strip (3 cards)
 *   Tier 2  — Health Trajectory sparkline table + Health by Partner stacked bars (side-by-side)
 *   Tier 3  — Health by Delivery Director table
 *   Tier 4  — Time in Stage + Time to Go-Live (side-by-side)
 *   Tier 5  — Go-Live Outcome Patterns accordion
 *
 * @param {Object} ui
 */
function _CoreUI_Markup_buildTrendsTab_(ui) {
  return [
    '<div id="trends-tab" class="tab-content">',
    '',
    '  <!-- Trends: info banner + toolbar -->',
    '  <div class="info-banner">',
    '    📈 12-month trends across health, stage durations, and go-live outcomes.',
    '    Toggle between <strong>My Portfolio</strong> and <strong>All</strong> using the control in the header.',
    '  </div>',
    '  <div class="trends-toolbar no-export">',
    '    <button class="btn btn-secondary" onclick="loadTrendsTab()">🔄 Refresh</button>',
    '    <span id="trends-loading-indicator" class="trends-loading hidden">',
    '      <span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px;"></span>',
    '      Loading&hellip;',
    '    </span>',
    '    <span id="trends-as-of" class="trends-as-of"></span>',
    '  </div>',
    '',
    '  <!-- ================================================================ -->',
    '  <!-- TIER 1: Time-in-Red KPI Strip                                    -->',
    '  <!-- ================================================================ -->',
    '  <div class="trends-section" id="trends-tier1">',
    '    <div class="trends-section-header">',
    '      <span class="trends-section-title">Time in Red</span>',
    '      <span class="trends-section-sub" id="trends-red-subtitle"></span>',
    '    </div>',
    '    <div class="trends-kpi-strip" id="trends-red-kpi-strip">',
    '      <!-- JS renders 3 KPI cards: Currently Red, Avg Days in Red, Longest Current -->',
    '    </div>',
    '    <!-- Drilldown table &mdash; shown when user clicks "Currently Red" card -->',
    '    <div id="trends-red-drilldown" class="trends-drilldown hidden">',
    '      <div class="trends-drilldown-header">',
    '        <span>Currently Red Deployments</span>',
    '        <button class="trends-drilldown-close" onclick="closeTrendsDrilldown(\'trends-red-drilldown\')">&times;</button>',
    '      </div>',
    '      <div class="table-wrapper">',
    '        <table class="trends-table">',
    '          <thead><tr>',
    '            <th>Account</th>',
    '            <th>Deployment</th>',
    '            <th>Partner</th>',
    '            <th>Days in Red</th>',
    '            <th>DD</th>',
    '          </tr></thead>',
    '          <tbody id="trends-red-drilldown-tbody"></tbody>',
    '        </table>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    '  <!-- ================================================================ -->',
    '  <!-- TIER 2: Health Trajectory + Health by Partner (side-by-side)     -->',
    '  <!-- ================================================================ -->',
    '  <div class="trends-section trends-two-col" id="trends-tier2">',
    '',
    '    <!-- Left: Health Trajectory (always team-wide) -->',
    '    <div class="trends-col" id="trends-trajectory-col">',
    '      <div class="trends-section-header">',
    '        <span class="trends-section-title">Health Trajectory</span>',
    '        <span class="trends-section-sub">12 months · team-wide</span>',
    '      </div>',
    '      <!-- Month-by-month table with inline sparkline-style stacked bars -->',
    '      <div class="table-wrapper">',
    '        <table class="trends-table" id="trends-trajectory-table">',
    '          <thead><tr>',
    '            <th>Month</th>',
    '            <th style="text-align:right;">Total</th>',
    '            <th style="text-align:right;">Green</th>',
    '            <th style="text-align:right;">Yellow</th>',
    '            <th style="text-align:right;">Red</th>',
    '            <th style="min-width:120px;">Distribution</th>',
    '          </tr></thead>',
    '          <tbody id="trends-trajectory-tbody"></tbody>',
    '        </table>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- Right: Health by Partner stacked bar -->',
    '    <div class="trends-col" id="trends-partner-col">',
    '      <div class="trends-section-header">',
    '        <span class="trends-section-title">Health by Partner</span>',
    '        <span class="trends-section-sub" id="trends-partner-subtitle"></span>',
    '      </div>',
    '      <div id="trends-partner-bars">',
    '        <!-- JS renders one stacked bar row per partner -->',
    '      </div>',
    '      <div class="trends-stacked-legend">',
    '        <span><span class="trends-swatch" style="background:var(--color-green);"></span>Green</span>',
    '        <span><span class="trends-swatch" style="background:var(--color-yellow);"></span>Yellow</span>',
    '        <span><span class="trends-swatch" style="background:var(--color-red);"></span>Red</span>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    '  <!-- ================================================================ -->',
    '  <!-- TIER 3: Health by Delivery Director                              -->',
    '  <!-- ================================================================ -->',
    '  <div class="trends-section" id="trends-tier3">',
    '    <div class="trends-section-header">',
    '      <span class="trends-section-title">Portfolio Stewardship by Delivery Director</span>',
    '      <span class="trends-section-sub" id="trends-dd-subtitle"></span>',
    '    </div>',
    '    <div class="table-wrapper">',
    '      <table class="trends-table" id="trends-dd-table">',
    '        <thead><tr>',
    '          <th>Delivery Director</th>',
    '          <th style="text-align:right;">Active</th>',
    '          <th style="text-align:right;">Green</th>',
    '          <th style="text-align:right;">Yellow</th>',
    '          <th style="text-align:right;">Red</th>',
    '          <th style="min-width:120px;">Distribution</th>',
    '          <th style="text-align:right;">Avg Days Red</th>',
    '        </tr></thead>',
    '        <tbody id="trends-dd-tbody"></tbody>',
    '      </table>',
    '    </div>',
    '  </div>',
    '',
    '  <!-- ================================================================ -->',
    '  <!-- TIER 4: Time in Stage + Time to Go-Live (side-by-side)          -->',
    '  <!-- ================================================================ -->',
    '  <div class="trends-section trends-two-col" id="trends-tier4">',
    '',
    '    <!-- Left: Time in Stage -->',
    '    <div class="trends-col" id="trends-stage-col">',
    '      <div class="trends-section-header">',
    '        <span class="trends-section-title">Time in Stage</span>',
    '        <span class="trends-section-sub" id="trends-stage-subtitle"></span>',
    '      </div>',
    '      <div class="table-wrapper">',
    '        <table class="trends-table" id="trends-stage-table">',
    '          <thead><tr>',
    '            <th>Stage</th>',
    '            <th style="text-align:right;">Count</th>',
    '            <th style="text-align:right;">Avg Days</th>',
    '            <th style="text-align:right;">Median</th>',
    '            <th style="text-align:right;">P90</th>',
    '            <th style="text-align:right;">Outliers</th>',
    '          </tr></thead>',
    '          <tbody id="trends-stage-tbody"></tbody>',
    '        </table>',
    '      </div>',
    '      <!-- Stage outlier drilldown -->',
    '      <div id="trends-stage-drilldown" class="trends-drilldown hidden">',
    '        <div class="trends-drilldown-header">',
    '          <span id="trends-stage-drilldown-title">Stage Outliers</span>',
    '          <button class="trends-drilldown-close" onclick="closeTrendsDrilldown(\'trends-stage-drilldown\')">&times;</button>',
    '        </div>',
    '        <div class="table-wrapper">',
    '          <table class="trends-table">',
    '            <thead><tr>',
    '              <th>Account</th>',
    '              <th>Deployment</th>',
    '              <th style="text-align:right;">Days in Stage</th>',
    '              <th style="text-align:right;">vs. Avg</th>',
    '            </tr></thead>',
    '            <tbody id="trends-stage-drilldown-tbody"></tbody>',
    '          </table>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <!-- Right: Time to Go-Live -->',
    '    <div class="trends-col" id="trends-ttgl-col">',
    '      <div class="trends-section-header">',
    '        <span class="trends-section-title">Time to Go-Live</span>',
    '        <span class="trends-section-sub" id="trends-ttgl-subtitle"></span>',
    '      </div>',
    '      <!-- KPI row: Avg, Median, P90 from Complete benchmark -->',
    '      <div class="trends-kpi-strip" id="trends-ttgl-kpi-strip"></div>',
    '      <!-- In-flight overdue list -->',
    '      <div class="trends-section-subheader">In-Flight Deployments</div>',
    '      <div class="table-wrapper">',
    '        <table class="trends-table" id="trends-ttgl-table">',
    '          <thead><tr>',
    '            <th>Account</th>',
    '            <th>Deployment</th>',
    '            <th style="text-align:right;">Days Active</th>',
    '            <th style="text-align:right;">vs. Median</th>',
    '            <th>MTP</th>',
    '          </tr></thead>',
    '          <tbody id="trends-ttgl-tbody"></tbody>',
    '        </table>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    '  <!-- ================================================================ -->',
    '  <!-- TIER 5: Go-Live Outcome Patterns                                 -->',
    '  <!-- ================================================================ -->',
    '  <div class="trends-section" id="trends-tier5">',
    '    <div class="trends-section-header">',
    '      <span class="trends-section-title">Go-Live Outcome Patterns</span>',
    '      <span class="trends-section-sub" id="trends-outcomes-subtitle"></span>',
    '    </div>',
    '',
    '    <!-- Outcome KPI strip: On-Time, Slipped, Cancelled, Avg Slip -->',
    '    <div class="trends-kpi-strip" id="trends-outcomes-kpi-strip"></div>',
    '',
    '    <div class="trends-two-col" style="margin-top:var(--space-4);">',
    '',
    '      <!-- Left: MTP movement distribution + by-approach breakdown -->',
    '      <div class="trends-col">',
    '        <div class="trends-section-subheader">MTP Movement Distribution</div>',
    '        <div id="trends-mtp-bars">',
    '          <!-- JS renders buckets: Early/On-Time/Slipped ≤30/31-60/>60 -->',
    '        </div>',
    '        <div class="trends-section-subheader" style="margin-top:var(--space-4);">By Deployment Approach</div>',
    '        <div class="table-wrapper">',
    '          <table class="trends-table" id="trends-approach-table">',
    '            <thead><tr>',
    '              <th>Approach</th>',
    '              <th style="text-align:right;">Count</th>',
    '              <th style="text-align:right;">On-Time %</th>',
    '              <th style="text-align:right;">Avg Slip (days)</th>',
    '            </tr></thead>',
    '            <tbody id="trends-approach-tbody"></tbody>',
    '          </table>',
    '        </div>',
    '      </div>',
    '',
    '      <!-- Right: by-partner outcome table + recent completions -->',
    '      <div class="trends-col">',
    '        <div class="trends-section-subheader">By Partner</div>',
    '        <div class="table-wrapper">',
    '          <table class="trends-table" id="trends-outcomes-partner-table">',
    '            <thead><tr>',
    '              <th>Partner</th>',
    '              <th style="text-align:right;">Count</th>',
    '              <th style="text-align:right;">On-Time %</th>',
    '              <th style="text-align:right;">Avg Slip (days)</th>',
    '            </tr></thead>',
    '            <tbody id="trends-outcomes-partner-tbody"></tbody>',
    '          </table>',
    '        </div>',
    '        <div class="trends-section-subheader" style="margin-top:var(--space-4);">Recent Completions</div>',
    '        <div class="table-wrapper">',
    '          <table class="trends-table" id="trends-completions-table">',
    '            <thead><tr>',
    '              <th>Account</th>',
    '              <th>Go-Live Date</th>',
    '              <th style="text-align:right;">Slip (days)</th>',
    '              <th>Partner</th>',
    '            </tr></thead>',
    '            <tbody id="trends-completions-tbody"></tbody>',
    '          </table>',
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    '</div>'  // #trends-tab
  ].join('\n');
}

// ---------------------------------------------------------------------------
// TAB: NOTABLE DEPLOYMENTS (Part 3)
// ---------------------------------------------------------------------------

/**
 * Builds the Notable Deployments tab shell plus its two modals (edit and
 * add-picker). Modals are appended at the end of the returned HTML so they
 * are included only when the notable tab is rendered (power users only).
 *
 * @param {Object} ui  cfg.ui (already filtered)
 * @return {string}
 */
function _CoreUI_Markup_buildNotableTab_(ui) {
  var tab = [
    '<div id="notable-tab" class="tab-content">',
    '  <div class="info-banner">',
    '    &#11088; <strong>Notable Deployments</strong> &mdash; strategic customer go-lives for the global company report.',
    '    Power users can edit existing entries and add new ones sourced from recent or upcoming go-lives.',
    '  </div>',
    '  <div class="control-bar">',
    '    <div class="control-row" style="justify-content: space-between; align-items: center;">',
    '      <span id="notable-count" style="font-size: 13px; color: var(--color-text-muted);"></span>',
    '      <div class="filter-group">',
    '        <button class="btn btn-secondary" onclick="loadNotableTab()">&#x1F504; Refresh</button>',
    '        <button class="btn btn-primary" onclick="openNotableAddPicker()">+ Add Notable Deployment</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="table-container">',
    '    <div class="table-wrapper">',
    '      <table id="notable-table">',
    '        <thead><tr>',
    '          <th>Health</th>',
    '          <th>Account Name</th>',
    '          <th>Deployment Name</th>',
    '          <th>Notability Trigger</th>',
    '          <th>Validation Status</th>',
    '          <th>Latest Update</th>',
    '          <th>Regional Owner</th>',
    '          <th>Actions</th>',
    '        </tr></thead>',
    '        <tbody id="notable-tbody"></tbody>',
    '      </table>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');

  return tab + '\n' +
    _CoreUI_Markup_buildNotableEditModal_(ui) + '\n' +
    _CoreUI_Markup_buildNotableAddPickerModal_(ui);
}

/**
 * Builds the Notable Deployment edit modal (shared for edit and add modes).
 * Two-column layout: left pane shows read-only app context; right pane has
 * four editable sections plus a footer notes field.
 *
 * @param {Object} ui  cfg.ui (already filtered)
 * @return {string}
 */
function _CoreUI_Markup_buildNotableEditModal_(ui) {
  return [
    '<div id="notable-edit-modal" class="modal-overlay">',
    '  <div class="modal" style="max-width:1100px;width:90vw;">',
    '    <div class="modal-header">',
    '      <h2 id="notable-edit-modal-title">Edit Notable Deployment</h2>',
    '      <button class="modal-close" onclick="closeNotableEditModal()">&times;</button>',
    '    </div>',
    '    <div class="modal-body" style="display:flex;gap:24px;align-items:flex-start;">',
    '      <div style="flex:0 0 240px;background:#f8f9fa;border:1px solid var(--color-border);border-radius:8px;padding:16px;min-width:200px;">',
    '        <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:12px;">From Your App</div>',
    '        <div style="margin-bottom:10px;">',
    '          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Account Name</div>',
    '          <div id="notable-ctx-account" style="font-size:13px;font-weight:600;"></div>',
    '        </div>',
    '        <div style="margin-bottom:10px;">',
    '          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Deployment Name</div>',
    '          <div id="notable-ctx-deployment" style="font-size:12px;line-height:1.4;"></div>',
    '        </div>',
    '        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">',
    '          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Industry</div><div id="notable-ctx-industry" style="font-size:12px;"></div></div>',
    '          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Account #</div><div id="notable-ctx-accountnum" style="font-size:12px;"></div></div>',
    '          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Partner</div><div id="notable-ctx-partner" style="font-size:12px;"></div></div>',
    '          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Health</div><div id="notable-ctx-health" style="font-size:12px;font-weight:600;"></div></div>',
    '          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">Stage</div><div id="notable-ctx-stage" style="font-size:12px;"></div></div>',
    '          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:2px;">MTP Date</div><div id="notable-ctx-mtp" style="font-size:12px;"></div></div>',
    '        </div>',
    '        <div style="border-top:1px solid var(--color-border);padding-top:10px;margin-top:4px;">',
    '          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);margin-bottom:4px;">Deployment ID</div>',
    '          <div id="notable-ctx-id" style="font-family:monospace;font-size:10px;word-break:break-all;color:var(--color-text-muted);margin-bottom:6px;"></div>',
    '          <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="copyNotableId()">Copy</button>',
    '        </div>',
    '      </div>',
    '      <div style="flex:1;display:flex;flex-direction:column;gap:16px;overflow-y:auto;max-height:70vh;">',
    '        <div style="background:#f8f9fa;border:1px solid var(--color-border);border-radius:8px;padding:16px;">',
    '          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:1px solid var(--color-border);padding-bottom:8px;margin-bottom:12px;">Status &amp; Ownership</div>',
    '          <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:12px;">',
    '            <div class="form-group">',
    '              <label class="form-label">Validation Status</label>',
    '              <select id="notable-validation-status" class="form-select">',
    '                <option value="Raw/Unverified">Raw/Unverified</option>',
    '                <option value="Region Approved">Region Approved</option>',
    '                <option value="Region Restricted">Region Restricted</option>',
    '              </select>',
    '            </div>',
    '            <div class="form-group">',
    '              <label class="form-label">Latest Update</label>',
    '              <input type="date" id="notable-latest-update" class="form-input">',
    '            </div>',
    '            <div class="form-group">',
    '              <label class="form-label">Regional Owner</label>',
    '              <input type="text" id="notable-regional-owner" class="form-input" placeholder="Enter name">',
    '            </div>',
    '          </div>',
    '        </div>',
    '        <div style="background:#f8f9fa;border:1px solid var(--color-border);border-radius:8px;padding:16px;">',
    '          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:1px solid var(--color-border);padding-bottom:8px;margin-bottom:12px;">Notability</div>',
    '          <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;">',
    '            <div class="form-group">',
    '              <label class="form-label">Notability Trigger <span style="color:#c62828;">*</span></label>',
    '              <select id="notable-trigger" class="form-select">',
    '                <option value="">-- Select --</option>',
    '                <option value="Scale">Scale</option>',
    '                <option value="High Complexity">High Complexity</option>',
    '                <option value="Innovative Delivery">Innovative Delivery</option>',
    '                <option value="Market First">Market First</option>',
    '                <option value="Takeaway">Takeaway</option>',
    '                <option value="Regional Significance">Regional Significance</option>',
    '                <option value="AI Infused">AI Infused</option>',
    '              </select>',
    '            </div>',
    '            <div class="form-group">',
    '              <label class="form-label">Fit-for-Purpose</label>',
    '              <select id="notable-fit" class="form-select">',
    '                <option value="">-- Select --</option>',
    '                <option value="Earnings">Earnings</option>',
    '                <option value="EY Audit">EY Audit</option>',
    '                <option value="Keynotes &amp; Events">Keynotes &amp; Events</option>',
    '                <option value="External Marketing">External Marketing</option>',
    '                <option value="Sales Enablement">Sales Enablement</option>',
    '                <option value="Internal Channels">Internal Channels</option>',
    '              </select>',
    '            </div>',
    '          </div>',
    '        </div>',
    '        <div style="background:#f8f9fa;border:1px solid var(--color-border);border-radius:8px;padding:16px;">',
    '          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:1px solid var(--color-border);padding-bottom:8px;margin-bottom:12px;">Story</div>',
    '          <div class="form-group" style="margin-bottom:12px;">',
    '            <label class="form-label">Scope (Human Summary)</label>',
    '            <textarea id="notable-scope" class="form-textarea" style="min-height:64px;" placeholder="Brief scope summary..."></textarea>',
    '          </div>',
    '          <div class="form-group" style="margin-bottom:12px;">',
    '            <label class="form-label">Story Blurb / Executive Summary</label>',
    '            <textarea id="notable-story" class="form-textarea" style="min-height:100px;" placeholder="Executive-level story..."></textarea>',
    '          </div>',
    '          <div class="form-group">',
    '            <label class="form-label">Business Outcomes / Scope</label>',
    '            <textarea id="notable-outcomes" class="form-textarea" style="min-height:100px;" placeholder="Key business outcomes..."></textarea>',
    '          </div>',
    '        </div>',
    '        <div style="background:#f8f9fa;border:1px solid var(--color-border);border-radius:8px;padding:16px;">',
    '          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);border-bottom:1px solid var(--color-border);padding-bottom:8px;margin-bottom:12px;">Supporting Material</div>',
    '          <div class="form-group" style="margin-bottom:12px;">',
    '            <label class="form-label">Links <span style="font-weight:400;color:var(--color-text-muted);">(one per line)</span></label>',
    '            <textarea id="notable-links" class="form-textarea" style="min-height:64px;" placeholder="https://..."></textarea>',
    '          </div>',
    '          <div class="form-group">',
    '            <label class="form-label">Standout Team Members</label>',
    '            <input type="text" id="notable-team" class="form-input" placeholder="Jane Smith, John Doe">',
    '          </div>',
    '        </div>',
    '        <div class="form-group">',
    '          <label class="form-label" style="color:var(--color-text-muted);">Reason for this update <span style="font-weight:400;">(optional)</span></label>',
    '          <input type="text" id="notable-notes" class="form-input" maxlength="200" placeholder="Why is this being updated?">',
    '        </div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeNotableEditModal()">Cancel</button>',
    '      <button class="btn btn-primary" id="notable-save-btn" onclick="saveNotableDeployment()">',
    '        <span id="notable-save-btn-text">Save Changes</span>',
    '        <span id="notable-save-spinner" class="spinner hidden"></span>',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

/**
 * Builds the Notable Deployment add-picker modal. Displays recent and upcoming
 * go-lives as searchable, clickable candidates. Selecting one opens the edit
 * modal in add mode.
 *
 * @param {Object} ui  cfg.ui (already filtered)
 * @return {string}
 */
function _CoreUI_Markup_buildNotableAddPickerModal_(ui) {
  return [
    '<div id="notable-add-picker-modal" class="modal-overlay">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>Add Notable Deployment</h2>',
    '      <button class="modal-close" onclick="closeNotableAddPicker()">&times;</button>',
    '    </div>',
    '    <div class="modal-body">',
    '      <p style="margin:0 0 var(--space-3) 0;font-size:13px;color:var(--color-text-muted);">',
    '        Choose a deployment from recent or upcoming go-lives to nominate as notable.',
    '        Use the search box to filter by account or deployment name.',
    '      </p>',
    '      <div class="control-row" style="margin-bottom:var(--space-3);">',
    '        <div class="search-box">',
    '          <span class="search-icon">&#x1F50D;</span>',
    '          <input type="text" id="notable-picker-search"',
    '                 placeholder="Search by account or deployment&hellip;"',
    '                 onkeyup="filterNotablePicker()">',
    '        </div>',
    '      </div>',
    '      <div id="notable-picker-list"',
    '           style="max-height:360px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-2);">',
    '        <!-- JS populates clickable candidate rows -->',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-secondary" onclick="closeNotableAddPicker()">Cancel</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function _CoreUI_Markup_esc_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _CoreUI_Markup_attr_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
