import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'screenshots');
const proto = path.join(__dirname, 'prototype.html');
const protoUrl = 'file:///' + proto.replace(/\\/g, '/');

const shots = [
  { name: 'normal-portfolio-16', scenario: 'portfolio-16', width: 1440, height: 900 },
  { name: 'new-escalated-1440', scenario: 'new-escalated', width: 1440, height: 900 },
  { name: 'quiet-1440', scenario: 'quiet', width: 1440, height: 900 },
  { name: 'expanded-detail-1440', scenario: 'expanded', width: 1440, height: 900 },
  { name: 'history-1440', scenario: 'history', width: 1440, height: 900 },
  { name: 'normal-portfolio-1280', scenario: 'portfolio-16', width: 1280, height: 900 }
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  await page.goto(`${protoUrl}?scenario=${shot.scenario}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, `${shot.name}.png`), fullPage: false });
  await page.close();
}
await browser.close();
console.log('Wrote screenshots to', outDir);
