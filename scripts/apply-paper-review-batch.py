#!/usr/bin/env python3
"""Apply one review batch into papers/reviewed-papers.json and optional paper edits.

Supports either:
- --review-ids-json    : JSON array of paper ids
- --review-batch-json  : JSON array of entries, each entry is either:
    * "paper-id"
    * {"id": "paper-id", "updates": { ... }}

When updates are present, they are applied through scripts/edit-paper-record.py
before review marks are persisted.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def collapse_ws(value: str) -> str:
    return " ".join(str(value or "").split())


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc


def parse_review_ids_json(raw: str) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return []

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"review_ids_json is not valid JSON: {exc}") from exc

    if not isinstance(payload, list):
        raise ValueError("review_ids_json must be a JSON array of paper ids")

    out: list[str] = []
    seen: set[str] = set()
    for idx, item in enumerate(payload):
        paper_id = collapse_ws(str(item or ""))
        if not paper_id:
            raise ValueError(f"review_ids_json[{idx}] must be a non-empty paper id")
        if paper_id in seen:
            continue
        out.append(paper_id)
        seen.add(paper_id)
    return out


def _parse_updates_value(raw_value: Any, idx: int) -> dict[str, Any]:
    if raw_value is None:
        return {}

    if isinstance(raw_value, dict):
        return dict(raw_value)

    if isinstance(raw_value, str):
        text = raw_value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"review_batch_json[{idx}].updates is not valid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError(f"review_batch_json[{idx}].updates must be an object")
        return dict(parsed)

    raise ValueError(f"review_batch_json[{idx}].updates must be an object")


def parse_review_batch_json(raw: str) -> list[dict[str, Any]]:
    text = str(raw or "").strip()
    if not text:
        return []

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"review_batch_json is not valid JSON: {exc}") from exc

    if not isinstance(payload, list):
        raise ValueError("review_batch_json must be a JSON array")

    by_id: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for idx, item in enumerate(payload):
        if isinstance(item, str):
            paper_id = collapse_ws(item)
            updates = {}
        elif isinstance(item, dict):
            paper_id = collapse_ws(str(item.get("id", "")))
            updates_source = item.get("updates", item.get("updates_json"))
            updates = _parse_updates_value(updates_source, idx)
        else:
            raise ValueError(f"review_batch_json[{idx}] must be a string or object")

        if not paper_id:
            raise ValueError(f"review_batch_json[{idx}] is missing a non-empty id")

        if paper_id not in by_id:
            by_id[paper_id] = {"id": paper_id, "updates": {}}
            order.append(paper_id)

        if updates:
            merged = dict(by_id[paper_id]["updates"])
            merged.update(updates)
            by_id[paper_id]["updates"] = merged

    return [by_id[paper_id] for paper_id in order]


def merge_review_inputs(review_ids_json: str, review_batch_json: str) -> list[dict[str, Any]]:
    entries = parse_review_batch_json(review_batch_json)
    by_id: dict[str, dict[str, Any]] = {entry["id"]: {"id": entry["id"], "updates": dict(entry.get("updates") or {})} for entry in entries}
    order = [entry["id"] for entry in entries]

    for paper_id in parse_review_ids_json(review_ids_json):
        if paper_id in by_id:
            continue
        by_id[paper_id] = {"id": paper_id, "updates": {}}
        order.append(paper_id)

    out = [by_id[paper_id] for paper_id in order]
    if not out:
        raise ValueError("Provide at least one id via review_batch_json or review_ids_json")
    return out


def papers_root(repo_root: Path) -> Path:
    root = (repo_root / "papers").resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Missing papers directory: {root}")
    return root


def load_manifest(repo_root: Path) -> list[str]:
    root = papers_root(repo_root)
    manifest_path = root / "index.json"
    payload = load_json(manifest_path)
    if not isinstance(payload, dict):
        raise ValueError("papers/index.json must contain an object")

    files = payload.get("paperFiles")
    if not isinstance(files, list) or not files:
        raise ValueError("papers/index.json must contain a non-empty paperFiles array")

    names: list[str] = []
    for idx, value in enumerate(files):
        name = collapse_ws(str(value or ""))
        if not name:
            raise ValueError(f"papers/index.json paperFiles[{idx}] is empty")
        if not name.endswith(".json"):
            raise ValueError(f"papers/index.json paperFiles[{idx}] must be a .json file")
        names.append(name)

    return names


def collect_known_paper_ids(repo_root: Path) -> set[str]:
    root = papers_root(repo_root)
    known: set[str] = set()

    for name in load_manifest(repo_root):
        bundle_path = (root / name).resolve()
        if root not in bundle_path.parents:
            raise ValueError(f"paperFiles path escapes papers/: {name}")
        payload = load_json(bundle_path)
        papers = payload.get("papers") if isinstance(payload, dict) else None
        if not isinstance(papers, list):
            continue
        for item in papers:
            if not isinstance(item, dict):
                continue
            paper_id = collapse_ws(str(item.get("id", "")))
            if paper_id:
                known.add(paper_id)

    if not known:
        raise ValueError("No known paper ids were found from papers/index.json bundles")

    return known


def normalize_existing_reviews(payload: Any) -> list[dict[str, str]]:
    if payload is None:
        return []
    if not isinstance(payload, dict):
        raise ValueError("papers/reviewed-papers.json must contain an object")

    raw_reviews = payload.get("reviews")
    if raw_reviews is None:
        raw_reviews = []
    elif not isinstance(raw_reviews, list):
        raise ValueError("papers/reviewed-papers.json .reviews must be an array when present")

    out: list[dict[str, str]] = []
    seen: set[str] = set()

    for item in raw_reviews:
        if not isinstance(item, dict):
            continue
        paper_id = collapse_ws(str(item.get("id", "")))
        if not paper_id or paper_id in seen:
            continue
        reviewed_at = collapse_ws(str(item.get("reviewedAt", "")))
        out.append({"id": paper_id, "reviewedAt": reviewed_at})
        seen.add(paper_id)

    return out


def sort_reviews(reviews: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(
        reviews,
        key=lambda item: (collapse_ws(item.get("reviewedAt", "")), collapse_ws(item.get("id", ""))),
        reverse=True,
    )


def apply_review_batch(
    existing_reviews: list[dict[str, str]],
    incoming_ids: list[str],
    reviewed_at_iso: str,
) -> tuple[list[dict[str, str]], list[str]]:
    by_id: dict[str, dict[str, str]] = {}
    for item in existing_reviews:
        paper_id = collapse_ws(item.get("id", ""))
        if not paper_id:
            continue
        by_id[paper_id] = {
            "id": paper_id,
            "reviewedAt": collapse_ws(item.get("reviewedAt", "")),
        }

    added: list[str] = []
    for paper_id in incoming_ids:
        if paper_id in by_id:
            continue
        by_id[paper_id] = {
            "id": paper_id,
            "reviewedAt": reviewed_at_iso,
        }
        added.append(paper_id)

    merged = sort_reviews(list(by_id.values()))
    return merged, added


def apply_edit_updates(repo_root: Path, paper_id: str, updates: dict[str, Any]) -> None:
    if not updates:
        return

    edit_script = repo_root / "scripts" / "edit-paper-record.py"
    command = [
        sys.executable,
        str(edit_script),
        "--paper-id",
        paper_id,
        "--updates-json",
        json.dumps(updates, ensure_ascii=False, separators=(",", ":")),
    ]
    proc = subprocess.run(
        command,
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = collapse_ws(proc.stderr or proc.stdout or "")
        raise ValueError(f"Failed to apply edits for {paper_id}: {detail or 'unknown error'}")


def main() -> int:
    default_repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(default_repo_root))
    parser.add_argument("--review-ids-json", default="")
    parser.add_argument("--review-batch-json", default="")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()

    try:
        entries = merge_review_inputs(args.review_ids_json, args.review_batch_json)
        known_paper_ids = collect_known_paper_ids(repo_root)

        ids = [entry["id"] for entry in entries]
        unknown = [paper_id for paper_id in ids if paper_id not in known_paper_ids]
        if unknown:
            sample = ", ".join(unknown[:10])
            suffix = "" if len(unknown) <= 10 else f" (+{len(unknown) - 10} more)"
            raise ValueError(f"Unknown paper ids in batch input: {sample}{suffix}")

        edits_applied = 0
        for entry in entries:
            updates = entry.get("updates")
            if updates and isinstance(updates, dict):
                apply_edit_updates(repo_root, entry["id"], updates)
                edits_applied += 1

        reviewed_path = repo_root / "papers" / "reviewed-papers.json"
        existing_payload = load_json(reviewed_path) if reviewed_path.exists() else {}
        existing_reviews = normalize_existing_reviews(existing_payload)

        now_iso = dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        merged_reviews, added_ids = apply_review_batch(existing_reviews, ids, now_iso)

        if added_ids:
            next_payload = {
                "dataVersion": f"{dt.date.today().isoformat()}-paper-reviews-v1",
                "updatedAt": now_iso,
                "reviews": merged_reviews,
            }
            reviewed_path.write_text(json.dumps(next_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        if not added_ids and edits_applied == 0:
            raise ValueError("No changes produced: all ids are already reviewed and no edits were provided")

        print(f"Batch entries received: {len(entries)}")
        print(f"Edit updates applied: {edits_applied}")
        print(f"New permanent review marks: {len(added_ids)}")
        print(f"Total permanently reviewed papers: {len(merged_reviews)}")
        print(f"Reviewed file: {reviewed_path}")
        return 0
    except ValueError as exc:
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
