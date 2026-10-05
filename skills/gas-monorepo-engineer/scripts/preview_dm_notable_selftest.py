#!/usr/bin/env python3
"""Regression tests for Notable Active ∪ Complete eligible deployment preview logic."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from preview_dm_notable import (  # noqa: E402
    NOTABLE_SCENARIO_IDS,
    filter_notable_student_exclude,
    join_notable_peer_rows,
    merge_notable_eligible_deployments,
    notable_active_complete_fixture,
    notable_data_for_scenario,
    notable_short_id,
)


class TestNotableEligibleMerge(unittest.TestCase):
    def test_active_and_complete_resolve(self) -> None:
        active = [{"deploymentId": NOTABLE_SCENARIO_IDS["active_only"], "accountName": "A"}]
        complete = [{"deploymentId": NOTABLE_SCENARIO_IDS["complete_only"], "accountName": "B"}]
        merged, res = merge_notable_eligible_deployments(active, complete)
        ids = {notable_short_id(r["deploymentId"]) for r in merged}
        self.assertIn(notable_short_id(NOTABLE_SCENARIO_IDS["active_only"]), ids)
        self.assertIn(notable_short_id(NOTABLE_SCENARIO_IDS["complete_only"]), ids)
        self.assertEqual(res[notable_short_id(NOTABLE_SCENARIO_IDS["active_only"])], "active")
        self.assertEqual(res[notable_short_id(NOTABLE_SCENARIO_IDS["complete_only"])], "complete")

    def test_overlap_active_wins(self) -> None:
        dep_id = NOTABLE_SCENARIO_IDS["overlap"]
        active = [{"deploymentId": dep_id, "accountName": "Active Wins", "health": "Yellow"}]
        complete = [{"deploymentId": dep_id, "accountName": "Complete Loses", "health": "Red"}]
        merged, res = merge_notable_eligible_deployments(active, complete)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["health"], "Yellow")
        self.assertEqual(
            res[notable_short_id(dep_id)],
            "active_and_complete_overlap_active_wins",
        )

    def test_transition_same_id_after_active_removed(self) -> None:
        """Complete-only row still resolves the same Deployment ID."""
        dep_id = NOTABLE_SCENARIO_IDS["transition"]
        active: list[dict] = []
        complete = [{"deploymentId": dep_id, "accountName": "Test Customer Agency"}]
        merged, _ = merge_notable_eligible_deployments(active, complete)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["deploymentId"], dep_id)

    def test_complete_without_peer_not_in_notable_dto(self) -> None:
        active, complete_only, peer_specs = notable_active_complete_fixture()
        merged, _ = merge_notable_eligible_deployments(active, complete_only)
        notable = join_notable_peer_rows(peer_specs, merged)
        ids = {r["deploymentId"] for r in notable}
        self.assertNotIn(NOTABLE_SCENARIO_IDS["complete_no_peer"], ids)

    def test_unresolved_peer_excluded_from_join(self) -> None:
        active, complete_only, peer_specs = notable_active_complete_fixture()
        merged, _ = merge_notable_eligible_deployments(active, complete_only)
        notable = join_notable_peer_rows(peer_specs, merged)
        ids = {r["deploymentId"] for r in notable}
        self.assertNotIn(NOTABLE_SCENARIO_IDS["unresolved_peer"], ids)

    def test_duplicate_overlap_one_notable_row(self) -> None:
        active, complete_only, peer_specs = notable_active_complete_fixture()
        merged, _ = merge_notable_eligible_deployments(active, complete_only)
        notable = join_notable_peer_rows(peer_specs, merged)
        overlap_id = NOTABLE_SCENARIO_IDS["overlap"]
        overlap_rows = [r for r in notable if r["deploymentId"] == overlap_id]
        self.assertEqual(len(overlap_rows), 1)
        self.assertEqual(overlap_rows[0]["local"]["health"], "Yellow")

    def test_restricted_sort_and_latest_update_alias(self) -> None:
        notable = notable_data_for_scenario([], "notable-active-complete", app_id="SLG_DM")
        restricted = [r for r in notable if r["validationStatus"] == "Region Restricted"]
        self.assertTrue(restricted)
        if restricted:
            self.assertEqual(notable[-1]["validationStatus"], "Region Restricted")
        blank_latest = [r for r in notable if not str(r.get("latestUpdate") or "").strip()]
        self.assertTrue(blank_latest)

    def test_henp_student_excluded(self) -> None:
        active, complete_only, peer_specs = notable_active_complete_fixture()
        merged, _ = merge_notable_eligible_deployments(active, complete_only)
        student_ids = {NOTABLE_SCENARIO_IDS["student_excluded"]}
        filtered = filter_notable_student_exclude(merged, student_ids)
        self.assertFalse(
            any(r["deploymentId"] == NOTABLE_SCENARIO_IDS["student_excluded"] for r in filtered)
        )
        notable_henp = join_notable_peer_rows(peer_specs, merged, student_ids=student_ids)
        self.assertFalse(
            any(r["deploymentId"] == NOTABLE_SCENARIO_IDS["student_excluded"] for r in notable_henp)
        )

    def test_camel_case_dto_fields(self) -> None:
        notable = notable_data_for_scenario([], "notable-active-complete", app_id="HC_DM")
        self.assertTrue(notable)
        row = notable[0]
        for field in (
            "deploymentId",
            "accountName",
            "validationStatus",
            "latestUpdate",
            "notabilityTrigger",
            "peerRowIndex",
            "local",
        ):
            self.assertIn(field, row)
        self.assertIn("deploymentName", row["local"])


if __name__ == "__main__":
    unittest.main()
