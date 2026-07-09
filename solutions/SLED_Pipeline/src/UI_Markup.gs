/**
 * UI_Markup.gs — Server-side HTML markup generation for SLED Pipeline Analysis.
 * Config-driven: tabs and labels come from APP_CONFIG.ui.
 * All output is HTML-escaped via Utils_escapeHtml_.
 */

/**
 * Returns the complete app shell HTML: header + filter bar + tabs container.
 * Included as <?!= getAppShell() ?> in WebApp.html.
 * @returns {string}
 */
function getAppShell() {
  return getHeaderMarkup() + getFilterBarMarkup() + getTabsMarkup();
}

/**
 * Returns the sticky top header bar HTML.
 * @returns {string}
 */
function getHeaderMarkup() {
  return '<header class="header">' +
    '<div class="header-inner">' +
      '<h1 class="header-title">' + Utils_escapeHtml_(APP_CONFIG.ui.appTitle) + '</h1>' +
    '</div>' +
    '</header>';
}

/**
 * Returns the global filter bar HTML.
 * All filter controls are segmented buttons; JS handles state and re-queries.
 * @returns {string}
 */
function getFilterBarMarkup() {
  return '<div class="filter-bar">' +
    '<div class="filter-bar-inner">' +

      filterGroupHtml_('Scope', segControlHtml_('filter-scope', [
        { val: 'SLED', label: 'SLED',  active: true },
        { val: 'SLG',  label: 'SLG' },
        { val: 'HENP', label: 'HENP' }
      ])) +

      filterGroupHtml_('Student', segControlHtml_('filter-student', [
        { val: 'all',         label: 'All',          active: true },
        { val: 'studentOnly', label: 'Student only' },
        { val: 'nonStudent',  label: 'Non-Student'  }
      ])) +

      filterGroupHtml_('Pipeline', segControlHtml_('filter-pipeline', [
        { val: 'active',    label: 'Active',     active: true },
        { val: 'closedWon', label: 'Closed/Won' },
        { val: 'all',       label: 'All'         }
      ])) +

      // Starts-in-next-N: hidden until Pipeline = Closed/Won (toggled by JS)
      '<div class="filter-group" id="filter-starts-group" style="display:none">' +
        '<span class="filter-label">Starts in next</span>' +
        segControlHtml_('filter-starts', [
          { val: '60',  label: '60 days',  active: true },
          { val: '90',  label: '90 days' },
          { val: '120', label: '120 days' }
        ]) +
      '</div>' +

    '</div></div>';
}

/**
 * Returns the tab navigation bar + tab panels HTML.
 * Tabs are driven by APP_CONFIG.ui.tabs; first tab starts active.
 * Non-Overview panels render a "Coming soon" empty state in Phase 2.
 * @returns {string}
 */
function getTabsMarkup() {
  var tabs   = APP_CONFIG.ui.tabs;

  var navBtns = tabs.map(function(t, i) {
    return '<button class="tab' + (i === 0 ? ' active' : '') +
      '" data-tab="' + Utils_escapeHtml_(t.id) + '">' +
      Utils_escapeHtml_(t.label) + '</button>';
  }).join('');

  var panels = tabs.map(function(t, i) {
    var inner = (i === 0)
      ? '<div id="overview-content" class="report-loading"><div class="spinner-large"></div></div>'
      : '<div class="empty-state">Coming soon</div>';
    return '<div class="tab-panel' + (i === 0 ? ' active' : '') +
      '" id="panel-' + Utils_escapeHtml_(t.id) + '">' + inner + '</div>';
  }).join('');

  return '<div class="tabs-container">' +
    '<nav class="tab-nav">' + navBtns + '</nav>' +
    '<div class="tab-panels">' + panels + '</div>' +
    '</div>';
}

// ===== Private helpers =====

/**
 * Wraps a control in a labeled filter-group div.
 * @param {string} label
 * @param {string} controlHtml
 * @returns {string}
 */
function filterGroupHtml_(label, controlHtml) {
  return '<div class="filter-group">' +
    '<span class="filter-label">' + Utils_escapeHtml_(label) + '</span>' +
    controlHtml +
    '</div>';
}

/**
 * Builds a segmented-control HTML block.
 * @param {string}  id    DOM id for the container.
 * @param {Array}   opts  [{val, label, active?}]
 * @returns {string}
 */
function segControlHtml_(id, opts) {
  var btns = opts.map(function(o) {
    return '<button class="seg-btn' + (o.active ? ' active' : '') +
      '" data-value="' + Utils_escapeHtml_(String(o.val)) + '">' +
      Utils_escapeHtml_(o.label) + '</button>';
  }).join('');
  return '<div class="seg-control" id="' + Utils_escapeHtml_(id) + '">' + btns + '</div>';
}
