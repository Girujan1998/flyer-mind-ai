import Constants from 'expo-constants';

type Extra = {
  apiBaseUrl: string;
  aiModel: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

/**
 * Runtime configuration.
 *
 * Non-secret values live in `app.json` under `expo.extra` and can be overridden
 * per-environment with EAS build profiles. Secrets (API keys) must never be
 * bundled into the client — proxy AI calls through your own backend.
 */
export const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? 'https://api.example.com',
  aiModel: process.env.EXPO_PUBLIC_AI_MODEL ?? extra.aiModel ?? 'claude-sonnet-5',
  isDev: __DEV__,
} as const;

export type Env = typeof env;
