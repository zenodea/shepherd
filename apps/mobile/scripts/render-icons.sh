#!/usr/bin/env bash
# Renders assets/icon-src/*.svg into the PNGs app.json uses, with headless Chrome.
# Only needed after editing the SVGs; the PNGs are committed.
set -euo pipefail
cd "$(dirname "$0")/../assets"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# render <out.png> <size> <svg layers...>
render() {
  local out="$1" size="$2"; shift 2
  local layers=""
  for svg in "$@"; do layers+="<img src=\"file://$PWD/icon-src/$svg\" style=\"position:absolute;inset:0;width:100%;height:100%\">"; done
  printf '<!doctype html><html><body style="margin:0;background:transparent"><div style="position:relative;width:%spx;height:%spx">%s</div></body></html>' "$size" "$size" "$layers" > "$tmp/page.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$size,$size" --screenshot="$PWD/$out" "file://$tmp/page.html" >/dev/null 2>&1
  echo "rendered $out"
}

render icon.png 1024 background.svg foreground.svg
render android-icon-foreground.png 512 foreground.svg
render android-icon-background.png 512 background.svg
render android-icon-monochrome.png 432 monochrome.svg
render splash-icon.png 1024 foreground.svg
