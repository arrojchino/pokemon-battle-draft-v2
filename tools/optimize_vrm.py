#!/usr/bin/env python3
"""
Optimize a VRM (0.x or 1.0) for the web without breaking VRM extensions.

General glTF optimizers rewrite node/texture indices and drop unknown extensions, which silently breaks
VRM humanoid, expression and spring-bone data. This tool only touches image payloads and the binary
buffer layout, so every index the VRM extensions reference stays valid.

  * Re-encodes textures as WebP via the standard EXT_texture_webp extension (alpha preserved).
  * Caps texture size (default 1024 px); the embedded thumbnail is reduced to 256 px.
  * Repacks the BIN chunk.

Usage:  python3 tools/optimize_vrm.py in.vrm out.vrm [--max 1024] [--quality 88]
Requires Pillow with WebP support (pip install pillow).
"""
import argparse, io, json, struct, sys
from PIL import Image

def read_glb(data):
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2: raise SystemExit('not a glTF 2.0 binary')
    off, chunks = 12, {}
    while off < length:
        clen, ctype = struct.unpack_from('<I4s', data, off)
        chunks[ctype] = data[off + 8: off + 8 + clen]
        off += 8 + clen
    return json.loads(chunks[b'JSON']), chunks.get(b'BIN\x00', b'')

def pad4(b, fill=b'\x00'): return b + fill * ((4 - len(b) % 4) % 4)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--max', type=int, default=1024); ap.add_argument('--quality', type=int, default=88)
    a = ap.parse_args()
    gltf, bin_ = read_glb(open(a.src, 'rb').read())
    views = gltf['bufferViews']
    image_views = {img['bufferView'] for img in gltf.get('images', []) if 'bufferView' in img}

    # Which image is the thumbnail? (VRM0: meta.texture is a texture index; VRM1: meta.thumbnailImage is an image index.)
    thumb = None
    ext = gltf.get('extensions', {})
    if 'VRM' in ext and ext['VRM'].get('meta', {}).get('texture', -1) >= 0:
        thumb = gltf['textures'][ext['VRM']['meta']['texture']]['source']
    if 'VRMC_vrm' in ext and 'thumbnailImage' in ext['VRMC_vrm'].get('meta', {}):
        thumb = ext['VRMC_vrm']['meta']['thumbnailImage']

    new_images = {}
    for i, img in enumerate(gltf.get('images', [])):
        bv = views[img['bufferView']]
        raw = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        im = Image.open(io.BytesIO(raw))
        im.load()
        limit = 256 if i == thumb else a.max
        if max(im.size) > limit:
            s = limit / max(im.size)
            im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
        mode = 'RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB'
        im = im.convert(mode)
        out = io.BytesIO()
        is_data = any(k in img.get('name', '').lower() for k in ('nml', 'normal', '_nm'))
        im.save(out, 'WEBP', quality=95 if is_data else a.quality, method=6, lossless=max(im.size) <= 16)
        new_images[i] = out.getvalue()
        img['mimeType'] = 'image/webp'

    # Rebuild BIN: non-image views keep their bytes, image views get the WebP payloads.
    blob = bytearray()
    view_for_image = {img['bufferView']: i for i, img in enumerate(gltf.get('images', []))}
    for vi, bv in enumerate(views):
        if vi in image_views: data = new_images[view_for_image[vi]]
        else: data = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        while len(blob) % 4: blob.append(0)
        bv['byteOffset'] = len(blob); bv['byteLength'] = len(data); bv['buffer'] = 0
        bv.pop('byteStride', None) if vi in image_views else None
        blob += data
    gltf['buffers'] = [{'byteLength': len(blob)}]

    # Standard EXT_texture_webp wiring (images keep their indices, so VRM references remain correct).
    for t in gltf.get('textures', []):
        if 'source' in t:
            t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': t.pop('source')}
    for key in ('extensionsUsed', 'extensionsRequired'):
        lst = gltf.setdefault(key, [])
        if 'EXT_texture_webp' not in lst: lst.append('EXT_texture_webp')

    js = pad4(json.dumps(gltf, separators=(',', ':')).encode(), b' ')
    bn = pad4(bytes(blob))
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(a.dst, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(bn), b'BIN\x00')); f.write(bn)
    print(f'{a.src}: {len(open(a.src, "rb").read()) / 1e6:.1f} MB -> {a.dst}: {total / 1e6:.1f} MB')

if __name__ == '__main__':
    sys.exit(main())
