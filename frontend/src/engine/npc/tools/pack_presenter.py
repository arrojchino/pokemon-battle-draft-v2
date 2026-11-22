#!/usr/bin/env python3
"""Pack the Pokémon Center presenter NPC asset (frontend/public/npc/presenter.vrm).

Source model (CC0): "β Ver AvatarSample_4" (VRM title "Victoria Rubin") by pixiv Inc., a VRoid Studio
sample model. License page: https://vroid.pixiv.help/hc/en-us/articles/360014900233
("The CC license* for this model is CC0. This model can be edited and used freely.")
File used: https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Victoria_Rubin.vrm
(its VRM meta says title "Victoria Rubin", licenseName "CC0", exporter VRoidStudio-0.8.1).

What this does, leaving every VRM extension, node, skin and expression untouched:
  * recolours the dress texture into a Pokémon Center uniform: the cream bodice and over-skirt become
    white, the lilac pinks turn a warmer rose, the cravat turns Poké Ball red (gold trims stay);
  * downsizes textures (colour <= 1024 px, normal maps 512/256 px, a 256 px JPEG thumbnail);
  * drops morph-target normals (expressions keep their shapes; toon shading barely changes);
  * rewrites the GLB binary chunk with the new images and a compact buffer layout.
gltf-transform is not used on purpose: it drops the unknown VRM extension.

Usage: python pack_presenter.py <Victoria_Rubin.vrm> <presenter.vrm> [--preview <dir>]
Needs numpy and Pillow.
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942


# ------------------------------------------------------------------ GLB io
def read_glb(path):
    b = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<4sII', b, 0)
    assert magic == b'glTF' and version == 2, 'not a glTF 2 binary'
    off, js, binb = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', b, off)
        data = b[off + 8: off + 8 + clen]
        if ctype == JSON_CHUNK:
            js = json.loads(data.decode('utf8'))
        elif ctype == BIN_CHUNK:
            binb = data
        off += 8 + clen
    return js, binb


def write_glb(path, js, binb):
    jb = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    binb = bytes(binb) + b'\0' * ((4 - len(binb) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack('<II', len(jb), JSON_CHUNK))
        f.write(jb)
        f.write(struct.pack('<II', len(binb), BIN_CHUNK))
        f.write(binb)


def view_bytes(js, binb, bv_index):
    bv = js['bufferViews'][bv_index]
    o = bv.get('byteOffset', 0)
    return binb[o: o + bv['byteLength']]


def repack(js, binb, image_data):
    """Drop unreferenced accessors/bufferViews, swap image bytes, lay the binary chunk out again."""
    used_acc = set()
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            used_acc.update(prim['attributes'].values())
            if 'indices' in prim:
                used_acc.add(prim['indices'])
            for t in prim.get('targets', []):
                used_acc.update(t.values())
    for skin in js.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used_acc.add(skin['inverseBindMatrices'])
    for anim in js.get('animations', []):
        for s in anim['samplers']:
            used_acc.update((s['input'], s['output']))
    acc_order = sorted(used_acc)
    acc_map = {old: new for new, old in enumerate(acc_order)}

    used_bv = set()
    for i in acc_order:
        a = js['accessors'][i]
        if 'bufferView' in a:
            used_bv.add(a['bufferView'])
        sp = a.get('sparse')
        if sp:
            used_bv.update((sp['indices']['bufferView'], sp['values']['bufferView']))
    image_bv = {}
    for i, im in enumerate(js.get('images', [])):
        if 'bufferView' in im:
            used_bv.add(im['bufferView'])
            image_bv[im['bufferView']] = i
    bv_order = sorted(used_bv)
    bv_map = {old: new for new, old in enumerate(bv_order)}

    out = bytearray()
    new_bvs = []
    for old in bv_order:
        bv = dict(js['bufferViews'][old])
        if old in image_bv and image_bv[old] in image_data:
            data = image_data[image_bv[old]]
        else:
            data = view_bytes(js, binb, old)
        out += b'\0' * ((4 - len(out) % 4) % 4)
        bv['buffer'] = 0
        bv['byteOffset'] = len(out)
        bv['byteLength'] = len(data)
        out += data
        new_bvs.append(bv)

    new_acc = []
    for old in acc_order:
        a = dict(js['accessors'][old])
        if 'bufferView' in a:
            a['bufferView'] = bv_map[a['bufferView']]
        if 'sparse' in a:
            sp = json.loads(json.dumps(a['sparse']))
            sp['indices']['bufferView'] = bv_map[sp['indices']['bufferView']]
            sp['values']['bufferView'] = bv_map[sp['values']['bufferView']]
            a['sparse'] = sp
        new_acc.append(a)

    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            prim['attributes'] = {k: acc_map[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = acc_map[prim['indices']]
            if 'targets' in prim:
                prim['targets'] = [{k: acc_map[v] for k, v in t.items()} for t in prim['targets']]
    for skin in js.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]
    for anim in js.get('animations', []):
        for s in anim['samplers']:
            s['input'], s['output'] = acc_map[s['input']], acc_map[s['output']]
    for im in js.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = bv_map[im['bufferView']]
    js['accessors'] = new_acc
    js['bufferViews'] = new_bvs
    js['buffers'] = [{'byteLength': len(out) + ((4 - len(out) % 4) % 4)}]
    return js, bytes(out)


# ------------------------------------------------------------------ image helpers
def box_blur(x, r):
    for axis in (0, 1):
        pad = [(0, 0)] * x.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(x, pad, mode='edge'), axis=axis, dtype=np.float64)
        n = x.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        x = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return x


def bleed(rgba):
    """Fill the RGB of transparent texels with nearby colours so resizing keeps clean cut-out edges."""
    rgb, known = rgba[..., :3], (rgba[..., 3:4] > 0.02).astype(np.float32)
    out, have = rgb.copy(), known.copy()
    for r in (1, 2, 4, 8, 16, 32, 64):
        s = box_blur(np.concatenate([rgb * known, known], axis=2), r)
        fill = s[..., :3] / np.maximum(s[..., 3:4], 1e-6)
        m = (have < 0.5) & (s[..., 3:4] > 1e-4)
        out = np.where(m, fill, out)
        have = np.maximum(have, m.astype(np.float32))
    res = rgba.copy()
    res[..., :3] = out
    return res


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    dd = np.where(d == 0, 1, d)
    h = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) / 6
    h = np.where(d == 0, 0, h)
    s = np.where(mx == 0, 0, d / np.where(mx == 0, 1, mx))
    return h, s, mx


def hsv_to_rgb(h, s, v):
    h6 = (h % 1.0) * 6
    i = np.floor(h6).astype(int) % 6
    f = h6 - np.floor(h6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    choices = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    out = np.zeros(h.shape + (3,), np.float32)
    for k, (a, b, c) in enumerate(choices):
        m = i == k
        out[..., 0] = np.where(m, a, out[..., 0])
        out[..., 1] = np.where(m, b, out[..., 1])
        out[..., 2] = np.where(m, c, out[..., 2])
    return out


def band(x, lo, hi, soft):
    return np.clip(np.minimum((x - (lo - soft)) / soft, ((hi + soft) - x) / soft), 0, 1)


def load_rgba(data):
    return np.asarray(Image.open(io.BytesIO(data)).convert('RGBA')).astype(np.float32) / 255


def to_image(rgba):
    return Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def jpg_bytes(im, q=86):
    buf = io.BytesIO()
    im.convert('RGB').save(buf, 'JPEG', quality=q, optimize=True)
    return buf.getvalue()


def resized(rgba, max_side):
    h, w = rgba.shape[:2]
    k = min(1.0, max_side / max(w, h))
    im = to_image(bleed(rgba) if rgba[..., 3].min() < 1 else rgba)
    if k < 1:
        im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    return im


# ------------------------------------------------------------------ the uniform
def recolour_dress(rgba):
    """Cream -> white, lilac pink -> warm rose, cravat -> Poké Ball red; gold trims and lace stay."""
    rgb, a = rgba[..., :3], rgba[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    hd = h * 360
    cream = band(hd, 16, 44, 7) * band(s, 0.035, 0.40, 0.05) * band(v, 0.78, 1.0, 0.08)
    gold = np.clip((s - 0.38) / 0.12, 0, 1) * band(hd, 26, 60, 6)
    # keep the pale highlights inside the gold brooch, buttons and trims: grow the gold mask a little
    protect = np.clip(box_blur(gold[..., None], 3)[..., 0] * 3, 0, 1)
    cream *= 1 - protect
    # white cloth with soft rose-lavender shading (anime white uniforms are shaded cool-pink, not grey)
    shade = np.clip((1 - v) * 2.2, 0, 1)
    w_rgb = hsv_to_rgb(np.full_like(h, 340 / 360), 0.035 + 0.16 * shade, np.clip(v * 1.02 + 0.02, 0, 1))
    pink = band(np.where(hd < 90, hd + 360, hd), 300, 352, 10) * band(s, 0.05, 1.0, 0.04)
    p_rgb = hsv_to_rgb(np.full_like(h, 0) + (np.where(hd < 90, hd + 360, hd) + 16) / 360,
                       np.clip(s * 1.12, 0, 1), v)
    out = rgb * (1 - cream[..., None]) + w_rgb * cream[..., None]
    out = out * (1 - pink[..., None]) + p_rgb * pink[..., None]
    # cravat below the brooch on the blouse front: Poké Ball red
    H, W = a.shape
    yy, xx = np.mgrid[0:H, 0:W]
    box = ((xx > W * 0.455) & (xx < W * 0.545) & (yy > H * 0.335) & (yy < H * 0.45)).astype(np.float32)
    red = box * pink * band(s, 0.26, 1.0, 0.07)  # the saturated cravat only, not the lace around it
    r_rgb = hsv_to_rgb(np.full_like(h, 352 / 360), np.clip(0.55 + s * 0.9, 0, 0.86), np.clip(v * 0.92, 0, 1))
    out = out * (1 - red[..., None]) + r_rgb * red[..., None]
    res = rgba.copy()
    res[..., :3] = out
    return res


# ------------------------------------------------------------------ main
def main():
    src, dst = sys.argv[1], sys.argv[2]
    preview = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    js, binb = read_glb(src)
    meta = js['extensions']['VRM']['meta']
    assert meta.get('licenseName') == 'CC0', 'expected the CC0 VRoid sample model'

    # morph normals out
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            if 'targets' in prim:
                prim['targets'] = [{k: v for k, v in t.items() if k not in ('NORMAL', 'TANGENT')} for t in prim['targets']]

    images = js['images']
    new_data = {}
    for i, im in enumerate(images):
        name = im.get('name', '')
        data = view_bytes(js, binb, im['bufferView'])
        rgba = load_rgba(data)
        h, w = rgba.shape[:2]
        if name == 'Thumbnail':
            pic = to_image(rgba).resize((256, 256), Image.LANCZOS)
            new_data[i] = jpg_bytes(pic, 85)
            im['mimeType'] = 'image/jpeg'
            continue
        if max(w, h) <= 8:
            continue
        if name.endswith('_nml'):
            side = 256 if 'Hair' in name else 512
        elif name.startswith('F00_002_Onepiece'):
            rgba = recolour_dress(rgba)
            side = 1024
            if preview:
                to_image(rgba).save(os.path.join(preview, 'onepiece_recoloured.png'))
        elif name == 'F00_000_HairBack_00' or name.startswith('Matcap'):
            side = 512 if name == 'F00_000_HairBack_00' else 256
        elif name == 'F00_000_Hair_00_spe':
            side = 256
        else:
            side = 1024
        if max(w, h) <= side and not name.startswith('F00_002_Onepiece'):
            continue
        new_data[i] = png_bytes(resized(rgba, side))
        im['mimeType'] = 'image/png'

    meta['title'] = 'Pokémon Center presenter (from VRoid β Ver AvatarSample_4 "Victoria Rubin", CC0)'
    meta['author'] = 'pixiv Inc. (VRoid Studio sample model); uniform recolour for Pokémon Battle Draft'
    meta['reference'] = 'https://vroid.pixiv.help/hc/en-us/articles/360014900233'
    js, out = repack(js, binb, new_data)
    write_glb(dst, js, out)
    print(f'{src}: {os.path.getsize(src) / 1e6:.2f} MB -> {dst}: {os.path.getsize(dst) / 1e6:.2f} MB')
    imgs = sum(js['bufferViews'][im['bufferView']]['byteLength'] for im in js['images'])
    print(f'images {imgs / 1e6:.2f} MB, geometry+rest {(len(out) - imgs) / 1e6:.2f} MB, json {len(json.dumps(js)) / 1e3:.0f} kB')


if __name__ == '__main__':
    main()
