"""Offline portfolio pilot harness — prepares Sana input without calling any LLM."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .context_assembler import SCHEMA_VERSION

ANALYSIS_REQUEST = """PORTFOLIO ANALYSIS REQUEST
You are evaluating a batch of deployment context packets from the Services Signal Platform pilot.

For each deployment, determine whether the evidence warrants a current leadership Signal using the structured output contract (Deployment, Attention, Signal Type, Observation, Historical Evidence, Interpretation, Why This Matters, Leadership Question, Confidence, Evidence Limitations) or NO_SIGNAL.

Distinguish recent conditions from historical conditions.
Do not assume Green means no Signal.
Do not assume historical volatility means current deterioration.
Do not assume intervention means deterioration or successful mitigation.
Use only supplied evidence. Do not infer unavailable evidence.

If evidence supports only three Signals across the portfolio, return three.
If evidence supports none, return none.

After per-deployment evaluation, provide portfolio-level attention compression summary fields:
portfolio evaluated, Signals surfaced, no current Signal, Leadership Attention, Watch/Emerging, Improving/Stabilizing, Informational."""

REDACTION_PATTERNS = [
    re.compile(r"\b[a-zA-Z0-9._%+-]+@workday\.com\b", re.I),
    re.compile(r"\b00D[a-zA-Z0-9]{12,15}\b"),
]


def validate_packet_schema(packet: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    if packet.get("schema_version") != SCHEMA_VERSION:
        errors.append("schema_version")
    for key in ("metadata", "current_state", "health_trajectory", "schedule_trajectory", "evidence_quality"):
        if key not in packet:
            errors.append(f"missing:{key}")
    return errors


def privacy_scan_text(text: str) -> List[str]:
    hits: List[str] = []
    for pat in REDACTION_PATTERNS:
        if pat.search(text):
            hits.append(pat.pattern)
    return hits


def stable_batch_packets(
    packets: List[Dict[str, Any]], max_batch_bytes: int = 450_000
) -> List[List[Dict[str, Any]]]:
    """Deterministic size-based batching with stable deployment_id ordering."""
    ordered = sorted(packets, key=lambda p: str(p.get("metadata", {}).get("deployment_id", "")))
    batches: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    current_size = 0
    for pkt in ordered:
        size = len(json.dumps(pkt, ensure_ascii=False).encode("utf-8"))
        if current and current_size + size > max_batch_bytes:
            batches.append(current)
            current = []
            current_size = 0
        current.append(pkt)
        current_size += size
    if current:
        batches.append(current)
    return batches


def render_batch_payload(packets: List[Dict[str, Any]], batch_index: int, batch_total: int) -> str:
    lines = [
        "SANA DEPLOYMENT SIGNALS PILOT — PORTFOLIO CONTEXT BATCH",
        f"Batch: {batch_index + 1} of {batch_total}",
        f"Schema: {SCHEMA_VERSION}",
        f"Deployments in batch: {len(packets)}",
        "",
        "DEPLOYMENT CONTEXTS (JSON)",
        "-------------------------",
        json.dumps(packets, indent=2, ensure_ascii=False),
        "",
        ANALYSIS_REQUEST,
        "",
    ]
    return "\n".join(lines)


def write_portfolio_artifacts(
    out_dir: Path,
    packets: List[Dict[str, Any]],
    max_batch_bytes: int = 450_000,
) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    schema_errors = []
    for pkt in packets:
        schema_errors.extend(validate_packet_schema(pkt))

    batches = stable_batch_packets(packets, max_batch_bytes)
    paths: List[str] = []
    checksums: Dict[str, str] = {}

    if len(batches) == 1:
        text = render_batch_payload(batches[0], 0, 1)
        main = out_dir / "sana-portfolio-pilot-input.txt"
        main.write_text(text, encoding="utf-8")
        paths.append(str(main))
        checksums[main.name] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    else:
        for i, batch in enumerate(batches):
            text = render_batch_payload(batch, i, len(batches))
            path = out_dir / f"sana-portfolio-pilot-input-batch-{i + 1:02d}.txt"
            path.write_text(text, encoding="utf-8")
            paths.append(str(path))
            checksums[path.name] = hashlib.sha256(text.encode("utf-8")).hexdigest()

    privacy_hits: List[str] = []
    for p in paths:
        privacy_hits.extend(privacy_scan_text(Path(p).read_text(encoding="utf-8")))

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "packet_count": len(packets),
        "batch_count": len(batches),
        "artifact_paths": paths,
        "sha256": checksums,
        "schema_validation_error_count": len(schema_errors),
        "privacy_pattern_hits": list(set(privacy_hits)),
        "batching_strategy": {
            "stage_1": "Evaluate deterministic batches for candidate per-deployment Signals.",
            "stage_2": (
                "Provide normalized Stage-1 candidates together for portfolio-level "
                "prioritization via deployment-signal-stage2-harness.py."
            ),
            "max_batch_bytes": max_batch_bytes,
        },
    }
    manifest_path = out_dir / "sana-portfolio-pilot-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
