"""Parse and normalize Stage-1 Sana portfolio pilot outputs (no LLM)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

CANDIDATE_SCHEMA_VERSION = "deployment-signal-candidate-v1"
EXPECTED_CANDIDATE_COUNT = 17

STAGE1_CUMULATIVE_FILENAME = "Sana.txt"

REPORT_01_ID = "REPORT_01_BATCH_1"
REPORT_02_ID = "REPORT_02_BATCHES_1_2"
REPORT_03_ID = "REPORT_03_FULL_PORTFOLIO"

REPORT_HEADER_RE = re.compile(
    r"^Deployment Signals Pilot — (Portfolio Report|Updated Portfolio Report|Final Portfolio Report)",
    re.MULTILINE | re.IGNORECASE,
)

PORTFOLIO_STATS_RE = re.compile(
    r"Portfolio evaluated:\s*(\d+)\s*deployments?\s*analyzed\s*"
    r"(?:\([^)]*\)\s*)?"
    r"Signals surfaced:\s*(\d+)\s*"
    r"No current Signal:\s*(\d+)",
    re.IGNORECASE,
)

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

CONFLICT_FIELDS = (
    "attention",
    "signal_type",
    "observation",
    "interpretation",
    "why_this_matters",
    "leadership_question",
    "confidence",
    "evidence_limitations",
)


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
    source_report_id: str = ""
    summary_only: bool = False


@dataclass
class LogicalStage1Report:
    """One cumulative portfolio report inside a combined Sana export."""

    report_id: str
    text: str
    portfolio_evaluated: int = 0
    signals_surfaced: int = 0
    no_signal: int = 0


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
    # Strip parenthetical qualifiers for enum, keep raw
    base = re.split(r"\s*\(", raw, maxsplit=1)[0].strip()
    norm = re.sub(r"[\s\-/]+", "_", base.upper()).strip("_")
    return norm, raw


def _compare_text(a: str, b: str) -> bool:
    """Return True if texts are materially the same (minor formatting OK)."""
    def norm(s: str) -> str:
        s = re.sub(r"\s+", " ", (s or "").strip().lower())
        s = re.sub(r"[^\w\s]", "", s)
        return s

    na, nb = norm(a), norm(b)
    if na == nb:
        return True
    if not na or not nb:
        return na == nb
    if na in nb or nb in na:
        return True
    # Token overlap heuristic for abbreviated carry-forward lines
    ta, tb = set(na.split()), set(nb.split())
    if not ta or not tb:
        return False
    overlap = len(ta & tb) / max(len(ta), len(tb))
    return overlap >= 0.85


def _assessment_snapshot(fields: Dict[str, str]) -> Dict[str, str]:
    att, _ = normalize_attention(fields.get("Attention", ""))
    st, _ = normalize_signal_type(fields.get("Signal Type", ""))
    conf, _ = normalize_confidence(_confidence_from_fields(fields))
    return {
        "attention": att,
        "signal_type": st,
        "observation": fields.get("Observation", ""),
        "interpretation": fields.get("Interpretation", ""),
        "why_this_matters": fields.get("Why This Matters", ""),
        "leadership_question": fields.get("Leadership Question", ""),
        "confidence": conf,
        "evidence_limitations": fields.get("Evidence Limitations", ""),
    }


def _confidence_from_fields(fields: Dict[str, str]) -> str:
    raw = fields.get("Confidence", "")
    if raw:
        return raw
    block = " ".join(fields.values())
    m = re.search(r"Confidence:\s*([^.\n]+)", block, re.I)
    return m.group(1).strip() if m else ""


def detect_material_assessment_changes(
    earlier: Dict[str, str], later: Dict[str, str]
) -> List[str]:
    changed: List[str] = []
    for key in CONFLICT_FIELDS:
        if key in ("attention", "signal_type", "confidence"):
            if earlier.get(key) != later.get(key) and earlier.get(key) and later.get(key):
                changed.append(key)
            continue
        if not _compare_text(earlier.get(key, ""), later.get(key, "")):
            if earlier.get(key) or later.get(key):
                changed.append(key)
    return changed


def _split_stage1_blocks(text: str) -> List[str]:
    """Split Sana output into per-deployment sections (single-batch files)."""
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
        m = re.match(r"^([A-Za-z][A-Za-z /_()]+)\s*:\s*(.*)$", line.strip())
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


def _parse_inline_compact_fields(block: str) -> Dict[str, str]:
    """Parse compact Sana lines with Attention: X | Signal Type: Y on one line."""
    fields: Dict[str, str] = {}
    m = re.search(
        r"Attention:\s*([^|\n]+)\s*\|\s*Signal Type:\s*([^\n]+)",
        block,
        re.IGNORECASE,
    )
    if m:
        fields["Attention"] = m.group(1).strip()
        fields["Signal Type"] = m.group(2).strip()
    m2 = re.search(r"\|\s*([A-Za-z][^|]+?)\s*\|", block)
    if m2 and "Signal Type" not in fields:
        maybe_type = m2.group(1).strip()
        if maybe_type.lower() not in ("high", "watch", "positive", "red", "yellow", "green"):
            fields.setdefault("Signal Type", maybe_type)
    if "Observation:" in block:
        om = re.search(r"Observation:\s*(.+?)(?=\n(?:Historical Evidence|Interpretation)\s*:|\Z)", block, re.I | re.S)
        if om:
            fields["Observation"] = om.group(1).strip()
    for label in (
        "Historical Evidence",
        "Interpretation",
        "Why This Matters",
        "Leadership Question",
        "Confidence",
        "Evidence Limitations",
    ):
        pat = rf"{label}\s*:\s*(.+?)(?=\n[A-Za-z][A-Za-z /]+\s*:|\Z)"
        mm = re.search(pat, block, re.I | re.S)
        if mm:
            fields[label] = mm.group(1).strip()
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
    if not label:
        m = re.search(r'[—\-]\s*"([^"]+)"', block)
        if m:
            label = m.group(1).strip()
    return dep_id, label


def _block_has_substantive_assessment(fields: Dict[str, str]) -> bool:
    return bool(fields.get("Observation") or (fields.get("Attention") and fields.get("Signal Type")))


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
        inline = _parse_inline_compact_fields(block)
        for key, val in inline.items():
            if val and (not fields.get(key) or key == "Signal Type"):
                fields[key] = val
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


def _classify_report_header(header_line: str) -> str:
    low = header_line.lower()
    if "final portfolio" in low:
        return REPORT_03_ID
    if "updated portfolio" in low:
        return REPORT_02_ID
    return REPORT_01_ID


def split_cumulative_sana_reports(text: str) -> List[LogicalStage1Report]:
    """Split combined Sana.txt into logical cumulative portfolio reports."""
    text = text.replace("\r\n", "\n")
    matches = list(REPORT_HEADER_RE.finditer(text))
    if not matches:
        raise Stage1IngestError(
            "Cumulative Sana file has no recognizable portfolio report headers "
            "(expected 'Deployment Signals Pilot — … Portfolio Report')."
        )
    reports: List[LogicalStage1Report] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end]
        header_line = chunk.split("\n", 1)[0].strip()
        report_id = _classify_report_header(header_line)
        stats = PORTFOLIO_STATS_RE.search(chunk)
        evaluated = int(stats.group(1)) if stats else 0
        surfaced = int(stats.group(2)) if stats else 0
        no_sig = int(stats.group(3)) if stats else 0
        reports.append(
            LogicalStage1Report(
                report_id=report_id,
                text=chunk,
                portfolio_evaluated=evaluated,
                signals_surfaced=surfaced,
                no_signal=no_sig,
            )
        )
    return reports


def _trim_report_body(report_text: str) -> str:
    body = report_text
    proc = re.search(r"\nProcess\s*\n", body)
    if proc:
        body = body[: proc.start()]
    return body


def _split_numbered_candidate_sections(report_text: str) -> List[str]:
    body = _trim_report_body(report_text)
    start = body.find("Leadership Attention")
    if start < 0:
        start = 0
    body = body[start:]
    parts = re.split(r"\n(?=\d+\.\s+)", body)
    out: List[str] = []
    for part in parts:
        part = part.strip()
        if part and re.match(r"\d+\.\s+", part):
            out.append(part)
    return out


def parse_cumulative_report_candidates(
    report: LogicalStage1Report,
) -> Tuple[List[ParsedStage1Block], List[str]]:
    """Parse numbered candidate sections; return blocks and deployment IDs mentioned."""
    sections = _split_numbered_candidate_sections(report.text)
    blocks: List[ParsedStage1Block] = []
    mentioned_ids: List[str] = []
    for idx, section in enumerate(sections):
        ids = DEPLOYMENT_ID_RE.findall(section)
        if not ids:
            continue
        dep_id = ids[0]
        mentioned_ids.append(dep_id)
        fields = _parse_field_block(section)
        inline = _parse_inline_compact_fields(section)
        for key, val in inline.items():
            if val and (not fields.get(key) or key == "Signal Type"):
                fields[key] = val
        summary_only = not _block_has_substantive_assessment(fields)
        is_signal = True
        _, label = _extract_deployment_identity(section, fields)
        blocks.append(
            ParsedStage1Block(
                raw_text=section,
                is_signal=is_signal,
                fields=fields,
                deployment_id=dep_id,
                deployment_label=label,
                batch_id=STAGE1_CUMULATIVE_FILENAME,
                position_in_batch=idx + 1,
                source_report_id=report.report_id,
                summary_only=summary_only,
            )
        )
    return blocks, mentioned_ids


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


def _block_rank(block: ParsedStage1Block, report_order: int) -> Tuple[int, int, int]:
    has_obs = 1 if block.fields.get("Observation") else 0
    substantive = 0 if block.summary_only else 1
    return (report_order, substantive, has_obs * 1000 + len(block.raw_text))


def merge_cumulative_candidates(
    reports: List[LogicalStage1Report],
    packets_by_id: Dict[str, Dict[str, Any]],
    source_checksum: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    report_order = {REPORT_01_ID: 1, REPORT_02_ID: 2, REPORT_03_ID: 3}
    appearances: Dict[str, List[Dict[str, Any]]] = {}
    best_block: Dict[str, ParsedStage1Block] = {}
    best_rank: Dict[str, Tuple[int, int, int]] = {}
    conflicts: Dict[str, List[Dict[str, Any]]] = {}
    assessment_by_report: Dict[str, Dict[str, Dict[str, str]]] = {}
    total_appearances = 0

    for report in reports:
        blocks, _mentioned = parse_cumulative_report_candidates(report)
        ro = report_order.get(report.report_id, 0)
        assessment_by_report.setdefault(report.report_id, {})
        for block in blocks:
            dep_id = resolve_deployment_id(block, packets_by_id)
            if not dep_id:
                continue
            block.deployment_id = dep_id
            total_appearances += 1
            snap = _assessment_snapshot(block.fields)
            assessment_by_report[report.report_id][dep_id] = snap
            appearances.setdefault(dep_id, []).append(
                {
                    "report_id": report.report_id,
                    "summary_only": block.summary_only,
                    "position": block.position_in_batch,
                    "assessment_snapshot": snap,
                    "raw_text_excerpt": block.raw_text[:500],
                }
            )
            rank = _block_rank(block, ro)
            if dep_id not in best_rank or rank > best_rank[dep_id]:
                best_rank[dep_id] = rank
                best_block[dep_id] = block

    # Material change detection across reports with substantive assessments
    for dep_id, apps in appearances.items():
        substantive_snaps: List[Tuple[str, Dict[str, str]]] = []
        for report in reports:
            snap = assessment_by_report.get(report.report_id, {}).get(dep_id)
            if not snap:
                continue
            if not any(s for s in (snap.get("observation"), snap.get("attention"))):
                continue
            substantive_snaps.append((report.report_id, snap))
        for i in range(1, len(substantive_snaps)):
            prev_id, prev = substantive_snaps[i - 1]
            curr_id, curr = substantive_snaps[i]
            changed = detect_material_assessment_changes(prev, curr)
            if changed:
                conflicts.setdefault(dep_id, []).append(
                    {
                        "code": "STAGE1_CANDIDATE_ASSESSMENT_CHANGED",
                        "from_report": prev_id,
                        "to_report": curr_id,
                        "fields_changed": changed,
                        "earlier": prev,
                        "later": curr,
                    }
                )

    candidates: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    for dep_id, block in sorted(best_block.items(), key=lambda x: x[0]):
        if dep_id not in packets_by_id:
            raise Stage1IngestError(
                f"Stage-1 candidate cannot be linked to context packet (deployment_id={dep_id!r})"
            )
        apps = appearances.get(dep_id, [])
        first_report = apps[0]["report_id"] if apps else block.source_report_id
        last_report = apps[-1]["report_id"] if apps else block.source_report_id
        context_ref = f"context-packets/by-deployment/{dep_id}.json"
        cand = build_normalized_candidate(block, dep_id, context_ref, source_checksum)
        cand["stage1_provenance"] = {
            "source_file": STAGE1_CUMULATIVE_FILENAME,
            "appearances": apps,
            "first_seen_report": first_report,
            "latest_seen_report": last_report,
            "final_portfolio_report": REPORT_03_ID,
            "assessment_conflicts": conflicts.get(dep_id, []),
        }
        if conflicts.get(dep_id):
            # Ambiguous only if attention/signal_type/observation disagree materially
            critical = {"attention", "signal_type", "observation"}
            for c in conflicts[dep_id]:
                if critical.intersection(c.get("fields_changed") or []):
                    unresolved.append(dep_id)
        candidates.append(cand)

    if unresolved:
        raise Stage1IngestError(
            "Unresolved Stage-1 candidate assessment conflicts (ambiguous canonical): "
            + ", ".join(sorted(unresolved))
        )

    final_report = next((r for r in reports if r.report_id == REPORT_03_ID), None)
    manifest = {
        "schema_version": CANDIDATE_SCHEMA_VERSION,
        "ingest_mode": "cumulative_single_file",
        "source_file": STAGE1_CUMULATIVE_FILENAME,
        "source_sha256": source_checksum,
        "logical_reports": [
            {
                "report_id": r.report_id,
                "portfolio_evaluated": r.portfolio_evaluated,
                "signals_surfaced": r.signals_surfaced,
                "no_signal": r.no_signal,
            }
            for r in reports
        ],
        "deduplication": {
            "total_candidate_appearances": total_appearances,
            "unique_candidates": len(candidates),
            "duplicates_reconciled": total_appearances - len(candidates),
        },
        "assessment_conflicts": {
            "deployments_with_changes": len(conflicts),
            "details": conflicts,
            "unresolved_ambiguous": unresolved,
        },
        "stage1_portfolio_baseline": {
            "portfolio_evaluated": final_report.portfolio_evaluated if final_report else 0,
            "stage1_candidates": final_report.signals_surfaced if final_report else len(candidates),
            "stage1_no_signal": final_report.no_signal if final_report else 0,
        },
    }
    return candidates, manifest


def build_normalized_candidate(
    block: ParsedStage1Block,
    dep_id: str,
    context_ref: str,
    checksum: str,
) -> Dict[str, Any]:
    fields = block.fields
    att_norm, att_raw = normalize_attention(fields.get("Attention", ""))
    conf_norm, conf_raw = normalize_confidence(_confidence_from_fields(fields))
    type_norm, type_raw = normalize_signal_type(fields.get("Signal Type", ""))
    batch = block.source_report_id or block.batch_id
    return {
        "schema_version": CANDIDATE_SCHEMA_VERSION,
        "identity": {
            "deployment_id": dep_id,
            "context_packet_ref": context_ref,
            "stage1_batch": batch,
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


def ingest_stage1_cumulative_file(
    path: Path,
    packets_by_id: Dict[str, Dict[str, Any]],
    expected_count: int = EXPECTED_CANDIDATE_COUNT,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    checksum = hashlib.sha256(text.encode("utf-8")).hexdigest()
    reports = split_cumulative_sana_reports(text)
    if len(reports) != 3:
        raise Stage1IngestError(
            f"Expected 3 logical cumulative reports in {path.name}; found {len(reports)}"
        )
    candidates, manifest = merge_cumulative_candidates(reports, packets_by_id, checksum)
    if len(candidates) != expected_count:
        raise Stage1IngestError(
            f"Expected {expected_count} unique Stage-1 candidate Signals; parsed {len(candidates)}"
        )
    baseline = manifest.get("stage1_portfolio_baseline") or {}
    if baseline.get("portfolio_evaluated") != 184:
        raise Stage1IngestError(
            f"Final cumulative report must show 184 deployments evaluated; "
            f"got {baseline.get('portfolio_evaluated')}"
        )
    if baseline.get("stage1_candidates") != expected_count:
        raise Stage1IngestError(
            f"Final cumulative report must show {expected_count} signals surfaced; "
            f"got {baseline.get('stage1_candidates')}"
        )
    candidates.sort(key=lambda c: c["identity"]["deployment_id"])
    manifest["expected_candidates"] = expected_count
    manifest["parsed_candidates"] = len(candidates)
    return candidates, manifest


def ingest_stage1_directory(
    stage1_dir: Path,
    packets_by_id: Dict[str, Dict[str, Any]],
    expected_count: int = EXPECTED_CANDIDATE_COUNT,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if not stage1_dir.is_dir():
        raise Stage1IngestError(f"Stage-1 directory missing: {stage1_dir}")

    cumulative = stage1_dir / STAGE1_CUMULATIVE_FILENAME
    if cumulative.is_file():
        return ingest_stage1_cumulative_file(cumulative, packets_by_id, expected_count)

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
            f"No Stage-1 outputs in {stage1_dir}. "
            f"Expected {STAGE1_CUMULATIVE_FILENAME} or "
            "sana-batch-01-output.txt, sana-batch-02-output.txt, sana-batch-03-output.txt"
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
        "ingest_mode": "multi_batch_files",
        "expected_candidates": expected_count,
        "parsed_candidates": len(all_candidates),
        "batches": manifest_batches,
    }
    return all_candidates, manifest


def discover_default_stage1_paths(exports_dir: Path) -> List[Path]:
    stage1 = exports_dir / "stage1"
    cumulative = stage1 / STAGE1_CUMULATIVE_FILENAME
    if cumulative.is_file():
        return [cumulative]
    names = [
        "sana-batch-01-output.txt",
        "sana-batch-02-output.txt",
        "sana-batch-03-output.txt",
    ]
    return [stage1 / n for n in names]
