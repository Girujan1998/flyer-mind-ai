// Global test setup. Add mocks for native modules here as the app grows.
/* eslint-disable no-undef */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiBaseUrl: 'https://api.test',
        aiModel: 'claude-sonnet-5',
      },
    },
  },
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({ localUri: 'file:///sample.pdf', uri: 'file:///sample.pdf' }),
  },
}));
