"""Build read-only shared-library release plans."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .discover import ConsumerPin, discover_consumers, manifest_fingerprint
from .git_util import git_changed_files_since, git_log_oneline_for_paths, git_rev_parse
from .ledger import last_release_record
from .rollback import build_rollback_plan
from .registry import get_library_config, load_preview_app_ids, load_registry
from .schema import PLAN_SCHEMA_VERSION


def _max_numeric_pin(consumers: list[ConsumerPin]) -> int | None:
    nums: list[int] = []
    for c in consumers:
        try:
            v = int(str(c.version).strip())
            if v > 0:
                nums.append(v)
        except ValueError:
            continue
    return max(nums) if nums else None


def propose_next_gas_version(
    consumers: list[ConsumerPin], last_ledger_version: str | None
) -> dict[str, Any]:
    max_pin = _max_numeric_pin(consumers)
    ledger_num: int | None = None
    if last_ledger_version:
        try:
            ledger_num = int(str(last_ledger_version).strip())
        except ValueError:
            ledger_num = None

    basis = ledger_num if ledger_num is not None else max_pin
    if basis is None:
        return {
            "proposed": None,
            "basis": "unknown",
            "note": "No numeric consumer pins and no ledger record; run clasp version only after manual confirmation of current GAS library version.",
        }
    proposed = basis + 1
    if max_pin is not None and proposed <= max_pin:
        proposed = max_pin + 1
    return {
        "proposed": str(proposed),
        "basis": "ledger_last" if ledger_num is not None else "max_consumer_pin",
        "maxConsumerPin": str(max_pin) if max_pin is not None else None,
        "note": "Proposal only; confirm against live clasp library versions before cutting.",
    }


def consumers_needing_pin_bump(
    consumers: list[ConsumerPin], proposed_version: str | None
) -> list[dict[str, Any]]:
    if not proposed_version:
        return []
    out: list[dict[str, Any]] = []
    for c in consumers:
        if c.consumes_head:
            out.append(
                {
                    "appId": c.app_id,
                    "reason": "on_HEAD_already_receives_library_HEAD_after_push",
                    "currentPin": {"version": c.version, "developmentMode": c.development_mode},
                    "proposedPin": {
                        "version": proposed_version,
                        "developmentMode": False,
                        "optional": "recommended_to_exit_HEAD_after_release",
                    },
                }
            )
            continue
        try:
            current = int(str(c.version).strip())
            target = int(proposed_version)
        except ValueError:
            continue
        if current < target:
            out.append(
                {
                    "appId": c.app_id,
                    "reason": "pinned_below_proposed_release",
                    "currentPin": {"version": c.version, "developmentMode": c.development_mode},
                    "proposedPin": {"version": proposed_version, "developmentMode": False},
                }
            )
    return out


def production_deployments_required(
    consumers: list[ConsumerPin],
    pin_bumps: list[dict[str, Any]],
    feature_context: str | None,
) -> list[dict[str, Any]]:
    """
    Consumers needing production deploy when their *solution* source or pins change.
    Pinned apps below new library version need pin + push + deploy to pick up library code.
    """
    bump_ids = {p["appId"] for p in pin_bumps if p.get("reason") == "pinned_below_proposed_release"}
    out: list[dict[str, Any]] = []
    for c in consumers:
        if c.app_id in bump_ids and c.has_production_deployment_id:
            out.append(
                {
                    "appId": c.app_id,
                    "why": "manifest_pin_bump_requires_consumer_push_and_production_deploy",
                    "hasProductionDeploymentId": True,
                }
            )
    return out


def build_release_plan(
    repo_root: Path | str,
    library_key: str,
    release_description: str | None = None,
    feature_tags: list[str] | None = None,
) -> dict[str, Any]:
    repo_root = Path(repo_root)
    registry = load_registry(repo_root)
    lib_cfg = get_library_config(registry, library_key)
    normalized_key = library_key
    for k, v in registry.items():
        if v == lib_cfg:
            normalized_key = k
            break
    library_key = normalized_key

    preview_ids = load_preview_app_ids(repo_root)
    consumers = discover_consumers(
        repo_root,
        lib_cfg["userSymbol"],
        lib_cfg["consumerDirPattern"],
        preview_ids,
    )

    git_sha = git_rev_parse(repo_root, "HEAD")
    lib_path = lib_cfg["path"]
    ledger_path = lib_cfg.get("ledgerPath", "")
    last_rec = last_release_record(repo_root, ledger_path) if ledger_path else None
    since_sha = last_rec.get("gitSha") if last_rec else None
    changed_files = git_changed_files_since(repo_root, since_sha, f"{lib_path}/")
    recent_commits = git_log_oneline_for_paths(repo_root, f"{lib_path}/")

    head_consumers = [c.app_id for c in consumers if c.consumes_head]
    proposed = propose_next_gas_version(
        consumers, str(last_rec.get("gasVersion")) if last_rec else None
    )
    pin_bumps = consumers_needing_pin_bump(consumers, proposed.get("proposed"))
    prod_deploys = production_deployments_required(consumers, pin_bumps, None)

    pins_before = {
        c.app_id: {"version": c.version, "developmentMode": c.development_mode}
        for c in consumers
    }

    rollback = build_rollback_plan(
        library_key,
        consumers,
        str(last_rec.get("gasVersion")) if last_rec else None,
        pins_before,
        head_consumers,
    )

    blockers: list[str] = []
    if head_consumers:
        blockers.append(
            f"HEAD consumers ({', '.join(head_consumers)}): library clasp push is production-impacting immediately."
        )
    if proposed.get("proposed") is None:
        blockers.append("Cannot propose next GAS version automatically.")

    validation = {
        "previewCapableConsumers": [c.app_id for c in consumers if c.preview_capable],
        "selftestScripts": lib_cfg.get("validation", {}).get("selftestScripts", []),
        "pinStrategyDoc": lib_cfg.get("pinStrategyDoc"),
    }

    if feature_tags and "notable" in [t.lower() for t in feature_tags]:
        validation["notable"] = {
            "appsWithNotableTabExposed": [
                c.app_id for c in consumers if c.notable_tab_exposed is True
            ],
            "appsWithNotableDisabledInConfig": [
                c.app_id for c in consumers if c.notable_tab_exposed is False
            ],
            "previewAcceptedNote": "User reported Notable visual acceptance; no deploy authorized by this plan.",
        }
        # Pinned consumers don't get Notable until pin bump + deploy
        validation["notable"]["pinnedConsumersNeedingBumpForNotable"] = [
            p["appId"]
            for p in pin_bumps
            if p.get("reason") == "pinned_below_proposed_release"
        ]

    plan = {
        "planSchemaVersion": PLAN_SCHEMA_VERSION,
        "mode": "READ_ONLY",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "planFingerprint": {
            "gitSha": git_sha,
            "manifestFingerprint": manifest_fingerprint(consumers),
            "libraryPath": lib_path,
        },
        "invalidation": {
            "rule": "Plan is stale if gitSha or manifestFingerprint differs at execute time.",
            "executeAuthorizationExample": f"Execute the {library_key} release plan.",
        },
        "library": library_key,
        "libraryPath": lib_path,
        "userSymbol": lib_cfg["userSymbol"],
        "gitSha": git_sha,
        "releaseDescription": release_description,
        "changedLibraryFilesSinceLastLedgerRelease": changed_files,
        "changedFilesIndeterminate": changed_files is None,
        "recentLibraryCommits": recent_commits,
        "lastLedgerRelease": last_rec,
        "consumers": [
            {
                "appId": c.app_id,
                "projectPath": c.project_path,
                "libraryId": c.library_id,
                "version": c.version,
                "developmentMode": c.development_mode,
                "consumesHead": c.consumes_head,
                "hasProductionDeploymentId": c.has_production_deployment_id,
                "previewCapable": c.preview_capable,
                "notableTabExposed": c.notable_tab_exposed,
            }
            for c in consumers
        ],
        "headBlastRadius": {
            "immediateOnLibraryPush": head_consumers,
            "policy": "Treat libraries/ push as production-impacting while any consumer uses HEAD.",
        },
        "proposedNextGasVersion": proposed,
        "consumersProposedForPinUpdate": pin_bumps,
        "productionDeploymentsRequired": prod_deploys,
        "validation": validation,
        "rollback": rollback,
        "blockers": blockers,
        "executeWorkflow": [
            "1. Jeff authorizes this exact plan in the current interaction.",
            "2. Re-run plan; abort if planFingerprint changed.",
            "3. Authorized clasp push library HEAD (if not already).",
            "4. npm run version in library with description.",
            "5. Update consumer appsscript.json pins per proposed list.",
            "6. clasp push each affected consumer.",
            "7. Authorized production deploy per consumer gas.config.json deploymentId.",
            "8. Verification + append .ai/library-releases/*.jsonl.",
        ],
    }
    return plan


def format_plan_text(plan: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"=== {plan['library']} RELEASE PLAN (READ-ONLY) ===")
    lines.append(f"Generated: {plan['generatedAt']}")
    lines.append(f"Git SHA: {plan['gitSha']}")
    lines.append(f"Fingerprint: manifest={plan['planFingerprint']['manifestFingerprint']}")
    if plan.get("releaseDescription"):
        lines.append(f"Description: {plan['releaseDescription']}")
    lines.append("")

    lines.append("--- Consumers ---")
    for c in plan["consumers"]:
        head = "HEAD" if c["consumesHead"] else "pinned"
        prod = "prodId=yes" if c["hasProductionDeploymentId"] else "prodId=no"
        prev = "preview=yes" if c["previewCapable"] else "preview=no"
        notable = ""
        if c.get("notableTabExposed") is not None:
            notable = f" notableTab={'yes' if c['notableTabExposed'] else 'no'}"
        lines.append(
            f"  {c['appId']}: v{c['version']} devMode={c['developmentMode']} ({head}) {prod} {prev}{notable}"
        )

    lines.append("")
    lines.append("--- HEAD blast radius (immediate on library push) ---")
    for app in plan["headBlastRadius"]["immediateOnLibraryPush"]:
        lines.append(f"  {app}")
    if not plan["headBlastRadius"]["immediateOnLibraryPush"]:
        lines.append("  (none)")

    lines.append("")
    lines.append("--- Proposed next immutable library version ---")
    prop = plan["proposedNextGasVersion"]
    lines.append(f"  proposed={prop.get('proposed')} basis={prop.get('basis')} ({prop.get('note')})")

    lines.append("")
    lines.append("--- Consumers proposed for pin update ---")
    for p in plan["consumersProposedForPinUpdate"]:
        lines.append(f"  {p['appId']}: {p['reason']} -> {p.get('proposedPin')}")

    lines.append("")
    lines.append("--- Production deployments required ---")
    for d in plan["productionDeploymentsRequired"]:
        lines.append(f"  {d['appId']}: {d['why']}")
    if not plan["productionDeploymentsRequired"]:
        lines.append("  (none for pin-only library release graph)")

    ch = plan.get("changedLibraryFilesSinceLastLedgerRelease")
    lines.append("")
    lines.append("--- Changed library files since last ledger release ---")
    if plan.get("changedFilesIndeterminate"):
        lines.append("  (indeterminate - no ledger baseline)")
    elif ch:
        for f in ch:
            lines.append(f"  {f}")
    else:
        lines.append("  (none vs ledger baseline)")

    if plan.get("recentLibraryCommits"):
        lines.append("")
        lines.append("--- Recent library commits ---")
        for c in plan["recentLibraryCommits"]:
            lines.append(f"  {c}")

    val = plan.get("validation") or {}
    if val.get("notable"):
        n = val["notable"]
        lines.append("")
        lines.append("--- Notable feature context ---")
        lines.append(f"  Tab exposed: {', '.join(n.get('appsWithNotableTabExposed', [])) or '(none)'}")
        lines.append(f"  Disabled in config: {', '.join(n.get('appsWithNotableDisabledInConfig', [])) or '(none)'}")
        lines.append(
            f"  Pinned consumers needing bump for Notable: {', '.join(n.get('pinnedConsumersNeedingBumpForNotable', [])) or '(none)'}"
        )

    lines.append("")
    lines.append("--- Blockers / gates ---")
    for b in plan.get("blockers") or []:
        lines.append(f"  ! {b}")
    lines.append(f"  Authorization: {plan['invalidation']['executeAuthorizationExample']}")

    lines.append("")
    lines.append("--- Rollback (summary) ---")
    lines.append(f"  {plan['rollback']['strategy']}")
    lines.append(f"  priorImmutableLibraryVersion={plan['rollback'].get('priorImmutableLibraryVersion')}")

    return "\n".join(lines)


def plan_is_stale(stored: dict[str, Any], current: dict[str, Any]) -> bool:
    a = stored.get("planFingerprint") or {}
    b = current.get("planFingerprint") or {}
    return a.get("gitSha") != b.get("gitSha") or a.get("manifestFingerprint") != b.get(
        "manifestFingerprint"
    )
