// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const config = getDefaultConfig(__dirname);

// The Express extraction API in server/ has its own package.json / node_modules;
// keep Metro out of it so it doesn't try to watch or resolve those.
config.resolver.blockList = exclusionList([/\/server\/.*/]);

// Bundle the sample flyer PDF as an asset (assets/sample-flyer.pdf).
config.resolver.assetExts.push('pdf');

module.exports = config;
