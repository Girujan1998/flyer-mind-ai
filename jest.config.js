module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The single smoke test mounts the whole app. It runs in ~0.3s locally, but a
  // cold CI runner transforms + evaluates the react-native module graph lazily
  // during that first render and can take several seconds — well past Jest's 5s
  // default. Give it real headroom so CI isn't flaky.
  testTimeout: 30000,
};
