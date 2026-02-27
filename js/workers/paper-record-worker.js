self.onmessage = async function onMessage(event) {
  var data = event && event.data ? event.data : {};
  var targetId = String(data.id || '').trim();
  var baseUrl = String(data.baseUrl || '');
  if (!targetId || !baseUrl) {
    self.postMessage({ paper: null });
    return;
  }

  function normalizePaperPath(raw) {
    var value = String(raw || '').trim().replace(/^\/+/, '');
    if (!value) return '';
    if (value.indexOf('papers/') === 0) return value;
    if (value.indexOf('../papers/') === 0) return value.slice('../'.length);
    return 'papers/' + value;
  }

  function uniquePaths(paths) {
    var out = [];
    var seen = Object.create(null);
    var source = Array.isArray(paths) ? paths : [];
    for (var i = 0; i < source.length; i += 1) {
      var value = String(source[i] || '').trim();
      if (!value || seen[value]) continue;
      seen[value] = true;
      out.push(value);
    }
    return out;
  }

  async function fetchJson(path) {
    try {
      var url = new URL(path, baseUrl).toString();
      var response = await fetch(url, { cache: 'default' });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  var candidatePaths = uniquePaths((Array.isArray(data.candidatePaths) ? data.candidatePaths : [])
    .map(normalizePaperPath)
    .filter(Boolean));

  var manifestPaths = [];
  var manifest = await fetchJson('papers/index.json');
  if (manifest && Array.isArray(manifest.paperFiles)) {
    manifestPaths = manifest.paperFiles.map(normalizePaperPath).filter(Boolean);
  } else if (manifest && Array.isArray(manifest.files)) {
    manifestPaths = manifest.files.map(normalizePaperPath).filter(Boolean);
  }

  var paths = uniquePaths(candidatePaths.concat(manifestPaths));
  for (var p = 0; p < paths.length; p += 1) {
    var bundle = await fetchJson(paths[p]);
    if (!bundle || !Array.isArray(bundle.papers)) continue;
    for (var i = 0; i < bundle.papers.length; i += 1) {
      var paper = bundle.papers[i];
      if (String((paper && paper.id) || '').trim() === targetId) {
        self.postMessage({ paper: paper });
        return;
      }
    }
  }

  self.postMessage({ paper: null });
};
