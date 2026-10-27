// Local CC0 exterior asset adapter. Geometry/maps are shared; per-instance transforms carry world placement.
(()=>{
  const T=window.THREE;
  // The parking slab, driveway crest and street are separate surfaces; these are their shared heights.
  const PARKING_Y=.03,RAMP_TOP_Z=12.5,RAMP_FOOT_Z=21,STREET_Y=-.86,ASPHALT_Y=-.862,GRASS_Y=-.878;
  function create({scene,parkingRoot,level='high',onWarning=()=>{}}){
    const city=new T.Group();city.name='realistic neighborhood';scene.add(city);
    const templates=new Map(),instances=new Map(),failed=[],owned=new Set(),groundMaps=new Map();
    let dead=false,loading=true,clock=0;
    const layout=structuredClone(window.officeEnvironmentLayout);
    // Ground textures keep their normal and ARM maps (AO/roughness/metal packed in R/G/B) so the street
    // reads as asphalt rather than a flat grey slab. Only the diffuse map needs sRGB.
    function loadGround(kind,meta){
      const set={};
      for(const [slot,file,srgb] of [['map',meta.file,true],['normalMap',meta.normal,false],['roughnessMap',meta.arm,false]]){
        if(!file)continue;
        const texture=new T.TextureLoader().load(file);
        texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;
        if(srgb)texture.colorSpace=T.SRGBColorSpace;
        owned.add(texture);set[slot]=texture;
      }
      if(set.map)groundMaps.set(kind,set);
    }
    const ready=(async()=>{let timer;try{await Promise.race([(async()=>{const response=await fetch('assets/environment/manifest.json');if(!response.ok)throw Error('manifest');const m=await response.json();for(const key of ['asphalt','grass'])loadGround(key,m.assets[key]);await Promise.all(['tree','car','motorcycle'].map(async key=>{try{const gltf=await new T.addons.GLTFLoader().loadAsync(m.assets[key].file);if(dead||!loading){gltf.scene.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat().filter(Boolean)){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});return;}templates.set(key,gltf.scene);}catch{failed.push(key);onWarning('Model lingkungan gagal: '+key);}}));})(),new Promise(resolve=>{timer=setTimeout(()=>{failed.push('timeout');onWarning('Model lingkungan lambat; kantor tetap berjalan.');resolve();},15000);})]);}catch{failed.push('manifest');onWarning('Aset lingkungan belum tersedia.');}finally{loading=false;clearTimeout(timer);}})();
    // Ordinary street paint colours; picked from the vehicle id so a car keeps its colour.
    const PAINTS=[0xd9d9d6,0x2b2f33,0x8a8f94,0x7a1f24,0x1f3550,0xe8e4da,0x3b4a3c];
    function spawn(kind,id,parent){if(!templates.has(kind))return null;const g=templates.get(kind).clone(true);let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;
      g.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=true;if(kind==='car'&&o.material?.name==='ToyCar'){o.material=o.material.clone();o.material.color.setHex(PAINTS[h%PAINTS.length]);owned.add(o.material);}});
      parent.add(g);instances.set(id,g);return g;}
    ready.then(()=>{if(dead)return;
      for(const [id,kind,x,z]of [['parked-car1','car',2,-5],['parked-car2','car',12,-5],['parked-motor1','motorcycle',3,3.5],['parked-motor2','motorcycle',6,3.5]]){const g=spawn(kind,id,parkingRoot);if(g)g.position.set(x,PARKING_Y,z);}
      const trees=[[-29,-18],[-30,6],[-25,17],[21,-22],[24,3],[23,17],[-12,-23],[4,-23],[-34,-6],[-22,16],[22,16],[-36,15],[34,12],[-36,-14],[34,-16]];
      for(const [i,p]of trees.entries()){const g=spawn('tree','tree'+i,city);if(g){g.position.set(p[0],-.89,p[1]);g.rotation.y=i*1.7;g.scale.setScalar(.62+(i%4)*.1);}}
    });
    // The driveway descends from the floor-1 slab (top .03) to the street (-.86). The lane points in
    // environment-layout use the same crest and foot, so wheels meet the mesh across the whole slope.
    const rampGeometry=new T.BufferGeometry();rampGeometry.setAttribute('position',new T.Float32BufferAttribute([3,PARKING_Y,RAMP_TOP_Z,13,PARKING_Y,RAMP_TOP_Z,13,STREET_Y,RAMP_FOOT_Z,3,STREET_Y,RAMP_FOOT_Z],3));rampGeometry.setIndex([0,2,1,0,3,2]);rampGeometry.computeVertexNormals();const ramp=new T.Mesh(rampGeometry,new T.MeshStandardMaterial({color:0xa2a19a,roughness:.95,side:T.DoubleSide}));ramp.receiveShadow=true;city.add(ramp);
    // Edge strips follow the grade and make the ramp seam readable.
    const grade=Math.atan2(PARKING_Y-STREET_Y,RAMP_FOOT_Z-RAMP_TOP_Z),edgeMaterial=new T.MeshStandardMaterial({color:0xfbfaf6,roughness:.85});
    for(const x of [3.15,12.85]){const strip=new T.Mesh(new T.BoxGeometry(.12,.014,8.55),edgeMaterial);strip.position.set(x,(PARKING_Y+STREET_Y)/2+.008,(RAMP_TOP_Z+RAMP_FOOT_Z)/2);strip.rotation.x=grade;strip.receiveShadow=true;city.add(strip);}
    function ground(kind,w,d,x,z){const set=groundMaps.get(kind);if(!set)return null;
      const clone=texture=>{if(!texture)return null;const copy=texture.clone();copy.repeat.set(w/4,d/4);copy.needsUpdate=true;owned.add(copy);return copy;};
      const map=clone(set.map),normalMap=clone(set.normalMap),roughnessMap=clone(set.roughnessMap);
      const material=new T.MeshStandardMaterial({map,normalMap,roughnessMap,roughness:1,metalness:0});
      if(normalMap)material.normalScale.set(kind==='grass'?.35:.6,kind==='grass'?.35:.6);
      const g=new T.Mesh(new T.PlaneGeometry(w,d),material);g.rotation.x=-Math.PI/2;
      g.position.set(x,kind==='grass'?GRASS_Y:ASPHALT_Y,z);g.receiveShadow=true;city.add(g);return g;}
    ready.then(()=>{if(!dead){ground('grass',66,46,-6,-4.5);ground('asphalt',290,6,0,24);ground('asphalt',6,166,34,-62);ground('asphalt',6,118,34,86);}});
    function update(snapshot,dt=0){
      if(dead)return;clock+=Math.max(0,Number(dt)||0);
      const live=new Set();
      for(const v of snapshot.vehicles){
        live.add(v.id);const parent=v.lane?city:parkingRoot,g=instances.get(v.id)||spawn(v.kind,v.id,parent);if(!g)continue;
        if(g.parent!==parent)parent.add(g);
        g.rotation.order='YXZ';g.position.set(...v.pose);g.rotation.x=Number.isFinite(v.pitch)?v.pitch:0;g.rotation.z=Number.isFinite(v.roll)?v.roll:0;g.rotation.y=v.heading;g.visible=true;
      }
      for(const [id,g]of instances){
        if(id.startsWith('parked-'))continue;
        if(id.startsWith('tree')){g.rotation.z=Math.sin(clock*.45+Number(id.slice(4)||0))*.012;continue;}
        if(!live.has(id)){g.traverse(o=>{if(o.isMesh&&owned.has(o.material)){owned.delete(o.material);o.material.dispose();}});g.removeFromParent();instances.delete(id);}
      }
    }
    function dispose(){dead=true;for(const g of templates.values())g.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat().filter(Boolean)){for(const v of Object.values(m))if(v?.isTexture)owned.add(v);m.dispose();}});for(const t of owned)t.dispose();city.traverse(o=>{if(o.isMesh&&!o.userData.model){o.geometry?.dispose();o.material?.dispose?.();}});city.removeFromParent();instances.clear();templates.clear();}
    return {ready:()=>ready,layout,update,setLevel:l=>{level=l;},setCityVisible:on=>{city.visible=!!on;},dispose,audit:()=>({loaded:[...templates.keys()],failed:[...failed],instances:instances.size,level})};
  }
  window.officeEnvironment={create};
})();
