// CC0 furniture models (Poly Haven, Kenney) from assets/manifest.json, loaded once before the office is built.
// place() fits a clone into the footprint the procedural piece used, so seats and the walking grid stay where they were.
(() => {
  const THREE=window.THREE,models=new Map(),failed=[];let loaded=0;
  // Colour by original brightness: dark parts become metal/black, light parts the fabric or casing colour.
  const shade=(dark,light)=>c=>c.getHSL({h:0,s:0,l:0}).l<.35?dark:light;
  const KENNEY_STYLE={office_chair:shade(0x2b2d31,0x3a3d42),monitor:shade(0x1b1c1f,0x2a2b2f),keyboard:shade(0x1d1e21,0x3b3c40)};
  const off=new URLSearchParams(location.search).get('models')==='off';
  async function load(){
    if(off)return {loaded:0,failed:[]};
    const manifest=await fetch('assets/manifest.json').then(r=>r.ok?r.json():null).catch(()=>null);
    if(!manifest)return {loaded:0,failed:['manifest']};
    const loader=new THREE.addons.GLTFLoader();
    await Promise.all(Object.entries(manifest.models).map(([name,{file}])=>loader.loadAsync(file).then(gltf=>{
      const scene=gltf.scene;
      scene.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;for(const m of [o.material].flat()){if(m.map)m.map.anisotropy=8;}
        // Transmission glass makes three.js render the whole scene a second time; thin lamp/clock glass reads the same as plain transparency.
        if(o.material.transmission>0)o.material=new THREE.MeshStandardMaterial({color:o.material.color,roughness:.1,metalness:0,transparent:true,opacity:.25,depthWrite:false});}});
      // Kenney pieces are flat-coloured toys; restyle them as real office kit (charcoal mesh chair, black monitor/keyboard).
      if(KENNEY_STYLE[name])scene.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshStandardMaterial({color:new THREE.Color(KENNEY_STYLE[name](o.material.color)).convertSRGBToLinear(),roughness:.6,metalness:.2});});
      // One draw per material: merge a model's meshes that share a material (books has 40 primitives).
      scene.updateMatrixWorld(true);const byMaterial=new Map();
      scene.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh){const k=o.material.uuid;if(!byMaterial.has(k))byMaterial.set(k,[]);byMaterial.get(k).push(o);}});
      for(const list of byMaterial.values()){if(list.length<2)continue;
        const geos=list.map(o=>{const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const n of Object.keys(g.attributes))if(!['position','normal','uv'].includes(n))g.deleteAttribute(n);return g;});
        const merged=THREE.addons.BufferGeometryUtils.mergeGeometries(geos);if(!merged)continue;
        const mesh=new THREE.Mesh(merged,list[0].material);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
        for(const o of list)o.parent.remove(o);}
      // Pivot at the footprint centre on the floor, so placement only needs a position.
      const box=new THREE.Box3().setFromObject(scene),centre=box.getCenter(new THREE.Vector3());
      const pivot=new THREE.Group();scene.position.set(-centre.x,-box.min.y,-centre.z);pivot.add(scene);
      pivot.userData.size=box.getSize(new THREE.Vector3());models.set(name,pivot);loaded++;
    }).catch(()=>{failed.push(name);})));
    failed.sort();return {loaded,failed};
  }
  const ready=load();
  // Fit inside w×h×d (any of them may be omitted) keeping proportions; rotY turns the model before fitting.
  // stretch:true fills w×h×d exactly (non-uniform) for pieces whose footprint must match, like desks.
  function place(name,{w,h,d,stretch}={},parent,{x=0,y=0,z=0,rotY=0}={}){
    const source=models.get(name);if(!source)return null;
    const copy=source.clone(true),size=source.userData.size.clone();
    if(Math.abs(Math.sin(rotY))>.7)[size.x,size.z]=[size.z,size.x];
    const scale=Math.min(...[[w,size.x],[h,size.y],[d,size.z]].filter(([want])=>want).map(([want,have])=>want/have));
    // Scale is in the model's own axes: a quarter turn swaps which local axis becomes world width.
    const swap=Math.abs(Math.sin(rotY))>.7;
    if(stretch)copy.scale.set((swap?d:w)/source.userData.size.x,h/source.userData.size.y,(swap?w:d)/source.userData.size.z);else copy.scale.setScalar(Number.isFinite(scale)?scale:1);copy.rotation.y=rotY;copy.position.set(x,y,z);
    // The walking grid blocks the requested footprint, the same space the procedural piece took.
    copy.userData.model=name;copy.userData.footprint={w:w||size.x*copy.scale.x,d:d||size.z*copy.scale.z,h:h||size.y*copy.scale.y};parent.add(copy);return copy;
  }
  window.officeModels3d={ready:()=>ready,place,has:name=>models.has(name),status:()=>({loaded,failed:[...failed]})};
})();
