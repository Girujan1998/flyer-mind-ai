#!/usr/bin/env bash
# Build an UNSIGNED .ipa (Release, device). Output: build-artifacts/FlyerMindAI-unsigned.ipa
#
# Works with the toolchain this project targets: Xcode 13.4+ / CocoaPods 1.12+.
# The .ipa has no code signature — install on a jailbroken device or re-sign it.
# For a signed build use an Apple Developer account + Xcode's archive/export.

set -euo pipefail
cd "$(dirname "$0")/.."

SCHEME="FlyerMindAI"
WORKSPACE="ios/${SCHEME}.xcworkspace"
DERIVED="ios/build"
OUT="build-artifacts"

if [ ! -d "ios/Pods" ]; then
  echo "==> pod install"
  ( cd ios && NO_FLIPPER=1 pod install )
fi

echo "==> xcodebuild (Release, iphoneos, signing disabled)"
rm -rf "$DERIVED"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" CODE_SIGN_ENTITLEMENTS="" \
  ENABLE_BITCODE=NO \
  build

APP="$DERIVED/Build/Products/Release-iphoneos/${SCHEME}.app"
[ -d "$APP" ] || { echo "no .app at $APP" >&2; exit 1; }

echo "==> packaging unsigned .ipa"
rm -rf "$OUT/Payload" && mkdir -p "$OUT/Payload"
cp -R "$APP" "$OUT/Payload/"
( cd "$OUT" && zip -qry "${SCHEME}-unsigned.ipa" Payload && rm -rf Payload )

echo "==> done: $OUT/${SCHEME}-unsigned.ipa"
ls -lh "$OUT/${SCHEME}-unsigned.ipa"
