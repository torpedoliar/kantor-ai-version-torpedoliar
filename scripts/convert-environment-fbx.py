"""Data-only converter for the selected Blender-exported FBX 7400 static motorcycle.
Not a general FBX loader: reject unsupported mapping rather than silently corrupt it.
"""
import argparse, json, pathlib, struct, zlib
import numpy as np
from PIL import Image


def convert(source, output):
    data = pathlib.Path(source).read_bytes()
    if data[:18] != b'Kaydara FBX Binary' or struct.unpack_from('<I', data, 23)[0] != 7400:
        raise ValueError('expected static binary FBX 7400')

    def parse(off):
        end, count, _, length = struct.unpack_from('<IIIB', data, off)
        off += 13
        if not end:
            return off, None
        name = data[off:off+length].decode()
        off += length
        props = []
        for _ in range(count):
            kind = chr(data[off])
            off += 1
            if kind in 'fdilbc':
                n, encoded, size = struct.unpack_from('<III', data, off)
                off += 12
                raw = data[off:off+size]
                off += size
                if encoded:
                    raw = zlib.decompress(raw)
                props.append(np.frombuffer(raw, dtype={'f':'<f4','d':'<f8','i':'<i4','l':'<i8','b':'u1','c':'u1'}[kind], count=n))
            elif kind in 'SR':
                size = struct.unpack_from('<I', data, off)[0]
                off += 4
                raw = data[off:off+size]
                off += size
                props.append(raw.decode(errors='replace') if kind == 'S' else raw)
            else:
                fmt = {'Y':'h','C':'?','I':'i','F':'f','D':'d','L':'q'}[kind]
                props.append(struct.unpack_from('<'+fmt, data, off)[0])
                off += struct.calcsize(fmt)
        children = []
        while off < end-13:
            off, child = parse(off)
            if child:
                children.append(child)
        return end, (name, props, children)

    roots, offset = [], 27
    while offset < len(data)-13:
        offset, n = parse(offset)
        if n is None:
            break
        roots.append(n)
    objects = next(n for n in roots if n[0] == 'Objects')[2]
    geo = next(n for n in objects if n[0] == 'Geometry')
    def child(n, key):
        return next(c for c in n[2] if c[0] == key)
    def value(n, key):
        return child(n, key)[1][0]
    positions = value(geo, 'Vertices').reshape(-1, 3)
    polygons = value(geo, 'PolygonVertexIndex')
    normals = child(geo, 'LayerElementNormal')
    uv = child(geo, 'LayerElementUV')
    assert value(normals, 'MappingInformationType') == 'ByPolygonVertex'
    assert value(uv, 'MappingInformationType') == 'ByPolygonVertex'
    ns = value(normals, 'Normals').reshape(-1, 3)
    uvdata = value(uv, 'UV').reshape(-1, 2)
    uvi = value(uv, 'UVIndex')
    indices, face, corners, corner = [], [], [], 0
    expanded_pos, expanded_normal, expanded_uv = [], [], []
    for index in polygons:
        vertex = int(-index-1 if index < 0 else index)
        expanded_pos.append(positions[vertex])
        expanded_normal.append(ns[corner])
        expanded_uv.append(uvdata[int(uvi[corner])])
        face.append(corner)
        corner += 1
        if index < 0:
            for i in range(1, len(face)-1):
                indices.extend([face[0], face[i], face[i+1]])
            face = []
    pos = np.array(expanded_pos)
    # Exported mesh is Z-up in its local coordinates; normalize longest horizontal axis to +z.
    print('raw bounds', pos.min(axis=0), pos.max(axis=0))
    extent = np.ptp(pos, axis=0)
    vertical = 2 if extent[2] < extent[0] else 1
    length_axis = int(np.argmax(extent))
    width_axis = next(a for a in range(3) if a not in [vertical, length_axis])
    order = [width_axis, vertical, length_axis]
    pos = pos[:, order]
    normal = np.array(expanded_normal)[:, order]
    # A reflected permutation requires reversing winding.
    perm = np.eye(3)[order]
    idx = np.array(indices, dtype='<u4').reshape(-1, 3)
    if np.linalg.det(perm) < 0:
        idx = idx[:, [0, 2, 1]]
    scale = 2.35 / np.ptp(pos[:, 2])
    pos *= scale
    pos[:, 0] -= (pos[:, 0].min()+pos[:, 0].max())/2
    pos[:, 2] -= (pos[:, 2].min()+pos[:, 2].max())/2
    pos[:, 1] -= pos[:, 1].min()
    tex = np.array(expanded_uv, dtype='<f4')
    tex[:, 1] = 1-tex[:, 1]
    blob, views, accessors = bytearray(), [], []
    for arr, kind in [(pos.astype('<f4'),'VEC3'), (normal.astype('<f4'),'VEC3'), (tex,'VEC2'), (idx.reshape(-1,1),'SCALAR')]:
        while len(blob)%4:
            blob.append(0)
        raw = arr.tobytes()
        views.append({'buffer':0,'byteOffset':len(blob),'byteLength':len(raw)})
        acc = {'bufferView':len(views)-1,'componentType':5125 if kind=='SCALAR' else 5126,'count':len(arr),'type':kind}
        if kind=='VEC3':
            acc.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        accessors.append(acc)
        blob.extend(raw)
    output = pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=True)
    source = pathlib.Path(source).parent
    images = []
    for name, filename in [('albedo','FLH_1200_albedo.jpg'),('normal','FLH_1200_normal.jpg')]:
        im = Image.open(source/filename)
        im.thumbnail((1024,1024))
        im.save(output/(name+'.jpg'),quality=88)
        images.append({'uri':name+'.jpg'})
    rough = Image.open(source/'FLH_1200_roughness.jpg').convert('L').resize((1024,1024))
    metal = Image.open(source/'FLH_1200_metallic.jpg').convert('L').resize((1024,1024))
    Image.merge('RGB',(Image.new('L',rough.size,255),rough,metal)).save(output/'metal-rough.jpg',quality=88)
    images.append({'uri':'metal-rough.jpg'})
    doc={'asset':{'version':'2.0','generator':'Kantor Kita data-only FBX converter'},'scene':0,'scenes':[{'nodes':[0]}],
         'nodes':[{'mesh':0,'name':'CC0 motorcycle'}],'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':0}]}],
         'materials':[{'name':'motorcycle','doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':2},'metallicFactor':1,'roughnessFactor':1},'normalTexture':{'index':1}}],
         'images':images,'textures':[{'source':i} for i in range(3)],'buffers':[{'uri':'motorcycle.bin','byteLength':len(blob)}],'bufferViews':views,'accessors':accessors}
    (output/'motorcycle.bin').write_bytes(blob)
    (output/'motorcycle.gltf').write_text(json.dumps(doc,separators=(',',':')),encoding='utf-8')
    print('metre bounds',np.ptp(pos,axis=0).tolist(),'triangles',len(idx))


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('output')
    a=p.parse_args()
    convert(a.source,a.output)
