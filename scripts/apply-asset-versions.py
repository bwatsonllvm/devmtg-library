#!/usr/bin/env python3
"""Apply consistent cache-busting query versions to viewer HTML/JS assets.

Versions are derived from source-file content hashes so one updater script
controls all stamps instead of manual per-file edits.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

VIEWER_PAGES = [
    "index.html",
    "work.html",
    "talks/index.html",
    "talks/events.html",
    "talks/talk.html",
    "papers/index.html",
    "papers/add-by-url.html",
    "papers/add.html",
    "papers/edit.html",
    "papers/paper.html",
    "blogs/index.html",
    "people/index.html",
    "updates/index.html",
    "about/index.html",
]

TARGET_JS_FILES = [
    "js/work.js",
    "js/shared/global-search.js",
]

SCRIPT_OR_LINK_RE = re.compile(
    r'(?P<prefix><(?:script|link)\b[^>]*?\b(?:src|href)=")'
    r'(?P<path>[^"?#]+\.(?:js|css))'
    r'(?:\?v=[^"#]*)?'
    r'(?P<suffix>(?:#[^"]*)?")',
    flags=re.IGNORECASE,
)

DOCS_INDEX_RE = re.compile(
    r'(?P<path>docs(?:/clang|/lldb)?/_static/docs-universal-search-index\.js)\?v=[0-9a-z-]+'
)
AUTOCOMPLETE_INDEX_RE = re.compile(
    r'(?P<path>js/data/autocomplete-index\.json)\?v=[0-9a-z-]+'
)


def version_for(path: Path) -> str:
    digest = hashlib.sha1(path.read_bytes()).hexdigest()
    return digest[:12]


def is_local_asset_path(path: str) -> bool:
    lowered = path.lower()
    if lowered.startswith(("http://", "https://", "//")):
        return False
    if lowered.startswith("_static/"):
        return False
    return True


def stamp_html_page(repo_root: Path, page_path: Path) -> bool:
    original = page_path.read_text(encoding="utf-8")

    def repl(match: re.Match[str]) -> str:
        asset_path = match.group("path")
        if not is_local_asset_path(asset_path):
            return match.group(0)

        resolved = (repo_root / asset_path.lstrip("/")).resolve()
        if not resolved.exists() or not resolved.is_file():
            return match.group(0)

        v = version_for(resolved)
        return f'{match.group("prefix")}{asset_path}?v={v}{match.group("suffix")}'

    updated = SCRIPT_OR_LINK_RE.sub(repl, original)
    if updated == original:
        return False
    page_path.write_text(updated, encoding="utf-8")
    return True


def stamp_docs_index_constants(repo_root: Path, js_path: Path) -> bool:
    original = js_path.read_text(encoding="utf-8")

    def repl(match: re.Match[str]) -> str:
        rel = match.group("path")
        resolved = (repo_root / rel).resolve()
        if not resolved.exists() or not resolved.is_file():
            return match.group(0)
        return f"{rel}?v={version_for(resolved)}"

    updated = DOCS_INDEX_RE.sub(repl, original)
    updated = AUTOCOMPLETE_INDEX_RE.sub(repl, updated)
    if updated == original:
        return False
    js_path.write_text(updated, encoding="utf-8")
    return True


def collect_diffs(before_after: list[tuple[Path, str, str]]) -> list[Path]:
    changed: list[Path] = []
    for path, before, after in before_after:
        if before != after:
            changed.append(path)
    return changed


def run(repo_root: Path, check: bool) -> int:
    touched = 0

    if check:
        snapshots: list[tuple[Path, str, str]] = []

        for rel in TARGET_JS_FILES:
            path = (repo_root / rel).resolve()
            if not path.exists():
                continue
            before = path.read_text(encoding="utf-8")
            _ = stamp_docs_index_constants(repo_root, path)
            after = path.read_text(encoding="utf-8")
            snapshots.append((path, before, after))
            path.write_text(before, encoding="utf-8")

        for rel in VIEWER_PAGES:
            path = (repo_root / rel).resolve()
            if not path.exists():
                continue
            before = path.read_text(encoding="utf-8")
            _ = stamp_html_page(repo_root, path)
            after = path.read_text(encoding="utf-8")
            snapshots.append((path, before, after))
            path.write_text(before, encoding="utf-8")

        changed = collect_diffs(snapshots)
        if changed:
            print("ERROR: asset versions are stale in:", file=sys.stderr)
            for path in changed:
                print(f" - {path}", file=sys.stderr)
            return 1

        print("OK: asset versions are up to date")
        return 0

    for rel in TARGET_JS_FILES:
        path = (repo_root / rel).resolve()
        if not path.exists():
            continue
        if stamp_docs_index_constants(repo_root, path):
            touched += 1

    for rel in VIEWER_PAGES:
        path = (repo_root / rel).resolve()
        if not path.exists():
            continue
        if stamp_html_page(repo_root, path):
            touched += 1

    print(f"Applied asset versions (files touched: {touched})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    return run(Path(args.repo_root).resolve(), args.check)


if __name__ == "__main__":
    raise SystemExit(main())
