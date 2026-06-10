/**
 * CoreUI.gs
 *
 * Orchestrator for the shared WebApp UI. Delegates to top-level helper
 * functions defined in companion files:
 *   - CoreUI_Css.gs       → _CoreUI_Css_getStylesheet()
 *   - CoreUI_Markup.gs    → _CoreUI_Markup_getHeadScripts(), _CoreUI_Markup_getAppShell(cfg)
 *   - CoreUI_Js.gs        → _CoreUI_Js_getJsBundle()
 *
 * Why direct function references instead of a registration pattern:
 *   Apps Script does not provide deterministic load ordering across .gs files.
 *   Top-level IIFEs in companion files cannot reliably mutate a namespace
 *   defined in another .gs file. Direct function references resolve at call
 *   time, by which point all files have loaded.
 */

var CoreUI = (function () {

  /**
   * Returns the full shared stylesheet as a string of CSS rules (no <style> tag).
   * @return {string}
   */
  function getStylesheet() {
    if (typeof _CoreUI_Css_getStylesheet !== 'function') {
      throw new Error('CoreUI.getStylesheet: _CoreUI_Css_getStylesheet not defined. ' +
        'Confirm CoreUI_Css.gs is present in CoreLib.');
    }
    return _CoreUI_Css_getStylesheet();
  }

  /**
   * Returns markup that belongs inside <head> (e.g. <script> tags for
   * external libraries like html2canvas).
   * @return {string}
   */
  function getHeadScripts() {
    if (typeof _CoreUI_Markup_getHeadScripts !== 'function') {
      throw new Error('CoreUI.getHeadScripts: _CoreUI_Markup_getHeadScripts not defined. ' +
        'Confirm CoreUI_Markup.gs is present in CoreLib.');
    }
    return _CoreUI_Markup_getHeadScripts();
  }

  /**
   * Returns the full <body> shell markup (header, tab bar, tab containers,
   * modals) driven by the supplied AppConfig.
   * @param {AppConfig} config
   * @return {string}
   */
  function getAppShell(config) {
    if (typeof _CoreUI_Markup_getAppShell !== 'function') {
      throw new Error('CoreUI.getAppShell: _CoreUI_Markup_getAppShell not defined. ' +
        'Confirm CoreUI_Markup.gs is present in CoreLib.');
    }
    var cfg = CoreConfig.withDefaults(config);
    return _CoreUI_Markup_getAppShell(cfg);
  }

  /**
   * Returns the full client-side JS bundle as a string (no <script> tag).
   * The bundle reads window.APP_UI_CONFIG at runtime to drive per-app variations.
   * @return {string}
   */
  function getJsBundle() {
    if (typeof _CoreUI_Js_getJsBundle !== 'function') {
      throw new Error('CoreUI.getJsBundle: _CoreUI_Js_getJsBundle not defined. ' +
        'Confirm CoreUI_Js.gs is present in CoreLib.');
    }
    return _CoreUI_Js_getJsBundle();
  }

  return {
    getStylesheet:  getStylesheet,
    getHeadScripts: getHeadScripts,
    getAppShell:    getAppShell,
    getJsBundle:    getJsBundle
  };
})();