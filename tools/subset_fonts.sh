#!/usr/bin/env bash
# Regenerate the subset UI fonts. The Latin ranges cover every shipped language (English and Spanish).
# Needs: pip install fonttools  (add brotli and switch --flavor=woff2 for ~30% smaller files)
# Source TTFs: https://github.com/google/fonts (ofl/chakrapetch, ofl/manrope)
set -euo pipefail
SRC="${1:?usage: tools/subset_fonts.sh /path/to/google-fonts/ofl}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/frontend/src/assets/fonts"
LATIN="U+0020-007E,U+00A0-017F,U+2013-2026,U+2190-2193,U+00D7"
for w in Medium SemiBold Bold; do
  pyftsubset "$SRC/chakrapetch/ChakraPetch-$w.ttf" --unicodes="$LATIN" --flavor=woff --layout-features='*' --output-file="$OUT/chakra-petch-$(echo "$w" | tr A-Z a-z).woff"
done
pyftsubset "$SRC/manrope/Manrope[wght].ttf" --unicodes="$LATIN" --flavor=woff --layout-features='*' --output-file="$OUT/manrope-var.woff"
echo "fonts written to $OUT"
