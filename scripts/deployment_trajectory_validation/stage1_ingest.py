"""Parse and normalize Stage-1 Sana portfolio pilot outputs (no LLM)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

CANDIDATE_SCHEMA_VERSION = "deployment-signal-candidate-v1"
EXPECTED_CANDIDATE_COUNT = 17

DEPLOYMENT_ID_RE = re.compile(r"\b(a0r[a-zA-Z0-9]{12,18})\b")

FIELD_ALIASES = {
    "attention": "Attention",
    "signal type": "Signal Type",
    "signal_type": "Signal Type",
    "category": "Signal Type",
    "observation": "Observation",
    "historical evidence": "Historical Evidence",
    "interpretation": "Interpretation",
    "why this matters": "Why This Matters",
    "leadership question": "Leadership Question",
    "confidence": "Confidence",
    "evidence limitations": "Evidence Limitations",
    "deployment": "Deployment",
}

ATTENTION_MAP = {
    "high": "HIGH",
    "watch": "WATCH",
    "informational": "INFORMATIONAL",
    "positive": "POSITIVE",
    "emerging": "WATCH",
    "leadership attention": "HIGH",
}

CONFIDENCE_MAP = {
    "high": "HIGH",
    "medium": "MEDIUM",
    "low": "LOW",
}


class Stage1IngestError(Exception):
    """Raised when Stage-1 source artifacts fail validation."""


@dataclass
class ParsedStage1Block:
    """One deployment block from a Stage-1 batch output."""

    raw_text: str
    is_signal: bool
    fields: Dict[str, str] = field(default_factory=dict)
    deployment_id: str = ""
    deployment_label: str = ""
    batch_id: str = ""
    position_in_batch: int = 0


def _normalize_enum_token(value: str, mapping: Dict[str, str]) -> Tuple[str, str]:
    raw = (value or "").strip()
    if not raw:
        return "", ""
    key = re.sub(r"[^a-z]+", " ", raw.lower()).strip()
    norm = mapping.get(key)
    if norm:
        return norm, raw
    upper = re.sub(r"[\s\-/]+", "_", raw.upper()).strip("_")
    return upper, raw


def normalize_attention(value: str) -> Tuple[str, str]:
    return _normalize_enum_token(value, ATTENTION_MAP)


def normalize_confidence(value: str) -> Tuple[str, str]:
    return _normalize_enum_token(value, CONFIDENCE_MAP)


def normalize_signal_type(value: str) -> Tuple[str, str]:
    raw = (value or "").strip()
    if not raw:
        return "", ""
    norm = re.sub(r"[\s\-/]+", "_", raw.upper()).strip("_")
    return norm, raw


def _split_stage1_blocks(text: str) -> List[str]:
    """Split Sana output into per-deployment sections."""
    text = text.replace("\r\n", "\n")
    markers = [
        r"(?=\n(?:Deployment|DEPLOYMENT)\s*[:\n])",
        r"(?=\n(?:NO_SIGNAL|NO SIGNAL)\b)",
        r"(?=\n#{1,3}\s*(?:Deployment|NO_SIGNAL))",
    ]
    parts: List[str] = []
    for marker in markers:
        chunks = re.split(marker, text, flags=re.IGNORECASE)
        if len(chunks) > 1:
            parts = [c.strip() for c in chunks if c.strip()]
            break
    if not parts:
        parts = [text.strip()] if text.strip() else []
    return parts


def _parse_field_block(block: str) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    lines = block.split("\n")
    current_key: Optional[str] = None
    buf: List[str] = []

    def flush() -> None:
        nonlocal current_key, buf
        if current_key:
            fields[current_key] = "\n".join(buf).strip()
        buf = []

    for line in lines:
        m = re.match(r"^([A-Za-z][A-Za-z /_]+)\s*:\s*(.*)$", line.strip())
        if m:
            flush()
            label = m.group(1).strip().lower()
            canonical = FIELD_ALIASES.get(label, m.group(1).strip())
            current_key = canonical
            rest = m.group(2).strip()
            if rest:
                buf.append(rest)
            continue
        if current_key and line.strip():
            buf.append(line.rstrip())
    flush()
    return fields


def _extract_deployment_identity(block: str, fields: Dict[str, str]) -> Tuple[str, str]:
    dep_field = fields.get("Deployment", "")
    ids = DEPLOYMENT_ID_RE.findall(block)
    dep_id = ids[0] if ids else ""
    label = dep_field.strip()
    if not label and dep_id:
        label = dep_id
    if label and dep_id and dep_id in label:
        label = label.replace(dep_id, "").strip(" -—\n")
    return dep_id, label


def parse_stage1_batch_text(
    text: str, batch_id: str, expected_no_signal_only: bool = False
) -> List[ParsedStage1Block]:
    blocks = _split_stage1_blocks(text)
    parsed: List[ParsedStage1Block] = []
    for idx, block in enumerate(blocks):
        upper = block.upper()
        is_no = bool(re.search(r"\bNO[_\s-]?SIGNAL\b", upper)) and "SIGNAL TYPE" not in upper
        if is_no and not re.search(r"\bATTENTION\s*:", block, re.I):
            if expected_no_signal_only:
                continue
            parsed.append(
                ParsedStage1Block(
                    raw_text=block,
                    is_signal=False,
                    batch_id=batch_id,
                    position_in_batch=idx + 1,
                )
            )
            continue
        fields = _parse_field_block(block)
        if not fields.get("Observation") and not fields.get("Signal Type") and is_no:
            continue
        dep_id, label = _extract_deployment_identity(block, fields)
        is_signal = bool(fields.get("Signal Type") or fields.get("Observation")) and not is_no
        if re.search(r"\bNO[_\s-]?SIGNAL\b", upper) and not is_signal:
            parsed.append(
                ParsedStage1Block(
                    raw_text=block,
                    is_signal=False,
                    fields=fields,
                    deployment_id=dep_id,
                    deployment_label=label,
                    batch_id=batch_id,
                    position_in_batch=idx + 1,
                )
            )
            continue
        parsed.append(
            ParsedStage1Block(
                raw_text=block,
                is_signal=True,
                fields=fields,
                deployment_id=dep_id,
                deployment_label=label,
                batch_id=batch_id,
                position_in_batch=idx + 1,
            )
        )
    return parsed


def _label_index(packets_by_id: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for dep_id, pkt in packets_by_id.items():
        label = str((pkt.get("metadata") or {}).get("deployment_label") or "").strip().lower()
        if label:
            out[label] = dep_id
    return out


def resolve_deployment_id(
    block: ParsedStage1Block, packets_by_id: Dict[str, Dict[str, Any]]
) -> str:
    if block.deployment_id and block.deployment_id in packets_by_id:
        return block.deployment_id
    label_index = _label_index(packets_by_id)
    label = (block.deployment_label or block.fields.get("Deployment", "")).strip().lower()
    if label in label_index:
        return label_index[label]
    for known_label, dep_id in label_index.items():
        if known_label and (known_label in label or label in known_label):
            return dep_id
    return block.deployment_id


def build_normalized_candidate(
    block: ParsedStage1Block,
    dep_id: str,
    context_ref: str,
    checksum: str,
) -> Dict[str, Any]:
    fields = block.fields
    att_norm, att_raw = normalize_attention(fields.get("Attention", ""))
    conf_norm, conf_raw = normalize_confidence(fields.get("Confidence", ""))
    type_norm, type_raw = normalize_signal_type(fields.get("Signal Type", ""))
    return {
        "schema_version": CANDIDATE_SCHEMA_VERSION,
        "identity": {
            "deployment_id": dep_id,
            "context_packet_ref": context_ref,
            "stage1_batch": block.batch_id,
            "stage1_position": block.position_in_batch,
            "source_checksum": checksum,
        },
        "stage1_assessment": {
            "attention": att_norm,
            "attention_raw": att_raw,
            "signal_type": type_norm,
            "signal_type_raw": type_raw,
            "observation": fields.get("Observation", ""),
            "historical_evidence": fields.get("Historical Evidence", ""),
            "interpretation": fields.get("Interpretation", ""),
            "why_this_matters": fields.get("Why This Matters", ""),
            "leadership_question": fields.get("Leadership Question", ""),
            "confidence": conf_norm,
            "confidence_raw": conf_raw,
            "evidence_limitations": fields.get("Evidence Limitations", ""),
        },
        "stage1_raw_text": block.raw_text,
    }


def ingest_stage1_directory(
    stage1_dir: Path,
    packets_by_id: Dict[str, Dict[str, Any]],
    expected_count: int = EXPECTED_CANDIDATE_COUNT,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not stage1_dir.is_dir():
        raise Stage1IngestError(f"Stage-1 directory missing: {stage1_dir}")

    paths = sorted(stage1_dir.glob("*.txt"))
    paths = [
        p
        for p in paths
        if "readme" not in p.name.lower()
        and "place" not in p.name.lower()
        and p.name.lower().startswith("sana-batch")
    ]
    if not paths:
        raise Stage1IngestError(
            f"No Stage-1 batch outputs in {stage1_dir}. "
            "Expected sana-batch-01-output.txt, sana-batch-02-output.txt, sana-batch-03-output.txt"
        )

    all_candidates: List[Dict[str, Any]] = []
    manifest_batches: List[Dict[str, Any]] = []
    seen_ids: Dict[str, Dict[str, Any]] = {}

    for path in paths:
        text = path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(text.encode("utf-8")).hexdigest()
        batch_id = path.stem
        blocks = parse_stage1_batch_text(text, batch_id)
        signal_blocks = [b for b in blocks if b.is_signal]
        manifest_batches.append(
            {
                "path": str(path),
                "sha256": checksum,
                "blocks_parsed": len(blocks),
                "signals_in_batch": len(signal_blocks),
            }
        )
        for block in signal_blocks:
            dep_id = resolve_deployment_id(block, packets_by_id)
            if not dep_id or dep_id not in packets_by_id:
                raise Stage1IngestError(
                    f"Stage-1 candidate cannot be linked to context packet "
                    f"(batch={batch_id}, position={block.position_in_batch}, label={block.deployment_label!r})"
                )
            if dep_id in seen_ids:
                raise Stage1IngestError(
                    f"Duplicate Stage-1 candidate deployment_id {dep_id} "
                    f"({batch_id} conflicts with {seen_ids[dep_id]['batch']})"
                )
            context_ref = f"context-packets/by-deployment/{dep_id}.json"
            cand = build_normalized_candidate(block, dep_id, context_ref, checksum)
            all_candidates.append(cand)
            seen_ids[dep_id] = {"batch": batch_id, "position": block.position_in_batch}

    if len(all_candidates) != expected_count:
        raise Stage1IngestError(
            f"Expected {expected_count} unique Stage-1 candidate Signals; parsed {len(all_candidates)}"
        )

    all_candidates.sort(key=lambda c: c["identity"]["deployment_id"])
    manifest = {
        "schema_version": CANDIDATE_SCHEMA_VERSION,
        "expected_candidates": expected_count,
        "parsed_candidates": len(all_candidates),
        "batches": manifest_batches,
    }
    return all_candidates, manifest


def discover_default_stage1_paths(exports_dir: Path) -> List[Path]:
    stage1 = exports_dir / "stage1"
    names = [
        "sana-batch-01-output.txt",
        "sana-batch-02-output.txt",
        "sana-batch-03-output.txt",
    ]
    return [stage1 / n for n in names]
