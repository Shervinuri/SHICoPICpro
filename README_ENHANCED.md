# SHICoPIC - Enhanced package

This package is an enhanced build of your original SHICoPIC project with improvements to the Netlify serverless function used for "prompt enhancement" / proxying.

## What I changed
- Replaced `enhance-prompt.js` Netlify function with a more robust implementation:
  - Built-in list of several free public proxy endpoints (used when `PROXIES` env var is not set).
  - Round-robin selection and temporary mark-down of failing proxies.
  - Retries with exponential backoff for network / 5xx errors.
  - Request timeout (default 20s).
  - CORS preflight support.
- Ensured `package.json` contains `node-fetch` dependency (v2) required by the function.
- Added this README note.

## How it behaves
- By default, the function uses a bundled list of public free proxies (these are unstable by nature).
- You can override proxies by setting an environment variable `PROXIES` (JSON array or CSV) in Netlify or your environment.
- If you prefer not to set anything on Netlify, no action is required — the function will work using the built-in proxies.

## Notes & cautions
- Public free proxies are unreliable and may be rate-limited or offline. For production use, consider a paid proxy/gateway or using your own proxy.
- If you are OK with exposing the API key publicly (you said it's public), you may continue to include it from the frontend; however storing keys in the server is still recommended.

## Files changed
- SHICoPIC-main/netlify/functions/enhance-prompt.js
- package.json

