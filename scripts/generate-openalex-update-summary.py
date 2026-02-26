#!/usr/bin/env python3
"""Generate a markdown summary for OpenAlex updates (titles + authors).

The summary is delta-based: it compares the current OpenAlex bundle against
the bundle version at HEAD and lists newly added/updated records.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def git_show_file_at_head(repo_root: Path, rel_path: str) -> str | None:
    proc = subprocess.run(
        ["git", "show", f"HEAD:{rel_path}"],
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
    raise RuntimeError(f"git show HEAD:{rel_path} failed: {collapse_ws(proc.stderr)}")


def papers_by_id(payload: dict | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not isinstance(payload, dict):
        return out
    papers = payload.get("papers")
    if not isinstance(papers, list):
        return out
    for paper in papers:
        if not isinstance(paper, dict):
            continue
        paper_id = collapse_ws(str(paper.get("id", "")))
        if not paper_id:
            continue
        out[paper_id] = paper
    return out


def author_names(paper: dict) -> list[str]:
    raw_authors = paper.get("authors")
    if not isinstance(raw_authors, list):
        return []

    out: list[str] = []
    seen: set[str] = set()
    for raw in raw_authors:
        if isinstance(raw, dict):
            name = collapse_ws(str(raw.get("name", "")))
        else:
            name = collapse_ws(str(raw))
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def paper_signature(paper: dict) -> tuple[str, tuple[str, ...], str]:
    title = collapse_ws(str(paper.get("title", ""))).lower()
    authors = tuple(name.lower() for name in author_names(paper))
    year = collapse_ws(str(paper.get("year", "")))
    return title, authors, year


def paper_sort_key(paper: dict) -> tuple[int, str, str]:
    year_text = collapse_ws(str(paper.get("year", "")))
    year_value = int(year_text) if year_text.isdigit() else -1
    title = collapse_ws(str(paper.get("title", ""))).lower()
    paper_id = collapse_ws(str(paper.get("id", ""))).lower()
    return (-year_value, title, paper_id)


def format_paper_entry(index: int, paper: dict) -> str:
    title = collapse_ws(str(paper.get("title", ""))) or "(Untitled)"
    year = collapse_ws(str(paper.get("year", "")))
    names = author_names(paper)
    authors_text = ", ".join(names) if names else "Unknown authors"
    paper_id = collapse_ws(str(paper.get("id", "")))
    openalex_id = collapse_ws(str(paper.get("openalexId", "")))

    header = f"{index}. **{title}**"
    if year:
        header += f" ({year})"
    lines = [
        header,
        f"   Authors: {authors_text}",
    ]
    if paper_id:
        lines.append(f"   Record: `{paper_id}`")
    if openalex_id:
        lines.append(f"   OpenAlex: {openalex_id}")
    return "\n".join(lines)


def build_summary_markdown(
    *,
    bundle_rel_path: str,
    current_payload: dict,
    previous_payload: dict | None,
) -> tuple[str, int, int]:
    current_by_id = papers_by_id(current_payload)
    previous_by_id = papers_by_id(previous_payload)

    added_ids = sorted(pid for pid in current_by_id if pid not in previous_by_id)
    updated_ids = sorted(
        pid
        for pid in current_by_id
        if pid in previous_by_id and paper_signature(current_by_id[pid]) != paper_signature(previous_by_id[pid])
    )

    added = sorted((current_by_id[pid] for pid in added_ids), key=paper_sort_key)
    updated = sorted((current_by_id[pid] for pid in updated_ids), key=paper_sort_key)
    total = len(current_by_id)
    source_payload = current_payload.get("source")
    source_slug = ""
    if isinstance(source_payload, dict):
        source_slug = collapse_ws(str(source_payload.get("slug", "")))
    data_version = (
        collapse_ws(str(current_payload.get("dataVersion", "")))
        or collapse_ws(str(current_payload.get("generatedAt", "")))
        or source_slug
        or "unknown"
    )

    lines = [
        "# OpenAlex Update Summary",
        "",
        f"Source bundle: `{bundle_rel_path}`",
        f"Data version: `{data_version}`",
        "",
        f"- Total OpenAlex records in bundle: {total}",
        f"- Newly added records in this sync: {len(added)}",
        f"- Updated title/author records in this sync: {len(updated)}",
        "",
    ]

    lines.append("## Newly Added")
    lines.append("")
    if added:
        lines.extend(format_paper_entry(i + 1, paper) for i, paper in enumerate(added))
    else:
        lines.append("_No new OpenAlex records were added in this sync._")
    lines.append("")

    lines.append("## Updated Metadata (Title/Authors)")
    lines.append("")
    if updated:
        lines.extend(format_paper_entry(i + 1, paper) for i, paper in enumerate(updated))
    else:
        lines.append("_No OpenAlex title/author metadata updates were detected in this sync._")
    lines.append("")

    return "\n".join(lines), len(added), len(updated)


def main() -> int:
    default_repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(default_repo_root))
    parser.add_argument("--bundle", default="papers/openalex-llvm-query.json")
    parser.add_argument("--output", default="updates/openalex-update-summary.md")
    parser.add_argument(
        "--skip-when-unchanged",
        action="store_true",
        help="Leave the summary file untouched if no OpenAlex records changed since HEAD.",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    bundle_path = (repo_root / collapse_ws(args.bundle)).resolve()
    output_path = (repo_root / collapse_ws(args.output)).resolve()
    if not bundle_path.exists():
        raise SystemExit(f"Missing OpenAlex bundle: {bundle_path}")

    bundle_rel_path = bundle_path.relative_to(repo_root).as_posix()
    current_raw = bundle_path.read_text(encoding="utf-8")
    current_payload = json.loads(current_raw)

    previous_raw = git_show_file_at_head(repo_root, bundle_rel_path)
    previous_payload = json.loads(previous_raw) if previous_raw else {}

    summary, added_count, updated_count = build_summary_markdown(
        bundle_rel_path=bundle_rel_path,
        current_payload=current_payload,
        previous_payload=previous_payload,
    )

    if args.skip_when_unchanged and added_count == 0 and updated_count == 0 and output_path.exists():
        print("OpenAlex summary unchanged: no new/updated records detected.")
        return 0

    existing = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    next_text = summary if summary.endswith("\n") else summary + "\n"
    if existing != next_text:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(next_text, encoding="utf-8")
        print(
            "OpenAlex summary written:",
            output_path,
            f"(added={added_count}, updated={updated_count})",
        )
    else:
        print(
            "OpenAlex summary already up to date:",
            output_path,
            f"(added={added_count}, updated={updated_count})",
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
