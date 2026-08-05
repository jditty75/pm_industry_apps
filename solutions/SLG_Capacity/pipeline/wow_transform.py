#!/usr/bin/env python3
r"""
WoW Consolidated Workbook Transform
===================================

Input: the true WoW export (locally renamed to WoW_Export.xlsx), sheets:
    UTIL_Previous, UTIL_Current, UTIL_Next, Forecast, Actuals_Historical

Output: a consolidated, app-ready workbook:
    Forecast_Staged              wide PSA-compatible staffed forecast (has Employee ID)
    Unstaffed_Demand             forecast rows with NO Employee ID (unstaffed/contingency roles) — retained for review
    Actuals_Current_Normalized   current-quarter weekly actuals (UTIL_Current)
    Utilization_Normalized       worker x fiscal quarter target/rate/QTD (3 UTIL sheets)
    History_Normalized           worker x project x fiscal quarter worked hours
    _manifest                    control totals + daily diff

Revised Jul 30 2026:
  - Forecast headers auto-injected: A(0)->'Employee ID', D(3)->'Account' when blank
    (replaces the manual pre-edit; injects only when blank, logs it).
  - Forecast split by Employee ID: staffed -> Forecast_Staged; blank-ID -> Unstaffed_Demand.
  - UTIL sheets all use uniform header-row detection (Employee ID row); the old
    UTIL_Current special-case is gone. Bonus-target uses labeled header, positional
    fallback retained only as a warned last resort.

Usage:
    python wow_transform.py <input.xlsx> [output.xlsx]

Exit: 0 = passed; 1 = validation/transform failure (no output written); 2 = usage/input error.
"""

import datetime as dt
import os
import re
import sys

import pandas as pd


# ============================================================
# Contract
# ============================================================

REQUIRED_INPUT_SHEETS = [
    "Forecast",
    "Actuals_Historical",
    "UTIL_Previous",
    "UTIL_Current",
    "UTIL_Next",
]

OUT_FORECAST = "Forecast_Staged"
OUT_UNSTAFFED = "Unstaffed_Demand"
OUT_ACTUALS = "Actuals_Current_Normalized"
OUT_UTIL = "Utilization_Normalized"
OUT_HISTORY = "History_Normalized"
OUT_MANIFEST = "_manifest"

JUNK_WORKERS = {"", "(Blank)", "Total", "nan", "None"}

FISCAL_QUARTER_BY_MONTH = {
    1: "Q4", 2: "Q1", 3: "Q1", 4: "Q1", 5: "Q2", 6: "Q2",
    7: "Q2", 8: "Q3", 9: "Q3", 10: "Q3", 11: "Q4", 12: "Q4",
}
FISCAL_QUARTER_BY_START_MONTH = {2: "Q1", 5: "Q2", 8: "Q3", 11: "Q4"}


# ============================================================
# Helpers
# ============================================================

def normalize_employee_id(value) -> str:
    """String IDs. Contractors may be C#####; numeric ids arrive as float 10039.0."""
    if pd.isna(value):
        return ""
    s = str(value).strip()
    return s[:-2] if re.fullmatch(r"\d+\.0", s) else s


def is_junk_worker(value) -> bool:
    return str(value).strip() in JUNK_WORKERS


def is_date_header(value) -> bool:
    return isinstance(value, (dt.date, dt.datetime, pd.Timestamp))


def fiscal_quarter_from_date(value) -> str:
    v = pd.Timestamp(value)
    fy = v.year + 1 if v.month >= 2 else v.year
    return f"FY{str(fy)[-2:]}-{FISCAL_QUARTER_BY_MONTH[v.month]}"


def fiscal_quarter_from_history_label(value) -> str:
    m = re.search(r"FY\s*(\d{2,4})\s*[- ]\s*Q([1-4])", str(value).strip(), re.IGNORECASE)
    if not m:
        return ""
    return f"FY{m.group(1)[-2:]}-Q{m.group(2)}"


def fiscal_quarter_from_util_title(value):
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(value))
    if not m:
        return None
    mo, yr = int(m.group(1)), int(m.group(3))
    q = FISCAL_QUARTER_BY_START_MONTH.get(mo)
    return f"FY{str(yr + 1)[-2:]}-{q}" if q else None


def find_exact_column(df, name):
    for c in df.columns:
        if str(c).strip().lower() == name.lower():
            return c
    return None


def safe_numeric(series):
    return pd.to_numeric(series, errors="coerce").fillna(0)


def classify_history_worker(worker_name, region) -> str:
    if "[C]" in str(worker_name):
        return "Contractor"
    if str(region).strip() == "Government":
        return "SLG"
    return "Non-SLG"


def validate_input_workbook(xl):
    missing = [s for s in REQUIRED_INPUT_SHEETS if s not in xl.sheet_names]
    if missing:
        raise ValueError("Input workbook missing required sheet(s): " + ", ".join(missing))


def forecast_week_columns(df):
    return [c for c in df.columns
            if isinstance(c, str) and re.fullmatch(r"\d{2}/\d{2}/\d{4}", str(c))]


# ============================================================
# Forecast: auto-inject headers, then split staffed / unstaffed
# ============================================================

def load_forecast_wide(xl, log):
    """Read Forecast, locate header row, auto-inject blank A/D headers, return wide df."""
    raw = xl.parse("Forecast", header=None)

    # Header row = the row whose col 0 is 'Employee ID' OR (blank col 0 but col 1 == 'Worker').
    header_row = None
    for i in range(min(6, len(raw))):
        c0 = str(raw.iloc[i, 0]).strip()
        c1 = str(raw.iloc[i, 1]).strip() if raw.shape[1] > 1 else ""
        if c0 == "Employee ID" or (c0 in ("", "nan") and c1 == "Worker"):
            header_row = i
            break
    if header_row is None:
        raise ValueError("Forecast: could not locate header row (expected 'Employee ID' or blank+'Worker').")

    hdr = list(raw.iloc[header_row])

    # Auto-inject required headers when blank (never overwrite a real header).
    def blank(v):
        return pd.isna(v) or str(v).strip() in ("", "nan")

    if len(hdr) > 0 and blank(hdr[0]):
        hdr[0] = "Employee ID"
        log.append("Forecast: injected blank header A -> 'Employee ID'")
    if len(hdr) > 3 and blank(hdr[3]):
        hdr[3] = "Account"
        log.append("Forecast: injected blank header D -> 'Account'")

    df = raw.iloc[header_row + 1:].copy()
    df.columns = hdr
    df = df.reset_index(drop=True)

    if "Employee ID" not in df.columns or "Worker" not in df.columns:
        raise ValueError("Forecast: required 'Employee ID'/'Worker' columns missing after header injection.")
    return df


def build_forecast_split(xl, log):
    """Returns (staffed_df, unstaffed_df). Staffed has Employee ID; unstaffed does not."""
    fc = load_forecast_wide(xl, log)
    fc = fc[~fc["Worker"].map(is_junk_worker)].copy()
    fc["Employee ID"] = fc["Employee ID"].map(normalize_employee_id)

    weekly = forecast_week_columns(fc)
    if not weekly:
        raise ValueError("Forecast: no MM/DD/YYYY weekly columns found.")

    # Trim leading all-zero week columns (applied to the full sheet before split).
    retained = list(weekly)
    while retained:
        if safe_numeric(fc[retained[0]]).sum() == 0:
            retained.pop(0)
        else:
            break
    if not retained:
        raise ValueError("Forecast: all weekly columns are zero after removing footer rows.")

    # Context columns required by the app's normalizeStaff (validate on staffed set).
    required_context = [
        "Employee ID", "Worker", "Project Role", "Account", "Region - Worker",
        "Worker's Manager", "Project", "Project Region", "Job Profile",
        "Customer Segment Practice", "Specialty Practice", "Engagement Manager",
        "Customer Projects", "Internal Projects (Excludes Education)",
        "Education Projects", "Resource Type", "Project Role Category",
    ]

    # Split by Employee ID presence.
    has_id = fc["Employee ID"] != ""
    staffed = fc[has_id].copy()
    unstaffed = fc[~has_id].copy()

    missing_ctx = [c for c in required_context if c not in staffed.columns]
    if missing_ctx:
        raise ValueError("Forecast staffed set missing normalizeStaff context columns: "
                         + ", ".join(missing_ctx))

    # Keep original column order, weekly columns trimmed to `retained`.
    non_week = [c for c in fc.columns if c not in weekly]
    out_cols = non_week + retained

    staffed = staffed[out_cols].copy()
    unstaffed = unstaffed[out_cols].copy()
    for c in retained:
        staffed[c] = safe_numeric(staffed[c])
        unstaffed[c] = safe_numeric(unstaffed[c])

    log.append(f"Forecast split: {len(staffed)} staffed rows, {len(unstaffed)} unstaffed rows")
    return staffed, unstaffed, retained


# ============================================================
# UTIL (uniform header detection; positional target fallback with warning)
# ============================================================

def load_util_sheet(xl, sheet, log):
    raw = xl.parse(sheet, header=None)
    hdr = next((i for i in range(min(8, len(raw)))
                if str(raw.iloc[i, 0]).strip() == "Employee ID"), None)
    if hdr is None:
        raise ValueError(f"{sheet}: could not locate 'Employee ID' header row.")

    qk = next((fiscal_quarter_from_util_title(raw.iloc[i, 0]) for i in range(hdr)
               if fiscal_quarter_from_util_title(raw.iloc[i, 0])), None)

    raw_data = xl.parse(sheet, header=hdr)
    if qk is None:
        wk = [pd.Timestamp(c) for c in raw_data.columns if is_date_header(c)]
        if not wk:
            raise ValueError(f"{sheet}: no title range and no weekly date headers to derive quarter.")
        qk = fiscal_quarter_from_date(min(wk))

    df = raw_data.copy()
    df.columns = [str(c).strip() for c in df.columns]
    return df, qk


def target_hours_column(df, sheet, log):
    c = find_exact_column(df, "Bonus target billable hours at EoQ")
    if c:
        return c
    rate = find_exact_column(df, "Utilization target wkly hours")
    if rate is not None:
        i = list(df.columns).index(rate)
        if i + 1 < len(df.columns):
            log.append(f"{sheet}: bonus-target header not found; using positional fallback "
                       f"(column after 'Utilization target wkly hours'). VERIFY EXPORT.")
            return df.columns[i + 1]
    return None


def build_utilization(xl, log):
    frames = []
    for sheet in ["UTIL_Previous", "UTIL_Current", "UTIL_Next"]:
        df, qk = load_util_sheet(xl, sheet, log)
        emp = find_exact_column(df, "Employee ID")
        wkr = find_exact_column(df, "Worker")
        rate = find_exact_column(df, "Utilization target wkly hours")
        tgt = target_hours_column(df, sheet, log)
        qi = find_exact_column(df, "QTD actual ICP hours")
        qf = find_exact_column(df, "QTD ICP Hours + Forecast Hours")

        missing = [n for n, c in {"Employee ID": emp, "Worker": wkr,
                                  "Utilization target wkly hours": rate, "Target hours": tgt}.items()
                   if c is None]
        if missing:
            raise ValueError(f"{sheet}: missing required UTIL field(s): " + ", ".join(missing))

        out = pd.DataFrame({
            "employee_id": df[emp].map(normalize_employee_id),
            "resource_name": df[wkr].astype(str),
            "fiscal_quarter": qk,
            "target_hours": safe_numeric(df[tgt]),
            "util_rate_wkly": safe_numeric(df[rate]),
            "qtd_actual_icp": safe_numeric(df[qi]) if qi is not None else pd.NA,
            "qtd_icp_plus_forecast": safe_numeric(df[qf]) if qf is not None else pd.NA,
            "source_sheet": sheet,
        })
        out = out[(out["employee_id"] != "") & (~out["resource_name"].map(is_junk_worker))].copy()
        frames.append(out)
    return pd.concat(frames, ignore_index=True)


# ============================================================
# Current actuals (UTIL_Current weekly cells)
# ============================================================

def build_current_actuals(xl, log):
    df, _ = load_util_sheet(xl, "UTIL_Current", log)
    df = df[~df["Worker"].map(is_junk_worker)].copy()
    df["employee_id"] = df["Employee ID"].map(normalize_employee_id)
    df["_source_row"] = df.index + 2

    weekly = [c for c in df.columns if is_date_header(c)]
    if not weekly:
        # after str() header normalization the date cols may be strings — re-detect
        weekly = [c for c in df.columns if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", str(c))
                  or re.fullmatch(r"\d{2}/\d{2}/\d{4}", str(c))]
    if not weekly:
        raise ValueError("UTIL_Current: no dated weekly actual columns found.")

    act = df.melt(id_vars=["employee_id", "_source_row", "Worker"],
                  value_vars=weekly, var_name="_week", value_name="actual_icp_hours")
    act["actual_icp_hours"] = safe_numeric(act["actual_icp_hours"])
    act = act[(act["employee_id"] != "") & (act["actual_icp_hours"] != 0)].copy()
    act["week_start"] = pd.to_datetime(act["_week"])
    act["week_key"] = act["week_start"].dt.strftime("%Y-%m-%d")
    act = act.rename(columns={"Worker": "resource_name", "_source_row": "source_row"})
    return act[["employee_id", "resource_name", "week_start", "week_key",
                "actual_icp_hours", "source_row"]]


# ============================================================
# History
# ============================================================

def build_history(xl, log):
    src = xl.parse("Actuals_Historical").copy()
    req = ["Worker ID", "Worker", "Region as of Date Worked", "Project",
           "Project Role Category", "Worked Hours", "Fiscal Qtr"]
    missing = [c for c in req if c not in src.columns]
    if missing:
        raise ValueError("Actuals_Historical missing: " + ", ".join(missing))

    src = src[~src["Worker"].map(is_junk_worker)].copy()
    src["employee_id"] = src["Worker ID"].map(normalize_employee_id)
    src["worker_class"] = [classify_history_worker(w, r)
                           for w, r in zip(src["Worker"], src["Region as of Date Worked"])]
    src["fiscal_quarter"] = src["Fiscal Qtr"].map(fiscal_quarter_from_history_label)
    bad = (src["fiscal_quarter"] == "").sum()
    if bad:
        raise ValueError(f"Actuals_Historical: {bad} row(s) have an invalid Fiscal Qtr.")
    src["Worked Hours"] = safe_numeric(src["Worked Hours"])
    total = src["Worked Hours"].sum()

    hist = (src.groupby(["employee_id", "Worker", "worker_class", "fiscal_quarter",
                         "Project", "Project Role Category"], dropna=False)["Worked Hours"]
              .sum().reset_index()
              .rename(columns={"Worker": "resource_name", "Project": "project",
                               "Project Role Category": "project_role_category",
                               "Worked Hours": "worked_hours"}))
    return hist, total


# ============================================================
# Validation + manifest
# ============================================================

def validate(staffed, unstaffed, retained_weeks, actuals, util, hist, hist_total):
    results = []

    def chk(label, cond):
        results.append((bool(cond), label))

    # Forecast staffed
    staffed_ids = staffed["Employee ID"].map(normalize_employee_id)
    chk("Forecast_Staged: no blank Employee ID", (staffed_ids == "").sum() == 0)
    fdates = pd.to_datetime(retained_weeks, format="%m/%d/%Y")
    chk("Forecast_Staged: weekly headers present", len(retained_weeks) > 0)
    chk("Forecast_Staged: all weekly headers are Saturdays", (fdates.dayofweek == 5).all())
    chk("Forecast_Staged: weekly headers contiguous (7d)",
        len(fdates) <= 1 or fdates.to_series().diff().dropna().dt.days.eq(7).all())

    # Unstaffed
    chk("Unstaffed_Demand: all rows truly blank Employee ID",
        (unstaffed["Employee ID"].map(normalize_employee_id) == "").all())

    # Current actuals
    chk("Actuals_Current: no blank employee_id", (actuals["employee_id"] == "").sum() == 0)
    chk("Actuals_Current: all week_start are Saturdays", (actuals["week_start"].dt.dayofweek == 5).all())
    chk("Actuals_Current: week_key matches week_start",
        (actuals["week_key"] == actuals["week_start"].dt.strftime("%Y-%m-%d")).all())

    # UTIL_Current weekly sum == QTD per worker
    uc = util[util["source_sheet"] == "UTIL_Current"].set_index("employee_id")["qtd_actual_icp"].fillna(0)
    wk = actuals.groupby("employee_id")["actual_icp_hours"].sum()
    cmp = pd.concat([wk.rename("wk"), uc.rename("qtd")], axis=1).fillna(0)
    chk("UTIL_Current: weekly actuals == QTD per worker", (cmp["wk"] - cmp["qtd"]).abs().max() < 0.01)

    # Utilization
    chk("Utilization: no blank employee_id", (util["employee_id"] == "").sum() == 0)
    chk("Utilization: no null target_hours", util["target_hours"].isna().sum() == 0)
    chk("Utilization: no null util_rate_wkly", util["util_rate_wkly"].isna().sum() == 0)
    chk("Utilization: exactly 3 fiscal quarters", util["fiscal_quarter"].nunique() == 3)

    # History
    chk("History: no blank employee_id", (hist["employee_id"] == "").sum() == 0)
    chk("History: worked hours reconcile to source",
        abs(hist["worked_hours"].sum() - hist_total) < 0.01)
    chk("History: SLG / Non-SLG / Contractor classes present",
        set(hist["worker_class"].unique()) == {"SLG", "Non-SLG", "Contractor"})

    return results


def build_manifest(staffed, unstaffed, retained_weeks, actuals, util, hist):
    def whrs(df):
        return round(float(df[retained_weeks].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy().sum()), 1)

    fdates = pd.to_datetime(retained_weeks, format="%m/%d/%Y")
    fmin, fmax = fdates.min().strftime("%Y-%m-%d"), fdates.max().strftime("%Y-%m-%d")

    return pd.DataFrame([
        {"sheet": OUT_FORECAST, "rows": len(staffed), "primary_measure": "forecast_hours",
         "primary_total": whrs(staffed),
         "distinct_workers": staffed["Employee ID"].map(normalize_employee_id).nunique(),
         "min_period": fmin, "max_period": fmax},
        {"sheet": OUT_UNSTAFFED, "rows": len(unstaffed), "primary_measure": "unstaffed_hours",
         "primary_total": whrs(unstaffed),
         "distinct_workers": unstaffed["Worker"].nunique(),
         "min_period": fmin, "max_period": fmax},
        {"sheet": OUT_ACTUALS, "rows": len(actuals), "primary_measure": "actual_icp_hours",
         "primary_total": round(float(actuals["actual_icp_hours"].sum()), 1),
         "distinct_workers": actuals["employee_id"].nunique(),
         "min_period": actuals["week_key"].min(), "max_period": actuals["week_key"].max()},
        {"sheet": OUT_UTIL, "rows": len(util), "primary_measure": "target_hours",
         "primary_total": round(float(util["target_hours"].sum()), 1),
         "distinct_workers": util["employee_id"].nunique(),
         "min_period": util["fiscal_quarter"].min(), "max_period": util["fiscal_quarter"].max()},
        {"sheet": OUT_HISTORY, "rows": len(hist), "primary_measure": "worked_hours",
         "primary_total": round(float(hist["worked_hours"].sum()), 1),
         "distinct_workers": hist["employee_id"].nunique(),
         "min_period": hist["fiscal_quarter"].min(), "max_period": hist["fiscal_quarter"].max()},
    ])


def diff_vs_prior(manifest, path):
    if not os.path.exists(path):
        return ["(no prior manifest found; first run)"]
    prior = pd.read_json(path)
    lines = []
    for _, cur in manifest.iterrows():
        p = prior[prior["sheet"] == cur["sheet"]]
        if p.empty:
            lines.append(f"{cur['sheet']}: NEW"); continue
        p = p.iloc[0]
        pt = p.get("primary_total", p.get("total_hours"))
        ct = cur.get("primary_total")
        rd = int(cur["rows"] - p["rows"])
        if pt is None or ct is None:
            lines.append(f"{cur['sheet']}: rows {p['rows']}->{cur['rows']} ({rd:+d})"); continue
        lines.append(f"{cur['sheet']}: rows {p['rows']}->{cur['rows']} ({rd:+d}); "
                     f"{cur.get('primary_measure')} {pt}->{ct} ({float(ct)-float(pt):+.1f})")
    return lines


# ============================================================
# Main
# ============================================================

def main():
    if len(sys.argv) < 2:
        print("Usage: python wow_transform.py <input.xlsx> [output.xlsx]")
        return 2
    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "WoW_Consolidated_Normalized.xlsx"
    prior_manifest = "wow_last_manifest.json"

    if not os.path.exists(in_path):
        print(f"ERROR: input not found: {in_path}")
        return 2

    log = []
    try:
        print(f"Reading source workbook: {in_path}")
        xl = pd.ExcelFile(in_path)
        validate_input_workbook(xl)

        staffed, unstaffed, retained_weeks = build_forecast_split(xl, log)
        actuals = build_current_actuals(xl, log)
        util = build_utilization(xl, log)
        hist, hist_total = build_history(xl, log)

        if log:
            print("\n---- transform notes ----")
            for line in log:
                print("  " + line)

        results = validate(staffed, unstaffed, retained_weeks, actuals, util, hist, hist_total)
        print("\n================ VALIDATION ================")
        all_pass = True
        for ok, label in results:
            print(f"[{'PASS' if ok else 'FAIL'}] {label}")
            all_pass = all_pass and ok

        manifest = build_manifest(staffed, unstaffed, retained_weeks, actuals, util, hist)
        print("\n================ MANIFEST ================")
        print(manifest.to_string(index=False))

        print("\n================ DAILY DIFF ================")
        for line in diff_vs_prior(manifest, prior_manifest):
            print(line)

        if not all_pass:
            print("\nABORTED: validation failed. Output not written.")
            return 1

        with pd.ExcelWriter(out_path, engine="openpyxl") as w:
            staffed.to_excel(w, sheet_name=OUT_FORECAST, index=False)
            unstaffed.to_excel(w, sheet_name=OUT_UNSTAFFED, index=False)
            actuals.to_excel(w, sheet_name=OUT_ACTUALS, index=False)
            util.to_excel(w, sheet_name=OUT_UTIL, index=False)
            hist.to_excel(w, sheet_name=OUT_HISTORY, index=False)
            manifest.to_excel(w, sheet_name=OUT_MANIFEST, index=False)

        manifest.to_json(prior_manifest, orient="records")
        print(f"\nSUCCESS: wrote consolidated workbook: {out_path}")
        return 0

    except Exception as exc:
        print(f"\nERROR: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())