/**
 * Extract DepMngr CoreUI string bundles and app shell markup for local preview.
 * Runs in Node (no network). Does not load clasp or production credentials.
 *
 * Usage:
 *   node gas_bundle_extract.mjs <repoRoot> css|js|head|shell <solutionSrcDir> <configFile> <codeFile>
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const [repoRoot, mode, solutionSrc, configFile, codeFile] = process.argv.slice(2);
if (!repoRoot || !mode) {
  console.error('usage: node gas_bundle_extract.mjs <repoRoot> css|js|head|shell <solutionSrc> <config.js> <code.js>');
  process.exit(2);
}

const depSrc = path.join(repoRoot, 'libraries', 'DepMngr', 'src');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function createSandbox(extra = {}) {
  const sandbox = {
    console,
    Logger: { log() {} },
    Session: {
      getActiveUser() {
        return { getEmail: () => 'preview.user@workday.com' };
      },
    },
    ...extra,
  };
  vm.createContext(sandbox);
  return sandbox;
}

function runInSandbox(sandbox, code, label) {
  try {
    vm.runInContext(code, sandbox, { filename: label });
  } catch (e) {
    console.error(`gas_bundle_extract: failed in ${label}:`, e.message);
    process.exit(1);
  }
}

function loadDepMngrCore(sandbox) {
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreConfig.js')), 'CoreConfig.js');
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreUI_Css.js')), 'CoreUI_Css.js');
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreUI_Js.js')), 'CoreUI_Js.js');
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreUI_Markup.js')), 'CoreUI_Markup.js');
}

if (mode === 'css') {
  const sandbox = createSandbox();
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreUI_Css.js')), 'CoreUI_Css.js');
  const out = vm.runInContext('_CoreUI_Css_getStylesheet()', sandbox);
  process.stdout.write(String(out));
} else if (mode === 'js') {
  const sandbox = createSandbox();
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreUI_Js.js')), 'CoreUI_Js.js');
  const out = vm.runInContext('_CoreUI_Js_getJsBundle()', sandbox);
  process.stdout.write(String(out));
} else if (mode === 'head') {
  const sandbox = createSandbox();
  runInSandbox(sandbox, read(path.join(depSrc, 'CoreUI_Markup.js')), 'CoreUI_Markup.js');
  const out = vm.runInContext('_CoreUI_Markup_getHeadScripts()', sandbox);
  process.stdout.write(String(out));
} else if (mode === 'shell') {
  const srcDir = path.resolve(repoRoot, solutionSrc);
  const cfgPath = path.join(srcDir, configFile);
  const codePath = path.join(srcDir, codeFile);
  const sandbox = createSandbox();
  if (fs.existsSync(codePath)) {
    runInSandbox(sandbox, read(codePath), codeFile);
  } else {
    runInSandbox(sandbox, 'var TABLES = []; var BAR_CONFIG = {};', 'constants-stub');
  }
  runInSandbox(sandbox, read(cfgPath), configFile);
  loadDepMngrCore(sandbox);
  const userAccess = {
    role: 'ADMIN',
    canViewApp: true,
    email: 'preview.user@workday.com',
    canEdit: true,
  };
  sandbox.__userAccess = userAccess;
  const out = vm.runInContext(
    `_CoreUI_Markup_getAppShell(APP_CONFIG, ${JSON.stringify(userAccess)})`,
    sandbox
  );
  process.stdout.write(String(out));
} else {
  console.error('unknown mode:', mode);
  process.exit(2);
}
