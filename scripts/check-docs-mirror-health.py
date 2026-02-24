#!/usr/bin/env python3
"""Validate mirror-safe docs health signals.

Checks include:
- docs sync metadata presence and freshness
- bridge asset presence
- optional local link integrity across mirrored docs HTML
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.parse
from pathlib import Path


REQUIRED_BRIDGE_MARKERS = [
    "buildDocsTrustStrip",
    "buildInlinePageToc",
    "enhanceSearchPageExperience",
    "initDocsUniversalSearch",
    "initSearchShortcut",
    "buildSidebarRelationBar",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check mirrored LLVM docs health in this repo.")
    parser.add_argument("--repo-root", default=".", help="Repository root path.")
    parser.add_argument(
        "--docs-dir",
        default="docs",
        help="Docs mirror directory relative to repo root (default: docs).",
    )
    parser.add_argument(
        "--expected-source-prefix",
        default="https://llvm.org/docs/",
        help="Expected docs sync sourceUrl prefix.",
    )
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=21,
        help="Fail if docs sync metadata is older than this many days.",
    )
    parser.add_argument(
        "--no-check-links",
        action="store_true",
        help="Skip local link checks across docs/*.html files.",
    )
    parser.add_argument(
        "--max-link-errors",
        type=int,
        default=80,
        help="Maximum number of broken-link examples to print.",
    )
    parser.add_argument(
        "--known-broken-links-file",
        default="",
        help="Path to newline-delimited known broken local link entries.",
    )
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        fail(f"Failed to parse JSON file {path}: {exc}")
    if not isinstance(payload, dict):
        fail(f"Expected JSON object in {path}")
    return payload


def verify_bridge_assets(repo_root: Path, docs_dir: Path) -> None:
    required_bridge_files = [
        docs_dir / "_static/documentation_options.js",
        docs_dir / "_static/docs-book-index.js",
        docs_dir / "_static/docs-universal-search-index.js",
        docs_dir / "_static/docs-sync-meta.json",
        Path("css/docs-bridge.css"),
    ]
    for rel_path in required_bridge_files:
        path = repo_root / rel_path
        if not path.is_file():
            fail(f"Missing required bridge asset: {rel_path}")

    docs_js_path = repo_root / docs_dir / "_static/documentation_options.js"
    docs_js = docs_js_path.read_text(encoding="utf-8")
    for marker in REQUIRED_BRIDGE_MARKERS:
        if marker not in docs_js:
            fail(f"Bridge marker missing in {docs_js_path.relative_to(repo_root)}: {marker}")

    universal_path = repo_root / docs_dir / "_static/docs-universal-search-index.js"
    universal_js = universal_path.read_text(encoding="utf-8")
    match = re.search(
        r"window\.LLVMDocsUniversalSearchIndex\s*=\s*(\{.*\})\s*;\s*$",
        universal_js,
        flags=re.DOTALL,
    )
    if not match:
        fail(f"{universal_path.relative_to(repo_root)} missing expected payload wrapper")
    try:
        payload = json.loads(match.group(1))
    except Exception as exc:  # noqa: BLE001
        fail(f"Failed to parse docs universal search payload: {exc}")
    entries = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(entries, list) or not entries:
        fail("docs universal search payload has no entries")


def parse_synced_at(raw: str) -> dt.datetime:
    value = str(raw or "").strip()
    if not value:
        fail("docs sync metadata missing syncedAt")
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError as exc:
        fail(f"Invalid syncedAt value in docs sync metadata: {exc}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def verify_sync_metadata(
    repo_root: Path,
    docs_dir: Path,
    expected_source_prefix: str,
    max_age_days: int,
) -> None:
    meta_path = repo_root / docs_dir / "_static/docs-sync-meta.json"
    meta = read_json(meta_path)
    source_url = str(meta.get("sourceUrl", "")).strip()
    if not source_url.startswith(expected_source_prefix):
        fail(f"Unexpected docs sourceUrl in {meta_path.relative_to(repo_root)}: {source_url!r}")
    synced_at = parse_synced_at(str(meta.get("syncedAt", "")))
    now_utc = dt.datetime.now(dt.timezone.utc)
    age = now_utc - synced_at
    if age.total_seconds() < 0:
        fail(f"docs sync metadata has future syncedAt: {synced_at.isoformat()}")
    if age > dt.timedelta(days=max_age_days):
        fail(
            "docs mirror appears stale: "
            f"last sync {synced_at.isoformat()} exceeds {max_age_days} days"
        )
    print(
        "Docs sync metadata OK:",
        f"mirror={docs_dir.as_posix()}",
        f"source={source_url}",
        f"syncedAt={synced_at.isoformat()}",
        f"age_days={age.total_seconds() / 86400:.2f}",
    )


def load_known_broken_links(repo_root: Path, rel_path: str) -> set[str]:
    path = (repo_root / rel_path).resolve()
    if not path.exists():
        return set()
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    return {line.strip() for line in lines if line.strip() and not line.strip().startswith("#")}


def iter_html_refs(text: str) -> list[str]:
    return re.findall(r"""(?:href|src)=["']([^"']+)["']""", text, flags=re.IGNORECASE)


def is_external_ref(ref: str) -> bool:
    lowered = ref.lower()
    if lowered.startswith(("http://", "https://", "mailto:", "javascript:", "data:")):
        return True
    if lowered.startswith("//"):
        return True
    return False


def candidate_paths(repo_root: Path, html_path: Path, ref: str) -> list[Path]:
    parsed = urllib.parse.urlparse(ref)
    path_part = urllib.parse.unquote(parsed.path or "")
    if not path_part:
        return []

    if path_part.startswith("/library/"):
        base_candidate = repo_root / path_part.removeprefix("/library/")
    elif path_part.startswith("/"):
        base_candidate = repo_root / path_part.lstrip("/")
    else:
        base_candidate = (html_path.parent / path_part).resolve()

    candidates = [base_candidate]
    if base_candidate.is_dir():
        candidates.append(base_candidate / "index.html")
    if base_candidate.suffix == "":
        candidates.append(base_candidate.with_suffix(".html"))
        candidates.append(base_candidate / "index.html")
    return candidates


def verify_local_docs_links(repo_root: Path, docs_dir: Path, max_examples: int, known_failures: set[str]) -> None:
    docs_root = repo_root / docs_dir
    html_files = sorted(docs_root.rglob("*.html"))
    nested_mirror_roots = []
    for child in docs_root.iterdir():
        if not child.is_dir():
            continue
        if (child / "_static" / "docs-sync-meta.json").is_file():
            nested_mirror_roots.append(child.resolve())
    if nested_mirror_roots:
        filtered = []
        for html_path in html_files:
            skip = False
            for nested_root in nested_mirror_roots:
                try:
                    html_path.resolve().relative_to(nested_root)
                    skip = True
                    break
                except ValueError:
                    continue
            if not skip:
                filtered.append(html_path)
        html_files = filtered
    if not html_files:
        fail(f"No docs HTML files found for link checks in {docs_dir}.")

    failures: list[str] = []
    for html_path in html_files:
        text = html_path.read_text(encoding="utf-8", errors="ignore")
        refs = iter_html_refs(text)
        for ref in refs:
            clean = str(ref).strip()
            if not clean or clean.startswith("#") or clean.startswith("?"):
                continue
            if is_external_ref(clean):
                continue
            candidates = candidate_paths(repo_root, html_path, clean)
            if not candidates:
                continue
            if any(candidate.exists() for candidate in candidates):
                continue
            rel_html = html_path.relative_to(repo_root)
            failure_line = f"{rel_html}: {clean}"
            if failure_line in known_failures:
                continue
            failures.append(failure_line)
            if len(failures) >= max_examples:
                break
        if len(failures) >= max_examples:
            break

    if failures:
        preview = "\n".join(failures)
        fail(f"Broken local docs links detected (showing up to {max_examples}):\n{preview}")

    if known_failures:
        print(f"Known broken links allowlisted: {len(known_failures)}")
    print(f"Local docs link check OK: mirror={docs_dir.as_posix()} scanned={len(html_files)}")


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        fail(f"Invalid --repo-root: {repo_root}")
    docs_dir = Path(str(args.docs_dir or "docs").strip()).as_posix().strip("/")
    if not docs_dir:
        docs_dir = "docs"
    docs_dir_path = Path(docs_dir)
    expected_source_prefix = str(args.expected_source_prefix or "").strip()
    if not expected_source_prefix:
        fail("Empty --expected-source-prefix")

    verify_bridge_assets(repo_root, docs_dir_path)
    verify_sync_metadata(
        repo_root,
        docs_dir_path,
        expected_source_prefix=expected_source_prefix,
        max_age_days=args.max_age_days,
    )
    if not args.no_check_links:
        known_broken_path = str(args.known_broken_links_file or "").strip()
        if not known_broken_path:
            known_broken_path = f"{docs_dir}/_static/docs-known-broken-links.txt"
        known_failures = load_known_broken_links(repo_root, known_broken_path)
        verify_local_docs_links(
            repo_root,
            docs_dir_path,
            max_examples=args.max_link_errors,
            known_failures=known_failures,
        )
    print(f"OK: docs mirror health checks passed for {docs_dir}")


if __name__ == "__main__":
    main()
