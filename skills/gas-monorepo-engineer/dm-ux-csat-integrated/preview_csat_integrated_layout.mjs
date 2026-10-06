/**
 * Playwright bounding-box overlap checks for integrated CSAT rows.
 * Fails when sibling row facets overlap beyond tolerance (desktop widths).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");

const VIEWPORTS = [
  [1280, 900],
  [1440, 900],
];

const ROUTES = [
  "CSAT_INTEGRATED.html#/overview",
  "CSAT_INTEGRATED.html#/surveys",
  "CSAT_INTEGRATED_RESPONSES_NORMAL.html#/responses",
  "CSAT_INTEGRATED_RESPONSES_T2_DETAIL.html#/responses",
  "CSAT_INTEGRATED_DEPLOYMENT_MDS_PGL.html#/deployment/syn-ehn-001/csat",
];

const ROW_SELECTORS = [
  ".csat-row-name",
  ".csat-row-meta",
  ".csat-row-status",
  ".csat-row-key",
  ".csat-row-evidence",
  ".csat-row-date",
];

const TOLERANCE_PX = 2;

function launchPreview() {
  const py = process.platform === "win32" ? "python" : "python3";
  const r = spawnSync(py, [path.join(__dirname, "preview_csat_integrated.py"), "--no-open"], {
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

function overlaps(a, b, tol) {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  const hGap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const vGap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return hGap > tol && vGap > tol;
}

async function checkPage(page, url, viewport) {
  await page.setViewportSize({ width: viewport[0], height: viewport[1] });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(400);

  const markerCount = await page.locator(".csat-row-marker").count();
  if (markerCount > 0) {
    throw new Error(`${url} @ ${viewport.join("x")}: found ${markerCount} .csat-row-marker (removed column)`);
  }

  const rowCount = await page.locator(".csat-row").count();
  if (rowCount === 0) {
    return { rowCount: 0, overlaps: 0 };
  }

  const hits = await page.evaluate(
    ({ selectors, tol }) => {
      const out = [];
      document.querySelectorAll(".csat-row").forEach((row, rowIndex) => {
        const boxes = [];
        for (const sel of selectors) {
          row.querySelectorAll(sel).forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return;
            const style = window.getComputedStyle(el);
            if (style.visibility === "hidden" || style.display === "none") return;
            boxes.push({ sel, el, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } });
          });
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const elA = boxes[i].el;
            const elB = boxes[j].el;
            if (elA.contains(elB) || elB.contains(elA)) continue;
            const a = boxes[i].rect;
            const b = boxes[j].rect;
            const hGap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const vGap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (hGap > tol && vGap > tol) {
              out.push({ rowIndex, a: boxes[i].sel, b: boxes[j].sel, hGap, vGap });
            }
          }
        }
      });
      return out;
    },
    { selectors: ROW_SELECTORS, tol: TOLERANCE_PX },
  );

  if (hits.length) {
    const sample = hits.slice(0, 5).map((h) => `row ${h.rowIndex}: ${h.a} × ${h.b}`).join("; ");
    throw new Error(`${url} @ ${viewport.join("x")}: ${hits.length} overlap(s) — ${sample}`);
  }
  return { rowCount, overlaps: 0 };
}

async function main() {
  const base = launchPreview();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let checked = 0;
  for (const route of ROUTES) {
    const url = `${base}/${route}`;
    for (const vp of VIEWPORTS) {
      const result = await checkPage(page, url, vp);
      checked += 1;
      console.log(`layout ok: ${route} ${vp[0]}x${vp[1]} rows=${result.rowCount}`);
    }
  }
  await browser.close();
  console.log(`PASS preview_csat_integrated_layout.mjs (${checked} viewport checks)`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
