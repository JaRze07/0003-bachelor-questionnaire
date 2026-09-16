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
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com', 'apple.com'],
    },
  },
};

export default config;
