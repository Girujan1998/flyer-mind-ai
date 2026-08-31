module.exports = {
  root: true,
  extends: ['expo', 'prettier'],
  ignorePatterns: ['/dist/*', '/node_modules/*', '/.expo/*'],
  rules: {
    'import/order': 'warn',
  },
};
