#!/usr/bin/env bash
# Regenerate the subset UI fonts. Run after adding Japanese UI text so new glyphs are included.
# Needs: pip install fonttools  (add brotli and switch --flavor=woff2 for ~30% smaller files)
# Source TTFs: https://github.com/google/fonts (ofl/chakrapetch, ofl/manrope, ofl/zenkakugothicnew)
set -euo pipefail
SRC="${1:?usage: tools/subset_fonts.sh /path/to/google-fonts/ofl}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/frontend/src/assets/fonts"
LATIN="U+0020-007E,U+00A0-017F,U+2013-2026,U+2190-2193,U+00D7"
JP_CHARS="$(cd "$ROOT/frontend" && python3 -c "import glob;print(''.join(sorted({c for f in glob.glob('src/**/*.ts*',recursive=True) for c in open(f,encoding='utf8').read() if ord(c)>0x2e80})))")"
pyftsubset "$SRC/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf" --text="$JP_CHARS" --unicodes=U+0020-007E --flavor=woff --layout-features='*' --output-file="$OUT/zen-kaku-jp-700.woff"
for w in Medium SemiBold Bold; do
  pyftsubset "$SRC/chakrapetch/ChakraPetch-$w.ttf" --unicodes="$LATIN" --flavor=woff --layout-features='*' --output-file="$OUT/chakra-petch-$(echo "$w" | tr A-Z a-z).woff"
done
pyftsubset "$SRC/manrope/Manrope[wght].ttf" --unicodes="$LATIN" --flavor=woff --layout-features='*' --output-file="$OUT/manrope-var.woff"
echo "fonts written to $OUT"
