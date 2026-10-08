#!/usr/bin/env python3
"""Read-only Healthcare workbook VoC reconciliation (aggregate counts only).

Usage:
  python healthcare-voc-reconcile.py [path-to-xlsx]

Default path: docs/migrations/Healthcare DeploymentHealth_v1.xlsx (repo root).
"""

from __future__ import annotations

import hashlib
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl

REPO = Path(__file__).resolve().parents[4]
DEFAULT_XLSX = REPO / "docs" / "migrations" / "Healthcare DeploymentHealth_v1.xlsx"
WD_PS = "workday professional services"
LOOKBACK_DAYS = 180

# FY27 MDS one-third windows (batch month -> window), verbatim from CoreSurveySchedule.
FY27_MDS_WINDOWS = {
    "2026-02": ("2026-01-01", "2026-01-31"),
    "2026-03": ("2026-02-01", "2026-02-28"),
    "2026-04": ("2026-03-01", "2026-03-31"),
    "2026-05": ("2026-04-01", "2026-04-30"),
    "2026-06": ("2026-05-01", "2026-05-31"),
    "2026-07": ("2026-05-31", "2026-06-30"),
    "2026-08": ("2026-07-01", "2026-07-30"),
    "2026-09": ("2026-07-31", "2026-08-30"),
    "2026-10": ("2026-08-31", "2026-09-30"),
    "2026-11": ("2026-10-01", "2026-10-30"),
    "2026-12": ("2026-10-31", "2026-11-30"),
    "2027-01": ("2026-12-01", "2026-12-30"),
}


def _shift_ym(ym: str, delta: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    m += delta
    while m < 1:
        m += 12
        y -= 1
    while m > 12:
        m -= 12
        y += 1
    return f"{y:04d}-{m:02d}"


def _resolve_mds_batch_old(target: str, horizon_first: str = "2026-10") -> str | None:
    """Pre-fix: forward scan only from UI horizon first month."""
    y, m = int(horizon_first[:4]), int(horizon_first[5:7])
    for _ in range(36):
        ym = f"{y:04d}-{m:02d}"
        win = FY27_MDS_WINDOWS.get(ym)
        if win and win[0] <= target <= win[1]:
            return ym
        m += 1
        if m > 12:
            m = 1
            y += 1
    return None


def _resolve_mds_batch_new(target: str, horizon_first: str = "2026-10") -> str | None:
    """Post-fix: anchor on target month, scan backward then forward."""
    anchor = _shift_ym(target[:7], -2)
    for i in range(-24, 36):
        ym = _shift_ym(anchor, i)
        win = FY27_MDS_WINDOWS.get(ym)
        if win and win[0] <= target <= win[1]:
            return ym
    return None


def _canon_id(raw: str) -> str:
    s = (raw or "").strip()
    return s[:15] if len(s) >= 15 else s


def _date_key(val) -> str | None:
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()
    s = str(val).strip()[:10]
    return s if len(s) == 10 and s[4] == "-" else None


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return date(y, m, day)


def _mds_one_third(start: str, target: str) -> str | None:
    try:
        s = date.fromisoformat(start)
        t = date.fromisoformat(target)
    except ValueError:
        return None
    if t <= s:
        return None
    delta = (t - s).days
    mid = s + timedelta(days=delta // 3)
    return mid.isoformat()


def _pgl_target(actual: str) -> str | None:
    try:
        a = date.fromisoformat(actual)
    except ValueError:
        return None
    return _add_months(a, 2).isoformat()


def _survey_event_id(dep: str, kind: str, cohort: str) -> str:
    payload = f"csat-survey-event|v1|{_canon_id(dep)}|{kind}|{cohort}"
    return "SE_" + hashlib.sha256(payload.encode()).hexdigest()[:40]


def _normalize_survey_type(raw: str) -> str:
    s = (raw or "").strip().upper()
    if "MID-DEPLOYMENT" in s or "MID DEPLOYMENT" in s or s in ("MGM", "MDS"):
        return "MDS"
    if "POST GO-LIVE" in s or "POST GO LIVE" in s or s == "PGL":
        return "PGL"
    return s


def load_sheet(wb, name: str) -> list[dict]:
    ws = wb[name]
    rows = ws.iter_rows(values_only=True)
    headers = [str(h or "").strip() for h in next(rows)]
    out = []
    for cells in rows:
        if not any(cells):
            continue
        padded = list(cells) + [None] * max(0, len(headers) - len(cells))
        out.append({headers[i]: padded[i] for i in range(len(headers)) if headers[i]})
    return out


def main() -> int:
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    if not xlsx.is_file():
        print(f"MISSING workbook: {xlsx}")
        return 1

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    deps = load_sheet(wb, "SFDC_Deployments")
    pf_rows = load_sheet(wb, "SFDC_DeploymentProductFunctions")
    inflight = load_sheet(wb, "CSAT_InFlight")
    has_responses = "CSAT_Responses" in wb.sheetnames
    wb.close()

    active = [d for d in deps if str(d.get("Overall_Status__c") or "").strip() == "Active"]
    partner_counts = Counter()
    for d in active:
        p = str(d.get("Deployment_Partner_Name__c") or "").strip()
        if not p:
            partner_counts["missing_partner"] += 1
        elif p.lower() == WD_PS:
            partner_counts["workday_ps"] += 1
        else:
            partner_counts["non_workday_partner"] += 1

    pf_by_dep: dict[str, list[dict]] = {}
    for pf in pf_rows:
        dep = _canon_id(str(pf.get("Deployment__c") or ""))
        if not dep:
            continue
        pf_by_dep.setdefault(dep, []).append(pf)

    mds_cohorts = 0
    pgl_cohorts = 0
    mds_events = 0
    pgl_events = 0
    mds_multi = 0
    pgl_multi = 0
    awareness = Counter()
    today = date.today()
    lookback_start = today - timedelta(days=LOOKBACK_DAYS)

    mds_upcoming = mds_overdue = 0
    pgl_upcoming = pgl_overdue = 0
    pgl_planned_complexity = 0
    oct_mds_old = oct_mds_new = 0
    mds_unassigned_old = mds_unassigned_new = 0
    horizon_mds_old = horizon_mds_new = 0
    horizon = {"2026-10", "2026-11", "2026-12"}

    for d in active:
        dep_id = _canon_id(str(d.get("Id") or ""))
        if not dep_id:
            continue
        start = _date_key(d.get("Deployment_Start_Date__c"))
        pr = pf_by_dep.get(dep_id, [])
        targets = sorted({_date_key(p.get("Production_Move_Date_Target__c")) for p in pr} - {None})
        actuals = sorted({_date_key(p.get("Production_Move_Date_Actual__c")) for p in pr} - {None})
        if len(targets) > 1:
            mds_multi += 1
        if len(actuals) > 1:
            pgl_multi += 1
        if len(targets) > 1:
            pgl_planned_complexity += 1
        if not start and targets:
            awareness["MISSING_DEPLOYMENT_START"] += 1
        if not targets and not pr:
            awareness["NO_PF_COHORT"] += 1
        partner_wd = str(d.get("Deployment_Partner_Name__c") or "").strip().lower() == WD_PS
        for t in targets:
            mds_cohorts += 1
            one_third = _mds_one_third(start or "", t) if start else None
            if not one_third:
                awareness["PF_TARGET_NOT_AFTER_START" if start else "MISSING_DEPLOYMENT_START"] += 1
                continue
            mds_events += 1
            _survey_event_id(dep_id, "MDS", t)
            td = date.fromisoformat(one_third)
            if td >= today:
                mds_upcoming += 1
            elif td >= lookback_start:
                mds_overdue += 1
            if partner_wd:
                batch_old = _resolve_mds_batch_old(one_third)
                batch_new = _resolve_mds_batch_new(one_third)
                if batch_old == "2026-10":
                    oct_mds_old += 1
                if batch_new == "2026-10":
                    oct_mds_new += 1
                if batch_old in horizon:
                    horizon_mds_old += 1
                if batch_new in horizon:
                    horizon_mds_new += 1
                if batch_old is None:
                    mds_unassigned_old += 1
                if batch_new is None:
                    mds_unassigned_new += 1
        for a in actuals:
            pgl_cohorts += 1
            tgt = _pgl_target(a)
            if not tgt:
                continue
            pgl_events += 1
            td = date.fromisoformat(tgt)
            if td >= today:
                pgl_upcoming += 1
            elif td >= lookback_start:
                pgl_overdue += 1

    inflight_norm = Counter()
    cohort_link = Counter()
    for row in inflight:
        st = _normalize_survey_type(str(row.get("survey_type") or ""))
        if st == "MDS":
            inflight_norm["MDS"] += 1
        elif st == "PGL":
            inflight_norm["PGL"] += 1
        else:
            inflight_norm["OTHER"] += 1
        dep = _canon_id(str(row.get("deployment_id") or ""))
        if not dep or st not in ("MDS", "PGL"):
            cohort_link["unknown"] += 1
            continue
        cands = []
        pr = pf_by_dep.get(dep, [])
        if st == "MDS":
            for t in sorted({_date_key(p.get("Production_Move_Date_Target__c")) for p in pr} - {None}):
                cands.append(t)
        else:
            for a in sorted({_date_key(p.get("Production_Move_Date_Actual__c")) for p in pr} - {None}):
                cands.append(a)
        if len(cands) == 1:
            cohort_link["inferred"] += 1
        elif len(cands) > 1:
            cohort_link["ambiguous"] += 1
        else:
            cohort_link["unknown"] += 1

    wd_visible = sum(1 for d in active if str(d.get("Deployment_Partner_Name__c") or "").strip().lower() == WD_PS)
    include_partners = len(active)

    print("=== Healthcare VoC reconciliation (aggregates only) ===")
    print(f"workbook: {xlsx.name}")
    print("Population:")
    print(f"  active_deployments: {len(active)}")
    print(f"  workday_ps_active: {partner_counts['workday_ps']}")
    print(f"  non_workday_partner_active: {partner_counts['non_workday_partner']}")
    print(f"  missing_partner: {partner_counts['missing_partner']}")
    print("MDS:")
    print(f"  distinct_target_cohorts: {mds_cohorts}")
    print(f"  valid_mds_survey_events: {mds_events}")
    print(f"  multi_cohort_deployments: {mds_multi}")
    print(f"  upcoming_target_dates: {mds_upcoming}")
    print(f"  overdue_band_events: {mds_overdue}")
    print("PGL:")
    print(f"  distinct_actual_cohorts: {pgl_cohorts}")
    print(f"  valid_pgl_survey_events: {pgl_events}")
    print(f"  multi_cohort_deployments: {pgl_multi}")
    print(f"  upcoming_target_dates: {pgl_upcoming}")
    print(f"  overdue_band_events: {pgl_overdue}")
    print(f"  planned_pgl_complexity_deployments: {pgl_planned_complexity}")
    print("In-Flight:")
    print(f"  rows: {len(inflight)}")
    print(f"  normalized_mds: {inflight_norm['MDS']}")
    print(f"  normalized_pgl: {inflight_norm['PGL']}")
    print(f"  other_survey_type: {inflight_norm['OTHER']}")
    print(f"  cohort_inferred: {cohort_link['inferred']}")
    print(f"  cohort_ambiguous: {cohort_link['ambiguous']}")
    print(f"  cohort_unknown: {cohort_link['unknown']}")
    print("Survey awareness (deployment-level heuristic counts):")
    for code, n in sorted(awareness.items()):
        print(f"  {code}: {n}")
    print("Partner scope:")
    print(f"  default_workday_ps_view: {wd_visible}")
    print(f"  include_partners_view: {include_partners}")
    print("Responses:")
    print(f"  CSAT_Responses_sheet_present: {has_responses}")
    print("October 2026 MDS batch (WD PS Active, FY27 windows in script):")
    print(f"  assigned_oct_2026_old_scan: {oct_mds_old}")
    print(f"  assigned_oct_2026_new_scan: {oct_mds_new}")
    print(f"  unassigned_mds_old_scan: {mds_unassigned_old}")
    print(f"  unassigned_mds_new_scan: {mds_unassigned_new}")
    print(f"  horizon_oct_nov_dec_old_scan: {horizon_mds_old}")
    print(f"  horizon_oct_nov_dec_new_scan: {horizon_mds_new}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
