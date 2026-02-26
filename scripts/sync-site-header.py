#!/usr/bin/env python3
"""Sync the canonical site header across viewer pages."""

from __future__ import annotations

import argparse
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
    "papers/review.html",
    "papers/paper.html",
    "blogs/index.html",
    "people/index.html",
    "updates/index.html",
    "about/index.html",
]

HEADER_RE = re.compile(r"<header class=\"site-header\">.*?</header>", flags=re.DOTALL)


def normalize_newlines(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n")


def sync_page(path: Path, header_template: str) -> bool:
    original = normalize_newlines(path.read_text(encoding="utf-8"))
    if not HEADER_RE.search(original):
        raise RuntimeError(f"Could not find site header block in {path}")

    updated = HEADER_RE.sub(header_template.rstrip("\n"), original, count=1)
    if updated == original:
        return False

    path.write_text(updated, encoding="utf-8")
    return True


def run(repo_root: Path, check: bool, template_path: Path) -> int:
    header_template = normalize_newlines(template_path.read_text(encoding="utf-8")).rstrip("\n")
    touched = 0
    stale: list[Path] = []

    for rel in VIEWER_PAGES:
        path = (repo_root / rel).resolve()
        if not path.exists():
            continue

        if check:
            before = path.read_text(encoding="utf-8")
            changed = sync_page(path, header_template)
            after = path.read_text(encoding="utf-8")
            path.write_text(before, encoding="utf-8")
            if changed or before != after:
                stale.append(path)
            continue

        if sync_page(path, header_template):
            touched += 1

    if check:
        if stale:
            print("ERROR: site header is out of sync:", file=sys.stderr)
            for path in stale:
                print(f" - {path}", file=sys.stderr)
            return 1
        print("OK: site header is synchronized")
        return 0

    print(f"Synchronized site header (files touched: {touched})")
    return 0


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=str(repo_root))
    parser.add_argument("--template", default="templates/site-header.html")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    template_path = (root / args.template).resolve()
    if not template_path.exists():
        print(f"ERROR: missing template: {template_path}", file=sys.stderr)
        return 1

    return run(root, args.check, template_path)


if __name__ == "__main__":
    raise SystemExit(main())
