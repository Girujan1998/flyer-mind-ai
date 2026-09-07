#!/usr/bin/env bash
# Build a release APK. Output: build-artifacts/FlyerMindAI-release.apk
#
# `assembleRelease` with no signingConfig produces an *unsigned* release APK
# (app-release-unsigned.apk). `assembleDebug` instead produces a debug APK
# already signed with the auto-generated debug keystore — pass `debug` as $1
# for something installable without extra steps.
#
# Requires: Android SDK (platform 34, build-tools 34.0.0) and JDK 17.

set -euo pipefail
cd "$(dirname "$0")/.."

VARIANT="${1:-release}"          # release | debug
OUT="build-artifacts"

# RN 0.73 / AGP 8.1 need JDK 17; fall back to Homebrew's if JAVA_HOME is older.
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"17'; then
  for d in /opt/homebrew/opt/openjdk@17 /usr/local/opt/openjdk@17 \
           "$(/usr/libexec/java_home -v 17 2>/dev/null || true)"; do
    [ -x "$d/bin/java" ] && export JAVA_HOME="$d" && break
  done
fi
echo "==> JAVA_HOME=${JAVA_HOME:-<system>}"

case "$VARIANT" in
  release) TASK="assembleRelease"; APK_GLOB="android/app/build/outputs/apk/release/*.apk" ;;
  debug)   TASK="assembleDebug";   APK_GLOB="android/app/build/outputs/apk/debug/*.apk" ;;
  *) echo "usage: $0 [release|debug]" >&2; exit 2 ;;
esac

echo "==> ./gradlew $TASK"
( cd android && ./gradlew "$TASK" --no-daemon )

APK=$(ls -t $APK_GLOB | head -1)
[ -f "$APK" ] || { echo "no APK produced" >&2; exit 1; }

mkdir -p "$OUT"
cp "$APK" "$OUT/FlyerMindAI-${VARIANT}.apk"
echo "==> done: $OUT/FlyerMindAI-${VARIANT}.apk"
ls -lh "$OUT/FlyerMindAI-${VARIANT}.apk"
