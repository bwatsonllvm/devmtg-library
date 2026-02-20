# LLVM Developers' Meeting Library

Static bundle for the LLVM website.

## Target Path

Copy this bundle into the official `llvm-www` repository at:

- `devmtg/library/`

Expected public URL:

- `https://llvm.org/devmtg/library/`

## Deploy Steps

### 1. Validate the bundle

```bash
/Users/britton/Desktop/devmtg-library/scripts/validate-library-bundle.sh
```

### 2. Copy into your `llvm-www` working tree

```bash
cd /path/to/llvm-www
rm -rf devmtg/library
cp -R /Users/britton/Desktop/devmtg-library/devmtg/library devmtg/
```

### 3. Optional: add a link from `devmtg/index.html`

```html
<p><a href="library/">Browse talks and meetings in the LLVM Developers' Meeting Library</a></p>
```

### 4. Local smoke test

```bash
cd /path/to/llvm-www
python3 -m http.server 8090
```

Open:

- `http://localhost:8090/devmtg/library/`
- `http://localhost:8090/devmtg/library/meetings.html`
- `http://localhost:8090/devmtg/library/talk.html?id=2019-10-001`

### 5. Commit in `llvm-www`

```bash
git add devmtg/library devmtg/index.html
git commit -m "Add LLVM Developers' Meeting Library under devmtg/library"
```
