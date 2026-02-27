self.onmessage = async function onMessage(event) {
  var data = event && event.data ? event.data : {};
  var targetId = String(data.id || '').trim();
  var baseUrl = String(data.baseUrl || '');
  if (!targetId || !baseUrl) {
    self.postMessage({ talk: null });
    return;
  }

  function normalizeEventPath(raw) {
    var value = String(raw || '').trim().replace(/^\/+/, '');
    if (!value) return '';
    if (value.indexOf('devmtg/events/') === 0) return value;
    if (value.indexOf('events/') === 0) return 'devmtg/events/' + value.slice('events/'.length);
    return 'devmtg/events/' + value;
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
    .map(normalizeEventPath)
    .filter(Boolean));

  var manifestPaths = [];
  var manifest = await fetchJson('devmtg/events/index.json');
  if (manifest && Array.isArray(manifest.eventFiles)) {
    manifestPaths = manifest.eventFiles.map(normalizeEventPath).filter(Boolean);
  } else if (manifest && Array.isArray(manifest.events)) {
    manifestPaths = manifest.events
      .map(function mapEvent(entry) {
        return normalizeEventPath(entry && (entry.file || entry.path));
      })
      .filter(Boolean);
  }

  var paths = uniquePaths(candidatePaths.concat(manifestPaths));

  for (var p = 0; p < paths.length; p += 1) {
    var bundle = await fetchJson(paths[p]);
    if (!bundle || !Array.isArray(bundle.talks)) continue;
    for (var i = 0; i < bundle.talks.length; i += 1) {
      var talk = bundle.talks[i];
      if (String((talk && talk.id) || '').trim() === targetId) {
        self.postMessage({ talk: talk });
        return;
      }
    }
  }

  self.postMessage({ talk: null });
};
