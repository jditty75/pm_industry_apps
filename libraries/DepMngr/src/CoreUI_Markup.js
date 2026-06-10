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
  return '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>';
}

// ---------------------------------------------------------------------------
// APP SHELL ORCHESTRATOR
// ---------------------------------------------------------------------------

function _CoreUI_Markup_getAppShell(cfg) {
  var ui = cfg.ui || {};

  var parts = [];
  parts.push(_CoreUI_Markup_buildHeader_(ui));
  parts.push('<div class="container">');

  // Welcome banner placeholder — JS populates and shows/hides based on user role.
  parts.push(_CoreUI_Markup_buildWelcomeBannerPlaceholder_());

  parts.push(_CoreUI_Markup_buildTabBar_(ui));

  var tabIds = (ui.tabs || []).map(function (t) { return t.id; });

  if (tabIds.indexOf('deployments') !== -1) parts.push(_CoreUI_Markup_buildDeploymentsTab_(ui));
  if (tabIds.indexOf('golives')     !== -1) parts.push(_CoreUI_Markup_buildGoLivesTab_(ui));
  if (tabIds.indexOf('execsummary') !== -1) parts.push(_CoreUI_Markup_buildExecSummaryTab_(ui));
  if (tabIds.indexOf('report')      !== -1) parts.push(_CoreUI_Markup_buildReportTab_(ui, cfg));
  if (tabIds.indexOf('portfolio')   !== -1) parts.push(_CoreUI_Markup_buildPortfolioTab_(ui));
  if (tabIds.indexOf('overrides')   !== -1) parts.push(_CoreUI_Markup_buildOverridesTab_(ui));

  parts.push('</div>'); // .container

  parts.push(_CoreUI_Markup_buildMetaModal_(ui));
  parts.push(_CoreUI_Markup_buildEditModal_(ui));
  parts.push(_CoreUI_Markup_buildGoLivesModal_(ui));
  parts.push(_CoreUI_Markup_buildConfirmModal_(ui));
  parts.push(_CoreUI_Markup_buildAuditDetailModal_(ui));

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
  var html = ['<div class="tabs">'];
  tabs.forEach(function (t, i) {
    var cls = 'tab' + (i === 0 ? ' active' : '');
    html.push(
      '  <button class="' + cls + '" onclick="switchTab(\'' + _CoreUI_Markup_esc_(t.id) + '\')">' +
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
  headers.push('<th>Actions</th>');
  headers.push('<th>Meta Info</th>');

  return [
    '<div id="deployments-tab" class="tab-content active">',
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
  headers.push('<th>Actions</th>');

  return [
    '<div id="golives-tab" class="tab-content">',
    '  <div class="info-banner">',
    '    📅 Go Lives — recent past and upcoming, in one place.',
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
      ? '  <div class="full-portfolio-indicator">ℹ️ This view always reflects the full team — used for external communication.</div>'
      : ''),
    '  <div class="info-banner">',
    '    📄 Preview of the monthly <strong>' + _CoreUI_Markup_esc_(reportTitle) + '</strong> – same HTML as the menu-based preview.',
    '  </div>',
    '  <div class="control-bar">',
    '    <div class="control-row" style="flex: 1;">',
    '      <p style="margin: 0; color: var(--color-text-muted); font-size: 13px; flex: 1;">',
    '        This preview shows the complete monthly report with all tables, charts, and executive summary.',
    '      </p>',
    '      <button class="btn btn-primary" onclick="loadReportPreview()">🔄 Refresh Report</button>',
    '    </div>',
    '  </div>',
    '  <div class="table-container" style="padding: 0;">',
    '    <div id="report-preview-container" style="padding: 24px; min-height: 400px;">',
    '      <div style="text-align: center; padding: 48px 24px; color: var(--color-text-subtle);">',
    '        <p>Click "Refresh Report" to load the monthly report preview</p>',
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
      ? '  <div class="full-portfolio-indicator">ℹ️ This view always reflects the full team — used for external communication.</div>'
      : ''),
    '  <div class="info-banner">',
    '    📤 Snapshot of overall portfolio health. Use <strong>Download PNG</strong> to export a slide-ready image.',
    '  </div>',
    '  <div class="ph-toolbar no-export">',
    '    <button class="btn btn-secondary" onclick="loadPortfolioHealth()" style="margin-right: 8px;">🔄 Refresh</button>',
    '    <button class="btn btn-primary" onclick="downloadPortfolioHealthPng()">⬇ Download PNG <span id="ph-spinner" class="spinner hidden"></span></button>',
    '  </div>',
    '  <div id="ph-canvas" class="ph-canvas">',
    '    <div class="report-loading" id="ph-loading">',
    '      <div class="spinner-large"></div>',
    '      <p>Loading Portfolio Health…</p>',
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
    '            <div class="ph-kpi-value" id="ph-kpi-total">–</div>',
    '            <div class="ph-trend" id="ph-trend-total"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub">Green + Yellow + Red</div>',
    '          <svg class="ph-spark" id="ph-spark-total" preserveAspectRatio="none"></svg>',
    '        </div>',
    '        <div class="ph-kpi green" data-key="green">',
    '          <div class="ph-kpi-label">Green</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-green">–</div>',
    '            <div class="ph-trend" id="ph-trend-green"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub" id="ph-kpi-green-pct"></div>',
    '          <svg class="ph-spark" id="ph-spark-green" preserveAspectRatio="none"></svg>',
    '        </div>',
    '        <div class="ph-kpi yellow" data-key="yellow">',
    '          <div class="ph-kpi-label">Yellow</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-yellow">–</div>',
    '            <div class="ph-trend" id="ph-trend-yellow"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub" id="ph-kpi-yellow-pct"></div>',
    '          <svg class="ph-spark" id="ph-spark-yellow" preserveAspectRatio="none"></svg>',
    '        </div>',
    '        <div class="ph-kpi red" data-key="red">',
    '          <div class="ph-kpi-label">Red</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-red">–</div>',
    '            <div class="ph-trend" id="ph-trend-red"></div>',
    '          </div>',
    '          <div class="ph-kpi-sub" id="ph-kpi-red-pct"></div>',
    '          <svg class="ph-spark" id="ph-spark-red" preserveAspectRatio="none"></svg>',
    '        </div>',
    // Phase 3a: Phased Go-Lives KPI tile
    '        <div class="ph-kpi phased" data-key="phased">',
    '          <div class="ph-kpi-label">Phased Go-Lives</div>',
    '          <div class="ph-kpi-row">',
    '            <div class="ph-kpi-value" id="ph-kpi-phased">–</div>',
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
    '            <div class="ph-card-title"><span id="ph-golives-title">WD Prime Go Lives — Last 60 Days</span><span class="ph-count" id="ph-golives-count">0</span></div>',
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