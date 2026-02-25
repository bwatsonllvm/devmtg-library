#!/usr/bin/env python3
"""Sync formatted docs from llvm/llvm-project using sparse checkout + local Sphinx builds.

This backend updates local docs artifacts without crawling llvm.org/clang.llvm.org/lldb.llvm.org.
It preserves the existing frontend presentation by keeping the local bridge shell and
regenerating local docs search indexes for each docs corpus.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import ssl
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DocsVariant:
    variant_id: str
    source_path: str
    output_dir: str
    source_url: str


VARIANTS: tuple[DocsVariant, ...] = (
    DocsVariant(
        variant_id="llvm-core",
        source_path="llvm/docs",
        output_dir="docs",
        source_url="https://llvm.org/docs/",
    ),
    DocsVariant(
        variant_id="clang",
        source_path="clang/docs",
        output_dir="docs/clang",
        source_url="https://clang.llvm.org/docs/",
    ),
    DocsVariant(
        variant_id="lldb",
        source_path="lldb/docs",
        output_dir="docs/lldb",
        source_url="https://lldb.llvm.org/",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync docs from llvm/llvm-project without crawler mirroring.")
    parser.add_argument("--repo-root", default=".", help="Library repository root.")
    parser.add_argument(
        "--source-repo-url",
        default="https://github.com/llvm/llvm-project.git",
        help="Git URL for llvm-project.",
    )
    parser.add_argument(
        "--source-repo-name",
        default="llvm/llvm-project",
        help="GitHub owner/repo used for metadata lookups.",
    )
    parser.add_argument("--source-ref", default="main", help="Source ref/branch to sync.")
    parser.add_argument(
        "--github-token",
        default=os.environ.get("GITHUB_TOKEN", ""),
        help="Optional GitHub token for API calls.",
    )
    parser.add_argument(
        "--python-bin",
        default=sys.executable or "python3",
        help="Python binary used for Sphinx and helper scripts.",
    )
    parser.add_argument(
        "--install-requirements",
        action="store_true",
        help="Install upstream Sphinx requirements from llvm/docs/requirements.txt.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force rebuild even when upstream path revisions appear unchanged.",
    )
    return parser.parse_args()


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    rendered = " ".join(cmd)
    print(f"+ {rendered}")
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def run_capture(cmd: list[str], *, cwd: Path | None = None) -> str:
    rendered = " ".join(cmd)
    print(f"+ {rendered}")
    completed = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return str(completed.stdout or "").strip()


def read_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def now_iso_utc() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def fetch_github_json(url: str, token: str, timeout: int = 25) -> object | None:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "llvm-library-docs-repo-sync/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(
            request,
            timeout=timeout,
            context=ssl.create_default_context(),
        ) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        print(f"WARNING: GitHub API request failed ({url}): {exc}")
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        print(f"WARNING: GitHub API returned invalid JSON ({url})")
        return None


def fetch_latest_path_commit(repo_name: str, ref: str, source_path: str, token: str) -> str:
    encoded_ref = urllib.parse.quote(ref, safe="")
    encoded_path = urllib.parse.quote(source_path, safe="/")
    url = (
        f"https://api.github.com/repos/{repo_name}/commits"
        f"?sha={encoded_ref}&path={encoded_path}&per_page=1"
    )
    payload = fetch_github_json(url, token)
    entries: list[object]
    if isinstance(payload, list):
        entries = payload
    elif isinstance(payload, dict):
        entries = [payload]
    else:
        return ""
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        sha = str(entry.get("sha", "")).strip()
        if sha:
            return sha
    return ""


def fetch_latest_release(repo_name: str, token: str) -> dict:
    url = f"https://api.github.com/repos/{repo_name}/releases/latest"
    payload = fetch_github_json(url, token)
    if not isinstance(payload, dict):
        return {}
    tag = str(payload.get("tag_name", "")).strip()
    name = str(payload.get("name", "")).strip()
    html_url = str(payload.get("html_url", "")).strip()
    published_at = str(payload.get("published_at", "")).strip()
    if not (tag and html_url):
        return {}
    release: dict[str, str] = {
        "tag": tag,
        "name": name or tag,
        "githubUrl": html_url,
    }
    version = tag.removeprefix("llvmorg-").strip()
    if version and version != tag:
        release["version"] = version
    if published_at:
        release["publishedAt"] = published_at
    return release


def load_existing_revision(repo_root: Path, variant: DocsVariant) -> str:
    meta_path = repo_root / variant.output_dir / "_static" / "docs-sync-meta.json"
    payload = read_json(meta_path)
    return str(payload.get("sourceRevision", "")).strip()


def ensure_repo_clone(
    *,
    source_repo_url: str,
    source_ref: str,
    checkout_dir: Path,
    sparse_paths: list[str],
) -> None:
    run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--no-checkout",
            "--branch",
            source_ref,
            source_repo_url,
            str(checkout_dir),
        ]
    )
    run(["git", "-C", str(checkout_dir), "sparse-checkout", "init", "--cone"])
    run(["git", "-C", str(checkout_dir), "sparse-checkout", "set", *sparse_paths])
    run(["git", "-C", str(checkout_dir), "checkout", source_ref])


def sync_variant_output(src_dir: Path, out_dir: Path, variant: DocsVariant) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    rsync_args = ["rsync", "-a", "--delete"]
    if variant.variant_id == "llvm-core":
        # Keep nested corpus roots managed by their own sync steps.
        rsync_args.extend(["--exclude", "clang/", "--exclude", "lldb/"])
    rsync_args.extend([f"{src_dir}/", f"{out_dir}/"])
    run(rsync_args)


def restore_bridge_assets(
    *,
    out_dir: Path,
    bridge_js: str,
    known_broken_links: str | None,
) -> None:
    static_dir = out_dir / "_static"
    static_dir.mkdir(parents=True, exist_ok=True)
    (static_dir / "documentation_options.js").write_text(bridge_js, encoding="utf-8")
    known_path = static_dir / "docs-known-broken-links.txt"
    if known_broken_links is None:
        if not known_path.exists():
            known_path.write_text("", encoding="utf-8")
        return
    known_path.write_text(known_broken_links, encoding="utf-8")


def regenerate_indexes(repo_root: Path, python_bin: str, variant: DocsVariant) -> None:
    docs_root = variant.output_dir
    run(
        [
            python_bin,
            str(repo_root / "scripts/generate-docs-book-index.py"),
            "--docs-root",
            docs_root,
            "--output",
            f"{docs_root}/_static/docs-book-index.js",
        ]
    )
    run(
        [
            python_bin,
            str(repo_root / "scripts/generate-docs-universal-search-index.py"),
            "--docs-root",
            docs_root,
            "--book-index",
            f"{docs_root}/_static/docs-book-index.js",
            "--output",
            f"{docs_root}/_static/docs-universal-search-index.js",
        ]
    )


def write_sync_meta(
    *,
    repo_root: Path,
    variant: DocsVariant,
    repo_name: str,
    source_ref: str,
    source_revision: str,
    source_head_revision: str,
    latest_release: dict,
) -> None:
    payload: dict[str, object] = {
        "generator": "scripts/sync-docs-from-llvm-project.py",
        "sourceRepo": repo_name,
        "sourceRef": source_ref,
        "sourcePath": variant.source_path,
        "sourceRevision": source_revision,
        "sourceHeadRevision": source_head_revision,
        "sourceUrl": variant.source_url,
        "syncedAt": now_iso_utc(),
    }
    if latest_release:
        payload["latestRelease"] = latest_release

    path = repo_root / variant.output_dir / "_static" / "docs-sync-meta.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        raise SystemExit(f"Invalid --repo-root: {repo_root}")

    canonical_bridge_path = repo_root / "docs" / "_static" / "documentation_options.js"
    if not canonical_bridge_path.is_file():
        raise SystemExit(f"Missing bridge file: {canonical_bridge_path}")
    bridge_js = canonical_bridge_path.read_text(encoding="utf-8")

    known_broken_by_variant: dict[str, str | None] = {}
    for variant in VARIANTS:
        known_path = repo_root / variant.output_dir / "_static" / "docs-known-broken-links.txt"
        if known_path.is_file():
            known_broken_by_variant[variant.variant_id] = known_path.read_text(encoding="utf-8")
        else:
            known_broken_by_variant[variant.variant_id] = None

    latest_by_variant: dict[str, str] = {}
    for variant in VARIANTS:
        latest = fetch_latest_path_commit(
            repo_name=args.source_repo_name,
            ref=args.source_ref,
            source_path=variant.source_path,
            token=args.github_token,
        )
        latest_by_variant[variant.variant_id] = latest

    variants_to_build: list[DocsVariant] = []
    for variant in VARIANTS:
        latest = latest_by_variant.get(variant.variant_id, "")
        current = load_existing_revision(repo_root, variant)
        if args.force:
            variants_to_build.append(variant)
            continue
        if latest and current and latest == current:
            print(f"Skipping {variant.variant_id}: upstream unchanged at {latest[:12]}")
            continue
        variants_to_build.append(variant)

    if not variants_to_build:
        print("Docs sync skipped: all upstream docs paths unchanged.")
        return 0

    print(
        "Docs variants to rebuild:",
        ", ".join(variant.variant_id for variant in variants_to_build),
    )

    latest_release = fetch_latest_release(args.source_repo_name, args.github_token)

    with tempfile.TemporaryDirectory(prefix="llvm-project-docs-sync-") as temp_root:
        temp_root_path = Path(temp_root)
        checkout_dir = temp_root_path / "llvm-project"
        ensure_repo_clone(
            source_repo_url=args.source_repo_url,
            source_ref=args.source_ref,
            checkout_dir=checkout_dir,
            sparse_paths=sorted(
                {
                    "llvm/docs",
                    *(variant.source_path for variant in variants_to_build),
                }
            ),
        )
        source_head_revision = run_capture(["git", "-C", str(checkout_dir), "rev-parse", "HEAD"])
        print(f"Resolved source head revision: {source_head_revision}")

        if args.install_requirements:
            requirements = checkout_dir / "llvm" / "docs" / "requirements.txt"
            if not requirements.is_file():
                raise SystemExit(f"Missing upstream requirements file: {requirements}")
            run([args.python_bin, "-m", "pip", "install", "--upgrade", "pip"])
            run([args.python_bin, "-m", "pip", "install", "-r", str(requirements)])

        build_root = temp_root_path / "build"
        for variant in variants_to_build:
            src = checkout_dir / variant.source_path
            if not src.is_dir():
                raise SystemExit(f"Missing source docs path in checkout: {src}")
            out = build_root / variant.variant_id
            out.parent.mkdir(parents=True, exist_ok=True)
            run([args.python_bin, "-m", "sphinx", "-b", "html", str(src), str(out)])

            target_dir = repo_root / variant.output_dir
            sync_variant_output(out, target_dir, variant)
            restore_bridge_assets(
                out_dir=target_dir,
                bridge_js=bridge_js,
                known_broken_links=known_broken_by_variant.get(variant.variant_id),
            )
            regenerate_indexes(repo_root, args.python_bin, variant)
            source_revision = latest_by_variant.get(variant.variant_id, "").strip() or source_head_revision
            write_sync_meta(
                repo_root=repo_root,
                variant=variant,
                repo_name=args.source_repo_name,
                source_ref=args.source_ref,
                source_revision=source_revision,
                source_head_revision=source_head_revision,
                latest_release=latest_release,
            )

    print("Docs sync complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
