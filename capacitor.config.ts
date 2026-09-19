import type { CapacitorConfig } from '@capacitor/cli';

/** The host app wraps the same `web/` bundle that Firebase Hosting serves. */
const config: CapacitorConfig = {
  appId: 'com.jr07.bachelorquestionnaire',
  appName: 'Bachelor Questionnaire',
  webDir: 'web',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Google sign-in through the native sheet; the ID token is exchanged for our own session by the API.
    SocialLogin: { google: true, apple: false, facebook: false },
  },
};

export default config;
