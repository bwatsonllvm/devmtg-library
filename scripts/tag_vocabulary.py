#!/usr/bin/env python3
"""Helpers for loading canonical talk tag vocabulary used by paper builders."""

from __future__ import annotations

import json
import re
from pathlib import Path


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", collapse_ws(value).lower())


def _parse_all_tags_from_app_js(app_js_path: Path) -> list[str]:
    text = app_js_path.read_text(encoding="utf-8")
    match = re.search(r"const\s+ALL_TAGS\s*=\s*\[(.*?)\];", text, flags=re.DOTALL)
    if not match:
        return []

    tags_raw = match.group(1)
    tags: list[str] = []
    seen: set[str] = set()
    for single, double in re.findall(r"'([^']+)'|\"([^\"]+)\"", tags_raw):
        tag = collapse_ws(single or double)
        key = _normalize_key(tag)
        if not key or key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return tags


def _parse_key_topic_canonical_from_library_utils(app_js_path: Path) -> list[str]:
    library_utils_path = (app_js_path.parent / "shared" / "library-utils.js").resolve()
    if not library_utils_path.exists():
        return []

    text = library_utils_path.read_text(encoding="utf-8")
    match = re.search(r"const\s+KEY_TOPIC_CANONICAL\s*=\s*\[(.*?)\];", text, flags=re.DOTALL)
    if not match:
        return []

    tags_raw = match.group(1)
    tags: list[str] = []
    seen: set[str] = set()
    for single, double in re.findall(r"'([^']+)'|\"([^\"]+)\"", tags_raw):
        tag = collapse_ws(single or double)
        key = _normalize_key(tag)
        if not key or key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return tags


def _parse_tags_from_events(events_dir: Path) -> list[str]:
    if not events_dir.exists():
        return []

    out: list[str] = []
    seen: set[str] = set()
    for event_path in sorted(events_dir.glob("*.json")):
        payload = json.loads(event_path.read_text(encoding="utf-8"))
        for talk in payload.get("talks", []):
            for raw_tag in talk.get("tags", []):
                tag = collapse_ws(str(raw_tag))
                key = _normalize_key(tag)
                if not key or key in seen:
                    continue
                seen.add(key)
                out.append(tag)
    return out


def load_canonical_tags(app_js_path: Path, events_dir: Path | None = None) -> list[str]:
    """Load canonical tags.

    Priority:
      1) `const ALL_TAGS = [...]` in app.js (legacy/static setup)
      2) `KEY_TOPIC_CANONICAL` in `js/shared/library-utils.js`
      3) unique tags inferred from `devmtg/events/*.json`
    """
    tags = _parse_all_tags_from_app_js(app_js_path)
    if tags:
        return tags

    tags = _parse_key_topic_canonical_from_library_utils(app_js_path)
    if tags:
        return tags

    candidate_events_dir = events_dir
    if candidate_events_dir is None:
        candidate_events_dir = (app_js_path.parent.parent / "events").resolve()

    inferred = _parse_tags_from_events(candidate_events_dir)
    if inferred:
        return inferred

    raise RuntimeError(
        f"Could not load canonical tags from {app_js_path} "
        f"or inferred events dir {candidate_events_dir}"
    )
