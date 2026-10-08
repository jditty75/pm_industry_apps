const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function createSandbox() {
  const sandbox = {
    console,
    Logger: { log() {} },
    Session: { getActiveUser() { return { getEmail: () => 'test@test.com' }; } }
  };
  vm.createContext(sandbox);
  return sandbox;
}

function loadMarkupModule(sandbox) {
  const files = ['CoreConfig.js', 'CoreUI_Css.js', 'CoreUI_Js.js', 'CoreUI_Markup.js'];
  files.forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  });
}

function countDivBalance(html) {
  const opens = (html.match(/<div[\s>]/gi) || []).length;
  const closes = (html.match(/<\/div>/gi) || []).length;
  return { opens, closes, balanced: opens === closes };
}

function findTabContentIds(html) {
  const re = /<div[^>]*\bid="([^"]*)"[^>]*class="[^"]*\btab-content\b[^"]*"/gi;
  const re2 = /<div[^>]*class="[^"]*\btab-content\b[^"]*"[^>]*\bid="([^"]*)"/gi;
  const tabIds = [];
  let m;
  while ((m = re.exec(html)) !== null) tabIds.push(m[1]);
  while ((m = re2.exec(html)) !== null) {
    if (tabIds.indexOf(m[1]) === -1) tabIds.push(m[1]);
  }
  return tabIds;
}

const SLG_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'solutions', 'SLG_DM', 'src', 'Config_SLG.js');
const HC_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'solutions', 'HC_DM', 'src', 'Config_HC.js');
const HENP_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'solutions', 'HENP_DM', 'src', 'Config_HENP.js');

const CONFIGS = [
  { label: 'SLG', path: SLG_CONFIG_PATH, code: 'Code_SLG.js' },
  { label: 'HC', path: HC_CONFIG_PATH, code: 'Code_HC.js' },
  { label: 'HENP', path: HENP_CONFIG_PATH, code: 'Code_HENP.js' }
];

CONFIGS.forEach(cfg => {
  test(cfg.label + ': assembled app shell has balanced div tags (blank-tab regression)', () => {
    const sandbox = createSandbox();
    const codeFile = path.join(path.dirname(cfg.path), cfg.code);
    if (fs.existsSync(codeFile)) {
      vm.runInContext(fs.readFileSync(codeFile, 'utf8'), sandbox, { filename: cfg.code });
    } else {
      vm.runInContext('var TABLES = []; var BAR_CONFIG = {};', sandbox);
    }
    vm.runInContext(fs.readFileSync(cfg.path, 'utf8'), sandbox, { filename: path.basename(cfg.path) });
    loadMarkupModule(sandbox);

    const access = { role: 'ADMIN', canViewApp: true, email: 'test@test.com', canEdit: true };
    const html = vm.runInContext(
      `_CoreUI_Markup_getAppShell(APP_CONFIG, ${JSON.stringify(access)})`,
      sandbox
    );
    assert.ok(html.length > 1000, 'shell should be non-trivial');

    const { opens, closes, balanced } = countDivBalance(html);
    assert.ok(balanced, `div balance: ${opens} opens vs ${closes} closes (delta ${opens - closes})`);
  });

  test(cfg.label + ': all .tab-content elements are top-level siblings (not nested)', () => {
    const sandbox = createSandbox();
    const codeFile = path.join(path.dirname(cfg.path), cfg.code);
    if (fs.existsSync(codeFile)) {
      vm.runInContext(fs.readFileSync(codeFile, 'utf8'), sandbox, { filename: cfg.code });
    } else {
      vm.runInContext('var TABLES = []; var BAR_CONFIG = {};', sandbox);
    }
    vm.runInContext(fs.readFileSync(cfg.path, 'utf8'), sandbox, { filename: path.basename(cfg.path) });
    loadMarkupModule(sandbox);

    const access = { role: 'ADMIN', canViewApp: true, email: 'test@test.com', canEdit: true };
    const html = vm.runInContext(
      `_CoreUI_Markup_getAppShell(APP_CONFIG, ${JSON.stringify(access)})`,
      sandbox
    );

    const tabIds = findTabContentIds(html);
    assert.ok(tabIds.length >= 5, `expected at least 5 tabs, found ${tabIds.length}: ${tabIds.join(', ')}`);
    assert.ok(tabIds.indexOf('csat-tab') !== -1, 'csat-tab present');

    const { opens: totalOpens, closes: totalCloses } = countDivBalance(html);
    assert.strictEqual(totalOpens, totalCloses, 'global div balance');

    tabIds.forEach(id => {
      const tabRe = new RegExp(`<div[^>]*id="${id}"[^>]*>`);
      const match = tabRe.exec(html);
      assert.ok(match, `tab #${id} found`);
      const afterOpen = html.substring(match.index + match[0].length);
      let depth = 1;
      const divRe = /<div[\s>]|<\/div>/gi;
      let m2;
      let tabEndIdx = -1;
      while ((m2 = divRe.exec(afterOpen)) !== null) {
        if (m2[0].startsWith('</')) depth--;
        else depth++;
        if (depth === 0) { tabEndIdx = match.index + match[0].length + m2.index + m2[0].length; break; }
      }
      assert.ok(tabEndIdx > 0, `tab #${id} closes`);
      const tabContent = html.substring(match.index + match[0].length, tabEndIdx);
      const nestedTabs = findTabContentIds(tabContent);
      assert.strictEqual(nestedTabs.length, 0,
        `tab #${id} should not contain nested tab-content (found: ${nestedTabs.join(', ')})`);
    });
  });
});

test('HENP: student-tab present when student config enabled', () => {
  const sandbox = createSandbox();
  const codeFile = path.join(path.dirname(HENP_CONFIG_PATH), 'Code_HENP.js');
  if (fs.existsSync(codeFile)) {
    vm.runInContext(fs.readFileSync(codeFile, 'utf8'), sandbox, { filename: 'Code_HENP.js' });
  } else {
    vm.runInContext('var TABLES = []; var BAR_CONFIG = {};', sandbox);
  }
  vm.runInContext(fs.readFileSync(HENP_CONFIG_PATH, 'utf8'), sandbox, { filename: 'Config_HENP.js' });
  loadMarkupModule(sandbox);

  const access = { role: 'ADMIN', canViewApp: true, email: 'test@test.com', canEdit: true };
  const html = vm.runInContext(
    `_CoreUI_Markup_getAppShell(APP_CONFIG, ${JSON.stringify(access)})`,
    sandbox
  );
  assert.ok(html.includes('id="student-tab"'), 'HENP should include student-tab');
  const csatIdx = html.indexOf('id="csat-tab"');
  const studentIdx = html.indexOf('id="student-tab"');
  assert.ok(studentIdx > csatIdx, 'student-tab should come after csat-tab');

  const csatClose = html.indexOf('</div>', html.indexOf('id="csat-tab"'));
  assert.ok(csatClose < studentIdx || csatClose > 0, 'csat-tab should close before student-tab starts');
});
