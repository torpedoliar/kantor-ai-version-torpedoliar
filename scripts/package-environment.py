"""Package the visually inspected CC0 candidates from isolated staging into runtime assets."""
import pathlib, json, shutil, struct, hashlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
STAGE = ROOT / '.superpowers/sdd/2026-10-24-living-neighborhood'
OUT = ROOT / 'public/assets/environment'
OUT.mkdir(parents=True, exist_ok=True)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def entry(file, source, bounds=None):
    d = {'file': 'assets/environment/'+str(file.relative_to(OUT)).replace('\\','/'),
         'source': source, 'license': 'CC0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/', 'sha256': digest(file)}
    if bounds:
        d.update(bounds=bounds, forward='+z')
    return d


assets = {}
# All car data except the display cloth/cameras are retained, including CC0 materials/maps.
raw = (STAGE/'staging-car/toy.glb').read_bytes()
length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+length])
blob = raw[28+length:]
car_nodes = [i for i,n in enumerate(doc['nodes']) if n.get('name') in ['ToyCar','Glass']]
# Blender-exported source node: x,y,z -> x,-z,y at uniform .0001 scale.
mins, maxs = [], []
for i in car_nodes:
    n = doc['nodes'][i]
    for p in doc['meshes'][n['mesh']]['primitives']:
        a = doc['accessors'][p['attributes']['POSITION']]
        lo, hi = a['min'], a['max']
        mins.append(np.array([lo[0],-hi[2],lo[1]])*.0001)
        maxs.append(np.array([hi[0],-lo[2],hi[1]])*.0001)
lo, hi = np.min(mins,axis=0), np.max(maxs,axis=0)
scale = 4.5/(hi[2]-lo[2])
# Preserve source direction until the asset viewer verifies its front; source front is -z, rotate 180 degrees.
center=(lo+hi)/2
root=len(doc['nodes'])
doc['nodes'].append({'name':'normalized car','children':car_nodes,'scale':[scale]*3,
                     'rotation':[0,1,0,0], 'translation':[float(center[0]*scale),float(-lo[1]*scale),float(center[2]*scale)]})
doc['scenes']=[{'nodes':[root]}]
doc['scene']=0
doc.pop('cameras',None)
doc['buffers']=[{'uri':'car.bin','byteLength':len(blob)}]
folder=OUT/'car';folder.mkdir(exist_ok=True)
# The toy livery (flames, racing number) sits in the right half of the body atlas. Repaint it a neutral grey and
# store it as an external image, so the office tints each car a believable paint colour at runtime.
import io
from PIL import ImageDraw
body=doc['materials'][0]
image=doc['images'][doc['textures'][body['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
view=doc['bufferViews'][image['bufferView']]
paint=Image.open(io.BytesIO(blob[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']])).convert('RGB')
ImageDraw.Draw(paint).rectangle([paint.width//2,0,paint.width,paint.height],fill=(200,200,200))
paint.save(folder/'paint.png')
image.pop('bufferView');image.pop('mimeType',None);image['uri']='paint.png'
body['emissiveFactor']=[.6,.6,.6]
# Transmission makes three.js render the whole scene a second time every frame (≈1,100 extra draw calls in the
# building view). Plain alpha-blended tinted glass looks the same at office distances.
for material in doc['materials']:
    ext=material.get('extensions',{})
    if 'KHR_materials_transmission' in ext:
        ext.pop('KHR_materials_transmission')
        material['alphaMode']='BLEND'
        material.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=[.12,.16,.18,.55]
        material['pbrMetallicRoughness']['roughnessFactor']=.08
    if not ext:material.pop('extensions',None)
used={e for m in doc['materials'] for e in m.get('extensions',{})}
doc['extensionsUsed']=[e for e in doc.get('extensionsUsed',[]) if e in used or not e.startswith('KHR_materials_')]
if 'extensionsRequired' in doc:doc['extensionsRequired']=[e for e in doc['extensionsRequired'] if e in doc['extensionsUsed']]
(folder/'car.bin').write_bytes(blob)
(folder/'car.gltf').write_text(json.dumps(doc,separators=(',',':')),encoding='utf-8')
assets['car']=entry(folder/'car.gltf','https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar',((hi-lo)*scale).tolist())
# Tree topology is offline-decimated; textures resized with alpha preserved where applicable.
folder=OUT/'tree';folder.mkdir(exist_ok=True)
for f in (STAGE/'optimized-tree').rglob('*'):
    if not f.is_file():
        continue
    dst=folder/f.relative_to(STAGE/'optimized-tree');dst.parent.mkdir(parents=True,exist_ok=True)
    if f.suffix.lower() in ['.jpg','.png']:
        im=Image.open(f);im.thumbnail((512,512));im.save(dst,quality=85)
    else:
        shutil.copyfile(f,dst)
doc=json.loads((folder/'tree.gltf').read_text(encoding='utf-8'))
lo=np.min([a['min'] for a in doc['accessors'] if a.get('type')=='VEC3' and 'min'in a][::2],axis=0)
hi=np.max([a['max'] for a in doc['accessors'] if a.get('type')=='VEC3' and 'max'in a][::2],axis=0)
# Only POSITION accessors, not normal min/max, define dimensions.
ps=[doc['accessors'][p['attributes']['POSITION']] for m in doc['meshes'] for p in m['primitives']]
lo=np.min([a['min'] for a in ps],axis=0);hi=np.max([a['max'] for a in ps],axis=0)
scale=7/(hi[1]-lo[1]);center=(hi+lo)/2
root=len(doc['nodes']);children=doc['scenes'][doc.get('scene',0)]['nodes']
doc['nodes'].append({'children':children,'scale':[scale]*3,'translation':[float(-center[0]*scale),float(-lo[1]*scale),float(-center[2]*scale)]})
doc['scenes']=[{'nodes':[root]}];doc['scene']=0
(folder/'tree.gltf').write_text(json.dumps(doc,separators=(',',':')),encoding='utf-8')
assets['tree']=entry(folder/'tree.gltf','https://polyhaven.com/a/island_tree_01',((hi-lo)*scale).tolist())
folder=OUT/'motorcycle';folder.mkdir(exist_ok=True)
for f in (STAGE/'optimized-motor').iterdir():
    if f.is_file():shutil.copyfile(f,folder/f.name)
doc=json.loads((folder/'motorcycle.gltf').read_text(encoding='utf-8'));a=doc['accessors'][0]
assets['motorcycle']=entry(folder/'motorcycle.gltf','https://opengameart.org/content/custom-harley-davidson-flh-1972',(np.array(a['max'])-a['min']).tolist())
for key,source in [('asphalt','asphalt_02'),('grass','grass_ground')]:
    folder=OUT/key;folder.mkdir(exist_ok=True)
    for f in (STAGE/('staging-'+key)).iterdir():
        im=Image.open(f);im.thumbnail((512,512));im.save(folder/f.name,quality=85)
    assets[key]=entry(folder/'Diffuse.jpg','https://polyhaven.com/a/'+source)
    assets[key]['normal']='assets/environment/'+key+'/nor_gl.jpg'
    assets[key]['arm']='assets/environment/'+key+'/arm.jpg'
(OUT/'manifest.json').write_text(json.dumps({'version':1,'assets':assets},indent=2),encoding='utf-8')
print('Runtime assets MiB',sum(f.stat().st_size for f in (ROOT/'public/assets').rglob('*') if f.is_file())/1048576)
