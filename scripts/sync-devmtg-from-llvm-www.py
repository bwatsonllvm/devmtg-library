#!/usr/bin/env python3
"""Sync LLVM Developers' Meeting talks/slides/videos from llvm-www/devmtg.

The sync is intentionally conservative:
  - existing talk IDs are preserved
  - matching talks are updated in place
  - newly discovered talks are appended with the next sequential ID
  - meeting bundles are created only when a source page has parseable talks
"""

from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


GITHUB_API_BASE = "https://api.github.com"
LLVM_WWW_REPO = "llvm/llvm-www"
LLVM_WWW_REF = "main"

CATEGORY_MAP: dict[str, str] = {
    "keynote": "keynote",
    "keynotes": "keynote",
    "technical talk": "technical-talk",
    "technical talks": "technical-talk",
    "student technical talk": "student-talk",
    "student technical talks": "student-talk",
    "tutorial": "tutorial",
    "tutorials": "tutorial",
    "panel": "panel",
    "panels": "panel",
    "quick talk": "quick-talk",
    "quick talks": "quick-talk",
    "lightning talk": "lightning-talk",
    "lightning talks": "lightning-talk",
    "bof": "bof",
    "birds of a feather": "bof",
    "poster": "poster",
    "posters": "poster",
    "workshop": "workshop",
    "workshops": "workshop",
}


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", collapse_ws(value).lower())


def normalize_meta_value(value: str) -> str:
    return normalize_key(value)


def strip_html(value: str) -> str:
    if not value:
        return ""
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"</p\s*>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    return collapse_ws(html.unescape(value))


def normalize_speaker_name(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", collapse_ws(name).lower()).strip()


def parse_speakers(raw: str) -> list[dict]:
    clean = collapse_ws(raw)
    if not clean or clean in {"-", "—"}:
        return []

    parts = [collapse_ws(piece) for piece in clean.split(",")]
    out: list[dict] = []
    for part in parts:
        if not part:
            continue
        out.append(
            {
                "name": part,
                "affiliation": "",
                "github": "",
                "linkedin": "",
                "twitter": "",
            }
        )
    return out


def category_from_heading(heading: str) -> str | None:
    clean = collapse_ws(heading).lower()
    clean = clean.rstrip(":")
    if clean in CATEGORY_MAP:
        return CATEGORY_MAP[clean]
    for label, category in CATEGORY_MAP.items():
        if label in clean:
            return category
    return None


def clean_title(raw: str) -> str:
    title = collapse_ws(raw)
    title = re.sub(r"\s*▲\s*back to schedule.*$", "", title, flags=re.IGNORECASE)
    title = title.replace("&#9650;", "")
    title = collapse_ws(title)
    return title


def parse_video_id(video_url: str | None) -> str | None:
    if not video_url:
        return None
    try:
        parsed = urllib.parse.urlparse(video_url)
    except Exception:
        return None

    host = (parsed.hostname or "").lower().replace("www.", "")
    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/", 1)[0]
        return candidate or None
    if host.endswith("youtube.com"):
        query = urllib.parse.parse_qs(parsed.query or "")
        value = query.get("v", [""])[0].strip()
        return value or None
    return None


def abs_devmtg_url(slug: str, href: str) -> str:
    base = f"https://llvm.org/devmtg/{slug}/"
    return urllib.parse.urljoin(base, href)


def _http_get(url: str, github_token: str = "") -> str:
    headers = {
        "User-Agent": "llvm-library-devmtg-sync/1.0",
        "Accept": "application/json" if "api.github.com" in url else "text/html,application/xhtml+xml",
    }
    token = collapse_ws(github_token)
    if token and "api.github.com" in url:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", errors="replace")


def list_remote_slugs(
    github_api_base: str,
    repo: str,
    ref: str,
    github_token: str = "",
) -> list[str]:
    url = (
        f"{github_api_base.rstrip('/')}/repos/{repo}/contents/devmtg"
        f"?ref={urllib.parse.quote(ref)}"
    )
    payload = json.loads(_http_get(url, github_token=github_token))
    out: list[str] = []
    for entry in payload:
        if str(entry.get("type", "")) != "dir":
            continue
        name = collapse_ws(str(entry.get("name", "")))
        if re.match(r"^\d{4}-\d{2}(?:-\d{2})?$", name):
            out.append(name)
    return sorted(set(out), reverse=True)


def extract_meeting_name(page_html: str, slug: str) -> str:
    h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", page_html, flags=re.IGNORECASE | re.DOTALL)
    if h1_match:
        value = clean_title(strip_html(h1_match.group(1)))
        if value:
            return value

    section_match = re.search(
        r'<div[^>]*class="www_sectiontitle"[^>]*>(.*?)</div>',
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if section_match:
        value = clean_title(strip_html(section_match.group(1)))
        if value:
            return value

    return slug


def extract_labeled_value(page_html: str, labels: list[str]) -> str:
    for label in labels:
        pattern = re.compile(
            rf"<li[^>]*>\s*<b[^>]*>\s*{re.escape(label)}\s*:?\s*</b>\s*:?\s*(.*?)</li>",
            flags=re.IGNORECASE | re.DOTALL,
        )
        match = pattern.search(page_html)
        if not match:
            continue
        value = collapse_ws(strip_html(match.group(1)))
        if value:
            return value
    return ""


def load_index_meeting_hints(repo: str, ref: str, github_token: str = "") -> dict[str, dict[str, str]]:
    """Parse canonical date/location hints from llvm-www/devmtg/index.html."""
    raw_url = f"https://raw.githubusercontent.com/{repo}/{ref}/devmtg/index.html"
    page_html = _http_get(raw_url, github_token=github_token)

    hints: dict[str, dict[str, str]] = {}
    li_pattern = re.compile(r"<li[^>]*>(.*?)</li>", flags=re.IGNORECASE | re.DOTALL)
    link_pattern = re.compile(
        r"<a[^>]+href=['\"](?P<href>\d{4}-\d{2}(?:-\d{2})?/?)['\"][^>]*>(?P<date>.*?)</a>(?P<rest>.*)",
        flags=re.IGNORECASE | re.DOTALL,
    )

    for li_html in li_pattern.findall(page_html):
        match = link_pattern.search(li_html)
        if not match:
            continue

        slug = collapse_ws(match.group("href")).rstrip("/")
        date_text = collapse_ws(strip_html(match.group("date")))
        rest_text = collapse_ws(strip_html(match.group("rest")))
        if not slug:
            continue

        location = ""
        if "-" in rest_text:
            location = collapse_ws(rest_text.split("-", 1)[1])
        elif rest_text:
            location = rest_text
        location = re.sub(r"\s*-\s*Canceled\s*$", "", location, flags=re.IGNORECASE).strip()

        hints[slug] = {
            "date": date_text,
            "location": location,
        }

    return hints


def parse_links_from_html(fragment: str, meeting_slug: str) -> tuple[str | None, str | None]:
    video_url: str | None = None
    slides_url: str | None = None

    for href, label in re.findall(
        r"<a[^>]+href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>",
        fragment,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        text = collapse_ws(strip_html(label)).lower()
        url = abs_devmtg_url(meeting_slug, href)

        if "video" in text and not video_url:
            video_url = url
        if "slide" in text and not slides_url:
            slides_url = url

    return video_url, slides_url


def parse_session_entries(page_html: str, meeting_slug: str) -> list[dict]:
    current_category = "technical-talk"
    talks: list[dict] = []

    token_re = re.compile(
        r"(?P<heading><p>\s*<b>[^<]+</b>\s*</p>)|"
        r"(?P<section><div[^>]*class=\"www_sectiontitle\"[^>]*>.*?</div>)|"
        r"(?P<session><div\s+class=\"session-entry\">.*?</div>)",
        flags=re.IGNORECASE | re.DOTALL,
    )

    for token in token_re.finditer(page_html):
        heading_html = token.group("heading") or token.group("section")
        if heading_html:
            maybe_category = category_from_heading(strip_html(heading_html))
            if maybe_category:
                current_category = maybe_category
            continue

        block = token.group("session")
        if not block:
            continue

        title_match = re.search(r"<i>(.*?)</i>", block, flags=re.IGNORECASE | re.DOTALL)
        if not title_match:
            continue
        title = clean_title(strip_html(title_match.group(1)))
        if not title:
            continue

        category = current_category
        if title.lower().startswith("keynote:"):
            category = "keynote"
            title = collapse_ws(title.split(":", 1)[1])

        video_url, slides_url = parse_links_from_html(block, meeting_slug)
        video_id = parse_video_id(video_url)

        speaker_match = re.search(
            r"(?:Speakers?|Presenters?)\s*:\s*(.*?)<br",
            block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        speakers = parse_speakers(strip_html(speaker_match.group(1)) if speaker_match else "")

        abstract = ""
        paragraph_candidates = re.findall(r"<p[^>]*>(.*?)</p>", block, flags=re.IGNORECASE | re.DOTALL)
        for paragraph in paragraph_candidates:
            text = collapse_ws(strip_html(paragraph))
            if not text:
                continue
            if re.match(r"^(?:Speakers?|Presenters?)\s*:", text, flags=re.IGNORECASE):
                continue
            if normalize_key(text) == normalize_key(title):
                continue
            if len(text) > len(abstract):
                abstract = text

        talks.append(
            {
                "title": title,
                "category": category,
                "speakers": speakers,
                "abstract": abstract,
                "videoUrl": video_url,
                "videoId": video_id,
                "slidesUrl": slides_url,
            }
        )

    return talks


def parse_abstract_sections(page_html: str, meeting_slug: str) -> list[dict]:
    talks: list[dict] = []
    pattern = re.compile(
        r"<h3[^>]*id=['\"]([^'\"]+)['\"][^>]*>(.*?)</h3>\s*<h4[^>]*>(.*?)</h4>\s*<p[^>]*>(.*?)</p>",
        flags=re.IGNORECASE | re.DOTALL,
    )

    for _, title_html, speaker_html, abstract_html in pattern.findall(page_html):
        raw_title_text = clean_title(strip_html(title_html))
        if not raw_title_text:
            continue

        lower_title = raw_title_text.lower()
        if "call for speakers" in lower_title:
            continue
        if "program committee" in lower_title:
            continue

        category = "technical-talk"
        title_text = raw_title_text
        if lower_title.startswith("keynote:"):
            category = "keynote"
            title_text = collapse_ws(raw_title_text.split(":", 1)[1])

        video_url, slides_url = parse_links_from_html(title_html, meeting_slug)
        video_id = parse_video_id(video_url)
        speakers = parse_speakers(strip_html(speaker_html))
        abstract = collapse_ws(strip_html(abstract_html))

        talks.append(
            {
                "title": title_text,
                "category": category,
                "speakers": speakers,
                "abstract": abstract,
                "videoUrl": video_url,
                "videoId": video_id,
                "slidesUrl": slides_url,
            }
        )

    return talks


def dedupe_parsed_talks(talks: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for talk in talks:
        title_key = normalize_key(str(talk.get("title", "")))
        speaker_key = ",".join(
            normalize_speaker_name(str(s.get("name", "")))
            for s in (talk.get("speakers") or [])
            if normalize_speaker_name(str(s.get("name", "")))
        )
        key = f"{title_key}|{speaker_key}"
        if not title_key or key in seen:
            continue
        seen.add(key)
        out.append(talk)
    return out


def parse_meeting_page(page_html: str, slug: str) -> tuple[dict, list[dict]]:
    meeting = {
        "slug": slug,
        "name": extract_meeting_name(page_html, slug),
        "date": extract_labeled_value(page_html, ["Conference Date", "When", "Date"]),
        "location": extract_labeled_value(page_html, ["Location", "Where"]),
        "canceled": False,
        "talkCount": 0,
    }

    talks = parse_session_entries(page_html, slug)
    if not talks:
        talks = parse_abstract_sections(page_html, slug)

    talks = dedupe_parsed_talks(talks)
    meeting["talkCount"] = len(talks)
    return meeting, talks


def extract_talk_match_key(talk: dict) -> tuple[str, str]:
    title_key = normalize_key(str(talk.get("title", "")))
    speaker_key = ",".join(
        normalize_speaker_name(str(speaker.get("name", "")))
        for speaker in (talk.get("speakers") or [])
        if normalize_speaker_name(str(speaker.get("name", "")))
    )
    return title_key, speaker_key


def next_talk_id(existing_talks: list[dict], slug: str, used_ids: set[str]) -> str:
    max_id = 0
    pattern = re.compile(rf"^{re.escape(slug)}-(\d+)$")
    for talk in existing_talks:
        talk_id = collapse_ws(str(talk.get("id", "")))
        match = pattern.match(talk_id)
        if match:
            max_id = max(max_id, int(match.group(1)))

    while True:
        max_id += 1
        candidate = f"{slug}-{max_id:03d}"
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate


def merge_meeting_talks(
    slug: str,
    meeting_meta: dict,
    remote_talks: list[dict],
    existing_payload: dict | None,
    index_hint: dict[str, str] | None = None,
) -> tuple[dict, bool, int]:
    existing_talks = list((existing_payload or {}).get("talks") or [])
    changed = False
    new_count = 0

    existing_meeting = dict((existing_payload or {}).get("meeting") or {})
    exemplar_talk = existing_talks[0] if existing_talks else {}

    preferred_meeting_name = (
        collapse_ws(str(existing_meeting.get("name", "")))
        or collapse_ws(str(exemplar_talk.get("meetingName", "")))
        or collapse_ws(str(meeting_meta.get("name", "")))
        or slug
    )
    preferred_meeting_location = (
        collapse_ws(str(existing_meeting.get("location", "")))
        or collapse_ws(str(exemplar_talk.get("meetingLocation", "")))
        or collapse_ws(str((index_hint or {}).get("location", "")))
        or collapse_ws(str(meeting_meta.get("location", "")))
        or ""
    )
    preferred_meeting_date = (
        collapse_ws(str(existing_meeting.get("date", "")))
        or collapse_ws(str(exemplar_talk.get("meetingDate", "")))
        or collapse_ws(str((index_hint or {}).get("date", "")))
        or collapse_ws(str(meeting_meta.get("date", "")))
        or ""
    )

    def _promote_index_hint_if_raw_overwrite(current_value: str, upstream_value: str, hint_value: str) -> str:
        current_norm = normalize_meta_value(current_value)
        upstream_norm = normalize_meta_value(upstream_value)
        hint_norm = normalize_meta_value(hint_value)
        if current_norm and upstream_norm and hint_norm:
            if current_norm == upstream_norm and current_norm != hint_norm:
                return hint_value
        return current_value

    if index_hint:
        preferred_meeting_date = _promote_index_hint_if_raw_overwrite(
            preferred_meeting_date,
            collapse_ws(str(meeting_meta.get("date", ""))),
            collapse_ws(str(index_hint.get("date", ""))),
        ) or preferred_meeting_date
        preferred_meeting_location = _promote_index_hint_if_raw_overwrite(
            preferred_meeting_location,
            collapse_ws(str(meeting_meta.get("location", ""))),
            collapse_ws(str(index_hint.get("location", ""))),
        ) or preferred_meeting_location

    by_composite: dict[tuple[str, str], list[dict]] = {}
    by_title: dict[str, list[dict]] = {}
    used_ids: set[str] = set()
    for talk in existing_talks:
        talk_id = collapse_ws(str(talk.get("id", "")))
        if talk_id:
            used_ids.add(talk_id)
        title_key, speaker_key = extract_talk_match_key(talk)
        if title_key:
            by_title.setdefault(title_key, []).append(talk)
            by_composite.setdefault((title_key, speaker_key), []).append(talk)

    def apply_common_fields(target: dict, source: dict):
        nonlocal changed

        for key, default in [
            ("meeting", slug),
            ("meetingName", preferred_meeting_name),
            ("meetingLocation", preferred_meeting_location),
            ("meetingDate", preferred_meeting_date),
            ("projectGithub", ""),
            ("tags", []),
        ]:
            if key not in target:
                target[key] = default
                changed = True

        if target.get("meeting") != slug:
            target["meeting"] = slug
            changed = True
        if not collapse_ws(str(target.get("meetingName", ""))) and preferred_meeting_name:
            target["meetingName"] = preferred_meeting_name
            changed = True
        if (
            not collapse_ws(str(target.get("meetingLocation", "")))
            or normalize_meta_value(str(target.get("meetingLocation", "")))
            == normalize_meta_value(str(meeting_meta.get("location", "")))
            and normalize_meta_value(str(target.get("meetingLocation", "")))
            != normalize_meta_value(preferred_meeting_location)
        ) and preferred_meeting_location:
            target["meetingLocation"] = preferred_meeting_location
            changed = True
        if (
            not collapse_ws(str(target.get("meetingDate", "")))
            or normalize_meta_value(str(target.get("meetingDate", "")))
            == normalize_meta_value(str(meeting_meta.get("date", "")))
            and normalize_meta_value(str(target.get("meetingDate", "")))
            != normalize_meta_value(preferred_meeting_date)
        ) and preferred_meeting_date:
            target["meetingDate"] = preferred_meeting_date
            changed = True

        # Preserve curated talk metadata; only backfill missing fields.
        for field in ["title", "category", "abstract"]:
            src_value = source.get(field)
            if not collapse_ws(str(src_value or "")):
                continue
            if collapse_ws(str(target.get(field, ""))):
                continue
            target[field] = src_value
            changed = True

        src_speakers = source.get("speakers")
        if isinstance(src_speakers, list) and src_speakers:
            existing_speakers = target.get("speakers")
            if not (isinstance(existing_speakers, list) and existing_speakers):
                target["speakers"] = src_speakers
                changed = True

        # Resource links are safe to refresh from upstream when present.
        for field in ["videoUrl", "videoId", "slidesUrl"]:
            src_value = source.get(field)
            if src_value in ("", None):
                continue
            if target.get(field) != src_value:
                target[field] = src_value
                changed = True

    for remote in remote_talks:
        title_key, speaker_key = extract_talk_match_key(remote)
        match: dict | None = None

        if title_key:
            composite_hits = by_composite.get((title_key, speaker_key), [])
            if len(composite_hits) == 1:
                match = composite_hits[0]
            elif len(composite_hits) > 1:
                match = composite_hits[0]
            else:
                title_hits = by_title.get(title_key, [])
                if len(title_hits) == 1:
                    match = title_hits[0]

        if match is None:
            talk_id = next_talk_id(existing_talks, slug, used_ids)
            match = {
                "id": talk_id,
                "meeting": slug,
                "meetingName": preferred_meeting_name,
                "meetingLocation": preferred_meeting_location,
                "meetingDate": preferred_meeting_date,
                "category": remote.get("category") or "technical-talk",
                "title": remote.get("title") or "",
                "speakers": remote.get("speakers") or [],
                "abstract": remote.get("abstract") or "",
                "videoUrl": remote.get("videoUrl"),
                "videoId": remote.get("videoId"),
                "slidesUrl": remote.get("slidesUrl"),
                "projectGithub": "",
                "tags": [],
            }
            existing_talks.append(match)
            by_title.setdefault(title_key, []).append(match)
            by_composite.setdefault((title_key, speaker_key), []).append(match)
            changed = True
            new_count += 1
            continue

        apply_common_fields(match, remote)

    meeting_payload = existing_meeting
    if meeting_payload.get("slug") != slug:
        meeting_payload["slug"] = slug
        changed = True

    if not collapse_ws(str(meeting_payload.get("name", ""))) and preferred_meeting_name:
        meeting_payload["name"] = preferred_meeting_name
        changed = True
    if (
        not collapse_ws(str(meeting_payload.get("date", "")))
        or normalize_meta_value(str(meeting_payload.get("date", "")))
        == normalize_meta_value(str(meeting_meta.get("date", "")))
        and normalize_meta_value(str(meeting_payload.get("date", "")))
        != normalize_meta_value(preferred_meeting_date)
    ) and preferred_meeting_date:
        meeting_payload["date"] = preferred_meeting_date
        changed = True
    if (
        not collapse_ws(str(meeting_payload.get("location", "")))
        or normalize_meta_value(str(meeting_payload.get("location", "")))
        == normalize_meta_value(str(meeting_meta.get("location", "")))
        and normalize_meta_value(str(meeting_payload.get("location", "")))
        != normalize_meta_value(preferred_meeting_location)
    ) and preferred_meeting_location:
        meeting_payload["location"] = preferred_meeting_location
        changed = True
    if "canceled" not in meeting_payload:
        meeting_payload["canceled"] = bool(meeting_meta.get("canceled", False))
        changed = True

    if meeting_payload.get("talkCount") != len(existing_talks):
        meeting_payload["talkCount"] = len(existing_talks)
        changed = True

    payload = {
        "meeting": meeting_payload,
        "talks": existing_talks,
    }
    return payload, changed, new_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events-dir", default="/Users/britton/Desktop/library/devmtg/events")
    parser.add_argument("--manifest", default="/Users/britton/Desktop/library/devmtg/events/index.json")
    parser.add_argument("--repo", default=LLVM_WWW_REPO, help="GitHub repo in owner/name form")
    parser.add_argument("--ref", default=LLVM_WWW_REF, help="Git ref for llvm-www")
    parser.add_argument("--github-api-base", default=GITHUB_API_BASE)
    parser.add_argument("--github-token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--only-slug", action="append", help="Optional meeting slug filter (repeatable)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    events_dir = Path(args.events_dir).resolve()
    manifest_path = Path(args.manifest).resolve()
    events_dir.mkdir(parents=True, exist_ok=True)

    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = {"dataVersion": "", "eventFiles": []}

    manifest_files = [collapse_ws(str(item)) for item in manifest.get("eventFiles", []) if collapse_ws(str(item))]
    manifest_set = set(manifest_files)

    index_hints: dict[str, dict[str, str]] = {}
    try:
        index_hints = load_index_meeting_hints(
            repo=args.repo,
            ref=args.ref,
            github_token=args.github_token,
        )
    except urllib.error.HTTPError as exc:
        if args.verbose:
            print(f"[warn] Could not fetch devmtg index hints (HTTP {exc.code}); continuing.", flush=True)
    except urllib.error.URLError as exc:
        if args.verbose:
            print(f"[warn] Could not fetch devmtg index hints ({exc}); continuing.", flush=True)

    try:
        remote_slugs = list_remote_slugs(
            github_api_base=args.github_api_base,
            repo=args.repo,
            ref=args.ref,
            github_token=args.github_token,
        )
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Failed to list llvm-www/devmtg directories: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Failed to list llvm-www/devmtg directories: {exc}") from exc

    if args.only_slug:
        allowed = {collapse_ws(slug) for slug in args.only_slug if collapse_ws(slug)}
        remote_slugs = [slug for slug in remote_slugs if slug in allowed]

    changed_slugs: list[str] = []
    created_slugs: list[str] = []
    discovered_new_talks = 0

    for slug in remote_slugs:
        raw_url = f"https://raw.githubusercontent.com/{args.repo}/{args.ref}/devmtg/{slug}/index.html"
        try:
            page_html = _http_get(raw_url, github_token=args.github_token)
        except urllib.error.HTTPError as exc:
            if args.verbose:
                print(f"[skip] {slug}: HTTP {exc.code} while fetching {raw_url}", flush=True)
            continue
        except urllib.error.URLError as exc:
            if args.verbose:
                print(f"[skip] {slug}: network error while fetching {raw_url}: {exc}", flush=True)
            continue

        meeting_meta, remote_talks = parse_meeting_page(page_html, slug)
        if not remote_talks:
            if args.verbose:
                print(f"[skip] {slug}: no parseable talks found", flush=True)
            continue

        event_filename = f"{slug}.json"
        event_path = events_dir / event_filename
        existing_payload = None
        if event_path.exists():
            existing_payload = json.loads(event_path.read_text(encoding="utf-8"))

        merged_payload, changed, new_count = merge_meeting_talks(
            slug=slug,
            meeting_meta=meeting_meta,
            remote_talks=remote_talks,
            existing_payload=existing_payload,
            index_hint=index_hints.get(slug),
        )
        if not changed:
            continue

        changed_slugs.append(slug)
        discovered_new_talks += new_count
        if not event_path.exists():
            created_slugs.append(slug)

        if not args.dry_run:
            event_path.write_text(json.dumps(merged_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        manifest_set.add(event_filename)
        if args.verbose:
            print(
                f"[update] {slug}: talks={len(merged_payload.get('talks', []))} new={new_count}",
                flush=True,
            )

    if not changed_slugs:
        print("No devmtg updates detected.")
        return 0

    next_event_files = sorted(manifest_set, reverse=True)
    next_data_version = _dt.date.today().isoformat() + "-auto-sync-devmtg"
    manifest_changed = (
        manifest.get("eventFiles", []) != next_event_files
        or collapse_ws(str(manifest.get("dataVersion", ""))) != next_data_version
    )
    manifest["eventFiles"] = next_event_files
    manifest["dataVersion"] = next_data_version

    if manifest_changed and not args.dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(
        "Updated devmtg bundles: "
        f"{len(changed_slugs)} meetings, "
        f"{discovered_new_talks} newly discovered talks."
    )
    if created_slugs:
        print(f"Created new meeting files: {', '.join(created_slugs)}")
    print(f"Updated manifest: {manifest_path} (dataVersion={manifest['dataVersion']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
