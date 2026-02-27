#!/usr/bin/env python3
"""Backfill paper author affiliations from OpenAlex works metadata.

This script also attempts to resolve missing ``openalexId`` values (for non-blog
papers) using OpenAlex title search, then applies affiliation backfills.

Usage:
  ./scripts/backfill-openalex-affiliations.py \
    --bundle papers/combined-all-papers-deduped.json \
    --bundle papers/openalex-discovered.json \
    --manifest papers/index.json
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import subprocess
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode

OPENALEX_WORKS_API = "https://api.openalex.org/works"
MISSING_TOKENS = {
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
BLOG_SOURCE_SLUGS = {"llvm-blog-www", "llvm-www-blog"}
BLOG_TYPE_VALUES = {"blog", "blog-post"}
CORPORATE_AFFILIATION_HINT_RE = re.compile(
    r"\b(inc|corp|corporation|company|llc|ltd|gmbh|technologies|technology|systems|labs?)\b",
    re.IGNORECASE,
)
ACADEMIC_AFFILIATION_HINT_RE = re.compile(
    r"\b(university|college|institute|school|department|faculty|laboratory|centre|center|hospital|clinic|academy)\b",
    re.IGNORECASE,
)
CORPORATE_REGIONAL_BASES = {
    "intel",
    "google",
    "microsoft",
    "meta",
    "facebook",
    "amazon",
    "apple",
    "nvidia",
    "amd",
    "arm",
    "qualcomm",
    "ibm",
    "oracle",
    "samsung",
    "huawei",
    "xilinx",
    "broadcom",
}
COUNTRY_REGION_QUALIFIER_KEYS = {
    "argentina",
    "australia",
    "austria",
    "belgium",
    "brazil",
    "canada",
    "chile",
    "china",
    "colombia",
    "croatia",
    "czechrepublic",
    "denmark",
    "estonia",
    "finland",
    "france",
    "germany",
    "greece",
    "hungary",
    "iceland",
    "india",
    "indonesia",
    "ireland",
    "israel",
    "italy",
    "japan",
    "latvia",
    "lithuania",
    "luxembourg",
    "malaysia",
    "mexico",
    "netherlands",
    "newzealand",
    "norway",
    "philippines",
    "poland",
    "portugal",
    "romania",
    "saudiarabia",
    "singapore",
    "slovakia",
    "slovenia",
    "southafrica",
    "southkorea",
    "spain",
    "sweden",
    "switzerland",
    "taiwan",
    "thailand",
    "turkey",
    "uae",
    "uk",
    "ukraine",
    "unitedarabemirates",
    "unitedkingdom",
    "unitedstates",
    "usa",
    "vietnam",
}
AFFILIATION_ALIAS_MAP: dict[str, str] = {
    "mit": "Massachusetts Institute of Technology",
    "massachusettsinstituteoftechnology": "Massachusetts Institute of Technology",
    "massachussettsinstituteoftechnology": "Massachusetts Institute of Technology",
    "massachusettsinsituteoftechnology": "Massachusetts Institute of Technology",
    "massachussettsinsituteoftechnology": "Massachusetts Institute of Technology",
    "massachusettsinstoftechnology": "Massachusetts Institute of Technology",
    "massachussettsinstoftechnology": "Massachusetts Institute of Technology",
    "carnegiemellon": "Carnegie Mellon University",
    "carnegiemellonuniversity": "Carnegie Mellon University",
    "cmu": "Carnegie Mellon University",
    "caltech": "California Institute of Technology",
    "uiuc": "University of Illinois Urbana-Champaign",
    "universityofillinoisaturbanachampaign": "University of Illinois Urbana-Champaign",
    "universityofillinoisurbanachampaign": "University of Illinois Urbana-Champaign",
    "ethzurich": "ETH Zurich",
    "eidgenossischetechnischehochschulezurich": "ETH Zurich",
    "epfl": "EPFL",
    "ecolepolytechniquefederaledelausanne": "EPFL",
}
UC_CAMPUS_ALIAS_MAP: dict[str, str] = {
    "berkeley": "Berkeley",
    "ucb": "Berkeley",
    "davis": "Davis",
    "ucd": "Davis",
    "irvine": "Irvine",
    "uci": "Irvine",
    "losangeles": "Los Angeles",
    "la": "Los Angeles",
    "ucla": "Los Angeles",
    "merced": "Merced",
    "ucm": "Merced",
    "riverside": "Riverside",
    "ucr": "Riverside",
    "sandiego": "San Diego",
    "sd": "San Diego",
    "ucsd": "San Diego",
    "sanfrancisco": "San Francisco",
    "sf": "San Francisco",
    "ucsf": "San Francisco",
    "santabarbara": "Santa Barbara",
    "sb": "Santa Barbara",
    "ucsb": "Santa Barbara",
    "santacruz": "Santa Cruz",
    "sc": "Santa Cruz",
    "ucsc": "Santa Cruz",
}


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: expected JSON object")
    return payload


def _serialize_json(payload: dict) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def _save_json_if_changed(path: Path, payload: dict) -> bool:
    new_text = _serialize_json(payload)
    old_text = path.read_text(encoding="utf-8") if path.exists() else ""
    if old_text == new_text:
        return False
    path.write_text(new_text, encoding="utf-8")
    return True


def _collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _strip_diacritics(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value or "")
    return "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")


def _affiliation_alias_key(value: str) -> str:
    text = _strip_diacritics(_collapse_ws(value).lower())
    text = text.replace("&", " and ")
    text = re.sub(r"""['".,()]""", "", text)
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def _is_corporate_affiliation_base(base: str) -> bool:
    cleaned = _collapse_ws(base)
    if not cleaned:
        return False
    lowered = cleaned.casefold()
    alias_key = _affiliation_alias_key(cleaned)
    if alias_key in CORPORATE_REGIONAL_BASES:
        return True
    if lowered in CORPORATE_REGIONAL_BASES:
        return True
    if CORPORATE_AFFILIATION_HINT_RE.search(cleaned):
        return True
    if ACADEMIC_AFFILIATION_HINT_RE.search(cleaned):
        return False
    if "," in cleaned:
        return False
    token_count = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9&'./-]*", cleaned))
    return 1 <= token_count <= 5


def _strip_regional_qualifier_for_corporate(value: str) -> str:
    text = _collapse_ws(value)
    match = re.match(r"^(?P<base>[^()]{2,120})\((?P<suffix>[^()]{2,80})\)$", text)
    if not match:
        return text

    base = _collapse_ws(match.group("base")).strip(" ,;-")
    suffix = _collapse_ws(match.group("suffix"))
    if not base or not suffix:
        return text
    if not re.fullmatch(r"[A-Za-z][A-Za-z .,'-]{1,79}", suffix):
        return text
    if _affiliation_alias_key(suffix) in COUNTRY_REGION_QUALIFIER_KEYS:
        return base
    if not _is_corporate_affiliation_base(base):
        return text
    return base


def _normalize_uc_campus_name(value: str) -> str:
    cleaned = _collapse_ws(value)
    cleaned = re.sub(r"^(?:campus|at|the)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" ,.;:-")
    if not cleaned:
        return ""

    mapped = UC_CAMPUS_ALIAS_MAP.get(_affiliation_alias_key(cleaned))
    if mapped:
        return mapped

    out_parts: list[str] = []
    for part in cleaned.split():
        if not part:
            continue
        if len(part) <= 2:
            out_parts.append(part.upper())
        else:
            out_parts.append(part[0].upper() + part[1:].lower())
    return " ".join(out_parts)


def _canonicalize_uc_affiliation(value: str) -> str:
    text = _collapse_ws(value)
    if not text:
        return ""
    if re.fullmatch(r"university of california", text, flags=re.IGNORECASE):
        return "University of California"

    match = re.match(
        r"^(?:university\s+of\s+california(?:\s*,\s*|\s+at\s+|\s+-\s+|\s+)|u\.?\s*c\.?\s*(?:,\s*|\s+-\s+|\s+)?)"
        r"(?P<campus>.+)$",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return ""

    campus = _normalize_uc_campus_name(match.group("campus"))
    if not campus:
        return "University of California"
    return f"University of California, {campus}"


def _normalize_affiliation(value: str) -> str:
    clean = _collapse_ws(value).strip(" ,;|")
    clean = re.sub(r"\s+,", ",", clean)
    clean = re.sub(r"\(\s+", "(", clean)
    clean = re.sub(r"\s+\)", ")", clean)
    clean = re.sub(r"\bUniv\.\b", "University", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bUniv\b", "University", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bInst\.\b", "Institute", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bInst\b", "Institute", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bDept\.\b", "Department", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bDept\b", "Department", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bMassachussetts\b", "Massachusetts", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bInsitute\b", "Institute", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s*&\s*", " & ", clean)
    clean = re.sub(r"\(\s*United States\s*\)$", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\(\s*USA\s*\)$", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\(\s*United Kingdom\s*\)$", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\(\s*UK\s*\)$", "", clean, flags=re.IGNORECASE)

    clean = _strip_regional_qualifier_for_corporate(clean)

    uc = _canonicalize_uc_affiliation(clean)
    if uc:
        clean = uc

    alias = AFFILIATION_ALIAS_MAP.get(_affiliation_alias_key(clean))
    if alias:
        clean = alias

    if clean.casefold() in MISSING_TOKENS:
        return ""
    return _collapse_ws(clean)


def _normalize_affiliation_key(value: str) -> str:
    return _affiliation_alias_key(_normalize_affiliation(value))


def _openalex_short_id(openalex_id: str) -> str:
    raw = (openalex_id or "").strip()
    if not raw:
        return ""
    suffix = raw.rstrip("/").rsplit("/", 1)[-1].strip().upper()
    if not re.fullmatch(r"W\d+", suffix):
        return ""
    return suffix


def _canonical_openalex_url(short_id: str) -> str:
    return f"https://openalex.org/{short_id}" if short_id else ""


def _normalize_title_key(value: str) -> str:
    text = _strip_diacritics(_collapse_ws(value).lower())
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return _collapse_ws(text)


def _title_tokens(value: str) -> list[str]:
    return [token for token in _normalize_title_key(value).split() if len(token) >= 2]


def _paper_year_value(paper: dict) -> int | None:
    raw = _collapse_ws(str(paper.get("year", "")))
    if re.fullmatch(r"\d{4}", raw):
        try:
            return int(raw)
        except Exception:
            return None
    return None


def _paper_is_blog(paper: dict) -> bool:
    source = _collapse_ws(str(paper.get("source", ""))).casefold()
    ptype = _collapse_ws(str(paper.get("type", ""))).casefold()
    return source in BLOG_SOURCE_SLUGS or ptype in BLOG_TYPE_VALUES


def _normalize_name_key(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value or "")
    folded = "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")
    folded = _collapse_ws(folded).lower()
    folded = re.sub(r"[^a-z0-9 ]+", " ", folded)
    return _collapse_ws(folded)


def _name_signature(value: str) -> str:
    key = _normalize_name_key(value)
    tokens = key.split()
    if not tokens:
        return ""
    first = tokens[0][:1]
    last = tokens[-1]
    if not first or not last:
        return ""
    return f"{last}|{first}"


def _name_last_token(value: str) -> str:
    key = _normalize_name_key(value)
    if not key:
        return ""
    return key.split()[-1]


def _iter_works(payload: dict) -> Iterable[dict]:
    results = payload.get("results")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict):
                yield item
    elif isinstance(payload.get("id"), str):
        yield payload


def _collect_short_ids_from_bundles(bundle_payloads: list[tuple[Path, dict]]) -> list[str]:
    out: set[str] = set()
    for path, payload in bundle_payloads:
        papers = payload.get("papers")
        if not isinstance(papers, list):
            raise ValueError(f"{path}: missing papers array")
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            short_id = _openalex_short_id(str(paper.get("openalexId", "")))
            if short_id:
                out.add(short_id)
    return sorted(out)


def _load_works_from_cache(cache_dir: Path, wanted_ids: set[str]) -> dict[str, dict]:
    works: dict[str, dict] = {}
    if not cache_dir.exists():
        return works

    for path in sorted(cache_dir.glob("*.json")):
        try:
            payload = _load_json(path)
        except Exception:
            continue
        for work in _iter_works(payload):
            short_id = _openalex_short_id(str(work.get("id", "")))
            if not short_id or short_id not in wanted_ids or short_id in works:
                continue
            works[short_id] = work
    return works


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _fetch_openalex_works(
    short_ids: list[str],
    batch_size: int,
    mailto: str = "",
    user_agent: str = "library-openalex-affiliations-backfill/1.0",
) -> dict[str, dict]:
    if not short_ids:
        return {}

    works: dict[str, dict] = {}
    pending_batches = [batch for batch in _chunks(short_ids, batch_size)]
    completed_batches = 0

    while pending_batches:
        batch = pending_batches.pop(0)
        completed_batches += 1
        params = {
            "filter": f"openalex:{'|'.join(batch)}",
            "per-page": str(len(batch)),
            "select": "id,title,publication_year,authorships,type",
        }
        if mailto:
            params["mailto"] = mailto
        url = f"{OPENALEX_WORKS_API}?{urlencode(params)}"
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
                stderr = _collapse_ws(exc.stderr or "")
                stdout = _collapse_ws(exc.stdout or "")
                last_err = stderr or stdout or str(exc)
                time.sleep(0.6 * attempt)
            except json.JSONDecodeError as exc:
                last_err = str(exc)
                time.sleep(0.4 * attempt)

        if payload is None:
            if len(batch) > 1:
                mid = len(batch) // 2
                left = batch[:mid]
                right = batch[mid:]
                pending_batches = [left, right] + pending_batches
                completed_batches -= 1
                print(
                    "[openalex] request failed; splitting batch "
                    f"size={len(batch)} into {len(left)}+{len(right)} "
                    f"(error={last_err})",
                    flush=True,
                )
                continue
            raise RuntimeError(f"OpenAlex request failed for id {batch[0]}: {last_err}")

        for work in _iter_works(payload):
            short_id = _openalex_short_id(str(work.get("id", "")))
            if short_id:
                works[short_id] = work
        total_batches = completed_batches + len(pending_batches)
        print(
            f"[openalex] fetched batch {completed_batches}/{total_batches} ({len(batch)} ids)",
            flush=True,
        )
        time.sleep(0.08)

    return works


def _stable_title_search_cache_path(cache_dir: Path, title: str) -> Path:
    key = _normalize_title_key(title)
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
    return cache_dir / "title-search" / f"{digest}.json"


def _load_cached_title_search(cache_path: Path) -> list[dict]:
    if not cache_path.exists():
        return []
    try:
        payload = _load_json(cache_path)
    except Exception:
        return []
    return [work for work in _iter_works(payload) if isinstance(work, dict)]


def _save_title_search_cache(cache_path: Path, payload: dict) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(_serialize_json(payload), encoding="utf-8")


def _search_openalex_works_by_title(
    *,
    title: str,
    per_page: int,
    cache_dir: Path,
    skip_network: bool,
    mailto: str,
    user_agent: str,
) -> list[dict]:
    normalized_title = _collapse_ws(title)
    if not normalized_title:
        return []

    cache_path = _stable_title_search_cache_path(cache_dir, normalized_title)
    cached = _load_cached_title_search(cache_path)
    if cached:
        return cached
    if skip_network:
        return []

    params = {
        "search": normalized_title,
        "per-page": str(max(5, min(per_page, 50))),
        "select": "id,title,publication_year,authorships,type",
    }
    if mailto:
        params["mailto"] = mailto
    url = f"{OPENALEX_WORKS_API}?{urlencode(params)}"
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
    for attempt in range(1, 4):
        try:
            proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
            payload = json.loads(proc.stdout)
            break
        except subprocess.CalledProcessError:
            time.sleep(0.6 * attempt)
        except json.JSONDecodeError:
            time.sleep(0.4 * attempt)

    if not isinstance(payload, dict):
        return []
    _save_title_search_cache(cache_path, payload)
    return [work for work in _iter_works(payload) if isinstance(work, dict)]


def _author_signature_set_from_paper(paper: dict) -> set[str]:
    out: set[str] = set()
    for author in paper.get("authors", []) or []:
        if not isinstance(author, dict):
            continue
        signature = _name_signature(str(author.get("name", "")))
        if signature:
            out.add(signature)
    return out


def _score_openalex_work_candidate(paper: dict, work: dict) -> float:
    paper_title = _normalize_title_key(str(paper.get("title", "")))
    work_title = _normalize_title_key(str(work.get("title", "")))
    if not paper_title or not work_title:
        return 0.0

    title_ratio = SequenceMatcher(None, paper_title, work_title).ratio()
    paper_tokens = set(_title_tokens(paper_title))
    work_tokens = set(_title_tokens(work_title))
    token_intersection = len(paper_tokens & work_tokens)
    token_union = len(paper_tokens | work_tokens)
    token_jaccard = (token_intersection / token_union) if token_union else 0.0

    score = (title_ratio * 0.72) + (token_jaccard * 0.28)

    paper_year = _paper_year_value(paper)
    try:
        work_year = int(work.get("publication_year")) if work.get("publication_year") is not None else None
    except Exception:
        work_year = None
    if paper_year and work_year:
        delta = abs(paper_year - work_year)
        if delta == 0:
            score += 0.09
        elif delta == 1:
            score += 0.05
        elif delta <= 3:
            score += 0.02
        elif delta >= 8:
            score -= 0.10

    local_signatures = _author_signature_set_from_paper(paper)
    if local_signatures:
        oa_signatures = {entry.get("signature", "") for entry in _extract_authorships(work)}
        oa_signatures = {sig for sig in oa_signatures if isinstance(sig, str) and sig}
        if oa_signatures:
            overlap = len(local_signatures & oa_signatures) / max(1, len(local_signatures))
            score += overlap * 0.24
            if overlap == 0:
                score -= 0.10

    return score


def _choose_best_openalex_candidate(paper: dict, candidates: list[dict]) -> tuple[dict | None, float]:
    scored: list[tuple[float, dict]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        short_id = _openalex_short_id(str(candidate.get("id", "")))
        if not short_id:
            continue
        score = _score_openalex_work_candidate(paper, candidate)
        if score <= 0:
            continue
        scored.append((score, candidate))

    if not scored:
        return None, 0.0

    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = scored[0]
    runner_up_score = scored[1][0] if len(scored) > 1 else 0.0
    margin = best_score - runner_up_score

    if best_score >= 0.82:
        return best, best_score
    if best_score >= 0.66 and margin >= 0.06:
        return best, best_score
    return None, best_score


def _resolve_missing_openalex_ids(
    *,
    bundle_payloads: list[tuple[Path, dict]],
    works_by_id: dict[str, dict],
    cache_dir: Path,
    skip_network: bool,
    mailto: str,
    user_agent: str,
    search_per_paper: int,
) -> dict[str, int]:
    stats = {
        "papers_missing_openalex": 0,
        "papers_eligible_for_search": 0,
        "papers_resolved_openalex": 0,
        "papers_unresolved_openalex": 0,
    }

    resolution_cache: dict[str, str | None] = {}
    for _bundle_path, payload in bundle_payloads:
        papers = payload.get("papers")
        if not isinstance(papers, list):
            continue
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            if _openalex_short_id(str(paper.get("openalexId", ""))):
                continue
            stats["papers_missing_openalex"] += 1
            if _paper_is_blog(paper):
                stats["papers_unresolved_openalex"] += 1
                continue

            title = _collapse_ws(str(paper.get("title", "")))
            if not title:
                stats["papers_unresolved_openalex"] += 1
                continue
            stats["papers_eligible_for_search"] += 1

            cache_key = "|".join(
                [
                    _normalize_title_key(title),
                    str(_paper_year_value(paper) or ""),
                    ",".join(sorted(_author_signature_set_from_paper(paper))),
                ]
            )
            if cache_key in resolution_cache:
                resolved_short = resolution_cache[cache_key]
                if resolved_short:
                    paper["openalexId"] = _canonical_openalex_url(resolved_short)
                    stats["papers_resolved_openalex"] += 1
                else:
                    stats["papers_unresolved_openalex"] += 1
                continue

            candidates = _search_openalex_works_by_title(
                title=title,
                per_page=search_per_paper,
                cache_dir=cache_dir,
                skip_network=skip_network,
                mailto=mailto,
                user_agent=user_agent,
            )
            best, _best_score = _choose_best_openalex_candidate(paper, candidates)
            if not best:
                resolution_cache[cache_key] = None
                stats["papers_unresolved_openalex"] += 1
                continue

            short_id = _openalex_short_id(str(best.get("id", "")))
            if not short_id:
                resolution_cache[cache_key] = None
                stats["papers_unresolved_openalex"] += 1
                continue

            paper["openalexId"] = _canonical_openalex_url(short_id)
            works_by_id[short_id] = best
            resolution_cache[cache_key] = short_id
            stats["papers_resolved_openalex"] += 1

            if not skip_network:
                time.sleep(0.08)

    return stats


def _extract_authorships(work: dict) -> list[dict]:
    out: list[dict] = []
    authorships = work.get("authorships")
    if not isinstance(authorships, list):
        return out

    for authorship in authorships:
        if not isinstance(authorship, dict):
            continue
        author = authorship.get("author")
        if not isinstance(author, dict):
            continue
        name = _collapse_ws(str(author.get("display_name", "")))
        if not name:
            continue

        affiliations: list[str] = []
        institutions = authorship.get("institutions")
        if isinstance(institutions, list):
            for institution in institutions:
                if not isinstance(institution, dict):
                    continue
                display_name = _normalize_affiliation(str(institution.get("display_name", "")))
                if display_name:
                    display_key = _normalize_affiliation_key(display_name)
                    if not display_key:
                        continue
                    if not any(_normalize_affiliation_key(existing) == display_key for existing in affiliations):
                        affiliations.append(display_name)

        out.append(
            {
                "name": name,
                "name_key": _normalize_name_key(name),
                "signature": _name_signature(name),
                "last": _name_last_token(name),
                "affiliation": affiliations[0] if affiliations else "",
                "affiliations": affiliations,
            }
        )
    return out


def _compatible_last_names(left: str, right: str) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True
    return left.endswith(right) or right.endswith(left)


def _apply_affiliations_to_paper(paper: dict, work: dict) -> dict[str, int]:
    authors = paper.get("authors")
    if not isinstance(authors, list):
        return {
            "authors_total": 0,
            "authors_matched": 0,
            "authors_openalex_applied": 0,
            "authors_cleaned_only": 0,
            "fields_changed": 0,
        }

    authorships = _extract_authorships(work)
    if not authorships:
        return {
            "authors_total": len(authors),
            "authors_matched": 0,
            "authors_openalex_applied": 0,
            "authors_cleaned_only": 0,
            "fields_changed": 0,
        }

    locals_meta: list[dict] = []
    for idx, local in enumerate(authors):
        if not isinstance(local, dict):
            continue
        name = _collapse_ws(str(local.get("name", "")))
        locals_meta.append(
            {
                "index": idx,
                "name_key": _normalize_name_key(name),
                "signature": _name_signature(name),
                "last": _name_last_token(name),
            }
        )

    matched: dict[int, tuple[int, str]] = {}
    used_authorship_idx: set[int] = set()

    # Pass 1: exact normalized-name match.
    for local in locals_meta:
        local_idx = int(local["index"])
        local_key = str(local["name_key"])
        if not local_key:
            continue
        candidates = [
            idx
            for idx, oa in enumerate(authorships)
            if idx not in used_authorship_idx and oa["name_key"] == local_key
        ]
        if len(candidates) == 1:
            chosen = candidates[0]
            matched[local_idx] = (chosen, "exact")
            used_authorship_idx.add(chosen)

    # Pass 2: last-name + first-initial signature.
    for local in locals_meta:
        local_idx = int(local["index"])
        if local_idx in matched:
            continue
        signature = str(local["signature"])
        if not signature:
            continue
        candidates = [
            idx
            for idx, oa in enumerate(authorships)
            if idx not in used_authorship_idx and oa["signature"] == signature
        ]
        if len(candidates) == 1:
            chosen = candidates[0]
            matched[local_idx] = (chosen, "signature")
            used_authorship_idx.add(chosen)

    # Pass 3: positional fallback when author counts align and last names are compatible.
    if len(locals_meta) == len(authorships):
        for local in locals_meta:
            local_idx = int(local["index"])
            if local_idx in matched:
                continue
            if local_idx >= len(authorships) or local_idx in used_authorship_idx:
                continue
            local_last = str(local["last"])
            oa_last = str(authorships[local_idx]["last"])
            if _compatible_last_names(local_last, oa_last):
                matched[local_idx] = (local_idx, "position")
                used_authorship_idx.add(local_idx)

    authors_total = 0
    authors_matched = 0
    authors_openalex_applied = 0
    authors_cleaned_only = 0
    fields_changed = 0

    for idx, local in enumerate(authors):
        if not isinstance(local, dict):
            continue
        authors_total += 1
        before = str(local.get("affiliation", ""))
        cleaned_before = _normalize_affiliation(before)
        new_affiliation = cleaned_before
        changed_by_openalex = False

        if idx in matched:
            authors_matched += 1
            match_idx, _match_kind = matched[idx]
            oa_affiliations = [
                str(v)
                for v in authorships[match_idx].get("affiliations", [])
                if isinstance(v, str) and v
            ]
            oa_affiliation = _normalize_affiliation(oa_affiliations[0] if oa_affiliations else "")
            if oa_affiliation:
                new_affiliation = oa_affiliation
                if _normalize_affiliation_key(oa_affiliation) != _normalize_affiliation_key(cleaned_before):
                    changed_by_openalex = True

        if new_affiliation != before:
            local["affiliation"] = new_affiliation
            fields_changed += 1
            if changed_by_openalex:
                authors_openalex_applied += 1
            else:
                authors_cleaned_only += 1

    return {
        "authors_total": authors_total,
        "authors_matched": authors_matched,
        "authors_openalex_applied": authors_openalex_applied,
        "authors_cleaned_only": authors_cleaned_only,
        "fields_changed": fields_changed,
    }


def _clean_author_affiliations_in_paper(paper: dict) -> dict[str, int]:
    authors = paper.get("authors")
    if not isinstance(authors, list):
        return {"authors_total": 0, "fields_changed": 0}

    authors_total = 0
    fields_changed = 0
    for author in authors:
        if not isinstance(author, dict):
            continue
        authors_total += 1
        before = str(author.get("affiliation", ""))
        normalized = _normalize_affiliation(before)
        if normalized != before:
            author["affiliation"] = normalized
            fields_changed += 1
    return {"authors_total": authors_total, "fields_changed": fields_changed}


def _apply_affiliations_to_bundle(payload: dict, works_by_id: dict[str, dict]) -> dict[str, int]:
    papers = payload.get("papers")
    if not isinstance(papers, list):
        raise ValueError("bundle missing papers array")

    stats = {
        "papers_total": len(papers),
        "papers_with_openalex_id": 0,
        "papers_with_work_loaded": 0,
        "authors_total": 0,
        "authors_matched": 0,
        "authors_openalex_applied": 0,
        "authors_cleaned_only": 0,
        "fields_changed": 0,
        "papers_changed": 0,
    }

    for paper in papers:
        if not isinstance(paper, dict):
            continue
        before_blob = json.dumps(paper.get("authors"), ensure_ascii=False, sort_keys=True)
        short_id = _openalex_short_id(str(paper.get("openalexId", "")))
        if not short_id:
            clean_only = _clean_author_affiliations_in_paper(paper)
            stats["authors_total"] += int(clean_only["authors_total"])
            stats["authors_cleaned_only"] += int(clean_only["fields_changed"])
            stats["fields_changed"] += int(clean_only["fields_changed"])
            after_blob = json.dumps(paper.get("authors"), ensure_ascii=False, sort_keys=True)
            if before_blob != after_blob:
                stats["papers_changed"] += 1
            continue
        paper["openalexId"] = _canonical_openalex_url(short_id)
        stats["papers_with_openalex_id"] += 1
        work = works_by_id.get(short_id)
        if not work:
            clean_only = _clean_author_affiliations_in_paper(paper)
            stats["authors_total"] += int(clean_only["authors_total"])
            stats["authors_cleaned_only"] += int(clean_only["fields_changed"])
            stats["fields_changed"] += int(clean_only["fields_changed"])
            after_blob = json.dumps(paper.get("authors"), ensure_ascii=False, sort_keys=True)
            if before_blob != after_blob:
                stats["papers_changed"] += 1
            continue
        stats["papers_with_work_loaded"] += 1

        per_paper = _apply_affiliations_to_paper(paper, work)
        after_blob = json.dumps(paper.get("authors"), ensure_ascii=False, sort_keys=True)

        for key in ["authors_total", "authors_matched", "authors_openalex_applied", "authors_cleaned_only", "fields_changed"]:
            stats[key] += int(per_paper[key])
        if before_blob != after_blob:
            stats["papers_changed"] += 1

    return stats


def _update_manifest_version(manifest_path: Path) -> str:
    payload = _load_json(manifest_path)
    today = _dt.date.today().isoformat()
    data_version = f"{today}-papers-openalex-affiliations-v2"
    if str(payload.get("dataVersion", "")) == data_version:
        return data_version
    payload["dataVersion"] = data_version
    _save_json_if_changed(manifest_path, payload)
    return data_version


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bundle",
        dest="bundles",
        action="append",
        required=True,
        help="Path to a papers JSON bundle (repeat for multiple files).",
    )
    parser.add_argument(
        "--cache-dir",
        default="papers/.cache/openalex",
        help="Directory of cached OpenAlex responses.",
    )
    parser.add_argument(
        "--manifest",
        default="",
        help="Optional papers/index.json path to update dataVersion.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=40,
        help="OpenAlex API batch size for missing work ids.",
    )
    parser.add_argument(
        "--mailto",
        default="",
        help="Optional contact email for OpenAlex polite pool.",
    )
    parser.add_argument(
        "--skip-network",
        action="store_true",
        help="Do not call OpenAlex API; only use local cache.",
    )
    parser.add_argument(
        "--search-per-paper",
        type=int,
        default=20,
        help="OpenAlex title-search candidates to inspect when resolving missing openalexId.",
    )
    parser.add_argument(
        "--user-agent",
        default="library-openalex-affiliations-backfill/2.0",
        help="User-Agent string used for OpenAlex requests.",
    )
    parser.add_argument(
        "--no-resolve-missing-openalex",
        dest="resolve_missing_openalex",
        action="store_false",
        help="Skip title-search resolution for papers missing openalexId.",
    )
    parser.set_defaults(resolve_missing_openalex=True)
    args = parser.parse_args()

    if args.batch_size <= 0:
        raise SystemExit("--batch-size must be > 0")
    if args.search_per_paper <= 0:
        raise SystemExit("--search-per-paper must be > 0")

    bundle_paths = [Path(p).resolve() for p in args.bundles]
    bundle_payloads: list[tuple[Path, dict]] = []
    for path in bundle_paths:
        if not path.exists():
            raise SystemExit(f"Missing bundle file: {path}")
        bundle_payloads.append((path, _load_json(path)))

    short_ids = _collect_short_ids_from_bundles(bundle_payloads)
    wanted_ids = set(short_ids)
    print(f"Unique OpenAlex ids in bundles: {len(short_ids)}")

    cache_dir = Path(args.cache_dir).resolve()
    works_by_id = _load_works_from_cache(cache_dir, wanted_ids)
    print(f"OpenAlex works resolved from cache: {len(works_by_id)}")

    missing = sorted(wanted_ids - set(works_by_id.keys()))
    print(f"OpenAlex ids missing after cache scan: {len(missing)}")

    fetched = {}
    if missing and not args.skip_network:
        fetched = _fetch_openalex_works(
            missing,
            batch_size=args.batch_size,
            mailto=args.mailto.strip(),
            user_agent=args.user_agent,
        )
        works_by_id.update(fetched)
        print(f"OpenAlex works fetched from API: {len(fetched)}")
    elif missing and args.skip_network:
        print("Skipping network fetch (--skip-network enabled)")

    if args.resolve_missing_openalex:
        resolve_stats = _resolve_missing_openalex_ids(
            bundle_payloads=bundle_payloads,
            works_by_id=works_by_id,
            cache_dir=cache_dir,
            skip_network=args.skip_network,
            mailto=args.mailto.strip(),
            user_agent=args.user_agent,
            search_per_paper=args.search_per_paper,
        )
        print(
            "Missing OpenAlex resolution: "
            f"missing={resolve_stats['papers_missing_openalex']} "
            f"eligible={resolve_stats['papers_eligible_for_search']} "
            f"resolved={resolve_stats['papers_resolved_openalex']} "
            f"unresolved={resolve_stats['papers_unresolved_openalex']}",
            flush=True,
        )

    print(f"OpenAlex works available total: {len(works_by_id)}")

    any_bundle_changed = False
    for path, payload in bundle_payloads:
        stats = _apply_affiliations_to_bundle(payload, works_by_id)
        bundle_changed = _save_json_if_changed(path, payload)
        any_bundle_changed = any_bundle_changed or bundle_changed
        print(
            "Updated bundle: "
            f"{path} | papers_total={stats['papers_total']} "
            f"papers_with_openalex_id={stats['papers_with_openalex_id']} "
            f"papers_with_work_loaded={stats['papers_with_work_loaded']} "
            f"papers_changed={stats['papers_changed']} "
            f"authors_total={stats['authors_total']} "
            f"authors_matched={stats['authors_matched']} "
            f"authors_openalex_applied={stats['authors_openalex_applied']} "
            f"authors_cleaned_only={stats['authors_cleaned_only']} "
            f"fields_changed={stats['fields_changed']} "
            f"file_changed={'yes' if bundle_changed else 'no'}",
            flush=True,
        )

    if args.manifest and any_bundle_changed:
        manifest_path = Path(args.manifest).resolve()
        if not manifest_path.exists():
            raise SystemExit(f"Missing manifest file: {manifest_path}")
        data_version = _update_manifest_version(manifest_path)
        print(f"Updated manifest dataVersion: {data_version}")
    elif args.manifest:
        print("Skipped manifest dataVersion update (no bundle content changes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
