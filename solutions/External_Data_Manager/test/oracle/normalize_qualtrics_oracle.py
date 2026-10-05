"""
Test-only oracle: mirrors C:\\Users\\jeffrey.ditty\\Documents\\PY\\Qualtrics.py normalize()
but reads CSV (V1A automated source format). Not used in production.
"""
import sys
import json
import pandas as pd

# Copied contract from Qualtrics.py (keep in sync with QualtricsSchema.js)
COLMAP = {
    "Survey_ID": "survey_id",
    "Program_Type": "survey_type",
    "Sub Region": "app",
    "Account_ID": "account_id",
    "Account_Name": "account_name",
    "Customer_Segment_[Persistent]": "customer_segment",
    "First_name": "first_name",
    "Last_name": "last_name",
    "Email": "contact_email",
    "Contact_ID": "contact_id",
    "Deployment_Contact_Role": "contact_role",
    "Deployment_ID": "deployment_id",
    "Deployment_Name": "deployment_name",
    "Deployment_Stage": "deployment_stage",
    "Normalized Deployment Type": "deployment_type",
    "Normalized Services Approach": "services_approach",
    "Priming_Partner": "priming_partner",
    "Partner Name": "partner_name",
    "Engagement Manager Name": "engagement_manager",
    "Deployment_Engagement_Manager_Email": "engagement_manager_email",
    "Distribution Type": "last_send_type",
    "Distribution Channel": "channel",
    "expiration_date": "survey_expires",
    "Email Sent": "f_email_sent",
    "Email Opened": "f_email_opened",
    "Email Bounced": "f_email_bounced",
    "Survey Bounced": "f_survey_bounced",
    "Survey Started": "f_survey_started",
    "Survey Finished": "f_survey_finished",
    "Survey Partial Recorded": "f_survey_partial",
    "Email Sent Time (+00:00 GMT)": "ts_email_sent",
    "Email Opened Time (+00:00 GMT)": "ts_email_opened",
    "Survey Started Time (+00:00 GMT)": "ts_survey_started",
    "Survey Finished Time (+00:00 GMT)": "ts_survey_finished",
    "Recorded Date (+00:00 GMT)": "ts_response_recorded",
    "Response ID": "response_id",
    "Recipient ID": "recipient_id",
    "Post_Go-Live_NPS": "nps",
    "Overall Satisfaction": "overall_satisfaction",
    "#PGL Satisfaction": "pgl_satisfaction",
    "#MDS Satisfaction": "mds_satisfaction",
}
VALID_APPS = {"US Healthcare", "US SLED"}
FLAG_COLS = ["f_email_sent", "f_email_opened", "f_email_bounced", "f_survey_bounced",
             "f_survey_started", "f_survey_finished", "f_survey_partial"]
TS_COLS = ["ts_email_sent", "ts_email_opened", "ts_survey_started",
           "ts_survey_finished", "ts_response_recorded"]
SCORE_COLS = ["nps", "overall_satisfaction", "pgl_satisfaction", "mds_satisfaction"]
OUT_ORDER = [
    "app", "survey_type", "survey_id", "account_id", "account_name", "customer_segment",
    "contact_id", "full_name", "first_name", "last_name", "contact_email", "contact_role",
    "deployment_id", "deployment_name", "deployment_stage", "deployment_type",
    "services_approach", "priming_partner", "partner_name",
    "engagement_manager", "engagement_manager_email",
    "last_send_type", "channel", "survey_expires",
    "tracking_status", "response_received", "response_id", "recipient_id",
    "ts_email_sent", "ts_email_opened", "ts_survey_started", "ts_survey_finished",
    "ts_response_recorded",
    "nps", "overall_satisfaction", "pgl_satisfaction", "mds_satisfaction",
]


def to_bool(v):
    if pd.isna(v):
        return False
    return str(v).strip().lower() in {"1", "1.0", "true", "yes", "y"}


def tracking_status(r):
    if r.f_survey_bounced or r.f_email_bounced:
        return "Bounced/Undeliverable"
    if r.f_survey_finished:
        return "Completed"
    if r.f_survey_partial:
        return "Partial"
    if r.f_survey_started:
        return "Started"
    if r.f_email_opened:
        return "Opened"
    if r.f_email_sent:
        return "Sent"
    return "Unknown"


def normalize_csv(path):
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = [c for c in COLMAP if c not in df.columns]
    if missing:
        raise ValueError(f"Export schema changed. Missing columns: {missing}")
    df = df[list(COLMAP)].rename(columns=COLMAP)
    bad = set(df["app"].replace("", pd.NA).dropna().unique()) - VALID_APPS
    if bad or df["app"].replace("", pd.NA).isna().any():
        raise ValueError(f"Unexpected/blank 'app' values: {bad or 'nulls present'}")
    for c in FLAG_COLS:
        df[c] = df[c].map(to_bool)
    for c in TS_COLS:
        df[c] = pd.to_datetime(df[c], errors="coerce", utc=True)
    for c in SCORE_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["tracking_status"] = df.apply(tracking_status, axis=1)
    df["response_received"] = df["response_id"].replace("", pd.NA).notna()
    df["full_name"] = (df["first_name"].fillna("").str.strip() + " " +
                       df["last_name"].fillna("").str.strip()).str.strip()
    df["_sort"] = df["ts_email_sent"].fillna(pd.Timestamp("1970-01-01", tz="UTC"))
    df = (df.sort_values("_sort")
            .drop_duplicates(subset=["survey_id", "contact_id"], keep="last")
            .drop(columns="_sort"))
    df = df[OUT_ORDER]
    for c in TS_COLS:
        df[c] = df[c].dt.strftime("%Y-%m-%dT%H:%M:%SZ").where(df[c].notna(), "")
    df["response_received"] = df["response_received"].map({True: "Yes", False: "No"})
    for c in SCORE_COLS:
        df[c] = df[c].where(df[c].notna(), "").astype(str).replace("nan", "")
    return df


def main():
    path = sys.argv[1]
    df = normalize_csv(path)
    hc = df[df["app"] == "US Healthcare"]
    sled = df[df["app"] == "US SLED"]
    payload = {
        "total": len(df),
        "healthcare": len(hc),
        "sled": len(sled),
        "rows": df.to_dict(orient="records"),
        "healthcare_rows": hc.to_dict(orient="records"),
        "sled_rows": sled.to_dict(orient="records"),
    }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
