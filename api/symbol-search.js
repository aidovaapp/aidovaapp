// Proxies searches to the OpenSymbols API.
// The shared secret lives ONLY here (server-side, via Vercel env var
// OPENSYMBOLS_SECRET) — it must never reach client-side JS.
//
// Only symbols from commercially-safe libraries are returned, since
// Aidova has paid tiers and some OpenSymbols libraries (ARASAAC, Sclera)
// are licensed non-commercial-only (CC BY-NC-SA / CC BY-NC).
// If/when ARASAAC grants separate commercial permission, 'arasaac' can
// be added to ALLOWED_REPOS below.
//
// NOTE: repo_key values below (mulberry, tawasol, coughdrop)
// are our best expectation based on OpenSymbols' documented library list —
// worth confirming against a live search result (each result includes
// "repo_key") before relying on this filter in production.

// Twemoji deliberately excluded: it's Twitter's own emoji set, not a real AAC
// pictogram system — still gendered faces, skin tones, and stylistic detail
// that proper AAC symbols (Mulberry, Tawasol) are specifically designed to
// avoid, so including it defeated the purpose of moving away from emoji.
const ALLOWED_REPOS = ['mulberry', 'tawasol', 'coughdrop'];

let cachedToken = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 4 * 60 * 1000; // refresh well before any short-lived expiry

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && (now - cachedTokenAt) < TOKEN_TTL_MS) {
    return cachedToken;
  }
  const resp = await fetch('https://www.opensymbols.org/api/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'secret=' + encodeURIComponent(process.env.OPENSYMBOLS_SECRET)
  });
  if (!resp.ok) {
    throw new Error('Failed to get OpenSymbols access token (' + resp.status + ')');
  }
  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenAt = now;
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = (req.query.q || '').trim();
  const locale = (req.query.locale || 'en').trim();

  if (!q) {
    return res.status(400).json({ error: 'Missing search term (q)' });
  }

  try {
    const token = await getAccessToken();

    // Search each allowed library separately (using OpenSymbols' "repo:" query
    // filter) and combine the results. A single mixed search mostly returns
    // results from libraries we don't allow (arasaac, twemoji, etc.), which
    // then get discarded — searching per-repo means every result we fetch is
    // actually usable, giving reviewers far more real choices per word.
    const searches = await Promise.all(ALLOWED_REPOS.map(function (repo) {
      const searchUrl = 'https://www.opensymbols.org/api/v2/symbols'
        + '?access_token=' + encodeURIComponent(token)
        + '&q=' + encodeURIComponent(q + ' repo:' + repo)
        + '&locale=' + encodeURIComponent(locale)
        + '&safe=1';
      return fetch(searchUrl).then(function (resp) {
        if (resp.status === 401) return { needsRetry: true, repo: repo };
        if (!resp.ok) return [];
        return resp.json();
      }).catch(function () { return []; });
    }));

    // If any individual search hit an expired token, refresh once and retry those
    const needsRetry = searches.some(function (r) { return r && r.needsRetry; });
    let finalResults;
    if (needsRetry) {
      cachedToken = null;
      const freshToken = await getAccessToken();
      const retried = await Promise.all(ALLOWED_REPOS.map(function (repo) {
        const retryUrl = 'https://www.opensymbols.org/api/v2/symbols'
          + '?access_token=' + encodeURIComponent(freshToken)
          + '&q=' + encodeURIComponent(q + ' repo:' + repo)
          + '&locale=' + encodeURIComponent(locale)
          + '&safe=1';
        return fetch(retryUrl).then(function (resp) { return resp.ok ? resp.json() : []; }).catch(function () { return []; });
      }));
      finalResults = retried;
    } else {
      finalResults = searches;
    }

    const combined = [].concat.apply([], finalResults.filter(function (r) { return Array.isArray(r); }));
    return res.status(200).json(filterResults(combined));

  } catch (err) {
    console.error('Symbol search error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function filterResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter(function (r) { return ALLOWED_REPOS.indexOf(r.repo_key) !== -1; })
    .map(function (r) {
      return {
        id: r.id,
        name: r.name,
        image_url: r.image_url,
        repo_key: r.repo_key,
        license: r.license,
        author: r.author,
        author_url: r.author_url
      };
    });
}
