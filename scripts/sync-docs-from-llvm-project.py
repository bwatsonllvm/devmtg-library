#!/usr/bin/env python3
"""Sync formatted docs from llvm/llvm-project using sparse checkout + local Sphinx builds.

This backend updates local docs artifacts without crawling llvm.org/clang.llvm.org/lldb.llvm.org.
It preserves frontend presentation/search integration and avoids destructive updates to local
catalog files such as docs/sources.json.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
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

VARIANT_BY_ID: dict[str, DocsVariant] = {variant.variant_id: variant for variant in VARIANTS}

PRESERVED_STATIC_RELATIVE_PATHS: tuple[str, ...] = (
    "_static/documentation_options.js",
    "_static/docs-book-index.js",
    "_static/docs-universal-search-index.js",
    "_static/docs-known-broken-links.txt",
    "_static/docs-sync-meta.json",
)

DEFAULT_NETWORK_RETRIES = 2
DEFAULT_RETRY_BACKOFF_SECONDS = 2.0


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
        help="Install upstream docs requirements.",
    )
    parser.add_argument(
        "--use-venv",
        dest="use_venv",
        action="store_true",
        default=True,
        help="Install docs dependencies in a temporary virtualenv (default: true).",
    )
    parser.add_argument(
        "--no-venv",
        dest="use_venv",
        action="store_false",
        help="Install docs dependencies in the current Python environment.",
    )
    parser.add_argument(
        "--variants",
        default="llvm-core,clang,lldb",
        help="Comma-separated docs variants to sync (llvm-core, clang, lldb).",
    )
    parser.add_argument(
        "--allow-partial",
        dest="allow_partial",
        action="store_true",
        default=True,
        help="Continue with successful variants when one variant fails (default: true).",
    )
    parser.add_argument(
        "--strict",
        dest="allow_partial",
        action="store_false",
        help="Fail immediately if any selected variant fails to build.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force rebuild even when upstream path revisions appear unchanged.",
    )
    return parser.parse_args()


def run(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    retries: int = 0,
    retry_backoff_seconds: float = DEFAULT_RETRY_BACKOFF_SECONDS,
    retry_label: str = "",
) -> None:
    rendered = " ".join(cmd)
    print(f"+ {rendered}")
    merged_env = None
    if env:
        merged_env = os.environ.copy()
        merged_env.update(env)
    attempts = max(int(retries), 0) + 1
    label = retry_label or (cmd[0] if cmd else "command")
    for attempt in range(1, attempts + 1):
        try:
            subprocess.run(
                cmd,
                cwd=str(cwd) if cwd else None,
                env=merged_env,
                check=True,
            )
            return
        except subprocess.CalledProcessError:
            if attempt >= attempts:
                raise
            delay = float(retry_backoff_seconds) * (2 ** (attempt - 1))
            print(
                f"WARNING: {label} failed "
                f"(attempt {attempt}/{attempts}); retrying in {delay:.1f}s..."
            )
            time.sleep(delay)


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


def venv_python_path(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


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


def parse_requested_variants(raw: str) -> list[DocsVariant]:
    aliases = {
        "llvm": "llvm-core",
        "llvm-core": "llvm-core",
        "core": "llvm-core",
        "clang": "clang",
        "lldb": "lldb",
    }
    requested: list[str] = []
    for token in str(raw or "").split(","):
        normalized = token.strip().lower()
        if not normalized:
            continue
        resolved = aliases.get(normalized)
        if not resolved:
            raise SystemExit(f"Unknown variant in --variants: {token!r}")
        if resolved not in requested:
            requested.append(resolved)
    if not requested:
        requested = [variant.variant_id for variant in VARIANTS]
    return [VARIANT_BY_ID[variant_id] for variant_id in requested]


def fetch_github_json(url: str, token: str, timeout: int = 25, retries: int = DEFAULT_NETWORK_RETRIES) -> object | None:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "llvm-library-docs-repo-sync/1.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers, method="GET")
    attempts = max(int(retries), 0) + 1
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout,
                context=ssl.create_default_context(),
            ) as response:
                raw = response.read().decode("utf-8", errors="replace")
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                print(f"WARNING: GitHub API returned invalid JSON ({url})")
                return None
        except Exception as exc:  # noqa: BLE001
            if attempt >= attempts:
                print(f"WARNING: GitHub API request failed ({url}): {exc}")
                return None
            delay = DEFAULT_RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1))
            print(
                f"WARNING: GitHub API request failed ({url}) "
                f"(attempt {attempt}/{attempts}); retrying in {delay:.1f}s... ({exc})"
            )
            time.sleep(delay)
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
        ],
        retries=DEFAULT_NETWORK_RETRIES,
        retry_label="git clone llvm-project",
    )
    run(["git", "-C", str(checkout_dir), "sparse-checkout", "init", "--cone"])
    run(["git", "-C", str(checkout_dir), "sparse-checkout", "set", *sparse_paths])
    run(["git", "-C", str(checkout_dir), "checkout", source_ref])


def snapshot_preserved_files(repo_root: Path, variant: DocsVariant) -> dict[Path, bytes]:
    snapshot: dict[Path, bytes] = {}
    if variant.variant_id == "llvm-core":
        sources_catalog = repo_root / "docs" / "sources.json"
        if sources_catalog.is_file():
            snapshot[sources_catalog] = sources_catalog.read_bytes()
    return snapshot


def restore_preserved_files(snapshot: dict[Path, bytes]) -> None:
    for path, content in snapshot.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def sync_variant_output(src_dir: Path, out_dir: Path, variant: DocsVariant) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    rsync_args = [
        "rsync",
        "-a",
        "--delete",
        "--exclude",
        ".DS_Store",
        "--exclude",
        ".buildinfo",
        "--exclude",
        ".doctrees/",
        "--exclude",
        "objects.inv",
    ]
    for keep_path in PRESERVED_STATIC_RELATIVE_PATHS:
        rsync_args.extend(["--exclude", keep_path])
    if variant.variant_id == "llvm-core":
        rsync_args.extend(
            [
                "--exclude",
                "clang/",
                "--exclude",
                "lldb/",
                "--exclude",
                "sources.json",
            ]
        )
    if variant.variant_id == "lldb":
        # These references are expensive to regenerate and may be absent from quick Sphinx-only builds.
        rsync_args.extend(["--exclude", "cpp_reference/", "--exclude", "python_reference/"])
    rsync_args.extend([f"{src_dir}/", f"{out_dir}/"])
    run(rsync_args)

    # Remove transient local build artifacts if they slip through.
    transient_paths = [".buildinfo", ".doctrees", "objects.inv"]
    for rel_path in transient_paths:
        path = out_dir / rel_path
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.exists():
            path.unlink(missing_ok=True)


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
            "--source-root",
            f"{docs_root}/_sources",
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


def create_lldb_stub_package(stub_root: Path) -> None:
    lldb_pkg = stub_root / "lldb"
    plugins_pkg = lldb_pkg / "plugins"
    utils_pkg = lldb_pkg / "utils"
    plugins_pkg.mkdir(parents=True, exist_ok=True)
    utils_pkg.mkdir(parents=True, exist_ok=True)

    (lldb_pkg / "__init__.py").write_text(
        "\n".join(
            [
                '"""Minimal LLDB API placeholder for docs-only Sphinx builds."""',
                "",
                "from . import plugins, utils",
                "",
                '__all__ = ["plugins", "utils"]',
                "",
                "def _placeholder(name: str):",
                '    doc = f"Placeholder for LLDB symbol: {name}"',
                '    return type(name, (), {"__doc__": doc})',
                "",
                "def __getattr__(name: str):",
                "    value = _placeholder(name)",
                "    globals()[name] = value",
                "    return value",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (utils_pkg / "__init__.py").write_text(
        "\n".join(
            [
                '"""Placeholder LLDB utility modules for docs-only builds."""',
                "",
            ]
        ),
        encoding="utf-8",
    )
    (utils_pkg / "symbolication.py").write_text(
        "\n".join(
            [
                '"""Placeholder LLDB symbolication API."""',
                "",
                "class Symbolicator:",
                '    """Placeholder symbolicator class."""',
                "",
                "    pass",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (plugins_pkg / "__init__.py").write_text(
        "\n".join(
            [
                '"""Placeholder LLDB plugin package for docs-only builds."""',
                "",
            ]
        ),
        encoding="utf-8",
    )
    plugin_modules = {
        "operating_system.py": "ScriptedThread",
        "scripted_frame_provider.py": "ScriptedFrameProvider",
        "scripted_process.py": "ScriptedProcess",
        "scripted_platform.py": "ScriptedPlatform",
        "scripted_thread_plan.py": "ScriptedThreadPlan",
    }
    for module_name, class_name in plugin_modules.items():
        (plugins_pkg / module_name).write_text(
            "\n".join(
                [
                    f'"""Placeholder module {module_name} for docs-only builds."""',
                    "",
                    f"class {class_name}:",
                    f'    """Placeholder {class_name}."""',
                    "",
                    "    pass",
                    "",
                ]
            ),
            encoding="utf-8",
        )


def ensure_output_is_sane(out_dir: Path, variant: DocsVariant) -> None:
    index_path = out_dir / "index.html"
    if not index_path.is_file():
        raise RuntimeError(f"{variant.variant_id} build missing index.html at {index_path}")
    html_count = sum(1 for _ in out_dir.rglob("*.html"))
    min_expected = {"llvm-core": 100, "clang": 80, "lldb": 30}[variant.variant_id]
    if html_count < min_expected:
        raise RuntimeError(
            f"{variant.variant_id} build produced too few HTML files: {html_count} (expected >= {min_expected})"
        )
    if variant.variant_id == "lldb":
        required_api_pages = (
            "python_api/lldb.SBDebugger.html",
            "python_api/lldb.SBTarget.html",
            "python_api/lldb.SBProcess.html",
            "python_api/lldb.SBThread.html",
            "python_api/lldb.SBFrame.html",
            "python_api/lldb.SBValue.html",
        )
        missing = [page for page in required_api_pages if not (out_dir / page).is_file()]
        if missing:
            raise RuntimeError(
                "lldb build missing required Python API pages; refusing to apply incomplete output: "
                + ", ".join(missing)
            )


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        raise SystemExit(f"Invalid --repo-root: {repo_root}")

    selected_variants = parse_requested_variants(args.variants)
    if not selected_variants:
        print("No variants selected; nothing to do.")
        return 0

    canonical_bridge_path = repo_root / "docs" / "_static" / "documentation_options.js"
    if not canonical_bridge_path.is_file():
        raise SystemExit(f"Missing bridge file: {canonical_bridge_path}")
    bridge_js = canonical_bridge_path.read_text(encoding="utf-8")

    sources_catalog = repo_root / "docs" / "sources.json"
    if not sources_catalog.is_file():
        raise SystemExit(f"Missing required docs catalog: {sources_catalog}")

    known_broken_by_variant: dict[str, str | None] = {}
    for variant in selected_variants:
        known_path = repo_root / variant.output_dir / "_static" / "docs-known-broken-links.txt"
        if known_path.is_file():
            known_broken_by_variant[variant.variant_id] = known_path.read_text(encoding="utf-8")
        else:
            known_broken_by_variant[variant.variant_id] = None

    latest_by_variant: dict[str, str] = {}
    for variant in selected_variants:
        latest = fetch_latest_path_commit(
            repo_name=args.source_repo_name,
            ref=args.source_ref,
            source_path=variant.source_path,
            token=args.github_token,
        )
        latest_by_variant[variant.variant_id] = latest

    variants_to_build: list[DocsVariant] = []
    for variant in selected_variants:
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
        print("Docs sync skipped: all selected upstream docs paths unchanged.")
        return 0

    print(
        "Docs variants to rebuild:",
        ", ".join(variant.variant_id for variant in variants_to_build),
    )

    latest_release = fetch_latest_release(args.source_repo_name, args.github_token)

    with tempfile.TemporaryDirectory(prefix="llvm-project-docs-sync-") as temp_root:
        temp_root_path = Path(temp_root)
        checkout_dir = temp_root_path / "llvm-project"
        build_python = str(args.python_bin)

        sparse_paths = {
            "llvm/docs",
            *(variant.source_path for variant in variants_to_build),
        }
        if any(variant.variant_id == "llvm-core" for variant in variants_to_build):
            # LLVM docs include snippets from these paths.
            sparse_paths.update(
                {
                    "llvm/examples",
                    "llvm/tools/llvm-debuginfo-analyzer",
                }
            )
        if any(variant.variant_id == "lldb" for variant in variants_to_build):
            sparse_paths.add("lldb/examples")

        ensure_repo_clone(
            source_repo_url=args.source_repo_url,
            source_ref=args.source_ref,
            checkout_dir=checkout_dir,
            sparse_paths=sorted(sparse_paths),
        )
        source_head_revision = run_capture(["git", "-C", str(checkout_dir), "rev-parse", "HEAD"])
        print(f"Resolved source head revision: {source_head_revision}")

        if args.install_requirements:
            if args.use_venv:
                venv_dir = temp_root_path / ".venv-docs-sync"
                run([args.python_bin, "-m", "venv", str(venv_dir)])
                venv_python = venv_python_path(venv_dir)
                if not venv_python.is_file():
                    raise SystemExit(f"Failed to create virtualenv python: {venv_python}")
                build_python = str(venv_python)

            run(
                [build_python, "-m", "pip", "install", "--upgrade", "pip"],
                retries=DEFAULT_NETWORK_RETRIES,
                retry_label="pip install --upgrade pip",
            )

            requirement_paths: list[Path] = []
            seen_req_paths: set[Path] = set()
            base_requirements = checkout_dir / "llvm" / "docs" / "requirements.txt"
            if base_requirements.is_file():
                requirement_paths.append(base_requirements)
                seen_req_paths.add(base_requirements)
            for variant in variants_to_build:
                candidate = checkout_dir / variant.source_path / "requirements.txt"
                if candidate.is_file() and candidate not in seen_req_paths:
                    requirement_paths.append(candidate)
                    seen_req_paths.add(candidate)
            if not requirement_paths:
                raise SystemExit("No upstream docs requirements files found.")
            for requirements in requirement_paths:
                run(
                    [build_python, "-m", "pip", "install", "-r", str(requirements)],
                    retries=DEFAULT_NETWORK_RETRIES,
                    retry_label=f"pip install -r {requirements.name}",
                )

        build_root = temp_root_path / "build"
        built_outputs: dict[str, Path] = {}
        build_failures: list[tuple[DocsVariant, str]] = []

        for variant in variants_to_build:
            src = checkout_dir / variant.source_path
            if not src.is_dir():
                raise SystemExit(f"Missing source docs path in checkout: {src}")
            out = build_root / variant.variant_id
            out.parent.mkdir(parents=True, exist_ok=True)

            sphinx_env: dict[str, str] = {}
            if variant.variant_id == "lldb":
                # LLDB docs conf.py inserts LLDB_SWIG_MODULE into sys.path and expects an importable `lldb`.
                lldb_stub_root = temp_root_path / "lldb-swig-stub"
                create_lldb_stub_package(lldb_stub_root)
                sphinx_env["LLDB_SWIG_MODULE"] = str(lldb_stub_root)

            try:
                run(
                    [build_python, "-m", "sphinx", "-b", "html", str(src), str(out)],
                    env=sphinx_env or None,
                )
                ensure_output_is_sane(out, variant)
                built_outputs[variant.variant_id] = out
            except Exception as exc:  # noqa: BLE001
                detail = f"{exc}"
                build_failures.append((variant, detail))
                print(f"WARNING: {variant.variant_id} build failed; {detail}")
                if not args.allow_partial:
                    raise

        if not built_outputs:
            if build_failures and args.allow_partial:
                print("WARNING: no selected docs variants met quality gates; leaving existing docs unchanged.")
                for variant, detail in build_failures:
                    print(f"  - skipped {variant.variant_id}: {detail}")
                return 0
            print("ERROR: no selected docs variants built successfully.")
            for variant, detail in build_failures:
                print(f"  - {variant.variant_id}: {detail}")
            return 1

        for variant in variants_to_build:
            out = built_outputs.get(variant.variant_id)
            if out is None:
                continue
            target_dir = repo_root / variant.output_dir
            preserved = snapshot_preserved_files(repo_root, variant)
            sync_variant_output(out, target_dir, variant)
            restore_preserved_files(preserved)
            restore_bridge_assets(
                out_dir=target_dir,
                bridge_js=bridge_js,
                known_broken_links=known_broken_by_variant.get(variant.variant_id),
            )
            regenerate_indexes(repo_root, build_python, variant)
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

        if build_failures:
            print("Docs sync completed with partial success:")
            for variant, detail in build_failures:
                print(f"  - skipped {variant.variant_id}: {detail}")
        else:
            print("Docs sync complete.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
