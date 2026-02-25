#!/usr/bin/env python3
"""Validate docs/sources.json entries and probe upstream docs endpoints."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def collapse_ws(value: str) -> str:
    return " ".join(str(value or "").split()).strip()


def build_probe_url(template: str, fallback: str) -> str:
    query = urllib.parse.quote("llvm")
    raw_template = collapse_ws(template)
    if raw_template:
        if "{query}" in raw_template:
            return raw_template.replace("{query}", query)
        parsed = urllib.parse.urlparse(raw_template)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            q = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if not any(name == "q" for name, _ in q):
                q.append(("q", "llvm"))
            return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(q, doseq=True)))
    return collapse_ws(fallback)


def probe_url(url: str, timeout_s: int, user_agent: str) -> tuple[bool, str]:
    headers = {"User-Agent": user_agent}
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s, context=ssl.create_default_context()) as resp:
                status = int(getattr(resp, "status", 0) or 0)
            if 200 <= status < 400:
                return True, f"HTTP {status}"
            return False, f"HTTP {status}"
        except urllib.error.HTTPError as exc:
            status = int(exc.code or 0)
            if method == "HEAD" and status in {400, 403, 404, 405, 429}:
                continue
            return False, f"HTTP {status}"
        except Exception as exc:  # noqa: BLE001
            if method == "HEAD":
                continue
            return False, str(exc)
    return False, "request failed"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default="docs/sources.json")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--user-agent", default="llvm-library-docs-sources-health/1.0")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    catalog_path = Path(args.catalog).resolve()
    if not catalog_path.is_file():
        raise SystemExit(f"Missing docs sources catalog: {catalog_path}")

    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    raw_sources = payload.get("sources") if isinstance(payload, dict) else None
    if not isinstance(raw_sources, list) or not raw_sources:
        raise SystemExit("docs sources catalog must contain a non-empty sources array")

    failures: list[str] = []
    checked = 0

    for idx, raw in enumerate(raw_sources):
        if not isinstance(raw, dict):
            failures.append(f"sources[{idx}] must be an object")
            continue

        source_id = collapse_ws(raw.get("id", "")) or f"source-{idx + 1}"
        name = collapse_ws(raw.get("name", "")) or source_id
        docs_url = collapse_ws(raw.get("docsUrl", ""))
        search_template = collapse_ws(raw.get("searchUrlTemplate", ""))

        if not docs_url:
            failures.append(f"{source_id}: missing docsUrl")
            continue
        parsed_docs = urllib.parse.urlparse(docs_url)
        if parsed_docs.scheme not in {"http", "https"} or not parsed_docs.netloc:
            failures.append(f"{source_id}: docsUrl must be absolute http/https")
            continue

        search_probe = build_probe_url(search_template, docs_url)
        for label, url in (("docs", docs_url), ("search", search_probe)):
            ok, detail = probe_url(url, timeout_s=max(5, int(args.timeout)), user_agent=args.user_agent)
            checked += 1
            if not ok:
                failures.append(f"{source_id} ({name}) {label} probe failed: {url} ({detail})")

    if failures:
        sys.stderr.write("Docs source health failures:\n" + "\n".join(failures) + "\n")
        return 1

    print(f"OK: docs source health checks passed ({checked} probes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
