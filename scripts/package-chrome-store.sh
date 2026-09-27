#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node scripts/preflight-chrome-store.mjs

VERSION="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("manifest.json","utf8")).version)')"
DIST="$ROOT/dist"
STAGE="$DIST/nano-seo-lab-$VERSION"
ZIP="$DIST/nano-seo-lab-$VERSION.zip"

RUNTIME_FILES=(
  manifest.json
  db.js
  defaults.js
  service_worker.js
  offscreen.html
  offscreen.js
  sidepanel.html
  sidepanel.js
  options.html
  options.js
  history.html
  history.js
  logs.html
  logs.js
  help.html
  styles.css
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/icons"

for file in "${RUNTIME_FILES[@]}"; do
  mkdir -p "$STAGE/$(dirname "$file")"
  cp "$file" "$STAGE/$file"
done

(
  cd "$STAGE"
  zip -qr "$ZIP" .
)

echo
echo "Chrome Web Store package:"
echo "$ZIP"
echo
echo "Contents:"
unzip -l "$ZIP"
