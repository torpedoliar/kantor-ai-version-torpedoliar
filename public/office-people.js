// Textured MakeHuman CC0 adults. Each clone owns its skeleton and tinted materials;
// immutable geometry/maps are shared. Logical pose controls preserve the existing office animation API.
(() => {
  const T=window.THREE,templates=new Map(),instances=new Set(),failed=[];
  const hash=name=>{let h=2166136261;for(const c of String(name)){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;};
  const skins=[0xfff0dc,0xe5c2a0,0xbb936f,0x926b4f],hairs=[0x241b17,0x4a3020,0x74502e,0x55504a];
  const ready=(async()=>{
    const manifest=await fetch('assets/people/people.json').then(r=>{if(!r.ok)throw Error('people manifest');return r.json();});
    await Promise.all(Object.entries(manifest.templates).map(async([sex,file])=>{
      try{const gltf=await new T.addons.GLTFLoader().loadAsync('assets/people/'+file);templates.set(sex,gltf.scene);}catch{failed.push(sex);}
    }));
  })().catch(()=>{failed.push('manifest');});
  const control=()=>new T.Group();
  function build(person,divisionColor){
    const seed=hash(person.n),sex=person.gender==='female'?'female':person.gender==='male'?'male':seed%2?'female':'male';
    const template=templates.get(sex);if(!template)return null;
    const figure=new T.Group(),body=new T.Group(),model=T.addons.SkeletonUtils.clone(template);figure.add(body);body.add(model);
    const buildIndex=(seed>>>9)%3,width=[.94,1,1.07][buildIndex],height=[.98,1,1.025][(seed>>>12)%3];model.scale.set(width,height,height);// depth follows height so sagittal (y/z) bone lengths, used by the IK, stay unsheared
    const bones=new Map();model.traverse(o=>{if(o.isBone)bones.set(o.name.replace(/([LR])$/,'.$1'),o);});
    const materials=[],shirtMaterials=[];
    const skin=skins[(seed>>>3)%skins.length],hair=hairs[(seed>>>6)%hairs.length];
    model.traverse(o=>{if(!o.isMesh)return;o.castShadow=o.receiveShadow=true;const m=o.material.clone();materials.push(m);o.material=m;m.envMapIntensity=.6;
      if(m.name==='skin')m.color.setHex(skin);
      if(m.name==='hair')m.color.setHex(hair);
      // Shirt and jeans share one atlas. The converter made the shirt panels neutral grey, so the division colour
      // is applied only to low-saturation texels and the denim keeps its own blue.
      if(m.name==='clothes'){
        m.userData.shirt={value:new T.Color(divisionColor)};o.userData.shirt=true;shirtMaterials.push(m);
        m.onBeforeCompile=shader=>{shader.uniforms.shirtColor=m.userData.shirt;
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 shirtColor;').replace('#include <map_fragment>',
            `#include <map_fragment>
            float spread=max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))-min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b));
            float shirtMask=1.0-smoothstep(.04,.10,spread);
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*shirtColor*1.9,shirtMask);`);};
        m.customProgramCacheKey=()=>'kantor-shirt';
      }
    });
    const hips=control(),head=control(),legs=[0,1].map(()=>({thigh:control(),knee:control()})),arms=[0,1].map(()=>({shoulder:control(),elbow:control()}));
    // The MakeHuman reference arms slope outward. Rotate that rest vector down before office poses are applied.
    for(const side of ['L','R']){
      const upper=bones.get('upperarm01.'+side),fore=bones.get('lowerarm01.'+side),wrist=bones.get('wrist.'+side);
      if(!upper||!fore||!wrist){model.traverse(o=>o.skeleton?.dispose());materials.forEach(m=>m.dispose());return null;}
      model.updateMatrixWorld(true);const start=upper.getWorldPosition(new T.Vector3()),end=fore.getWorldPosition(new T.Vector3());
      const down=new T.Vector3(0,-1,0),v=end.sub(start).normalize();upper.quaternion.setFromUnitVectors(v,down);
      model.updateMatrixWorld(true);const a=fore.getWorldPosition(new T.Vector3()),b=wrist.getWorldPosition(new T.Vector3());
      // Express the world forearm direction in the parent's neutral local frame before correction.
      const inv=fore.parent.getWorldQuaternion(new T.Quaternion()).invert();const dir=b.sub(a).normalize().applyQuaternion(inv),target=down.clone().applyQuaternion(inv);
      fore.quaternion.setFromUnitVectors(dir,target);
    }
    const cup=new T.Mesh(new T.CylinderGeometry(.035,.028,.09,10),new T.MeshStandardMaterial({color:0xece6db,roughness:.45}));cup.position.set(.03,-.04,.02);
    const phone=new T.Mesh(new T.BoxGeometry(.055,.11,.012),new T.MeshStandardMaterial({color:0x141414,roughness:.35}));phone.position.set(0,-.04,.02);
    const wrist=bones.get('wrist.R');wrist.add(cup,phone);cup.visible=phone.visible=false;
    // Existing office creates a cue under logical elbow; attach that control to the physical wrist during sync.
    const scale=sex==='male'?1.78:1.70,L={skin,hair,build:['slim','regular','broad'][buildIndex],height:scale*height,shoulder:.42*width,shirt:divisionColor,template:sex};
    // Seat drop is measured, not guessed: lower the hips from standing height to the chair seat (0.50 m incl. cushion).
    model.updateMatrixWorld(true);
    const standingHipY=bones.get('root').getWorldPosition(new T.Vector3()).y;
    const rig={figure,body,hips,head,legs,arms,cup,phone,look:L,shirtMaterials,seatDrop:standingHipY-.5,model,bones,materials};
    // First-person view hides what would sit in front of the eye camera: the skull/hair/eyes. The office toggles
    // rig.head.visible, so mirror that flag onto those meshes every sync.
    const headMeshes=[];model.traverse(o=>{if(o.isSkinnedMesh&&['hair','eyes'].includes(o.material.name))headMeshes.push(o);});
    // Pose angles use the legacy rig's convention: every joint rotates about world-aligned axes of its (posed)
    // parent, as nested groups without rest corrections did. Ancestors' rest corrections C are conjugated out
    // (q = C⁻¹·R·C·N), so the elbow hinge stays sagittal even though the upper arm's rest was re-aimed downward.
    const restOf=new Map([...bones.values()].map(b=>[b,b.quaternion.clone()])),ancestry=new Map();
    const accumulated=bone=>{if(ancestry.has(bone))return ancestry.get(bone);const p=bone.parent,q=p?.isBone?accumulated(p).clone().multiply(restOf.get(p)):new T.Quaternion();ancestry.set(bone,q);return q;};
    function rotate(name,x=0,y=0,z=0){const bone=bones.get(name);if(!bone)return;const C=accumulated(bone);
      bone.quaternion.copy(C).invert().multiply(new T.Quaternion().setFromEuler(new T.Euler(x,y,z))).multiply(C).multiply(restOf.get(bone));}
    rig.sync=()=>{
      rotate('root',hips.rotation.x,0,hips.rotation.z);rotate('head',head.rotation.x,head.rotation.y,head.rotation.z);
      ['R','L'].forEach((side,i)=>{
        rotate('upperleg01.'+side,legs[i].thigh.rotation.x);rotate('lowerleg01.'+side,legs[i].knee.rotation.x);
        rotate('upperarm01.'+side,arms[i].shoulder.rotation.x,0,arms[i].shoulder.rotation.z);rotate('lowerarm01.'+side,arms[i].elbow.rotation.x);
      });
      if(rig.cue&&rig.cue.parent!==wrist){wrist.add(rig.cue);rig.cue.position.set(0,0,-.55);}
      for(const m of headMeshes)m.visible=head.visible;
    };
    // Two-bone planar IK in the body's sagittal plane (y up, z forward), seated reference pose.
    // Limb lengths come from the real skeleton; target defaults to keyboard height on the desk edge.
    const lengthOf=(a,b)=>{model.updateMatrixWorld(true);return bones.get(a).getWorldPosition(new T.Vector3()).distanceTo(bones.get(b).getWorldPosition(new T.Vector3()));};
    const upperLen=lengthOf('upperarm01.R','lowerarm01.R'),foreLen=lengthOf('lowerarm01.R','wrist.R');
    const shoulderY=bones.get('upperarm01.R').getWorldPosition(new T.Vector3()).y,hipY=bones.get('root').getWorldPosition(new T.Vector3()).y;
    rig.reach=(target={dy:.99-(hipY-rig.seatDrop)-(shoulderY-hipY),dz:.42})=>{
      // dy: keyboard height relative to seated shoulder; dz: forward distance from shoulder to keyboard.
      const lean=.12,dz=target.dz,dy=target.dy,d=Math.min(upperLen+foreLen-.01,Math.hypot(dy,dz));
      const elbowAngle=Math.PI-Math.acos(Math.max(-1,Math.min(1,(upperLen*upperLen+foreLen*foreLen-d*d)/(2*upperLen*foreLen))));
      const toTarget=Math.atan2(dz,-dy),inner=Math.acos(Math.max(-1,Math.min(1,(upperLen*upperLen+d*d-foreLen*foreLen)/(2*upperLen*d))));
      // Office convention: negative x rotation swings the arm forward. The elbow hangs below the shoulder-target
      // line (shoulder = toTarget - inner), then the forearm bends forward onto the target.
      return {shoulder:-(toTarget-inner),elbow:-elbowAngle,lean};
    };
    rig.dispose=()=>{instances.delete(rig);materials.forEach(m=>m.dispose());model.traverse(o=>o.skeleton?.dispose());cup.geometry.dispose();cup.material.dispose();phone.geometry.dispose();phone.material.dispose();};
    instances.add(rig);rig.sync();return rig;
  }
  function audit(){let skinned=0,photoSkin=0,clothed=0;const skeletons=new Set();let sharedSkeletons=0;
    for(const r of instances){let skin=false,clothes=false,sk=false;r.model.traverse(o=>{if(!o.isSkinnedMesh)return;sk=true;if(o.material.name==='skin'&&o.material.map)skin=true;if(o.material.name==='clothes'&&o.material.map)clothes=true;});if(sk)skinned++;if(skin)photoSkin++;if(clothes)clothed++;const first=r.model.getObjectByProperty('isSkinnedMesh',true)?.skeleton.bones[0];if(skeletons.has(first))sharedSkeletons++;skeletons.add(first);}
    return {loaded:templates.size,failed:[...failed],skinned,photoSkin,clothed,sharedSkeletons};}
  window.officePeople={ready:()=>ready,build,audit};
})();
