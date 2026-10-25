// Realistic-office assets: every manifest file exists, is credited as CC0, and the folder stays within 60 MB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pub=path.join(__dirname,'..','public'),dir=path.join(pub,'assets');
const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')),lic=fs.readFileSync(path.join(dir,'LICENSES.md'),'utf8');
const textureFiles=Object.values(m.textures).flatMap(t=>['1k','2k'].flatMap(tier=>Object.values(t[tier]||{})));
const modelFiles=Object.values(m.models).map(x=>x.file);
for(const f of [...textureFiles,...modelFiles,...Object.values(m.hdri)])assert.ok(fs.existsSync(path.join(pub,f)),`missing ${f}`);
for(const name of [...Object.keys(m.textures),...Object.keys(m.models),...Object.keys(m.hdri)])assert.match(lic,new RegExp(`\\| ${name} \\|`),`${name} credited`);
assert.ok(/CC0/.test(lic)&&!/CC-BY|CC BY|non-commercial/i.test(lic),'CC0 only');
const size=d=>fs.readdirSync(d,{withFileTypes:true}).reduce((s,e)=>s+(e.isDirectory()?size(path.join(d,e.name)):fs.statSync(path.join(d,e.name)).size),0);
const total=size(dir);assert.ok(total<=60*1024*1024,`assets ${Math.round(total/1048576)} MB > 60 MB`);
for(const f of modelFiles.filter(f=>f.endsWith('.glb')))assert.equal(fs.readFileSync(path.join(pub,f)).subarray(0,4).toString(),'glTF',f);
for(const f of modelFiles.filter(f=>f.endsWith('.gltf'))){const g=JSON.parse(fs.readFileSync(path.join(pub,f),'utf8'));for(const u of [...(g.buffers||[]),...(g.images||[])].map(x=>x.uri).filter(Boolean))assert.ok(fs.existsSync(path.join(pub,path.dirname(f),decodeURIComponent(u))),`${f} → ${u}`);}
for(const name of ['parquet_herringbone','wood_panel_walnut','plaster_white','fabric_sofa','rug_shaggy','metal_black'])assert.ok(m.textures[name]?.['1k']?.diff,`${name} texture`);
for(const name of ['desk','office_chair','monitor','keyboard','sofa_sectional','coffee_table_glass','pendant_lamp','plant_tall','painting','bookshelf','tv'])assert.ok(m.models[name],`${name} model`);
console.log(`PASS: ${Object.keys(m.textures).length} textures, ${Object.keys(m.models).length} models, HDRI; all CC0, ${Math.round(total/1048576)} MB`);
