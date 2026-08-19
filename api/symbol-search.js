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
// NOTE: repo_key values below (mulberry, twemoji, tawasol, coughdrop)
// are our best expectation based on OpenSymbols' documented library list —
// worth confirming against a live search result (each result includes
// "repo_key") before relying on this filter in production.

const ALLOWED_REPOS = ['mulberry', 'twemoji', 'tawasol', 'coughdrop'];

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
    const searchUrl = 'https://www.opensymbols.org/api/v2/symbols'
      + '?access_token=' + encodeURIComponent(token)
      + '&q=' + encodeURIComponent(q)
      + '&locale=' + encodeURIComponent(locale)
      + '&safe=1';

    const resp = await fetch(searchUrl);

    if (resp.status === 401) {
      // Token expired between our cache check and this call — retry once with a fresh token
      cachedToken = null;
      const freshToken = await getAccessToken();
      const retryUrl = searchUrl.replace(/access_token=[^&]+/, 'access_token=' + encodeURIComponent(freshToken));
      const retryResp = await fetch(retryUrl);
      if (!retryResp.ok) throw new Error('OpenSymbols search failed after retry (' + retryResp.status + ')');
      const retryResults = await retryResp.json();
      return res.status(200).json(filterResults(retryResults));
    }

    if (!resp.ok) {
      throw new Error('OpenSymbols search failed (' + resp.status + ')');
    }

    const results = await resp.json();
    return res.status(200).json(filterResults(results));

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
