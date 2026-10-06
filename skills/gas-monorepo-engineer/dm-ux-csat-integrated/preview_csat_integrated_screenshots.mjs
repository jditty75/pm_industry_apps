/**
 * Playwright captures for CSAT integrated prototype (1440×900).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const OUT_DIR = path.join(REPO, ".preview-out", "csat-integrated-screenshots");

const CAPTURES = [
  ["CSAT_INTEGRATED.html#/overview", "CSAT_INTEGRATED_overview_1440x900.png"],
  ["CSAT_INTEGRATED.html#/surveys", "CSAT_INTEGRATED_surveys_1440x900.png"],
  ["CSAT_INTEGRATED_RESPONSES_NORMAL.html#/responses", "CSAT_INTEGRATED_responses_normal_1440x900.png"],
  ["CSAT_INTEGRATED_RESPONSES_T2_DETAIL.html#/responses", "CSAT_INTEGRATED_responses_t2_1440x900.png"],
  ["CSAT_INTEGRATED_RESPONSES_LOW_VOLUME.html#/responses", "CSAT_INTEGRATED_responses_low_volume_1440x900.png"],
  ["CSAT_INTEGRATED_DEPLOYMENT_MDS_PGL.html#/deployment/syn-ehn-001/csat", "CSAT_INTEGRATED_deployment_mds_pgl_1440x900.png"],
  ["CSAT_INTEGRATED_HENP.html#/overview", "CSAT_INTEGRATED_henp_1440x900.png"],
];

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

function screenshot(url, outPath) {
  const r = spawnSync(
    "npx",
    ["--yes", "playwright", "screenshot", url, outPath, "--viewport-size=1440,900", "--wait-for-timeout=800"],
    { cwd: REPO, encoding: "utf-8", shell: true },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
}

function main() {
  const base = launchPreview();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [page, outName] of CAPTURES) {
    const url = `${base}/${page}`;
    const outPath = path.join(OUT_DIR, outName);
    screenshot(url, outPath);
    const size = fs.statSync(outPath).size;
    console.log(`screenshot: ${outPath} (${size} bytes)`);
  }
  console.log("PASS preview_csat_integrated_screenshots.mjs");
}

main();
