#!/usr/bin/env python3
"""Build/update website update log entries for newly added talks/resources/papers/blogs.

Default mode:
  - compares current working tree JSON bundles against HEAD versions in git
  - records only newly added items:
      * talks
      * slides added to an existing talk
      * videos added to an existing talk
      * papers/blogs newly added to any papers/*.json bundle
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
}


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def has_text(value: str | None) -> bool:
    return bool(collapse_ws(str(value or "")))


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


def list_changed_json_paths(repo_root: Path) -> set[str]:
    changed: set[str] = set()

    diff_text = run_git(repo_root, ["diff", "--name-only", "HEAD", "--", "devmtg/events", "papers"])
    for line in diff_text.splitlines():
        rel = collapse_ws(line)
        if rel:
            changed.add(rel)

    untracked_text = run_git(
        repo_root,
        ["ls-files", "--others", "--exclude-standard", "--", "devmtg/events", "papers"],
    )
    for line in untracked_text.splitlines():
        rel = collapse_ws(line)
        if rel:
            changed.add(rel)

    return {path for path in changed if path.endswith(".json")}


def is_event_json_path(rel_path: str) -> bool:
    return rel_path.startswith("devmtg/events/") and rel_path.endswith(".json") and not rel_path.endswith("index.json")


def is_paper_json_path(rel_path: str) -> bool:
    return rel_path.startswith("papers/") and rel_path.endswith(".json") and rel_path != "papers/index.json"


def talk_has_slides(talk: dict) -> bool:
    return has_text(str(talk.get("slidesUrl", "")))


def talk_has_video(talk: dict) -> bool:
    return has_text(str(talk.get("videoUrl", ""))) or has_text(str(talk.get("videoId", "")))


def talk_video_url(talk: dict) -> str:
    explicit = collapse_ws(str(talk.get("videoUrl", "")))
    if explicit:
        return explicit
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


def normalize_internal_library_url(raw_url: str, site_base: str) -> str:
    url = collapse_ws(raw_url)
    if not url:
        return ""
    if re.match(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", url, flags=re.IGNORECASE):
        return url

    parsed = urllib.parse.urlsplit(url)
    path = parsed.path or ""
    suffix = ""
    if parsed.query:
        suffix += f"?{parsed.query}"
    if parsed.fragment:
        suffix += f"#{parsed.fragment}"

    if path.startswith("/devmtg/"):
        tail = path[len("/devmtg/") :]
        if not site_base:
            return tail + suffix
        if site_base == "/":
            return f"/{tail}{suffix}"
        return f"{site_base.rstrip('/')}/{tail}{suffix}"

    if not site_base and (path == "/talk.html" or path == "/paper.html"):
        return path[1:] + suffix

    if site_base and (path == "talk.html" or path == "paper.html"):
        if site_base == "/":
            return f"/{path}{suffix}"
        return f"{site_base.rstrip('/')}/{path}{suffix}"

    return url


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
) -> dict:
    talk_id = collapse_ws(str(talk.get("id", "")))
    title = collapse_ws(str(talk.get("title", ""))) or "(Untitled talk)"
    meeting_slug = collapse_ws(str(talk.get("meeting", "")))
    meeting_name = collapse_ws(str(talk.get("meetingName", "")))
    meeting_date = collapse_ws(str(talk.get("meetingDate", "")))
    slides_url = collapse_ws(str(talk.get("slidesUrl", "")))
    video_url = talk_video_url(talk)
    detail_url = build_detail_url(site_base, "talk.html", talk_id)

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
    }
    if slides_url:
        entry["slidesUrl"] = slides_url
    if video_url:
        entry["videoUrl"] = video_url
    return entry


def paper_entry(paper: dict, logged_at_iso: str, site_base: str) -> dict:
    paper_id = collapse_ws(str(paper.get("id", "")))
    year = collapse_ws(str(paper.get("year", "")))
    source = collapse_ws(str(paper.get("sourceName", ""))) or collapse_ws(str(paper.get("source", "")))
    paper_url = collapse_ws(str(paper.get("paperUrl", "")))
    source_url = collapse_ws(str(paper.get("sourceUrl", "")))
    detail_url = build_detail_url(site_base, "paper.html", paper_id)
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


def diff_talk_entries(current_payload: dict | None, prev_payload: dict | None, logged_at_iso: str, site_base: str) -> list[dict]:
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
            entries.append(talk_entry(current_talk, parts, logged_at_iso, site_base))
    return entries


def diff_paper_entries(current_payload: dict | None, prev_payload: dict | None, logged_at_iso: str, site_base: str) -> list[dict]:
    entries: list[dict] = []
    current_papers = papers_by_id(current_payload)
    prev_papers = papers_by_id(prev_payload)

    for paper_id, current_paper in current_papers.items():
        if paper_id in prev_papers:
            continue
        entries.append(paper_entry(current_paper, logged_at_iso, site_base))
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
        diff_text = run_git(repo_root, ["diff", "--name-only", parent, commit, "--", "devmtg/events", "papers"])
    else:
        diff_text = run_git(repo_root, ["show", "--pretty=format:", "--name-only", commit, "--", "devmtg/events", "papers"])

    changed: set[str] = set()
    for line in diff_text.splitlines():
        rel = collapse_ws(line)
        if rel and rel.endswith(".json"):
            changed.add(rel)
    return changed


def build_entries_from_working_tree_delta(repo_root: Path, site_base: str, logged_at_iso: str) -> tuple[list[dict], int, int]:
    changed_json_paths = list_changed_json_paths(repo_root)
    changed_event_paths = sorted(path for path in changed_json_paths if is_event_json_path(path))
    changed_paper_paths = sorted(path for path in changed_json_paths if is_paper_json_path(path))

    entries: list[dict] = []

    for rel_path in changed_event_paths:
        abs_path = repo_root / rel_path
        if not abs_path.exists():
            continue
        current_payload = load_json_file(abs_path)
        prev_raw = git_show_file_at_revision(repo_root, "HEAD", rel_path)
        prev_payload = parse_json_text(prev_raw) if prev_raw else None
        entries.extend(diff_talk_entries(current_payload, prev_payload, logged_at_iso, site_base))

    for rel_path in changed_paper_paths:
        abs_path = repo_root / rel_path
        if not abs_path.exists():
            continue
        current_payload = load_json_file(abs_path)
        prev_raw = git_show_file_at_revision(repo_root, "HEAD", rel_path)
        prev_payload = parse_json_text(prev_raw) if prev_raw else None
        entries.extend(diff_paper_entries(current_payload, prev_payload, logged_at_iso, site_base))

    return entries, len(changed_event_paths), len(changed_paper_paths)


def build_entries_from_history(
    repo_root: Path,
    commits: list[str],
    site_base: str,
) -> tuple[list[dict], int, int]:
    entries: list[dict] = []
    changed_event_count = 0
    changed_paper_count = 0

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
            entries.extend(diff_talk_entries(current_payload, prev_payload, logged_at_iso, site_base))
            changed_event_count += 1

        for rel_path in sorted(path for path in changed_paths if is_paper_json_path(path)):
            current_raw = git_show_file_at_revision(repo_root, commit, rel_path)
            if not current_raw:
                continue
            prev_raw = git_show_file_at_revision(repo_root, parent, rel_path) if parent else None
            current_payload = parse_json_text(current_raw)
            prev_payload = parse_json_text(prev_raw) if prev_raw else None
            entries.extend(diff_paper_entries(current_payload, prev_payload, logged_at_iso, site_base))
            changed_paper_count += 1

    return entries, changed_event_count, changed_paper_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default="/Users/britton/Desktop/library")
    parser.add_argument("--log-json", default="/Users/britton/Desktop/library/devmtg/updates/index.json")
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

    logged_at_iso = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if args.retroactive_history:
        commits = list_history_commits(repo_root, history_to=args.history_to, history_from=args.history_from)
        new_entries, changed_event_count, changed_paper_count = build_entries_from_history(
            repo_root=repo_root,
            commits=commits,
            site_base=site_base,
        )
    else:
        new_entries, changed_event_count, changed_paper_count = build_entries_from_working_tree_delta(
            repo_root=repo_root,
            site_base=site_base,
            logged_at_iso=logged_at_iso,
        )

    log_payload = load_existing_log(log_json)
    if args.retroactive_history and not args.append_retroactive:
        existing_entries: list[dict] = []
    else:
        existing_entries = [entry for entry in (log_payload.get("entries") or []) if isinstance(entry, dict)]

    for entry in existing_entries:
        raw_url = collapse_ws(str(entry.get("url", "")))
        if not raw_url:
            continue
        entry["url"] = normalize_internal_library_url(raw_url, site_base)

    existing_fingerprints: set[str] = set()
    for entry in existing_entries:
        existing_fingerprints.update(entry_fingerprint_aliases(entry))

    appended = 0
    for entry in new_entries:
        entry_aliases = entry_fingerprint_aliases(entry)
        if not entry_aliases or any(alias in existing_fingerprints for alias in entry_aliases):
            continue
        existing_entries.append(entry)
        existing_fingerprints.update(entry_aliases)
        appended += 1

    merged_entries = sort_entries(existing_entries)
    existing_data_version = collapse_ws(str(log_payload.get("dataVersion", "")))
    existing_generated_at = collapse_ws(str(log_payload.get("generatedAt", "")))
    should_refresh_metadata = appended > 0 or not log_json.exists() or (args.retroactive_history and not args.append_retroactive)

    next_payload = {
        "dataVersion": (
            _dt.date.today().isoformat() + "-updates-log"
            if should_refresh_metadata
            else (existing_data_version or _dt.date.today().isoformat() + "-updates-log")
        ),
        "generatedAt": (
            logged_at_iso if should_refresh_metadata else (existing_generated_at or logged_at_iso)
        ),
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
        print(f"Raw newly detected entries: {len(new_entries)}")
    print(f"Update log entries appended: {appended}")
    print(f"Update log total entries: {len(merged_entries)}")
    print(f"Update log file: {log_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
