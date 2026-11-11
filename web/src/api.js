// Fetch client. Adds the auth header, maps errors, flags offline, supports ETags.

/**
 * `offline` means "the server could not be reached", whatever the reason: no network (status 0), or the proxy in
 * front of the API answering for a container that is down or restarting (502, 503, 504). The app treats both the
 * same way: keep playing from the device, keep what is queued, try again later.
 */
const UNREACHABLE = new Set([0, 502, 503, 504]);

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code || `HTTP ${status}`);
    this.status = status; this.code = code; this.details = details;
    this.offline = UNREACHABLE.has(status);
  }
}

export const DEFAULT_TIMEOUT_MS = 12000;

export function createApi({ baseUrl, getToken, gameToken, onUnauthorized, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = (baseUrl || globalThis.API_BASE || 'http://localhost:8080').replace(/\/+$/, '');

  async function request(method, path, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (gameToken) headers['X-Game-Token'] = gameToken;
    // A captive portal or a half-open socket must look like "offline", not like a frozen app.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(`${base}/v1${path}`, {
        method, headers, signal: controller?.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'offline', 'No connection');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 204 || res.status === 304) return { status: res.status };
    const text = await res.text();
    let payload = {};
    // An error page from the proxy is not JSON; it must surface as that HTTP error, not as a parse failure.
    try { payload = text ? JSON.parse(text) : {}; } catch { if (res.ok) throw new ApiError(res.status, 'bad_response', 'Unreadable response'); }
    if (!res.ok) {
      // A dead session (signed out elsewhere, expired) sends the organiser back to sign-in instead of failing every call.
      if (res.status === 401 && onUnauthorized) { try { onUnauthorized(payload.error?.code); } catch { /* ignore */ } }
      throw new ApiError(res.status, payload.error?.code, payload.error?.message, payload.error?.details);
    }
    payload.__etag = res.headers.get('etag') || undefined;
    return payload;
  }

  return {
    request,
    get: (path, headers) => request('GET', path, undefined, headers),
    post: (path, body) => request('POST', path, body ?? {}),
    put: (path, body) => request('PUT', path, body ?? {}),
    patch: (path, body) => request('PATCH', path, body ?? {}),
    del: (path) => request('DELETE', path),
    baseUrl: base,
  };
}
