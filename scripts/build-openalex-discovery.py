#!/usr/bin/env python3
"""Discover additional LLVM-related papers for known speakers/authors via OpenAlex.

This script:
  1) Builds a seed author set from:
     - devmtg talk speakers
     - existing papers authors
     - optional extra author lists
  2) Queries OpenAlex for LLVM-related keyword searches
     (including LLVM subprojects) and optionally direct per-author work searches
  3) Keeps works where at least one listed author matches a seed author exactly
     after normalization.
  4) Emits papers/openalex-discovered.json and optionally updates papers/index.json.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from paper_keywords import PaperKeywordExtractor
from tag_vocabulary import load_canonical_tags


OPENALEX_BASE = "https://api.openalex.org/works"
OPENALEX_AUTHORS_BASE = "https://api.openalex.org/authors"
DEFAULT_KEYWORDS = [
    "llvm",
    "clang compiler",
    "mlir compiler",
    "lldb",
    "flang compiler",
    "circt",
    "libfuzzer",
    "addresssanitizer",
    "memorysanitizer",
    "undefinedbehaviorsanitizer",
]
DEFAULT_SUBPROJECT_ALIASES: dict[str, list[str]] = {
    "clang": ["clang", "clangd", "libclang"],
    "mlir": ["mlir"],
    "lldb": ["lldb"],
    "lld": ["lld", "lld-link"],
    "flang": ["flang", "llvm flang"],
    "compiler-rt": ["compiler-rt", "compiler rt"],
    "libc": ["libc", "llvm libc", "llvm-libc", "llvmlibc", "llbclc"],
    "libc++": ["libc++", "libcxx", "libc++abi", "libcxxabi"],
    "libunwind": ["libunwind"],
    "openmp": ["openmp", "libomp"],
    "polly": ["polly"],
    "bolt": ["bolt", "llvm bolt"],
    "circt": ["circt"],
    "libfuzzer": ["libfuzzer"],
    "addresssanitizer": ["addresssanitizer", "asan"],
    "memorysanitizer": ["memorysanitizer", "msan"],
    "threadsanitizer": ["threadsanitizer", "tsan"],
    "undefinedbehaviorsanitizer": ["undefinedbehaviorsanitizer", "ubsan"],
}
CORE_FOCUS_TERMS = ["llvm"]
ALLOWED_OPENALEX_TYPES = {
    "article",
    "book",
    "book-chapter",
    "dissertation",
    "preprint",
    "proceedings-article",
    "report",
}
MISSING_AFFILIATION_TOKENS = {"", "-", "--", "none", "null", "nan", "n/a", "na", "unknown", "no affiliation"}

URLLIB_SSL_CONTEXT: ssl.SSLContext | None = None


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def strip_tags(value: str) -> str:
    if not value:
        return ""
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<[^>]+>", " ", value)
    return collapse_ws(html.unescape(value))


def clean_affiliation(value: str) -> str:
    clean = collapse_ws(value).strip(" ,;|")
    clean = re.sub(r"\s+,", ",", clean)
    clean = re.sub(r"\(\s+", "(", clean)
    clean = re.sub(r"\s+\)", ")", clean)
    if clean.casefold() in MISSING_AFFILIATION_TOKENS:
        return ""
    return clean


def slugify(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered)
    return lowered.strip("-")


def normalize_name(value: str) -> str:
    v = collapse_ws(value).lower()
    v = re.sub(r"[^a-z0-9 ]+", "", v)
    return collapse_ws(v)


def normalize_title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def normalize_text_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def dedupe_terms(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = collapse_ws(raw)
        key = normalize_text_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def configure_ssl_context(ca_bundle: str = "", no_verify_ssl: bool = False) -> None:
    global URLLIB_SSL_CONTEXT
    if no_verify_ssl:
        URLLIB_SSL_CONTEXT = ssl._create_unverified_context()
        return

    bundle = collapse_ws(ca_bundle)
    if not bundle:
        try:
            import certifi  # type: ignore

            bundle = collapse_ws(str(certifi.where()))
        except Exception:
            bundle = ""

    if not bundle:
        URLLIB_SSL_CONTEXT = None
        return

    bundle_path = Path(bundle).expanduser().resolve()
    if not bundle_path.exists():
        raise SystemExit(f"CA bundle does not exist: {bundle_path}")
    URLLIB_SSL_CONTEXT = ssl.create_default_context(cafile=str(bundle_path))


def is_certificate_verify_error(exc: BaseException) -> bool:
    reason = getattr(exc, "reason", exc)
    text = str(reason or exc).lower()
    return "certificate verify failed" in text


def ssl_help_hint() -> str:
    return (
        "SSL certificate verification failed. "
        "Try one of: "
        "1) python3 -m pip install --user certifi, then rerun with "
        "--ca-bundle \"$(python3 -c 'import certifi; print(certifi.where())')\" "
        "2) pass a local trust store path via --ca-bundle "
        "3) as last resort only, use --no-verify-ssl."
    )


def parse_all_tags(app_js_path: Path) -> list[str]:
    return load_canonical_tags(app_js_path)


def parse_manifest_paper_files(index_path: Path) -> list[str]:
    if not index_path.exists():
        return []
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    files = payload.get("paperFiles") or payload.get("files") or []
    out = [collapse_ws(str(f)) for f in files if collapse_ws(str(f))]
    return out


def normalize_doi(value: str) -> str:
    raw = collapse_ws(value).lower()
    if not raw:
        return ""
    raw = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", raw)
    raw = re.sub(r"^doi:\s*", "", raw)
    match = re.search(r"(10\.\d{4,9}/\S+)", raw)
    if not match:
        return ""
    doi = match.group(1).rstrip(".,;)")
    return doi


def normalize_openalex_work_key(value: str) -> str:
    raw = collapse_ws(value).lower()
    if not raw:
        return ""
    raw = raw.rstrip("/")
    match = re.search(r"openalex\.org/(w\d+)", raw)
    if match:
        return match.group(1)
    if re.fullmatch(r"w\d+", raw):
        return raw
    match = re.search(r"\bopenalex[-_/](w\d+)\b", raw)
    if match:
        return match.group(1)
    return ""


def load_existing_identity_keys(
    papers_dir: Path, manifest_files: list[str], output_bundle_name: str
) -> tuple[set[tuple[str, str]], set[str], set[str]]:
    title_keys: set[tuple[str, str]] = set()
    openalex_keys: set[str] = set()
    doi_keys: set[str] = set()

    for rel in manifest_files:
        if rel == output_bundle_name:
            continue
        path = (papers_dir / rel).resolve()
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for paper in payload.get("papers", []):
            year = collapse_ws(str(paper.get("year", "")))
            title = strip_tags(str(paper.get("title", "")))
            if not title:
                continue
            title_keys.add((year, normalize_title_key(title)))

            for openalex_candidate in [
                str(paper.get("openalexId", "")),
                str(paper.get("sourceUrl", "")),
                str(paper.get("id", "")),
            ]:
                key = normalize_openalex_work_key(openalex_candidate)
                if key:
                    openalex_keys.add(key)

            for doi_candidate in [
                str(paper.get("doi", "")),
                str(paper.get("sourceUrl", "")),
                str(paper.get("paperUrl", "")),
            ]:
                doi = normalize_doi(doi_candidate)
                if doi:
                    doi_keys.add(doi)

    return title_keys, openalex_keys, doi_keys


def load_seed_authors(
    events_dir: Path,
    papers_dir: Path,
    manifest_files: list[str],
    output_bundle_name: str,
) -> dict[str, str]:
    normalized_to_display: dict[str, str] = {}

    # Talk speakers
    for path in sorted(events_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for talk in payload.get("talks", []):
            for speaker in talk.get("speakers", []):
                name = collapse_ws(str(speaker.get("name", "")))
                if not name:
                    continue
                key = normalize_name(name)
                if key and key not in normalized_to_display:
                    normalized_to_display[key] = name

    # Existing papers authors
    for rel in manifest_files:
        if rel == output_bundle_name:
            continue
        path = (papers_dir / rel).resolve()
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for paper in payload.get("papers", []):
            for author in paper.get("authors", []):
                name = collapse_ws(str(author.get("name", "")))
                if not name:
                    continue
                key = normalize_name(name)
                if key and key not in normalized_to_display:
                    normalized_to_display[key] = name

    return normalized_to_display


def load_extra_authors(extra_authors_file: Path | None, extra_authors: list[str]) -> list[str]:
    names: list[str] = []

    if extra_authors_file:
        if not extra_authors_file.exists():
            raise RuntimeError(f"Extra authors file does not exist: {extra_authors_file}")
        for line in extra_authors_file.read_text(encoding="utf-8").splitlines():
            name = collapse_ws(line)
            if not name or name.startswith("#"):
                continue
            names.append(name)

    for raw in extra_authors:
        name = collapse_ws(raw)
        if name:
            names.append(name)

    deduped: list[str] = []
    seen: set[str] = set()
    for name in names:
        key = normalize_name(name)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(name)

    return deduped


def merge_seed_authors(seed_authors: dict[str, str], extra_names: list[str]) -> int:
    added = 0
    for name in extra_names:
        key = normalize_name(name)
        if key and key not in seed_authors:
            seed_authors[key] = name
            added += 1
    return added


def load_subproject_aliases(subprojects_file: Path | None, extra_subprojects: list[str]) -> dict[str, list[str]]:
    canonical_to_aliases: dict[str, set[str]] = {
        canonical: set(aliases or [canonical]) for canonical, aliases in DEFAULT_SUBPROJECT_ALIASES.items()
    }

    def _merge_line(raw_line: str) -> None:
        line = collapse_ws(raw_line)
        if not line or line.startswith("#"):
            return

        canonical = line
        aliases: list[str] = []
        if ":" in line:
            left, right = line.split(":", 1)
            canonical = collapse_ws(left)
            aliases = [collapse_ws(chunk) for chunk in right.split(",")]

        canonical = collapse_ws(canonical)
        if not canonical:
            return

        if canonical not in canonical_to_aliases:
            canonical_to_aliases[canonical] = set()
        canonical_to_aliases[canonical].add(canonical)

        for alias in aliases:
            if alias:
                canonical_to_aliases[canonical].add(alias)

    if subprojects_file:
        if not subprojects_file.exists():
            raise RuntimeError(f"Subprojects file does not exist: {subprojects_file}")
        for line in subprojects_file.read_text(encoding="utf-8").splitlines():
            _merge_line(line)

    for raw in extra_subprojects:
        _merge_line(raw)

    out: dict[str, list[str]] = {}
    for canonical, aliases in canonical_to_aliases.items():
        merged = dedupe_terms([canonical, *sorted(aliases)])
        if merged:
            out[canonical] = merged
    return out


def build_discovery_keywords(
    base_keywords: list[str],
    subproject_aliases: dict[str, list[str]],
    skip_subproject_keyword_expansion: bool,
) -> list[str]:
    expanded: list[str] = [collapse_ws(str(keyword)) for keyword in base_keywords if collapse_ws(str(keyword))]
    if not skip_subproject_keyword_expansion:
        for canonical in sorted(subproject_aliases):
            canonical_term = collapse_ws(canonical)
            if not canonical_term:
                continue
            query = canonical_term if canonical_term.lower().startswith("llvm ") else f"llvm {canonical_term}"
            expanded.append(query)
    return dedupe_terms(expanded)


def build_focus_terms(subproject_aliases: dict[str, list[str]]) -> list[str]:
    terms: list[str] = list(CORE_FOCUS_TERMS)
    for aliases in subproject_aliases.values():
        terms.extend(aliases)
    return dedupe_terms(terms)


def _slug_with_hash(value: str, fallback: str) -> str:
    slug = slugify(value)[:40] or fallback
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]
    return f"{slug}-{digest}"


def _http_get_json(url: str, timeout_s: int = 40, retries: int = 4):
    headers = {
        "User-Agent": "library-openalex-discovery/1.0 (+https://github.com/llvm/library)",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")

    for attempt in range(1, retries + 1):
        try:
            open_kwargs = {"timeout": timeout_s}
            if URLLIB_SSL_CONTEXT is not None:
                open_kwargs["context"] = URLLIB_SSL_CONTEXT
            with urllib.request.urlopen(req, **open_kwargs) as resp:
                body = resp.read()
            return json.loads(body)
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < retries:
                retry_after = err.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 1.5 * attempt
                time.sleep(delay)
                continue
            raise
        except urllib.error.URLError as err:
            if is_certificate_verify_error(err):
                raise RuntimeError(ssl_help_hint()) from err
            if attempt < retries:
                time.sleep(1.2 * attempt)
                continue
            raise
        except Exception:
            if attempt < retries:
                time.sleep(1.2 * attempt)
                continue
            raise

    raise RuntimeError("Exhausted retries while fetching OpenAlex payload")


def fetch_openalex_page(
    keyword: str,
    page: int,
    per_page: int,
    start_year: int,
    cache_dir: Path,
    mailto: str,
    use_cache: bool,
):
    cache_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(keyword) or "keyword"
    cache_file = cache_dir / f"{slug}-y{start_year}-n{per_page}-p{page}.json"
    if use_cache and cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    params = {
        "search": keyword,
        "page": str(page),
        "per-page": str(per_page),
        "sort": "publication_date:desc",
        "filter": f"from_publication_date:{start_year}-01-01",
    }
    if mailto:
        params["mailto"] = mailto

    url = OPENALEX_BASE + "?" + urllib.parse.urlencode(params)
    payload = _http_get_json(url)
    if use_cache:
        cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def fetch_openalex_author_search(
    author_name: str,
    cache_dir: Path,
    mailto: str,
    use_cache: bool,
):
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_slug = _slug_with_hash(author_name, "author")
    cache_file = cache_dir / f"{cache_slug}-author-search.json"
    if use_cache and cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    params = {
        "search": author_name,
        "per-page": "10",
    }
    if mailto:
        params["mailto"] = mailto

    url = OPENALEX_AUTHORS_BASE + "?" + urllib.parse.urlencode(params)
    payload = _http_get_json(url)
    if use_cache:
        cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def _name_match_quality(target: str, candidate: str) -> int:
    if not target or not candidate:
        return 0
    if target == candidate:
        return 100

    target_parts = target.split()
    candidate_parts = candidate.split()
    if not target_parts or not candidate_parts:
        return 0

    target_set = set(target_parts)
    candidate_set = set(candidate_parts)
    overlap = len(target_set & candidate_set)
    if overlap <= 0:
        return 0

    target_ratio = overlap / len(target_set)
    cand_ratio = overlap / len(candidate_set)
    if target_ratio >= 0.99 and cand_ratio >= 0.99:
        return 95
    if target_ratio >= 0.80 and cand_ratio >= 0.80:
        return 70
    if target_ratio >= 0.80:
        return 45
    if overlap >= 2:
        return 25
    return 0


def pick_author_id(author_name: str, payload: dict) -> str:
    target = normalize_name(author_name)
    best_id = ""
    best_score = -1

    for result in payload.get("results", []) or []:
        candidate_name = collapse_ws(str(result.get("display_name", "")))
        if not candidate_name:
            continue
        candidate_norm = normalize_name(candidate_name)
        quality = _name_match_quality(target, candidate_norm)
        if quality <= 0:
            continue

        works_count = int(result.get("works_count") or 0)
        score = quality * 1000 + min(works_count, 1_000_000)
        author_id = collapse_ws(str(result.get("id", "")))
        if author_id and score > best_score:
            best_score = score
            best_id = author_id

    return best_id


def fetch_openalex_author_works_page(
    author_id: str,
    page: int,
    per_page: int,
    start_year: int,
    cache_dir: Path,
    mailto: str,
    use_cache: bool,
):
    cache_dir.mkdir(parents=True, exist_ok=True)
    author_suffix = collapse_ws(author_id).rstrip("/").rsplit("/", 1)[-1].lower() or "author"
    cache_file = cache_dir / f"{author_suffix}-author-works-y{start_year}-n{per_page}-p{page}.json"
    if use_cache and cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    params = {
        "page": str(page),
        "per-page": str(per_page),
        "sort": "publication_date:desc",
        "filter": f"authorships.author.id:{author_id},from_publication_date:{start_year}-01-01",
    }
    if mailto:
        params["mailto"] = mailto

    url = OPENALEX_BASE + "?" + urllib.parse.urlencode(params)
    payload = _http_get_json(url)
    if use_cache:
        cache_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def decode_abstract_inverted_index(index_obj) -> str:
    if not isinstance(index_obj, dict):
        return ""
    max_pos = -1
    for positions in index_obj.values():
        if not isinstance(positions, list):
            continue
        for pos in positions:
            if isinstance(pos, int) and pos > max_pos:
                max_pos = pos
    if max_pos < 0:
        return ""

    words = [""] * (max_pos + 1)
    for token, positions in index_obj.items():
        if not isinstance(positions, list):
            continue
        clean_token = collapse_ws(str(token))
        if not clean_token:
            continue
        for pos in positions:
            if isinstance(pos, int) and 0 <= pos < len(words):
                words[pos] = clean_token
    return collapse_ws(" ".join(words))


def extract_author_list(work: dict) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()

    for authorship in work.get("authorships", []) or []:
        author = authorship.get("author") or {}
        name = collapse_ws(str(author.get("display_name", "")))
        if not name:
            continue
        key = normalize_name(name)
        if not key or key in seen:
            continue
        seen.add(key)

        affiliation = ""
        institutions = authorship.get("institutions") or []
        if institutions and isinstance(institutions, list):
            first = institutions[0] or {}
            affiliation = clean_affiliation(str(first.get("display_name", "")))

        out.append({"name": name, "affiliation": affiliation})

    return out


def pick_urls(work: dict) -> tuple[str, str]:
    candidates: list[str] = []

    primary = work.get("primary_location") or {}
    best_oa = work.get("best_oa_location") or {}
    open_access = work.get("open_access") or {}

    for value in [
        best_oa.get("pdf_url"),
        primary.get("pdf_url"),
        open_access.get("oa_url"),
        best_oa.get("landing_page_url"),
        primary.get("landing_page_url"),
        work.get("doi"),
    ]:
        url = collapse_ws(str(value or ""))
        if url:
            candidates.append(url)

    paper_url = ""
    for url in candidates:
        if re.search(r"\.pdf(?:$|[?#])", url, flags=re.IGNORECASE):
            paper_url = url
            break
    if not paper_url and candidates:
        paper_url = candidates[0]

    source_url = collapse_ws(str(work.get("doi") or ""))
    if not source_url:
        source_url = collapse_ws(str(primary.get("landing_page_url") or best_oa.get("landing_page_url") or ""))
    if not source_url:
        source_url = collapse_ws(str(work.get("id") or ""))

    if source_url == paper_url:
        source_url = ""

    return paper_url, source_url


def _clean_meta_value(value: str) -> str:
    clean = collapse_ws(value)
    lowered = clean.lower()
    if lowered in {"", "none", "null", "nan", "n/a"}:
        return ""
    return clean


def pick_publication_and_venue(work: dict) -> tuple[str, str]:
    primary = work.get("primary_location") or {}
    source = primary.get("source") or {}

    publication = _clean_meta_value(str(source.get("display_name", "")))
    if not publication:
        for loc in (work.get("locations") or []):
            src = (loc or {}).get("source") or {}
            candidate = _clean_meta_value(str(src.get("display_name", "")))
            if candidate:
                publication = candidate
                break

    biblio = work.get("biblio") or {}
    volume = _clean_meta_value(str(biblio.get("volume", "")))
    issue = _clean_meta_value(str(biblio.get("issue", "")))

    parts = []
    if publication:
        parts.append(publication)
    if volume:
        parts.append(f"Vol. {volume}" + (f" (Issue {issue})" if issue else ""))
    elif issue:
        parts.append(f"Issue {issue}")

    return publication, " | ".join(parts)


def classify_type(openalex_type: str) -> str:
    t = collapse_ws(openalex_type).lower()
    if t == "dissertation":
        return "thesis"
    return "research-paper"


def text_contains_term(text_key: str, term: str) -> bool:
    term_key = normalize_text_key(term)
    if not term_key:
        return False

    padded = f" {text_key} "
    if " " not in term_key:
        return f" {term_key} " in padded
    return term_key in text_key


def match_focus_terms(text: str, focus_terms: list[str]) -> bool:
    blob_key = normalize_text_key(text)
    if not blob_key:
        return False
    for term in focus_terms:
        if text_contains_term(blob_key, term):
            return True
    return False


def match_subprojects(text: str, subproject_aliases: dict[str, list[str]]) -> list[str]:
    blob_key = normalize_text_key(text)
    if not blob_key:
        return []

    matched: list[str] = []
    for canonical, aliases in subproject_aliases.items():
        if any(text_contains_term(blob_key, alias) for alias in aliases):
            matched.append(canonical)
    return sorted(matched)


def update_manifest(
    index_path: Path,
    output_bundle_name: str,
    data_version: str,
    force_bump_data_version: bool = False,
) -> tuple[bool, str]:
    payload = {}
    if index_path.exists():
        payload = json.loads(index_path.read_text(encoding="utf-8"))

    changed = False
    files = payload.get("paperFiles") or payload.get("files") or []
    files = [collapse_ws(str(f)) for f in files if collapse_ws(str(f))]
    files_before = list(files)
    if output_bundle_name not in files:
        files.append(output_bundle_name)
    if files != files_before:
        changed = True

    payload["paperFiles"] = files
    payload.pop("files", None)

    should_bump = force_bump_data_version or (files != files_before)
    if should_bump and payload.get("dataVersion") != data_version:
        payload["dataVersion"] = data_version
        changed = True

    if changed:
        index_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed, collapse_ws(str(payload.get("dataVersion", "")))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--events-dir", default="/Users/britton/Desktop/library/devmtg/events")
    parser.add_argument("--papers-dir", default="/Users/britton/Desktop/library/papers")
    parser.add_argument("--app-js", default="/Users/britton/Desktop/library/devmtg/js/app.js")
    parser.add_argument("--index-json", default="/Users/britton/Desktop/library/papers/index.json")
    parser.add_argument("--output-bundle", default="openalex-discovered.json")
    parser.add_argument("--cache-dir", default="/Users/britton/Desktop/library/papers/.cache/openalex")
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--max-pages-per-keyword", type=int, default=25)
    parser.add_argument("--per-page", type=int, default=200)
    parser.add_argument("--max-pages-per-author", type=int, default=1)
    parser.add_argument("--author-per-page", type=int, default=200)
    parser.add_argument("--mailto", default="")
    parser.add_argument("--keywords", nargs="*", default=DEFAULT_KEYWORDS)
    parser.add_argument("--subprojects-file", default="")
    parser.add_argument("--subproject", action="append", default=[])
    parser.add_argument("--skip-subproject-keyword-expansion", action="store_true")
    parser.add_argument("--extra-authors-file", default="")
    parser.add_argument("--extra-author", action="append", default=[])
    parser.add_argument("--skip-author-queries", action="store_true")
    parser.add_argument("--ca-bundle", default="")
    parser.add_argument("--no-verify-ssl", action="store_true", help="Disable TLS certificate verification")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--skip-manifest-update", action="store_true")
    args = parser.parse_args()

    events_dir = Path(args.events_dir).resolve()
    papers_dir = Path(args.papers_dir).resolve()
    app_js = Path(args.app_js).resolve()
    index_json = Path(args.index_json).resolve()
    output_bundle_name = args.output_bundle
    output_bundle_path = papers_dir / output_bundle_name
    cache_dir = Path(args.cache_dir).resolve()
    subprojects_file = Path(args.subprojects_file).resolve() if args.subprojects_file else None
    extra_authors_file = Path(args.extra_authors_file).resolve() if args.extra_authors_file else None
    ca_bundle = args.ca_bundle or os.environ.get("SSL_CERT_FILE", "")
    configure_ssl_context(ca_bundle=ca_bundle, no_verify_ssl=args.no_verify_ssl)

    manifest_files = parse_manifest_paper_files(index_json)
    subproject_aliases = load_subproject_aliases(subprojects_file, args.subproject)
    discovery_keywords = build_discovery_keywords(
        args.keywords, subproject_aliases, args.skip_subproject_keyword_expansion
    )
    focus_terms = build_focus_terms(subproject_aliases)
    tags = parse_all_tags(app_js)
    keyword_extractor = PaperKeywordExtractor(tags)
    seed_authors = load_seed_authors(events_dir, papers_dir, manifest_files, output_bundle_name)
    extra_authors = load_extra_authors(extra_authors_file, args.extra_author)
    added_seed_authors = merge_seed_authors(seed_authors, extra_authors)
    existing_title_keys, existing_openalex_keys, existing_doi_keys = load_existing_identity_keys(
        papers_dir, manifest_files, output_bundle_name
    )

    all_works: dict[str, dict] = {}
    total_requests = 0

    for keyword in discovery_keywords:
        kw = collapse_ws(keyword)
        if not kw:
            continue

        if args.verbose:
            print(f"[openalex] keyword={kw}", flush=True)

        for page in range(1, args.max_pages_per_keyword + 1):
            payload = fetch_openalex_page(
                keyword=kw,
                page=page,
                per_page=args.per_page,
                start_year=args.start_year,
                cache_dir=cache_dir,
                mailto=args.mailto,
                use_cache=not args.no_cache,
            )
            total_requests += 1

            results = payload.get("results", []) or []
            total_count = int((payload.get("meta") or {}).get("count") or 0)
            if args.verbose:
                print(
                    f"  page={page} results={len(results)} total={total_count}",
                    flush=True,
                )
            if not results:
                break

            for work in results:
                work_id = collapse_ws(str(work.get("id", "")))
                if work_id:
                    all_works[work_id] = work

            if page * args.per_page >= total_count:
                break

            time.sleep(0.08)

    matched_author_ids: dict[str, str] = {}
    if extra_authors and not args.skip_author_queries:
        for author_name in extra_authors:
            if args.verbose:
                print(f"[openalex] author-search={author_name}", flush=True)

            payload = fetch_openalex_author_search(
                author_name=author_name,
                cache_dir=cache_dir,
                mailto=args.mailto,
                use_cache=not args.no_cache,
            )
            total_requests += 1

            author_id = pick_author_id(author_name, payload)
            if not author_id:
                continue
            matched_author_ids.setdefault(author_id, author_name)

        for author_id, author_name in matched_author_ids.items():
            if args.verbose:
                print(f"[openalex] author-works={author_name} ({author_id})", flush=True)

            for page in range(1, args.max_pages_per_author + 1):
                payload = fetch_openalex_author_works_page(
                    author_id=author_id,
                    page=page,
                    per_page=args.author_per_page,
                    start_year=args.start_year,
                    cache_dir=cache_dir,
                    mailto=args.mailto,
                    use_cache=not args.no_cache,
                )
                total_requests += 1

                results = payload.get("results", []) or []
                total_count = int((payload.get("meta") or {}).get("count") or 0)
                if args.verbose:
                    print(
                        f"  author-page={page} results={len(results)} total={total_count}",
                        flush=True,
                    )
                if not results:
                    break

                for work in results:
                    work_id = collapse_ws(str(work.get("id", "")))
                    if work_id:
                        all_works[work_id] = work

                if page * args.author_per_page >= total_count:
                    break

                time.sleep(0.08)

    used_ids: set[str] = set()
    out_papers: list[dict] = []
    kept_existing_keys: set[tuple[str, str]] = set()
    kept_openalex_keys: set[str] = set()
    kept_doi_keys: set[str] = set()

    for work in all_works.values():
        openalex_type = collapse_ws(str(work.get("type", ""))).lower()
        if openalex_type and openalex_type not in ALLOWED_OPENALEX_TYPES:
            continue

        title = strip_tags(str(work.get("title", "")))
        if not title:
            continue

        abstract = decode_abstract_inverted_index(work.get("abstract_inverted_index"))
        publication, venue = pick_publication_and_venue(work)
        focus_blob = f"{title} {abstract} {publication} {venue}"
        if not match_focus_terms(focus_blob, focus_terms):
            continue

        authors = extract_author_list(work)
        if not authors:
            continue

        matched = []
        for author in authors:
            key = normalize_name(author.get("name", ""))
            if key in seed_authors:
                matched.append(seed_authors[key])
        matched = sorted(set(matched))
        if not matched:
            continue

        year_val = work.get("publication_year")
        year = str(year_val) if isinstance(year_val, int) and year_val > 0 else ""
        openalex_id = collapse_ws(str(work.get("id", "")))
        openalex_work_key = normalize_openalex_work_key(openalex_id)
        doi_key = normalize_doi(str(work.get("doi", "")))

        title_key = (year, normalize_title_key(title))
        if title_key in existing_title_keys or title_key in kept_existing_keys:
            continue
        if openalex_work_key and (openalex_work_key in existing_openalex_keys or openalex_work_key in kept_openalex_keys):
            continue
        if doi_key and (doi_key in existing_doi_keys or doi_key in kept_doi_keys):
            continue

        paper_url, source_url = pick_urls(work)
        matched_subprojects = match_subprojects(focus_blob, subproject_aliases)
        topics = keyword_extractor.extract(
            title=title,
            abstract=abstract,
            publication=publication,
            venue=venue,
        )
        tags_for_paper = topics["tags"]
        keywords_for_paper = topics["keywords"]

        suffix = openalex_id.rsplit("/", 1)[-1].lower() if openalex_id else slugify(title)[:32]
        base_id = slugify(f"openalex-{suffix}") or "openalex-paper"
        paper_id = base_id
        idx = 2
        while paper_id in used_ids:
            paper_id = f"{base_id}-{idx}"
            idx += 1
        used_ids.add(paper_id)

        out_papers.append(
            {
                "id": paper_id,
                "source": "openalex-discovery",
                "sourceName": "OpenAlex Discovery (seeded by LLVM speakers/authors)",
                "title": title,
                "authors": authors,
                "year": year,
                "publication": publication,
                "venue": venue,
                "type": classify_type(openalex_type),
                "abstract": abstract or "No abstract available in discovery metadata.",
                "paperUrl": paper_url,
                "sourceUrl": source_url,
                "openalexId": openalex_id,
                "doi": doi_key,
                "tags": tags_for_paper,
                "keywords": keywords_for_paper,
                "matchedAuthors": matched,
                "matchedSubprojects": matched_subprojects,
            }
        )
        kept_existing_keys.add(title_key)
        if openalex_work_key:
            kept_openalex_keys.add(openalex_work_key)
        if doi_key:
            kept_doi_keys.add(doi_key)

    out_papers.sort(
        key=lambda p: (p.get("year") or "0000", p.get("title") or "", p.get("id") or ""),
        reverse=True,
    )

    bundle = {
        "source": {
            "slug": "openalex-discovery",
            "name": "OpenAlex Discovery (seeded by LLVM speakers/authors)",
            "url": "https://api.openalex.org",
        },
        "papers": out_papers,
    }
    new_bundle_text = json.dumps(bundle, indent=2, ensure_ascii=False) + "\n"
    existing_bundle_text = output_bundle_path.read_text(encoding="utf-8") if output_bundle_path.exists() else ""
    bundle_changed = existing_bundle_text != new_bundle_text
    if bundle_changed:
        output_bundle_path.write_text(new_bundle_text, encoding="utf-8")

    manifest_changed = False
    effective_data_version = ""
    if args.skip_manifest_update:
        if index_json.exists():
            try:
                payload = json.loads(index_json.read_text(encoding="utf-8"))
                effective_data_version = collapse_ws(str(payload.get("dataVersion", "")))
            except Exception:
                effective_data_version = ""
    else:
        data_version = _dt.datetime.now(_dt.timezone.utc).date().isoformat() + "-llvm-org-pubs-plus-openalex"
        manifest_changed, effective_data_version = update_manifest(
            index_json,
            output_bundle_name,
            data_version,
            force_bump_data_version=bundle_changed,
        )

    print(f"Seed authors: {len(seed_authors)}")
    print(f"LLVM subprojects configured: {len(subproject_aliases)}")
    print(f"Effective keyword queries: {len(discovery_keywords)}")
    print(f"Extra author seeds loaded: {len(extra_authors)} (new seed authors: {added_seed_authors})")
    print(f"Resolved extra author ids: {len(matched_author_ids)}")
    print(f"OpenAlex requests: {total_requests}")
    print(f"Unique works fetched: {len(all_works)}")
    print(f"Discovered papers written: {len(out_papers)} -> {output_bundle_path}")
    print(f"Bundle changed: {'yes' if bundle_changed else 'no'}")
    if args.skip_manifest_update:
        print("Manifest update: skipped (--skip-manifest-update)")
    print(f"Manifest changed: {'yes' if manifest_changed else 'no'}")
    print(f"Manifest dataVersion: {effective_data_version or '(unchanged)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
