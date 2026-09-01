#!/usr/bin/env bash
# Build an UNSIGNED .ipa of the app locally.
#
# Requirements (none of which this project's original dev machine met):
#   - macOS 13.5+ with Xcode 15+  (React Native 0.74 needs Xcode >= 14.3, and
#     its C++20 code needs the libc++ that ships with Xcode 15)
#   - CocoaPods >= 1.13           (RN 0.74's podspecs use the `visionos` DSL)
#   - Node 18+, and `npm install` already run
#
# The result is a genuinely unsigned .ipa (Payload/<app>.app zipped, no code
# signature). It installs only on a jailbroken device or after you re-sign it
# (e.g. with a free Apple ID via Xcode, `codesign`, or a tool like `ios-deploy`).
# For a normal signed build use EAS: `npx eas-cli build -p ios --profile preview`.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SCHEME="FlyerMindAI"
WORKSPACE="ios/${SCHEME}.xcworkspace"
DERIVED="$ROOT/ios/build"
OUT="$ROOT/build-ipa"

echo "==> expo prebuild (regenerates ios/)"
npx expo prebuild --platform ios --clean

echo "==> pod install"
( cd ios && pod install )

echo "==> xcodebuild (Release, iphoneos, signing disabled)"
rm -rf "$DERIVED"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  build

APP="$DERIVED/Build/Products/Release-iphoneos/${SCHEME}.app"
[ -d "$APP" ] || { echo "build produced no .app at $APP" >&2; exit 1; }

echo "==> packaging unsigned .ipa"
rm -rf "$OUT" && mkdir -p "$OUT/Payload"
cp -R "$APP" "$OUT/Payload/"
( cd "$OUT" && zip -qry "${SCHEME}-unsigned.ipa" Payload && rm -rf Payload )

echo "==> done: $OUT/${SCHEME}-unsigned.ipa"
ls -lh "$OUT/${SCHEME}-unsigned.ipa"
