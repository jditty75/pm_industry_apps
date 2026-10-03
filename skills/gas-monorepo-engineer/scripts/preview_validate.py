#!/usr/bin/env python3
"""Structural validation for generated preview HTML (no browser required)."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import List, Optional, Tuple

SCRIPTLET_RE = re.compile(r"<\?[\s\S]*?\?>")
INCLUDE_RE = re.compile(r"<\?!?=?\s*include\s*\(")
FENCE_RE = re.compile(r"^```|```\s*$", re.MULTILINE)


class _PreviewDomParser(HTMLParser):
    """Lightweight DOM walk for preview structural checks."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.errors: List[str] = []
        self.seen_html = False
        self.seen_head = False
        self.seen_body = False
        self.style_count = 0
        self.script_count = 0
        self.preview_badge_in_script = False
        self._script_has_badge_markup = False
        self._in_script = False
        self._in_style = False
        self._script_buf: List[str] = []
        self.body_text_chunks: List[str] = []

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t == "html":
            self.seen_html = True
        elif t == "head":
            self.seen_head = True
        elif t == "body":
            self.seen_body = True
        elif t == "style":
            self.style_count += 1
            self._in_style = True
        elif t == "script":
            self.script_count += 1
            self._in_script = True
            self._script_buf = []

    def handle_endtag(self, tag):
        t = tag.lower()
        if t == "style":
            self._in_style = False
        elif t == "script":
            buf = "".join(self._script_buf)
            if "gas-preview-badge" in buf or 'id="gas-preview-badge"' in buf:
                self.preview_badge_in_script = True
            self._in_script = False
            self._script_buf = []

    def handle_data(self, data):
        if self._in_script:
            self._script_buf.append(data)
        elif self.seen_body and not self._in_style:
            if data.strip():
                self.body_text_chunks.append(data.strip())


def _looks_like_escaped_document(text: str) -> bool:
    head = text.lstrip()[:800]
    if "&lt;!DOCTYPE" in head or "&lt;html" in head:
        return True
    if head.startswith("<!DOCTYPE") and "&lt;" in head[:400]:
        return True
    return False


def _whole_doc_in_pre(html: str) -> bool:
    """Detect a single <pre> wrapping most of the document source."""
    m = re.search(r"<pre[^>]*>([\s\S]{200,})</pre>", html, re.IGNORECASE)
    if not m:
        return False
    inner = m.group(1)
    return "<html" in inner.lower() or "<!doctype" in inner.lower()


def validate_preview_html(
    html: str,
    *,
    app_id: str = "",
    required_markers: Optional[List[str]] = None,
) -> Tuple[bool, List[str]]:
    """
    Return (ok, issues). issues is empty when ok.
    required_markers: substrings that must appear outside escaped-text patterns.
    """
    issues: List[str] = []
    if not html or len(html) < 200:
        issues.append("output too small to be a preview document")
        return False, issues

    if not html.lstrip().lower().startswith("<!doctype") and "<html" not in html[:500].lower():
        issues.append("missing <!DOCTYPE html> or <html> at document start")

    if FENCE_RE.search(html[:2000]):
        issues.append("markdown code fences found in output")

    if _looks_like_escaped_document(html):
        issues.append("document appears HTML-entity-escaped (would render as text)")

    if _whole_doc_in_pre(html):
        issues.append("document appears wrapped in <pre> (source view)")

    if SCRIPTLET_RE.search(html):
        issues.append("unresolved GAS scriptlets (<? ... ?>) remain in output")

    if INCLUDE_RE.search(html):
        issues.append("unresolved include() template directives remain")

    if re.search(r"window\.APP_UI_CONFIG\s*=\s*;", html):
        issues.append("invalid preview stub: window.APP_UI_CONFIG is empty (scriptlet strip)")

    parser = _PreviewDomParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as e:
        issues.append(f"HTML parser error: {e}")

    if not parser.seen_html:
        issues.append("no <html> element parsed")
    if not parser.seen_body:
        issues.append("no <body> element parsed")
    if parser.style_count < 1:
        issues.append("no <style> elements found")
    if parser.script_count < 1:
        issues.append("no <script> elements found")
    if parser.preview_badge_in_script:
        issues.append("preview badge markup found inside <script> (broken HTML assembly)")

    if required_markers:
        lower = html.lower()
        for marker in required_markers:
            if marker.lower() not in lower:
                issues.append(f"missing expected marker: {marker}")

    if "id=\"gas-preview-badge\"" not in html and "id='gas-preview-badge'" not in html:
        issues.append("missing preview badge element (#gas-preview-badge)")

    return len(issues) == 0, issues
