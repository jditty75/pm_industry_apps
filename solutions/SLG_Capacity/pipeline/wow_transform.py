#!/usr/bin/env python3
r"""
WoW Consolidated Workbook Transform
===================================

Input:
    One manually downloaded WoW workbook containing:
      - Forecast
      - Actuals_Historical
      - UTIL_Previous
      - UTIL_Current
      - UTIL_Next
      - UTIL_Next+1

Output:
    One consolidated, app-ready workbook containing:
      - Forecast_Staged
      - Actuals_Current_Normalized
      - Utilization_Normalized
      - History_Normalized
      - _manifest

Hybrid ingest contract:
    Forecast_Staged is WIDE and PSA-compatible. Apps Script retains
    normalizeStaff() for canonical worker classification, ICP role
    derivation, overrides, allocation typing, and exclusions.

    Actuals_Current_Normalized, Utilization_Normalized, and
    History_Normalized are already normalized for thin app-side landing.

Usage:
    python wow_transform.py <input.xlsx> [output.xlsx]

Exit codes:
    0 = transform and all validations passed
    1 = validation or transform failure; no output workbook written
    2 = usage or missing-input error
"""

import datetime as dt
import json
import os
import re
import sys

import pandas as pd


# ============================================================
# Locked source / output contract
# ============================================================

REQUIRED_INPUT_SHEETS = [
    "Forecast",
    "Actuals_Historical",
    "UTIL_Previous",
    "UTIL_Current",
    "UTIL_Next",
    "UTIL_Next+1",
]

OUTPUT_FORECAST_SHEET = "Forecast_Staged"
OUTPUT_ACTUALS_SHEET = "Actuals_Current_Normalized"
OUTPUT_UTILIZATION_SHEET = "Utilization_Normalized"
OUTPUT_HISTORY_SHEET = "History_Normalized"
OUTPUT_MANIFEST_SHEET = "_manifest"

JUNK_WORKERS = {
    "",
    "(Blank)",
    "Total",
    "nan",
    "None",
}


# ============================================================
# Canonical fiscal rules
#
# Must stay aligned with Apps Script fiscalQuarterKey_:
# Fiscal year starts February.
# Q1 = Feb-Apr
# Q2 = May-Jul
# Q3 = Aug-Oct
# Q4 = Nov-Jan
# ============================================================

FISCAL_QUARTER_BY_MONTH = {
    1: "Q4",
    2: "Q1",
    3: "Q1",
    4: "Q1",
    5: "Q2",
    6: "Q2",
    7: "Q2",
    8: "Q3",
    9: "Q3",
    10: "Q3",
    11: "Q4",
    12: "Q4",
}

FISCAL_QUARTER_BY_START_MONTH = {
    2: "Q1",
    5: "Q2",
    8: "Q3",
    11: "Q4",
}


# ============================================================
# Shared helpers
# ============================================================

def normalize_employee_id(value) -> str:
    """
    Preserve all identifiers as strings.

    Examples:
      10039.0 -> "10039"
      C10187  -> "C10187"

    Contractor IDs can contain a C prefix, so IDs must never be
    coerced to numeric values globally.
    """
    if pd.isna(value):
        return ""

    result = str(value).strip()

    if re.fullmatch(r"\d+\.0", result):
        return result[:-2]

    return result


def is_junk_worker(value) -> bool:
    return str(value).strip() in JUNK_WORKERS


def is_date_header(value) -> bool:
    return isinstance(value, (dt.date, dt.datetime, pd.Timestamp))


def fiscal_quarter_from_date(value) -> str:
    """
    Example:
      2026-08-01 -> FY27-Q3
      2027-01-31 -> FY27-Q4
    """
    value = pd.Timestamp(value)

    fiscal_year = value.year + 1 if value.month >= 2 else value.year
    fiscal_quarter = FISCAL_QUARTER_BY_MONTH[value.month]

    return f"FY{str(fiscal_year)[-2:]}-{fiscal_quarter}"


def fiscal_quarter_from_history_label(value) -> str:
    """
    Normalizes source labels such as:
      FY26 Q4
      FY26-Q4
    into:
      FY26-Q4
    """
    match = re.search(
        r"FY\s*(\d{2,4})\s*[- ]\s*Q([1-4])",
        str(value).strip(),
        re.IGNORECASE,
    )

    if not match:
        return ""

    fiscal_year = match.group(1)[-2:]
    fiscal_quarter = match.group(2)

    return f"FY{fiscal_year}-Q{fiscal_quarter}"


def fiscal_quarter_from_util_title(value):
    """
    Parses source title rows such as:
      ICP Hours Between 08/01/2026 & 10/31/2026

    Returns:
      FY27-Q3
    """
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(value))

    if not match:
        return None

    month = int(match.group(1))
    year = int(match.group(3))

    fiscal_quarter = FISCAL_QUARTER_BY_START_MONTH.get(month)

    if not fiscal_quarter:
        return None

    return f"FY{str(year + 1)[-2:]}-{fiscal_quarter}"


def find_exact_column(df, expected_name):
    """Case-insensitive exact header lookup."""
    for column in df.columns:
        if str(column).strip().lower() == expected_name.lower():
            return column

    return None


def safe_numeric(series):
    """Numeric conversion for a pandas Series; blanks/errors become zero."""
    return pd.to_numeric(series, errors="coerce").fillna(0)


def classify_history_worker(worker_name, region) -> str:
    """
    Locked historical classification rule, applied per source row / quarter:

      [C] in worker name                 -> Contractor
      Otherwise Region=Government        -> SLG
      Otherwise                          -> Non-SLG

    Worker movement between regions is intentionally preserved by quarter.
    """
    if "[C]" in str(worker_name):
        return "Contractor"

    if str(region).strip() == "Government":
        return "SLG"

    return "Non-SLG"


def validate_input_workbook(xl):
    missing = [
        sheet_name
        for sheet_name in REQUIRED_INPUT_SHEETS
        if sheet_name not in xl.sheet_names
    ]

    if missing:
        raise ValueError(
            "Input workbook is missing required sheet(s): "
            + ", ".join(missing)
        )


def forecast_week_columns(forecast):
    """Detect MM/DD/YYYY weekly header columns in the wide forecast frame."""
    return [
        column
        for column in forecast.columns
        if isinstance(column, str)
        and re.fullmatch(r"\d{2}/\d{2}/\d{4}", column)
    ]


# ============================================================
# Output 1: Forecast_Staged
#
# Important:
# This is deliberately WIDE PSA-compatible data, not long-form
# normalized allocation data. Apps Script normalizeStaff() consumes
# this output and owns the canonical classification logic.
# ============================================================

def build_forecast_staged(xl) -> pd.DataFrame:
    forecast = xl.parse("Forecast").copy()

    if "Worker" not in forecast.columns:
        raise ValueError('Forecast: missing required "Worker" column.')

    forecast = forecast[
        ~forecast["Worker"].map(is_junk_worker)
    ].copy()

    if "Employee ID" not in forecast.columns:
        raise ValueError('Forecast: missing required "Employee ID" column.')

    # Preserve IDs as strings when Excel writes the staging workbook.
    forecast["Employee ID"] = forecast["Employee ID"].map(
        normalize_employee_id
    )

    # Source has MM/DD/YYYY weekly columns.
    weekly_columns = forecast_week_columns(forecast)

    if not weekly_columns:
        raise ValueError(
            "Forecast: no MM/DD/YYYY weekly columns found."
        )

    # These are required by existing normalizeStaff() logic.
    # We retain all source non-week columns too, but explicitly validate
    # the context required by the canonical Apps Script normalizer.
    required_context_columns = [
        "Employee ID",
        "Worker",
        "Project Role",
        "Account",
        "Region - Worker",
        "Worker's Manager",
        "Project",
        "Project Region",
        "Job Profile",
        "Customer Segment Practice",
        "Specialty Practice",
        "Engagement Manager",
        "Customer Projects",
        "Internal Projects (Excludes Education)",
        "Education Projects",
        "Resource Type",
        "Project Role Category",
    ]

    missing_context = [
        column
        for column in required_context_columns
        if column not in forecast.columns
    ]

    if missing_context:
        raise ValueError(
            "Forecast: missing fields required by canonical "
            "Apps Script normalizeStaff(): "
            + ", ".join(missing_context)
        )

    # Trim ONLY leading all-zero week columns.
    #
    # Do not remove zero weeks within the forecast horizon. Those columns
    # preserve the actual time sequence and allow the app's detectWeekColumns_
    # to surface genuine date gaps if present.
    retained_week_columns = list(weekly_columns)

    while retained_week_columns:
        first_week = retained_week_columns[0]

        total = safe_numeric(forecast[first_week]).sum()

        if total == 0:
            retained_week_columns.pop(0)
        else:
            break

    if not retained_week_columns:
        raise ValueError(
            "Forecast: all weekly columns are zero after removing "
            "footer/blank worker rows."
        )

    # Preserve all original non-week source columns in their original order,
    # then append only retained weekly columns.
    non_week_columns = [
        column
        for column in forecast.columns
        if column not in weekly_columns
    ]

    output_columns = non_week_columns + retained_week_columns

    staged = forecast[output_columns].copy()

    # Ensure weekly values are numeric and blank-safe.
    for week_column in retained_week_columns:
        staged[week_column] = safe_numeric(staged[week_column])

    return staged


# ============================================================
# UTIL helpers
# ============================================================

def load_util_sheet(xl, sheet_name):
    """
    Supports both known source formats.

    UTIL_Previous / UTIL_Next / UTIL_Next+1:
      - title rows 1-2
      - header row 4 (zero-index 3)

    UTIL_Current:
      - header row 1 (zero-index 0)
      - current quarter derived from earliest weekly actual header.
    """
    raw = xl.parse(sheet_name, header=None)

    header_row = next(
        (
            row_index
            for row_index in range(min(6, len(raw)))
            if str(raw.iloc[row_index, 0]).strip() == "Employee ID"
        ),
        None,
    )

    if header_row is None:
        raise ValueError(
            f"{sheet_name}: could not locate Employee ID header row."
        )

    fiscal_quarter = None

    for row_index in range(header_row):
        fiscal_quarter = fiscal_quarter_from_util_title(
            raw.iloc[row_index, 0]
        )

        if fiscal_quarter:
            break

    # Read a version retaining original Date/Timestamp header objects.
    raw_data = xl.parse(sheet_name, header=header_row)

    if fiscal_quarter is None:
        weekly_dates = [
            pd.Timestamp(column)
            for column in raw_data.columns
            if is_date_header(column)
        ]

        if not weekly_dates:
            raise ValueError(
                f"{sheet_name}: unable to derive fiscal quarter. "
                "No title range or weekly date headers found."
            )

        fiscal_quarter = fiscal_quarter_from_date(min(weekly_dates))

    # Read final version and normalize headers to strings for stable lookup.
    df = raw_data.copy()
    df.columns = [str(column).strip() for column in df.columns]

    return df, fiscal_quarter


def target_hours_column(df):
    """
    Normal source:
      Bonus target billable hours at EoQ

    UTIL_Current exception:
      The target column is unlabeled but appears immediately after
      Utilization target wkly hours.
    """
    direct = find_exact_column(
        df,
        "Bonus target billable hours at EoQ",
    )

    if direct:
        return direct

    rate_column = find_exact_column(
        df,
        "Utilization target wkly hours",
    )

    if rate_column is None:
        return None

    rate_index = list(df.columns).index(rate_column)

    if rate_index + 1 >= len(df.columns):
        return None

    return df.columns[rate_index + 1]


# ============================================================
# Output 2: Utilization_Normalized
# ============================================================

def build_utilization_normalized(xl) -> pd.DataFrame:
    frames = []

    for sheet_name in [
        "UTIL_Previous",
        "UTIL_Current",
        "UTIL_Next",
        "UTIL_Next+1",
    ]:
        df, fiscal_quarter = load_util_sheet(xl, sheet_name)

        employee_column = find_exact_column(df, "Employee ID")
        worker_column = find_exact_column(df, "Worker")
        rate_column = find_exact_column(
            df,
            "Utilization target wkly hours",
        )
        target_column = target_hours_column(df)
        qtd_actual_column = find_exact_column(
            df,
            "QTD actual ICP hours",
        )
        qtd_forecast_column = find_exact_column(
            df,
            "QTD ICP Hours + Forecast Hours",
        )

        required_fields = {
            "Employee ID": employee_column,
            "Worker": worker_column,
            "Utilization target wkly hours": rate_column,
            "Target hours": target_column,
        }

        missing = [
            label
            for label, column in required_fields.items()
            if column is None
        ]

        if missing:
            raise ValueError(
                f"{sheet_name}: missing required UTIL field(s): "
                + ", ".join(missing)
            )

        output = pd.DataFrame({
            "employee_id": df[employee_column].map(normalize_employee_id),
            "resource_name": df[worker_column].astype(str),
            "fiscal_quarter": fiscal_quarter,
            "target_hours": safe_numeric(df[target_column]),
            "util_rate_wkly": safe_numeric(df[rate_column]),
            "qtd_actual_icp": (
                safe_numeric(df[qtd_actual_column])
                if qtd_actual_column is not None
                else pd.NA
            ),
            "qtd_icp_plus_forecast": (
                safe_numeric(df[qtd_forecast_column])
                if qtd_forecast_column is not None
                else pd.NA
            ),
            "source_sheet": sheet_name,
        })

        output = output[
            (output["employee_id"] != "")
            & (~output["resource_name"].map(is_junk_worker))
        ].copy()

        frames.append(output)

    return pd.concat(frames, ignore_index=True)


# ============================================================
# Output 3: Actuals_Current_Normalized
#
# UTIL_Current is the current-quarter actuals source of truth.
# Its dated weekly cells are the direct blend input.
# ============================================================

def build_current_actuals_normalized(xl) -> pd.DataFrame:
    source = xl.parse("UTIL_Current").copy()

    if "Worker" not in source.columns:
        raise ValueError(
            'UTIL_Current: missing required "Worker" column.'
        )

    source = source[
        ~source["Worker"].map(is_junk_worker)
    ].copy()

    if "Employee ID" not in source.columns:
        raise ValueError(
            'UTIL_Current: missing required "Employee ID" column.'
        )

    source["employee_id"] = source["Employee ID"].map(
        normalize_employee_id
    )

    # Preserve source row identity after header; useful lineage for app-side
    # Actuals_Normalized source_row.
    source["_source_row"] = source.index + 2

    weekly_columns = [
        column
        for column in source.columns
        if is_date_header(column)
    ]

    if not weekly_columns:
        raise ValueError(
            "UTIL_Current: no dated weekly actual columns found."
        )

    actuals = source.melt(
        id_vars=["employee_id", "_source_row", "Worker"],
        value_vars=weekly_columns,
        var_name="_week_start",
        value_name="actual_icp_hours",
    )

    actuals["actual_icp_hours"] = safe_numeric(
        actuals["actual_icp_hours"]
    )

    # Mirrors current app behavior: omit zero-hour actual rows.
    actuals = actuals[
        (actuals["employee_id"] != "")
        & (actuals["actual_icp_hours"] != 0)
    ].copy()

    actuals["week_start"] = pd.to_datetime(
        actuals["_week_start"]
    )

    actuals["week_key"] = actuals["week_start"].dt.strftime(
        "%Y-%m-%d"
    )

    actuals = actuals.rename(columns={
        "Worker": "resource_name",
        "_source_row": "source_row",
    })

    return actuals[
        [
            "employee_id",
            "resource_name",
            "week_start",
            "week_key",
            "actual_icp_hours",
            "source_row",
        ]
    ]


# ============================================================
# Output 4: History_Normalized
# ============================================================

def build_history_normalized(xl):
    """
    Grain:
      employee_id x project x project_role_category
      x fiscal_quarter x worker_class

    Measure:
      Worked Hours
    """
    source = xl.parse("Actuals_Historical").copy()

    required_columns = [
        "Worker ID",
        "Worker",
        "Region as of Date Worked",
        "Project",
        "Project Role Category",
        "Worked Hours",
        "Fiscal Qtr",
    ]

    missing = [
        column
        for column in required_columns
        if column not in source.columns
    ]

    if missing:
        raise ValueError(
            "Actuals_Historical: missing required field(s): "
            + ", ".join(missing)
        )

    source = source[
        ~source["Worker"].map(is_junk_worker)
    ].copy()

    source["employee_id"] = source["Worker ID"].map(
        normalize_employee_id
    )

    source["worker_class"] = [
        classify_history_worker(worker, region)
        for worker, region in zip(
            source["Worker"],
            source["Region as of Date Worked"],
        )
    ]

    source["fiscal_quarter"] = source["Fiscal Qtr"].map(
        fiscal_quarter_from_history_label
    )

    invalid_quarters = (source["fiscal_quarter"] == "").sum()

    if invalid_quarters:
        raise ValueError(
            "Actuals_Historical: "
            f"{invalid_quarters} row(s) have an invalid Fiscal Qtr."
        )

    source["Worked Hours"] = safe_numeric(source["Worked Hours"])

    source_total = source["Worked Hours"].sum()

    history = (
        source.groupby(
            [
                "employee_id",
                "Worker",
                "worker_class",
                "fiscal_quarter",
                "Project",
                "Project Role Category",
            ],
            dropna=False,
        )["Worked Hours"]
        .sum()
        .reset_index()
        .rename(columns={
            "Worker": "resource_name",
            "Project": "project",
            "Project Role Category": "project_role_category",
            "Worked Hours": "worked_hours",
        })
    )

    return history, source_total


# ============================================================
# Validation
# ============================================================

def validate(
    forecast,
    actuals,
    utilization,
    history,
    history_source_total,
):
    results = []

    def check(label, condition):
        results.append((bool(condition), label))

    # --------------------------------------------------------
    # Forecast_Staged: wide PSA-compatible validation
    # --------------------------------------------------------
    forecast_weeks = forecast_week_columns(forecast)

    if forecast_weeks:
        forecast_dates = pd.to_datetime(
            forecast_weeks,
            format="%m/%d/%Y",
        )
    else:
        forecast_dates = pd.DatetimeIndex([])

    check(
        "Forecast_Staged: no blank Employee ID",
        (
            forecast["Employee ID"]
            .map(normalize_employee_id)
            .eq("")
            .sum()
            == 0
        ),
    )

    check(
        "Forecast_Staged: weekly columns present",
        len(forecast_weeks) > 0,
    )

    check(
        "Forecast_Staged: all weekly headers are Saturdays",
        (
            len(forecast_dates) > 0
            and (forecast_dates.dayofweek == 5).all()
        ),
    )

    check(
        "Forecast_Staged: weekly headers are contiguous",
        (
            len(forecast_dates) <= 1
            or (
                forecast_dates.to_series()
                .diff()
                .dropna()
                .dt.days
                .eq(7)
                .all()
            )
        ),
    )

    # --------------------------------------------------------
    # Actuals_Current_Normalized
    # --------------------------------------------------------
    check(
        "Actuals_Current_Normalized: no blank employee_id",
        (actuals["employee_id"] == "").sum() == 0,
    )

    check(
        "Actuals_Current_Normalized: all week_start values are Saturdays",
        (actuals["week_start"].dt.dayofweek == 5).all(),
    )

    check(
        "Actuals_Current_Normalized: week_key matches week_start",
        (
            actuals["week_key"]
            == actuals["week_start"].dt.strftime("%Y-%m-%d")
        ).all(),
    )

    # --------------------------------------------------------
    # Current actual weekly rows must equal UTIL_Current QTD
    # --------------------------------------------------------
    util_current = utilization[
        utilization["source_sheet"] == "UTIL_Current"
    ].copy()

    current_qtd_by_worker = (
        util_current
        .set_index("employee_id")["qtd_actual_icp"]
        .fillna(0)
    )

    current_weekly_by_worker = (
        actuals
        .groupby("employee_id")["actual_icp_hours"]
        .sum()
    )

    current_comparison = pd.concat(
        [
            current_weekly_by_worker.rename("weekly_actuals"),
            current_qtd_by_worker.rename("qtd_actuals"),
        ],
        axis=1,
    ).fillna(0)

    max_qtd_difference = (
        current_comparison["weekly_actuals"]
        .sub(current_comparison["qtd_actuals"])
        .abs()
        .max()
    )

    check(
        "UTIL_Current: weekly actuals equal QTD actual ICP per worker",
        max_qtd_difference < 0.01,
    )

    # --------------------------------------------------------
    # Utilization_Normalized
    # --------------------------------------------------------
    check(
        "Utilization_Normalized: no blank employee_id",
        (utilization["employee_id"] == "").sum() == 0,
    )

    check(
        "Utilization_Normalized: no null target_hours",
        utilization["target_hours"].isna().sum() == 0,
    )

    check(
        "Utilization_Normalized: no null util_rate_wkly",
        utilization["util_rate_wkly"].isna().sum() == 0,
    )

    check(
        "Utilization_Normalized: exactly four fiscal quarters",
        utilization["fiscal_quarter"].nunique() == 4,
    )

    # --------------------------------------------------------
    # History_Normalized
    # --------------------------------------------------------
    check(
        "History_Normalized: no blank employee_id",
        (history["employee_id"] == "").sum() == 0,
    )

    check(
        "History_Normalized: worked hours reconcile to source",
        abs(history["worked_hours"].sum() - history_source_total) < 0.01,
    )

    check(
        "History_Normalized: exactly SLG / Non-SLG / Contractor classes",
        set(history["worker_class"].unique())
        == {"SLG", "Non-SLG", "Contractor"},
    )

    return results


# ============================================================
# Manifest and daily diff
# ============================================================

def build_manifest(forecast, actuals, utilization, history):
    forecast_weeks = forecast_week_columns(forecast)

    forecast_total = (
        forecast[forecast_weeks]
        .apply(pd.to_numeric, errors="coerce")
        .fillna(0)
        .to_numpy()
        .sum()
    )

    # Forecast min/max period must be computed from PARSED DATES, then
    # emitted as YYYY-MM-DD. Using the raw MM/DD/YYYY header strings sorts
    # lexicographically (e.g. "01/02/2027" < "08/08/2026"), which inverts
    # min/max. ISO YYYY-MM-DD also matches how the app reports actuals,
    # so the app-side string comparison stays correct.
    forecast_week_dates = pd.to_datetime(
        forecast_weeks,
        format="%m/%d/%Y",
    )

    forecast_min_period = forecast_week_dates.min().strftime("%Y-%m-%d")
    forecast_max_period = forecast_week_dates.max().strftime("%Y-%m-%d")

    return pd.DataFrame([
        {
            "sheet": OUTPUT_FORECAST_SHEET,
            "rows": len(forecast),
            "primary_measure": "forecast_hours",
            "primary_total": round(float(forecast_total), 1),
            "distinct_workers": (
                forecast["Employee ID"]
                .map(normalize_employee_id)
                .nunique()
            ),
            "min_period": forecast_min_period,
            "max_period": forecast_max_period,
        },
        {
            "sheet": OUTPUT_ACTUALS_SHEET,
            "rows": len(actuals),
            "primary_measure": "actual_icp_hours",
            "primary_total": round(
                float(actuals["actual_icp_hours"].sum()),
                1,
            ),
            "distinct_workers": actuals["employee_id"].nunique(),
            "min_period": actuals["week_key"].min(),
            "max_period": actuals["week_key"].max(),
        },
        {
            "sheet": OUTPUT_UTILIZATION_SHEET,
            "rows": len(utilization),
            "primary_measure": "target_hours",
            "primary_total": round(
                float(utilization["target_hours"].sum()),
                1,
            ),
            "distinct_workers": utilization["employee_id"].nunique(),
            "min_period": utilization["fiscal_quarter"].min(),
            "max_period": utilization["fiscal_quarter"].max(),
        },
        {
            "sheet": OUTPUT_HISTORY_SHEET,
            "rows": len(history),
            "primary_measure": "worked_hours",
            "primary_total": round(
                float(history["worked_hours"].sum()),
                1,
            ),
            "distinct_workers": history["employee_id"].nunique(),
            "min_period": history["fiscal_quarter"].min(),
            "max_period": history["fiscal_quarter"].max(),
        },
    ])


def diff_vs_prior(manifest, prior_manifest_path):
    """
    Compares today with the previous successful run.

    Supports both:
      - current manifest schema: primary_total
      - earlier script schema: total_hours
    """
    if not os.path.exists(prior_manifest_path):
        return ["(no prior manifest found; first run)"]

    prior = pd.read_json(prior_manifest_path)
    lines = []

    for _, current in manifest.iterrows():
        prior_matches = prior[
            prior["sheet"] == current["sheet"]
        ]

        if prior_matches.empty:
            lines.append(f"{current['sheet']}: NEW")
            continue

        previous = prior_matches.iloc[0]

        previous_total = previous.get(
            "primary_total",
            previous.get("total_hours", None),
        )

        current_total = current.get(
            "primary_total",
            current.get("total_hours", None),
        )

        previous_measure = previous.get(
            "primary_measure",
            "total_hours",
        )

        current_measure = current.get(
            "primary_measure",
            previous_measure,
        )

        row_delta = int(current["rows"] - previous["rows"])

        if previous_total is None or current_total is None:
            lines.append(
                f"{current['sheet']}: "
                f"rows {previous['rows']} -> {current['rows']} "
                f"({row_delta:+d}); "
                "measure comparison unavailable due to prior manifest schema"
            )
            continue

        measure_delta = float(current_total - previous_total)

        lines.append(
            f"{current['sheet']}: "
            f"rows {previous['rows']} -> {current['rows']} "
            f"({row_delta:+d}); "
            f"{current_measure} {previous_total} -> {current_total} "
            f"({measure_delta:+.1f})"
        )

    return lines


# ============================================================
# Main
# ============================================================

def main():
    if len(sys.argv) < 2:
        print(
            "Usage: python wow_transform.py <input.xlsx> [output.xlsx]"
        )
        return 2

    input_path = sys.argv[1]

    output_path = (
        sys.argv[2]
        if len(sys.argv) > 2
        else "WoW_Consolidated_Normalized.xlsx"
    )

    prior_manifest_path = "wow_last_manifest.json"

    if not os.path.exists(input_path):
        print(f"ERROR: input file not found: {input_path}")
        return 2

    try:
        print(f"Reading source workbook: {input_path}")

        xl = pd.ExcelFile(input_path)

        validate_input_workbook(xl)

        forecast = build_forecast_staged(xl)
        actuals = build_current_actuals_normalized(xl)
        utilization = build_utilization_normalized(xl)
        history, history_source_total = build_history_normalized(xl)

        validation_results = validate(
            forecast=forecast,
            actuals=actuals,
            utilization=utilization,
            history=history,
            history_source_total=history_source_total,
        )

        print("\n================ VALIDATION ================")

        all_pass = True

        for passed, label in validation_results:
            status = "PASS" if passed else "FAIL"
            print(f"[{status}] {label}")
            all_pass = all_pass and passed

        manifest = build_manifest(
            forecast=forecast,
            actuals=actuals,
            utilization=utilization,
            history=history,
        )

        print("\n================ MANIFEST ================")
        print(manifest.to_string(index=False))

        print("\n================ DAILY DIFF ================")

        for line in diff_vs_prior(
            manifest,
            prior_manifest_path,
        ):
            print(line)

        if not all_pass:
            print(
                "\nABORTED: one or more validations failed. "
                "Output workbook was not written."
            )
            return 1

        with pd.ExcelWriter(
            output_path,
            engine="openpyxl",
        ) as writer:
            forecast.to_excel(
                writer,
                sheet_name=OUTPUT_FORECAST_SHEET,
                index=False,
            )

            actuals.to_excel(
                writer,
                sheet_name=OUTPUT_ACTUALS_SHEET,
                index=False,
            )

            utilization.to_excel(
                writer,
                sheet_name=OUTPUT_UTILIZATION_SHEET,
                index=False,
            )

            history.to_excel(
                writer,
                sheet_name=OUTPUT_HISTORY_SHEET,
                index=False,
            )

            manifest.to_excel(
                writer,
                sheet_name=OUTPUT_MANIFEST_SHEET,
                index=False,
            )

        manifest.to_json(
            prior_manifest_path,
            orient="records",
        )

        print(f"\nSUCCESS: wrote consolidated workbook: {output_path}")
        return 0

    except Exception as exc:
        print(f"\nERROR: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())