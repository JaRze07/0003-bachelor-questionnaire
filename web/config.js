// Runtime configuration. The deployment overwrites this file (deploy/README.md); the defaults below are for
// local development, where the API runs on :8080 with DEV_AUTH=1 and sign-in is a prompt.
globalThis.API_BASE = globalThis.API_BASE || (location.port === '5173' ? 'http://localhost:8080' : location.origin);
globalThis.GOOGLE_CLIENT_ID = globalThis.GOOGLE_CLIENT_ID || '';
