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
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional, Sequence


HEADING_CHARS = set("=~-^\"'`:+*#.")


@dataclass(frozen=True)
class SourceDoc:
    slug: str
    path: Path


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


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


def collect_html_only_docs(
    docs_root: Path,
    source_docs: Dict[str, SourceDoc],
    docs_variant: str,
) -> Dict[str, Path]:
    html_docs: Dict[str, Path] = {}
    for path in sorted(docs_root.rglob("*.html")):
        rel = path.relative_to(docs_root).as_posix()
        if rel.startswith("_static/"):
            continue
        if docs_variant == "lldb" and rel.startswith("cpp_reference/"):
            continue
        if rel in {"search.html", "genindex.html"}:
            continue
        slug = norm_slug(rel[: -len(".html")])
        if not slug or slug in source_docs:
            continue
        html_docs[slug] = path
    return html_docs


def extract_html_title(html_path: Path) -> Optional[str]:
    if not html_path.exists():
        return None
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"<title>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = html.unescape(match.group(1)).strip()
    title = re.sub(r"\s+[–—-]\s+(?:LLVM|Clang|LLDB)\s+.*$", "", title, flags=re.IGNORECASE).strip()
    title = re.sub(r"\s+[–—-]\s+[^–—-]*\bdocumentation$", "", title, flags=re.IGNORECASE).strip()
    title = re.sub(r"\s+documentation$", "", title, flags=re.IGNORECASE).strip()
    if not title or title == "..":
        return None
    return title


def detect_docs_variant(source_docs: Dict[str, SourceDoc], docs_root: Path) -> str:
    root_name = docs_root.name.lower()
    if root_name == "clang":
        return "clang"
    if root_name == "lldb":
        return "lldb"
    if "UsersManual" in source_docs and "GettingStartedTutorials" not in source_docs:
        return "clang"
    if "use/tutorial" in source_docs and "python_api" in source_docs:
        return "lldb"
    return "llvm-core"


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


def parse_index_section_chapters(
    source_docs: Dict[str, SourceDoc],
    titles: Dict[str, str],
) -> List[tuple[str, List[str]]]:
    index_doc = source_docs.get("index")
    if not index_doc:
        return []

    lines = index_doc.path.read_text(encoding="utf-8", errors="ignore").splitlines()
    chapters: List[tuple[str, List[str]]] = []
    current_section: Optional[str] = None
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if i + 1 < len(lines):
            title_line = lines[i].rstrip()
            underline = lines[i + 1].rstrip()
            if title_line and underline:
                marker = underline.strip()
                if (
                    len(marker) >= max(3, len(title_line.strip()))
                    and len(set(marker)) == 1
                    and marker[0] == "="
                ):
                    current_section = title_line.strip()
                    i += 2
                    continue

        if not stripped.startswith(".. toctree::"):
            i += 1
            continue

        directive_indent = len(line) - len(line.lstrip(" "))
        i += 1
        use_glob = False
        roots: List[str] = []
        seen_roots: set[str] = set()
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
                expanded = expand_glob_entries(target, "index", source_docs)
            else:
                resolved = resolve_target_slug(target, "index", source_docs)
                expanded = [resolved] if resolved else []

            for root_slug in expanded:
                if root_slug in seen_roots:
                    continue
                seen_roots.add(root_slug)
                roots.append(root_slug)
            i += 1

        if roots:
            if current_section:
                chapter_title = current_section
            elif roots == ["ReleaseNotes"]:
                chapter_title = "Release Notes"
            elif len(roots) == 1:
                chapter_title = titles.get(roots[0], roots[0])
            else:
                chapter_title = "Overview"
            chapters.append((chapter_title, roots))
        continue

    return chapters


def href_to_docs_slug(raw_href: str) -> Optional[str]:
    href = str(raw_href or "").strip()
    if not href:
        return None
    if href.startswith("#"):
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*://", href, flags=re.IGNORECASE):
        return None
    href = href.split("#", 1)[0].split("?", 1)[0].strip()
    if not href:
        return None
    href = href.lstrip("./")
    href = href.lstrip("/")
    if not href:
        return "index"
    if href.endswith(".html"):
        slug = href[: -len(".html")]
    elif href.endswith("/"):
        slug = f"{href.rstrip('/')}/index"
    else:
        slug = href
    slug = norm_slug(slug)
    return slug or "index"


class LldbSidebarTreeParser(HTMLParser):
    """Parse LLDB's sidebar-tree chapters and nested toctree entries from index.html."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_sidebar_tree = False
        self.sidebar_div_depth = 0
        self.in_caption_text = False
        self.caption_chunks: List[str] = []
        self.pending_caption: Optional[str] = None
        self.ul_depth = 0
        self.li_stack: List[Dict[str, object]] = []
        self.current_chapter_nodes: Optional[List[Dict[str, object]]] = None
        self.chapters: List[tuple[str, List[Dict[str, object]]]] = []

    @staticmethod
    def attr_map(attrs: List[tuple[str, str | None]]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for key, value in attrs:
            if value is None:
                continue
            out[key] = value
        return out

    @staticmethod
    def has_class(attrs: Dict[str, str], expected: str) -> bool:
        classes = set(str(attrs.get("class", "")).split())
        return expected in classes

    def handle_starttag(self, tag: str, attrs: List[tuple[str, str | None]]) -> None:
        attr = self.attr_map(attrs)
        if tag == "div" and self.has_class(attr, "sidebar-tree"):
            self.in_sidebar_tree = True
            self.sidebar_div_depth = 1
            return

        if not self.in_sidebar_tree:
            return

        if tag == "div":
            self.sidebar_div_depth += 1
            return

        if tag == "span" and self.has_class(attr, "caption-text"):
            self.in_caption_text = True
            self.caption_chunks = []
            return

        if tag == "ul":
            self.ul_depth += 1
            if self.ul_depth == 1:
                chapter_title = normalize_space(self.pending_caption or "") or "Overview"
                self.current_chapter_nodes = []
                self.chapters.append((chapter_title, self.current_chapter_nodes))
            return

        if tag == "li":
            klass = str(attr.get("class", ""))
            if "toctree-l" in klass:
                self.li_stack.append({"slug": "", "children": []})
            return

        if tag == "a" and self.li_stack:
            if self.has_class(attr, "external"):
                return
            slug = href_to_docs_slug(attr.get("href", ""))
            if slug and not str(self.li_stack[-1].get("slug", "")).strip():
                self.li_stack[-1]["slug"] = slug

    def handle_endtag(self, tag: str) -> None:
        if not self.in_sidebar_tree:
            return

        if tag == "span" and self.in_caption_text:
            self.in_caption_text = False
            caption = normalize_space("".join(self.caption_chunks))
            self.pending_caption = caption or None
            self.caption_chunks = []
            return

        if tag == "li" and self.li_stack:
            node = self.li_stack.pop()
            slug = normalize_space(str(node.get("slug", "")))
            if not slug:
                return
            if self.li_stack:
                parent_children = self.li_stack[-1].setdefault("children", [])
                if isinstance(parent_children, list):
                    parent_children.append(node)
            elif self.current_chapter_nodes is not None:
                self.current_chapter_nodes.append(node)
            return

        if tag == "ul":
            if self.ul_depth == 1:
                self.current_chapter_nodes = None
            self.ul_depth = max(0, self.ul_depth - 1)
            return

        if tag == "div":
            self.sidebar_div_depth -= 1
            if self.sidebar_div_depth <= 0:
                self.in_sidebar_tree = False
                self.sidebar_div_depth = 0

    def handle_data(self, data: str) -> None:
        if self.in_caption_text:
            self.caption_chunks.append(data)


def parse_lldb_sidebar_html_chapters(
    docs_root: Path,
    valid_slugs: set[str],
) -> tuple[List[tuple[str, List[str]]], Dict[str, List[str]]]:
    index_html = docs_root / "index.html"
    if not index_html.is_file():
        return [], {}

    parser = LldbSidebarTreeParser()
    parser.feed(index_html.read_text(encoding="utf-8", errors="ignore"))

    edges: Dict[str, List[str]] = {}
    chapter_defs: List[tuple[str, List[str]]] = []

    def walk(node: Dict[str, object]) -> Optional[str]:
        raw_slug = normalize_space(str(node.get("slug", "")))
        if not raw_slug:
            return None

        if raw_slug.endswith("/index"):
            alt = raw_slug[: -len("/index")]
            slug = raw_slug if raw_slug in valid_slugs else (alt if alt in valid_slugs else raw_slug)
        else:
            alt = f"{raw_slug}/index"
            slug = raw_slug if raw_slug in valid_slugs else (alt if alt in valid_slugs else raw_slug)

        if slug not in valid_slugs:
            return None

        raw_children = node.get("children")
        child_nodes = raw_children if isinstance(raw_children, list) else []
        child_slugs: List[str] = []
        seen_children: set[str] = set()
        for child in child_nodes:
            if not isinstance(child, dict):
                continue
            child_slug = walk(child)
            if not child_slug:
                continue
            if child_slug in seen_children:
                continue
            seen_children.add(child_slug)
            child_slugs.append(child_slug)
        if child_slugs:
            edges.setdefault(slug, [])
            for child_slug in child_slugs:
                if child_slug not in edges[slug]:
                    edges[slug].append(child_slug)

        return slug

    for chapter_title, chapter_nodes in parser.chapters:
        roots: List[str] = []
        seen_roots: set[str] = set()
        for node in chapter_nodes:
            root_slug = walk(node)
            if not root_slug:
                continue
            if root_slug in seen_roots:
                continue
            seen_roots.add(root_slug)
            roots.append(root_slug)
        if roots:
            chapter_defs.append((chapter_title, roots))

    return chapter_defs, edges


def build_tree_node(
    slug: str,
    edges: Dict[str, List[str]],
    titles: Dict[str, str],
    assigned: set[str],
    stack: set[str],
) -> Optional[Dict[str, object]]:
    if slug not in titles:
        return None
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
    docs_variant = detect_docs_variant(source_docs, docs_root)
    html_only_docs = collect_html_only_docs(docs_root, source_docs, docs_variant)

    for slug, html_path in html_only_docs.items():
        fallback = slug.split("/")[-1].replace("-", " ").replace("_", " ").strip() or slug
        titles[slug] = extract_html_title(html_path) or fallback
        edges.setdefault(slug, [])

    if docs_variant == "lldb":
        chapter_defs, html_sidebar_edges = parse_lldb_sidebar_html_chapters(docs_root, set(titles.keys()))
        for parent_slug, child_slugs in html_sidebar_edges.items():
            if parent_slug not in titles:
                continue
            edges.setdefault(parent_slug, [])
            for child_slug in child_slugs:
                if child_slug not in titles:
                    continue
                if child_slug not in edges[parent_slug]:
                    edges[parent_slug].append(child_slug)
        if not chapter_defs and source_docs:
            chapter_defs = parse_index_section_chapters(source_docs, titles)
    elif docs_variant == "clang":
        chapter_defs = parse_index_section_chapters(source_docs, titles)
    else:
        chapter_defs = [
            ("Foundations", ["FAQ", "Lexicon"]),
            ("Getting Started and Tutorials", ["GettingStartedTutorials"]),
            ("User Guides", ["UserGuides"]),
            ("Reference", ["Reference"]),
            ("Community and Governance", ["GettingInvolved", "RFCProcess", "DiscourseMigrationGuide"]),
        ]

    assigned: set[str] = set()
    chapters: List[Dict[str, object]] = []

    # Ensure the docs landing page is always present without making it the sole root.
    if docs_variant in {"clang", "lldb"} and "index" in titles:
        chapters.append(
            {
                "title": "Overview",
                "entries": [{"slug": "index", "title": titles.get("index", "index"), "children": []}],
            }
        )
        assigned.add("index")

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
    all_docs = set(source_docs.keys()) | set(html_only_docs.keys())
    remaining = [slug for slug in sorted(all_docs, key=natural_key) if slug not in assigned]
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
            "html_only_docs_count": len(html_only_docs),
            "total_docs_count": len(all_docs),
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
