#!/usr/bin/env python3
"""Deterministic tests for shared-library release planning (no GAS mutation)."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "scripts"))

from library_release.discover import (  # noqa: E402
    consumes_head,
    discover_consumers,
    has_production_deployment_id,
    manifest_fingerprint,
)
from library_release.plan import build_release_plan, plan_is_stale  # noqa: E402
from library_release.rollback import build_rollback_plan  # noqa: E402
from library_release.registry import load_preview_app_ids, load_registry  # noqa: E402


class TestHeadDetection(unittest.TestCase):
    def test_dev_mode_is_head(self):
        self.assertTrue(consumes_head("139", True))
        self.assertTrue(consumes_head("0", True))

    def test_version_zero_is_head(self):
        self.assertTrue(consumes_head("0", False))

    def test_pinned_not_head(self):
        self.assertFalse(consumes_head("139", False))


class TestDiscovery(unittest.TestCase):
    def test_depmngr_consumers_discovered(self):
        registry = load_registry(REPO)
        dep = registry["DepMngr"]
        preview = load_preview_app_ids(REPO)
        consumers = discover_consumers(
            REPO, dep["userSymbol"], dep["consumerDirPattern"], preview
        )
        app_ids = {c.app_id for c in consumers}
        self.assertIn("SLG_DM", app_ids)
        self.assertIn("HC_DM", app_ids)
        self.assertEqual(len(consumers), 6)

    def test_pin_extraction(self):
        registry = load_registry(REPO)
        dep = registry["DepMngr"]
        consumers = discover_consumers(REPO, dep["userSymbol"], dep["consumerDirPattern"])
        slg = next(c for c in consumers if c.app_id == "SLG_DM")
        self.assertEqual(slg.version, "162")
        self.assertFalse(slg.consumes_head)
        hc = next(c for c in consumers if c.app_id == "HC_DM")
        self.assertEqual(hc.version, "162")
        self.assertFalse(hc.consumes_head)

    def test_golives_consumers(self):
        registry = load_registry(REPO)
        gl = registry["GoLives"]
        consumers = discover_consumers(REPO, gl["userSymbol"], gl["consumerDirPattern"])
        self.assertEqual(len(consumers), 3)


class TestProductionDeploymentId(unittest.TestCase):
    def test_slg_dm_has_prod_id(self):
        cfg = {
            "deployment": {
                "production": {
                    "deploymentId": "AKfycby-example",
                }
            }
        }
        self.assertTrue(has_production_deployment_id(cfg))

    def test_missing(self):
        self.assertFalse(has_production_deployment_id({}))


class TestPlanInvalidation(unittest.TestCase):
    def test_stale_when_sha_changes(self):
        a = {"planFingerprint": {"gitSha": "aaa", "manifestFingerprint": "m1"}}
        b = {"planFingerprint": {"gitSha": "bbb", "manifestFingerprint": "m1"}}
        self.assertTrue(plan_is_stale(a, b))

    def test_fresh_when_unchanged(self):
        fp = {"gitSha": "aaa", "manifestFingerprint": "m1"}
        a = {"planFingerprint": fp}
        b = {"planFingerprint": dict(fp)}
        self.assertFalse(plan_is_stale(a, b))


class TestBlastRadius(unittest.TestCase):
    def test_head_blast_radius_in_plan(self):
        plan = build_release_plan(REPO, "DepMngr")
        head = plan["headBlastRadius"]["immediateOnLibraryPush"]
        self.assertEqual(head, [])


class TestRollbackPlan(unittest.TestCase):
    def test_head_consumer_complication(self):
        registry = load_registry(REPO)
        dep = registry["DepMngr"]
        consumers = discover_consumers(REPO, dep["userSymbol"], dep["consumerDirPattern"])
        pins = {
            c.app_id: {"version": c.version, "developmentMode": c.development_mode}
            for c in consumers
        }
        rb = build_rollback_plan("DepMngr", consumers, "155", pins, ["SLG_DM"])
        self.assertEqual(rb["strategy"], "forward_git_repoint_production")
        head_entries = [x for x in rb["perConsumer"] if x.get("wasHead")]
        self.assertEqual(head_entries, [])


class TestManifestFingerprint(unittest.TestCase):
    def test_stable(self):
        registry = load_registry(REPO)
        dep = registry["DepMngr"]
        c1 = discover_consumers(REPO, dep["userSymbol"], dep["consumerDirPattern"])
        c2 = discover_consumers(REPO, dep["userSymbol"], dep["consumerDirPattern"])
        self.assertEqual(manifest_fingerprint(c1), manifest_fingerprint(c2))


class TestNotablePlan(unittest.TestCase):
    def test_notable_context(self):
        plan = build_release_plan(
            REPO,
            "DepMngr",
            release_description="Notable dry run",
            feature_tags=["notable"],
        )
        notable = plan["validation"]["notable"]
        self.assertIn("SLG_DM", notable["appsWithNotableTabExposed"])
        self.assertIn("EVI_DM", notable["appsWithNotableDisabledInConfig"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
