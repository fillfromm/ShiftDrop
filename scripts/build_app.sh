#!/usr/bin/env bash
# Builds a release binary and wraps it into build/ShiftDrop.app (menu-bar app, ad-hoc signed).
set -euo pipefail

cd "$(dirname "$0")/.."

swift build -c release

BIN_DIR="$(swift build -c release --show-bin-path)"
APP="build/ShiftDrop.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cp "$BIN_DIR/ShiftDrop" "$APP/Contents/MacOS/ShiftDrop"
cp Resources/Info.plist "$APP/Contents/Info.plist"

# Ad-hoc signature: enough to run locally. For distribution, sign with your Developer ID.
codesign --force --sign - "$APP"

echo "Built $APP"
echo "Run it with:  open $APP"
