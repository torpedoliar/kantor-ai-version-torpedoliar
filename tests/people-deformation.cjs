// A real arm/knee skin deformation must move the local limb but leave the opposite side unchanged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../public/assets/people');
for(const sex of ['male','female']){
 const g=JSON.parse(fs.readFileSync(path.join(root,sex+'.gltf'))),b=fs.readFileSync(path.join(root,sex+'.bin'));
 const parents=new Map();g.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
 const bones=g.skins[0].joints,by=new Map(g.nodes.map((n,i)=>[n.name,i]));
 const read=i=>{const a=g.accessors[i],v=g.bufferViews[a.bufferView],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],bytes=a.componentType===5123?2:4,off=(a.byteOffset||0)+(v.byteOffset||0);return Array.from({length:a.count},(_,j)=>Array.from({length:n},(_,k)=>a.componentType===5126?b.readFloatLE(off+(j*n+k)*bytes):b.readUInt16LE(off+(j*n+k)*bytes)));};
 const world=i=>{let t=[...(g.nodes[i].translation||[0,0,0])];if(parents.has(i)){const p=world(parents.get(i));t=t.map((x,k)=>x+p[k]);}return t;};
 for(const name of ['lowerarm01.L','lowerleg01.L']){
  const joint=by.get(name),pivot=world(joint),desc=new Set();const walk=i=>{desc.add(i);(g.nodes[i].children||[]).forEach(walk);};walk(joint);
  let moved=0,stationary=0;
  for(const m of g.meshes.filter(m=>['skin','clothes'].includes(m.name)))for(const p of m.primitives){const pos=read(p.attributes.POSITION),js=read(p.attributes.JOINTS_0),ws=read(p.attributes.WEIGHTS_0);
   for(let i=0;i<pos.length;i++){const v=pos[i],r=[0,0,0];for(let k=0;k<4;k++){let q=v;if(desc.has(bones[js[i][k]])){const y=v[1]-pivot[1],z=v[2]-pivot[2];q=[v[0],pivot[1]-z,pivot[2]+y];}for(let j=0;j<3;j++)r[j]+=q[j]*ws[i][k];}assert.ok(r.every(Number.isFinite));const d=Math.hypot(...r.map((x,j)=>x-v[j]));if(v[0]<-.1){assert.ok(d<1e-4,'opposite side must remain unchanged');stationary++;}if(v[0]>.1&&d>.02)moved++;}
  }
  assert.ok(moved>20&&stationary>100,`${sex} ${name}: meaningful localized skinning`);
 }
}
console.log('PASS: adult arm/knee skin weights deform locally without moving the opposite side');
