#!/usr/bin/env python3
"""Build/update website update log entries for newly added talks/resources/papers/blogs/docs.

Default mode:
  - compares current working tree JSON bundles against HEAD versions in git
  - records only newly added items:
      * talks
      * slides added to an existing talk
      * videos added to an existing talk
      * papers/blogs newly added to any papers/*.json bundle
      * docs metadata updates newly added to docs/*/_static/docs-sync-meta.json
  - collates talk + slides + video into one entry when they appear together

Retroactive mode:
  - replays commit history and backfills the same entry model from older commits
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import subprocess
import urllib.parse
from pathlib import Path

PART_ORDER = {
    "talk": 0,
    "slides": 1,
    "video": 2,
    "paper": 3,
    "blog": 4,
    "docs": 5,
}

DOCS_META_CONFIG_BY_PATH: dict[str, dict[str, str]] = {
    "docs/_static/docs-sync-meta.json": {
        "variantId": "llvm-core",
        "sourceName": "LLVM Core",
        "localUrl": "docs/",
    },
    "docs/clang/_static/docs-sync-meta.json": {
        "variantId": "clang",
        "sourceName": "Clang",
        "localUrl": "docs/clang/",
    },
    "docs/lldb/_static/docs-sync-meta.json": {
        "variantId": "lldb",
        "sourceName": "LLDB",
        "localUrl": "docs/lldb/",
    },
}

TRACKED_CHANGE_PATHS = [
    "devmtg/events",
    "papers",
    *DOCS_META_CONFIG_BY_PATH.keys(),
]

MAX_KEY_TOPICS_PER_ENTRY = 8
DEFAULT_KEY_TOPIC_CANONICAL = [
    "LLVM",
    "llvm-libgcc",
    "Clang",
    "clang-tools-extra",
    "MLIR",
    "Flang",
    "flang-rt",
    "LLD",
    "LLDB",
    "Polly",
    "cmake",
    "cross-project-tests",
    "OpenMP",
    "offload",
    "compiler-rt",
    "runtimes",
    "libc++",
    "libc++abi",
    "libc",
    "libclc",
    "libsycl",
    "libunwind",
    "BOLT",
    "orc-rt",
    "IR",
    "GPU",
    "Performance",
    "Security",
    "WASM",
]
DEFAULT_KEY_TOPIC_ALIASES = {
    "llvm": "LLVM",
    "llvm-libgcc": "llvm-libgcc",
    "llvmlibgcc": "llvm-libgcc",
    "clang": "Clang",
    "clangd": "Clang",
    "clang-tools-extra": "clang-tools-extra",
    "clangtoolsextra": "clang-tools-extra",
    "mlir": "MLIR",
    "openmp": "OpenMP",
    "libomp": "OpenMP",
    "offload": "offload",
    "offloading": "offload",
    "runtimes": "runtimes",
    "runtime": "runtimes",
    "ir": "IR",
    "intermediaterepresentation": "IR",
    "flang-rt": "flang-rt",
    "flangrt": "flang-rt",
    "gpu": "GPU",
    "cmake": "cmake",
    "cross-project-tests": "cross-project-tests",
    "crossprojecttests": "cross-project-tests",
    "libcxx": "libc++",
    "libc++abi": "libc++abi",
    "libcxxabi": "libc++abi",
    "libclc": "libclc",
    "libsycl": "libsycl",
    "libunwind": "libunwind",
    "orc-rt": "orc-rt",
    "orcrt": "orc-rt",
    "performance": "Performance",
    "security": "Security",
    "wasm": "WASM",
    "webassembly": "WASM",
}
TOPIC_TEXT_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bllvm\b", flags=re.IGNORECASE), "LLVM"),
    (re.compile(r"\bllvm[- ]?libgcc\b", flags=re.IGNORECASE), "llvm-libgcc"),
    (re.compile(r"\bclang(?:d)?\b", flags=re.IGNORECASE), "Clang"),
    (re.compile(r"\bclang[- ]tools[- ]extra\b|\bclang[- ](?:tidy|format|query)\b", flags=re.IGNORECASE), "clang-tools-extra"),
    (re.compile(r"\bmlir\b|\bmulti[- ]level intermediate representation\b", flags=re.IGNORECASE), "MLIR"),
    (re.compile(r"\bflang\b", flags=re.IGNORECASE), "Flang"),
    (re.compile(r"\bflang[- ]?rt\b", flags=re.IGNORECASE), "flang-rt"),
    (re.compile(r"\blld\b", flags=re.IGNORECASE), "LLD"),
    (re.compile(r"\blldb\b", flags=re.IGNORECASE), "LLDB"),
    (re.compile(r"\bcirct\b", flags=re.IGNORECASE), "CIRCT"),
    (re.compile(r"\bcmake\b", flags=re.IGNORECASE), "cmake"),
    (re.compile(r"\bcross[- ]project[- ]tests?\b", flags=re.IGNORECASE), "cross-project-tests"),
    (re.compile(r"\bopenmp\b|\blibomp\b", flags=re.IGNORECASE), "OpenMP"),
    (re.compile(r"\boffload(?:ing|ed)?\b|\blibomptarget\b", flags=re.IGNORECASE), "offload"),
    (re.compile(r"\bcompiler[- ]?rt\b|\blibfuzzer\b", flags=re.IGNORECASE), "compiler-rt"),
    (re.compile(r"\bllvm[- ]runtimes?\b|\bruntime (?:libraries|library)\b", flags=re.IGNORECASE), "runtimes"),
    (re.compile(r"\blibc\+\+\b", flags=re.IGNORECASE), "libc++"),
    (re.compile(r"\blibc\+\+abi\b|\blibcxxabi\b", flags=re.IGNORECASE), "libc++abi"),
    (re.compile(r"\blibc\b", flags=re.IGNORECASE), "libc"),
    (re.compile(r"\blibclc\b", flags=re.IGNORECASE), "libclc"),
    (re.compile(r"\blibsycl\b|\bsycl\b", flags=re.IGNORECASE), "libsycl"),
    (re.compile(r"\blibunwind\b", flags=re.IGNORECASE), "libunwind"),
    (re.compile(r"\bbolt\b", flags=re.IGNORECASE), "BOLT"),
    (re.compile(r"\borc[- ]?rt\b|\borc runtime\b", flags=re.IGNORECASE), "orc-rt"),
    (re.compile(r"\borc(?:\s*jit)?\b", flags=re.IGNORECASE), "ORC JIT"),
    (re.compile(r"\bclangir\b|\bclang\s+ir\b", flags=re.IGNORECASE), "ClangIR"),
    (re.compile(r"\bllvm\s+ir\b|\bintermediate representation\b|\bssa\b", flags=re.IGNORECASE), "IR"),
    (re.compile(r"\bjust[- ]in[- ]time\b|\bjit\b", flags=re.IGNORECASE), "JIT"),
    (re.compile(r"\blto\b|\blink[- ]time optimization\b", flags=re.IGNORECASE), "LTO"),
    (re.compile(r"\bpgo\b|\bprofile[- ]guided optimization\b", flags=re.IGNORECASE), "PGO"),
    (re.compile(r"\btesting\b|\bfuzz(?:ing|er|ers)?\b", flags=re.IGNORECASE), "Testing"),
    (
        re.compile(
            r"\bsanitizer(?:s)?\b|\baddresssanitizer\b|\bthreadsanitizer\b|\bubsan\b|\basan\b|\btsan\b",
            flags=re.IGNORECASE,
        ),
        "Sanitizers",
    ),
    (re.compile(r"\bsecurity\b|\bmemory safety\b|\bcontrol flow integrity\b|\bcfi\b", flags=re.IGNORECASE), "Security"),
    (re.compile(r"\bperformance\b", flags=re.IGNORECASE), "Performance"),
    (re.compile(r"\boptimizations?\b|\boptimisation\b", flags=re.IGNORECASE), "Optimizations"),
    (re.compile(r"\bgpu(?:s)?\b", flags=re.IGNORECASE), "GPU"),
    (re.compile(r"\bcuda\b", flags=re.IGNORECASE), "CUDA"),
    (re.compile(r"\bopencl\b", flags=re.IGNORECASE), "OpenCL"),
    (re.compile(r"\bhip\b|\brocm\b", flags=re.IGNORECASE), "HIP"),
    (re.compile(r"\brisc[- ]?v\b", flags=re.IGNORECASE), "RISC-V"),
    (re.compile(r"\baarch64\b|\barm64\b", flags=re.IGNORECASE), "AArch64"),
    (re.compile(r"\bx86[-_ ]?64\b", flags=re.IGNORECASE), "x86-64"),
    (re.compile(r"\bwebassembly\b|\bwasm(?:32|64)?\b", flags=re.IGNORECASE), "WASM"),
    (re.compile(r"\bartificial intelligence\b|\bagentic ai\b|\bai\b", flags=re.IGNORECASE), "AI"),
    (re.compile(r"\bmachine learning\b|\bdeep learning\b|\breinforcement learning\b|\bml\b", flags=re.IGNORECASE), "ML"),
    (re.compile(r"\brust\b", flags=re.IGNORECASE), "Rust"),
    (re.compile(r"\bswift\b", flags=re.IGNORECASE), "Swift"),
    (re.compile(r"\bquantum (?:computing|compiler|compilation)\b", flags=re.IGNORECASE), "Quantum Computing"),
    (re.compile(r"\bllvm foundation\b|\bfoundation update(?:s)?\b", flags=re.IGNORECASE), "LLVM Foundation"),
    (re.compile(r"\bmcp\b", flags=re.IGNORECASE), "MCP"),
    (re.compile(r"\bvplan\b", flags=re.IGNORECASE), "VPlan"),
    (re.compile(r"\bmojo\b", flags=re.IGNORECASE), "Mojo"),
]


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def has_text(value: str | None) -> bool:
    return bool(collapse_ws(str(value or "")))


PLACEHOLDER_URL_VALUES = {"none", "null", "nil", "nan", "n/a", "na", "undefined"}


def is_placeholder_url_value(value: str | None) -> bool:
    return collapse_ws(str(value or "")).lower() in PLACEHOLDER_URL_VALUES


def normalize_topic_key(value: str) -> str:
    return re.sub(r"[^a-z0-9+]+", "", collapse_ws(value).lower())


def parse_js_quoted_values(raw: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for single, double in re.findall(r"'([^']+)'|\"([^\"]+)\"", raw):
        value = collapse_ws(single or double)
        key = normalize_topic_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def parse_key_topic_aliases(raw: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for line in raw.splitlines():
        cleaned = line.split("//", 1)[0].strip().rstrip(",").strip()
        if not cleaned:
            continue
        match = re.match(
            r"(?:(['\"])(?P<qkey>.*?)\1|(?P<key>[A-Za-z0-9_]+))\s*:\s*(['\"])(?P<value>.*?)\4$",
            cleaned,
        )
        if not match:
            continue
        alias = collapse_ws(match.group("qkey") or match.group("key") or "")
        target = collapse_ws(match.group("value") or "")
        if not alias or not target:
            continue
        pairs.append((alias, target))
    return pairs


def build_topic_lookup(repo_root: Path) -> dict[str, str]:
    canonical_topics = list(DEFAULT_KEY_TOPIC_CANONICAL)
    aliases = dict(DEFAULT_KEY_TOPIC_ALIASES)

    library_utils_path = (repo_root / "js" / "shared" / "library-utils.js").resolve()
    if library_utils_path.exists():
        try:
            text = library_utils_path.read_text(encoding="utf-8")

            canonical_match = re.search(
                r"const\s+KEY_TOPIC_CANONICAL\s*=\s*\[(.*?)\];",
                text,
                flags=re.DOTALL,
            )
            if canonical_match:
                parsed = parse_js_quoted_values(canonical_match.group(1))
                if parsed:
                    canonical_topics = parsed

            alias_match = re.search(
                r"const\s+KEY_TOPIC_ALIAS_MAP_RAW\s*=\s*\{(.*?)\};",
                text,
                flags=re.DOTALL,
            )
            if alias_match:
                for alias, canonical in parse_key_topic_aliases(alias_match.group(1)):
                    aliases[normalize_topic_key(alias)] = canonical
        except Exception:
            # Keep defaults if parsing library-utils.js fails.
            pass

    canonical_by_key: dict[str, str] = {}
    for topic in canonical_topics:
        key = normalize_topic_key(topic)
        if key and key not in canonical_by_key:
            canonical_by_key[key] = topic

    topic_by_key = dict(canonical_by_key)
    for alias_key, target in aliases.items():
        key = normalize_topic_key(alias_key)
        canonical_topic = canonical_by_key.get(normalize_topic_key(target))
        if key and canonical_topic:
            topic_by_key[key] = canonical_topic

    if "llvm" not in topic_by_key:
        topic_by_key["llvm"] = canonical_by_key.get("llvm", "LLVM")
    return topic_by_key


def text_list(value: object) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, tuple):
        raw_values = list(value)
    elif isinstance(value, str):
        # Support legacy comma-delimited values if present.
        raw_values = re.split(r"[;,|]", value) if any(sep in value for sep in (",", ";", "|")) else [value]
    else:
        return []

    out: list[str] = []
    for item in raw_values:
        cleaned = collapse_ws(str(item))
        if cleaned:
            out.append(cleaned)
    return out


def collect_key_topics(seed_values: list[str], text: str, topic_by_key: dict[str, str], limit: int = MAX_KEY_TOPICS_PER_ENTRY) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()

    def add(raw_value: str) -> None:
        key = normalize_topic_key(raw_value)
        if not key:
            return
        canonical = topic_by_key.get(key)
        if not canonical:
            singular = key[:-1] if key.endswith("s") and len(key) > 3 else key
            canonical = topic_by_key.get(singular, "")
        canonical_key = normalize_topic_key(canonical)
        if not canonical or not canonical_key or canonical_key in seen:
            return
        seen.add(canonical_key)
        out.append(canonical)

    for value in seed_values:
        add(value)
        if len(out) >= limit:
            return out[:limit]

    haystack = collapse_ws(text)
    if haystack:
        for pattern, topic in TOPIC_TEXT_RULES:
            if len(out) >= limit:
                break
            if pattern.search(haystack):
                add(topic)

        compact_text_key = normalize_topic_key(haystack)
        if compact_text_key and len(out) < limit:
            alias_items = sorted(topic_by_key.items(), key=lambda pair: len(pair[0]), reverse=True)
            for alias_key, canonical in alias_items:
                if len(out) >= limit:
                    break
                if len(alias_key) < 4:
                    continue
                if alias_key in compact_text_key:
                    add(canonical)

    if not out:
        fallback = topic_by_key.get("llvm", "LLVM")
        if fallback:
            out.append(fallback)
    return out[:limit]


def talk_key_topics(talk: dict, topic_by_key: dict[str, str]) -> list[str]:
    seed_values = [
        *text_list(talk.get("tags")),
        *text_list(talk.get("keywords")),
    ]
    text = " ".join(
        part
        for part in [
            collapse_ws(str(talk.get("title", ""))),
            collapse_ws(str(talk.get("abstract", ""))),
            collapse_ws(str(talk.get("category", ""))),
        ]
        if part
    )
    return collect_key_topics(seed_values, text, topic_by_key)


def paper_key_topics(paper: dict, topic_by_key: dict[str, str]) -> list[str]:
    seed_values = [
        *text_list(paper.get("tags")),
        *text_list(paper.get("keywords")),
        *text_list(paper.get("matchedSubprojects")),
    ]
    text = " ".join(
        part
        for part in [
            collapse_ws(str(paper.get("title", ""))),
            collapse_ws(str(paper.get("abstract", ""))),
            collapse_ws(str(paper.get("publication", ""))),
            collapse_ws(str(paper.get("venue", ""))),
            collapse_ws(str(paper.get("sourceName", ""))),
            collapse_ws(str(paper.get("source", ""))),
        ]
        if part
    )
    return collect_key_topics(seed_values, text, topic_by_key)


def event_bundle_paths(repo_root: Path) -> list[Path]:
    index_path = repo_root / "devmtg" / "events" / "index.json"
    if not index_path.exists():
        return []
    payload = load_json_file(index_path)
    files = payload.get("eventFiles") or []
    if not isinstance(files, list):
        return []

    paths: list[Path] = []
    for rel_name in files:
        name = collapse_ws(str(rel_name))
        if not name or not name.endswith(".json") or name == "index.json":
            continue
        path = (repo_root / "devmtg" / "events" / name).resolve()
        if path.exists():
            paths.append(path)
    return paths


def paper_bundle_paths(repo_root: Path) -> list[Path]:
    index_path = repo_root / "papers" / "index.json"
    if not index_path.exists():
        return []
    payload = load_json_file(index_path)
    files = payload.get("paperFiles") or []
    if not isinstance(files, list):
        return []

    paths: list[Path] = []
    for rel_name in files:
        name = collapse_ws(str(rel_name))
        if not name or not name.endswith(".json") or name == "index.json":
            continue
        path = (repo_root / "papers" / name).resolve()
        if path.exists():
            paths.append(path)
    return paths


def score_talk_record(talk: dict) -> int:
    return (
        len(text_list(talk.get("tags")))
        + len(text_list(talk.get("keywords")))
        + (1 if has_text(str(talk.get("abstract", ""))) else 0)
        + (1 if has_text(str(talk.get("title", ""))) else 0)
    )


def score_paper_record(paper: dict) -> int:
    return (
        len(text_list(paper.get("tags")))
        + len(text_list(paper.get("keywords")))
        + len(text_list(paper.get("matchedSubprojects")))
        + (1 if has_text(str(paper.get("abstract", ""))) else 0)
        + (1 if has_text(str(paper.get("title", ""))) else 0)
    )


def build_talk_lookup(repo_root: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for bundle_path in event_bundle_paths(repo_root):
        payload = load_json_file(bundle_path)
        talks = payload.get("talks") or []
        if not isinstance(talks, list):
            continue
        for talk in talks:
            if not isinstance(talk, dict):
                continue
            talk_id = collapse_ws(str(talk.get("id", "")))
            if not talk_id:
                continue
            existing = out.get(talk_id)
            if not existing or score_talk_record(talk) >= score_talk_record(existing):
                out[talk_id] = talk
    return out


def build_paper_lookup(repo_root: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for bundle_path in paper_bundle_paths(repo_root):
        payload = load_json_file(bundle_path)
        papers = payload.get("papers") or []
        if not isinstance(papers, list):
            continue
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            paper_id = collapse_ws(str(paper.get("id", "")))
            if not paper_id:
                continue
            existing = out.get(paper_id)
            if not existing or score_paper_record(paper) >= score_paper_record(existing):
                out[paper_id] = paper
    return out


def entry_key_topics(
    entry: dict,
    talk_lookup: dict[str, dict],
    paper_lookup: dict[str, dict],
    topic_by_key: dict[str, str],
) -> list[str]:
    kind = collapse_ws(str(entry.get("kind", ""))).lower()
    seed_values = text_list(entry.get("keyTopics"))
    text_parts = [
        collapse_ws(str(entry.get("title", ""))),
        collapse_ws(str(entry.get("source", ""))),
        collapse_ws(str(entry.get("meetingName", ""))),
        collapse_ws(str(entry.get("meetingSlug", ""))),
    ]

    if kind == "talk":
        talk_id = collapse_ws(str(entry.get("talkId", "")))
        talk = talk_lookup.get(talk_id)
        if talk:
            seed_values.extend(text_list(talk.get("tags")))
            seed_values.extend(text_list(talk.get("keywords")))
            text_parts.extend(
                [
                    collapse_ws(str(talk.get("title", ""))),
                    collapse_ws(str(talk.get("abstract", ""))),
                    collapse_ws(str(talk.get("category", ""))),
                ]
            )
    elif kind in {"paper", "blog"}:
        paper_id = collapse_ws(str(entry.get("paperId", "")))
        paper = paper_lookup.get(paper_id)
        if paper:
            seed_values.extend(text_list(paper.get("tags")))
            seed_values.extend(text_list(paper.get("keywords")))
            seed_values.extend(text_list(paper.get("matchedSubprojects")))
            text_parts.extend(
                [
                    collapse_ws(str(paper.get("title", ""))),
                    collapse_ws(str(paper.get("abstract", ""))),
                    collapse_ws(str(paper.get("publication", ""))),
                    collapse_ws(str(paper.get("venue", ""))),
                ]
            )
    elif kind == "docs":
        seed_values.extend(
            [
                collapse_ws(str(entry.get("docsSourceName", ""))),
                collapse_ws(str(entry.get("docsVariant", ""))),
            ]
        )
        text_parts.extend(
            [
                collapse_ws(str(entry.get("docsSourceName", ""))),
                collapse_ws(str(entry.get("docsVariant", ""))),
                collapse_ws(str(entry.get("sourceRepo", ""))),
                collapse_ws(str(entry.get("sourcePath", ""))),
                collapse_ws(str(entry.get("sourceUrl", ""))),
                collapse_ws(str(entry.get("releaseName", ""))),
                collapse_ws(str(entry.get("releaseTag", ""))),
            ]
        )

    return collect_key_topics(seed_values, " ".join(part for part in text_parts if part), topic_by_key)


def load_json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_json_text(raw: str) -> dict:
    return json.loads(raw)


def normalize_parts(parts: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for part in sorted(parts, key=lambda value: PART_ORDER.get(collapse_ws(value).lower(), 999)):
        key = collapse_ws(part).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def run_git(repo_root: Path, args: list[str]) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        stderr = collapse_ws(proc.stderr)
        raise RuntimeError(f"git {' '.join(args)} failed: {stderr or 'unknown error'}")
    return proc.stdout


def git_show_file_at_revision(repo_root: Path, revision: str, rel_path: str) -> str | None:
    proc = subprocess.run(
        ["git", "show", f"{revision}:{rel_path}"],
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return proc.stdout
    stderr = collapse_ws(proc.stderr).lower()
    if (
        "does not exist in 'head'" in stderr
        or "exists on disk, but not in 'head'" in stderr
        or "does not exist in" in stderr
        or "exists on disk, but not in" in stderr
    ):
        return None
    raise RuntimeError(f"git show {revision}:{rel_path} failed: {collapse_ws(proc.stderr)}")


def normalize_git_path(rel_path: str) -> str:
    return collapse_ws(rel_path).replace("\\", "/")


def list_changed_json_paths(repo_root: Path) -> set[str]:
    changed: set[str] = set()

    diff_text = run_git(repo_root, ["diff", "--name-only", "HEAD", "--", *TRACKED_CHANGE_PATHS])
    for line in diff_text.splitlines():
        rel = normalize_git_path(line)
        if rel:
            changed.add(rel)

    untracked_text = run_git(
        repo_root,
        ["ls-files", "--others", "--exclude-standard", "--", *TRACKED_CHANGE_PATHS],
    )
    for line in untracked_text.splitlines():
        rel = normalize_git_path(line)
        if rel:
            changed.add(rel)

    return {path for path in changed if path.endswith(".json")}


def is_event_json_path(rel_path: str) -> bool:
    path = normalize_git_path(rel_path)
    return path.startswith("devmtg/events/") and path.endswith(".json") and not path.endswith("index.json")


def is_paper_json_path(rel_path: str) -> bool:
    path = normalize_git_path(rel_path)
    return path.startswith("papers/") and path.endswith(".json") and path != "papers/index.json"


def is_docs_meta_json_path(rel_path: str) -> bool:
    return normalize_git_path(rel_path) in DOCS_META_CONFIG_BY_PATH


def talk_has_slides(talk: dict) -> bool:
    return has_text(str(talk.get("slidesUrl", "")))


def talk_has_video(talk: dict) -> bool:
    return has_text(str(talk.get("videoUrl", ""))) or has_text(str(talk.get("videoId", "")))


def talk_video_url(talk: dict) -> str:
    explicit = collapse_ws(str(talk.get("videoUrl", "")))
    if explicit:
        return sanitize_http_url(explicit)
    vid = collapse_ws(str(talk.get("videoId", "")))
    if vid:
        return f"https://www.youtube.com/watch?v={urllib.parse.quote(vid, safe='')}"
    return ""


def meeting_sort_hint(slug: str) -> str:
    match = re.match(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$", collapse_ws(slug))
    if not match:
        return "0000-00-00"
    year, month, day = match.group(1), match.group(2), match.group(3) or "00"
    return f"{year}-{month}-{day}"


def paper_sort_hint(year: str) -> str:
    clean = collapse_ws(year)
    if re.fullmatch(r"\d{4}", clean):
        return f"{clean}-00-00"
    return "0000-00-00"


def is_blog_work(paper: dict) -> bool:
    source = collapse_ws(str(paper.get("source", ""))).lower()
    source_name = collapse_ws(str(paper.get("sourceName", ""))).lower()
    work_type = collapse_ws(str(paper.get("type", ""))).lower()
    publication = collapse_ws(str(paper.get("publication", ""))).lower()
    venue = collapse_ws(str(paper.get("venue", ""))).lower()

    if source in {"llvm-blog-www", "llvm-www-blog"}:
        return True
    if work_type in {"blog", "blog-post", "post"}:
        return True
    if "llvm project blog" in source_name:
        return True
    if "llvm project blog" in publication or "llvm project blog" in venue:
        return True

    tags = paper.get("tags")
    if isinstance(tags, list):
        for tag in tags:
            if collapse_ws(str(tag)).lower() == "blog":
                return True
    return False


def normalize_site_base(raw_site_base: str) -> str:
    value = collapse_ws(raw_site_base)
    if not value or value == ".":
        return ""
    if re.match(r"^https?://", value, flags=re.IGNORECASE):
        return value.rstrip("/")
    if value == "/":
        return "/"
    if value.startswith("/"):
        return "/" + value.strip("/")
    return value.strip("/")


def build_detail_url(site_base: str, page_name: str, item_id: str) -> str:
    encoded_id = urllib.parse.quote(item_id, safe="")
    target = f"{page_name}?id={encoded_id}"
    if not site_base:
        return target
    if site_base == "/":
        return f"/{target}"
    return f"{site_base.rstrip('/')}/{target}"


def build_local_url(site_base: str, raw_path: str) -> str:
    target = collapse_ws(raw_path).lstrip("/")
    if not target:
        target = "updates/"
    if not site_base:
        return target
    if site_base == "/":
        return f"/{target}"
    return f"{site_base.rstrip('/')}/{target}"


def sanitize_http_url(raw_url: str) -> str:
    url = collapse_ws(raw_url)
    if not url:
        return ""
    if is_placeholder_url_value(url):
        return ""
    try:
        parsed = urllib.parse.urlsplit(url)
    except Exception:
        return ""
    if parsed.scheme.lower() not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    return urllib.parse.urlunsplit(parsed)


def normalize_internal_route_path(raw_path: str) -> str:
    path = collapse_ws(raw_path).lstrip("/")
    if not path:
        return path
    aliases = {
        "talk.html": "talks/talk.html",
        "paper.html": "papers/paper.html",
        "events.html": "talks/events.html",
        "papers.html": "papers/",
        "blogs.html": "blogs/",
        "people.html": "people/",
        "about.html": "about/",
        "updates.html": "updates/",
    }
    return aliases.get(path.lower(), path)


def normalize_internal_library_url(raw_url: str, site_base: str) -> str:
    url = collapse_ws(raw_url)
    if not url:
        return ""
    if is_placeholder_url_value(url):
        return ""
    if url.startswith("#"):
        return url
    if url.startswith("//"):
        return sanitize_http_url(f"https:{url}")
    if re.match(r"^[a-z][a-z0-9+.-]*:", url, flags=re.IGNORECASE):
        return sanitize_http_url(url)

    parsed = urllib.parse.urlsplit(url)
    path = parsed.path or ""
    suffix = ""
    if parsed.query:
        suffix += f"?{parsed.query}"
    if parsed.fragment:
        suffix += f"#{parsed.fragment}"

    from_devmtg_prefix = path.startswith("/devmtg/")
    if from_devmtg_prefix:
        path = path[len("/devmtg/") :]

    normalized_path = normalize_internal_route_path(path)
    if normalized_path != collapse_ws(path).lstrip("/") or from_devmtg_prefix:
        if not site_base:
            return normalized_path + suffix
        if site_base == "/":
            return f"/{normalized_path}{suffix}"
        return f"{site_base.rstrip('/')}/{normalized_path}{suffix}"

    if not site_base and path.startswith("/"):
        return path + suffix

    return url


def sanitize_update_entry_urls(entry: dict, site_base: str) -> None:
    raw_url = collapse_ws(str(entry.get("url", "")))
    normalized_url = normalize_internal_library_url(raw_url, site_base)
    entry["url"] = normalized_url or "updates/"

    for field in ("videoUrl", "slidesUrl", "paperUrl", "sourceUrl", "blogUrl", "sourceCommitUrl", "releaseUrl"):
        safe = sanitize_http_url(str(entry.get(field, "")))
        if safe:
            entry[field] = safe
        else:
            entry.pop(field, None)


def talks_by_id(payload: dict | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not payload:
        return out
    talks = payload.get("talks") or []
    if not isinstance(talks, list):
        return out
    for talk in talks:
        if not isinstance(talk, dict):
            continue
        talk_id = collapse_ws(str(talk.get("id", "")))
        if talk_id:
            out[talk_id] = talk
    return out


def papers_by_id(payload: dict | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not payload:
        return out
    papers = payload.get("papers") or []
    if not isinstance(papers, list):
        return out
    for paper in papers:
        if not isinstance(paper, dict):
            continue
        paper_id = collapse_ws(str(paper.get("id", "")))
        if paper_id:
            out[paper_id] = paper
    return out


def talk_entry(
    talk: dict,
    parts: list[str],
    logged_at_iso: str,
    site_base: str,
    topic_by_key: dict[str, str],
) -> dict:
    talk_id = collapse_ws(str(talk.get("id", "")))
    title = collapse_ws(str(talk.get("title", ""))) or "(Untitled talk)"
    meeting_slug = collapse_ws(str(talk.get("meeting", "")))
    meeting_name = collapse_ws(str(talk.get("meetingName", "")))
    meeting_date = collapse_ws(str(talk.get("meetingDate", "")))
    slides_url = sanitize_http_url(str(talk.get("slidesUrl", "")))
    video_url = talk_video_url(talk)
    detail_url = build_detail_url(site_base, "talks/talk.html", talk_id)

    normalized_parts = normalize_parts(parts)
    fingerprint = f"talk:{talk_id}:{','.join(normalized_parts)}"
    entry = {
        "kind": "talk",
        "loggedAt": logged_at_iso,
        "sortHint": meeting_sort_hint(meeting_slug),
        "fingerprint": fingerprint,
        "parts": normalized_parts,
        "title": title,
        "url": detail_url,
        "talkId": talk_id,
        "meetingSlug": meeting_slug,
        "meetingName": meeting_name,
        "meetingDate": meeting_date,
        "keyTopics": talk_key_topics(talk, topic_by_key),
    }
    if slides_url:
        entry["slidesUrl"] = slides_url
    if video_url:
        entry["videoUrl"] = video_url
    return entry


def paper_entry(paper: dict, logged_at_iso: str, site_base: str, topic_by_key: dict[str, str]) -> dict:
    paper_id = collapse_ws(str(paper.get("id", "")))
    year = collapse_ws(str(paper.get("year", "")))
    source = collapse_ws(str(paper.get("sourceName", ""))) or collapse_ws(str(paper.get("source", "")))
    paper_url = sanitize_http_url(str(paper.get("paperUrl", "")))
    source_url = sanitize_http_url(str(paper.get("sourceUrl", "")))
    detail_url = build_detail_url(site_base, "papers/paper.html", paper_id)
    is_blog = is_blog_work(paper)
    kind = "blog" if is_blog else "paper"
    part = "blog" if is_blog else "paper"
    default_title = "(Untitled blog post)" if is_blog else "(Untitled paper)"
    title = collapse_ws(str(paper.get("title", ""))) or default_title

    entry = {
        "kind": kind,
        "loggedAt": logged_at_iso,
        "sortHint": paper_sort_hint(year),
        "fingerprint": f"{kind}:{paper_id}",
        "parts": [part],
        "title": title,
        "url": detail_url,
        "paperId": paper_id,
        "year": year,
        "keyTopics": paper_key_topics(paper, topic_by_key),
    }
    if source:
        entry["source"] = source
    if paper_url:
        entry["paperUrl"] = paper_url
    if source_url:
        entry["sourceUrl"] = source_url
    if is_blog:
        blog_url = source_url or paper_url
        if blog_url:
            entry["blogUrl"] = blog_url
    return entry


def normalize_iso_utc(raw_value: str) -> str:
    value = collapse_ws(raw_value)
    if not value:
        return ""
    try:
        parsed = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_dt.timezone.utc)
    return parsed.astimezone(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def docs_sort_hint(value: str) -> str:
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", collapse_ws(value))
    if not match:
        return "0000-00-00"
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"


def docs_release_payload(meta: dict | None) -> dict:
    if not isinstance(meta, dict):
        return {}
    raw_release = meta.get("latestRelease")
    if isinstance(raw_release, dict):
        return raw_release
    return {}


def docs_change_signature(meta: dict | None) -> tuple[str, ...]:
    if not isinstance(meta, dict):
        return ("", "", "", "", "", "", "", "")

    source_revision = collapse_ws(str(meta.get("sourceRevision", "")))
    source_head_revision = collapse_ws(str(meta.get("sourceHeadRevision", "")))
    source_repo = collapse_ws(str(meta.get("sourceRepo", "")))
    source_path = collapse_ws(str(meta.get("sourcePath", "")))
    source_url = sanitize_http_url(str(meta.get("sourceUrl", "")))
    release = docs_release_payload(meta)
    release_tag = collapse_ws(str(release.get("tag", "")))
    release_version = collapse_ws(str(release.get("version", "")))
    synced_at = normalize_iso_utc(str(meta.get("syncedAt", "")))

    # If upstream revision fields are present, ignore syncedAt-only churn.
    if source_revision or source_head_revision:
        synced_at = ""

    return (
        source_revision,
        source_head_revision,
        source_repo,
        source_path,
        source_url,
        release_tag,
        release_version,
        synced_at,
    )


def docs_source_commit_url(source_repo: str, source_revision: str) -> str:
    repo = collapse_ws(source_repo)
    revision = collapse_ws(source_revision)
    if not repo or not revision:
        return ""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        return ""
    if not re.fullmatch(r"[0-9a-fA-F]{7,64}", revision):
        return ""
    return f"https://github.com/{repo}/commit/{revision}"


def docs_entry(
    current_meta: dict,
    rel_path: str,
    logged_at_iso: str,
    site_base: str,
    topic_by_key: dict[str, str],
) -> dict:
    config = DOCS_META_CONFIG_BY_PATH.get(normalize_git_path(rel_path), {})
    variant_id = collapse_ws(str(config.get("variantId", ""))) or "docs"
    source_name = collapse_ws(str(config.get("sourceName", ""))) or "LLVM Docs"
    local_url = collapse_ws(str(config.get("localUrl", ""))) or "docs/"

    source_repo = collapse_ws(str(current_meta.get("sourceRepo", "")))
    source_path = collapse_ws(str(current_meta.get("sourcePath", "")))
    source_url = sanitize_http_url(str(current_meta.get("sourceUrl", "")))
    source_revision = collapse_ws(str(current_meta.get("sourceRevision", "")))
    source_head_revision = collapse_ws(str(current_meta.get("sourceHeadRevision", "")))
    effective_revision = source_revision or source_head_revision
    synced_at = normalize_iso_utc(str(current_meta.get("syncedAt", "")))
    entry_logged_at = synced_at or logged_at_iso
    release = docs_release_payload(current_meta)
    release_name = collapse_ws(str(release.get("name", "")))
    release_tag = collapse_ws(str(release.get("tag", "")))
    release_version = collapse_ws(str(release.get("version", "")))
    release_url = sanitize_http_url(str(release.get("githubUrl", "")))
    source_commit_url = docs_source_commit_url(source_repo, effective_revision)
    source_label = source_repo or "llvm/llvm-project"

    fingerprint_token = (
        effective_revision
        or release_tag
        or synced_at
        or logged_at_iso
    )
    fingerprint_token = re.sub(r"[^A-Za-z0-9._:-]+", "-", collapse_ws(fingerprint_token)).strip("-") or "snapshot"

    title = f"{source_name} documentation update"
    if release_name:
        title = f"{title} ({release_name})"

    key_topic_seed = [source_name]
    if variant_id == "llvm-core":
        key_topic_seed.append("LLVM")
    elif variant_id == "clang":
        key_topic_seed.append("Clang")
    elif variant_id == "lldb":
        key_topic_seed.append("LLDB")

    key_topics = collect_key_topics(
        key_topic_seed,
        " ".join(
            value
            for value in [
                source_name,
                variant_id,
                source_label,
                source_path,
                source_url,
                release_name,
                release_tag,
                release_version,
            ]
            if value
        ),
        topic_by_key,
    )

    entry = {
        "kind": "docs",
        "loggedAt": entry_logged_at,
        "sortHint": docs_sort_hint(entry_logged_at),
        "fingerprint": f"docs:{variant_id}:{fingerprint_token}",
        "parts": ["docs"],
        "title": title,
        "url": build_local_url(site_base, local_url),
        "docsVariant": variant_id,
        "docsSourceName": source_name,
        "source": source_label,
        "keyTopics": key_topics,
    }
    if synced_at:
        entry["syncedAt"] = synced_at
    if source_repo:
        entry["sourceRepo"] = source_repo
    if source_path:
        entry["sourcePath"] = source_path
    if source_url:
        entry["sourceUrl"] = source_url
    if source_revision:
        entry["sourceRevision"] = source_revision
    if source_head_revision:
        entry["sourceHeadRevision"] = source_head_revision
    if source_commit_url:
        entry["sourceCommitUrl"] = source_commit_url
    if release_name:
        entry["releaseName"] = release_name
    if release_tag:
        entry["releaseTag"] = release_tag
    if release_version:
        entry["releaseVersion"] = release_version
    if release_url:
        entry["releaseUrl"] = release_url
    return entry


def diff_docs_entries(
    current_payload: dict | None,
    prev_payload: dict | None,
    rel_path: str,
    logged_at_iso: str,
    site_base: str,
    topic_by_key: dict[str, str],
) -> list[dict]:
    if not isinstance(current_payload, dict):
        return []
    if docs_change_signature(current_payload) == docs_change_signature(prev_payload):
        return []
    return [docs_entry(current_payload, rel_path, logged_at_iso, site_base, topic_by_key)]


def diff_talk_entries(
    current_payload: dict | None,
    prev_payload: dict | None,
    logged_at_iso: str,
    site_base: str,
    topic_by_key: dict[str, str],
) -> list[dict]:
    entries: list[dict] = []
    current_talks = talks_by_id(current_payload)
    prev_talks = talks_by_id(prev_payload)

    for talk_id, current_talk in current_talks.items():
        prev_talk = prev_talks.get(talk_id)
        parts: list[str] = []

        if prev_talk is None:
            parts.append("talk")
        if talk_has_slides(current_talk) and not talk_has_slides(prev_talk or {}):
            parts.append("slides")
        if talk_has_video(current_talk) and not talk_has_video(prev_talk or {}):
            parts.append("video")

        if parts:
            entries.append(talk_entry(current_talk, parts, logged_at_iso, site_base, topic_by_key))
    return entries


def diff_paper_entries(
    current_payload: dict | None,
    prev_payload: dict | None,
    logged_at_iso: str,
    site_base: str,
    topic_by_key: dict[str, str],
) -> list[dict]:
    entries: list[dict] = []
    current_papers = papers_by_id(current_payload)
    prev_papers = papers_by_id(prev_payload)

    for paper_id, current_paper in current_papers.items():
        if paper_id in prev_papers:
            continue
        entries.append(paper_entry(current_paper, logged_at_iso, site_base, topic_by_key))
    return entries


def sort_entries(entries: list[dict]) -> list[dict]:
    return sorted(
        entries,
        key=lambda entry: (
            collapse_ws(str(entry.get("loggedAt", ""))),
            collapse_ws(str(entry.get("sortHint", ""))),
            collapse_ws(str(entry.get("title", ""))),
        ),
        reverse=True,
    )


def load_existing_log(log_path: Path) -> dict:
    if not log_path.exists():
        return {"entries": []}
    payload = load_json_file(log_path)
    if not isinstance(payload, dict):
        return {"entries": []}
    entries = payload.get("entries")
    if not isinstance(entries, list):
        payload["entries"] = []
    return payload


def entry_fingerprint_aliases(entry: dict) -> set[str]:
    aliases: set[str] = set()
    fingerprint = collapse_ws(str(entry.get("fingerprint", "")))
    if fingerprint:
        aliases.add(fingerprint)

    kind = collapse_ws(str(entry.get("kind", ""))).lower()
    paper_id = collapse_ws(str(entry.get("paperId", "")))
    if paper_id and kind in {"paper", "blog"}:
        aliases.add(f"paper:{paper_id}")
        aliases.add(f"blog:{paper_id}")

    if kind == "docs":
        docs_variant = collapse_ws(str(entry.get("docsVariant", "")))
        docs_revision = (
            collapse_ws(str(entry.get("sourceRevision", "")))
            or collapse_ws(str(entry.get("sourceHeadRevision", "")))
            or collapse_ws(str(entry.get("releaseTag", "")))
            or collapse_ws(str(entry.get("syncedAt", "")))
        )
        if docs_variant and docs_revision:
            aliases.add(f"docs:{docs_variant}:{docs_revision}")
    return aliases


def resolve_git_revision(repo_root: Path, revision: str) -> str:
    return collapse_ws(run_git(repo_root, ["rev-parse", revision]))


def list_history_commits(repo_root: Path, history_to: str, history_from: str = "") -> list[str]:
    resolved_to = resolve_git_revision(repo_root, history_to or "HEAD")
    commits = [collapse_ws(line) for line in run_git(repo_root, ["rev-list", "--reverse", resolved_to]).splitlines()]
    commits = [commit for commit in commits if commit]
    if not history_from:
        return commits

    resolved_from = resolve_git_revision(repo_root, history_from)
    if resolved_from not in commits:
        raise RuntimeError(f"history-from revision not reachable from history-to: {history_from}")
    start_index = commits.index(resolved_from)
    return commits[start_index:]


def first_parent_of_commit(repo_root: Path, commit: str) -> str:
    line = collapse_ws(run_git(repo_root, ["rev-list", "--parents", "-n", "1", commit]))
    parts = line.split()
    if len(parts) >= 2:
        return parts[1]
    return ""


def changed_json_paths_for_commit(repo_root: Path, commit: str, parent: str) -> set[str]:
    if parent:
        diff_text = run_git(repo_root, ["diff", "--name-only", parent, commit, "--", *TRACKED_CHANGE_PATHS])
    else:
        diff_text = run_git(repo_root, ["show", "--pretty=format:", "--name-only", commit, "--", *TRACKED_CHANGE_PATHS])

    changed: set[str] = set()
    for line in diff_text.splitlines():
        rel = normalize_git_path(line)
        if rel and rel.endswith(".json"):
            changed.add(rel)
    return changed


def build_entries_from_working_tree_delta(
    repo_root: Path,
    site_base: str,
    logged_at_iso: str,
    topic_by_key: dict[str, str],
) -> tuple[list[dict], int, int, int]:
    changed_json_paths = list_changed_json_paths(repo_root)
    changed_event_paths = sorted(path for path in changed_json_paths if is_event_json_path(path))
    changed_paper_paths = sorted(path for path in changed_json_paths if is_paper_json_path(path))
    changed_docs_meta_paths = sorted(path for path in changed_json_paths if is_docs_meta_json_path(path))

    entries: list[dict] = []

    for rel_path in changed_event_paths:
        abs_path = repo_root / rel_path
        if not abs_path.exists():
            continue
        current_payload = load_json_file(abs_path)
        prev_raw = git_show_file_at_revision(repo_root, "HEAD", rel_path)
        prev_payload = parse_json_text(prev_raw) if prev_raw else None
        entries.extend(diff_talk_entries(current_payload, prev_payload, logged_at_iso, site_base, topic_by_key))

    for rel_path in changed_paper_paths:
        abs_path = repo_root / rel_path
        if not abs_path.exists():
            continue
        current_payload = load_json_file(abs_path)
        prev_raw = git_show_file_at_revision(repo_root, "HEAD", rel_path)
        prev_payload = parse_json_text(prev_raw) if prev_raw else None
        entries.extend(diff_paper_entries(current_payload, prev_payload, logged_at_iso, site_base, topic_by_key))

    for rel_path in changed_docs_meta_paths:
        abs_path = repo_root / rel_path
        if not abs_path.exists():
            continue
        current_payload = load_json_file(abs_path)
        prev_raw = git_show_file_at_revision(repo_root, "HEAD", rel_path)
        prev_payload = parse_json_text(prev_raw) if prev_raw else None
        entries.extend(diff_docs_entries(current_payload, prev_payload, rel_path, logged_at_iso, site_base, topic_by_key))

    return entries, len(changed_event_paths), len(changed_paper_paths), len(changed_docs_meta_paths)


def build_entries_from_history(
    repo_root: Path,
    commits: list[str],
    site_base: str,
    topic_by_key: dict[str, str],
) -> tuple[list[dict], int, int, int]:
    entries: list[dict] = []
    changed_event_count = 0
    changed_paper_count = 0
    changed_docs_meta_count = 0

    for commit in commits:
        logged_at_iso = collapse_ws(run_git(repo_root, ["show", "-s", "--format=%cI", commit]))
        parent = first_parent_of_commit(repo_root, commit)
        changed_paths = changed_json_paths_for_commit(repo_root, commit, parent)

        for rel_path in sorted(path for path in changed_paths if is_event_json_path(path)):
            current_raw = git_show_file_at_revision(repo_root, commit, rel_path)
            if not current_raw:
                continue
            prev_raw = git_show_file_at_revision(repo_root, parent, rel_path) if parent else None
            current_payload = parse_json_text(current_raw)
            prev_payload = parse_json_text(prev_raw) if prev_raw else None
            entries.extend(diff_talk_entries(current_payload, prev_payload, logged_at_iso, site_base, topic_by_key))
            changed_event_count += 1

        for rel_path in sorted(path for path in changed_paths if is_paper_json_path(path)):
            current_raw = git_show_file_at_revision(repo_root, commit, rel_path)
            if not current_raw:
                continue
            prev_raw = git_show_file_at_revision(repo_root, parent, rel_path) if parent else None
            current_payload = parse_json_text(current_raw)
            prev_payload = parse_json_text(prev_raw) if prev_raw else None
            entries.extend(diff_paper_entries(current_payload, prev_payload, logged_at_iso, site_base, topic_by_key))
            changed_paper_count += 1

        for rel_path in sorted(path for path in changed_paths if is_docs_meta_json_path(path)):
            current_raw = git_show_file_at_revision(repo_root, commit, rel_path)
            if not current_raw:
                continue
            prev_raw = git_show_file_at_revision(repo_root, parent, rel_path) if parent else None
            current_payload = parse_json_text(current_raw)
            prev_payload = parse_json_text(prev_raw) if prev_raw else None
            entries.extend(diff_docs_entries(current_payload, prev_payload, rel_path, logged_at_iso, site_base, topic_by_key))
            changed_docs_meta_count += 1

    return entries, changed_event_count, changed_paper_count, changed_docs_meta_count


def main() -> int:
    default_repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(default_repo_root))
    parser.add_argument("--log-json", default=str(default_repo_root / "updates/index.json"))
    parser.add_argument("--site-base", default="")
    parser.add_argument("--retroactive-history", action="store_true")
    parser.add_argument("--history-from", default="")
    parser.add_argument("--history-to", default="HEAD")
    parser.add_argument("--append-retroactive", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    log_json = Path(args.log_json).resolve()
    site_base = normalize_site_base(str(args.site_base))
    topic_by_key = build_topic_lookup(repo_root)
    talk_lookup = build_talk_lookup(repo_root)
    paper_lookup = build_paper_lookup(repo_root)

    logged_at_iso = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if args.retroactive_history:
        commits = list_history_commits(repo_root, history_to=args.history_to, history_from=args.history_from)
        new_entries, changed_event_count, changed_paper_count, changed_docs_meta_count = build_entries_from_history(
            repo_root=repo_root,
            commits=commits,
            site_base=site_base,
            topic_by_key=topic_by_key,
        )
    else:
        new_entries, changed_event_count, changed_paper_count, changed_docs_meta_count = build_entries_from_working_tree_delta(
            repo_root=repo_root,
            site_base=site_base,
            logged_at_iso=logged_at_iso,
            topic_by_key=topic_by_key,
        )

    log_payload = load_existing_log(log_json)
    if args.retroactive_history and not args.append_retroactive:
        existing_entries: list[dict] = []
    else:
        existing_entries = [entry for entry in (log_payload.get("entries") or []) if isinstance(entry, dict)]

    for entry in existing_entries:
        sanitize_update_entry_urls(entry, site_base)
        entry["keyTopics"] = entry_key_topics(entry, talk_lookup, paper_lookup, topic_by_key)

    existing_fingerprints: set[str] = set()
    for entry in existing_entries:
        existing_fingerprints.update(entry_fingerprint_aliases(entry))

    appended = 0
    for entry in new_entries:
        sanitize_update_entry_urls(entry, site_base)
        entry["keyTopics"] = entry_key_topics(entry, talk_lookup, paper_lookup, topic_by_key)
        entry_aliases = entry_fingerprint_aliases(entry)
        if not entry_aliases or any(alias in existing_fingerprints for alias in entry_aliases):
            continue
        existing_entries.append(entry)
        existing_fingerprints.update(entry_aliases)
        appended += 1

    merged_entries = sort_entries(existing_entries)
    existing_data_version = collapse_ws(str(log_payload.get("dataVersion", "")))
    existing_generated_at = collapse_ws(str(log_payload.get("generatedAt", "")))
    existing_last_completed_at = collapse_ws(str(log_payload.get("lastLibraryUpdateCompletedAt", "")))
    should_refresh_metadata = appended > 0 or not log_json.exists() or (args.retroactive_history and not args.append_retroactive)
    completed_at_iso = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    effective_last_completed_at = (
        completed_at_iso
        if should_refresh_metadata
        else (existing_last_completed_at or existing_generated_at or completed_at_iso)
    )

    next_payload = {
        "dataVersion": (
            _dt.date.today().isoformat() + "-updates-log"
            if should_refresh_metadata
            else (existing_data_version or _dt.date.today().isoformat() + "-updates-log")
        ),
        # Retain generatedAt for backward compatibility with older clients.
        "generatedAt": effective_last_completed_at,
        "lastLibraryUpdateCompletedAt": effective_last_completed_at,
        "entries": merged_entries,
    }

    existing_text = log_json.read_text(encoding="utf-8") if log_json.exists() else ""
    next_text = json.dumps(next_payload, indent=2, ensure_ascii=False) + "\n"
    if existing_text != next_text:
        log_json.parent.mkdir(parents=True, exist_ok=True)
        log_json.write_text(next_text, encoding="utf-8")

    if args.verbose:
        if args.retroactive_history:
            print("Mode: retroactive-history")
            print(f"History commit range: {args.history_from or '(root)'} -> {args.history_to}")
        else:
            print("Mode: working-tree-delta")
        print(f"Changed event bundles considered: {changed_event_count}")
        print(f"Changed paper bundles considered: {changed_paper_count}")
        print(f"Changed docs metadata files considered: {changed_docs_meta_count}")
        print(f"Raw newly detected entries: {len(new_entries)}")
    print(f"Update log entries appended: {appended}")
    print(f"Update log total entries: {len(merged_entries)}")
    print(f"Update log file: {log_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
