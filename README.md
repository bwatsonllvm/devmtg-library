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

## Search And Discovery Experience (Updated February 23, 2026)

Search now uses a shared, relevance-first stack intended to work for both LLVM newcomers and advanced researchers.

### Global autocomplete and query routing

- All `.global-search-form` inputs use a shared autocomplete index sourced from talks, papers/blogs, people, and key topics.
- Suggestions are grouped into:
  - Key Topics
  - Speakers + Authors
  - Talk Titles
  - Paper + Blog Titles
  - A direct action to search the entire library
- Autocomplete ranking uses `rankAutocompleteEntries` (shared utility) with:
  - exact/prefix/contains boosts
  - popularity weighting
  - fuzzy tolerance
- Search placeholders adapt by section (`talks`, `papers`, `blogs`, `people`, `work`) to make scope obvious.

### Relevance ranking model

Shared ranking helpers in `js/shared/library-utils.js` power core search behavior:

- Query normalization:
  - case/diacritics normalization
  - token aliasing and synonym expansion
  - stopword handling and lightweight stemming
  - quoted phrase parsing
- Fuzzy robustness:
  - subsequence matching
  - bounded Levenshtein distance for typo tolerance
- Weighted field scoring:
  - talks: title, speakers, tags, meeting metadata, abstract, category, year
  - papers/blogs: title, authors, topics, publication/venue, abstract, body/content text, year
- Coverage-aware gating:
  - broad tokens (like `llvm`, `paper`, `talk`) are de-emphasized as required matches when narrow terms exist
  - stricter required-clause thresholds for longer, specific queries
  - relaxed fallback only when strict matching returns nothing
- Lower-noise synonym handling:
  - low-signal expansions are filtered
  - beginner-intent expansions prioritize `intro/introduction/tutorial` over generic terms
- Tie-break and quality boosts for recency, citations (papers/blogs), and beginner-intent queries.
- Shared rankers (`rankTalksByQuery`, `rankPaperRecordsByQuery`) are now used consistently across talks, papers/blogs, and global work search surfaces.

### Context-aware result previews

- Result cards now show query-centered snippets instead of only leading text.
- Snippets are extracted from the full searchable body when available:
  - talks: abstracts
  - papers/blogs: abstract + on-repo body/content/markdown/html fields
- Matched terms remain highlighted in these snippets to make relevance transparent for both novice and advanced queries.

### Results controls across pages

- `talks/`: sort (`relevance`, `newest`, `oldest`, `title`) + `grid/list` view toggle.
- `papers/` and `blogs/`: sort (`relevance`, `year`, `citations`) + `grid/list` view toggle.
- `work.html` (global/entity combined results):
  - sort (`relevance`, `newest`, `oldest`, `title`, `citations`)
  - in global search mode (`mode=search`), results are interleaved across talks/papers/blogs by cross-type relevance (not fixed by content type)
  - exact/prefix title intent gets additional boost so precise queries surface the best matching item first, regardless of type
  - `expanded/compact` view toggle across talks, papers, and blogs sections
  - URL-state support for `sort` and `view`, with mode-aware defaults
- `people/`:
  - sort (`works`, `citations`, `alpha`, `alpha-desc`)
  - `expanded/compact` view toggle

### URL/state behavior

- `work.html` supports:
  - `mode=search&q=...` for global query mode
  - `kind=speaker|topic&value=...` for entity mode
  - `from=talks|papers|blogs|people|work` for back-link context
  - `sort=...` and `view=expanded|compact`
- Default Work sort is:
  - `relevance` in search mode
  - `newest` in entity mode
- View preferences are persisted in local storage:
  - `llvm-hub-view` (talks/papers/blogs grid/list)
  - `llvm-hub-work-view` (work expanded/compact)
  - `llvm-hub-people-view` (people expanded/compact)

## How The Database Is Constructed

### 1) Talks dataset (`devmtg/events/*.json`)

Talk records are synchronized from public LLVM Developers' Meeting pages under `llvm-www/devmtg`.
The sync process preserves the current JSON schema and fills/updates structured fields such as:
- talk id, meeting id, title, abstract
- speaker list
- slides URL and video URL/ID
- normalized category and tags

### 2) Papers dataset (`papers/combined-all-papers-deduped.json`)

The canonical papers database combines three public sources:
- LLVM publications content from `llvm.org/pubs` (canonical LLVM papers)
- OpenAlex discovery results for LLVM-related research
- LLVM Project Blog posts from `llvm/llvm-blog-www`

OpenAlex discovery is constrained by LLVM-focused keyword and subproject matching, then filtered against known library contributors derived from existing talk/paper records.

The automated pipeline does not rely on a repository-maintained direct-name seed list.
During the final merge, OpenAlex metadata is refreshed for titles, abstracts, authors, affiliations, citation counts, and URLs. For non-English or missing text, the pipeline also probes deeper landing-page metadata layers to recover English title/abstract when available.
Blog entries are sourced directly from the blog repository and linked to their post files in GitHub, with the canonical blog URL also retained.
Discovery output is treated as an intermediate input; the final single-database build is the stage that updates `papers/index.json`.

### 3) People index (runtime derived)

People records are not a separate hand-curated database file. They are built from talk speakers and paper authors, with name normalization and merge rules to reduce duplicate variants.

### 4) Update log (`updates/index.json`)

The update log is generated from content deltas and records newly added:
- talks
- slides/video additions
- papers
- blog posts

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
3. Sync LLVM blog posts from `llvm-blog-www`
4. Rebuild the single canonical papers database (OpenAlex + llvm.org/pubs + blog)
5. Rebuild the updates log
6. Validate bundle integrity

## Repository Layout

- `index.html`, `work.html`, and section folders (`talks/`, `papers/`, `blogs/`, `people/`, `about/`, `updates/`): static site pages/routes
- `css/`, `js/`, `images/`: shared site assets
- `devmtg/events/*.json`: talk/event records
- `devmtg/events/index.json`: event manifest + data version
- `updates/index.json`: update-log dataset
- `papers/*.json`: source and derived paper bundles (site serves the manifest-listed file)
- `papers/index.json`: paper manifest + data version
- `scripts/`: ingestion, normalization, and validation tooling
