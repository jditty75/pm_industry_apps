#!/usr/bin/env python3
r"""
transform_v4.py — WoW FOUR-FILE new-source consolidated transform.

Inputs (a directory containing four files):
  Forecast.csv               long/tidy: Worker ID, Worker, Supervisory Organization, Customer Name,
                             Project, Project Role Category, Specialty - Text, Forecasted Hours,
                             Week End Transaction Date, Job Profile, Worker Region, Project Region,
                             Worker's Manager
  Actuals_Prev_Current.csv   long/tidy: same columns but 'ICP Hours' instead of 'Forecasted Hours'
  Actuals_Historical.xlsx    quarter grain: Worker ID, Worker, Region as of Date Worked, Supervisory
                             Organization as of Date Worked, Specialty Practice, Sub-Specialty Practice,
                             Project, Project Role Category, Worked Hours, Non-Billable Hours,
                             ICP Hours, Fiscal Qtr
  SLG Utilization Export_Quarter*.csv  grouped 7-col-per-quarter band (3 real quarters)

Output: WoW_Consolidated_Normalized.xlsx (same 7-sheet contract the app ingests; NO app change)

Worker class: SLG when Worker Region == 'Government' (worker-centric — an SLG worker's
non-SLG-project hours stay attributed to them); [C] in name -> Contractor; else Non-SLG.

Run-date seam (mutually exclusive per worker-week; computed at runtime):
  actuals own COMPLETED weeks (week_key <= last completed Saturday)
  forecast owns the IN-PROGRESS week forward (week_key >= in-progress Saturday)
  the current quarter (shared by both files) is bisected at that seam.

Actuals_Current_Normalized = ACTUALS ONLY (prev quarter + current-quarter-to-date, <= seam).
Forward forecast lives in Forecast_Staged; the app blends the two (no double-count here).

Usage: python transform_v4.py <input_dir> [output.xlsx] [run_date_YYYY-MM-DD]
Exit: 0 = success; 1 = validation/transform failure; 2 = usage/input error.
"""
import datetime as dt, glob, os, re, sys
import pandas as pd

OUT_FORECAST="Forecast_Staged"; OUT_UNSTAFFED="Unstaffed_Demand"; OUT_ACTUALS="Actuals_Current_Normalized"
OUT_UTIL="Utilization_Normalized"; OUT_HISTORY="History_Normalized"; OUT_XORG="Xorg_Forecast_Aggregate"; OUT_MANIFEST="_manifest"

UTIL_COLS=['employee_id','resource_name','fiscal_quarter','target_hours','util_rate_wkly','qtd_actual_icp','qtd_icp_plus_forecast','source_sheet','productive_denominator_hours']
MEAS_FSQ='SUM(Future Scheduled Quarter Hours)'
MEAS_TWH='SUM(Total Weekly Hours for Future Scheduled Hours)'
ACTCUR_COLS=['employee_id','resource_name','week_start','week_key','project','project_role_category','actual_icp_hours','source_row']
HIST_COLS=['employee_id','resource_name','worker_class','workday_region_as_of_date_worked','fiscal_quarter','project','project_role_category','icp_hours','non_icp_hours','specialty_practice','sub_specialty_practice']
JUNK={"","(Blank)","Total","nan","None"}
FQM={1:"Q4",2:"Q1",3:"Q1",4:"Q1",5:"Q2",6:"Q2",7:"Q2",8:"Q3",9:"Q3",10:"Q3",11:"Q4",12:"Q4"}

# ============================================================
# Helpers
# ============================================================
def nid(v):
    if pd.isna(v): return ""
    s=str(v).strip()
    if s.lower() in ("","nan","none"): return ""
    return s[:-2] if re.fullmatch(r"\d+\.0",s) else s
def snum(v):
    try: return float(str(v).replace(",","").replace("%",""))
    except Exception: return 0.0
def clean(s):
    s=str(s).strip(); return "Unclassified" if s in ("","nan","None") else s
def is_junk(v): return str(v).strip() in JUNK
def fq_label(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return ""
    t=re.sub(r"\s+"," ",str(v).strip().upper())
    m=re.search(r"FY\s*(\d{2,4})\s*[-_/ ]*Q\s*([1-4])",t) or re.search(r"(\d{4})\s*[-_/ ]*Q\s*([1-4])",t)
    return f"FY{m.group(1)[-2:]}-Q{m.group(2)}" if m else ""
def fq_from_weekend(d):
    """Work-day rule: quarter of the week's Mon-Fri (Saturday week-ending - 1 = Friday)."""
    ts=pd.to_datetime(d)-pd.Timedelta(days=1); fy=ts.year+1 if ts.month>=2 else ts.year
    return f"FY{str(fy)[-2:]}-{FQM[ts.month]}"
def cur_quarter(run): return fq_from_weekend(pd.Timestamp(run).normalize()+pd.Timedelta(days=6))
def wclass(worker, region_worker):
    # Worker-centric: SLG worker keeps all their hours regardless of project region.
    if "[C]" in str(worker): return "Contractor"
    return "SLG" if str(region_worker).strip()=="Government" else "Non-SLG"
def compare_fq(a,b):
    def rk(fq):
        m=re.match(r"FY(\d{2})-Q([1-4])",str(fq)); return (int(m.group(1)),int(m.group(2))) if m else (99,9)
    ra,rb=rk(a),rk(b); return -1 if ra<rb else (1 if ra>rb else 0)

def _resolve_one(directory, patterns):
    for pat in patterns:
        hits=sorted(glob.glob(os.path.join(directory, pat)))
        if hits: return hits[-1]
    return None

def load_inputs(directory):
    f_fc  =_resolve_one(directory, ["Forecast*.csv"])
    f_ac  =_resolve_one(directory, ["Actuals_Prev_Current*.csv","Actuals_Prev*Current*.csv"])
    f_hist=_resolve_one(directory, ["Actuals_Historical*.xlsx","Actuals_Historical*.csv"])
    f_util=_resolve_one(directory, ["SLG Utilization Export_Quarter*.csv","*Utilization*Quarter*.csv"])
    missing=[n for n,f in [("Forecast",f_fc),("Actuals_Prev_Current",f_ac),("Actuals_Historical",f_hist),("Utilization",f_util)] if not f]
    if missing: raise ValueError("Missing input file(s): "+", ".join(missing))
    fc=pd.read_csv(f_fc, dtype=str)
    ac=pd.read_csv(f_ac, dtype=str)
    hist=pd.read_excel(f_hist) if f_hist.lower().endswith(".xlsx") else pd.read_csv(f_hist, dtype=str)
    util=pd.read_csv(f_util, header=None, dtype=str)
    return fc, ac, hist, util, (f_fc,f_ac,f_hist,f_util)

# ---- role-cat map from History: (worker,project)->top role by ICP + worker fallback ----
def role_maps(hist):
    h=hist.copy()
    h["_id"]=h["Worker ID"].map(nid); h["_icp"]=h["ICP Hours"].map(snum)
    rm={}; wr={}
    for (wid,proj),g in h.groupby(["_id","Project"]):
        v=g.groupby("Project Role Category")["_icp"].sum()
        rm[(wid,clean(proj))]=clean(v.idxmax()) if len(v) else "Unclassified"
    for wid,g in h.groupby("_id"):
        v=g.groupby("Project Role Category")["_icp"].sum()
        wr[wid]=clean(v.idxmax()) if len(v) else "Unclassified"
    return rm, wr

# ---- run-date seam ----
def compute_seam(run):
    run=pd.Timestamp(run).normalize()
    days_to_sat=(5-run.dayofweek)%7            # Sat=5
    inprog_sat=run+pd.Timedelta(days=days_to_sat)   # in-progress week ending (forecast start)
    last_completed=inprog_sat-pd.Timedelta(days=7)  # actuals cutoff
    return last_completed, inprog_sat

# ---- Actuals_Current_Normalized: ACTUALS ONLY, prev+current qtr, <= seam, role-cat enriched ----
def build_current_actuals(fc, ac, rm, wr, seam_cut, seam_start, cur_q, log):
    a=ac.copy()
    a["_id"]=a["Worker ID"].map(nid); a["_name"]=a["Worker"].astype(str).str.strip()
    a["_hrs"]=a["ICP Hours"].map(snum); a["_wed"]=pd.to_datetime(a["Week End Transaction Date"],errors="coerce")
    a["_wk"]=a["_wed"].dt.strftime("%Y-%m-%d"); a["_proj"]=a["Project"].map(clean)
    a["_fq"]=a["_wed"].apply(fq_from_weekend)
    # completed weeks only (<= seam cutoff) AND prev-or-current quarter (drop stray future placeholders)
    a=a[(a["_wk"]<=seam_cut.strftime("%Y-%m-%d")) & (a["_fq"].map(lambda q: compare_fq(q,cur_q)<=0))]
    both=a[["_id","_name","_wed","_wk","_proj","_hrs"]]
    both=both[(both["_id"]!="") & (both["_hrs"]!=0)]
    agg=both.groupby(["_id","_name","_wed","_wk","_proj"], dropna=False)["_hrs"].sum().reset_index()
    rows=[]
    for i,(_,r) in enumerate(agg.iterrows()):
        rc=rm.get((r["_id"],r["_proj"])) or wr.get(r["_id"]) or "Unclassified"
        rows.append([r["_id"], r["_name"], pd.Timestamp(r["_wed"]), r["_wk"], r["_proj"], rc, round(r["_hrs"],2), i+2])
    out=pd.DataFrame(rows, columns=ACTCUR_COLS)
    if len(out) and not out["week_start"].apply(lambda x: pd.Timestamp(x).dayofweek==5).all():
        raise ValueError("Actuals_Current: non-Saturday week_start detected.")
    uncl=int((out["project_role_category"]=="Unclassified").sum())
    log.append(f"Actuals_Current: {len(out)} rows, {out['employee_id'].nunique()} workers, "
               f"{uncl} Unclassified role; seam actuals<={seam_cut.date()}")
    return out

# ---- Forecast: long->wide Forecast_Staged (SLG) + Xorg aggregate (Non-SLG/Contractor) ----
def build_forecast(fc, seam_start, log):
    f=fc.copy()
    f=f[~f["Worker"].map(is_junk)]
    # Terminated workers: source tags the name with "(Terminated)". Drop from forecast so they
    # never enter Forecast_Staged -> Allocations -> scorecard/Utilization tab. Their historical
    # actuals remain in Actuals_Normalized (prev-qtr aggregates) and History_Normalized (Mix & Trend).
    _termmask = f["Worker"].fillna("").str.contains("Terminated", case=False, regex=False)
    _nterm = int(_termmask.sum())
    f = f[~_termmask]
    f["_id"]=f["Worker ID"].map(nid); f["_hrs"]=f["Forecasted Hours"].map(snum)
    f["_wksat"]=pd.to_datetime(f["Week End Transaction Date"],errors="coerce")
    f["_wk"]=f["_wksat"].dt.strftime("%m/%d/%Y")
    # forecast owns in-progress week forward (drop the actualized overlap so staged has no closed weeks)
    f=f[f["_wksat"]>=seam_start]
    region_worker=f["Worker Region"].fillna("").astype(str)
    f["_wc"]=[wclass(w,r) for w,r in zip(f["Worker"], region_worker)]
    slg=f[f["_wc"]=="SLG"].copy(); xo=f[f["_wc"].isin(["Non-SLG","Contractor"])].copy()

    # SLG long->wide pivot (fast: groupby + unstack)
    ctx=["_id","Worker","Customer Name","Project","Project Role Category","Specialty - Text","Job Profile","Worker Region","Worker's Manager"]
    if len(slg):
        s=slg.groupby(ctx+["_wk"], dropna=False, sort=False)["_hrs"].sum()
        wide=s.unstack("_wk", fill_value=0.0).reset_index()
    else:
        wide=pd.DataFrame(columns=ctx)
    week_cols=[c for c in wide.columns if isinstance(c,str) and re.fullmatch(r"\d{2}/\d{2}/\d{4}",str(c))]
    week_cols=sorted(week_cols, key=lambda c: pd.to_datetime(c, format="%m/%d/%Y"))
    ren={"_id":"Employee ID","Worker":"Worker","Customer Name":"Account","Project":"Project",
         "Project Role Category":"Project Role Category","Specialty - Text":"Specialty Practice",
         "Job Profile":"Job Profile","Worker Region":"Region - Worker","Worker's Manager":"Worker's Manager"}
    wide=wide.rename(columns=ren)
    for absent in ["Project Role","Project Region","Customer Segment Practice","Engagement Manager",
                   "Resource Type","Customer Projects","Internal Projects (Excludes Education)","Education Projects"]:
        if absent not in wide.columns: wide[absent]=""
    staffed_ctx=["Employee ID","Worker","Project Role","Account","Region - Worker","Worker's Manager","Project",
                 "Project Region","Job Profile","Customer Segment Practice","Specialty Practice","Engagement Manager",
                 "Customer Projects","Internal Projects (Excludes Education)","Education Projects","Resource Type","Project Role Category"]
    staffed=wide[staffed_ctx+week_cols].copy() if len(wide) else pd.DataFrame(columns=staffed_ctx+week_cols)
    unstaffed=staffed.iloc[0:0].copy()   # long forecast is all staffed (has Worker ID); no unstaffed rows

    # Xorg aggregate: worker_group x region x quarter
    recs=[]
    for _,r in xo.iterrows():
        grp="Contractor" if r["_wc"]=="Contractor" else "Workday Regions"
        region="Contractor" if grp=="Contractor" else (str(r.get("Worker Region","") or "Unclassified").strip() or "Unclassified")
        hrs=float(r["_hrs"] or 0)
        if hrs:
            recs.append((grp,region,fq_from_weekend(r["_wksat"]),hrs))
    xdf=pd.DataFrame(recs, columns=["worker_group","region","fiscal_quarter","forecast_hours"])
    if not xdf.empty:
        xdf=xdf.groupby(["worker_group","region","fiscal_quarter"],dropna=False)["forecast_hours"].sum().reset_index()
        xdf["forecast_hours"]=xdf["forecast_hours"].round(2)
    else:
        xdf=pd.DataFrame(columns=["worker_group","region","fiscal_quarter","forecast_hours"])
        log.append(f"Forecast: {len(staffed)} SLG staffed wide rows, {len(week_cols)} week cols; "
               f"xorg {len(xdf)} rows; dropped {_nterm} terminated forecast rows")
    return staffed, unstaffed, week_cols, xdf

# ---- History (quarter grain; closed quarters only) ----
def build_history(hist, cur_q, log):
    h=hist.copy()
    for c in ["ICP Hours","Non-Billable Hours"]: h[c]=h[c].map(snum)
    h["_id"]=h["Worker ID"].map(nid); h["_fq"]=h["Fiscal Qtr"].map(fq_label)
    h["_wc"]=[wclass(w,r) for w,r in zip(h["Worker"], h["Region as of Date Worked"])]
    h=h[~h["Worker"].map(is_junk)]
    h=h[h["_fq"].map(lambda q: compare_fq(q,cur_q)<0)]
    g=(h.groupby(["_id","Worker","_wc","Region as of Date Worked","_fq","Project","Project Role Category"],dropna=False)
        .agg(icp=("ICP Hours","sum"),nonicp=("Non-Billable Hours","sum"),
             sp=("Specialty Practice","first"),ssp=("Sub-Specialty Practice","first")).reset_index())
    rows=[[r["_id"],r["Worker"],r["_wc"],clean(r["Region as of Date Worked"]),r["_fq"],clean(r["Project"]),
           clean(r["Project Role Category"]),round(r["icp"],2),round(r["nonicp"],2),clean(r["sp"]),clean(r["ssp"])]
          for _,r in g.iterrows()]
    out=pd.DataFrame(rows,columns=HIST_COLS); out=out[out["employee_id"]!=""]
    if cur_q in set(out["fiscal_quarter"]): raise ValueError(f"History: current quarter {cur_q} must be excluded.")
    log.append(f"History: {len(out)} rows, quarters {sorted(out['fiscal_quarter'].unique())}")
    return out

# ---- Utilization (grouped 7-col-per-quarter bands) ----
def build_util(util_raw, ac, cur_q, log):
    raw=util_raw
    band=raw.iloc[1]; meas=raw.iloc[2]
    starts=sorted((ci, f"FY{str(v).strip()[2:4]}-{str(v).strip()[5:]}")
                  for ci,v in enumerate(band) if re.match(r"\d{4}-Q[1-4]", str(v).strip()))
    if not starts: raise ValueError("Utilization: no quarter bands in row 1.")
    spans={}
    for idx,(ci,q) in enumerate(starts):
        end=starts[idx+1][0] if idx+1<len(starts) else raw.shape[1]; spans[q]=(ci,end)
    def col(name,lo,hi):
        for c in range(lo,hi):
            if str(meas[c]).strip()==name: return c
        return None
    # previous-quarter actual ICP (un-doubled) from the actuals file, work-day quarter rule
    a=ac.copy(); a["_id"]=a["Worker ID"].map(nid); a["_icp"]=a["ICP Hours"].map(snum)
    a["_fq"]=a["Week End Transaction Date"].apply(fq_from_weekend)
    prevq={f"{k[0]}|{k[1]}": float(v) for k,v in a.groupby(["_id","_fq"])["_icp"].sum().items()}
    rows=[]
    neg_den=[]
    for _,r in raw.iloc[3:].iterrows():
        wid=nid(r[0]); name=str(r[1]).strip()
        if not wid or is_junk(name): continue
        has_t=any((col("MAX(Target Hours by Quarter Calculation)",lo,hi) is not None
                   and snum(r[col("MAX(Target Hours by Quarter Calculation)",lo,hi)])>0) for lo,hi in spans.values())
        if not has_t: continue
        for q,(lo,hi) in spans.items():
            tc=col("MAX(Target Hours by Quarter Calculation)",lo,hi); rc=col("MAX(Utilization Target Percentage)",lo,hi)
            tgt=snum(r[tc]) if tc is not None else 0.0; rate=snum(r[rc]) if rc is not None else 0.0
            if tgt<=0: continue
            if compare_fq(q,cur_q)<0:
                actual=float(prevq.get(f"{wid}|{q}",0.0)); blend=actual
            else:
                ic=col("SUM(ICP Hours)",lo,hi); fcc=col("SUM(Future Forecast)",lo,hi)
                icp=snum(r[ic]) if ic is not None else 0.0; fut=snum(r[fcc]) if fcc is not None else 0.0
                actual=icp; blend=icp+fut
            fsq_c=col(MEAS_FSQ,lo,hi); twh_c=col(MEAS_TWH,lo,hi)
            prod_den=""
            if fsq_c is not None and twh_c is not None:
                diff=snum(r[fsq_c])-snum(r[twh_c])
                if diff>0:
                    prod_den=round(diff,2)
                else:
                    neg_den.append(f"{wid}|{q}|{name} fsq={snum(r[fsq_c])} twh={snum(r[twh_c])} diff={diff}")
            rows.append([wid,name,q,round(tgt,2),rate,round(actual,2),round(blend,2),"SLG_Utilization_Quarter",prod_den])
    out=pd.DataFrame(rows,columns=UTIL_COLS)
    if neg_den:
        log.append(f"Utilization: {len(neg_den)} worker×quarter productive_denominator_hours <= 0 (blanked)")
        for line in neg_den[:20]:
            log.append(f"  {line}")
        if len(neg_den)>20:
            log.append(f"  ... and {len(neg_den)-20} more")
    log.append(f"Utilization: {out['employee_id'].nunique()} workers, quarters {sorted(out['fiscal_quarter'].unique())}")
    return out

def build_manifest(staffed, unstaffed, week_cols, actuals, util, hist):
    def whrs(df):
        return round(float(df[week_cols].apply(pd.to_numeric,errors="coerce").fillna(0).to_numpy().sum()),1) if len(df) and week_cols else 0.0
    fdates=pd.to_datetime(week_cols, format="%m/%d/%Y"); fmin,fmax=fdates.min().strftime("%Y-%m-%d"),fdates.max().strftime("%Y-%m-%d")
    return pd.DataFrame([
      {"sheet":OUT_FORECAST,"rows":len(staffed),"primary_measure":"forecast_hours","primary_total":whrs(staffed),"distinct_workers":staffed["Employee ID"].map(nid).nunique() if len(staffed) else 0,"min_period":fmin,"max_period":fmax},
      {"sheet":OUT_UNSTAFFED,"rows":len(unstaffed),"primary_measure":"unstaffed_hours","primary_total":whrs(unstaffed),"distinct_workers":0,"min_period":fmin,"max_period":fmax},
      {"sheet":OUT_ACTUALS,"rows":len(actuals),"primary_measure":"actual_icp_hours","primary_total":round(float(actuals["actual_icp_hours"].sum()),1),"distinct_workers":actuals["employee_id"].nunique(),"min_period":actuals["week_key"].min() if len(actuals) else "","max_period":actuals["week_key"].max() if len(actuals) else ""},
      {"sheet":OUT_UTIL,"rows":len(util),"primary_measure":"target_hours","primary_total":round(float(util["target_hours"].sum()),1),"distinct_workers":util["employee_id"].nunique(),"min_period":util["fiscal_quarter"].min(),"max_period":util["fiscal_quarter"].max()},
      {"sheet":OUT_HISTORY,"rows":len(hist),"primary_measure":"icp_hours","primary_total":round(float(hist["icp_hours"].sum()),2),"distinct_workers":hist["employee_id"].nunique(),"min_period":hist["fiscal_quarter"].min(),"max_period":hist["fiscal_quarter"].max()},
    ])

def validate(staffed, week_cols, actuals, util, hist, cur_q):
    res=[]
    def chk(l,c): res.append((bool(c),l))
    fdates=pd.to_datetime(week_cols, format="%m/%d/%Y")
    chk("Forecast_Staged: weekly headers present", len(week_cols)>0)
    chk("Forecast_Staged: all week headers Saturdays", (fdates.dayofweek==5).all())
    chk("Forecast_Staged: no blank Employee ID", (staffed["Employee ID"].map(nid)=="").sum()==0 if len(staffed) else True)
    if len(actuals):
        chk("Actuals_Current: header order==ACTCUR_COLS", list(actuals.columns)==ACTCUR_COLS)
        chk("Actuals_Current: all week_start Saturdays", (actuals["week_start"].dt.dayofweek==5).all())
        chk("Actuals_Current: week_key==week_start", (actuals["week_key"]==actuals["week_start"].dt.strftime("%Y-%m-%d")).all())
        chk("Actuals_Current: no blank employee_id", (actuals["employee_id"]=="").sum()==0)
        chk("Actuals_Current: no blank project", (actuals["project"].astype(str).str.strip()=="").sum()==0)
        chk("Actuals_Current: prev+current quarter only",
            set(actuals["week_key"].map(fq_from_weekend).unique()).issubset(
                {q for q in set(actuals["week_key"].map(fq_from_weekend)) if compare_fq(q,cur_q)<=0}))
    chk("Utilization: no null target_hours", util["target_hours"].isna().sum()==0)
    chk("Utilization: 3 fiscal quarters", util["fiscal_quarter"].nunique()==3)
    chk("History: >=1 quarter", hist["fiscal_quarter"].nunique()>=1)
    chk("History: current quarter excluded", cur_q not in set(hist["fiscal_quarter"]))
    chk("History: worker classes valid", set(hist["worker_class"].unique()).issubset({"SLG","Non-SLG","Contractor"}))
    return res

def main():
    if len(sys.argv) < 2:
        print("Usage: python transform_v4.py <input_dir> [output.xlsx] [run_date_YYYY-MM-DD]"); return 2
    directory = sys.argv[1]
    out_path  = sys.argv[2] if len(sys.argv)>2 else "WoW_Consolidated_Normalized.xlsx"
    run = pd.Timestamp(sys.argv[3]) if len(sys.argv)>3 else pd.Timestamp.today()
    if not os.path.isdir(directory):
        print(f"ERROR: input dir not found: {directory}"); return 2
    log=[]
    try:
        fc, ac, hist, util, paths = load_inputs(directory)
        log.append("Inputs: "+", ".join(os.path.basename(p) for p in paths))
        cur_q=cur_quarter(run); seam_cut, seam_start = compute_seam(run)
        log.append(f"Run={pd.Timestamp(run).date()} cur_q={cur_q} seam: actuals<={seam_cut.date()} forecast>={seam_start.date()}")
        rm, wr = role_maps(hist)
        actuals = build_current_actuals(fc, ac, rm, wr, seam_cut, seam_start, cur_q, log)
        staffed, unstaffed, week_cols, xorg = build_forecast(fc, seam_start, log)
        history = build_history(hist, cur_q, log)
        utiln = build_util(util, ac, cur_q, log)
        print("\n---- notes ----"); [print("  "+l) for l in log]
        results=validate(staffed, week_cols, actuals, utiln, history, cur_q)
        print("\n---- VALIDATION ----"); allpass=True
        for ok,l in results: print(f"[{'PASS' if ok else 'FAIL'}] {l}"); allpass=allpass and ok
        man=build_manifest(staffed, unstaffed, week_cols, actuals, utiln, history)
        print("\n---- MANIFEST ----"); print(man.to_string(index=False))
        if not allpass: print("\nABORTED: validation failed. Output not written."); return 1
        with pd.ExcelWriter(out_path, engine="openpyxl") as w:
            staffed.to_excel(w, sheet_name=OUT_FORECAST, index=False)
            unstaffed.to_excel(w, sheet_name=OUT_UNSTAFFED, index=False)
            actuals.to_excel(w, sheet_name=OUT_ACTUALS, index=False)
            utiln.to_excel(w, sheet_name=OUT_UTIL, index=False)
            history.to_excel(w, sheet_name=OUT_HISTORY, index=False)
            xorg.to_excel(w, sheet_name=OUT_XORG, index=False)
            man.to_excel(w, sheet_name=OUT_MANIFEST, index=False)
        print(f"\nSUCCESS: wrote {out_path}"); return 0
    except Exception as e:
        import traceback; print("\nERROR:", e); traceback.print_exc(); return 1

if __name__=="__main__":
    sys.exit(main())