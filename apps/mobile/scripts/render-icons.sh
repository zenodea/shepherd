#!/usr/bin/env bash
# Renders assets/icon-src/*.svg into the PNGs app.json uses, with headless Chrome.
# Only needed after editing the SVGs; the PNGs are committed.
#
# art.svg is drawn full-bleed (it's what you see on a square icon). Android's
# adaptive icons show only the middle 72 of 108dp, so there it's scaled to 2/3.
set -euo pipefail
cd "$(dirname "$0")/../assets"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# render <out.png> <size> <radius%> <svg[:scale]>...
render() {
  local out="$1" size="$2" radius="$3"; shift 3
  local layers=""
  for layer in "$@"; do
    local svg="${layer%%:*}" scale="1"
    [[ "$layer" == *:* ]] && scale="${layer##*:}"
    layers+="<img src=\"file://$PWD/icon-src/$svg\" style=\"position:absolute;inset:0;width:100%;height:100%;transform:scale($scale)\">"
  done
  printf '<!doctype html><html><body style="margin:0;background:transparent"><div style="position:relative;width:%spx;height:%spx;overflow:hidden;border-radius:%s%%">%s</div></body></html>' \
    "$size" "$size" "$radius" "$layers" > "$tmp/page.html"
  rm -f "$out"
  # Chrome can exit non-zero after writing the screenshot, so check the file instead.
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$size,$size" --screenshot="$PWD/$out" "file://$tmp/page.html" >/dev/null 2>&1 || true
  [[ -s "$out" ]] || { echo "failed to render $out" >&2; exit 1; }
  echo "rendered $out"
}

SAFE=0.6667
render icon.png 1024 0 background.svg art.svg
render android-icon-foreground.png 512 0 "art.svg:$SAFE"
render android-icon-background.png 512 0 background.svg
render android-icon-monochrome.png 432 0 "monochrome.svg:$SAFE"
# The splash shows the icon itself, rounded like a launcher icon.
render splash-icon.png 1024 22 background.svg art.svg
