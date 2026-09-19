// Google sign-in: verify an ID token issued to one of our OAuth clients (web and Android share the API).
import { unauthorized } from '../errors.js';

export interface GoogleIdentity { sub: string; email?: string; name?: string }
export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

/** GOOGLE_CLIENT_IDS = comma-separated OAuth client ids (web, Android). */
export function createGoogleVerifier(): GoogleVerifier {
  const audiences = (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let client: import('google-auth-library').OAuth2Client | null = null;
  return async (idToken) => {
    if (!audiences.length) throw unauthorized('google_not_configured');
    if (!client) {
      const { OAuth2Client } = await import('google-auth-library');
      client = new OAuth2Client();
    }
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: audiences });
      const p = ticket.getPayload();
      if (!p?.sub) throw new Error('no subject');
      return { sub: p.sub, email: p.email_verified ? p.email : undefined, name: p.name };
    } catch {
      throw unauthorized('invalid_google_token');
    }
  };
}
