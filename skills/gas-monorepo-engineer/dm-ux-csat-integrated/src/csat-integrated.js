(function () {
  "use strict";

  var FIXTURE_EL = document.getElementById("csat-integrated-fixture");
  if (!FIXTURE_EL) return;
  var DATA = JSON.parse(FIXTURE_EL.textContent || "{}");
  var viewport = document.getElementById("csat-ix-viewport");
  if (!viewport) return;

  var navState = { origin: "#/overview", appKey: DATA.views.appKey || "hc" };

  function parseHash() {
    var h = (location.hash || "#/overview").replace(/^#/, "");
    var parts = h.split("/").filter(Boolean);
    if (parts[0] === "deployment" && parts.length >= 3 && parts[2] === "csat") {
      return { page: "deployment", deploymentId: parts[1], raw: h };
    }
    if (parts[0] === "responses") return { page: "responses", raw: h };
    if (parts[0] === "surveys") return { page: "surveys", raw: h };
    return { page: "overview", raw: h };
  }

  function setSubnavActive(page) {
    var idx = { overview: 0, surveys: 1, responses: 2 }[page];
    if (idx === undefined) return;
    document.querySelectorAll(".csatSubtabNav .csat-subtab-btn").forEach(function (btn, i) {
      var on = i === idx;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });
  }

  function renderRoute(route) {
    var views = DATA.views;
    var html = "";
    if (route.page === "overview") {
      navState.origin = "#/overview";
      html = views.overview || "";
    } else if (route.page === "surveys") {
      navState.origin = "#/surveys";
      html = views.surveys || "";
    } else if (route.page === "responses") {
      navState.origin = "#/responses";
      var stateKey = DATA.initialState || "RESPONSES_NORMAL";
      if (views.responsesStates && views.responsesStates[stateKey]) {
        html = views.responsesStates[stateKey];
      } else if (views.responsesStates && views.responsesStates.RESPONSES_NORMAL) {
        html = views.responsesStates.RESPONSES_NORMAL;
      }
    } else if (route.page === "deployment") {
      html = (views.deployments && views.deployments[route.deploymentId]) || "";
      if (html.indexOf("csat-ix-breadcrumb") >= 0) {
        html = html.replace('href="#/responses"', 'href="' + navState.origin + '"');
      }
      setSubnavActive("responses");
      viewport.innerHTML = html;
      bindRowExpansion();
      return;
    }
    setSubnavActive(route.page);
    viewport.innerHTML = html;
    bindSubnav();
    bindRowExpansion();
    applyT2();
  }

  function bindSubnav() {
    document.querySelectorAll(".csatSubtabNav [data-csat-route]").forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        var route = btn.getAttribute("data-csat-route");
        if (route) {
          location.hash = route.replace(/^#/, "");
        }
      };
    });
  }

  function bindRowExpansion() {
    document.querySelectorAll(".csat-row[data-expandable='true']").forEach(function (row) {
      row.style.cursor = "pointer";
      row.addEventListener("click", function (ev) {
        if (ev.target.closest("a")) return;
        var panel = row.nextElementSibling;
        if (panel && panel.classList.contains("csat-ix-evidence-panel")) {
          panel.hidden = !panel.hidden;
        }
      });
    });
    document.querySelectorAll('a[href^="#/deployment/"]').forEach(function (a) {
      a.addEventListener("click", function () {
        /* hashchange handles */
      });
    });
  }

  function applyT2() {
    var t2 = document.getElementById("csat-ix-t2-toggle");
    if (!t2) return;
    t2.onchange = function () {
      document.body.setAttribute("data-csat-t2", t2.checked ? "true" : "false");
      var panels = document.querySelectorAll(".csat-ix-evidence-panel");
      panels.forEach(function (p) {
        if (!t2.checked && !p.classList.contains("csat-ix-evidence-panel--open")) {
          p.hidden = true;
        }
      });
    };
  }

  function rovingTabindex(nav) {
    if (!nav) return;
    var tabs = Array.prototype.slice.call(nav.querySelectorAll('[role="tab"]'));
    nav.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var next = i;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else return;
      e.preventDefault();
      tabs[next].focus();
      var route = tabs[next].getAttribute("data-csat-route");
      if (route) location.hash = route.replace(/^#/, "");
    });
  }

  window.addEventListener("hashchange", function () {
    renderRoute(parseHash());
  });

  document.querySelectorAll(".csatSubtabNav").forEach(rovingTabindex);

  var initial = viewport.getAttribute("data-initial-route") || "#/overview";
  if (!location.hash) location.hash = initial.replace(/^#/, "");
  renderRoute(parseHash());
  bindSubnav();
})();
