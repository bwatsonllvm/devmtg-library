#!/usr/bin/env python3
"""Build a single canonical papers database from source bundles.

This script:
1) Loads source bundles (llvm-org-pubs + OpenAlex bundles).
2) Deduplicates records across bundles by OpenAlex id, DOI, and year+title.
3) Refreshes OpenAlex-backed metadata (title/abstract/authors/affiliations/citations/urls).
4) For non-English/missing OpenAlex text, probes landing-page metadata for English
   title/abstract fallbacks.
5) Writes one canonical output bundle and updates papers/index.json to reference it.
"""

from __future__ import annotations

import argparse
import copy
import datetime as _dt
import hashlib
import html
import json
import re
import subprocess
import time
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Iterable

OPENALEX_WORKS_API = "https://api.openalex.org/works"
PLACEHOLDER_ABSTRACTS = {
    "no abstract available in openalex metadata.",
    "no abstract available in discovery metadata.",
    "no abstract available in llvm.org/pubs metadata.",
    "no abstract available in llvmorgpubs metadata.",
    "no abstract available in llvm org pubs metadata.",
}
MISSING_AFFILIATION_TOKENS = {
    "",
    "-",
    "--",
    "none",
    "null",
    "nan",
    "n/a",
    "na",
    "unknown",
    "no affiliation",
    "not available",
}
LOW_QUALITY_TITLE_KEYS = {
    "404",
    "404 not found",
    "error",
    "forbidden",
    "access denied",
    "not found",
    "page not found",
    "home",
    "homepage",
    "index",
    "login",
    "sign in",
}
SOURCE_PRIORITY = {
    "openalex-discovery": 300,
    "openalex-llvm-query": 250,
    "llvm-org-pubs": 150,
}


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def full_unescape(value: str) -> str:
    text = value or ""
    for _ in range(4):
        next_text = html.unescape(text)
        if next_text == text:
            return next_text
        text = next_text
    return text


def strip_markup(value: str) -> str:
    if not value:
        return ""
    text = full_unescape(value)
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    return collapse_ws(text)


def soft_text_key(value: str) -> str:
    text = strip_markup(value).lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return collapse_ws(text)


def normalize_name_key(value: str) -> str:
    text = strip_markup(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return collapse_ws(text)


def normalize_title_key(value: str) -> str:
    return soft_text_key(value)


def normalize_doi(value: str) -> str:
    raw = collapse_ws(value).lower()
    if not raw:
        return ""
    raw = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", raw)
    raw = re.sub(r"^doi:\s*", "", raw)
    match = re.search(r"(10\.\d{4,9}/\S+)", raw)
    if not match:
        return ""
    return match.group(1).rstrip(".,;)")


def normalize_openalex_short_id(value: str) -> str:
    raw = collapse_ws(value).rstrip("/")
    if not raw:
        return ""
    suffix = raw.rsplit("/", 1)[-1].upper()
    if re.fullmatch(r"W\d+", suffix):
        return suffix
    return ""


def canonical_openalex_url(short_id: str) -> str:
    return f"https://openalex.org/{short_id}" if short_id else ""


def normalize_affiliation(value: str) -> str:
    clean = strip_markup(value).strip(" ,;|")
    clean = re.sub(r"\s+,", ",", clean)
    clean = re.sub(r"\(\s+", "(", clean)
    clean = re.sub(r"\s+\)", ")", clean)
    if clean.casefold() in MISSING_AFFILIATION_TOKENS:
        return ""
    return clean


def normalize_affiliation_key(value: str) -> str:
    clean = normalize_affiliation(value).lower()
    clean = re.sub(r"^the\s+", "", clean)
    clean = re.sub(r"[^a-z0-9 ]+", " ", clean)
    return collapse_ws(clean)


def is_placeholder_abstract(value: str) -> bool:
    key = soft_text_key(value)
    return not key or key in {soft_text_key(v) for v in PLACEHOLDER_ABSTRACTS}


def english_ratio(value: str) -> float:
    text = strip_markup(value)
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 0.0
    ascii_letters = sum(1 for ch in letters if "a" <= ch.lower() <= "z")
    return ascii_letters / len(letters)


def looks_non_english(value: str, threshold: float = 0.35) -> bool:
    text = strip_markup(value)
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return False
    return english_ratio(text) < threshold


def parse_int(value) -> int | None:
    try:
        out = int(value)
    except Exception:
        return None
    return out


def _clean_meta_value(value: str) -> str:
    clean = collapse_ws(value)
    if clean.lower() in {"", "none", "null", "nan", "n/a"}:
        return ""
    return clean


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


def classify_type(openalex_type: str, existing_type: str) -> str:
    t = collapse_ws(openalex_type).lower()
    if t == "dissertation":
        return "thesis"
    if t:
        return "research-paper"
    fallback = collapse_ws(existing_type)
    return fallback or "research-paper"


def extract_openalex_authors(work: dict, keep_existing_nonempty_affiliations: bool = False, existing_authors: list[dict] | None = None) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()

    existing_aff_by_name: dict[str, str] = {}
    if keep_existing_nonempty_affiliations and existing_authors:
        for author in existing_authors:
            if not isinstance(author, dict):
                continue
            name = collapse_ws(str(author.get("name", "")))
            aff = normalize_affiliation(str(author.get("affiliation", "")))
            key = normalize_name_key(name)
            if key and aff:
                existing_aff_by_name[key] = aff

    for authorship in work.get("authorships", []) or []:
        author = (authorship or {}).get("author") or {}
        name = collapse_ws(str(author.get("display_name", "")))
        if not name:
            continue
        name_key = normalize_name_key(name)
        if not name_key or name_key in seen:
            continue
        seen.add(name_key)

        affiliation = ""
        institutions = (authorship or {}).get("institutions") or []
        if isinstance(institutions, list):
            for institution in institutions:
                if not isinstance(institution, dict):
                    continue
                candidate = normalize_affiliation(str(institution.get("display_name", "")))
                if candidate:
                    affiliation = candidate
                    break

        if keep_existing_nonempty_affiliations and not affiliation and name_key in existing_aff_by_name:
            affiliation = existing_aff_by_name[name_key]

        out.append({"name": name, "affiliation": affiliation})

    return out


def list_openalex_landing_urls(work: dict) -> list[str]:
    out: list[str] = []
    for loc in [work.get("best_oa_location"), work.get("primary_location"), *(work.get("locations") or [])]:
        if not isinstance(loc, dict):
            continue
        for key in ["landing_page_url"]:
            url = collapse_ws(str(loc.get(key, "")))
            if url and url not in out:
                out.append(url)
    doi_url = collapse_ws(str(work.get("doi", "")))
    if doi_url and doi_url not in out:
        out.append(doi_url)
    return out


def _extract_lang_hint(tag_text: str) -> str:
    for pat in [r'xml:lang\s*=\s*"([^"]+)"', r"xml:lang\s*=\s*'([^']+)'", r'lang\s*=\s*"([^"]+)"', r"lang\s*=\s*'([^']+)'"]:
        m = re.search(pat, tag_text, flags=re.IGNORECASE)
        if m:
            return collapse_ws(m.group(1).lower())
    return ""


def _decode_json_string_literal(value: str) -> str:
    raw = value or ""
    if not raw:
        return ""
    for candidate in [raw, full_unescape(raw)]:
        try:
            return str(json.loads(f'"{candidate}"'))
        except Exception:
            continue
    fallback = raw.replace("\\/", "/").replace("\\n", " ").replace("\\r", " ").replace("\\t", " ").replace('\\"', '"')
    return collapse_ws(full_unescape(fallback))


def _extract_script_embedded_candidates(html_text: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    title_candidates: list[tuple[str, str]] = []
    abstract_candidates: list[tuple[str, str]] = []

    title_key_re = re.compile(
        r"""(?P<key>(?:translated|english)?title|headline|name|citation_title|dc\.title|dcterms\.title)
            \s*[:=]\s*
            (?P<quote>["'])
            (?P<value>(?:\\.|(?!\2).){4,1600})
            (?P=quote)""",
        flags=re.IGNORECASE | re.VERBOSE | re.DOTALL,
    )
    abstract_key_re = re.compile(
        r"""(?P<key>(?:translated|english)?abstract|description|summary|citation_abstract|dc\.description|dcterms\.abstract)
            \s*[:=]\s*
            (?P<quote>["'])
            (?P<value>(?:\\.|(?!\2).){20,12000})
            (?P=quote)""",
        flags=re.IGNORECASE | re.VERBOSE | re.DOTALL,
    )

    script_blocks = re.finditer(r"<script\b[^>]*>(.*?)</script>", html_text, flags=re.IGNORECASE | re.DOTALL)
    for match in script_blocks:
        block = match.group(1)
        if not block:
            continue
        text = full_unescape(block)
        if len(text) > 1_500_000:
            continue
        for m in title_key_re.finditer(text):
            key = collapse_ws(str(m.group("key")).lower())
            value = _decode_json_string_literal(m.group("value"))
            clean = strip_markup(value)
            if clean:
                title_candidates.append((f"script:{key}", clean))
        for m in abstract_key_re.finditer(text):
            key = collapse_ws(str(m.group("key")).lower())
            value = _decode_json_string_literal(m.group("value"))
            clean = strip_markup(value)
            if clean:
                abstract_candidates.append((f"script:{key}", clean))

    def dedupe(values: list[tuple[str, str]]) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for label, value in values:
            key = soft_text_key(value)
            if not key or key in seen:
                continue
            seen.add(key)
            out.append((label, value))
        return out

    return dedupe(title_candidates), dedupe(abstract_candidates)


def _extract_meta_candidates(html_text: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    title_candidates: list[tuple[str, str]] = []
    abstract_candidates: list[tuple[str, str]] = []

    def add_title(label: str, value: str):
        clean = strip_markup(value)
        if clean:
            title_candidates.append((label, clean))

    def add_abstract(label: str, value: str):
        clean = strip_markup(value)
        if clean:
            abstract_candidates.append((label, clean))

    for match in re.finditer(r"<meta\b[^>]*>", html_text, flags=re.IGNORECASE):
        tag = match.group(0)
        name = ""
        lang_hint = _extract_lang_hint(tag)
        for pat in [
            r'name\s*=\s*"([^"]+)"',
            r"name\s*=\s*'([^']+)'",
            r'property\s*=\s*"([^"]+)"',
            r"property\s*=\s*'([^']+)'",
            r'itemprop\s*=\s*"([^"]+)"',
            r"itemprop\s*=\s*'([^']+)'",
        ]:
            m = re.search(pat, tag, flags=re.IGNORECASE)
            if m:
                name = collapse_ws(m.group(1).lower())
                break
        m_content = re.search(r'content\s*=\s*"([^"]*)"', tag, flags=re.IGNORECASE)
        if not m_content:
            m_content = re.search(r"content\s*=\s*'([^']*)'", tag, flags=re.IGNORECASE)
        if not m_content:
            continue
        content = m_content.group(1)
        if not content:
            continue

        label = name or "meta"
        if lang_hint:
            label = f"{label}|lang={lang_hint}"

        if any(key in name for key in ["citation_title", "dc.title", "dcterms.title", "title", "og:title", "twitter:title"]):
            add_title(label or "meta:title", content)
        if any(
            key in name
            for key in [
                "citation_abstract",
                "dc.description",
                "dcterms.abstract",
                "description",
                "og:description",
                "twitter:description",
            ]
        ):
            add_abstract(label or "meta:abstract", content)

    title_tag = re.search(r"<title[^>]*>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL)
    if title_tag:
        add_title("html:title", title_tag.group(1))

    for ld_json in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        raw = collapse_ws(ld_json.group(1))
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue
        nodes = payload if isinstance(payload, list) else [payload]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            lang_hint = collapse_ws(str(node.get("inLanguage", "")).lower())
            for key in ["headline", "name", "title"]:
                if isinstance(node.get(key), str):
                    label = f"ldjson:{key}"
                    if lang_hint:
                        label = f"{label}|lang={lang_hint}"
                    add_title(label, node.get(key, ""))
            for key in ["description", "abstract"]:
                if isinstance(node.get(key), str):
                    label = f"ldjson:{key}"
                    if lang_hint:
                        label = f"{label}|lang={lang_hint}"
                    add_abstract(label, node.get(key, ""))

    def dedupe(values: list[tuple[str, str]]) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for label, value in values:
            key = soft_text_key(value)
            if not key or key in seen:
                continue
            seen.add(key)
            out.append((label, value))
        return out

    script_titles, script_abstracts = _extract_script_embedded_candidates(html_text)
    return dedupe(title_candidates + script_titles), dedupe(abstract_candidates + script_abstracts)


def _candidate_label_bonus(label: str) -> float:
    clean = collapse_ws(label).lower()
    bonus = 0.0
    if "lang=en" in clean or clean.endswith(":en") or clean.endswith("|en"):
        bonus += 0.2
    if "english" in clean:
        bonus += 0.15
    if any(key in clean for key in ["citation_", "dc.", "dcterms.", "ldjson", "script:translated", "script:english"]):
        bonus += 0.08
    if any(key in clean for key in ["og:", "twitter:", "html:title"]):
        bonus += 0.02
    return bonus


def _candidate_content_penalty(value: str) -> float:
    low = collapse_ws(value).lower()
    penalty = 0.0
    noisy_markers = [
        "all rights reserved",
        "cookie",
        "javascript is disabled",
        "subscribe",
        "sign in",
        "log in",
        "privacy policy",
    ]
    if any(marker in low for marker in noisy_markers):
        penalty += 0.4
    return penalty


def _score_english_candidate(label: str, value: str) -> float:
    ratio = english_ratio(value)
    clean = strip_markup(value)
    length = len(clean)
    if not clean:
        return 0.0
    # Prefer sufficiently long natural-language strings.
    length_bonus = min(length / 400.0, 0.2)
    label_bonus = _candidate_label_bonus(label)
    noise_penalty = _candidate_content_penalty(clean)
    return ratio + length_bonus + label_bonus - noise_penalty


def _choose_best_english_title(candidates: list[tuple[str, str]]) -> str:
    best = ""
    best_score = 0.0
    for label, value in candidates:
        clean = strip_markup(value)
        if len(clean) < 8 or len(clean) > 320:
            continue
        if soft_text_key(clean) in LOW_QUALITY_TITLE_KEYS:
            continue
        score = _score_english_candidate(label, clean)
        if score > best_score:
            best = clean
            best_score = score
    if english_ratio(best) < 0.6:
        return ""
    return best


def _choose_best_english_abstract(candidates: list[tuple[str, str]]) -> str:
    best = ""
    best_score = 0.0
    for label, value in candidates:
        clean = strip_markup(value)
        if len(clean) < 70 or len(clean) > 6000:
            continue
        score = _score_english_candidate(label, clean)
        if score > best_score:
            best = clean
            best_score = score
    if english_ratio(best) < 0.6:
        return ""
    return best


def _is_low_quality_fallback_title(value: str, publication: str, venue: str) -> bool:
    candidate_key = soft_text_key(value)
    if not candidate_key:
        return True
    if candidate_key in LOW_QUALITY_TITLE_KEYS:
        return True

    pub_key = soft_text_key(publication)
    venue_key = soft_text_key(venue)
    if candidate_key and pub_key and candidate_key == pub_key:
        return True
    if candidate_key and venue_key and candidate_key == venue_key:
        return True

    # Very short generic labels are usually landing-page boilerplate, not paper titles.
    if len(candidate_key.split()) <= 2 and len(candidate_key) <= 20:
        return True
    return False


def _fetch_text(url: str, timeout_s: int, user_agent: str) -> str:
    cmd = [
        "curl",
        "-sS",
        "-L",
        "--max-redirs",
        "4",
        "--connect-timeout",
        str(max(4, min(timeout_s, 20))),
        "--max-time",
        str(max(5, timeout_s)),
        "-A",
        user_agent,
        "-H",
        "Accept: text/html,application/xhtml+xml",
        url,
    ]
    proc = subprocess.run(cmd, check=False, capture_output=True)
    if proc.returncode != 0:
        err = collapse_ws((proc.stderr or b"").decode("utf-8", errors="ignore")) or f"curl exit {proc.returncode}"
        raise RuntimeError(err)
    return (proc.stdout or b"")[:600_000].decode("utf-8", errors="ignore")


def enrich_from_landing_page(
    work: dict,
    timeout_s: int,
    user_agent: str,
) -> tuple[str, str]:
    for url in list_openalex_landing_urls(work):
        if not re.match(r"^https?://", url, flags=re.IGNORECASE):
            continue
        try:
            text = _fetch_text(url, timeout_s=timeout_s, user_agent=user_agent)
        except Exception:
            continue
        title_candidates, abstract_candidates = _extract_meta_candidates(text)
        best_title = _choose_best_english_title(title_candidates)
        best_abstract = _choose_best_english_abstract(abstract_candidates)
        if best_title or best_abstract:
            return best_title, best_abstract
    return "", ""


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, payload) -> bool:
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if text == existing:
        return False
    path.write_text(text, encoding="utf-8")
    return True


class DSU:
    def __init__(self, size: int):
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int):
        ra = self.find(a)
        rb = self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb
            return
        if self.rank[ra] > self.rank[rb]:
            self.parent[rb] = ra
            return
        self.parent[rb] = ra
        self.rank[ra] += 1


def record_identity_keys(record: dict) -> list[str]:
    keys: list[str] = []
    openalex_short = normalize_openalex_short_id(str(record.get("openalexId", "")))
    if openalex_short:
        keys.append(f"oa:{openalex_short}")
    doi = normalize_doi(str(record.get("doi", "")))
    if doi:
        keys.append(f"doi:{doi}")
    year = collapse_ws(str(record.get("year", "")))
    title = normalize_title_key(str(record.get("title", "")))
    if year and title:
        keys.append(f"title:{year}:{title}")
    return keys


def score_record(record: dict) -> tuple:
    source = collapse_ws(str(record.get("source", "")))
    source_score = SOURCE_PRIORITY.get(source, 0)
    title_score = 1 if collapse_ws(str(record.get("title", ""))) else 0
    abstract_score = 0 if is_placeholder_abstract(str(record.get("abstract", ""))) else 1
    authors = record.get("authors") if isinstance(record.get("authors"), list) else []
    author_count = len([a for a in authors if isinstance(a, dict) and collapse_ws(str(a.get("name", "")))])
    citations = parse_int(record.get("citationCount")) or 0
    has_openalex = 1 if normalize_openalex_short_id(str(record.get("openalexId", ""))) else 0
    has_doi = 1 if normalize_doi(str(record.get("doi", ""))) else 0
    tag_count = len(record.get("tags") or []) if isinstance(record.get("tags"), list) else 0
    keyword_count = len(record.get("keywords") or []) if isinstance(record.get("keywords"), list) else 0
    return (
        source_score,
        has_openalex,
        has_doi,
        abstract_score,
        title_score,
        author_count,
        citations,
        tag_count + keyword_count,
    )


def dedupe_list(values: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = collapse_ws(str(value))
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(clean)
    return out


def merge_authors(existing_authors, incoming_authors):
    existing = existing_authors if isinstance(existing_authors, list) else []
    incoming = incoming_authors if isinstance(incoming_authors, list) else []
    if not existing:
        return copy.deepcopy(incoming)
    if not incoming:
        return copy.deepcopy(existing)

    def quality(authors: list) -> tuple[int, int, int]:
        valid_names = 0
        long_names = 0
        singletons = 0
        for author in authors:
            if not isinstance(author, dict):
                continue
            name = collapse_ws(str(author.get("name", "")))
            if not name:
                continue
            valid_names += 1
            if len(name) >= 6:
                long_names += 1
            if re.fullmatch(r"[A-Za-z]\.?", name):
                singletons += 1
        return (valid_names, long_names, -singletons)

    q_existing = quality(existing)
    q_incoming = quality(incoming)
    if q_incoming > q_existing:
        return copy.deepcopy(incoming)
    return copy.deepcopy(existing)


def merge_records(base: dict, incoming: dict) -> dict:
    out = copy.deepcopy(base)

    scalar_fields = [
        "id",
        "title",
        "year",
        "publication",
        "venue",
        "type",
        "abstract",
        "paperUrl",
        "sourceUrl",
        "openalexId",
        "doi",
        "source",
        "sourceName",
    ]
    for field in scalar_fields:
        current = collapse_ws(str(out.get(field, "")))
        candidate = collapse_ws(str(incoming.get(field, "")))
        if not current and candidate:
            out[field] = incoming.get(field, "")
        elif field == "abstract" and is_placeholder_abstract(current) and candidate and not is_placeholder_abstract(candidate):
            out[field] = incoming.get(field, "")

    out["authors"] = merge_authors(out.get("authors"), incoming.get("authors"))

    for field in ["tags", "keywords", "matchedAuthors", "matchedSubprojects"]:
        values = []
        if isinstance(out.get(field), list):
            values.extend([str(v) for v in out.get(field) if collapse_ws(str(v))])
        if isinstance(incoming.get(field), list):
            values.extend([str(v) for v in incoming.get(field) if collapse_ws(str(v))])
        if values:
            out[field] = dedupe_list(values)

    current_citations = parse_int(out.get("citationCount"))
    incoming_citations = parse_int(incoming.get("citationCount"))
    if incoming_citations is not None and (current_citations is None or incoming_citations > current_citations):
        out["citationCount"] = incoming_citations

    # Ensure canonical OpenAlex URL shape when available.
    openalex_short = normalize_openalex_short_id(str(out.get("openalexId", "")))
    if openalex_short:
        out["openalexId"] = canonical_openalex_url(openalex_short)
    return out


def _chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(values), size):
        yield values[i : i + size]


def _iter_works(payload: dict) -> Iterable[dict]:
    results = payload.get("results")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict):
                yield item
    elif isinstance(payload.get("id"), str):
        yield payload


def load_openalex_works_from_cache(cache_dir: Path, wanted_ids: set[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not cache_dir.exists():
        return out
    for path in sorted(cache_dir.glob("*.json")):
        try:
            payload = load_json(path)
        except Exception:
            continue
        for work in _iter_works(payload):
            short_id = normalize_openalex_short_id(str(work.get("id", "")))
            if short_id and short_id in wanted_ids and short_id not in out:
                out[short_id] = work
    return out


def _stable_openalex_batch_cache_path(cache_dir: Path, batch_ids: list[str]) -> Path:
    digest = hashlib.sha1("|".join(sorted(batch_ids)).encode("utf-8")).hexdigest()[:20]
    return cache_dir / f"single-db-openalex-{digest}.json"


def _save_openalex_batch_to_cache(cache_dir: Path, batch_ids: list[str], payload: dict) -> bool:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = _stable_openalex_batch_cache_path(cache_dir, batch_ids)
    text = json.dumps(payload, ensure_ascii=False)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if existing == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def fetch_openalex_works(
    ids: list[str],
    batch_size: int,
    mailto: str,
    user_agent: str,
    cache_dir: Path | None = None,
) -> tuple[dict[str, dict], int]:
    out: dict[str, dict] = {}
    cache_files_written = 0
    if not ids:
        return out, cache_files_written

    pending_batches = [chunk for chunk in _chunks(ids, batch_size)]
    completed = 0

    while pending_batches:
        batch = pending_batches.pop(0)
        completed += 1
        params = {
            "filter": f"openalex:{'|'.join(batch)}",
            "per-page": str(len(batch)),
            "select": "id,updated_date,title,type,doi,publication_year,abstract_inverted_index,authorships,cited_by_count,primary_location,best_oa_location,open_access,locations,biblio",
        }
        if mailto:
            params["mailto"] = mailto
        url = f"{OPENALEX_WORKS_API}?{urllib.parse.urlencode(params)}"
        cmd = [
            "curl",
            "-sS",
            "--retry",
            "5",
            "--retry-all-errors",
            "--connect-timeout",
            "20",
            "--max-time",
            "90",
            "-A",
            user_agent,
            url,
        ]
        payload = None
        last_err = ""
        for attempt in range(1, 4):
            try:
                proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
                payload = json.loads(proc.stdout)
                break
            except subprocess.CalledProcessError as exc:
                stderr = collapse_ws(exc.stderr or "")
                stdout = collapse_ws(exc.stdout or "")
                last_err = stderr or stdout or str(exc)
                time.sleep(0.6 * attempt)
            except json.JSONDecodeError as exc:
                last_err = str(exc)
                time.sleep(0.5 * attempt)

        if payload is None:
            if len(batch) > 1:
                half = len(batch) // 2
                pending_batches = [batch[:half], batch[half:]] + pending_batches
                completed -= 1
                print(
                    "[openalex] batch request failed; splitting "
                    f"{len(batch)} -> {len(batch[:half])}+{len(batch[half:])} ({last_err})",
                    flush=True,
                )
                continue
            raise RuntimeError(f"Failed fetching OpenAlex work {batch[0]}: {last_err}")

        if cache_dir is not None and _save_openalex_batch_to_cache(cache_dir, batch, payload):
            cache_files_written += 1

        for work in _iter_works(payload):
            short_id = normalize_openalex_short_id(str(work.get("id", "")))
            if short_id:
                out[short_id] = work

        total = completed + len(pending_batches)
        print(f"[openalex] fetched batch {completed}/{total} ({len(batch)} ids)", flush=True)
        time.sleep(0.06)

    return out, cache_files_written


def load_landing_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = load_json(path)
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    return payload


def save_landing_cache(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    save_json(path, payload)


def should_try_landing_fallback(record: dict) -> bool:
    title = str(record.get("title", ""))
    abstract = str(record.get("abstract", ""))
    if looks_non_english(title):
        return True
    if not collapse_ws(title):
        return True
    if is_placeholder_abstract(abstract):
        return True
    if looks_non_english(abstract, threshold=0.45):
        return True
    return False


def _parse_iso_datetime(value: str) -> _dt.datetime | None:
    raw = collapse_ws(value)
    if not raw:
        return None
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = _dt.datetime.fromisoformat(candidate)
    except Exception:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_dt.timezone.utc)
    return parsed.astimezone(_dt.timezone.utc)


def _cache_older_than(value: str, days: int) -> bool:
    if days < 0:
        return False
    parsed = _parse_iso_datetime(value)
    if parsed is None:
        return True
    age = _dt.datetime.now(_dt.timezone.utc) - parsed
    return age >= _dt.timedelta(days=days)


def apply_openalex_refresh(
    papers: list[dict],
    works_by_id: dict[str, dict],
    landing_cache: dict,
    landing_timeout_s: int,
    user_agent: str,
    enable_landing_fallback: bool,
    landing_max_probes: int,
    landing_miss_recheck_days: int,
) -> tuple[int, int, int, int]:
    refreshed = 0
    fallback_hits = 0
    landing_probes = 0
    landing_skipped_budget = 0

    for paper in papers:
        short_id = normalize_openalex_short_id(str(paper.get("openalexId", "")))
        if not short_id:
            continue
        work = works_by_id.get(short_id)
        if not work:
            continue

        refreshed += 1

        openalex_title = strip_markup(str(work.get("title", "")))
        openalex_abs = decode_abstract_inverted_index(work.get("abstract_inverted_index"))
        openalex_authors = extract_openalex_authors(
            work,
            keep_existing_nonempty_affiliations=True,
            existing_authors=paper.get("authors") if isinstance(paper.get("authors"), list) else [],
        )
        openalex_year = str(work.get("publication_year") or "")
        publication, venue = pick_publication_and_venue(work)
        paper_url, source_url = pick_urls(work)
        doi = normalize_doi(str(work.get("doi", "")))
        citation_count = parse_int(work.get("cited_by_count"))
        paper_type = classify_type(str(work.get("type", "")), str(paper.get("type", "")))

        if openalex_title:
            paper["title"] = openalex_title
        if openalex_abs:
            paper["abstract"] = openalex_abs
        if openalex_authors:
            paper["authors"] = openalex_authors
        if re.fullmatch(r"\d{4}", openalex_year):
            paper["year"] = openalex_year
        if publication:
            paper["publication"] = publication
        if venue:
            paper["venue"] = venue
        if paper_url:
            paper["paperUrl"] = paper_url
        if source_url:
            paper["sourceUrl"] = source_url
        if doi:
            paper["doi"] = doi
        if citation_count is not None:
            paper["citationCount"] = max(0, citation_count)
        if paper_type:
            paper["type"] = paper_type
        paper["openalexId"] = canonical_openalex_url(short_id)

        if not enable_landing_fallback:
            continue
        if not should_try_landing_fallback(paper):
            continue

        cache_entry = landing_cache.get(short_id, {}) if isinstance(landing_cache.get(short_id), dict) else {}
        cache_status = collapse_ws(str(cache_entry.get("status", "")).lower())
        fallback_title = collapse_ws(str(cache_entry.get("title", "")))
        fallback_abstract = collapse_ws(str(cache_entry.get("abstract", "")))
        cache_updated_at = collapse_ws(str(cache_entry.get("updatedAt", "")))
        cache_source_updated = collapse_ws(str(cache_entry.get("sourceUpdatedAt", "")))
        work_updated = collapse_ws(str(work.get("updated_date", "")))

        should_probe = False
        if cache_status == "hit":
            should_probe = bool(work_updated and cache_source_updated and work_updated != cache_source_updated)
        elif cache_status == "miss":
            source_changed = bool(work_updated and cache_source_updated and work_updated != cache_source_updated)
            should_probe = source_changed or _cache_older_than(cache_updated_at, landing_miss_recheck_days)
        else:
            should_probe = not (fallback_title or fallback_abstract)

        if should_probe:
            if landing_max_probes > 0 and landing_probes >= landing_max_probes:
                landing_skipped_budget += 1
                continue
            landing_probes += 1
            if landing_probes % 20 == 0:
                print(f"[landing] probes attempted: {landing_probes}", flush=True)
            found_title, found_abstract = enrich_from_landing_page(
                work,
                timeout_s=landing_timeout_s,
                user_agent=user_agent,
            )
            fallback_title = found_title
            fallback_abstract = found_abstract
            cache_status = "hit" if (fallback_title or fallback_abstract) else "miss"
            landing_cache[short_id] = {
                "title": fallback_title,
                "abstract": fallback_abstract,
                "status": cache_status,
                "sourceUpdatedAt": work_updated,
                "updatedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            }

        current_title = collapse_ws(str(paper.get("title", "")))
        current_abs = collapse_ws(str(paper.get("abstract", "")))

        if fallback_title:
            if _is_low_quality_fallback_title(
                fallback_title,
                publication=str(paper.get("publication", "")),
                venue=str(paper.get("venue", "")),
            ):
                fallback_title = ""
                if isinstance(landing_cache.get(short_id), dict):
                    landing_cache[short_id]["title"] = ""
                    landing_cache[short_id]["status"] = "miss" if not fallback_abstract else "hit"
            if fallback_title and (not current_title or looks_non_english(current_title)):
                paper["title"] = fallback_title
                fallback_hits += 1
        if fallback_abstract:
            if is_placeholder_abstract(current_abs) or looks_non_english(current_abs, threshold=0.45):
                paper["abstract"] = fallback_abstract
                fallback_hits += 1

    return refreshed, fallback_hits, landing_probes, landing_skipped_budget


def ensure_unique_ids(papers: list[dict]):
    seen: set[str] = set()
    for paper in papers:
        base_id = collapse_ws(str(paper.get("id", "")))
        if not base_id:
            openalex_short = normalize_openalex_short_id(str(paper.get("openalexId", ""))).lower()
            base_id = f"openalex-{openalex_short}" if openalex_short else "paper"
        candidate = base_id
        suffix = 2
        while candidate in seen:
            candidate = f"{base_id}-{suffix}"
            suffix += 1
        paper["id"] = candidate
        seen.add(candidate)


def sort_papers(papers: list[dict]):
    def key(p: dict):
        year = collapse_ws(str(p.get("year", "")))
        if not re.fullmatch(r"\d{4}", year):
            year = "0000"
        return (year, collapse_ws(str(p.get("title", "")).lower()), collapse_ws(str(p.get("id", ""))))

    papers.sort(key=key, reverse=True)


def load_source_records(bundle_paths: list[Path]) -> list[dict]:
    records: list[dict] = []
    for path in bundle_paths:
        payload = load_json(path)
        bundle_source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
        bundle_slug = collapse_ws(str(bundle_source.get("slug", "")))
        bundle_name = collapse_ws(str(bundle_source.get("name", "")))
        papers = payload.get("papers")
        if not isinstance(papers, list):
            continue
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            record = copy.deepcopy(paper)
            source = collapse_ws(str(record.get("source", ""))) or bundle_slug
            source_name = collapse_ws(str(record.get("sourceName", ""))) or bundle_name
            if source:
                record["source"] = source
            if source_name:
                record["sourceName"] = source_name
            openalex_short = normalize_openalex_short_id(str(record.get("openalexId", "")))
            if openalex_short:
                record["openalexId"] = canonical_openalex_url(openalex_short)
            doi = normalize_doi(str(record.get("doi", "")))
            if doi:
                record["doi"] = doi
            records.append(record)
    return records


def dedupe_records(records: list[dict]) -> list[dict]:
    if not records:
        return []

    dsu = DSU(len(records))
    owner: dict[str, int] = {}

    for idx, record in enumerate(records):
        for key in record_identity_keys(record):
            if key in owner:
                dsu.union(idx, owner[key])
            else:
                owner[key] = idx

    groups: dict[int, list[int]] = {}
    for idx in range(len(records)):
        root = dsu.find(idx)
        groups.setdefault(root, []).append(idx)

    merged: list[dict] = []
    for members in groups.values():
        best = max(members, key=lambda i: score_record(records[i]))
        result = copy.deepcopy(records[best])
        for idx in members:
            if idx == best:
                continue
            result = merge_records(result, records[idx])
        merged.append(result)
    return merged


def update_manifest(
    manifest_path: Path,
    output_bundle_name: str,
    data_version: str,
    force_bump_data_version: bool = False,
) -> tuple[bool, str]:
    payload = load_json(manifest_path) if manifest_path.exists() else {}
    changed = False

    files_before = payload.get("paperFiles") if isinstance(payload.get("paperFiles"), list) else []
    files_after = [output_bundle_name]
    if files_before != files_after:
        payload["paperFiles"] = files_after
        changed = True

    if force_bump_data_version and payload.get("dataVersion") != data_version:
        payload["dataVersion"] = data_version
        changed = True

    if changed:
        save_json(manifest_path, payload)
    return changed, collapse_ws(str(payload.get("dataVersion", "")))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bundle",
        dest="bundles",
        action="append",
        default=[],
        help="Input papers bundle (repeat). Defaults to llvm-org-pubs + openalex bundles.",
    )
    parser.add_argument("--output", default="papers/combined-all-papers-deduped.json")
    parser.add_argument("--manifest", default="papers/index.json")
    parser.add_argument("--cache-dir", default="papers/.cache/openalex")
    parser.add_argument("--landing-cache", default="papers/.cache/openalex-landing-enrichment.json")
    parser.add_argument("--batch-size", type=int, default=40)
    parser.add_argument("--mailto", default="llvm-library-bot@users.noreply.github.com")
    parser.add_argument("--skip-network", action="store_true")
    parser.add_argument("--skip-landing-fallback", action="store_true")
    parser.add_argument("--landing-timeout", type=int, default=25)
    parser.add_argument("--landing-max-probes", type=int, default=300)
    parser.add_argument("--landing-miss-recheck-days", type=int, default=30)
    parser.add_argument("--user-agent", default="library-single-papers-db/1.0")
    args = parser.parse_args()

    if args.batch_size <= 0:
        raise SystemExit("--batch-size must be > 0")

    default_bundles = [
        "papers/llvm-org-pubs.json",
        "papers/openalex-llvm-query.json",
        "papers/openalex-discovered.json",
    ]
    bundle_paths = [Path(path).resolve() for path in (args.bundles or default_bundles)]
    for path in bundle_paths:
        if not path.exists():
            raise SystemExit(f"Missing input bundle: {path}")

    output_path = Path(args.output).resolve()
    manifest_path = Path(args.manifest).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    landing_cache_path = Path(args.landing_cache).resolve()

    source_records = load_source_records(bundle_paths)
    print(f"Source bundles: {len(bundle_paths)}", flush=True)
    print(f"Source records loaded: {len(source_records)}", flush=True)

    deduped = dedupe_records(source_records)
    print(f"Records after dedupe: {len(deduped)}", flush=True)

    openalex_ids = sorted(
        {
            normalize_openalex_short_id(str(p.get("openalexId", "")))
            for p in deduped
            if normalize_openalex_short_id(str(p.get("openalexId", "")))
        }
    )
    wanted_ids = set(openalex_ids)
    print(f"OpenAlex ids in deduped records: {len(openalex_ids)}", flush=True)

    works_by_id = load_openalex_works_from_cache(cache_dir, wanted_ids)
    print(f"OpenAlex works from cache: {len(works_by_id)}", flush=True)

    missing_ids = sorted(wanted_ids - set(works_by_id.keys()))
    print(f"OpenAlex ids missing after cache scan: {len(missing_ids)}", flush=True)
    fetched = {}
    cache_files_written = 0
    if missing_ids and not args.skip_network:
        fetched, cache_files_written = fetch_openalex_works(
            ids=missing_ids,
            batch_size=args.batch_size,
            mailto=args.mailto.strip(),
            user_agent=args.user_agent,
            cache_dir=cache_dir,
        )
        works_by_id.update(fetched)
        print(f"OpenAlex works fetched from API: {len(fetched)}", flush=True)
        print(f"OpenAlex cache files written: {cache_files_written}", flush=True)
    elif missing_ids:
        print("Skipping OpenAlex network fetch (--skip-network)", flush=True)

    landing_cache = load_landing_cache(landing_cache_path)
    refreshed_count, fallback_hits, landing_probes, landing_skipped_budget = apply_openalex_refresh(
        papers=deduped,
        works_by_id=works_by_id,
        landing_cache=landing_cache,
        landing_timeout_s=max(5, int(args.landing_timeout)),
        user_agent=args.user_agent,
        enable_landing_fallback=not args.skip_landing_fallback and not args.skip_network,
        landing_max_probes=max(0, int(args.landing_max_probes)),
        landing_miss_recheck_days=max(0, int(args.landing_miss_recheck_days)),
    )
    print(f"OpenAlex records refreshed: {refreshed_count}", flush=True)
    print(f"Landing-page English fallback probes: {landing_probes}", flush=True)
    print(f"Landing-page English fallback hits: {fallback_hits}", flush=True)
    if landing_skipped_budget:
        print(f"Landing-page fallback skipped due probe budget: {landing_skipped_budget}", flush=True)

    if not args.skip_landing_fallback and not args.skip_network:
        save_landing_cache(landing_cache_path, landing_cache)

    ensure_unique_ids(deduped)
    sort_papers(deduped)

    bundle = {
        "source": {
            "slug": "combined-all-papers-deduped",
            "name": "Combined Papers (single canonical database)",
            "url": "https://llvm.org/pubs/",
        },
        "papers": deduped,
    }
    output_changed = save_json(output_path, bundle)
    print(f"Output bundle: {output_path}", flush=True)
    print(f"Output changed: {'yes' if output_changed else 'no'}", flush=True)

    data_version = _dt.datetime.now(_dt.timezone.utc).date().isoformat() + "-papers-single-db-openalex-v1"
    manifest_changed, effective_data_version = update_manifest(
        manifest_path,
        output_path.name,
        data_version,
        force_bump_data_version=output_changed,
    )
    print(f"Manifest changed: {'yes' if manifest_changed else 'no'}", flush=True)
    print(
        f"Manifest state: {manifest_path} -> paperFiles=[{output_path.name}] dataVersion={effective_data_version or '(unchanged)'}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
