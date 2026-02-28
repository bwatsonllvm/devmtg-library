#!/usr/bin/env python3
"""Sync LLVM Project blog posts from llvm/llvm-blog-www into a papers bundle.

This script:
1) Downloads the llvm-blog-www repository tarball from GitHub.
2) Parses Hugo front matter and body content from content/posts/*.
3) Emits a papers-compatible JSON bundle (blog entries as non-PDF linked works).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import os
import re
import subprocess
import tarfile
import tempfile
import urllib.parse
from pathlib import Path


DEFAULT_REPO = "llvm/llvm-blog-www"
DEFAULT_REF = "main"
DEFAULT_OUTPUT = "papers/llvm-blog-posts.json"
DEFAULT_CACHE_DIR = "papers/.cache/llvm-blog"
DEFAULT_BLOG_BASE_URL = "https://blog.llvm.org/"
DEFAULT_SOURCE_SLUG = "llvm-blog-www"
DEFAULT_SOURCE_NAME = "LLVM Project Blog (llvm/llvm-blog-www)"
DEFAULT_USER_AGENT = "llvm-library-blog-sync/1.0"
ALLOWED_EXTS = {".md", ".markdown", ".html", ".htm"}
TRUSTED_GITHUB_TOKEN_HOSTS = {
    "api.github.com",
    "codeload.github.com",
    "github.com",
    "raw.githubusercontent.com",
}


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", collapse_ws(value).lower())


def sanitize_http_url(value: str) -> str:
    raw = collapse_ws(value)
    if not raw:
        return ""
    try:
        parsed = urllib.parse.urlparse(raw)
    except Exception:
        return ""
    if parsed.scheme.lower() not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    return urllib.parse.urlunparse(parsed)


def strip_html(value: str) -> str:
    text = value or ""
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return collapse_ws(html.unescape(text))


def strip_markdown(value: str) -> str:
    text = value or ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"`[^`]*`", " ", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = text.replace("*", " ").replace("_", " ")
    text = strip_html(text)
    return collapse_ws(text)


def slugify(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered)
    return lowered.strip("-")


def split_front_matter(raw_text: str) -> tuple[dict, str]:
    text = raw_text or ""
    lines = text.splitlines()
    if not lines:
        return {}, text

    delimiter = lines[0].strip()
    if delimiter not in {"---", "+++"}:
        return {}, text

    end_idx = None
    for idx in range(1, len(lines)):
        line = lines[idx].strip()
        if delimiter == "---":
            # Hugo YAML front matter is usually '---', but some legacy posts
            # close with longer runs of '-'.
            if re.match(r"^-{3,}$", line) or line == "...":
                end_idx = idx
                break
        elif re.match(r"^\+{3,}$", line):
            end_idx = idx
            break
    if end_idx is None:
        return {}, text

    fm_lines = lines[1:end_idx]
    body = "\n".join(lines[end_idx + 1 :])
    style = "toml" if delimiter == "+++" else "yaml"
    return parse_front_matter(fm_lines, style=style), body


def consume_quoted_value(lines: list[str], start_idx: int, value: str) -> tuple[str, int]:
    raw = value.strip()
    if not raw or raw[0] not in {"'", '"'}:
        return raw, start_idx

    quote = raw[0]
    if len(raw) >= 2 and raw[-1] == quote and raw[-2] != "\\":
        return raw, start_idx

    parts = [raw]
    idx = start_idx + 1
    while idx < len(lines):
        segment = lines[idx].strip()
        parts.append(segment)
        if segment and segment[-1] == quote and (len(segment) == 1 or segment[-2] != "\\"):
            break
        idx += 1
    return " ".join(part for part in parts if part), idx


def parse_front_matter(lines: list[str], style: str = "yaml") -> dict:
    out: dict = {}
    i = 0
    is_toml = style == "toml"
    line_re = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$" if is_toml else r"^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$")

    while i < len(lines):
        line = lines[i].rstrip("\n")
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue

        m = line_re.match(line)
        if not m:
            i += 1
            continue

        key = m.group(1)
        raw_val = m.group(2)
        raw_val, consumed_idx = consume_quoted_value(lines, i, raw_val)
        if raw_val:
            list_val = parse_inline_list(raw_val)
            out[key] = list_val if list_val is not None else parse_scalar(raw_val)
            i = max(i, consumed_idx) + 1
            continue

        if is_toml:
            out[key] = ""
            i = max(i, consumed_idx) + 1
            continue

        # YAML-only: possible block list.
        values: list[str] = []
        j = i + 1
        while j < len(lines):
            lm = re.match(r"^\s*-\s*(.*?)\s*$", lines[j])
            if not lm:
                break
            item = parse_scalar(lm.group(1))
            if item:
                values.append(item)
            j += 1
        out[key] = values
        i = j

    return out


def parse_scalar(value: str) -> str:
    text = collapse_ws(value)
    if len(text) >= 2 and ((text[0] == text[-1] == '"') or (text[0] == text[-1] == "'")):
        text = text[1:-1]
    text = text.replace('\\"', '"').replace("\\'", "'")
    return collapse_ws(text)


def parse_inline_list(value: str) -> list[str] | None:
    text = collapse_ws(value)
    if not (text.startswith("[") and text.endswith("]")):
        return None

    inner = text[1:-1].strip()
    if not inner:
        return []

    parts: list[str] = []
    token = []
    quote = ""
    escaped = False

    for ch in inner:
        if escaped:
            token.append(ch)
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if quote:
            if ch == quote:
                quote = ""
            else:
                token.append(ch)
            continue
        if ch in {"'", '"'}:
            quote = ch
            continue
        if ch == ",":
            parts.append("".join(token))
            token = []
            continue
        token.append(ch)
    parts.append("".join(token))

    out: list[str] = []
    for part in parts:
        item = parse_scalar(part)
        if item:
            out.append(item)
    return out


def parse_authors(front_matter: dict) -> list[dict]:
    raw_authors = front_matter.get("authors")
    if raw_authors is None:
        raw_authors = front_matter.get("author")

    names: list[str] = []
    if isinstance(raw_authors, list):
        names.extend([collapse_ws(str(v)) for v in raw_authors if collapse_ws(str(v))])
    elif isinstance(raw_authors, str):
        blob = raw_authors.replace(" and ", ",")
        names.extend([collapse_ws(v) for v in blob.split(",") if collapse_ws(v)])

    out: list[dict] = []
    seen: set[str] = set()
    for name in names:
        key = normalize_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"name": name, "affiliation": ""})
    return out


def parse_tags(front_matter: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for key in ["tags", "categories"]:
        raw = front_matter.get(key)
        values: list[str] = []
        if isinstance(raw, list):
            values = [collapse_ws(str(v)) for v in raw if collapse_ws(str(v))]
        elif isinstance(raw, str):
            values = [collapse_ws(v) for v in raw.split(",") if collapse_ws(v)]
        for value in values:
            norm = normalize_key(value)
            if not norm or norm in seen:
                continue
            seen.add(norm)
            out.append(value)
    return out


def derive_title(front_matter: dict, file_name: str) -> str:
    title = collapse_ws(str(front_matter.get("title", "")))
    if title:
        return title
    stem = file_name.rsplit(".", 1)[0]
    stem = re.sub(r"^\d{4}(?:-\d{2}){1,2}-", "", stem)
    stem = stem.replace("_", " ").replace("-", " ")
    stem = collapse_ws(stem)
    if not stem:
        return file_name
    return stem


def parse_year_and_date(front_matter: dict, file_name: str) -> tuple[str, str]:
    date_value = collapse_ws(str(front_matter.get("date", "")))
    if date_value:
        m = re.search(r"((?:19|20)\d{2})(?:-(\d{2}))?(?:-(\d{2}))?", date_value)
        if m:
            year = m.group(1)
            month = m.group(2) or "01"
            day = m.group(3) or "01"
            return year, f"{year}-{month}-{day}"

    m = re.match(r"^((?:19|20)\d{2})(?:-(\d{2}))?(?:-(\d{2}))?", file_name)
    if m:
        year = m.group(1)
        month = m.group(2) or "01"
        day = m.group(3) or "01"
        return year, f"{year}-{month}-{day}"
    return "", "0000-00-00"


def resolve_blog_url(front_matter: dict, blog_base_url: str, file_name: str) -> str:
    for key in ["url", "aliases"]:
        raw = front_matter.get(key)
        candidates: list[str] = []
        if isinstance(raw, str):
            candidates = [raw]
        elif isinstance(raw, list):
            candidates = [str(v) for v in raw]
        for candidate in candidates:
            value = collapse_ws(candidate)
            if not value:
                continue
            if re.match(r"^https?://", value, flags=re.IGNORECASE):
                safe = sanitize_http_url(value)
                if safe:
                    return safe
                continue
            safe = sanitize_http_url(urllib.parse.urljoin(blog_base_url, value.lstrip("/")))
            if safe:
                return safe

    stem = file_name.rsplit(".", 1)[0]
    return sanitize_http_url(urllib.parse.urljoin(blog_base_url, f"posts/{stem}/"))


def summarize_body(body: str, extension: str, max_words: int = 110) -> str:
    text = strip_html(body) if extension in {".html", ".htm"} else strip_markdown(body)
    if not text:
        return "LLVM Project Blog post."
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).rstrip(" ,;:.") + "..."


def normalize_body(body: str) -> str:
    text = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.strip()


def should_send_github_token(url: str) -> bool:
    raw = collapse_ws(url)
    if not raw:
        return False
    try:
        parsed = urllib.parse.urlparse(raw)
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return host in TRUSTED_GITHUB_TOKEN_HOSTS


def run_curl(url: str, output_path: Path | None, user_agent: str, github_token: str, timeout_s: int, head_only: bool = False) -> str:
    cmd = [
        "curl",
        "-sS",
        "-L",
        "--retry",
        "5",
        "--retry-all-errors",
        "--connect-timeout",
        "20",
        "--max-time",
        str(max(20, timeout_s)),
        "-A",
        user_agent,
    ]
    token = collapse_ws(github_token)
    token_header_path: Path | None = None
    if token and should_send_github_token(url):
        fd, temp_path = tempfile.mkstemp(prefix="llvm-blog-github-auth-", suffix=".hdr")
        os.close(fd)
        token_header_path = Path(temp_path)
        token_header_path.write_text(f"Authorization: Bearer {token}\n", encoding="utf-8")
        cmd.extend(["-H", f"@{token_header_path}"])
    if head_only:
        cmd.append("-I")
    if output_path is not None:
        cmd.extend(["-o", str(output_path)])
    cmd.append(url)

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    finally:
        if token_header_path is not None:
            try:
                token_header_path.unlink()
            except Exception:
                pass
    if proc.returncode != 0:
        detail = collapse_ws(proc.stderr or proc.stdout or f"curl exited {proc.returncode}")
        raise RuntimeError(f"curl failed for {url}: {detail}")
    return proc.stdout


def extract_header_value(raw_headers: str, header_name: str) -> str:
    target = header_name.lower() + ":"
    for line in raw_headers.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith(target):
            return collapse_ws(stripped.split(":", 1)[1])
    return ""


def load_json(path: Path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def has_named_authors(value) -> bool:
    if not isinstance(value, list):
        return False
    for item in value:
        if isinstance(item, dict) and collapse_ws(str(item.get("name", ""))):
            return True
    return False


def normalize_identity_url(value: str) -> str:
    safe = sanitize_http_url(value)
    if not safe:
        return ""
    parsed = urllib.parse.urlparse(safe)
    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        return ""
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return f"{host}{path}".lower()


def _blog_record_match_keys(record: dict) -> list[str]:
    keys: set[str] = set()

    record_id = collapse_ws(str(record.get("id", ""))).lower()
    if record_id:
        keys.add(f"id:{record_id}")

    source_url_key = normalize_identity_url(str(record.get("sourceUrl", "")))
    if source_url_key:
        keys.add(f"source:{source_url_key}")

    paper_url_key = normalize_identity_url(str(record.get("paperUrl", "")))
    if paper_url_key:
        keys.add(f"paper:{paper_url_key}")

    year = collapse_ws(str(record.get("year", "")))
    title_key = normalize_key(str(record.get("title", "")))
    if year and title_key:
        keys.add(f"title:{year}:{title_key}")

    return sorted(keys)


def _build_existing_blog_index(records: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        for key in _blog_record_match_keys(record):
            out.setdefault(key, []).append(record)
    return out


def _clean_string_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        clean = collapse_ws(str(item))
        if not clean:
            continue
        key = normalize_key(clean)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(clean)
    return out


def _copy_scalar_field_from_existing(out: dict, existing: dict, field: str) -> bool:
    existing_value = existing.get(field, "")
    existing_text = collapse_ws(str(existing_value))
    if not existing_text:
        return False
    current_text = collapse_ws(str(out.get(field, "")))
    if current_text == existing_text:
        return False
    out[field] = existing_value
    return True


def _copy_list_field_from_existing(out: dict, existing: dict, field: str) -> bool:
    raw = existing.get(field)
    if field == "authors":
        if not has_named_authors(raw):
            return False
        if out.get(field) == raw:
            return False
        out[field] = json.loads(json.dumps(raw, ensure_ascii=False))
        return True

    values = _clean_string_list(raw)
    if not values:
        return False
    if _clean_string_list(out.get(field)) == values:
        return False
    out[field] = values
    return True


def _pick_existing_blog_match(record: dict, index: dict[str, list[dict]]) -> dict | None:
    current_keys = _blog_record_match_keys(record)
    if not current_keys:
        return None

    candidates: list[dict] = []
    seen_ids: set[int] = set()
    for key in current_keys:
        for candidate in index.get(key, []):
            ptr = id(candidate)
            if ptr in seen_ids:
                continue
            seen_ids.add(ptr)
            candidates.append(candidate)
    if not candidates:
        return None

    key_set = set(current_keys)

    def score(item: dict) -> tuple[int, int, int]:
        shared = len(key_set & set(_blog_record_match_keys(item)))
        named_authors = 1 if has_named_authors(item.get("authors")) else 0
        has_abstract = 1 if collapse_ws(str(item.get("abstract", ""))) else 0
        return (shared, named_authors, has_abstract)

    return max(candidates, key=score)


def overlay_existing_blog_metadata(papers: list[dict], existing_records: list[dict]) -> tuple[int, int]:
    if not papers or not existing_records:
        return 0, 0

    index = _build_existing_blog_index(existing_records)
    matched = 0
    updated = 0

    for paper in papers:
        existing = _pick_existing_blog_match(paper, index)
        if not existing:
            continue

        matched += 1
        changed = False

        for field in [
            "title",
            "year",
            "publishedDate",
            "publication",
            "venue",
            "type",
            "abstract",
            "paperUrl",
            "sourceUrl",
            "openalexId",
            "doi",
            "citationCount",
        ]:
            if _copy_scalar_field_from_existing(paper, existing, field):
                changed = True

        for field in ["authors", "tags", "keywords", "matchedAuthors", "matchedSubprojects"]:
            if _copy_list_field_from_existing(paper, existing, field):
                changed = True

        if changed:
            updated += 1

    return matched, updated


def save_json_if_changed(path: Path, payload) -> bool:
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if text == existing:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def download_repo_tarball(
    repo: str,
    ref: str,
    cache_dir: Path,
    user_agent: str,
    github_token: str,
    timeout_s: int,
) -> tuple[Path, str, bool]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    tar_path = cache_dir / f"{repo.replace('/', '-')}-{slugify(ref) or 'ref'}.tar.gz"
    meta_path = cache_dir / f"{repo.replace('/', '-')}-{slugify(ref) or 'ref'}.meta.json"

    tarball_url = f"https://codeload.github.com/{repo}/tar.gz/refs/heads/{urllib.parse.quote(ref)}"
    cached_meta = load_json(meta_path)
    cached_etag = collapse_ws(str(cached_meta.get("etag", "")))
    remote_etag = ""
    try:
        remote_headers = run_curl(
            tarball_url,
            output_path=None,
            user_agent=user_agent,
            github_token=github_token,
            timeout_s=timeout_s,
            head_only=True,
        )
        remote_etag = extract_header_value(remote_headers, "etag")
    except Exception:
        if tar_path.exists():
            # Keep sync usable when network is flaky/unavailable.
            return tar_path, cached_etag, False
        raise

    if tar_path.exists() and remote_etag and cached_etag == remote_etag:
        return tar_path, remote_etag, False

    run_curl(
        tarball_url,
        output_path=tar_path,
        user_agent=user_agent,
        github_token=github_token,
        timeout_s=max(timeout_s, 120),
    )
    save_json_if_changed(
        meta_path,
        {
            "repo": repo,
            "ref": ref,
            "etag": remote_etag,
            "updatedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        },
    )
    return tar_path, remote_etag, True


def fetch_latest_repo_path_revision(
    repo: str,
    ref: str,
    source_path: str,
    user_agent: str,
    github_token: str,
    timeout_s: int,
) -> str:
    normalized_path = collapse_ws(source_path).lstrip("/")
    if not normalized_path:
        return ""
    url = (
        f"https://api.github.com/repos/{repo}/commits"
        f"?sha={urllib.parse.quote(ref)}"
        f"&path={urllib.parse.quote(normalized_path)}"
        "&per_page=1"
    )
    try:
        raw = run_curl(
            url,
            output_path=None,
            user_agent=user_agent,
            github_token=github_token,
            timeout_s=timeout_s,
        )
        payload = json.loads(raw)
    except Exception:
        return ""

    entries: list[dict] = []
    if isinstance(payload, list):
        entries = [entry for entry in payload if isinstance(entry, dict)]
    elif isinstance(payload, dict):
        entries = [payload]

    for entry in entries:
        sha = collapse_ws(str(entry.get("sha", "")))
        if re.fullmatch(r"[0-9a-fA-F]{7,40}", sha):
            return sha
    return ""


def build_blog_bundle(
    tar_path: Path,
    repo: str,
    ref: str,
    source_path: str,
    source_revision: str,
    blog_base_url: str,
    max_posts: int,
    include_legacy_html: bool,
) -> tuple[dict, int]:
    papers: list[dict] = []
    skipped = 0
    seen_ids: set[str] = set()

    with tarfile.open(tar_path, "r:gz") as archive:
        members = [m for m in archive.getmembers() if m.isfile()]
        post_members: list[tuple[str, tarfile.TarInfo]] = []

        for member in members:
            full_name = collapse_ws(member.name)
            if "/" not in full_name:
                continue
            rel_path = full_name.split("/", 1)[1]
            if not rel_path.startswith("content/posts/"):
                continue
            file_name = rel_path.rsplit("/", 1)[-1]
            ext = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            if ext not in ALLOWED_EXTS:
                continue
            if not include_legacy_html and ext in {".html", ".htm"}:
                continue
            post_members.append((rel_path, member))

        post_members.sort(key=lambda item: item[0].lower())
        if max_posts > 0:
            post_members = post_members[:max_posts]

        for rel_path, member in post_members:
            fh = archive.extractfile(member)
            if fh is None:
                skipped += 1
                continue
            raw_text = fh.read().decode("utf-8", errors="replace")
            front_matter, body = split_front_matter(raw_text)

            file_name = rel_path.rsplit("/", 1)[-1]
            ext = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            title = derive_title(front_matter, file_name)
            if not title:
                skipped += 1
                continue

            year, sort_date = parse_year_and_date(front_matter, file_name)
            tags = parse_tags(front_matter)
            authors = parse_authors(front_matter)
            blog_url = resolve_blog_url(front_matter, blog_base_url, file_name)
            blob_path = urllib.parse.quote(rel_path, safe="/-_.~")
            repo_blob_url = f"https://github.com/{repo}/blob/{urllib.parse.quote(ref)}/{blob_path}"
            normalized_body = normalize_body(body)
            abstract = summarize_body(normalized_body, ext)
            content_format = "html" if ext in {".html", ".htm"} else "markdown"

            stem = file_name.rsplit(".", 1)[0]
            base_id = slugify(f"blog-{stem}") or "blog-post"
            post_id = base_id
            suffix = 2
            while post_id in seen_ids:
                post_id = f"{base_id}-{suffix}"
                suffix += 1
            seen_ids.add(post_id)

            record = {
                "id": post_id,
                "source": DEFAULT_SOURCE_SLUG,
                "sourceName": DEFAULT_SOURCE_NAME,
                "title": title,
                "authors": authors,
                "year": year,
                "publishedDate": sort_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", sort_date) and sort_date != "0000-00-00" else "",
                "publication": "LLVM Project Blog",
                "venue": "LLVM Project Blog",
                "type": "blog-post",
                "abstract": abstract,
                "contentFormat": content_format,
                "content": normalized_body,
                # User requested direct links to repo posts.
                "paperUrl": repo_blob_url,
                "sourceUrl": blog_url if blog_url != repo_blob_url else "",
                "tags": tags,
                "keywords": tags,
                "_sortDate": sort_date,
            }
            papers.append(record)

    papers.sort(
        key=lambda paper: (
            collapse_ws(str(paper.get("_sortDate", ""))),
            collapse_ws(str(paper.get("title", "")).lower()),
            collapse_ws(str(paper.get("id", ""))),
        ),
        reverse=True,
    )
    for paper in papers:
        paper.pop("_sortDate", None)

    bundle = {
        "source": {
            "slug": DEFAULT_SOURCE_SLUG,
            "name": DEFAULT_SOURCE_NAME,
            "url": f"https://github.com/{repo}",
            "repo": repo,
            "ref": ref,
            "path": source_path,
            "revision": source_revision,
        },
        "papers": papers,
    }
    return bundle, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--ref", default=DEFAULT_REF)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    parser.add_argument("--source-path", default="content/posts")
    parser.add_argument("--blog-base-url", default=DEFAULT_BLOG_BASE_URL)
    parser.add_argument("--max-posts", type=int, default=0)
    parser.add_argument("--exclude-legacy-html", action="store_true")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument("--github-token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument(
        "--preserve-existing-metadata",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Keep existing curated metadata when records are re-synced (default: enabled).",
    )
    args = parser.parse_args()

    repo = collapse_ws(args.repo)
    ref = collapse_ws(args.ref)
    if not repo or "/" not in repo:
        raise SystemExit("--repo must be in owner/name form")
    if not ref:
        raise SystemExit("--ref must be non-empty")
    if args.max_posts < 0:
        raise SystemExit("--max-posts must be >= 0")

    output_path = Path(args.output).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    blog_base_url = collapse_ws(args.blog_base_url) or DEFAULT_BLOG_BASE_URL
    source_path = collapse_ws(args.source_path).lstrip("/") or "content/posts"
    if not blog_base_url.endswith("/"):
        blog_base_url += "/"

    existing_bundle = load_json(output_path) if output_path.exists() else {}
    existing_source = existing_bundle.get("source") if isinstance(existing_bundle.get("source"), dict) else {}
    existing_source_revision = collapse_ws(str(existing_source.get("revision", "")))
    latest_source_revision = fetch_latest_repo_path_revision(
        repo=repo,
        ref=ref,
        source_path=source_path,
        user_agent=args.user_agent,
        github_token=args.github_token,
        timeout_s=max(30, int(args.timeout)),
    )
    if (
        output_path.exists()
        and latest_source_revision
        and existing_source_revision
        and latest_source_revision == existing_source_revision
    ):
        print(f"No llvm-blog-www updates detected (sourceRevision={latest_source_revision[:12]}).", flush=True)
        return 0

    tar_path, etag, downloaded = download_repo_tarball(
        repo=repo,
        ref=ref,
        cache_dir=cache_dir,
        user_agent=args.user_agent,
        github_token=args.github_token,
        timeout_s=max(30, int(args.timeout)),
    )

    bundle, skipped = build_blog_bundle(
        tar_path=tar_path,
        repo=repo,
        ref=ref,
        source_path=source_path,
        source_revision=latest_source_revision,
        blog_base_url=blog_base_url,
        max_posts=int(args.max_posts),
        include_legacy_html=not args.exclude_legacy_html,
    )

    metadata_matches = 0
    metadata_restored = 0
    existing_records = existing_bundle.get("papers") if isinstance(existing_bundle.get("papers"), list) else []
    if args.preserve_existing_metadata and existing_records:
        metadata_matches, metadata_restored = overlay_existing_blog_metadata(bundle.get("papers", []), existing_records)

    changed = save_json_if_changed(output_path, bundle)
    print(f"Repository: {repo}@{ref}", flush=True)
    print(f"Tarball: {tar_path}", flush=True)
    print(f"Tarball downloaded: {'yes' if downloaded else 'no'}", flush=True)
    print(f"Tarball etag: {etag or '(missing)'}", flush=True)
    print(f"Source path revision: {latest_source_revision or '(unknown)'}", flush=True)
    print(f"Blog posts exported: {len(bundle.get('papers', []))}", flush=True)
    print(f"Blog metadata restoration enabled: {'yes' if args.preserve_existing_metadata else 'no'}", flush=True)
    print(f"Blog posts matched to existing metadata: {metadata_matches}", flush=True)
    print(f"Blog posts restored from existing metadata: {metadata_restored}", flush=True)
    print(f"Posts skipped: {skipped}", flush=True)
    print(f"Output bundle: {output_path}", flush=True)
    print(f"Output changed: {'yes' if changed else 'no'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
