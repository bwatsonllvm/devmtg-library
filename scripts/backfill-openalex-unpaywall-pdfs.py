#!/usr/bin/env python3
"""Backfill direct PDF links for papers via OpenAlex + Unpaywall.

Usage:
  python3 scripts/backfill-openalex-unpaywall-pdfs.py \
    --bundle papers/combined-all-papers-deduped.json \
    --manifest papers/index.json \
    --cache papers/.cache/unpaywall-pdf-links.json \
    --mailto "llvm-library-bot@users.noreply.github.com"
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import subprocess
import time
import urllib.parse
from pathlib import Path
from typing import Iterable

OPENALEX_WORKS_API = "https://api.openalex.org/works"
UNPAYWALL_API = "https://api.unpaywall.org/v2"

PDF_HINT_RE = re.compile(
    r"\.pdf(?:$|[?#])|/pdf(?:$|[/?#])|[?&](?:format|type|output)=pdf(?:$|[&#])|[?&]filename=[^&#]*\.pdf(?:$|[&#])",
    flags=re.IGNORECASE,
)

DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", flags=re.IGNORECASE)
OPENALEX_ID_RE = re.compile(r"\bW\d+\b", flags=re.IGNORECASE)


def _collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


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


def _is_blog_record(record: dict) -> bool:
    source = _collapse_ws(str(record.get("source", ""))).lower()
    record_type = _collapse_ws(str(record.get("type", ""))).lower()
    return source == "llvm-blog-www" or record_type in {"blog-post", "blog"}


def _normalize_doi(value: str) -> str:
    raw = _collapse_ws(value).strip().lower()
    if not raw:
        return ""
    if raw in {"none", "null", "nan", "n/a"}:
        return ""
    raw = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"^doi:\s*", "", raw, flags=re.IGNORECASE)
    raw = raw.rstrip("/.")
    match = DOI_RE.search(raw)
    return match.group(0).lower() if match else ""


def _paper_doi(record: dict) -> str:
    for candidate in [
        str(record.get("doi", "")),
        str(record.get("paperUrl", "")),
        str(record.get("sourceUrl", "")),
    ]:
        normalized = _normalize_doi(candidate)
        if normalized:
            return normalized
    return ""


def _openalex_short_id(value: str) -> str:
    raw = _collapse_ws(value)
    if not raw:
        return ""
    suffix = raw.rstrip("/").rsplit("/", 1)[-1].upper()
    if OPENALEX_ID_RE.fullmatch(suffix):
        return suffix
    match = OPENALEX_ID_RE.search(raw.upper())
    return match.group(0) if match else ""


def _normalize_url(value: object) -> str:
    if value is None:
        return ""
    url = _collapse_ws(str(value)).strip()
    if url.lower() in {"none", "null", "nan", "n/a"}:
        return ""
    return url


def _is_direct_pdf_url(url: str) -> bool:
    if not url:
        return False
    return bool(PDF_HINT_RE.search(url))


def _score_pdf_candidate(url: str) -> tuple[int, int]:
    score = 0
    lowered = url.lower()
    if re.search(r"\.pdf(?:$|[?#])", lowered):
        score += 100
    if "/pdf" in lowered:
        score += 40
    if "arxiv.org/pdf/" in lowered:
        score += 30
    if lowered.startswith("https://"):
        score += 10
    elif lowered.startswith("http://"):
        score += 5
    return score, -len(url)


def _pick_best_pdf_url(candidates: list[str]) -> str:
    cleaned: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        url = _normalize_url(candidate)
        if not url:
            continue
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(url)
    if not cleaned:
        return ""
    cleaned.sort(key=_score_pdf_candidate, reverse=True)
    return cleaned[0]


def _openalex_pdf_candidates(work: dict) -> list[str]:
    out: list[str] = []
    best_oa = work.get("best_oa_location") or {}
    primary = work.get("primary_location") or {}
    open_access = work.get("open_access") or {}
    locations = work.get("locations") or []

    for loc in [best_oa, primary]:
        pdf_url = _normalize_url((loc or {}).get("pdf_url", ""))
        if pdf_url:
            out.append(pdf_url)

    for loc in locations:
        if not isinstance(loc, dict):
            continue
        pdf_url = _normalize_url(loc.get("pdf_url", ""))
        if pdf_url:
            out.append(pdf_url)

    for candidate in [
        best_oa.get("landing_page_url"),
        primary.get("landing_page_url"),
        open_access.get("oa_url"),
    ]:
        url = _normalize_url(candidate or "")
        if url and _is_direct_pdf_url(url):
            out.append(url)

    return out


def _openalex_work_is_oa(work: dict) -> bool:
    open_access = work.get("open_access")
    if isinstance(open_access, dict):
        if bool(open_access.get("is_oa")):
            return True
    for loc in [work.get("best_oa_location"), work.get("primary_location"), *(work.get("locations") or [])]:
        if isinstance(loc, dict) and bool(loc.get("is_oa")):
            return True
    return False


def _unpaywall_pdf_candidates(payload: dict) -> list[str]:
    out: list[str] = []
    best_oa = payload.get("best_oa_location") or {}
    locations = payload.get("oa_locations") or []

    for source in [best_oa, *locations]:
        if not isinstance(source, dict):
            continue
        for key in ["url_for_pdf", "url"]:
            url = _normalize_url(source.get(key, ""))
            if not url:
                continue
            if key == "url_for_pdf" or _is_direct_pdf_url(url):
                out.append(url)
    return out


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _iter_works(payload: dict) -> Iterable[dict]:
    results = payload.get("results")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict):
                yield item
    elif isinstance(payload.get("id"), str):
        yield payload


def _fetch_openalex_works(short_ids: list[str], batch_size: int, mailto: str, user_agent: str) -> dict[str, dict]:
    works: dict[str, dict] = {}
    if not short_ids:
        return works

    pending_batches = [batch for batch in _chunks(short_ids, batch_size)]
    completed_batches = 0

    while pending_batches:
        batch = pending_batches.pop(0)
        completed_batches += 1
        params = {
            "filter": f"openalex:{'|'.join(batch)}",
            "per-page": str(len(batch)),
            "select": "id,doi,best_oa_location,primary_location,open_access,locations",
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
                    f"size={len(batch)} into {len(left)}+{len(right)} (error={last_err})",
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


def _load_unpaywall_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = _load_json(path)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _save_unpaywall_cache(path: Path, payload: dict) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    return _save_json_if_changed(path, payload)


def _fetch_unpaywall_pdf_url(doi: str, mailto: str, user_agent: str) -> tuple[str, str]:
    if not doi:
        return "", "missing-doi"
    encoded = urllib.parse.quote(doi, safe="")
    url = f"{UNPAYWALL_API}/{encoded}?email={urllib.parse.quote(mailto, safe='@._+-')}"
    cmd = [
        "curl",
        "-sS",
        "--retry",
        "4",
        "--retry-all-errors",
        "--connect-timeout",
        "20",
        "--max-time",
        "60",
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
            time.sleep(0.45 * attempt)
        except json.JSONDecodeError as exc:
            last_err = str(exc)
            time.sleep(0.35 * attempt)

    if payload is None:
        return "", f"error:{last_err}" if last_err else "error"
    if not isinstance(payload, dict):
        return "", "invalid"
    if payload.get("error"):
        return "", f"error:{_collapse_ws(str(payload.get('error', '')))}"

    best = _pick_best_pdf_url(_unpaywall_pdf_candidates(payload))
    if best:
        return best, "hit"

    is_oa = bool(payload.get("is_oa"))
    status = "miss-oa" if is_oa else "miss-closed"
    return "", status


def _update_manifest_version(manifest_path: Path) -> str:
    payload = _load_json(manifest_path)
    today = _dt.date.today().isoformat()
    data_version = f"{today}-papers-single-db-openalex-unpaywall-pdf-v1"
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
        help="Path to papers bundle JSON (repeat for multiple).",
    )
    parser.add_argument(
        "--manifest",
        default="",
        help="Optional papers/index.json to update dataVersion when changes are written.",
    )
    parser.add_argument(
        "--cache",
        default="papers/.cache/unpaywall-pdf-links.json",
        help="Unpaywall DOI cache JSON path.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=40,
        help="OpenAlex batch size.",
    )
    parser.add_argument(
        "--mailto",
        default="llvm-library-bot@users.noreply.github.com",
        help="Contact email for OpenAlex/Unpaywall polite pool.",
    )
    parser.add_argument(
        "--skip-unpaywall",
        action="store_true",
        help="Only use OpenAlex metadata (skip direct Unpaywall requests).",
    )
    args = parser.parse_args()

    bundle_paths = [Path(p).resolve() for p in args.bundles]
    bundle_payloads: list[tuple[Path, dict]] = []
    for path in bundle_paths:
        if not path.exists():
            raise SystemExit(f"Missing bundle file: {path}")
        payload = _load_json(path)
        papers = payload.get("papers")
        if not isinstance(papers, list):
            raise SystemExit(f"{path}: missing papers array")
        bundle_payloads.append((path, payload))

    refs: list[dict] = []
    non_blog_total = 0
    already_pdf_total = 0
    for _, payload in bundle_payloads:
        for paper in payload.get("papers") or []:
            if not isinstance(paper, dict) or _is_blog_record(paper):
                continue
            non_blog_total += 1
            raw_paper_url = paper.get("paperUrl", "")
            current_paper_url = _normalize_url(raw_paper_url)
            raw_text = _collapse_ws(str(raw_paper_url)).strip() if raw_paper_url is not None else ""
            if current_paper_url != raw_text:
                paper["paperUrl"] = current_paper_url
            if _is_direct_pdf_url(current_paper_url):
                already_pdf_total += 1
                continue
            refs.append(
                {
                    "paper": paper,
                    "doi": _paper_doi(paper),
                    "openalex": _openalex_short_id(str(paper.get("openalexId", ""))),
                    "openalex_state": "missing",
                }
            )

    print(f"Non-blog papers: {non_blog_total}")
    print(f"Already direct PDF: {already_pdf_total}")
    print(f"Needs direct PDF enrichment: {len(refs)}")

    refs_by_openalex: dict[str, list[dict]] = {}
    for ref in refs:
        short_id = ref["openalex"]
        if short_id:
            refs_by_openalex.setdefault(short_id, []).append(ref)

    openalex_works = _fetch_openalex_works(
        sorted(refs_by_openalex.keys()),
        batch_size=max(1, int(args.batch_size)),
        mailto=args.mailto.strip(),
        user_agent="library-openalex-unpaywall-pdf-backfill/1.0",
    )
    print(f"OpenAlex works fetched: {len(openalex_works)}")

    updated_from_openalex = 0
    for short_id, group in refs_by_openalex.items():
        work = openalex_works.get(short_id)
        if not work:
            for ref in group:
                ref["openalex_state"] = "missing"
            continue

        pdf_url = _pick_best_pdf_url(_openalex_pdf_candidates(work))
        is_oa = _openalex_work_is_oa(work)

        for ref in group:
            if pdf_url:
                current = _normalize_url(ref["paper"].get("paperUrl", ""))
                if current != pdf_url:
                    ref["paper"]["paperUrl"] = pdf_url
                    updated_from_openalex += 1
                ref["openalex_state"] = "hit"
            else:
                ref["openalex_state"] = "oa-no-pdf" if is_oa else "closed"

            if not ref["doi"]:
                ref["doi"] = _normalize_doi(str(work.get("doi", "")))

    print(f"Updated via OpenAlex direct PDF URLs: {updated_from_openalex}")

    unresolved_refs = [
        ref for ref in refs
        if not _is_direct_pdf_url(_normalize_url(ref["paper"].get("paperUrl", "")))
    ]
    print(f"Still unresolved after OpenAlex: {len(unresolved_refs)}")

    cache_path = Path(args.cache).resolve()
    cache = _load_unpaywall_cache(cache_path)
    unpaywall_cache_changed = False
    updated_from_unpaywall = 0
    unpaywall_requests = 0

    if not args.skip_unpaywall:
        doi_to_refs: dict[str, list[dict]] = {}
        for ref in unresolved_refs:
            doi = ref["doi"]
            if not doi:
                continue
            if ref["openalex_state"] in {"closed"}:
                continue
            doi_to_refs.setdefault(doi, []).append(ref)

        print(f"Unpaywall DOI candidates: {len(doi_to_refs)}")

        for idx, doi in enumerate(sorted(doi_to_refs.keys()), start=1):
            cached = cache.get(doi) if isinstance(cache.get(doi), dict) else None
            if cached is not None and "pdfUrl" in cached:
                pdf_url = _normalize_url(cached.get("pdfUrl", ""))
                status = _collapse_ws(str(cached.get("status", ""))) or ("hit" if pdf_url else "miss")
            else:
                pdf_url, status = _fetch_unpaywall_pdf_url(
                    doi,
                    mailto=args.mailto.strip(),
                    user_agent="library-openalex-unpaywall-pdf-backfill/1.0",
                )
                cache[doi] = {
                    "pdfUrl": pdf_url,
                    "status": status,
                    "updatedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                }
                unpaywall_cache_changed = True
                unpaywall_requests += 1
                time.sleep(0.08)

            if pdf_url:
                for ref in doi_to_refs[doi]:
                    current = _normalize_url(ref["paper"].get("paperUrl", ""))
                    if current != pdf_url:
                        ref["paper"]["paperUrl"] = pdf_url
                        updated_from_unpaywall += 1
            if idx % 50 == 0:
                print(f"[unpaywall] processed {idx}/{len(doi_to_refs)} DOIs", flush=True)

        print(f"Unpaywall requests made: {unpaywall_requests}")
        print(f"Updated via Unpaywall direct PDF URLs: {updated_from_unpaywall}")

    if unpaywall_cache_changed:
        _save_unpaywall_cache(cache_path, cache)

    written_bundles = 0
    for path, payload in bundle_payloads:
        if _save_json_if_changed(path, payload):
            written_bundles += 1
            print(f"Wrote updated bundle: {path}")
        else:
            print(f"No changes: {path}")

    final_without_pdf = 0
    for _, payload in bundle_payloads:
        for paper in payload.get("papers") or []:
            if not isinstance(paper, dict) or _is_blog_record(paper):
                continue
            if not _is_direct_pdf_url(_normalize_url(paper.get("paperUrl", ""))):
                final_without_pdf += 1

    print(f"Non-blog papers still without direct PDF URL: {final_without_pdf}")

    if args.manifest and written_bundles:
        manifest_path = Path(args.manifest).resolve()
        if not manifest_path.exists():
            raise SystemExit(f"Missing manifest file: {manifest_path}")
        data_version = _update_manifest_version(manifest_path)
        print(f"Updated manifest dataVersion: {data_version}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
