// Fetch asset data only, into a new staging directory. Never executes files from downloaded packages.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const destination=path.resolve(process.argv[2]||`.superpowers/environment-download-${Date.now()}`);
await fs.mkdir(destination,{recursive:false});
const sources={
  car:{url:'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb',file:'ToyCar.glb'},
  motorcycle:{url:'https://opengameart.org/sites/default/files/FLH1200.zip',file:'FLH1200.zip'},
};
const record=[];
async function fetchFile(url,relative){const file=path.resolve(destination,relative);if(!file.startsWith(destination+path.sep))throw Error('Unsafe path');const res=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!res.ok)throw Error(`${res.status} ${url}`);const bytes=Buffer.from(await res.arrayBuffer());await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);record.push({url,file:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
for(const [key,s]of Object.entries(sources))await fetchFile(s.url,`${key}/${s.file}`);
for(const asset of ['island_tree_01','asphalt_02','grass_ground']){
 const res=await fetch(`https://api.polyhaven.com/files/${asset}`);if(!res.ok)throw Error(`${asset} catalog unavailable`);const data=await res.json();
 if(asset==='island_tree_01'){const model=data.gltf['1k'].gltf;await fetchFile(model.url,`${asset}/tree.gltf`);for(const [rel,v]of Object.entries(model.include))await fetchFile(v.url,`${asset}/${rel}`);}
 else for(const key of ['Diffuse','nor_gl','arm'])await fetchFile(data[key]['1k'].jpg.url,`${asset}/${key}.jpg`);
}
await fs.writeFile(path.join(destination,'sources.json'),JSON.stringify(record,null,2));console.log(`Downloaded data to ${destination}; inspect before conversion.`);
