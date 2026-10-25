// Named PBR surfaces (parquet, plaster, walnut, fabric...) from the CC0 texture set in assets/manifest.json.
// Low uses flat colours; Medium/High use the 1k maps; Ultra swaps the colour map to 2k. Exposed as window.officeSurfaces.
(() => {
  const THREE=window.THREE;
  // Base colour (tint under the texture, and the flat colour on Low), roughness, metalness, and world tile size in metres.
  const SPEC={
    parquet_herringbone:{color:0xc49a6c,rough:.55,metal:0,tile:2.2},
    wood_planks_light:{color:0xd8c3a0,rough:.6,metal:0,tile:2.4},
    plaster_white:{color:0xe9e4da,rough:.95,metal:0,tile:3},
    wood_panel_walnut:{color:0x6b4a32,rough:.5,metal:0,tile:2},
    concrete_ceiling:{color:0xb9b4ab,rough:.9,metal:0,tile:3},
    fabric_sofa:{color:0x8a8780,rough:.95,metal:0,tile:1},
    rug_shaggy:{color:0xe7e1d5,rough:1,metal:0,tile:1.5},
    rug_pattern:{color:0x8f8578,rough:1,metal:0,tile:1.5},
    metal_brushed:{color:0xb8bcc0,rough:.35,metal:1,tile:1},
    metal_black:{color:0x26262a,rough:.45,metal:.8,tile:1},
    leather_brown:{color:0x6a4330,rough:.55,metal:0,tile:1},
    marble_white:{color:0xeeebe6,rough:.25,metal:0,tile:1.5},
    brick_painted:{color:0xd9d2c6,rough:.9,metal:0,tile:2.5},
    asphalt:{color:0x5a5a5c,rough:.95,metal:0,tile:4},
    tiles_kitchen:{color:0xf2f0ec,rough:.3,metal:0,tile:1.2},
  };
  let manifest=null,tier=null,loading=Promise.resolve(),tierSeq=0;
  const failedTextures=new Set();
  const cache=new Map(),textures=new Map(),loader=new THREE.TextureLoader();
  const manifestReady=fetch('assets/manifest.json').then(r=>r.ok?r.json():null).catch(()=>null).then(m=>{manifest=m;return m;});
  function load(path,colour){
    if(textures.has(path))return textures.get(path);
    const promise=new Promise(resolve=>loader.load(path,t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(colour)t.colorSpace=THREE.SRGBColorSpace;resolve(t);},undefined,()=>{failedTextures.add(path);resolve(null);}));
    textures.set(path,promise);return promise;
  }
  // Every material that carries a surface, including clones made for fades, found through userData.surface.
  const registry=new Set();
  function surface(name,{repeat,tint}={}){
    const spec=SPEC[name];if(!spec)throw new Error(`Unknown surface ${name}`);
    const key=`${name}|${repeat||''}|${tint??''}`;if(cache.has(key))return cache.get(key);
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(tint??spec.color).convertSRGBToLinear(),roughness:spec.rough,metalness:spec.metal});
    m.userData.surface={name,repeat:repeat||[1,1],tint};registry.add(m);
    const clone=m.clone.bind(m);m.clone=()=>{const c=clone();c.userData.surface=m.userData.surface;registry.add(c);dress(c);c.clone=m.clone;return c;};
    cache.set(key,m);dress(m);return m;
  }
  // Repeat = surface size / tile size, so one texture tile covers the same real-world area on every mesh.
  const repeatFor=(spec,repeat)=>[Math.max(1,repeat[0]/spec.tile),Math.max(1,repeat[1]/spec.tile)];
  // Each material owns its repeated views of the shared textures; dispose them whenever the maps change.
  function clear(m){for(const k of ['map','normalMap','roughnessMap']){m[k]?.dispose();m[k]=null;}}
  async function dress(m){
    const {name,repeat,tint}=m.userData.surface,spec=SPEC[name],want=tier,base=tint??spec.color;
    if(!want||!manifest?.textures?.[name]){if(m.map||m.normalMap){clear(m);m.color.set(base).convertSRGBToLinear();m.needsUpdate=true;}return;}
    const entry=manifest.textures[name],maps=entry['1k'],diffPath=(want==='2k'&&entry['2k']?.diff)||maps.diff;
    const [diff,nor,rough]=await Promise.all([diffPath&&load(diffPath,true),maps.nor&&load(maps.nor),maps.rough&&load(maps.rough)]);
    if(tier!==want||!registry.has(m))return;
    const r=repeatFor(spec,repeat),view=t=>{if(!t)return null;const c=t.clone();c.repeat.set(r[0],r[1]);c.needsUpdate=true;return c;};
    clear(m);
    m.map=view(diff);m.normalMap=view(nor);m.roughnessMap=view(rough);
    // Under a colour texture the base colour is white, or the tint (division colour) lifted toward white.
    m.color.set(diff?(tint===undefined?0xffffff:new THREE.Color(tint).lerp(new THREE.Color(0xffffff),.35).getHex()):base).convertSRGBToLinear();
    m.needsUpdate=true;
  }
  async function setTier(next){
    const run=++tierSeq;tier=next||null;await manifestReady;if(run!==tierSeq)return;
    // Release maps for the tier no longer in use, then re-dress every surface material.
    if(!tier)for(const [path,promise] of textures){promise.then(t=>t?.dispose());textures.delete(path);}
    else for(const [path,promise] of textures)if(tier==='1k'&&path.includes('/2k/')){promise.then(t=>t?.dispose());textures.delete(path);}
    loading=Promise.all([...registry].map(dress));await loading;
  }
  // Cached base materials remain reusable; only detached fade clones need reclamation.
  function release(m){if(!registry.has(m)||[...cache.values()].includes(m))return false;registry.delete(m);clear(m);m.dispose();return true;}
  window.officeSurfaces={surface,setTier,release,tier:()=>tier,names:Object.keys(SPEC),stats:()=>({materials:registry.size,textures:textures.size,failed:[...failedTextures]}),ready:()=>manifestReady};
})();
