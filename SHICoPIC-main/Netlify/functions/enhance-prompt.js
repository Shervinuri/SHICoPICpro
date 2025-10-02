/**
 * Enhanced Netlify Function: enhance-prompt.js
 * - Uses a list of fallback free proxies built-in (used if process.env.PROXIES not set)
 * - Round-robin selection with temporary mark-down for failing proxies
 * - Retry with exponential backoff for network/5xx errors
 * - Timeout wrapper
 *
 * NOTE:
 * - This function is intentionally permissive: if you want to override proxies, set process.env.PROXIES
 *   to a JSON array or comma-separated list of proxy base URLs (each should accept a full URL appended).
 * - For production, prefer more reliable proxies or a paid gateway.
 */

const fetch = require('node-fetch'); // ensure node-fetch v2 is installed in package.json

// Built-in default proxy list (free-ish public proxies / CORS helpers).
// These are best-effort; public free proxies are often unstable. You can override via PROXIES env var.
const DEFAULT_PROXIES = [
  // Examples of common CORS proxies or HTTP proxies that accept request URL appended.
  // NOTE: availability changes over time.
  "https://cors.bridged.cc/",
  "https://api.allorigins.win/raw?url=",
  "https://api.allorigins.cf/raw?url=",
  "https://thingproxy.freeboard.io/fetch/",
  "https://api.codetabs.cn/proxy?quest=",
  "https://cors-anywhere.herokuapp.com/",
  "https://proxy.cors.sh/",
  "https://yacdn.org/proxy/"
];

// CONFIG - adjustable via environment variables if desired
const RAW_PROXIES = process.env.PROXIES || null;
let PROXIES = [];
if (RAW_PROXIES) {
  try {
    PROXIES = JSON.parse(RAW_PROXIES);
    if (!Array.isArray(PROXIES)) throw new Error("PROXIES is not an array");
  } catch (e) {
    // fallback: treat as CSV
    PROXIES = RAW_PROXIES.split(",").map(s => s.trim()).filter(Boolean);
  }
}
if (!PROXIES || PROXIES.length === 0) {
  PROXIES = DEFAULT_PROXIES.slice();
}

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000); // 20s
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 4);
const BACKOFF_BASE_MS = Number(process.env.BACKOFF_BASE_MS || 400); // initial backoff
const PROXY_MARK_DOWN_MS = Number(process.env.PROXY_MARK_DOWN_MS || 45_000); // 45s

// in-memory proxy health map { proxyUrl: { downUntil: timestamp } }
const proxyHealth = {};
let proxyIndex = -1;

function now() { return Date.now(); }
function pickNextProxy() {
  const n = PROXIES.length;
  if (n === 0) return null;
  // round-robin starting from next
  for (let i = 0; i < n; i++) {
    proxyIndex = (proxyIndex + 1) % n;
    const candidate = PROXIES[proxyIndex];
    const st = proxyHealth[candidate];
    if (!st || (st.downUntil || 0) <= now()) {
      return candidate;
    }
  }
  // all down
  return null;
}

function markProxyDown(proxyUrl) {
  proxyHealth[proxyUrl] = { downUntil: now() + PROXY_MARK_DOWN_MS };
}

function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
  ]);
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Only POST allowed' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    // payload expected: { targetUrl, method?, headers?, body? }
    const { targetUrl, method = 'POST', headers = {}, body: reqBody } = payload;
    if (!targetUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'targetUrl required' }) };
    }

    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const proxy = pickNextProxy(); // may be null if none healthy
      const useProxy = !!proxy;
      // Some proxies expect the target full URL appended as query param (we assume proxies in list already include proper suffix like ?url= or raw?url=).
      // If proxy ends with '=' or 'fetch/' we simply append the targetUrl; else we append targetUrl assuming proxy can pass-through.
      let finalUrl;
      if (useProxy) {
        finalUrl = proxy + targetUrl;
      } else {
        finalUrl = targetUrl;
      }

      const fetchOpts = {
        method,
        headers,
        body: (reqBody && typeof reqBody === 'object') ? JSON.stringify(reqBody) : reqBody,
      };

      const start = Date.now();
      try {
        const res = await fetchWithTimeout(finalUrl, fetchOpts, REQUEST_TIMEOUT_MS);
        const latency = Date.now() - start;

        if (!res.ok) {
          const status = res.status;
          const text = await res.text().catch(()=>'<no body>');
          lastError = { status, text, proxy: proxy || null, latency };

          // mark unreliable proxies on server errors and network failures
          if (useProxy && status >= 500 && status < 600) {
            markProxyDown(proxy);
            await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, attempt)));
            continue; // try next proxy
          }

          // client errors: return directly
          return {
            statusCode: status,
            body: JSON.stringify({ error: 'Upstream returned error', details: text }),
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          };
        }

        // success: attempt to parse JSON, else text
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const responseBody = await res.json();
          return {
            statusCode: 200,
            body: JSON.stringify({ success: true, proxy: proxy || null, latency, data: responseBody }),
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          };
        } else {
          const text = await res.text();
          return {
            statusCode: 200,
            body: JSON.stringify({ success: true, proxy: proxy || null, latency, data: text }),
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          };
        }

      } catch (err) {
        lastError = { error: err.message, proxy: proxy || null, attempt };
        if (useProxy) {
          markProxyDown(proxy);
        }
        // backoff
        await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, attempt)));
        continue;
      }
    }

    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'All attempts failed', lastError }),
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    };

  } catch (e) {
    console.error('enhance-prompt error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: String(e) }),
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    };
  }
};
