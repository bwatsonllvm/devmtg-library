# LLVM Developers' Meeting Library

Repository name: `library`

This repository hosts web bundles intended for `llvm-www`.

Current primary component:
- `devmtg/`

## Repository Layout

- `devmtg/`: static site bundle (HTML/CSS/JS/data)
- `devmtg/events/*.json`: event/talk content source
- `devmtg/events/index.json`: event manifest + cache version (`dataVersion`)
- `devmtg/papers/*.json`: paper metadata source (LLVM publications from `llvm/llvm-www-pubs`, PDF-only)
- `devmtg/papers/index.json`: paper manifest + cache version (`dataVersion`)
- `scripts/validate-library-bundle.sh`: validation script

## Target Path in llvm-www

Copy this bundle into:

- `devmtg/`

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
mkdir -p devmtg
rsync -a /Users/britton/Desktop/library/devmtg/ devmtg/
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

### 4. Commit in `llvm-www`

```bash
git add devmtg
git commit -m "Update LLVM Developers' Meeting Library under devmtg"
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

## Adding or Editing Papers

Paper data is stored in:

- `devmtg/papers/<bundle>.json`

Current bundle:

- `devmtg/papers/llvm-www-pubs.json`

### Paper Record Format

Each paper entry is an object in the `papers` array, for example:

```json
{
  "id": "pubs-2004-01-30-cgo-llvm",
  "source": "llvm-www-pubs",
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
  "venue": "CGO",
  "type": "research-paper",
  "abstract": "Paper summary text.",
  "paperUrl": "https://llvm.org/pubs/2004-01-30-CGO-LLVM.pdf",
  "sourceUrl": "https://llvm.org/pubs/2004-01-30-CGO-LLVM.html",
  "tags": ["LLVM", "Optimizations", "Academic Paper"]
}
```

### Cache Refresh Requirement

After any edit under `devmtg/papers/*.json`, update:

- `devmtg/papers/index.json` -> `dataVersion`

This ensures browsers pull fresh paper data instead of cached data.
