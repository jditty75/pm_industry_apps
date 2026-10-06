#!/usr/bin/env python3
"""Sanitized tests for deployment signal context assembler."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deployment_trajectory_validation.calibration_compare import (
    cal01_material_checks,
    cal02_material_checks,
    cal03_material_checks,
)
from deployment_trajectory_validation.context_assembler import (
    SCHEMA_VERSION,
    build_context_packet,
    packet_size_stats,
    product_function_rollup_reconciliation,
)
from deployment_trajectory_validation.portfolio_harness import (
    stable_batch_packets,
    validate_packet_schema,
)


def _minimal_bundle(**overrides):
    t = {
        "deployment_id": "DEP_SANITIZED_001",
        "current_health": "Green",
        "current_stage": "Build",
        "current_mtp": "2026-12-01",
        "days_until_current_mtp": 50,
        "mtp_analysis_grain": "PRODUCT_FUNCTION",
        "product_function_count": 3,
        "functions_actual_mtp_count": 1,
        "functions_remaining_count": 2,
        "health_event_count": 2,
        "mtp_changes_90d": 0,
        "mtp_gross_movement_days": 30,
        "mtp_net_movement_days": 0,
        "trajectory_schema_version": 2,
        "has_open_health_plan": True,
        "dhp_count": 1,
        "action_history_record_count": 2,
    }
    t.update(overrides)
    return {
        "deployment_id": t["deployment_id"],
        "trajectory": t,
        "health_events_raw": [
            {"event_date": "2026-08-01", "old_health": "Yellow", "new_health": "Green", "transition_class": "improvement"}
        ],
        "mtp_events": [
            {
                "event_type": "PARENT_TARGET_CHANGE",
                "event_date": "2025-01-01",
                "old_date": "",
                "new_date": "2025-06-01",
                "movement_days": 0,
            }
        ],
        "intervention": {},
        "schedule": {
            "mtp_changes_90d": 0,
            "recent_mtp_event_count_90d": 0,
            "historical_mtp_event_count_365d_excl_recent": 1,
        },
    }


class ContextAssemblerTests(unittest.TestCase):
    def test_schema_version(self):
        pkt = build_context_packet(_minimal_bundle(), "2026-10-06")
        self.assertEqual(pkt["schema_version"], SCHEMA_VERSION)
        self.assertFalse(validate_packet_schema(pkt))

    def test_pf_target_history_unavailable(self):
        pf = product_function_rollup_reconciliation({"product_function_count": 2, "functions_actual_mtp_count": 0, "functions_remaining_count": 0})
        self.assertFalse(pf["product_function_target_history_available"])
        self.assertFalse(pf["product_function_rollup_reconciled"])

    def test_packet_size_stats(self):
        pkt = build_context_packet(_minimal_bundle(), "2026-10-06")
        stats = packet_size_stats([pkt, pkt])
        self.assertEqual(stats["count"], 2)
        self.assertGreater(stats["median"], 100)

    def test_stable_batching_order(self):
        packets = [
            {"metadata": {"deployment_id": "b"}},
            {"metadata": {"deployment_id": "a"}},
        ]
        batches = stable_batch_packets(packets, max_batch_bytes=10_000_000)
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0][0]["metadata"]["deployment_id"], "a")

    def test_calibration_check_helpers(self):
        pkt = build_context_packet(_minimal_bundle(), "2026-10-06", action_narratives=[{"CreatedDate": "2026-09-01", "Action_Description__c": "x"}])
        self.assertTrue(cal03_material_checks(pkt)[0])


if __name__ == "__main__":
    unittest.main()
