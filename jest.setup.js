/* eslint-env jest */

jest.mock('react-native-document-picker', () => ({
  __esModule: true,
  default: {pickSingle: jest.fn(), pick: jest.fn()},
  pickSingle: jest.fn(),
  pick: jest.fn(),
  isCancel: () => false,
  isInProgress: () => false,
  types: {pdf: 'application/pdf', allFiles: '*/*'},
}));
