"""Deterministic rollback plan generation for shared-library releases."""

from __future__ import annotations

from typing import Any

from .discover import ConsumerPin


def build_rollback_plan(
    library_key: str,
    consumers: list[ConsumerPin],
    prior_gas_version: str | None,
    pins_before: dict[str, dict[str, Any]] | None,
    head_consumers_before_release: list[str],
) -> dict[str, Any]:
    """
    Default rollback restores production consumers to prior immutable library version
    without rewriting Git history.
    """
    pinned_rollback: list[dict[str, Any]] = []
    for c in consumers:
        before = (pins_before or {}).get(c.app_id)
        if not before:
            continue
        if c.consumes_head:
            pinned_rollback.append(
                {
                    "appId": c.app_id,
                    "action": "no_pin_rollback_needed_for_head_consumer",
                    "note": (
                        "Consumer was on HEAD at release time; rollback is ambiguous — "
                        "repoint production deployment and/or cut library version, "
                        "then optionally pin to prior immutable version with developmentMode false."
                    ),
                    "wasHead": True,
                }
            )
        else:
            pinned_rollback.append(
                {
                    "appId": c.app_id,
                    "action": "revert_appsscript_pin",
                    "targetVersion": str(before.get("version", "")),
                    "targetDevelopmentMode": bool(before.get("developmentMode", False)),
                    "then": [
                        "clasp push consumer (authorized)",
                        "redeploy production deploymentId from gas.config.json (authorized)",
                    ],
                }
            )

    return {
        "library": library_key,
        "strategy": "forward_git_repoint_production",
        "priorImmutableLibraryVersion": prior_gas_version,
        "steps": [
            "Do not rewrite Git history by default.",
            "If release cut new GAS library version N: production consumers should pin to N-1 (or last known good from ledger).",
            "For each consumer with production deploymentId: authorized clasp deploy to prior known-good GAS *app* version (consumer script), after manifest pin rollback if needed.",
            "Library HEAD remains forward unless separately authorized to push older source.",
        ],
        "headConsumerComplications": {
            "consumersOnHeadBeforeRelease": head_consumers_before_release,
            "guidance": (
                "HEAD consumers already tracked live library HEAD; immutable version rollback "
                "does not automatically undo their runtime until pins are set to a numbered version "
                "with developmentMode false and consumer push/deploy completes."
            ),
        },
        "perConsumer": pinned_rollback,
    }
