# LLVM Developers' Meeting Library

Repository name: `library`

This repository hosts web bundles intended for `llvm-www`.

Current components:
- `devmtg/`
- `papers/`

## Repository Layout

- `devmtg/`: static site bundle (HTML/CSS/JS/data)
- `devmtg/events/*.json`: event/talk content source
- `devmtg/events/index.json`: event manifest + cache version (`dataVersion`)
- `papers/*.json`: paper metadata source (LLVM publications listed at `https://llvm.org/pubs/`)
- `papers/index.json`: paper manifest + cache version (`dataVersion`)
- `scripts/validate-library-bundle.sh`: validation script

## Target Path in llvm-www

Copy this bundle into:

- `devmtg/`
- `papers/`

Expected public URL:

- `https://llvm.org/devmtg/`

## Deploy Steps

### 1. Validate the bundle

```bash
/Users/britton/Desktop/library/scripts/validate-library-bundle.sh
```

### 2. Copy into your `llvm-www` working tree

```bash
cd /path/to/llvm-www
mkdir -p devmtg papers
rsync -a /Users/britton/Desktop/library/devmtg/ devmtg/
rsync -a /Users/britton/Desktop/library/papers/ papers/
```

### 3. Local smoke test

```bash
cd /path/to/llvm-www
python3 -m http.server 8090
```

Open:

- `http://localhost:8090/devmtg/`
- `http://localhost:8090/devmtg/meetings.html`
- `http://localhost:8090/devmtg/talk.html?id=2019-10-001`
- `http://localhost:8090/devmtg/papers.html`
- `http://localhost:8090/devmtg/paper.html?id=pubs-2004-01-30-cgo-llvm`

### 4. Commit in `llvm-www`

```bash
git add devmtg papers
git commit -m "Update LLVM Developers' Meeting Library talks and papers"
```

## Adding or Editing Talks

Talk data is stored in:

- `devmtg/events/<meeting>.json`

Examples:

- `devmtg/events/2019-10.json`
- `devmtg/events/2023-10.json`

### Talk Record Format

Each talk entry is an object in the `talks` array, for example:

```json
{
  "id": "2026-10-001",
  "meeting": "2026-10",
  "meetingName": "2026 US LLVM Developers' Meeting",
  "meetingLocation": "San Jose, CA, USA",
  "meetingDate": "October 20-22, 2026",
  "category": "technical-talk",
  "title": "Example Talk Title",
  "speakers": [
    {
      "name": "Jane Doe",
      "affiliation": "",
      "github": "",
      "linkedin": "",
      "twitter": ""
    }
  ],
  "abstract": "Short abstract text.",
  "videoUrl": "https://youtu.be/abcdefghijk",
  "videoId": "abcdefghijk",
  "slidesUrl": "https://llvm.org/devmtg/2026-10/slides/example.pdf",
  "projectGithub": "",
  "tags": ["Clang", "Optimizations"]
}
```

### Speakers

Use one speaker object per person in `speakers`.

Multiple speakers example:

```json
"speakers": [
  { "name": "Jane Doe", "affiliation": "", "github": "", "linkedin": "", "twitter": "" },
  { "name": "John Smith", "affiliation": "", "github": "", "linkedin": "", "twitter": "" }
]
```

Rules:

- Do not combine multiple people into one `name` value.
- Do not store company/affiliation text as a speaker `name`.
- If speaker information is unknown, use `"speakers": []`.

### Abstracts and Links

- `abstract`: plain text summary.
- `videoUrl` + `videoId`: keep consistent. If there is no video, set both to `""`.
- `slidesUrl`: URL or `null`/`""` when unavailable.
- `projectGithub`: optional URL.

### Categories and Tags

Common categories include:

- `technical-talk`, `tutorial`, `panel`, `quick-talk`, `lightning-talk`, `student-talk`, `bof`, `poster`, `keynote`

Use tags from the canonical UI tag set when possible.

### Cache Refresh Requirement

After any edit under `devmtg/events/*.json`, update:

- `devmtg/events/index.json` -> `dataVersion`

This ensures browsers pull fresh event data instead of cached data.

### Validation Before Commit

```bash
/Users/britton/Desktop/library/scripts/validate-library-bundle.sh
```

Optional check for malformed/blank speaker names:

```bash
jq -r '.talks[] | select((.speakers // []) | map(.name // "") | any(. == "")) | [.id,.title] | @tsv' devmtg/events/*.json
```

## Automated Sync (OpenAlex + llvm-www/devmtg)

This repo now includes a scheduled workflow:

- `.github/workflows/library-sync.yml`
- Runs weekly on Monday at 09:17 UTC (and can be triggered manually with `workflow_dispatch`)

What it does:

1. Syncs talks/slides/videos from `llvm-www/devmtg` into `devmtg/events/*.json` while preserving current JSON schema.
2. Runs OpenAlex discovery to refresh `papers/openalex-discovered.json` and `papers/index.json`.
3. Builds `devmtg/updates/index.json` to log newly added talks/slides/videos/papers with links.
4. Validates the bundle and opens/updates a PR with changes.

To run the devmtg sync locally:

```bash
python3 /Users/britton/Desktop/library/scripts/sync-devmtg-from-llvm-www.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --manifest /Users/britton/Desktop/library/devmtg/events/index.json
```

If Python TLS certs are missing on your machine, pass a CA bundle explicitly:

```bash
python3 -m pip install --user certifi
CERT_BUNDLE="$(python3 -c 'import certifi; print(certifi.where())')"
python3 /Users/britton/Desktop/library/scripts/sync-devmtg-from-llvm-www.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --manifest /Users/britton/Desktop/library/devmtg/events/index.json \
  --ca-bundle "$CERT_BUNDLE"
```

To run OpenAlex discovery locally:

```bash
python3 /Users/britton/Desktop/library/scripts/build-openalex-discovery.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --papers-dir /Users/britton/Desktop/library/papers \
  --index-json /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js \
  --subprojects-file /Users/britton/Desktop/library/papers/subproject-seeds.txt \
  --extra-authors-file /Users/britton/Desktop/library/papers/extra-author-seeds.txt
```

You can run the full local auto-update pipeline (sync + discovery + update log + validation) with:

```bash
python3 /Users/britton/Desktop/library/scripts/sync-devmtg-from-llvm-www.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --manifest /Users/britton/Desktop/library/devmtg/events/index.json && \
python3 /Users/britton/Desktop/library/scripts/build-openalex-discovery.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --papers-dir /Users/britton/Desktop/library/papers \
  --index-json /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js \
  --subprojects-file /Users/britton/Desktop/library/papers/subproject-seeds.txt \
  --extra-authors-file /Users/britton/Desktop/library/papers/extra-author-seeds.txt && \
python3 /Users/britton/Desktop/library/scripts/build-update-log.py \
  --repo-root /Users/britton/Desktop/library \
  --log-json /Users/britton/Desktop/library/devmtg/updates/index.json && \
/Users/britton/Desktop/library/scripts/validate-library-bundle.sh
```

Update log output:

- `devmtg/updates/index.json`
- website page: `devmtg/updates.html`

To backfill update history retroactively from git commits (oldest -> newest):

```bash
python3 /Users/britton/Desktop/library/scripts/build-update-log.py \
  --repo-root /Users/britton/Desktop/library \
  --log-json /Users/britton/Desktop/library/devmtg/updates/index.json \
  --retroactive-history
```

Optional retroactive controls:

- `--history-from <commit>` and `--history-to <commit-or-ref>` to constrain the replay range.
- `--append-retroactive` to append replayed entries instead of rebuilding from history.

## Adding or Editing Papers

Paper data is stored in:

- `papers/<bundle>.json`

Current bundle:

- `papers/llvm-org-pubs.json`

### Rebuild Papers Dataset

The papers catalog is generated from `llvm-www-pubs/pubs.js` and local publication HTML files:

```bash
python3 /Users/britton/Desktop/library/scripts/build-papers-catalog.py \
  --src-repo /tmp/llvm-www-pubs \
  --resolve-empty-links-from-openalex \
  --out-dir /Users/britton/Desktop/library/papers
```

Tag assignment is derived from the canonical Dev Meeting talk tag list (`devmtg/js/app.js`), matching tag phrases against each paper title/abstract.
In addition to canonical `tags`, builders now emit a richer `keywords` array derived from title/abstract/venue text (LLVM/compiler alias rules + phrase mining).

`--resolve-empty-links-from-openalex` backfills entries that have no URL in `pubs.js` by querying OpenAlex with title/year and using DOI/landing URLs.

### Discover Additional Papers (Speakers + Authors)

To discover more LLVM-related papers on the web for known LLVM speakers/authors:

```bash
python3 /Users/britton/Desktop/library/scripts/build-openalex-discovery.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --papers-dir /Users/britton/Desktop/library/papers \
  --index-json /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js \
  --max-pages-per-keyword 10 \
  --per-page 200
```

By default, discovery now expands to key LLVM subprojects (e.g. Clang/MLIR/LLDB/LLD/Flang/OpenMP/Polly/BOLT/CIRCT/sanitizers) and treats them as LLVM-equivalent signals for matching.
Use `--skip-subproject-keyword-expansion` if you want subproject-aware matching without issuing additional subproject search queries.

This writes:

- `papers/openalex-discovered.json`
- updates `papers/index.json` (`paperFiles` + `dataVersion`)

To provide custom subproject seeds:

```bash
python3 /Users/britton/Desktop/library/scripts/build-openalex-discovery.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --papers-dir /Users/britton/Desktop/library/papers \
  --index-json /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js \
  --subprojects-file /Users/britton/Desktop/library/papers/subproject-seeds.txt \
  --subproject "llvm-libc" \
  --subproject "mlgo"
```

To expand discovery with an explicit author list:

```bash
python3 /Users/britton/Desktop/library/scripts/build-openalex-discovery.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --papers-dir /Users/britton/Desktop/library/papers \
  --index-json /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js \
  --extra-authors-file /Users/britton/Desktop/library/papers/extra-author-seeds.txt \
  --max-pages-per-author 1 \
  --author-per-page 200
```

If network access is unavailable, use cache-only keyword expansion while still adding the extra names to matching:

```bash
python3 /Users/britton/Desktop/library/scripts/build-openalex-discovery.py \
  --events-dir /Users/britton/Desktop/library/devmtg/events \
  --papers-dir /Users/britton/Desktop/library/papers \
  --index-json /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js \
  --extra-authors-file /Users/britton/Desktop/library/papers/extra-author-seeds.txt \
  --skip-author-queries
```

### Normalize Publication Metadata

To standardize publication/source fields across existing bundles:

```bash
python3 /Users/britton/Desktop/library/scripts/normalize-paper-publications.py \
  --papers-dir /Users/britton/Desktop/library/papers \
  --manifest /Users/britton/Desktop/library/papers/index.json
```

### Enrich Paper Keywords (Existing Bundles)

To backfill stronger keyword metadata across existing `papers/*.json` bundles:

```bash
python3 /Users/britton/Desktop/library/scripts/enrich-paper-keywords.py \
  --papers-dir /Users/britton/Desktop/library/papers \
  --manifest /Users/britton/Desktop/library/papers/index.json \
  --app-js /Users/britton/Desktop/library/devmtg/js/app.js
```

### Paper Record Format

Each paper entry is an object in the `papers` array, for example:

```json
{
  "id": "pubs-2004-01-30-cgo-llvm",
  "source": "llvm-org-pubs",
  "sourceName": "LLVM Publications",
  "title": "LLVM: A Compilation Framework for Lifelong Program Analysis & Transformation",
  "authors": [
    {
      "name": "Chris Lattner",
      "affiliation": ""
    },
    {
      "name": "Vikram Adve",
      "affiliation": ""
    }
  ],
  "year": "2004",
  "publication": "CGO",
  "venue": "CGO",
  "type": "research-paper",
  "abstract": "Paper summary text.",
  "paperUrl": "https://llvm.org/pubs/2004-01-30-CGO-LLVM.pdf",
  "sourceUrl": "https://llvm.org/pubs/2004-01-30-CGO-LLVM.html",
  "tags": ["Optimizations"],
  "keywords": ["LLVM", "Intermediate Representation", "Code Generation", "Optimizations"],
  "doi": "10.1145/977395.977673",
  "openalexId": "https://openalex.org/W4365335066",
  "citationCount": 1234
}
```

Optional enrichment fields:

- `doi`: DOI string (or DOI URL in `paperUrl`/`sourceUrl`, which UI can infer).
- `openalexId`: OpenAlex work URL (`https://openalex.org/W...`).
- `citationCount`: integer citation count (typically from OpenAlex).
- `keywords`: richer topic phrases mined from title/abstract/venue text (not limited to canonical UI tags).

### Cache Refresh Requirement

After any edit under `papers/*.json`, update:

- `papers/index.json` -> `dataVersion`

This ensures browsers pull fresh paper data instead of cached data.
