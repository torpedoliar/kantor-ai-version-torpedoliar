// Textured humans must contain real skinning data, photographed skin and clothing, and stay within the asset budget.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../public/assets/people'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'people.json')));
for(const sex of ['male','female']){
 const g=JSON.parse(fs.readFileSync(path.join(dir,manifest.templates[sex]))),bin=fs.readFileSync(path.join(dir,g.buffers[0].uri));
 assert.ok(g.skins?.[0]?.joints.length>=20,'real skin skeleton');
 assert.ok(g.materials.some(m=>m.name==='skin'&&m.pbrMetallicRoughness.baseColorTexture),'photo skin');
 assert.ok(g.materials.some(m=>m.name==='clothes'&&m.pbrMetallicRoughness.baseColorTexture),'textured clothing');
 for(const m of g.meshes)for(const p of m.primitives){assert.ok(p.attributes.JOINTS_0!==undefined&&p.attributes.WEIGHTS_0!==undefined);const a=g.accessors[p.attributes.WEIGHTS_0],v=g.bufferViews[a.bufferView];for(let i=0;i<a.count;i++){let total=0;for(let j=0;j<4;j++)total+=bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*16+j*4);assert.ok(Math.abs(total-1)<1e-4,'normalized weights');}}
 for(const im of g.images)assert.ok(fs.existsSync(path.join(dir,im.uri)),'local texture');
 const meta=manifest.measurements[sex];assert.ok(meta.height>=1.6&&meta.height<=2);assert.ok(meta.headHeight/meta.height<.17);assert.ok(meta.vertices>5000,'actual human mesh, not capsule prototype');
}
assert.notDeepEqual(manifest.measurements.male,manifest.measurements.female,'distinct adult templates');
const size=d=>fs.readdirSync(d,{withFileTypes:true}).reduce((s,e)=>s+(e.isDirectory()?size(path.join(d,e.name)):fs.statSync(path.join(d,e.name)).size),0);
assert.ok(size(path.join(dir,'..'))<=60*1024*1024,'all runtime assets within60MiB');
console.log('PASS: local textured male/female skinned humans, normalized weights, adult proportions, asset budget');
