import { unauthorized } from '../errors.js';

/**
 * Pub/Sub push and Cloud Scheduler call the API with an OIDC token for the service account named in
 * INTERNAL_SA_EMAIL and audience INTERNAL_AUDIENCE (the service URL). Dev: `Bearer dev:internal`.
 */
export async function verifyInternal(header: string | undefined): Promise<void> {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) throw unauthorized('internal_auth');
  const token = m[1].trim();
  if (process.env.DEV_AUTH === '1' && token === 'dev:internal') return;
  const audience = process.env.INTERNAL_AUDIENCE;
  const email = process.env.INTERNAL_SA_EMAIL;
  if (!audience || !email) throw unauthorized('internal_not_configured');
  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || payload.email !== email) throw new Error('wrong caller');
  } catch {
    throw unauthorized('internal_auth');
  }
}
