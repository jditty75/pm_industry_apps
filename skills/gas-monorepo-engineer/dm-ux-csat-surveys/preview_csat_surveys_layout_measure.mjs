/**
 * Playwright layout metrics for CSAT Surveys at 1440×900 (Normal + smoke Heavy/Prep).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const PW_DIR = path.join(REPO, ".preview-out", ".playwright-measure");

function ensurePlaywright() {
  const pkgPath = path.join(PW_DIR, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.mkdirSync(PW_DIR, { recursive: true });
    fs.writeFileSync(pkgPath, JSON.stringify({ name: "csat-surveys-pw", private: true, type: "module" }));
    const r = spawnSync("npm", ["install", "playwright@1.49.1", "--no-save", "--no-package-lock"], {
      cwd: PW_DIR,
      encoding: "utf-8",
      shell: true,
      timeout: 240_000,
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    spawnSync("npx", ["playwright", "install", "chromium"], {
      cwd: PW_DIR,
      encoding: "utf-8",
      shell: true,
      timeout: 240_000,
    });
  }
}

async function loadChromium() {
  const modPath = path.join(PW_DIR, "node_modules", "playwright", "index.mjs");
  const mod = await import(pathToFileURL(modPath).href);
  return mod.chromium;
}

function launchPreview() {
  const py = process.platform === "win32" ? "python" : "python3";
  const r = spawnSync(py, [path.join(__dirname, "preview_csat_surveys.py"), "--no-open"], {
    cwd: REPO,
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  const m = (r.stdout || "").match(/serve: (http:\/\/127\.0\.0\.1:\d+)/);
  if (!m) {
    console.error("serve URL not found");
    process.exit(1);
  }
  return m[1];
}

async function measurePage(chromium, baseUrl, pageName) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/${pageName}`, { waitUntil: "networkidle" });
  const metrics = await page.evaluate(() => {
    const vh = window.innerHeight;
    const sel = (id) => document.querySelector(id);
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const upcoming = sel("#csat-sv-upcoming");
    const inflight = sel("#csat-sv-inflight");
    const recent = sel("#csat-sv-recent");
    const upcomingBox = box(upcoming);
    const inflightBox = box(inflight);
    const recentBox = box(recent);
    const upcomingTitle = sel("#csat-sv-upcoming-title");
    const inflightTitle = sel("#csat-sv-inflight-title");
    const recentTitle = sel("#csat-sv-recent-title");
    const firstRow = document.querySelector('[data-csat-surveys-row="compact"]');
    const rowBox = box(firstRow);
    const headingsVisible =
      upcomingTitle &&
      inflightTitle &&
      recentTitle &&
      upcomingTitle.getBoundingClientRect().top >= 0 &&
      upcomingTitle.getBoundingClientRect().top < vh &&
      inflightTitle.getBoundingClientRect().top >= 0 &&
      inflightTitle.getBoundingClientRect().top < vh &&
      recentTitle.getBoundingClientRect().top >= 0 &&
      recentTitle.getBoundingClientRect().top < vh;
    const openDetails = document.querySelectorAll('.csat-sv-details[open]').length;
    return {
      viewportHeight: vh,
      upcomingBottom: upcomingBox ? Math.round(upcomingBox.bottom) : null,
      inflightTop: inflightBox ? Math.round(inflightBox.top) : null,
      inflightBottom: inflightBox ? Math.round(inflightBox.bottom) : null,
      recentTop: recentBox ? Math.round(recentBox.top) : null,
      allPhaseHeadingsInViewport: Boolean(headingsVisible),
      sampleRowHeight: rowBox ? Math.round(rowBox.height) : null,
      openInvitationDetails: openDetails,
    };
  });
  await browser.close();
  return metrics;
}

async function main() {
  ensurePlaywright();
  const chromium = await loadChromium();
  const base = launchPreview();
  const reportPath = path.join(REPO, ".preview-out", "CSAT_SURVEYS_LAYOUT_1440x900.json");
  const report = { capturedAt: new Date().toISOString(), viewport: "1440x900", pages: {} };

  for (const page of [
    "CSAT_SURVEYS_NORMAL.html",
    "CSAT_SURVEYS_HEAVY.html",
    "CSAT_SURVEYS_PREP.html",
  ]) {
    report.pages[page] = await measurePage(chromium, base, page);
    console.log(`${page}:`, JSON.stringify(report.pages[page]));
  }

  const normal = report.pages["CSAT_SURVEYS_NORMAL.html"];
  if (!normal.allPhaseHeadingsInViewport) {
    console.error("NORMAL: not all phase headings visible at 1440×900");
    process.exit(1);
  }
  if (normal.sampleRowHeight != null && normal.sampleRowHeight > 72) {
    console.error(`NORMAL: sample row height ${normal.sampleRowHeight}px exceeds 72px cap`);
    process.exit(1);
  }
  if (normal.openInvitationDetails > 0) {
    console.error("NORMAL: invitation details should be collapsed by default");
    process.exit(1);
  }
  for (const page of ["CSAT_SURVEYS_HEAVY.html", "CSAT_SURVEYS_PREP.html"]) {
    const m = report.pages[page];
    if (m.sampleRowHeight != null && m.sampleRowHeight > 80) {
      console.error(`${page}: row height ${m.sampleRowHeight}px unexpectedly large`);
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`layout report: ${reportPath}`);
  console.log("PASS preview_csat_surveys_layout_measure.mjs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
