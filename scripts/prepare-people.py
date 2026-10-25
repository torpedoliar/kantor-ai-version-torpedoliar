"""Offline conversion of official MakeHuman CC0 data to local skinned glTF.
Reads data only from an isolated source folder and system-assets zip; never executes pack code.
Requires numpy and Pillow. Run python -I scripts/prepare-people.py.
"""
import io, json, re, zipfile
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '.superpowers/downloads/humans-20261023/source'
PACK = ROOT / '.superpowers/downloads/humans-20261023/system-assets.zip'
OUT = ROOT / 'public/assets/people'


def obj(text):
    vertices, uv, faces = [], [], []
    group = ''
    for line in text.splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == 'v':
            vertices.append(list(map(float, p[1:4])))
        elif p[0] == 'vt':
            uv.append(list(map(float, p[1:3])))
        elif p[0] == 'g':
            group = p[1]
        elif p[0] == 'f':
            faces.append((group, [tuple(int(i) - 1 if i else -1 for i in c.split('/')[:2]) for c in p[1:]]))
    return np.array(vertices, dtype=np.float64), np.array(uv, dtype=np.float32), faces


def morph(base, file):
    out = base.copy()
    for line in file.read_text().splitlines():
        if line.startswith('#') or not line.strip():
            continue
        p = line.split()
        out[int(p[0])] += np.array(list(map(float, p[1:4])))
    return out


def proxy(text, base, weight_dict):
    """MHCLO weighted base correspondences plus scaled offsets, and skin weight transfer."""
    coords, weights, hidden = [], [], set()
    scales, mode = np.ones(3), None
    for line in text.splitlines():
        p = line.split()
        if not p or p[0] == '#':
            continue
        if p[0] in ('x_scale', 'y_scale', 'z_scale'):
            axis = {'x_scale': 0, 'y_scale': 1, 'z_scale': 2}[p[0]]
            scales[axis] = abs(base[int(p[1]), axis] - base[int(p[2]), axis]) / float(p[3])
        elif p[0] == 'verts':
            mode = 'verts'
        elif p[0] == 'delete_verts':
            mode = 'delete'
        elif mode == 'verts' and p[0].isdigit():
            if len(p) == 1:
                ids, factors, offset = [int(p[0])], [1.0], np.zeros(3)
            elif len(p) >= 9:
                ids, factors = list(map(int, p[:3])), list(map(float, p[3:6]))
                offset = np.array(list(map(float, p[6:9]))) * scales
            else:
                continue
            coords.append(sum(base[i] * f for i, f in zip(ids, factors)) + offset)
            combined = {}
            for i, f in zip(ids, factors):
                for bone, w in weight_dict[i].items():
                    combined[bone] = combined.get(bone, 0) + w * f
            weights.append(combined)
        elif mode == 'delete' and p[0].isdigit():
            i = 0
            while i < len(p):
                a = int(p[i]); i += 1
                if i < len(p) and p[i] == '-':
                    hidden.update(range(a, int(p[i + 1]) + 1)); i += 2
                else:
                    hidden.add(a)
        elif mode and not p[0].isdigit():
            # Metadata (e.g. material) may appear between verts and its first row.
            if p[0] not in ('material', 'obj_file', 'z_depth', 'name'):
                mode = None
    return np.array(coords), weights, hidden


def four_weights(weights, root_index):
    pairs = sorted(((k, v) for k, v in weights.items() if v > 0), key=lambda x: -x[1])[:4]
    if not pairs:
        pairs = [(root_index, 1)]
    total = sum(v for _, v in pairs)
    joints = [k for k, _ in pairs] + [0] * (4 - len(pairs))
    values = [v / total for _, v in pairs] + [0] * (4 - len(pairs))
    return joints, values


def office_shirt(image, shirt_uv):
    """Plain office tee: neutral grey fabric (tinted per division at runtime) on exactly the texels the shirt
    triangles use (rasterized from the mesh UVs), so the denim next to the sleeve islands is never recoloured.
    Logo and trim are replaced by the panel's median knit, keeping only fine shading."""
    from PIL import ImageDraw, ImageFilter
    w, h = image.size
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    for tri in shirt_uv:
        draw.polygon([(u * w, v * h) for u, v in tri], fill=255)
    # Dilate generously: seams sample texels just outside the islands, which otherwise show the old blue/orange.
    mask = mask.filter(ImageFilter.MaxFilter(9))
    region = np.asarray(mask) > 0
    rgb = np.asarray(image.convert('RGB')).astype(np.float32)
    lum = rgb.mean(axis=2)
    # Remove graphics: clamp the panel's luminance to a narrow band around its median knit value.
    base = np.median(lum[region])
    # Keep only fine knit detail (high-pass); large shapes such as the printed logo are blurred away.
    # Detail is taken from a logo-free patch of knit: the printed circle is a large low-frequency shape that a
    # high-pass still leaves as an outline, so tile a clean shirt swatch instead of keeping per-pixel detail.
    ys, xs = np.nonzero(region)
    patch = lum[ys.min() + 8:ys.min() + 40, xs.min() + 8:xs.min() + 40]
    patch = patch - patch.mean()
    tiled = np.tile(patch, (h // patch.shape[0] + 1, w // patch.shape[1] + 1))[:h, :w]
    shade = np.clip(tiled, -10, 10) * .8
    grey = np.clip(150 + shade, 120, 185)
    out = rgb.copy()
    out[region] = np.stack([grey] * 3, axis=2)[region]
    return Image.fromarray(out.astype(np.uint8))


def texture(pack, source, output, alpha=False, shirt_uv=None):
    image = Image.open(io.BytesIO(pack.read(source)))
    if shirt_uv is not None:
        image = office_shirt(image, shirt_uv)
    image.thumbnail((512, 512) if alpha else (1024, 1024), Image.Resampling.LANCZOS)
    if alpha:
        image.convert('RGBA').save(OUT / output, optimize=True)
    else:
        image.convert('RGB').save(OUT / output, quality=83, optimize=True)
    return output


def convert(sex, pack, base, uv, faces, skeleton, weight_source):
    posed = morph(base, SRC / f'asian-{sex}-young.target')
    bone_names = list(skeleton['bones'])
    bone_index = {name: i for i, name in enumerate(bone_names)}
    root_bone = bone_index['root']
    weights = [dict() for _ in range(len(base))]
    for name, items in weight_source['weights'].items():
        for vertex, weight in items:
            weights[vertex][bone_index[name]] = weight
    joint = lambda name: posed[skeleton['joints'][name]].mean(axis=0)
    heads = [joint(skeleton['bones'][name]['head']) for name in bone_names]
    body_faces = [f for group, f in faces if group == 'body']
    used = sorted({p[0] for f in body_faces for p in f})
    bottom, top = posed[used, 1].min(), posed[used, 1].max()
    height = 1.78 if sex == 'male' else 1.70
    scale = height / (top - bottom)
    center = np.array([0, bottom, 0])
    to_meters = lambda points: (points - center) * scale
    heads = to_meters(np.array(heads))
    hidden = set()
    clothes_name = 'male_casualsuit02' if sex == 'male' else 'female_casualsuit01'
    hair_name = 'short01' if sex == 'male' else 'bob01'
    entries = []
    for role, folder, name in [('clothes', 'clothes', clothes_name), ('hair', 'hair', hair_name), ('shoes', 'clothes', 'shoes01'), ('eyes', 'eyes', 'low-poly')]:
        prefix = f'{folder}/{name}/{name}'
        _, source_uv, source_faces = obj(pack.read(prefix + '.obj').decode('utf8', errors='replace'))
        coords, transferred, covered = proxy(pack.read(prefix + '.mhclo').decode('utf8', errors='replace'), posed, weights)
        if not len(coords):
            raise ValueError(f'No proxy vertices: {prefix}')
        hidden.update(covered)
        entries.append((role, to_meters(coords), source_uv, [f for _, f in source_faces], transferred))
    # Covered body vertices are removed, preventing skin from poking through the clothes.
    body_faces = [f for f in body_faces if not all(v[0] in hidden for v in f)]
    entries.insert(0, ('skin', to_meters(posed), uv, body_faces, weights))
    skin_source = f'skins/young_asian_{sex}/young_lightskinned_{sex}_diffuse3.png'
    skin_image = texture(pack, skin_source, f'{sex}-skin.jpg')
    # Shirt = the upper atlas islands: clothing faces touching anything above the hip joint, minus the jeans
    # islands (the large lower half of the atlas). Denim stays as photographed.
    _, cloth_vertices, cloth_uv, cloth_faces, _ = entries[1]
    waist = heads[bone_index['root']][1] - .04
    shirt_uv = [[(cloth_uv[t][0], 1 - cloth_uv[t][1]) for _, t in face]
                for face in cloth_faces if all(t >= 0 for _, t in face)
                and any(cloth_vertices[v][1] > waist for v, _ in face)
                and not all(1 - cloth_uv[t][1] > .45 and cloth_uv[t][0] < .76 for _, t in face)]
    cloth_image = texture(pack, f'clothes/{clothes_name}/{clothes_name}_diffuse.png', f'{sex}-clothes.jpg', shirt_uv=shirt_uv)
    hair_image = texture(pack, f'hair/{hair_name}/{hair_name}_diffuse.png', f'{sex}-hair.png', alpha=True)
    shoes_source = next(n for n in pack.namelist() if n.startswith('clothes/shoes01/') and 'diffuse' in n and n.endswith('.png'))
    shoes_image = texture(pack, shoes_source, f'{sex}-shoes.jpg')
    eye_image = texture(pack, 'eyes/materials/brown_eye.png', 'eyes.jpg')
    g = {'asset': {'version': '2.0', 'generator': 'Kantor Kita CC0 MakeHuman converter'}, 'scene': 0,
         'scenes': [{'nodes': [len(bone_names)]}], 'nodes': [], 'skins': [], 'meshes': [], 'materials': [],
         'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
         'buffers': [], 'bufferViews': [], 'accessors': []}
    binary = bytearray()
    def accessor(data, component, kind, target=None, bounds=False):
        nonlocal binary
        while len(binary) % 4:
            binary.append(0)
        a = np.ascontiguousarray(data)
        offset = len(binary); binary.extend(a.tobytes())
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': a.nbytes}
        if target:
            view['target'] = target
        vi = len(g['bufferViews']); g['bufferViews'].append(view)
        count = len(a)
        ac = {'bufferView': vi, 'componentType': component, 'count': count, 'type': kind}
        if bounds:
            ac['min'] = a.min(axis=0).astype(float).tolist(); ac['max'] = a.max(axis=0).astype(float).tolist()
        ai = len(g['accessors']); g['accessors'].append(ac); return ai
    # Translation-only rest bones: world axes stay consistent with office Euler pose controllers.
    children = [[] for _ in bone_names]
    for i, name in enumerate(bone_names):
        parent = skeleton['bones'][name]['parent']
        translation = heads[i] - heads[bone_index[parent]] if parent else heads[i]
        g['nodes'].append({'name': name, 'translation': translation.astype(float).tolist()})
        if parent:
            children[bone_index[parent]].append(i)
    for i, c in enumerate(children):
        if c:
            g['nodes'][i]['children'] = c
    ibm = np.repeat(np.eye(4)[None, :, :], len(bone_names), axis=0)
    for i, h in enumerate(heads):
        ibm[i, :3, 3] = -h
    # glTF matrices are column-major.
    ibm_accessor = accessor(ibm.transpose(0, 2, 1).reshape(-1, 16).astype('<f4'), 5126, 'MAT4')
    g['skins'].append({'joints': list(range(len(bone_names))), 'skeleton': root_bone, 'inverseBindMatrices': ibm_accessor})
    person_root = {'name': f'{sex}-adult', 'children': [root_bone]}
    g['nodes'].append(person_root)
    for role, vertices, texcoords, polys, influences in entries:
        source_image = {'skin': skin_image, 'clothes': cloth_image, 'hair': hair_image, 'shoes': shoes_image, 'eyes': eye_image}[role]
        image_index = len(g['images']); g['images'].append({'uri': source_image})
        g['textures'].append({'source': image_index, 'sampler': 0})
        material = {'name': role, 'pbrMetallicRoughness': {'baseColorTexture': {'index': image_index}, 'metallicFactor': 0, 'roughnessFactor': .7 if role == 'skin' else .85}, 'doubleSided': role == 'hair'}
        if role == 'hair':
            material.update(alphaMode='MASK', alphaCutoff=.4)
        g['materials'].append(material)
        remap, positions, uvs, js, ws, indices = {}, [], [], [], [], []
        for poly in polys:
            polygon = []
            for vi, ti in poly:
                key = (vi, ti)
                if key not in remap:
                    remap[key] = len(positions)
                    # OBJ texture space starts bottom-left; glTF starts top-left, so V is flipped.
                    t = texcoords[ti] if ti >= 0 else [0, 0]
                    positions.append(vertices[vi]); uvs.append([t[0], 1 - t[1]])
                    j, w = four_weights(influences[vi], root_bone); js.append(j); ws.append(w)
                polygon.append(remap[key])
            for i in range(1, len(polygon) - 1):
                indices.extend([polygon[0], polygon[i], polygon[i + 1]])
        positions = np.array(positions, dtype='<f4'); indices = np.array(indices, dtype='<u4')
        normals = np.zeros_like(positions)
        for a, b, c in indices.reshape(-1, 3):
            n = np.cross(positions[b] - positions[a], positions[c] - positions[a])
            normals[a] += n; normals[b] += n; normals[c] += n
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
        attributes = {'POSITION': accessor(positions, 5126, 'VEC3', 34962, True),
                      'NORMAL': accessor(normals.astype('<f4'), 5126, 'VEC3', 34962),
                      'TEXCOORD_0': accessor(np.array(uvs, dtype='<f4'), 5126, 'VEC2', 34962),
                      'JOINTS_0': accessor(np.array(js, dtype='<u2'), 5123, 'VEC4', 34962),
                      'WEIGHTS_0': accessor(np.array(ws, dtype='<f4'), 5126, 'VEC4', 34962)}
        mi = len(g['meshes']); g['meshes'].append({'name': role, 'primitives': [{'attributes': attributes, 'indices': accessor(indices, 5125, 'SCALAR', 34963), 'material': mi}]})
        ni = len(g['nodes']); g['nodes'].append({'name': role, 'mesh': mi, 'skin': 0}); person_root['children'].append(ni)
    g['buffers'].append({'uri': f'{sex}.bin', 'byteLength': len(binary)})
    (OUT / f'{sex}.bin').write_bytes(binary)
    (OUT / f'{sex}.gltf').write_text(json.dumps(g, separators=(',', ':')))
    head_indices = skeleton['joints'][skeleton['bones']['head']['head']]
    head_y = to_meters(posed[head_indices])[..., 1].mean()
    return {'height': height, 'headHeight': float(height - head_y), 'vertices': sum(len(g['accessors'][m['primitives'][0]['attributes']['POSITION']]) if False else g['accessors'][m['primitives'][0]['attributes']['POSITION']]['count'] for m in g['meshes'])}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base, uv, faces = obj((SRC / 'base.obj').read_text())
    skeleton = json.loads((SRC / 'default.mhskel').read_text()); weights = json.loads((SRC / 'default_weights.mhw').read_text())
    with zipfile.ZipFile(PACK) as pack:
        measurements = {sex: convert(sex, pack, base, uv, faces, skeleton, weights) for sex in ['male', 'female']}
    manifest = {'templates': {'male': 'male.gltf', 'female': 'female.gltf'}, 'measurements': measurements,
                'license': 'CC0', 'source': 'https://github.com/makehumancommunity/makehuman',
                'boneMap': {'hips': 'root', 'head': 'head', 'spine': 'spine05', 'leftArm': 'upperarm01.L', 'leftElbow': 'lowerarm01.L', 'rightArm': 'upperarm01.R', 'rightElbow': 'lowerarm01.R', 'leftThigh': 'upperleg01.L', 'leftKnee': 'lowerleg01.L', 'rightThigh': 'upperleg01.R', 'rightKnee': 'lowerleg01.R'}}
    (OUT / 'people.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(measurements))


if __name__ == '__main__':
    main()
