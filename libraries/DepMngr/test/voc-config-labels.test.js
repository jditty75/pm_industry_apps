const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', 'solutions');

/** @type {Array<{ app:string, configFile:string, exposed:boolean }>} */
const APPS = [
  { app: 'SLG_DM', configFile: 'Config_SLG.js', exposed: true },
  { app: 'HC_DM', configFile: 'Config_HC.js', exposed: true },
  { app: 'HENP_DM', configFile: 'Config_HENP.js', exposed: true },
  { app: 'EVI_DM', configFile: 'Config_EVI.js', exposed: false },
  { app: 'PDX_DM', configFile: 'Config_PDX.js', exposed: false },
  { app: 'HS_DM', configFile: 'Config_HS.js', exposed: false }
];

test('exposed DM apps use VoC tab label; hidden apps keep VoC tab disabled', () => {
  APPS.forEach(({ app, configFile, exposed }) => {
    const text = fs.readFileSync(path.join(ROOT, app, 'src', configFile), 'utf8');
    if (exposed) {
      assert.match(text, /label:\s*'VoC'/);
      assert.doesNotMatch(text, /label:\s*'CSAT'/);
      assert.doesNotMatch(text, /label:\s*'MGM \/ PGL'/);
    }
    if (!exposed) {
      const disabled = /mgmPglTab:\s*\{[^}]*enabled:\s*false/s.test(text) ||
        !text.includes("id: 'mgmPgl'") && !text.includes('id: "mgmPgl"');
      assert.ok(disabled, `${app} should not expose VoC tab`);
    }
  });
});
