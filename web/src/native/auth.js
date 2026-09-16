// Firebase Authentication through @capacitor-firebase/authentication on device;
// a dev sign-in (DEV_AUTH bearer) in the browser so the host app can be exercised without Firebase.
import { meta, setMeta } from '../store/idb.js';
import { isNative } from './device.js';

const plugin = () => globalThis.Capacitor?.Plugins?.FirebaseAuthentication ?? null;

export async function currentUser() {
  const p = plugin();
  if (p) {
    const { user } = await p.getCurrentUser();
    return user ? { uid: user.uid, name: user.displayName, provider: 'google' } : null;
  }
  return meta('devUser');
}

export async function signIn() {
  const p = plugin();
  if (p) {
    const isApple = /iPhone|iPad|Mac/i.test(globalThis.navigator?.userAgent ?? '');
    const { user } = isApple ? await p.signInWithApple() : await p.signInWithGoogle();
    return { uid: user.uid, name: user.displayName, provider: isApple ? 'apple' : 'google' };
  }
  const uid = globalThis.prompt('Development sign-in: pick a user id', 'dev-host');
  if (!uid) return null;
  const user = { uid: uid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'dev-host', name: 'Development host', provider: 'dev' };
  await setMeta('devUser', user);
  return user;
}

export async function signOut() {
  const p = plugin();
  if (p) await p.signOut();
  await setMeta('devUser', null);
}

/** Bearer token for the API. Native: a fresh Firebase ID token. Browser: the dev bearer. */
export async function idToken() {
  const p = plugin();
  if (p) {
    const { token } = await p.getIdToken({ forceRefresh: false });
    return token;
  }
  const user = await meta('devUser');
  return user ? `dev:${user.uid}` : null;
}

export const nativeAuth = () => Boolean(plugin()) || isNative();
