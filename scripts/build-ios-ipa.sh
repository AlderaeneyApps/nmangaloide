#!/usr/bin/env bash
#
# Builds an unsigned iOS .ipa without an Apple developer account.
#
# The Xcode project/target/scheme is "App" (Capacitor default), so xcodebuild
# produces App.app; it is packaged as Payload/App.app inside the .ipa.
# The resulting IPA is unsigned and must be signed on install, e.g. with
# AltStore, SideStore, Sideloadly or TrollStore.
#
# Usage: scripts/build-ios-ipa.sh [--skip-web] [--configuration Release|Debug]

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/App"
PROJECT="$IOS_DIR/App.xcodeproj"
SCHEME="App"
APP_NAME="App"
CONFIGURATION="Release"
SKIP_WEB=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-web) SKIP_WEB=1; shift ;;
    --configuration|-c) CONFIGURATION="$2"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
BUILD_DIR="$IOS_DIR/build"
DERIVED_DATA="$BUILD_DIR/DerivedData"
OUTPUT_DIR="$IOS_DIR/output"
IPA_PATH="$OUTPUT_DIR/nMangaloide-$VERSION-unsigned.ipa"

cd "$ROOT_DIR"

if [[ $SKIP_WEB -eq 0 ]]; then
  echo "==> Building web assets"
  npm run build:native
  echo "==> Syncing Capacitor iOS project"
  npx cap sync ios
fi

echo "==> Building $SCHEME ($CONFIGURATION) without code signing"
rm -rf "$DERIVED_DATA"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  DEVELOPMENT_TEAM="" \
  build

APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION-iphoneos/$APP_NAME.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "error: $APP_PATH not found" >&2
  exit 1
fi

echo "==> Packaging IPA"
STAGING="$BUILD_DIR/ipa"
rm -rf "$STAGING"
mkdir -p "$STAGING/Payload" "$OUTPUT_DIR"
cp -R "$APP_PATH" "$STAGING/Payload/"
rm -f "$IPA_PATH"
(cd "$STAGING" && zip -qry "$IPA_PATH" Payload)
rm -rf "$STAGING"

echo "==> Done: $IPA_PATH"
