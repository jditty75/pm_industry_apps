/**
 * DM UX concept preview — client application (prototype only).
 */
(function () {
  "use strict";

  var BUNDLE = window.__DM_UX_FIXTURES__ || { deployments: [], responses: [], inflight: [], productAreas: [] };

  var APP_CONFIGS = {
    SLG: {
      id: "SLG",
      headerTitle: "Deployment Manager",
      headerSubtitle: "State & Local Government",
      baselineCsatLabel: "MGM / PGL",
      csatLabel: "CSAT",
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "deployments", label: "Deployments" },
        { id: "golives", label: "Go Lives" },
        { id: "reporting", label: "Reporting" },
        { id: "portfolio", label: "Portfolio Health" },
        { id: "trends", label: "Trends" },
        { id: "csat", label: "CSAT", feature: "csat" },
        { id: "notable", label: "Notable Deployments", feature: "notable" },
        { id: "overrides", label: "Manage Overrides" },
      ],
      csat: true,
      student: false,
      notable: true,
      escalations: false,
      productMode: false,
    },
    HENP: {
      id: "HENP",
      headerTitle: "Deployment Manager",
      headerSubtitle: "Higher Ed & Nonprofit",
      baselineCsatLabel: "CSAT",
      csatLabel: "CSAT",
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "deployments", label: "Deployments" },
        { id: "golives", label: "Go Lives" },
        { id: "reporting", label: "Reporting" },
        { id: "portfolio", label: "Portfolio Health" },
        { id: "trends", label: "Trends" },
        { id: "csat", label: "CSAT", feature: "csat" },
        { id: "notable", label: "Notable Deployments", feature: "notable" },
        { id: "overrides", label: "Manage Overrides" },
      ],
      csat: true,
      student: true,
      notable: true,
      escalations: false,
      productMode: false,
    },
    EVI: {
      id: "EVI",
      headerTitle: "Deployment Manager",
      headerSubtitle: "Enterprise Volume Implementation",
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "deployments", label: "Deployments" },
        { id: "golives", label: "Go Lives" },
        { id: "reporting", label: "Reporting" },
        { id: "portfolio", label: "Portfolio Health" },
        { id: "trends", label: "Trends" },
        { id: "overrides", label: "Manage Overrides" },
      ],
      csat: false,
      student: false,
      notable: false,
      escalations: false,
      productMode: true,
    },
    PDX: {
      id: "PDX",
      headerTitle: "Deployment Manager",
      headerSubtitle: "Product Development Experience",
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "deployments", label: "Deployments" },
        { id: "golives", label: "Go Lives" },
        { id: "reporting", label: "Reporting" },
        { id: "portfolio", label: "Portfolio Health" },
        { id: "escalations", label: "Escalations", feature: "escalations" },
        { id: "trends", label: "Trends" },
        { id: "overrides", label: "Manage Overrides" },
      ],
      csat: false,
      student: false,
      notable: false,
      escalations: true,
      productMode: true,
    },
  };

  var CSAT_SECTIONS = [
    { id: "overview", label: "Overview" },
    { id: "tracking", label: "Survey Tracking" },
    { id: "responses", label: "Responses" },
    { id: "feedback", label: "Customer Feedback", tier: 2 },
    { id: "ai", label: "AI Insights", disabled: true },
  ];

  var state = {
    concept: "baseline",
    app: "SLG",
    treatment: "evolved",
    access: "T2",
    scenario: "mixed-portfolio",
    feature: "csat",
    section: "overview",
    deploymentId: null,
    drawerSection: "summary",
    filters: { productAreas: [], surveyType: "all", period: "12m" },
    sort: { column: "responseDate", dir: "desc" },
  };

  function parseHash() {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    h.split("&").forEach(function (part) {
      var kv = part.split("=");
      if (kv.length < 2) return;
      var k = decodeURIComponent(kv[0]);
      var v = decodeURIComponent(kv.slice(1).join("="));
      if (k === "concept") state.concept = v;
      if (k === "app") state.app = v;
      if (k === "treatment") state.treatment = v;
      if (k === "access" || k === "tier") state.access = v;
      if (k === "scenario") state.scenario = v;
      if (k === "feature" || k === "tab") state.feature = v;
      if (k === "section") state.section = v;
      if (k === "deployment") state.deploymentId = v;
      if (k === "drawerSection") state.drawerSection = v;
    });
  }

  function writeHash() {
    var parts = [
      "concept=" + encodeURIComponent(state.concept),
      "app=" + encodeURIComponent(state.app),
      "treatment=" + encodeURIComponent(state.treatment),
      "tier=" + encodeURIComponent(state.access),
      "scenario=" + encodeURIComponent(state.scenario),
      "feature=" + encodeURIComponent(state.feature),
      "section=" + encodeURIComponent(state.section),
    ];
    if (state.deploymentId && state.concept === "conceptB") {
      parts.push("deployment=" + encodeURIComponent(state.deploymentId));
      parts.push("drawerSection=" + encodeURIComponent(state.drawerSection));
    }
    location.hash = parts.join("&");
  }

  function depById(id) {
    return BUNDLE.deployments.find(function (d) {
      return d.id === id;
    });
  }

  function scenarioResponses() {
    if (state.scenario === "loading") return null;
    if (state.scenario === "error") return "error";
    var rows = BUNDLE.responses.slice();
    if (state.scenario === "no-responses") return [];
    if (state.scenario === "high-volume") return rows;
    if (state.scenario === "deployment-history") {
      return rows.filter(function (r) {
        return r.deploymentId === "syn-dep-001";
      });
    }
    if (state.scenario === "low-satisfaction") {
      return rows.filter(function (r) {
        return r.overallSatisfaction != null && r.overallSatisfaction <= 2.5;
      });
    }
    if (state.scenario === "mixed-sentiment") {
      return rows.filter(function (r) {
        return r.qualtricsSentiment;
      });
    }
    if (state.scenario === "multi-product-area") {
      return rows.filter(function (r) {
        return r.productAreas && r.productAreas.length >= 3;
      });
    }
    if (state.scenario === "low-n") return rows.slice(0, 3);
    return rows;
  }

  function mean(vals) {
    var nums = vals.filter(function (v) {
      return v != null && !isNaN(v);
    });
    if (!nums.length) return null;
    return nums.reduce(function (a, b) {
      return a + b;
    }, 0) / nums.length;
  }

  function pctFavorable(vals) {
    var nums = vals.filter(function (v) {
      return v != null;
    });
    if (!nums.length) return null;
    var good = nums.filter(function (v) {
      return v >= 4;
    }).length;
    return Math.round((good / nums.length) * 100);
  }

  function aggregateMetrics(rows) {
    var overall = rows.map(function (r) {
      return r.overallSatisfaction;
    });
    var mds = rows
      .filter(function (r) {
        return r.surveyType === "MDS";
      })
      .map(function (r) {
        return r.surveySatisfaction;
      });
    var pgl = rows
      .filter(function (r) {
        return r.surveyType === "PGL";
      })
      .map(function (r) {
        return r.surveySatisfaction;
      });
    var npsRows = rows.filter(function (r) {
      return r.surveyType === "PGL" && r.nps != null;
    });
    var nps =
      npsRows.length >= 10
        ? Math.round(
            (npsRows.filter(function (r) {
              return r.nps >= 9;
            }).length /
              npsRows.length -
              npsRows.filter(function (r) {
                return r.nps <= 6;
              }).length /
                npsRows.length) *
              100
          )
        : npsRows.length
          ? "low-n"
          : null;
    return {
      n: rows.length,
      overallMean: mean(overall),
      overallFav: pctFavorable(overall),
      mdsMean: mean(mds),
      mdsN: mds.length,
      pglMean: mean(pgl),
      pglN: pgl.length,
      nps: nps,
      npsN: npsRows.length,
    };
  }

  function formatScore(v, n, suppress) {
    if (suppress && n < 5) {
      return '<span class="ux-suppressed" title="Fewer than 5 responses; aggregate hidden.">n&lt;5</span>';
    }
    if (v == null) return "—";
    return v.toFixed(1);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function openDeployment(id, drawerSection, fromConcept) {
    if (fromConcept !== "conceptB" && state.concept !== "conceptB") {
      if (state.concept === "conceptA") {
        state.section = "responses";
        state.filters.deploymentId = id;
        render();
        writeHash();
      }
      return;
    }
    state.deploymentId = id;
    state.drawerSection = drawerSection || "summary";
    render();
    writeHash();
  }

  function closeDrawer() {
    state.deploymentId = null;
    render();
    writeHash();
  }

  function renderControlPanel() {
    var el = document.getElementById("ux-proto-controls");
    if (!el) return;
    el.innerHTML =
      '<div class="ux-proto-panel__inner">' +
      '<span class="ux-proto-panel__title">Prototype controls</span>' +
      field("concept", "Concept", state.concept, [
        ["baseline", "Baseline — Current DM"],
        ["conceptA", "Concept A — Evolve"],
        ["conceptB", "Concept B — Drawer"],
      ]) +
      field("app", "App", state.app, [
        ["SLG", "SLG"],
        ["HENP", "HENP"],
        ["EVI", "EVI"],
        ["PDX", "PDX"],
      ]) +
      field("treatment", "Visual", state.treatment, [
        ["evolved", "Current DM Evolved"],
        ["workday", "Selective Workday"],
      ]) +
      field("access", "Access", state.access, [
        ["T1", "T1 — Aggregates"],
        ["T2", "T2 — Response detail"],
      ]) +
      field("scenario", "Scenario", state.scenario, [
        ["mixed-portfolio", "Mixed Portfolio"],
        ["low-satisfaction", "Low Satisfaction"],
        ["deployment-history", "Deployment History"],
        ["mixed-sentiment", "Mixed Sentiment"],
        ["multi-product-area", "Multi Product Area"],
        ["no-responses", "No Responses"],
        ["low-n", "Low-n"],
        ["loading", "Loading"],
        ["error", "Error"],
        ["high-volume", "High Volume"],
      ]) +
      '<span class="ux-proto-badge">LOCAL UX PROTOTYPE — NOT PRODUCTION</span></div>';

    el.querySelectorAll("select").forEach(function (sel) {
      sel.addEventListener("change", function (e) {
        var name = e.target.name;
        state[name] = e.target.value;
        if (name === "concept" && state.concept !== "conceptB") state.deploymentId = null;
        if (name === "app") {
          var cfg = APP_CONFIGS[state.app];
          if (!cfg.csat && state.feature === "csat") state.feature = "overview";
        }
        render();
        writeHash();
      });
    });
  }

  function field(name, label, value, options) {
    var opts = options
      .map(function (o) {
        return (
          '<option value="' +
          esc(o[0]) +
          '"' +
          (o[0] === value ? " selected" : "") +
          ">" +
          esc(o[1]) +
          "</option>"
        );
      })
      .join("");
    return (
      '<div class="ux-proto-field"><label for="ux-' +
      name +
      '">' +
      esc(label) +
      '</label><select id="ux-' +
      name +
      '" name="' +
      name +
      '">' +
      opts +
      "</select></div>"
    );
  }

  function renderShell(contentHtml) {
    var cfg = APP_CONFIGS[state.app];
    var tabs = cfg.tabs
      .map(function (t) {
        var active = t.id === state.feature ? " active" : "";
        var label = t.id === "csat" && state.concept === "baseline" ? cfg.baselineCsatLabel : t.label;
        if (t.id === "csat" && state.concept !== "baseline") label = cfg.csatLabel;
        return (
          '<button type="button" class="tab' +
          active +
          '" data-feature="' +
          esc(t.id) +
          '">' +
          esc(label) +
          "</button>"
        );
      })
      .join("");

    var banners = "";
    if (cfg.productMode) {
      banners += '<div class="ux-product-mode-banner">Product mode context — industry grouping replaces region filters for this app.</div>';
    }
    if (cfg.student) {
      banners +=
        '<div class="ux-student-banner" role="note">Student module enabled — cross-tab student context applies to eligible deployments.</div>';
    }
    if (state.concept === "baseline") {
      banners += '<div class="ux-baseline-tag">Baseline — Current DM (reference shell)</div>';
    }

    return (
      '<div class="container">' +
      '<div class="header card">' +
      '<div class="header-left">' +
      '<div class="header-title">' +
      esc(cfg.headerTitle) +
      "</div>" +
      '<div class="header-subtitle">' +
      esc(cfg.headerSubtitle) +
      "</div>" +
      "</div>" +
      '<div class="header-right"><span class="freshness-badge">Preview data · synthetic</span></div>' +
      "</div>" +
      '<nav class="tabs" role="tablist" aria-label="Primary features">' +
      tabs +
      "</nav>" +
      banners +
      '<div class="tab-panel active">' +
      contentHtml +
      "</div></div>"
    );
  }

  function renderCsatSubnav() {
    if (state.concept === "baseline") {
      return (
        '<nav class="csat-subtab-nav" role="tablist" aria-label="CSAT sections">' +
        '<button type="button" class="csat-subtab-btn" data-baseline-csat="batches">Upcoming Batches</button>' +
        '<button type="button" class="csat-subtab-btn active" data-baseline-csat="inflight">In-Flight Surveys</button>' +
        '<button type="button" class="csat-subtab-btn" data-baseline-csat="notify">Notification Management</button>' +
        '<button type="button" class="csat-subtab-btn" data-baseline-csat="upload">Upload</button>' +
        "</nav>"
      );
    }
    var html = '<div class="ux-subnav" role="tablist" aria-label="CSAT sections">';
    CSAT_SECTIONS.forEach(function (s) {
      var sel = s.id === state.section ? "true" : "false";
      var dis = s.disabled ? ' aria-disabled="true" tabindex="-1"' : ' tabindex="' + (s.id === state.section ? "0" : "-1") + '"';
      html +=
        '<button type="button" role="tab" aria-selected="' +
        sel +
        '" data-section="' +
        esc(s.id) +
        '"' +
        dis +
        ">" +
        esc(s.label) +
        (s.disabled ? " (future)" : "") +
        "</button>";
    });
    html += "</div>";
    return html;
  }

  function renderTrendChart(rows) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    var overall = [3.8, 3.9, 3.7, 3.6, 3.5, 3.4];
    var pgl = [4.1, 4.0, 3.9, 3.7, 3.5, 3.2];
    var points = function (arr, yOff) {
      return arr
        .map(function (v, i) {
          var x = 40 + i * 50;
          var y = 100 - (v - 2) * 35 + yOff;
          return x + "," + y;
        })
        .join(" ");
    };
    return (
      '<div class="ux-trend-chart"><div class="ux-section-title" style="font-size:14px;font-weight:600;margin-bottom:8px;">Satisfaction trend (synthetic)</div>' +
      '<svg viewBox="0 0 320 120" role="img" aria-label="Trend chart for overall and PGL satisfaction"><polyline fill="none" stroke="#0f4c81" stroke-width="2" points="' +
      points(overall, 0) +
      '"/><polyline fill="none" stroke="#0ea5e9" stroke-width="2" stroke-dasharray="4 3" points="' +
      points(pgl, 0) +
      '"/></svg>' +
      '<div class="ux-trend-legend"><span style="--c:#0f4c81">Overall Satisfaction</span><span style="--c:#0ea5e9">PGL Satisfaction</span></div></div>'
    );
  }

  function renderOverview(rows, metrics) {
    var suppress = state.scenario === "low-n" || metrics.n < 5;
    var kpi = function (label, value, meta, action) {
      var inner =
        '<div class="ux-kpi-label">' +
        esc(label) +
        '</div><div class="ux-kpi-value">' +
        value +
        '</div><div class="ux-kpi-meta">' +
        esc(meta) +
        "</div>";
      if (action) {
        return (
          '<div class="ux-kpi-tile"><button type="button" class="ux-kpi-tile__btn" data-drill="' +
          esc(action) +
          '">' +
          inner +
          "</button></div>"
        );
      }
      return '<div class="ux-kpi-tile">' + inner + "</div>";
    };
    var npsDisplay =
      metrics.nps === "low-n"
        ? '<span class="ux-suppressed" title="NPS requires at least 10 PGL responses.">n&lt;10</span>'
        : metrics.nps != null
          ? metrics.nps + ""
          : "—";

    var attention = rows
      .filter(function (r) {
        return r.overallSatisfaction != null && r.overallSatisfaction <= 2.5;
      })
      .slice(0, 5)
      .map(function (r) {
        var dep = depById(r.deploymentId);
        return (
          "<li><span>" +
          esc(dep ? dep.name : r.deploymentId) +
          ' · Overall ' +
          r.overallSatisfaction.toFixed(1) +
          '</span><button type="button" data-attention="' +
          esc(r.deploymentId) +
          '">Review</button></li>'
        );
      })
      .join("");

    var areaCounts = {};
    rows.forEach(function (r) {
      (r.productAreas || []).forEach(function (a) {
        areaCounts[a] = (areaCounts[a] || 0) + 1;
      });
    });
    var areaHtml = Object.keys(areaCounts)
      .slice(0, 8)
      .map(function (a) {
        var c = areaCounts[a];
        var cell =
          c < 5
            ? '<span class="ux-suppressed" title="Non-additive: one response may touch multiple areas.">n&lt;5</span>'
            : c + " responses touching";
        return "<li>" + esc(a) + " — " + cell + " <em>(non-additive)</em></li>";
      })
      .join("");

    return (
      renderCsatSubnav() +
      '<div class="filter-bar" style="margin-bottom:12px">' +
      '<span class="filter-label">Period</span><select class="filter-select" disabled><option>Last 12 months</option></select>' +
      '<span class="filter-label">Survey type</span><select class="filter-select" disabled><option>All</option></select>' +
      "</div>" +
      '<div class="ux-kpi-row">' +
      kpi("Response volume", metrics.n + "", "Filtered scope", "responses") +
      kpi(
        "Overall Satisfaction",
        formatScore(metrics.overallMean, metrics.n, suppress),
        metrics.overallFav != null ? metrics.overallFav + "% favorable · n=" + metrics.n : "n=" + metrics.n,
        "responses-low"
      ) +
      kpi(
        "PGL Satisfaction",
        formatScore(metrics.pglMean, metrics.pglN, suppress),
        "PGL only · n=" + metrics.pglN
      ) +
      kpi(
        "MDS Satisfaction",
        formatScore(metrics.mdsMean, metrics.mdsN, suppress),
        "MDS only · n=" + metrics.mdsN
      ) +
      kpi("NPS (PGL)", npsDisplay, "Separate 0–10 measure · n=" + metrics.npsN) +
      "</div>" +
      renderTrendChart(rows) +
      '<h3 class="ux-section-title" style="font-size:14px;margin:0 0 8px;">Attention signals</h3>' +
      '<ul class="ux-attention-list">' +
      (attention || '<li class="ux-empty">No low scores in this scenario.</li>') +
      "</ul>" +
      '<h3 class="ux-section-title" style="font-size:14px;margin:0 0 8px;">Product Area (responses touching area)</h3>' +
      '<ul class="ux-attention-list">' +
      areaHtml +
      "</ul>"
    );
  }

  function renderTracking() {
    var rows = BUNDLE.inflight;
    var tr = rows
      .map(function (r) {
        return (
          "<tr><td>" +
          (state.concept === "conceptB"
            ? '<button type="button" class="ux-dep-chip" data-dep="' +
              esc(r.deploymentId) +
              '">' +
              esc(r.deployment) +
              "</button>"
            : esc(r.deployment)) +
          "</td><td>" +
          r.sent +
          "</td><td>" +
          r.opened +
          "</td><td>" +
          r.started +
          "</td><td>" +
          r.completed +
          "</td><td>" +
          r.bounced +
          '</td><td><span class="status-pill">' +
          esc(r.status) +
          "</span></td></tr>"
        );
      })
      .join("");
    return (
      renderCsatSubnav() +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
      '<div class="ux-kpi-row" style="flex:1;margin:0">' +
      '<div class="ux-kpi-tile"><div class="ux-kpi-label">Sent</div><div class="ux-kpi-value">60</div></div>' +
      '<div class="ux-kpi-tile"><div class="ux-kpi-label">Open rate</div><div class="ux-kpi-value">77%</div></div>' +
      '<div class="ux-kpi-tile"><div class="ux-kpi-label">Completion</div><div class="ux-kpi-value">68%</div></div>' +
      "</div>" +
      '<div class="ux-admin-action"><button type="button" class="btn btn-secondary btn-compact">Upload a batch…</button> <span>Emergency fallback</span></div></div>' +
      '<div class="table-container"><table class="ux-dense-table"><thead><tr><th>Deployment</th><th>Sent</th><th>Opened</th><th>Started</th><th>Completed</th><th>Bounced</th><th>Status</th></tr></thead><tbody>' +
      tr +
      "</tbody></table></div>"
    );
  }

  function renderResponsesTable(rows) {
    var sorted = rows.slice().sort(function (a, b) {
      var col = state.sort.column;
      var av = a[col];
      var bv = b[col];
      if (col === "responseDate") {
        av = av || "";
        bv = bv || "";
      }
      if (av < bv) return state.sort.dir === "asc" ? -1 : 1;
      if (av > bv) return state.sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    var tr = sorted
      .slice(0, state.scenario === "high-volume" ? 80 : 40)
      .map(function (r) {
        var dep = depById(r.deploymentId);
        var nps = r.surveyType === "PGL" ? (r.nps != null ? r.nps : "—") : "—";
        return (
          "<tr data-res='" +
          esc(r.id) +
          "'><td>" +
          (state.concept === "conceptB"
            ? '<button type="button" class="ux-dep-chip" data-dep="' +
              esc(r.deploymentId) +
              '" data-drawer="csat">' +
              esc(dep ? dep.account : r.deploymentId) +
              "</button>"
            : esc(dep ? dep.account : r.deploymentId)) +
          "</td><td>" +
          esc(r.surveyType) +
          "</td><td>" +
          esc(r.responseDate) +
          "</td><td>" +
          (r.overallSatisfaction != null ? r.overallSatisfaction.toFixed(1) : "—") +
          "</td><td>" +
          (r.surveySatisfaction != null ? r.surveySatisfaction.toFixed(1) : "—") +
          "</td><td>" +
          nps +
          "</td><td>" +
          (r.productAreas || [])
            .slice(0, 3)
            .map(function (a) {
              return '<span class="ux-semantic-chip">' + esc(a) + "</span>";
            })
            .join("") +
          "</td><td>" +
          (r.overallSatisfaction != null && r.overallSatisfaction <= 2.5
            ? '<span class="status-pill" title="Low score">Low</span>'
            : "") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      renderCsatSubnav() +
      '<div class="ux-chip-row" role="group" aria-label="Product Area filters">' +
      BUNDLE.productAreas
        .slice(0, 5)
        .map(function (a, i) {
          return (
            '<button type="button" class="ux-filter-chip" aria-pressed="' +
            (i === 0 ? "true" : "false") +
            '">' +
            esc(a) +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="table-container"><table class="ux-dense-table"><thead><tr>' +
      '<th><button type="button" data-sort="responseDate">Date<span class="ux-sort-indicator">▼</span></button></th>' +
      "<th>Account</th><th>Survey</th><th>Overall</th><th>Survey sat.</th><th>NPS</th><th>Product Areas</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      tr +
      "</tbody></table></div>"
    );
  }

  function renderFeedback(rows) {
    if (state.access === "T1") {
      return (
        renderCsatSubnav() +
        '<div class="ux-restricted" role="status"><strong>T1 access</strong><p>Customer Feedback requires T2. Portfolio aggregates and operational survey tracking remain available.</p></div>'
      );
    }
    var cards = rows
      .filter(function (r) {
        return r.comments && Object.keys(r.comments).length;
      })
      .slice(0, 12)
      .map(function (r) {
        var dep = depById(r.deploymentId);
        var comment = r.comments.reasons || r.comments.improve || r.comments.workingWell || r.comments.additional || "";
        return (
          '<article class="ux-feedback-card"><div class="ux-provenance ux-provenance--customer">Customer comment</div><p>' +
          esc(comment) +
          '</p><div class="ux-provenance ux-provenance--qualtrics">Qualtrics analysis</div><div class="ux-qualtrics-block">' +
          esc((r.qualtricsSentiment || "neutral") + " · " + (r.qualtricsTopics || []).join(", ")) +
          '</div><div style="margin-top:8px;font-size:12px;color:#64748b">' +
          esc(dep ? dep.name : "") +
          " · " +
          esc(r.surveyType) +
          " · " +
          esc(r.responseDate) +
          "</div></article>"
        );
      })
      .join("");
    return renderCsatSubnav() + (cards || '<div class="ux-empty">No comments in this scenario.</div>');
  }

  function renderCsatContent(rows, metrics) {
    if (state.scenario === "loading") {
      return (
        renderCsatSubnav() +
        '<div class="ux-skeleton"></div><div class="ux-skeleton"></div><div class="ux-skeleton"></div>'
      );
    }
    if (state.scenario === "error") {
      return (
        renderCsatSubnav() +
        '<div class="ux-error-banner" role="alert">Unable to load CSAT data (synthetic error). <button type="button" class="btn btn-secondary btn-compact" id="ux-retry">Retry</button></div>'
      );
    }
    if (!rows || !rows.length) {
      return renderCsatSubnav() + '<div class="ux-empty">No responses match this scenario — surveys may not have returned yet.</div>';
    }
    if (state.section === "tracking") return renderTracking();
    if (state.section === "responses") return renderResponsesTable(rows);
    if (state.section === "feedback") return renderFeedback(rows);
    if (state.section === "ai") {
      return renderCsatSubnav() + '<div class="ux-restricted">AI Insights — future placeholder</div>';
    }
    return renderOverview(rows, metrics);
  }

  function renderDeployments() {
    var tr = BUNDLE.deployments
      .map(function (d) {
        return (
          "<tr><td>" +
          (state.concept === "conceptB"
            ? '<button type="button" class="ux-dep-chip" data-dep="' + esc(d.id) + '">' + esc(d.name) + "</button>"
            : esc(d.name)) +
          '</td><td><span class="status-pill">' +
          esc(d.health) +
          "</span></td><td>" +
          esc(d.stage) +
          "</td><td>" +
          esc(d.goLiveDate) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<h2 class="ux-section-title" style="font-size:16px">Deployments</h2>' +
      '<div class="table-container"><table class="ux-dense-table"><thead><tr><th>Deployment</th><th>Health</th><th>Stage</th><th>Go live</th></tr></thead><tbody>' +
      tr +
      "</tbody></table></div>"
    );
  }

  function renderPlaceholder(title) {
    return '<div class="ux-empty">' + esc(title) + " — stub content for shell comparison.</div>";
  }

  function renderDrawer(cfg) {
    if (state.concept !== "conceptB" || !state.deploymentId) return "";
    var dep = depById(state.deploymentId);
    if (!dep) return "";
    var sections = [{ id: "summary", label: "Summary" }, { id: "timeline", label: "Timeline" }];
    if (cfg.csat) sections.push({ id: "csat", label: "CSAT" });
    if (cfg.notable && dep.notable) sections.push({ id: "notable", label: "Notable" });
    if (cfg.escalations && dep.hasEscalation) sections.push({ id: "escalations", label: "Escalations" });
    if (cfg.student && dep.hasStudent) sections.push({ id: "student", label: "Student" });
    sections.push({ id: "overrides", label: "Overrides" });

    var sub = sections
      .map(function (s) {
        return (
          '<button type="button" role="tab" aria-selected="' +
          (s.id === state.drawerSection ? "true" : "false") +
          '" data-drawer-section="' +
          esc(s.id) +
          '">' +
          esc(s.label) +
          "</button>"
        );
      })
      .join("");

    var body = "";
    if (state.drawerSection === "summary") {
      body =
        '<p><span class="status-pill">' +
        esc(dep.health) +
        "</span></p><dl style='font-size:13px'>" +
        "<dt>Account</dt><dd>" +
        esc(dep.account) +
        "</dd><dt>Partner</dt><dd>" +
        esc(dep.partner) +
        "</dd><dt>Services</dt><dd>" +
        esc(dep.servicesApproach) +
        "</dd><dt>Go live</dt><dd>" +
        esc(dep.goLiveDate) +
        "</dd></dl>";
    } else if (state.drawerSection === "timeline") {
      var ev = BUNDLE.responses
        .filter(function (r) {
          return r.deploymentId === dep.id;
        })
        .sort(function (a, b) {
          return a.responseDate.localeCompare(b.responseDate);
        });
      body = '<div class="ux-timeline">';
      body +=
        '<div class="ux-timeline-item ux-timeline-item--event"><strong>Go live</strong> · ' + esc(dep.goLiveDate) + "</div>";
      ev.forEach(function (r) {
        body +=
          '<div class="ux-timeline-item ux-timeline-item--' +
          r.surveyType.toLowerCase() +
          '"><strong>' +
          esc(r.surveyType) +
          " response</strong> · " +
          esc(r.responseDate) +
          " · Overall " +
          (r.overallSatisfaction != null ? r.overallSatisfaction.toFixed(1) : "—") +
          " · Survey " +
          (r.surveySatisfaction != null ? r.surveySatisfaction.toFixed(1) : "—") +
          "</div>";
      });
      body += "</div>";
    } else if (state.drawerSection === "csat") {
      body = renderResponsesTable(
        BUNDLE.responses.filter(function (r) {
          return r.deploymentId === dep.id;
        })
      ).replace(renderCsatSubnav(), "");
      if (state.access === "T2") {
        body +=
          "<h4 style='margin-top:16px'>Customer feedback (T2)</h4>" +
          renderFeedback(
            BUNDLE.responses.filter(function (r) {
              return r.deploymentId === dep.id;
            })
          ).replace(renderCsatSubnav(), "");
      } else {
        body += '<div class="ux-restricted">Comments hidden at T1 — scores shown above.</div>';
      }
    } else if (state.drawerSection === "notable") {
      body = "<p>Notable classification: validation in progress (synthetic).</p>";
    } else if (state.drawerSection === "escalations") {
      body = "<p>Escalation detail for PDX pilot (synthetic).</p>";
    } else if (state.drawerSection === "student") {
      body = "<p>Student module fields for this deployment (synthetic).</p>";
    } else {
      body = "<p>Override impact summary (synthetic).</p>";
    }

    return (
      '<div class="ux-drawer-scrim open" id="ux-drawer-scrim" aria-hidden="false"></div>' +
      '<aside class="ux-drawer open" role="dialog" aria-modal="false" aria-labelledby="ux-drawer-title">' +
      '<button type="button" class="ux-drawer-close" id="ux-drawer-close" aria-label="Close deployment detail">×</button>' +
      '<div class="ux-drawer-header"><h2 class="ux-drawer-title" id="ux-drawer-title">' +
      esc(dep.name) +
      '</h2><div class="ux-subnav" role="tablist">' +
      sub +
      "</div></div>" +
      '<div class="ux-drawer-body">' +
      body +
      "</div></aside>"
    );
  }

  function renderMain() {
    var cfg = APP_CONFIGS[state.app];
    var root = document.documentElement;
    root.classList.remove("ux-treatment-evolved", "ux-treatment-workday");
    root.classList.add(state.treatment === "workday" ? "ux-treatment-workday" : "ux-treatment-evolved");

    var rowsRaw = scenarioResponses();
    var rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    var metrics = aggregateMetrics(rows);

    var content = "";
    if (state.feature === "csat") {
      if (!cfg.csat) {
        content = '<div class="ux-empty">CSAT is not enabled for this app.</div>';
      } else if (state.concept === "baseline") {
        content =
          renderCsatSubnav() +
          '<div id="csat-panel-inflight" class="csat-subtab-panel active">' +
          '<p style="font-size:13px;color:#64748b;margin-bottom:12px">Baseline CSAT — operational In-Flight view (today\'s structure).</p>' +
          renderTracking().replace(renderCsatSubnav(), "") +
          "</div>";
      } else {
        content = renderCsatContent(rows, metrics);
      }
    } else if (state.feature === "deployments") {
      content = renderDeployments();
    } else if (state.feature === "overview") {
      content = renderPlaceholder("Overview KPIs and portfolio summary");
    } else {
      content = renderPlaceholder(cfg.tabs.find(function (t) {
        return t.id === state.feature;
      }).label);
    }

    var mount = document.getElementById("ux-app-root");
    mount.innerHTML = renderShell(content) + renderDrawer(cfg);
    bindEvents(cfg);
  }

  function bindEvents(cfg) {
    document.querySelectorAll(".tab[data-feature]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.feature = btn.getAttribute("data-feature");
        renderMain();
        writeHash();
      });
    });
    document.querySelectorAll(".ux-subnav [data-section]").forEach(function (btn) {
      if (btn.getAttribute("aria-disabled") === "true") return;
      btn.addEventListener("click", function () {
        state.section = btn.getAttribute("data-section");
        renderMain();
        writeHash();
      });
    });
    document.querySelectorAll("[data-dep]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sec = btn.getAttribute("data-drawer") || "summary";
        openDeployment(btn.getAttribute("data-dep"), sec, state.concept);
      });
    });
    document.querySelectorAll("[data-attention]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.section = "responses";
        state.filters.deploymentId = btn.getAttribute("data-attention");
        openDeployment(btn.getAttribute("data-attention"), "csat", state.concept);
      });
    });
    document.querySelectorAll("[data-drill]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.section = "responses";
        renderMain();
        writeHash();
      });
    });
    document.querySelectorAll("[data-drawer-section]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.drawerSection = btn.getAttribute("data-drawer-section");
        renderMain();
        writeHash();
      });
    });
    var close = document.getElementById("ux-drawer-close");
    var scrim = document.getElementById("ux-drawer-scrim");
    if (close) close.addEventListener("click", closeDrawer);
    if (scrim) scrim.addEventListener("click", closeDrawer);
    var retry = document.getElementById("ux-retry");
    if (retry) {
      retry.addEventListener("click", function () {
        state.scenario = "mixed-portfolio";
        document.querySelector('select[name="scenario"]').value = state.scenario;
        renderMain();
        writeHash();
      });
    }
    document.querySelectorAll("[data-sort]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var col = btn.getAttribute("data-sort");
        if (state.sort.column === col) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.column = col;
          state.sort.dir = "desc";
        }
        renderMain();
      });
    });
  }

  function init() {
    document.body.classList.add("ux-proto-active");
    parseHash();
    syncControlsFromState();
    renderControlPanel();
    renderMain();
    window.addEventListener("hashchange", function () {
      parseHash();
      syncControlsFromState();
      renderControlPanel();
      renderMain();
    });
  }

  function syncControlsFromState() {
    ["concept", "app", "treatment", "access", "scenario"].forEach(function (k) {
      var sel = document.querySelector('select[name="' + k + '"]');
      if (sel && state[k] !== undefined) sel.value = state[k];
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
