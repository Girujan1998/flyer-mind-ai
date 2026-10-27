/* eslint-env jest */

// extract.ts imports AsyncStorage at module load (for the anonymous user id) —
// swap in the package's own jest mock so requireActual below doesn't hit the
// real native module.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Keep the pure helpers real; stub the network calls so mounting the screens in
// a test doesn't fire real requests (and doesn't update state after teardown).
jest.mock('./src/api/extract', () => {
  const actual = jest.requireActual('./src/api/extract');
  return {
    ...actual,
    searchProducts: jest.fn().mockResolvedValue({
      products: [],
      pages: [],
      total: 0,
      hasMore: false,
    }),
    fetchFilterFacets: jest.fn().mockResolvedValue({
      departments: [],
      stores: [],
      statuses: [],
      saleCount: 0,
      total: 0,
    }),
    extractFlyer: jest.fn().mockResolvedValue({}),
    sendChat: jest.fn().mockResolvedValue({
      reply: '',
      products: [],
      pages: [],
      terms: [],
      must: [],
    }),
  };
});

jest.mock('react-native-document-picker', () => ({
  __esModule: true,
  default: {pickSingle: jest.fn(), pick: jest.fn()},
  pickSingle: jest.fn(),
  pick: jest.fn(),
  isCancel: () => false,
  isInProgress: () => false,
  types: {pdf: 'application/pdf', allFiles: '*/*'},
}));
