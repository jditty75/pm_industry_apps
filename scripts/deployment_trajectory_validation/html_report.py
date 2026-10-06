"""Human-validation HTML artifact (local only)."""

from __future__ import annotations

import html
from typing import Any, Dict, List, Optional

from .fields import as_int, trajectory_get


HUMAN_QUESTIONS = [
    "Is current state correct?",
    "Is health trajectory correct?",
    "Is schedule trajectory correct?",
    "Is Product Function representation correct?",
    "Is intervention evidence correct?",
    "Is important operational context missing?",
    "If you only saw Green health, would you investigate this deployment?",
    "After seeing trajectory, would you investigate it?",
    "Would this evidence have been useful earlier?",
    "Is the trajectory misleading without additional context?",
    "Does this trajectory tell the same story a knowledgeable deployment leader would tell? (YES / PARTLY / NO)",
]


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""))


def _trajectory_summary_cell(t: Dict[str, Any], key: str) -> str:
    if key == "health_trajectory":
        det = as_int(t.get("health_deteriorations_90d"))
        imp = as_int(t.get("health_improvements_90d"))
        return f"det90={det}; imp90={imp}"
    if key == "schedule_trajectory":
        return (
            f"chg90={as_int(t.get('mtp_changes_90d'))}; "
            f"gross={t.get('mtp_gross_movement_days', '')}"
        )
    if key == "intervention":
        return f"open_hp={t.get('has_open_health_plan', '')}"
    return ""


def render_human_validation_html(
    candidates: Dict[str, Any],
    today_str: str,
    green_stats: Optional[Dict[str, Any]] = None,
) -> str:
    sections: List[str] = []
    sections.append("<!DOCTYPE html><html><head><meta charset='utf-8'>")
    sections.append("<title>Deployment Trajectory — Human Validation (local only)</title>")
    sections.append(
        "<style>body{font-family:Segoe UI,sans-serif;max-width:1100px;margin:24px auto;line-height:1.45}"
        "h1,h2,h3{color:#333}.tag{background:#eee;padding:2px 6px;border-radius:4px;font-size:12px}"
        ".note{background:#fff8e6;padding:12px;border-left:4px solid #e6a700}"
        ".warn{background:#fdecea;padding:10px;border-left:4px solid #c62828}"
        "table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;font-size:13px}"
        ".questions li{margin:6px 0}</style></head><body>"
    )
    sections.append("<h1>Deployment Trajectory — Human Validation Package</h1>")
    sections.append(
        "<p class='note'><strong>Local only.</strong> Selection logic is "
        "<span class='tag'>VALIDATION_HEURISTIC_ONLY</span> — not production signal rules. "
        f"Snapshot date context: {_esc(today_str)}.</p>"
    )

    profile_cov = candidates.get("_profile_coverage", {})
    sections.append("<h2>Profile coverage (counts)</h2><ul>")
    for k, v in sorted(profile_cov.items()):
        sections.append(f"<li>{_esc(k)}: {v}</li>")
    sections.append("</ul>")

    green_cohort = candidates.get("_green_cohort") or {}
    sections.append("<h2>Green validation cohort</h2>")
    if green_cohort.get("insufficient"):
        sections.append("<ul>")
        for msg in green_cohort["insufficient"].values():
            sections.append(f"<li class='warn'>{_esc(msg)}</li>")
        sections.append("</ul>")

    green_dep_ids: List[str] = []
    for dep_ids in (green_cohort.get("selected_by_class") or {}).values():
        green_dep_ids.extend(dep_ids)
    green_dep_ids = list(dict.fromkeys(green_dep_ids))

    sections.append("<h3>Green comparison</h3><table><tr>")
    headers = [
        "Deployment",
        "Primary class",
        "Current health",
        "Stage",
        "Days to MTP",
        "Health trajectory",
        "Schedule trajectory",
        "PF context",
        "Intervention",
        "Evidence quality",
        "Why selected",
    ]
    for h in headers:
        sections.append(f"<th>{_esc(h)}</th>")
    sections.append("</tr>")

    for dep_id in green_dep_ids:
        bundle = candidates.get(dep_id) or {}
        t = bundle.get("trajectory") or {}
        name = bundle.get("name") or dep_id
        primary = bundle.get("primary_green_validation_class", "")
        pf = bundle.get("pf_context") or {}
        intervention = bundle.get("intervention") or {}
        why = "; ".join(bundle.get("green_selection_reasons") or bundle.get("profiles") or [])
        sections.append("<tr>")
        sections.append(f"<td>{_esc(name)}</td>")
        sections.append(f"<td>{_esc(primary)}</td>")
        sections.append(f"<td>{_esc(t.get('current_health'))}</td>")
        sections.append(f"<td>{_esc(t.get('current_stage'))}</td>")
        sections.append(f"<td>{_esc(trajectory_get(t, 'days_to_mtp'))}</td>")
        sections.append(f"<td>{_esc(_trajectory_summary_cell(t, 'health_trajectory'))}</td>")
        sched = bundle.get("schedule") or {}
        sched_cell = (
            f"recent90={sched.get('recent_mtp_event_count_90d')}; "
            f"hist={sched.get('historical_mtp_event_count_365d_excl_recent')}"
        )
        sections.append(f"<td>{_esc(sched_cell)}</td>")
        sections.append(
            f"<td>pf={pf.get('count')}; rem={pf.get('remaining')}; comp={pf.get('completed')}</td>"
        )
        int_cell = (
            f"traj_hp={intervention.get('trajectory_open_health_plan')}; "
            f"src_dhp={intervention.get('source_dhp_rows')}; "
            f"idx_ah={intervention.get('source_action_history_index_rows')}"
        )
        if intervention.get("intervention_mismatch"):
            int_cell += f"; {intervention.get('intervention_mismatch')}"
        sections.append(f"<td>{_esc(int_cell)}</td>")
        sections.append(f"<td>{_esc(bundle.get('evidence_quality', ''))}</td>")
        sections.append(f"<td>{_esc(why)}</td>")
        sections.append("</tr>")
    sections.append("</table>")

    for dep_id, bundle in candidates.items():
        if dep_id.startswith("_"):
            continue
        is_green_section = dep_id in green_dep_ids
        if is_green_section:
            sections.append(f"<h2>Green profile: {_esc(bundle.get('name') or dep_id)}</h2>")
        else:
            sections.append(f"<h2>{_esc(bundle.get('name') or dep_id)}</h2>")

        customer = bundle.get("customer") or ""
        if customer:
            sections.append(f"<p><em>{_esc(customer)}</em> · <code>{_esc(dep_id)}</code></p>")

        profiles = ", ".join(bundle.get("profiles") or [])
        primary = bundle.get("primary_green_validation_class", "")
        sections.append(
            f"<p><strong>Why selected for validation:</strong> {_esc(profiles)} "
            f"<span class='tag'>VALIDATION_HEURISTIC_ONLY</span></p>"
        )
        if primary:
            sections.append(f"<p><strong>Primary Green class:</strong> {_esc(primary)}</p>")
        g2 = bundle.get("green_g2_reasons") or []
        g3 = bundle.get("green_g3_reasons") or []
        if g2:
            sections.append(f"<p>G2 dimensions: {_esc('; '.join(g2))}</p>")
        if g3:
            sections.append(f"<p>G3 dimensions: {_esc('; '.join(g3))}</p>")

        t = bundle.get("trajectory") or {}
        sections.append("<h3>Current state</h3><table><tr><th>Field</th><th>Value</th></tr>")
        for label, key in [
            ("Deployment / customer", "deployment_name"),
            ("Health", "current_health"),
            ("Stage", "current_stage"),
            ("Current MTP", "current_mtp"),
            ("Days to MTP", "days_until_current_mtp"),
            ("MTP analysis grain", "mtp_analysis_grain"),
            ("Product Function count", "product_function_count"),
        ]:
            val = t.get(key, "") if key != "deployment_name" else (
                f"{t.get('deployment_name', '')} / {t.get('customer_name', '')}"
            )
            if key == "days_until_current_mtp":
                val = trajectory_get(t, "days_to_mtp")
            sections.append(f"<tr><td>{_esc(label)}</td><td>{_esc(val)}</td></tr>")
        sections.append("</table>")

        sections.append("<h3>Health trajectory</h3><table><tr><th>Metric</th><th>Value</th></tr>")
        for label, key in [
            ("Previous health", "previous_health"),
            ("Last health change", "health_last_change_date"),
            ("Days at current health", "days_at_current_health"),
            ("Deteriorations 90d", "health_deteriorations_90d"),
            ("Improvements 90d", "health_improvements_90d"),
        ]:
            val = trajectory_get(t, key) if key == "health_last_change_date" else t.get(key, "")
            if key == "health_last_change_date":
                val = trajectory_get(t, "last_health_change_date")
            sections.append(f"<tr><td>{_esc(label)}</td><td>{_esc(val)}</td></tr>")
        sections.append("</table>")

        he_rows = bundle.get("health_events_display") or []
        if he_rows:
            sections.append("<h4>Health events</h4><table><tr>")
            for c in ("event_date", "event_type", "old_value", "new_value"):
                sections.append(f"<th>{_esc(c)}</th>")
            sections.append("</tr>")
            for h in he_rows[:12]:
                sections.append("<tr>")
                for c in ("event_date", "event_type", "old_value", "new_value"):
                    sections.append(f"<td>{_esc(h.get(c, ''))}</td>")
                sections.append("</tr>")
            sections.append("</table>")

        sched = bundle.get("schedule") or {}
        sections.append("<h3>Schedule trajectory</h3><table><tr><th>Metric</th><th>Value</th></tr>")
        for label, key in [
            ("Target changes 90d (parent)", "mtp_changes_90d"),
            ("Slips 90d", "mtp_slips_90d"),
            ("Accelerations 90d", "mtp_accelerations_90d"),
            ("Gross movement (lifetime)", "mtp_gross_movement_lifetime"),
            ("Net movement (lifetime)", "mtp_net_movement_lifetime"),
            ("Gross 90d proxy", "schedule_gross_90d_proxy"),
            ("Recent MTP events (90d)", "recent_mtp_event_count_90d"),
            ("Historical MTP events (365d, excl recent)", "historical_mtp_event_count_365d_excl_recent"),
            ("Parent reconciliation", "parent_reconciliation"),
            ("Reconstructed parent MTP", "reconstructed_parent_mtp"),
        ]:
            sections.append(f"<tr><td>{_esc(label)}</td><td>{_esc(sched.get(key, ''))}</td></tr>")
        sections.append("</table>")

        mtp_rows = bundle.get("mtp_events") or []
        if mtp_rows:
            sections.append("<h4>MTP event chronology (excerpt)</h4><table><tr>")
            for c in ("event_date", "event_type", "old_date", "new_date", "movement_days"):
                sections.append(f"<th>{_esc(c)}</th>")
            sections.append("</tr>")
            for m in mtp_rows[:12]:
                sections.append("<tr>")
                for c in ("event_date", "event_type", "old_date", "new_date", "movement_days"):
                    sections.append(f"<td>{_esc(m.get(c, ''))}</td>")
                sections.append("</tr>")
            sections.append("</table>")

        pf = bundle.get("pf_context") or {}
        sections.append("<h3>Product Function context</h3><ul>")
        sections.append(f"<li>Count: {_esc(pf.get('count'))}</li>")
        sections.append(f"<li>Completed: {_esc(pf.get('completed'))}</li>")
        sections.append(f"<li>Remaining: {_esc(pf.get('remaining'))}</li>")
        sections.append(f"<li>Grain: {_esc(pf.get('grain'))}</li>")
        sections.append(f"<li><em>{_esc(pf.get('pf_target_history_absent_note', ''))}</em></li>")
        sections.append("</ul>")

        intervention = bundle.get("intervention") or {}
        sections.append("<h3>Intervention context</h3><ul>")
        sections.append(
            f"<li>Trajectory-derived open Health Plan: "
            f"{_esc(intervention.get('trajectory_open_health_plan'))}</li>"
        )
        sections.append(
            f"<li>Source DHP evidence (rows): {_esc(intervention.get('source_dhp_rows'))}</li>"
        )
        sections.append(
            f"<li>Trajectory dhp_count: {_esc(intervention.get('trajectory_dhp_count'))}</li>"
        )
        sections.append(
            f"<li>Action History index rows: "
            f"{_esc(intervention.get('source_action_history_index_rows'))}</li>"
        )
        sections.append(
            f"<li>Trajectory action_history_record_count: "
            f"{_esc(intervention.get('trajectory_action_history_count'))}</li>"
        )
        sections.append(
            f"<li>DHP Action join count: "
            f"{_esc(intervention.get('source_action_history_via_dhp_join'))}</li>"
        )
        if intervention.get("intervention_mismatch"):
            sections.append(
                f"<li class='warn'><strong>{_esc(intervention.get('intervention_mismatch'))}</strong>: "
                f"{_esc('; '.join(intervention.get('intervention_mismatch_reasons') or []))}</li>"
            )
        sections.append("</ul>")

        sections.append("<h3>Evidence quality</h3>")
        sections.append(
            f"<p><strong>{_esc(bundle.get('evidence_quality', ''))}</strong> — "
            f"{_esc('; '.join(bundle.get('evidence_quality_reasons') or []))}</p>"
        )
        sections.append(f"<p>Build warnings: {_esc(t.get('build_warnings') or '(none)')}</p>")

        sections.append("<h3>Human questions</h3><ol class='questions'>")
        for q in HUMAN_QUESTIONS:
            sections.append(f"<li>{_esc(q)}<br/>Notes: __________</li>")
        sections.append("</ol><hr/>")

    sections.append("<h2>Green population exploration (local)</h2>")
    if green_stats:
        sections.append("<ul>")
        for k, v in sorted(green_stats.items()):
            sections.append(f"<li>{_esc(k)}: {_esc(v)}</li>")
        sections.append("</ul>")
    sections.append("<p>Full aggregates: trajectory-validation-aggregate.json</p>")
    sections.append("</body></html>")
    return "\n".join(sections)
