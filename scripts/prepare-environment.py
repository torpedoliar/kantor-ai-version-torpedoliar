"""Offline glTF vertex clustering for CC0 foliage (no upstream code executed).
Run from the project root with python -I; staging and output are explicit arguments.
"""
import argparse, json, pathlib, shutil, sys
# Offline tools installed in the plan scratch directory, never inside downloaded asset folders.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / '.superpowers/sdd/2026-10-24-living-neighborhood/tools'))
import numpy as np
import fast_simplification
from scipy.spatial import cKDTree


def convert(source, output, cell):
    source, output = pathlib.Path(source), pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=True)
    doc = json.loads(source.read_text(encoding='utf-8'))
    buffers = [(source.parent / b['uri']).read_bytes() for b in doc['buffers']]
    data = bytearray()
    views, accessors = [], []

    def read(i):
        a = doc['accessors'][i]
        v = doc['bufferViews'][a['bufferView']]
        dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.ndarray((a['count'], width), dtype=dtype, buffer=buffers[v['buffer']], offset=start,
                          strides=(v.get('byteStride', np.dtype(dtype).itemsize * width), np.dtype(dtype).itemsize)).copy()

    def write(values, kind):
        while len(data) % 4:
            data.append(0)
        values = np.ascontiguousarray(values)
        raw = values.tobytes()
        views.append({'buffer': 0, 'byteOffset': len(data), 'byteLength': len(raw)})
        a = {'bufferView': len(views)-1, 'componentType': 5125 if values.dtype.kind == 'u' else 5126,
             'count': len(values), 'type': kind}
        if kind == 'VEC3':
            a.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        accessors.append(a)
        data.extend(raw)
        return len(accessors)-1

    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            attrs = {k: read(i) for k, i in p['attributes'].items()}
            pos = attrs['POSITION']
            indices = read(p['indices']).reshape(-1, 3).astype(np.int32)
            simplified, triangles = fast_simplification.simplify(pos.astype(np.float64), indices,
                target_count=min(len(indices), int(cell)), preserve_border=False)
            # Transfer UVs/normals from nearest original vertex; per-material primitives stay separate.
            _, nearest = cKDTree(pos).query(simplified)
            # Disconnected twig/leaf islands can collapse into long bridging slivers. Drop those artifacts;
            # the trunk primitive remains continuous, foliage remains many small physical leaf islands.
            if p.get('material', 0) > 0:
                xyz = simplified[triangles]
                edges = np.stack([np.linalg.norm(xyz[:, 0]-xyz[:, 1], axis=1),
                                  np.linalg.norm(xyz[:, 1]-xyz[:, 2], axis=1),
                                  np.linalg.norm(xyz[:, 2]-xyz[:, 0], axis=1)], axis=1)
                triangles = triangles[edges.max(axis=1) < (.2 if p.get('material') == 2 else .35)]
            values = {k: (simplified if k == 'POSITION' else v[nearest]) for k, v in attrs.items()}
            p['attributes'] = {k: write(v.astype('<f4'), {2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[v.shape[1]]) for k, v in values.items()}
            p['indices'] = write(triangles.astype('<u4').reshape(-1, 1), 'SCALAR')
            print(mesh.get('name'), 'vertices', len(pos), '->', len(simplified), 'triangles', len(triangles))
    doc['buffers'] = [{'uri': 'tree.bin', 'byteLength': len(data)}]
    doc['bufferViews'], doc['accessors'] = views, accessors
    # Alpha test avoids sorting artifacts in instanced foliage and provides crisp leaf silhouettes.
    for material in doc.get('materials', []):
        if material.get('alphaMode') == 'BLEND':
            material.update(alphaMode='MASK', alphaCutoff=.45, doubleSided=True)
    for image in doc.get('images', []):
        rel = pathlib.Path(image['uri'])
        if rel.is_absolute() or '..' in rel.parts:
            raise ValueError('unsafe texture path')
        (output / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source.parent / rel, output / rel)
    (output / 'tree.bin').write_bytes(data)
    (output / 'tree.gltf').write_text(json.dumps(doc, separators=(',', ':')), encoding='utf-8')
    print('geometry MiB', len(data) / 1048576)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('output')
    p.add_argument('--cell', type=float, default=.06)
    a = p.parse_args()
    convert(a.source, a.output, a.cell)
