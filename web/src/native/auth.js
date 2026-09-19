// Sign-in. Google proves who the organiser is exactly once; the API answers with our own 30-day session token
// and every later request carries only that. Three ways in:
//   - Android app: the native Google sheet through the Capacitor social-login plugin
//   - browser:     Google Identity Services (the rendered "Sign in with Google" button)
//   - local dev:   a prompt, accepted by an API started with DEV_AUTH=1
import { meta, setMeta } from '../store/idb.js';
import { createApi } from '../api.js';
import { isNative } from './device.js';

const plugin = () => globalThis.Capacitor?.Plugins?.SocialLogin ?? null;
const clientId = () => globalThis.GOOGLE_CLIENT_ID || '';
const api = () => createApi({});

export async function currentUser() {
  const session = await meta('session');
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < new Date().toISOString()) { await setMeta('session', null); return null; }
  return { uid: session.uid, name: session.name, provider: session.provider };
}

/** Bearer for the API: our session token, or the dev bearer. */
export async function idToken() {
  const session = await meta('session');
  return session?.token ?? null;
}

async function exchange(googleIdToken) {
  const res = await api().post('/auth/google', { idToken: googleIdToken });
  const session = { token: res.token, uid: res.uid, name: res.name, provider: 'google', expiresAt: res.expiresAt };
  await setMeta('session', session);
  return { uid: session.uid, name: session.name, provider: 'google' };
}

export const signInMode = () => (plugin() && isNative() ? 'native' : clientId() ? 'web' : 'dev');

/** Native and dev sign-in, started by a tap on our own button. */
export async function signIn() {
  if (signInMode() === 'native') {
    const p = plugin();
    await p.initialize({ google: { webClientId: clientId() } });
    const { result } = await p.login({ provider: 'google', options: { scopes: ['profile'] } });
    if (!result?.idToken) throw new Error('no_id_token');
    return exchange(result.idToken);
  }
  const uid = globalThis.prompt('Development sign-in: pick a user id', 'dev-host');
  if (!uid) return null;
  const clean = uid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'dev-host';
  await setMeta('session', { token: `dev:${clean}`, uid: clean, name: 'Development host', provider: 'dev', expiresAt: null });
  return { uid: clean, name: 'Development host', provider: 'dev' };
}

let gisLoading = null;
function loadGis() {
  if (globalThis.google?.accounts?.id) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => { gisLoading = null; reject(new Error('gis_unavailable')); };
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

/** Browser sign-in: Google draws its own button into `container` and calls back with an ID token. */
export async function mountGoogleButton(container, onSignedIn, onError) {
  await loadGis();
  globalThis.google.accounts.id.initialize({
    client_id: clientId(),
    auto_select: false,
    callback: async (response) => {
      try { onSignedIn(await exchange(response.credential)); } catch (err) { onError?.(err); }
    },
  });
  container.innerHTML = '';
  globalThis.google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', shape: 'pill', width: 280 });
}

export async function signOut() {
  const session = await meta('session');
  if (session?.token && !session.token.startsWith('dev:')) {
    try { await createApi({ getToken: async () => session.token }).post('/auth/signout', {}); } catch { /* offline: it expires on its own */ }
  }
  try { globalThis.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* not loaded */ }
  try { await plugin()?.logout?.({ provider: 'google' }); } catch { /* not signed in natively */ }
  await setMeta('session', null);
}
