/**
 * Playwright visual smoke for CSAT Surveys prototype (1440×900).
 * Uses `npx playwright screenshot` (no local package.json required).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const OUT_DIR = path.join(REPO, ".preview-out");

const CAPTURES = [
  ["CSAT_SURVEYS_NORMAL.html", "CSAT_SURVEYS_NORMAL_1440x900.png"],
  ["CSAT_SURVEYS_HEAVY.html", "CSAT_SURVEYS_HEAVY_1440x900.png"],
  ["CSAT_SURVEYS_PREP.html", "CSAT_SURVEYS_PREP_1440x900.png"],
  ["CSAT_SURVEYS_CHASE.html", "CSAT_SURVEYS_CHASE_1440x900.png"],
];

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

function screenshot(url, outPath) {
  const r = spawnSync(
    "npx",
    ["--yes", "playwright", "screenshot", url, outPath, "--viewport-size=1440,900"],
    { cwd: REPO, encoding: "utf-8", shell: true },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
}

function runLayoutMeasure() {
  const r = spawnSync("node", [path.join(__dirname, "preview_csat_surveys_layout_measure.mjs")], {
    cwd: REPO,
    encoding: "utf-8",
    shell: true,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  process.stdout.write(r.stdout || "");
}

function main() {
  const base = launchPreview();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [page, outName] of CAPTURES) {
    const url = `${base}/${page}`;
    const outPath = path.join(OUT_DIR, outName);
    screenshot(url, outPath);
    const size = fs.statSync(outPath).size;
    if (size < 10_000) {
      console.error(`screenshot too small: ${outPath} (${size} bytes)`);
      process.exit(1);
    }
    console.log(`screenshot: ${outPath} (${size} bytes)`);
  }
  runLayoutMeasure();
  console.log("PASS preview_csat_surveys_visual_smoke.mjs");
}

main();
