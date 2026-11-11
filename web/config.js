// Runtime configuration, local development only: the API runs on :8080 with DEV_AUTH=1 and sign-in is a prompt.
// The deployed server answers /config.js itself from its environment (api/src/server.ts), and the Android
// release workflow writes its own copy into the bundle, so this file never reaches a user.
globalThis.API_BASE = globalThis.API_BASE || (location.port === '5173' ? 'http://localhost:8080' : location.origin);
globalThis.GOOGLE_CLIENT_ID = globalThis.GOOGLE_CLIENT_ID || '';
