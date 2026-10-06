#!/usr/bin/env python3
"""Sanitized unit tests for deployment trajectory validation harness."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deployment_trajectory_validation.fields import (
    health_event_display_row,
    health_event_mapping_failure,
    normalize_id,
    resolve_dhp_deployment_id,
    trajectory_get,
)
from deployment_trajectory_validation.context_contract import (
    health_summary_contract,
    schedule_movement_contract,
)
from deployment_trajectory_validation.evidence import intervention_evidence
from deployment_trajectory_validation.schema import build_header_map, resolve_column
from deployment_trajectory_validation.selectors import (
    assign_profiles,
    classify_green_primary,
    demonstrable_dhp_and_action,
)
from deployment_trajectory_validation.integrity import run_integrity_checks_full


class HeaderMappingTests(unittest.TestCase):
    def test_resolve_health_event_columns(self):
        headers = build_header_map(
            ["deployment_id", "event_date", "old_health", "new_health", "transition_class"]
        )
        self.assertEqual(resolve_column(headers, "old_health"), "old_health")
        self.assertEqual(resolve_column(headers, "transition_class"), "transition_class")

    def test_dhp_deployment_relationship_column(self):
        dep15 = "a0rSAN000000000"
        row = {"Id": "DHP001", "Deployment__r.Id": dep15}
        self.assertEqual(resolve_dhp_deployment_id(row), dep15)


class HealthEventRenderingTests(unittest.TestCase):
    def test_maps_trace_columns_to_display(self):
        raw = {
            "event_date": "2025-01-15",
            "old_health": "Green",
            "new_health": "Yellow",
            "transition_class": "deterioration",
        }
        disp = health_event_display_row(raw)
        self.assertEqual(disp["event_type"], "deterioration")
        self.assertEqual(disp["old_value"], "Green")
        self.assertEqual(disp["new_value"], "Yellow")
        self.assertFalse(health_event_mapping_failure(disp))

    def test_mapping_failure_detects_wrong_keys(self):
        disp = health_event_display_row({"event_date": "2025-01-15"})
        self.assertTrue(health_event_mapping_failure(disp))


class ContextContractTests(unittest.TestCase):
    def test_health_reconciliation_flags_gap(self):
        t = {
            "current_health": "Green",
            "previous_health": "Red",
            "health_last_change_date": "2025-09-22",
        }
        events = [{"new_health": "Yellow", "old_health": "Red", "event_date": "2025-09-22"}]
        c = health_summary_contract(t, events)
        self.assertFalse(c["health_current_matches_last_event_new_health"])
        self.assertTrue(c["reconciliation_metadata_required"])

    def test_schedule_net_excludes_initial_population_semantics(self):
        t = {
            "mtp_gross_movement_days": 365,
            "mtp_net_movement_days": 0,
            "mtp_net_movement_comparison": "earliest_recorded_current_mtp",
            "earliest_recorded_mtp": "2026-07-01",
            "current_mtp": "2026-07-01",
        }
        mtp = [
            {"event_type": "PARENT_TARGET_CHANGE", "old_date": "", "new_date": "2025-07-01"},
            {
                "event_type": "PARENT_TARGET_CHANGE",
                "old_date": "2025-07-01",
                "new_date": "2026-07-01",
                "movement_days": 365,
            },
        ]
        c = schedule_movement_contract(t, mtp)
        self.assertEqual(c["initial_target_population_event_count"], 1)
        self.assertEqual(c["valid_parent_target_change_event_count"], 1)


class TrajectoryFieldTests(unittest.TestCase):
    def test_last_health_change_alias(self):
        t = {"health_last_change_date": "2025-09-22"}
        self.assertEqual(trajectory_get(t, "last_health_change_date"), "2025-09-22")


class GreenClassificationTests(unittest.TestCase):
    def test_g1_exclusive_from_g3(self):
        t = {
            "current_health": "Green",
            "health_deteriorations_90d": 0,
            "mtp_changes_90d": 0,
            "mtp_slips_90d": 0,
            "mtp_gross_movement_days": 5,
            "has_open_health_plan": False,
            "product_function_count": 1,
            "build_warnings": "",
            "function_target_changes_90d": 0,
            "health_changes_90d": 0,
        }
        intervention = {"source_dhp_rows": 0, "source_action_history_index_rows": 0}
        primary, g2, g3 = classify_green_primary(t, [], intervention, "2026-10-06")
        self.assertEqual(primary, "G1_green_stable")
        self.assertFalse(g3)

    def test_g3_when_multiple_dimensions(self):
        t = {
            "current_health": "Green",
            "health_deteriorations_90d": 0,
            "mtp_changes_90d": 2,
            "mtp_slips_90d": 1,
            "mtp_gross_movement_days": 40,
            "has_open_health_plan": True,
            "product_function_count": 4,
            "days_until_current_mtp": 90,
            "build_warnings": "",
            "function_target_changes_90d": 0,
            "health_changes_90d": 0,
        }
        intervention = {"source_dhp_rows": 1, "source_action_history_index_rows": 2}
        primary, _, g3 = classify_green_primary(t, [], intervention, "2026-10-06")
        self.assertEqual(primary, "G3_green_leadership_attention_candidate")
        self.assertTrue(g3)


class DhpLinkageTests(unittest.TestCase):
    def test_intervention_mismatch_when_trajectory_open_but_no_source(self):
        t = {
            "has_open_health_plan": True,
            "dhp_count": 0,
            "action_history_record_count": 0,
        }
        out = intervention_evidence(t, {}, {}, {}, "DEP_SAN_01")
        self.assertEqual(out["intervention_mismatch"], "INTERVENTION_EVIDENCE_MISMATCH")


class ProfileConsistencyTests(unittest.TestCase):
    def test_dhp_profile_requires_evidence(self):
        t = {
            "current_health": "Yellow",
            "action_history_record_count": 1,
            "dhp_count": 1,
            "health_deteriorations_90d": 0,
            "mtp_changes_90d": 0,
            "mtp_gross_movement_days": 0,
            "build_warnings": "",
        }
        dhp_by_dep = {"DEP_SAN_01": [{"Id": "dhp1"}]}
        idx = {"DEP_SAN_01": [{"action_history_id": "a1"}]}
        self.assertTrue(demonstrable_dhp_and_action("DEP_SAN_01", t, dhp_by_dep, idx))
        profiles = assign_profiles(
            "DEP_SAN_01", t, [], dhp_by_dep, idx, {}, "2026-10-06", ""
        )
        self.assertIn("dhp_and_action_history", profiles)

    def test_integrity_rejects_dhp_profile_without_evidence(self):
        candidates = {
            "DEP_SAN_01": {
                "profiles": ["dhp_and_action_history"],
                "trajectory": {"health_deteriorations_90d": 0, "action_history_record_count": 0},
                "health_events_display": [],
            }
        }
        ok, errors = run_integrity_checks_full(candidates, {}, {})
        self.assertFalse(ok)
        self.assertTrue(any("dhp_and_action_history" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
