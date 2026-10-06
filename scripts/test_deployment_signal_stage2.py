#!/usr/bin/env python3
"""Sanitized tests for Stage-2 portfolio compression and data stewardship."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deployment_trajectory_validation.data_stewardship import (
    LANE_PLATFORM,
    LANE_STEWARDSHIP,
    detect_platform_limitations,
    detect_stewardship_conditions,
    scan_portfolio_stewardship,
)
from deployment_trajectory_validation.stage1_ingest import (
    EXPECTED_CANDIDATE_COUNT,
    Stage1IngestError,
    build_normalized_candidate,
    ingest_stage1_directory,
    normalize_attention,
    normalize_confidence,
    parse_stage1_batch_text,
)
from deployment_trajectory_validation.stage2_harness import (
    compact_context_for_stage2,
    portfolio_stage2_payload,
    validate_stage2_payload,
)


def _packet(**overrides):
    base = {
        "schema_version": "deployment-signal-context-v1",
        "metadata": {"deployment_id": "DEP_SANITIZED_001", "deployment_label": "Sanitized"},
        "current_state": {
            "current_health": "Green",
            "deployment_stage": "Post Prod",
            "current_mtp": "2026-12-01",
            "days_relative_to_mtp": 50,
        },
        "health_trajectory": {
            "reconciliation": {
                "health_history_available": True,
                "health_current_matches_last_event_new_health": True,
            }
        },
        "schedule_trajectory": {"parent_reconciliation_status": "MATCH"},
        "product_function": {
            "product_function_count": 3,
            "functions_completed": 3,
            "functions_remaining": 0,
            "product_function_rollup_reconciled": True,
            "product_function_target_history_available": False,
        },
        "intervention": {"has_open_health_plan": False},
        "evidence_quality": {"unavailable_evidence": ["product_function_target_date_history"]},
    }
    for k, v in overrides.items():
        if isinstance(v, dict) and k in base and isinstance(base[k], dict):
            base[k].update(v)
        else:
            base[k] = v
    return base


class Stage1IngestTests(unittest.TestCase):
    def test_enum_normalization(self):
        self.assertEqual(normalize_attention("Watch")[0], "WATCH")
        self.assertEqual(normalize_confidence("High")[0], "HIGH")

    def test_parse_sample_block(self):
        sample = Path(__file__).resolve().parents[1] / (
            "libraries/DepMngr/test/fixtures/stage1-sample-block.txt"
        )
        text = sample.read_text(encoding="utf-8")
        blocks = parse_stage1_batch_text(text, "batch-test")
        signals = [b for b in blocks if b.is_signal]
        self.assertEqual(len(signals), 1)
        self.assertIn("COMPOUND", signals[0].fields.get("Signal Type", ""))

    def test_duplicate_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage1 = Path(tmp)
            dup = """Deployment: DEP_SANITIZED_001

Attention: High
Signal Type: HEALTH
Observation: A
"""
            (stage1 / "a.txt").write_text(dup, encoding="utf-8")
            (stage1 / "b.txt").write_text(dup, encoding="utf-8")
            packets = {"DEP_SANITIZED_001": _packet()}
            with self.assertRaises(Stage1IngestError):
                ingest_stage1_directory(stage1, packets, expected_count=2)

    def test_build_normalized_candidate(self):
        sample_path = (
            Path(__file__).resolve().parents[1]
            / "libraries/DepMngr/test/fixtures/stage1-sample-block.txt"
        )
        blocks = parse_stage1_batch_text(sample_path.read_text(encoding="utf-8"), "batch-01")
        sig = [b for b in blocks if b.is_signal][0]
        cand = build_normalized_candidate(sig, "DEP_SANITIZED_001", "ctx.json", "abc")
        self.assertEqual(cand["stage1_assessment"]["attention"], "WATCH")


class StewardshipTests(unittest.TestCase):
    def test_platform_vs_stewardship_separation(self):
        pkt = _packet()
        plat = detect_platform_limitations(pkt)
        stew = detect_stewardship_conditions(pkt)
        self.assertTrue(any(r["lane"] == LANE_PLATFORM for r in plat))
        self.assertFalse(any(r["lane"] == LANE_STEWARDSHIP for r in stew))

    def test_health_reconciliation_stewardship(self):
        pkt = _packet(
            health_trajectory={
                "reconciliation": {
                    "health_current_matches_last_event_new_health": False,
                    "days_since_last_historized_health_change": 12,
                }
            }
        )
        codes = [r["condition_code"] for r in detect_stewardship_conditions(pkt)]
        self.assertIn("HEALTH_STATE_RECONCILIATION_MISMATCH", codes)

    def test_pf_rollup_stewardship(self):
        pkt = _packet(
            product_function={
                "product_function_count": 3,
                "functions_completed": 0,
                "functions_remaining": 0,
                "product_function_rollup_reconciled": False,
            }
        )
        codes = [r["condition_code"] for r in detect_stewardship_conditions(pkt)]
        self.assertIn("PF_ROLLUP_RECONCILIATION_MISMATCH", codes)

    def test_portfolio_scan_count(self):
        packets = [_packet(metadata={"deployment_id": f"DEP_{i:03d}"}) for i in range(184)]
        rows, summary = scan_portfolio_stewardship(packets)
        self.assertEqual(summary["total_deployments_scanned"], 184)
        self.assertGreater(summary["condition_count"], 0)


class Stage2PayloadTests(unittest.TestCase):
    def _candidates(self, n: int):
        out = []
        for i in range(n):
            dep = f"DEP_{i:03d}"
            out.append(
                {
                    "schema_version": "deployment-signal-candidate-v1",
                    "identity": {
                        "deployment_id": dep,
                        "context_packet_ref": f"{dep}.json",
                        "stage1_batch": "batch-01",
                        "stage1_position": i + 1,
                        "source_checksum": "x",
                    },
                    "stage1_assessment": {
                        "attention": "WATCH",
                        "signal_type": "COMPOUND",
                        "observation": "o",
                        "confidence": "MEDIUM",
                    },
                    "stage1_raw_text": "raw",
                }
            )
        return out

    def test_stage2_schema_and_incremental_value_gate(self):
        packets = [_packet(metadata={"deployment_id": f"DEP_{i:03d}"}) for i in range(184)]
        candidates = self._candidates(EXPECTED_CANDIDATE_COUNT)
        # remap candidate ids to packet ids
        for i, c in enumerate(candidates):
            dep = f"DEP_{i:03d}"
            c["identity"]["deployment_id"] = dep
        payload = portfolio_stage2_payload(candidates, packets, {"batches": []})
        errors = validate_stage2_payload(payload)
        self.assertEqual(errors, [])
        self.assertEqual(len(payload["candidates"]), EXPECTED_CANDIDATE_COUNT)
        self.assertIn("deterministic_context", payload["candidates"][0])

    def test_compact_context_stable_keys(self):
        pkt = _packet()
        compact = compact_context_for_stage2(pkt)
        self.assertIn("health_summary", compact)
        self.assertIn("evidence_quality", compact)


if __name__ == "__main__":
    unittest.main()
