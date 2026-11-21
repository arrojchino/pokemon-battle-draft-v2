"""Build frontend/src/engine/character/homeManifest.ts: where each Pokémon HOME model, texture and clip lives.

The game shows some species with their Pokémon HOME model (engine/character/home.ts). Two public GitHub
exports hold the data: GLB files (mesh and skeleton) and a Unity project (textures, materials, animation
clips). This script records paths and texture transforms only; nothing is downloaded into the repo.

    python scripts/home-manifest.py            # GITHUB_TOKEN is optional (raises the API rate limit)
"""
import json, os, re, struct, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

GLB_REPO = 'Lilothestitch16/Pokemon-HOME-GLB-Models'
UNITY_REPO = 'Lilothestitch16/Pokemon-HOME-Unity-Models'
OUT = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src', 'engine', 'character', 'homeManifest.ts')

# game id (National Dex, or artwork id for alternate forms) -> HOME model key
TARGETS = {
    861: 'pm0861_00_00', 977: 'pm0977_00_00', 992: 'pm0992_00_00', 1013: 'pm1013_11_00', 1000: 'pm1000_00_00',
    497: 'pm0497_00_00', 914: 'pm0914_00_00', 10009: 'pm0479_13_00', 445: 'pm0445_00_00', 94: 'pm0094_00_00',
    635: 'pm0635_00_00', 823: 'pm0823_00_00', 908: 'pm0908_00_00', 959: 'pm0959_00_00', 980: 'pm0980_00_51',
    858: 'pm0858_00_00', 478: 'pm0478_00_00', 184: 'pm0184_00_00', 36: 'pm0036_00_00', 1006: 'pm1006_00_00',
    286: 'pm0286_00_00', 925: 'pm0925_11_00', 637: 'pm0637_00_00', 748: 'pm0748_00_00', 778: 'pm0778_11_00',
    132: 'pm0132_00_00', 302: 'pm0302_00_00', 998: 'pm0998_00_00', 887: 'pm0887_00_00', 212: 'pm0212_00_00',
    903: 'pm0903_00_41', 923: 'pm0923_00_00',
}
CLIPS = {'w': r'ba10_waitA01$', 'p': r'ba20_buturi01$', 's': r'ba21_tokusyu01$', 'r': r'ba02_roar01$'}


def get(url, binary=False, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'home-manifest', **(headers or {})})
    data = urllib.request.urlopen(req, timeout=120).read()
    return data if binary else data.decode('utf-8', 'replace')


def api(path):
    tok = os.environ.get('GITHUB_TOKEN')
    return json.loads(get('https://api.github.com/' + path, headers={'Authorization': f'token {tok}'} if tok else {}))


def raw(repo, path, binary=False):
    return get(f'https://raw.githubusercontent.com/{repo}/main/' + urllib.parse.quote(path), binary)


def tree(repo):
    paths = []
    for top in api(f'repos/{repo}/git/trees/main')['tree']:
        if top['type'] == 'blob':
            paths.append(top['path']); continue
        t = api(f'repos/{repo}/git/trees/{top["sha"]}?recursive=1')
        paths += [top['path'] + '/' + b['path'] for b in t['tree'] if b['type'] == 'blob']
    return paths


def glb_materials(path):
    data = raw(GLB_REPO, path, True)
    n, _ = struct.unpack('<II', data[12:20])
    return sorted({m['name'] for m in json.loads(data[20:20 + n]).get('materials', [])})


def num(x):
    x = float(x)
    return int(x) if x.is_integer() else round(x, 5)


def texture_slot(mat, slot):
    m = re.search(slot + r':\s*\n\s*m_Texture: \{fileID: \d+(?:, guid: (\w+))?[^}]*\}\s*\n\s*m_Scale: \{x: ([-\d.eE]+), y: ([-\d.eE]+)\}\s*\n\s*m_Offset: \{x: ([-\d.eE]+), y: ([-\d.eE]+)\}', mat)
    return (m.group(1), [float(v) for v in m.groups()[1:]]) if m and m.group(1) else (None, None)


def entry(key, glbs, unity):
    glb = next(p for p in glbs if p.endswith('/' + key + '.glb'))
    fbx = next(p for p in unity if f'/{key}/fbx/' in p).split('/fbx/')[0] + '/fbx/'
    root = fbx.split('/')[0]
    # texture guid -> file and wrap modes (0 repeat, 1 clamp, 2-3 mirror)
    pngs = [p for p in unity if p.startswith(fbx + 'textures/') and p.endswith('.png') and '_rare' not in p]
    def meta(p):
        t = raw(UNITY_REPO, p + '.meta')
        wrap = [int(w) if w else 0 for w in (re.search(r'wrapU: (-?\d+)', t), re.search(r'wrapV: (-?\d+)', t)) for w in [w.group(1) if w else None]]
        return re.search(r'guid: (\w+)', t).group(1), (p[len(fbx):], [max(0, w) for w in wrap])
    with ThreadPoolExecutor(8) as ex:
        files = dict(ex.map(meta, pngs))
    mats, blink = {}, []
    for full in glb_materials(glb):
        name = full.split('-', 1)[1]
        path = f'{root}/Assets/Material/{full}.mat'
        if path not in unity: continue
        mat = raw(UNITY_REPO, path)
        f = {k: float(v) for k, v in re.findall(r'\n      (_\w+): ([-\d.eE]+)', mat)}
        guid, st = texture_slot(mat, '_Col0Tex')
        if guid not in files: continue  # untextured: effect geometry, hidden at runtime
        file, wrap = files[guid]
        # The UV base is an offset after the scale (eye and mouth atlases use -0.5).
        row = [file, num(st[0]), num(st[1]), num(st[2] + f.get('_ColorBaseU', 0)), num(st[3] + f.get('_ColorBaseV', 0)), *wrap, 1 if f.get('_BlendMode', 0) >= 1 else 0]
        lguid, lst = texture_slot(mat, '_L1Col0Tex')
        if lguid in files and f.get('_Layer1Enable', 0) > 0:
            row += [files[lguid][0], num(lst[0]), num(lst[1]), num(lst[2] + f.get('_Layer1BaseU', 0)), num(lst[3] + f.get('_Layer1BaseV', 0))]
        mats[name] = row
        if re.search('eye', name, re.I) and f.get('_ColorBaseU') == -0.5: blink.append(name)
    anims = [p[len(fbx) + 3:-5] for p in unity if p.startswith(fbx + 'ac/') and p.endswith('.anim')]
    clips = {k: next(a for a in anims if re.search(pat, a)) for k, pat in CLIPS.items() if any(re.search(pat, a) for a in anims)}
    return {'g': glb, 'f': fbx, 'm': mats, 'a': clips, **({'b': sorted(blink)} if blink else {})}


def main():
    glbs = [p for p in tree(GLB_REPO) if p.endswith('.glb')]
    unity = tree(UNITY_REPO)
    out = {dex: entry(key, glbs, unity) for dex, key in TARGETS.items()}
    lines = [
        '// Generated by scripts/home-manifest.py from the public Pokémon HOME exports (paths and texture transforms only).',
        '// Material row: texture, repeat x/y, offset x/y, wrap u/v (0 repeat, 1 clamp, 2-3 mirror), cut-out, then the',
        '// optional layer-1 texture (eye iris, decals) with its own repeat and offset. b: eye materials that blink.',
        'export type HomeMat = [file: string, rx: number, ry: number, ox: number, oy: number, wu: number, wv: number, cut: number, layer?: string, lrx?: number, lry?: number, lox?: number, loy?: number];',
        'export type HomeEntry = { g: string; f: string; m: Record<string, HomeMat>; a: { w?: string; p?: string; s?: string; r?: string }; b?: string[] };',
        'export const HOME: Record<number, HomeEntry> = {',
        *[f'  {dex}: {json.dumps(out[dex], separators=(",", ":"), ensure_ascii=False)},' for dex in sorted(out)],
        '};',
    ]
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines) + '\n')
    print(f'{len(out)} species -> {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
