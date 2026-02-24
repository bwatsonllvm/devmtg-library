#!/usr/bin/env python3
"""Generate a complete, hierarchical book index for mirrored LLVM docs.

The output is a browser-consumable JS payload:
  docs/_static/docs-book-index.js

The index is constructed from Sphinx toctrees in docs/_sources and includes:
- Chapter groupings for major reading tracks.
- Recursive section trees with all reachable toctree entries.
- A final appendix chapter for remaining source docs not reached by the main tree.
"""

from __future__ import annotations

import argparse
import json
import fnmatch
import html
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence


HEADING_CHARS = set("=~-^\"'`:+*#.")


@dataclass(frozen=True)
class SourceDoc:
    slug: str
    path: Path


def natural_key(value: str) -> List[object]:
    parts = re.split(r"(\d+)", value)
    out: List[object] = []
    for part in parts:
        if part.isdigit():
            out.append(int(part))
        else:
            out.append(part.lower())
    return out


def norm_slug(value: str) -> str:
    normalized = posixpath.normpath(value.replace("\\", "/"))
    if normalized == ".":
        return ""
    while normalized.startswith("../"):
        normalized = normalized[3:]
    return normalized.strip("/")


def source_path_to_slug(source_root: Path, path: Path) -> str:
    rel = path.relative_to(source_root).as_posix()
    if rel.endswith(".rst.txt"):
        slug = rel[: -len(".rst.txt")]
    elif rel.endswith(".md.txt"):
        slug = rel[: -len(".md.txt")]
    else:
        raise ValueError(f"Unexpected source extension: {path}")
    return norm_slug(slug)


def collect_source_docs(source_root: Path) -> Dict[str, SourceDoc]:
    docs: Dict[str, SourceDoc] = {}
    for path in sorted(source_root.rglob("*.txt")):
        rel = path.relative_to(source_root).as_posix()
        if not (rel.endswith(".rst.txt") or rel.endswith(".md.txt")):
            continue
        slug = source_path_to_slug(source_root, path)
        if slug in docs:
            # Prefer rst over md if both happen to exist for same slug.
            if docs[slug].path.name.endswith(".md.txt") and path.name.endswith(".rst.txt"):
                docs[slug] = SourceDoc(slug=slug, path=path)
            continue
        docs[slug] = SourceDoc(slug=slug, path=path)
    return docs


def extract_html_title(html_path: Path) -> Optional[str]:
    if not html_path.exists():
        return None
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"<title>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = html.unescape(match.group(1)).strip()
    title = re.sub(r"\s+[–—-]\s+LLVM.*$", "", title, flags=re.IGNORECASE).strip()
    title = re.sub(r"\s+documentation$", "", title, flags=re.IGNORECASE).strip()
    if not title or title == "..":
        return None
    return title


def extract_title(path: Path, docs_root: Path, fallback_slug: str) -> str:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    fallback = fallback_slug.split("/")[-1].replace("-", " ").replace("_", " ").strip() or fallback_slug

    html_title = extract_html_title(docs_root / f"{fallback_slug}.html")
    if html_title:
        return html_title

    # Markdown heading.
    if path.name.endswith(".md.txt"):
        for line in lines:
            if line.startswith("# "):
                return line[2:].strip()

    # RST headings in source order: return the first heading encountered.
    for i in range(len(lines)):
        # Overline style:
        # ======
        # Title
        # ======
        if i + 2 < len(lines):
            a = lines[i].rstrip()
            b = lines[i + 1].rstrip()
            c = lines[i + 2].rstrip()
            if a and b and c:
                if len(set(a.strip())) == 1 and len(set(c.strip())) == 1 and a.strip()[0] in HEADING_CHARS and c.strip()[0] in HEADING_CHARS:
                    if len(a.strip()) >= len(b.strip()) and len(c.strip()) >= len(b.strip()):
                        if b.strip() and b.strip() != "..":
                            return b.strip()

        # Underline style:
        # Title
        # ======
        if i + 1 < len(lines):
            title = lines[i].rstrip()
            underline = lines[i + 1].rstrip()
            if title and underline:
                stripped = underline.strip()
                if len(stripped) >= max(3, len(title.strip())) and len(set(stripped)) == 1 and stripped[0] in HEADING_CHARS:
                    if title.strip() and title.strip() != "..":
                        return title.strip()

    return fallback


def parse_explicit_target(entry: str) -> str:
    entry = entry.strip()
    if not entry:
        return entry
    # Explicit title format: Some Title <target/path>
    m = re.match(r"^.+<([^>]+)>\s*$", entry)
    if m:
        return m.group(1).strip()
    return entry


def resolve_target_slug(target: str, current_slug: str, source_docs: Dict[str, SourceDoc]) -> Optional[str]:
    raw = target.strip()
    if not raw:
        return None
    if raw in {"self", "."}:
        return current_slug
    if raw.startswith(("http://", "https://", "mailto:")):
        return None

    raw = raw.split("#", 1)[0].strip()
    if not raw:
        return None

    for suffix in (".rst", ".md", ".html"):
        if raw.endswith(suffix):
            raw = raw[: -len(suffix)]

    if raw.startswith("/"):
        candidate = norm_slug(raw.lstrip("/"))
    else:
        base_dir = posixpath.dirname(current_slug)
        candidate = norm_slug(posixpath.join(base_dir, raw))

    options = [candidate]
    if candidate and not candidate.endswith("/index"):
        options.append(f"{candidate}/index")

    for option in options:
        if option in source_docs:
            return option
    return None


def expand_glob_entries(pattern: str, current_slug: str, source_docs: Dict[str, SourceDoc]) -> List[str]:
    raw = pattern.strip()
    if not raw:
        return []
    if raw.startswith("/"):
        glob_pattern = norm_slug(raw.lstrip("/"))
    else:
        base_dir = posixpath.dirname(current_slug)
        glob_pattern = norm_slug(posixpath.join(base_dir, raw))

    matches = [slug for slug in source_docs.keys() if fnmatch.fnmatch(slug, glob_pattern)]
    matches.sort(key=natural_key)
    return matches


def parse_toctree_edges(source_docs: Dict[str, SourceDoc]) -> Dict[str, List[str]]:
    edges: Dict[str, List[str]] = {}
    for slug, doc in source_docs.items():
        lines = doc.path.read_text(encoding="utf-8", errors="ignore").splitlines()
        children: List[str] = []
        seen_local = set()
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            if not stripped.startswith(".. toctree::"):
                i += 1
                continue

            directive_indent = len(line) - len(line.lstrip(" "))
            i += 1
            use_glob = False
            while i < len(lines):
                row = lines[i]
                row_stripped = row.strip()
                if not row_stripped:
                    i += 1
                    continue

                indent = len(row) - len(row.lstrip(" "))
                if indent <= directive_indent:
                    break

                if row_stripped.startswith(":"):
                    if row_stripped.startswith(":glob:"):
                        use_glob = True
                    i += 1
                    continue

                if row_stripped.startswith(".. "):
                    i += 1
                    continue

                target = parse_explicit_target(row_stripped)
                expanded: Sequence[str]
                if use_glob and any(ch in target for ch in "*?[]"):
                    expanded = expand_glob_entries(target, slug, source_docs)
                else:
                    resolved = resolve_target_slug(target, slug, source_docs)
                    expanded = [resolved] if resolved else []

                for child_slug in expanded:
                    if child_slug in seen_local:
                        continue
                    seen_local.add(child_slug)
                    children.append(child_slug)
                i += 1
            continue
        edges[slug] = children
    return edges


def build_tree_node(
    slug: str,
    edges: Dict[str, List[str]],
    titles: Dict[str, str],
    assigned: set[str],
    stack: set[str],
) -> Optional[Dict[str, object]]:
    if slug in assigned or slug in stack:
        return None

    stack.add(slug)
    assigned.add(slug)
    children: List[Dict[str, object]] = []
    for child_slug in edges.get(slug, []):
        node = build_tree_node(child_slug, edges, titles, assigned, stack)
        if node:
            children.append(node)
    stack.remove(slug)

    return {"slug": slug, "title": titles.get(slug, slug), "children": children}


def build_book_index(source_docs: Dict[str, SourceDoc], docs_root: Path) -> Dict[str, object]:
    titles = {slug: extract_title(doc.path, docs_root, slug) for slug, doc in source_docs.items()}
    edges = parse_toctree_edges(source_docs)

    chapter_defs = [
        ("Foundations", ["FAQ", "Lexicon"]),
        ("Getting Started and Tutorials", ["GettingStartedTutorials"]),
        ("User Guides", ["UserGuides"]),
        ("Reference", ["Reference"]),
        ("Community and Governance", ["GettingInvolved", "RFCProcess", "DiscourseMigrationGuide"]),
    ]

    assigned: set[str] = set()
    chapters: List[Dict[str, object]] = []

    for chapter_title, roots in chapter_defs:
        entries: List[Dict[str, object]] = []
        for root_slug in roots:
            node = build_tree_node(root_slug, edges, titles, assigned, set())
            if node:
                entries.append(node)
        if entries:
            chapters.append({"title": chapter_title, "entries": entries})

    # Include index page if still unassigned.
    index_node = build_tree_node("index", edges, titles, assigned, set())
    if index_node:
        chapters.insert(0, {"title": "Overview", "entries": [index_node]})

    # Ensure complete coverage with an appendix.
    remaining = [slug for slug in sorted(source_docs.keys(), key=natural_key) if slug not in assigned]
    appendix_entries: List[Dict[str, object]] = []
    for slug in remaining:
        node = build_tree_node(slug, edges, titles, assigned, set())
        if node:
            appendix_entries.append(node)
    if appendix_entries:
        chapters.append({"title": "Appendix: Additional Documents", "entries": appendix_entries})

    return {
        "meta": {
            "source_docs_count": len(source_docs),
            "chapter_count": len(chapters),
            "covered_docs_count": len(assigned),
        },
        "chapters": chapters,
    }


def write_output(output_path: Path, payload: Dict[str, object]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    output = (
        "// Auto-generated by scripts/generate-docs-book-index.py\n"
        f"window.LLVMDocsBookIndex={serialized};\n"
    )
    output_path.write_text(output, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the mirrored LLVM docs book index payload.")
    parser.add_argument(
        "--source-root",
        default="docs/_sources",
        help="Path to mirrored Sphinx source docs directory.",
    )
    parser.add_argument(
        "--output",
        default="docs/_static/docs-book-index.js",
        help="Output JS payload path.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    source_root = (repo_root / args.source_root).resolve()
    docs_root = source_root.parent
    output_path = (repo_root / args.output).resolve()

    source_docs = collect_source_docs(source_root)
    payload = build_book_index(source_docs, docs_root)
    write_output(output_path, payload)

    meta = payload["meta"]
    print(
        "Generated docs book index:",
        f"docs={meta['source_docs_count']}",
        f"chapters={meta['chapter_count']}",
        f"covered={meta['covered_docs_count']}",
        f"output={output_path}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
