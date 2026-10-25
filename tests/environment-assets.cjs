// Environment assets must be local, traceable CC0 files within the shared runtime budget.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..','public'),file=path.join(root,'assets/environment/manifest.json');
assert.ok(fs.existsSync(file),'environment manifest exists');
const manifest=JSON.parse(fs.readFileSync(file));assert.equal(manifest.version,1);
for(const key of ['tree','car','motorcycle','asphalt','grass']){
 const a=manifest.assets[key];assert.ok(a,`${key} registered`);assert.equal(a.license,'CC0');assert.match(a.source,/^https:\/\//);assert.match(a.licenseUrl,/^https:\/\//);
 assert.ok(a.file.startsWith('assets/environment/')&&!a.file.includes('..'),`${key} local file`);
 const data=fs.readFileSync(path.join(root,a.file));assert.equal(crypto.createHash('sha256').update(data).digest('hex'),a.sha256,`${key} digest`);
 if(['tree','car','motorcycle'].includes(key)){
  assert.ok(a.bounds?.length===3&&a.bounds.every(n=>n>0),`${key} metre bounds`);assert.equal(a.forward,'+z');
  const gltf=a.file.endsWith('.glb')?JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString().trim()):JSON.parse(data);
  assert.ok(gltf.meshes?.some(m=>m.primitives?.some(p=>p.attributes?.POSITION!==undefined)),`${key} mesh data`);
  for(const b of [...(gltf.buffers||[]),...(gltf.images||[])])assert.ok(!b.uri||!/^https?:/.test(b.uri),`${key} no remote dependency`);
  if(key!=='tree')assert.ok(a.bounds[2]>=(key==='car'?3.5:1.6)&&a.bounds[2]<=(key==='car'?5.5:2.5),`${key} realistic length`);
 }
}
function bytes(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?bytes(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0);}
const size=bytes(path.join(root,'assets'));assert.ok(size<=60*1024*1024,`runtime assets ${(size/1048576).toFixed(2)} MiB <=60`);
console.log(`PASS: CC0 environment manifest/digests/bounds/locality, runtime ${(size/1048576).toFixed(2)} MiB`);
