# LLVM Research Library

Public site: https://llvm.org/devmtg/

This repository contains the data and static web assets for the LLVM Research Library.

## What This Library Is

The library is a searchable index of:
- LLVM Developers' Meeting talks
- LLVM-related papers
- Combined people records (speakers + authors)
- A chronological update log of newly added content

It is designed as a public, online reference site.

## How The Database Is Constructed

### 1) Talks dataset (`devmtg/events/*.json`)

Talk records are synchronized from public LLVM Developers' Meeting pages under `llvm-www/devmtg`.
The sync process preserves the current JSON schema and fills/updates structured fields such as:
- talk id, meeting id, title, abstract
- speaker list
- slides URL and video URL/ID
- normalized category and tags

### 2) Papers dataset (`papers/combined-all-papers-deduped.json`)

The canonical papers database combines two public sources:
- LLVM publications content from `llvm.org/pubs` (canonical LLVM papers)
- OpenAlex discovery results for LLVM-related research

OpenAlex discovery is constrained by LLVM-focused keyword and subproject matching, then filtered against known library contributors derived from existing talk/paper records.

The automated pipeline does not rely on a repository-maintained direct-name seed list.
During the final merge, OpenAlex metadata is refreshed for titles, abstracts, authors, affiliations, citation counts, and URLs. For non-English or missing text, the pipeline also probes deeper landing-page metadata layers to recover English title/abstract when available.

### 3) People index (runtime derived)

People records are not a separate hand-curated database file. They are built from talk speakers and paper authors, with name normalization and merge rules to reduce duplicate variants.

### 4) Update log (`devmtg/updates/index.json`)

The update log is generated from content deltas and records newly added:
- talks
- slides/video additions
- papers

Entries are sorted newest to oldest and linked to in-library detail pages.

## Data Scope And Limits

- All indexed source material is public.
- The site is a research index, not a replacement for official event pages.
- External links (slides, videos, papers, DOIs) can change or disappear over time.
- Name normalization reduces duplicates but cannot guarantee perfect entity resolution.

For canonical meeting schedules and announcements, use the official archive: https://llvm.org/devmtg/

## Automation

A scheduled GitHub Actions workflow (`.github/workflows/library-sync.yml`) runs weekly and opens a PR with refreshed data when changes are found.

Automation stages:
1. Sync talks/slides/videos from `llvm-www/devmtg`
2. Refresh OpenAlex-discovered papers
3. Rebuild the single canonical papers database (OpenAlex + llvm.org/pubs)
4. Rebuild the updates log
5. Validate bundle integrity

## Repository Layout

- `devmtg/`: static site bundle (HTML/CSS/JS/data)
- `devmtg/events/*.json`: talk/event records
- `devmtg/events/index.json`: event manifest + data version
- `devmtg/updates/index.json`: update-log dataset
- `papers/*.json`: source and derived paper bundles (site serves the manifest-listed file)
- `papers/index.json`: paper manifest + data version
- `scripts/`: ingestion, normalization, and validation tooling
