export const REQUIRED_BACKEND_FEATURES = [
  "members.observe",
  "openai-oauth-proxy",
  "judge.model-select"
];

function trimBackendUrl(backendUrl) {
  return String(backendUrl || "http://127.0.0.1:8787").replace(/\/+$/u, "");
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) {
    return { ok: false, status: response.status, text: await response.text().catch(() => "") };
  }
  return { ok: true, status: response.status, json: await response.json() };
}

export async function backendCompatibility(backendUrl, fetchImpl = fetch) {
  const baseUrl = trimBackendUrl(backendUrl);
  try {
    const health = await fetchJson(fetchImpl, `${baseUrl}/health`);
    if (!health.ok) {
      return {
        ok: false,
        stale: false,
        reason: `backend health returned ${health.status}`,
        backendUrl: baseUrl
      };
    }

    const capabilities = await fetchJson(fetchImpl, `${baseUrl}/api/capabilities`);
    if (!capabilities.ok) {
      return {
        ok: false,
        stale: true,
        reason: `stale backend at ${baseUrl}: /api/capabilities returned ${capabilities.status}`,
        backendUrl: baseUrl,
        health: health.json
      };
    }

    const features = Array.isArray(capabilities.json?.features) ? capabilities.json.features : [];
    const missing = REQUIRED_BACKEND_FEATURES.filter((feature) => !features.includes(feature));
    if (missing.length) {
      return {
        ok: false,
        stale: true,
        reason: `stale backend at ${baseUrl}: missing features ${missing.join(", ")}`,
        backendUrl: baseUrl,
        health: health.json,
        capabilities: capabilities.json
      };
    }

    return {
      ok: true,
      stale: false,
      backendUrl: baseUrl,
      health: health.json,
      capabilities: capabilities.json
    };
  } catch (error) {
    return {
      ok: false,
      stale: false,
      reason: String(error?.message || error),
      backendUrl: baseUrl
    };
  }
}
