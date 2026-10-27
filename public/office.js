(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = message => { $('sceneStatus').textContent = message; };
  if (!window.THREE) { status('Kantor 3D gagal dimuat. Periksa koneksi internet, lalu muat ulang.'); return; }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas: $('c'), antialias: true}); }
  catch { status('Browser ini belum bisa menampilkan WebGL. Coba browser dengan akselerasi grafis.'); return; }
  // Initials and floor signage are drawn into canvases, so the web fonts must be ready first.
  await window.officeModels3d?.ready();
  // A stalled people download must not block the office; without both templates it uses the legacy figures.
  await Promise.race([window.officePeople?.ready(),new Promise(resolve=>setTimeout(resolve,20000))]);
  // Textured humans only when both templates loaded; otherwise the whole office (desk layout included) uses the legacy figures.
  const PEOPLE=window.officePeople?.audit().loaded===2?window.officePeople:null;
  await Promise.race([
    Promise.all(['700 20px "IBM Plex Mono"', '600 60px Archivo'].map(font => document.fonts.load(font))).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const PAPER = 0xebe5d8, CARD = 0xf7f3eb, INK = 0x2a2622, BALSA = 0xdebd8e, DARK = 0x4a453e, SCREEN = 0xa9c6c9, ACCENT = 0x385747;
  const scene = new THREE.Scene();
  // Hazy daylight sky behind the cut-away building (was a flat paper colour).
  const SKY_INDOOR=0x8c9aa6,SKY_HAZE=0xa9b6c0;
  scene.background = new THREE.Color(SKY_INDOOR);
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .1, 500);
  const ambient=new THREE.HemisphereLight(0xdfe9f5, 0x8a7a66, 1.1);scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe7c7, 2.2);
  sun.position.set(-12, 55, 25); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left:-45, right:45, top:55, bottom:-40, near:1, far:130});
  sun.shadow.bias = -.001; scene.add(sun);
  // Graphics level: pixel ratio, shadows, environment reflections, texture tier and post-processing per officeGraphics.
  const GFX=window.officeGraphics,ADD=THREE.addons;let composer=null,envMap=null,gfxLevel=null,gfxPending=false,showFps=false,gfxSeq=0,moodEnvFactor=1;
  const fpsLabel=document.createElement('div');fpsLabel.id='fpsLabel';fpsLabel.className='fps-label';fpsLabel.hidden=true;document.body.append(fpsLabel);
  let envSource=null;
  async function environmentMap(){
    if(envMap)return envMap;const pmrem=new THREE.PMREMGenerator(renderer);
    const manifest=await fetch('assets/manifest.json').then(r=>r.ok?r.json():null).catch(()=>null);
    const hdr=manifest?.hdri?.interior&&await new ADD.RGBELoader().loadAsync(manifest.hdri.interior).catch(()=>null);
    if(hdr){envMap=pmrem.fromEquirectangular(hdr).texture;hdr.dispose();envSource='hdri';}else{envMap=pmrem.fromScene(new ADD.RoomEnvironment(),.04).texture;envSource='room';}
    pmrem.dispose();return envMap;
  }
  function buildComposer(L){
    composer?.passes.forEach(pass=>pass.dispose?.());composer?.dispose?.();composer=null;
    if(!L.ao&&!L.bloom)return;
    composer=new ADD.EffectComposer(renderer);composer.addPass(new ADD.RenderPass(scene,camera));
    const half=new THREE.Vector2(innerWidth/2,innerHeight/2);
    if(L.ao){const sao=new ADD.SAOPass(scene,camera,half);Object.assign(sao.params,{saoIntensity:.012,saoScale:4,saoKernelRadius:40,saoBlur:true});composer.addPass(sao);}
    if(L.bloom)composer.addPass(new ADD.UnrealBloomPass(half,.35,.6,.85));
    composer.addPass(new ADD.OutputPass());resizeComposer();
  }
  function resizeComposer(){
    if(!composer)return;composer.setSize(innerWidth,innerHeight);
    const ao=composer.passes.find(p=>p instanceof ADD.SAOPass);ao?.setSize(Math.max(1,Math.floor(innerWidth*renderer.getPixelRatio()/2)),Math.max(1,Math.floor(innerHeight*renderer.getPixelRatio()/2)));
  }
  async function applyGraphics(level){
    const run=++gfxSeq,L=GFX.LEVELS[level];gfxLevel=level;gfxPending=true;
    const report=()=>{const failed=window.officeSurfaces?.stats?.().failed||[],hdrFailed=L.env&&envSource==='room';if(failed.length||hdrFailed)status(`Sebagian aset foto gagal dimuat (${failed.length+(hdrFailed?1:0)}); memakai material atau pencahayaan cadangan.`);};
    renderer.setPixelRatio(Math.min(devicePixelRatio,L.pixelRatio));renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=!!L.shadow;renderer.shadowMap.type=L.shadow>=2048?THREE.PCFSoftShadowMap:THREE.PCFShadowMap;
    sun.castShadow=!!L.shadow;if(L.shadow){sun.shadow.mapSize.set(L.shadow,L.shadow);sun.shadow.map?.dispose();sun.shadow.map=null;}renderer.shadowMap.needsUpdate=true;
    renderer.toneMapping=L.env?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;renderer.toneMappingExposure=L.env?.85:1;
    const environment=L.env?await environmentMap():null;
    if(run!==gfxSeq)return; // A newer choice wins even when this HDRI request finishes later.
    scene.environment=environment;
    // Materials must recompile when shadow/tone-mapping settings change.
    // Reflections are subtle (0.6): the HDRI lights metal, glass and gloss without washing out matte walls.
    scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if('envMapIntensity' in m)m.envMapIntensity=.6*moodEnvFactor;m.needsUpdate=true;});});
    buildComposer(L);
    await window.officeSurfaces?.setTier?.(L.textures);
    if(run!==gfxSeq)return;
    report();
    if(run===gfxSeq)gfxPending=false;
  }
  // info.autoReset is off so draw calls add up across all post-processing passes of one frame.
  renderer.info.autoReset=false;
  // The whole-building view casts shadows from five floors at once. Architecture there never moves, so refresh the
  // shadow map at most every .25s (people and cars move slowly at that distance) instead of every frame.
  let shadowAge=0,shadowCached=false;
  function setShadowCaching(on){shadowCached=on;renderer.shadowMap.autoUpdate=!on;renderer.shadowMap.needsUpdate=true;shadowAge=0;}
  function renderFrame(dt=0){renderer.info.reset();if(shadowCached&&(shadowAge+=dt)>=.25){renderer.shadowMap.needsUpdate=true;shadowAge=0;}if(composer)composer.render();else renderer.render(scene,camera);}
  const FLOOR = {
    1: {name:'Barber & parking', title:'Where every day starts.', description:'A barber on one side, parking on the other.'},
    2: {name:'Kitchen & dining', title:'Meet at the table.', description:'A shared kitchen and long tables where the whole team eats together.'},
    3: {name:'Workspace', title:'Room for everyone.', description:'An open floor with four desk groups, a glass meeting room, phone booths, a pantry, two lounges and a prayer room.'},
    4: {name:'Rooftop', title:'Take a break upstairs.', description:'A garden terrace with a pergola lounge, ping pong, bean bags, a swing, chess, yoga mats, billiards and a coffee bar.'},
  };
  const floorName=level=>level===3&&ORDER.length>4?'Lantai kerja 1':level>ROOF?`Lantai kerja ${level-ROOF+1}`:FLOOR[level]?.name||`Lantai ${level}`;
  const GROUPS = {
    leadership: {name:'Leadership', x:-5.5, z:-3.5, color:0x2f4a6b},
    marketing: {name:'Marketing & Business', x:5.5, z:-3.5, color:0xb4623a},
    engineering: {name:'Engineering & Design', x:-5.5, z:6.5, color:0x3f7a58},
    service: {name:'Customer Service', x:5.5, z:6.5, color:0x74598c}
  };
  // Static-host fallback; the organization roster is applied after the task API connects.
  const TEAM = [
    {n:'Koh Arman', initials:'KA', gender:'male', role:'CEO', group:'leadership'},
    {n:'Koh Wira', initials:'KW', gender:'male', role:'CTO', group:'leadership'},
    {n:'Kak Rani', initials:'KR', gender:'female', role:'Social Media Specialist', group:'marketing'},
    {n:'Kak Dewi', initials:'KD', gender:'female', role:'Digital Marketing', group:'marketing'},
    {n:'Mira', initials:'M', gender:'female', role:'Business Development', group:'marketing'},
    {n:'Tari', initials:'T', gender:'female', role:'Social Media Intern', group:'marketing'},
    {n:'Bagas Pratama Putra', initials:'BPP', gender:'male', role:'Frontend Engineer', group:'engineering'},
    {n:'Rizky Hakim', initials:'RH', gender:'male', role:'Backend Engineer', group:'engineering'},
    {n:'Yoga', initials:'Y', gender:'male', role:'Product Design', group:'engineering'},
    {n:'Bang Eko', initials:'BE', gender:'male', role:'Graphic Designer', group:'engineering'},
    {n:'Gilang', initials:'G', gender:'male', role:'Customer Service Leader', group:'service'},
    {n:'Kak Sinta', initials:'KS', gender:'female', role:'Customer Service', group:'service'},
    {n:'Kak Laras', initials:'KL', gender:'female', role:'Customer Service', group:'service'}
  ];
  // Division metadata from the latest seating plan, falling back to the seed groups.
  const divisionMeta={};
  const metaOf=id=>divisionMeta[id]||GROUPS[id]||{name:id||'—',color:0x8a8479};
  const softShapes=new Map();
  const floors = {}, materials = new Map(), agents = [];
  const customItems=[], customById=new Map(); let customSeq=0;
  function registerCustom(type,floor,group,x,z,rotDeg,opts={}){
    const id=opts.id||`c${++customSeq}`;
    const match=/^c(\d+)$/.exec(id);if(match)customSeq=Math.max(customSeq,Number(match[1]));
    const symmetric=!!opts.symmetric;
    const item={id,type,floor,group,x,z,y:opts.y||0,rot:rotDeg,home:{x,z,rot:rotDeg},radius:opts.radius||.6,symmetric,rotatable:opts.rotatable??!symmetric,seatRefs:[],activityRefs:new Set(),scale:opts.scale||1,isExtra:!!opts.isExtra,catalog:opts.catalog||type,isPreview:!!opts.isPreview,unique:!!opts.unique};
    if(opts.sub)item.sub=opts.sub;
    group.userData.customId=id;group.traverse(o=>{o.userData.customId=id;});
    customItems.push(item);customById.set(id,item);return item;
  }
  const buildFloor=()=>root?.userData?.floor||3;
  // Seat links: owner seats sit exactly on the item (chairs), followers keep an offset (lounge/billiard spots).
  const linkSpot=(item,spot,owner=true)=>{spot.itemId=item.id;spot._item=item;if(owner){spot._ref=[item,item.seatRefs.push(spot)-1];}else{spot._dx=spot.x-item.x;spot._dz=spot.z-item.z;spot._ref=[item,-1];item.seatRefs.push(spot);}return spot;};
  let root, activeFloor = 3, selected = null, paused = false, simTime = 0, garage = null;
  let routineOn = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const linear = color => new THREE.Color(color).convertSRGBToLinear();
  const hex = color => '#' + color.toString(16).padStart(6, '0');
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  // Floors keep stable ids (1 lobby, 2 dining, 3 first work floor, 4 rooftop, 5+ extra work floors);
  // ORDER is the building from the ground up, so extra work floors slot in under the rooftop.
  const ROOF=4,ORDER=[1,2,3,4],workId=k=>k===1?3:k+3,isWork=level=>level===3||level>ROOF;
  const passage = level => isWork(level) ? 1.5 : 0;
  // Storey height: the tallest interior (walls, beams, rooftop canopy) is 3.5, plus the 0.48 slab and a little air.
  const FLOOR_GAP=4.4, orderOf=level=>{const i=ORDER.indexOf(level);return i<0?level-1:i;}, floorY=level=>orderOf(level)*FLOOR_GAP;
  const stairways={}, travelRoot=new THREE.Group();scene.add(travelRoot);

  // Glass: thin, slightly reflective physical material (no paper-model toon steps or ink edges).
  const glassMaterial = new THREE.MeshPhysicalMaterial({color:linear(0xc4dadb), roughness:.05, metalness:0, transparent:true, opacity:.3, depthWrite:false});
  // Roof glass is clearer than wall glass so the rooftop stays readable from above.
  const roofGlassMaterial = new THREE.MeshPhysicalMaterial({color:linear(0xd6e6e8), roughness:.05, metalness:0, transparent:true, opacity:.13, depthWrite:false});
  function material(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({color:linear(color), roughness:.78, metalness:0}));
    return materials.get(color);
  }
  const TERRACOTTA=0xc98f72, SAGE=0xb3c0a0, SAGE_DARK=0x7f9a82, RUST=0xc27a52;
  // Palette colours map to real surfaces: floors/walls/ceilings by shape, furniture parts by colour role.
  const SURFACE_OF={[CARD]:'plaster_white',[BALSA]:'wood_planks_light',[DARK]:'metal_black',[INK]:'metal_black',0x8a8479:'metal_brushed',0xa9a397:'metal_brushed',
    0xd3cbba:'concrete_ceiling',0xdcd6ca:'wood_planks_light',0xefe8da:'wood_planks_light',0xf1ece1:'parquet_herringbone',0xddd3bf:'wood_planks_light',
    0xe2cdb0:'parquet_herringbone',0xddc5a5:'parquet_herringbone',0xe8d5b9:'parquet_herringbone',0xe8e1d3:'tiles_kitchen',0x8a5a3c:'leather_brown',
    0xc9a577:'wood_panel_walnut',0xb89c70:'wood_panel_walnut',0xcdb28a:'wood_panel_walnut',0xe0c7a5:'wood_planks_light',[RUST]:'fabric_sofa',[SAGE]:'fabric_sofa',[SAGE_DARK]:'fabric_sofa',[TERRACOTTA]:'fabric_sofa',
    0xa9a8a3:'asphalt',0x9dab90:'fabric_sofa',0x86968a:'fabric_sofa',0xa98158:'leather_brown',0xefeae0:'plaster_white',0x595d54:'metal_black',0xe4dfd3:'brick_painted',0xf1eee7:'brick_painted'};
  // Roles for colours computed at build time (division-tinted upholstery and rugs).
  const tinted=new Map();const tint=(color,name)=>{tinted.set(color,name);return color;};
  function surfaceFor(geometry,color){
    const name=SURFACE_OF[color]||tinted.get(color);if(!name||!window.officeSurfaces||!geometry.parameters?.width)return null;
    const {width:w,height:h,depth:d}=geometry.parameters;
    // A box's largest face decides the tile repeat; thin wide slabs are floors, tall thin boxes are walls.
    const face=h<=Math.min(w,d)?[w,d]:w<d?[d,h]:[w,h];
    return window.officeSurfaces.surface(name,{repeat:face,tint:tinted.has(color)&&!SURFACE_OF[color]?color:undefined});
  }
  function mesh(geometry, color, x, y, z, parent = root, edges = true) {
    // A single material draws the whole geometry once; Box/Cylinder face groups would cost a draw call each.
    geometry.clearGroups();
    const glass = color === 'glass' || color === 'roofglass';
    const m = new THREE.Mesh(geometry, color === 'roofglass' ? roofGlassMaterial : glass ? glassMaterial : surfaceFor(geometry,color) || material(color));
    m.position.set(x, y, z); m.castShadow = !glass; m.receiveShadow = true;
    parent.add(m); return m;
  }
  function box(w,h,d,color,x,y,z,parent) { return mesh(new THREE.BoxGeometry(w,h,d),color,x,y+h/2,z,parent); }
  function cylinder(rt,rb,h,color,x,y,z,parent) { return mesh(new THREE.CylinderGeometry(rt,rb,h,16),color,x,y+h/2,z,parent); }
  function textPlane(text,x,z,width,color='#5c554b',parent=root) {
    const c=document.createElement('canvas'); c.width=1024;c.height=128;
    const ctx=c.getContext('2d');ctx.font='600 60px Archivo, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,512,64,980);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(width,width/8),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2;m.position.set(x,.08,z);parent.add(m);return m;
  }
  function oval(w,h,d,color,x,y,z,parent=root){
    const m=mesh(new THREE.SphereGeometry(1,16,12),color,x,y,z,parent,false);m.scale.set(w/2,h/2,d/2);return m;
  }
  const model=(name,size,at={})=>window.officeModels3d?.place(name,size,root,at)||null;
  // Decor: a model added only for realism. Pieces below 0.6 m are marked walkable so they never block a path.
  function decor(name,size,parent,at={}){const o=window.officeModels3d?.place(name,size,parent,at);if(!o)return null;o.userData.decor=name;if((size.h||o.userData.footprint.h)<.6)o.userData.walkable=true;return o;}
  // Flat decor made from surfaces (rugs, window mullions), counted like models.
  function decorBox(kind,w,h,d,surfaceName,x,y,z,parent,walkable=true){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),window.officeSurfaces?window.officeSurfaces.surface(surfaceName,{repeat:[w,d]}):material(0x8a8479));m.position.set(x,y+h/2,z);m.receiveShadow=true;m.castShadow=h>.05;m.userData.decor=kind;m.userData.walkable=walkable;parent.add(m);return m;}
  function plant(x,z,scale=1,y=0) {
    const g=new THREE.Group();g.position.set(x,y,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    if(!model(scale<=.5?'plant_small':'plant_tall',{w:.75*scale,h:1.45*scale,d:.75*scale},{rotY:x*1.7}))for(let i=-1;i<7;i++){
      if(i<0){cylinder(.32*scale,.24*scale,.55*scale,0xc9ab86,0,0,0);box(.04,.9*scale,.04,0x6a5944,0,.45*scale,0);continue;}
      const a=i*2.4,leaf=oval(.32*scale,.68*scale,.12*scale,i%2?0x64825b:0x839769,Math.cos(a)*.25*scale,(.75+i*.1)*scale,Math.sin(a)*.25*scale,g);
      leaf.rotation.set(.35, a,Math.sin(a)*.6);
    }
    root=atRoot;atRoot.add(g);
    return registerCustom('plant',floor,g,x,z,0,{radius:.35*scale,scale,symmetric:true,y});
  }
  function chair(x,z,f,color=DARK) {
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    // Facing lives only on the group (item.rot), so a later placeCustom/reseat cannot flip the chair twice.
    // Built facing +z: the backrest sits behind the sitter at -z.
    g.rotation.y=f>0?0:Math.PI;
    if(!model('office_chair',{w:.88,h:1.1,d:.86})){
    cylinder(.055,.15,.46,0x595d54,0,0,0);
    for(let i=0;i<5;i++){const a=i*Math.PI*2/5;box(.06,.06,.65,DARK,0,.08,0).rotation.y=a;oval(.13,.13,.13,DARK,Math.sin(a)*.3,.08,Math.cos(a)*.3,g);}
    const upholstery=tint(mix(color,0xd5d8bf,.42),'fabric_sofa');
    mesh(softBox(.87,.19,.8),upholstery,0,.52,0,g,false);
    mesh(softBox(.88,.84,.22),upholstery,0,.94,-.37,g,false);}
    root=atRoot;atRoot.add(g);
    return registerCustom('chair',floor,g,x,z,f>0?0:180,{radius:.5});
  }
  function table(x,z,w=5,d=1.9,modules=Math.max(1,Math.round(w/2)),twoSided=false) {
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    const desks=modules;
    // The desk model's modesty panel is on its -z side; two-sided tables are two back-to-back rows, open sides outward.
    const rows=twoSided?[[-d/4,Math.PI],[d/4,0]]:[[0,0]];
    if(!window.officeModels3d?.has('desk')||!rows.flatMap(([rz,rotY])=>Array.from({length:desks},(_,i)=>model('desk',{w:w/desks,h:.99,d:twoSided?d/2:d,stretch:true},{x:-w/2+(i+.5)*w/desks,z:rz,rotY}))).every(Boolean)){
      mesh(softBox(w,.16,d),BALSA,0,.91,0,g,false);
      for(const sx of [-1,1])for(const sz of [-1,1])box(.1,.85,.1,DARK,sx*(w/2-.25),0,sz*(d/2-.2));}
    root=atRoot;atRoot.add(g);
    return registerCustom('table',floor,g,x,z,0,{radius:Math.hypot(w,d)/2});
  }
  // Three animated desk screens: code editor, document and chart. One shared canvas per design updates every monitor.
  const deskScreens=[];
  const screenContent=(()=>{
    const make=draw=>{const c=document.createElement('canvas');c.width=256;c.height=160;const g=c.getContext('2d');
      const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
      draw(g,0);const material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
      deskScreens.push({texture,draw:t=>{draw(g,t);texture.needsUpdate=true;},last:-1});return material;};
    return [
      make((g,t)=>{g.fillStyle='#1e2430';g.fillRect(0,0,256,160);g.fillStyle='#151b24';g.fillRect(0,0,256,18);g.fillStyle='#8fa7b8';g.font='600 9px monospace';g.fillText('app.js',10,12);
        const cols=['#7fb3ff','#c3e88d','#f78c6c','#c792ea','#e6e6e6'],scroll=Math.floor(t*20)%90;
        for(let i=0;i<18;i++){const y=26+((i*10+scroll)%142);g.fillStyle='#4b5a66';g.fillRect(8,y,3,4);g.fillStyle=cols[i%5];g.fillRect(14+((i*13)%30),y,55+((i*37)%105),4);}
        if(Math.floor(t*2)%2===0){g.fillStyle='#d7e5ee';g.fillRect(14+((18*13)%30),26+((18*10+scroll)%142),3,8);}}),
      make((g,t)=>{g.fillStyle='#f4f2ee';g.fillRect(0,0,256,160);g.fillStyle='#2b2b2b';g.fillRect(20,14,140,8);g.fillStyle='#8a8a8a';
        const visible=4+Math.floor((t*2.2)%9);for(let i=0;i<12;i++)if(i<visible)g.fillRect(20,32+i*9,200-((i*29)%70),3);
        const at=Math.min(11,Math.max(0,Math.floor((t*1.4)%12)));g.fillStyle='rgba(240,165,49,.22)';g.fillRect(15,30+at*9,222,8);
        if(Math.floor(t*3)%2===0){g.fillStyle='#2f6b4f';g.fillRect(20+(visible*13)%110,32+Math.min(11,visible)*9,2,7);}}),
      make((g,t)=>{g.fillStyle='#10171f';g.fillRect(0,0,256,160);g.strokeStyle='rgba(120,150,170,.16)';g.lineWidth=1;
        for(let y=34;y<140;y+=20){g.beginPath();g.moveTo(16,y);g.lineTo(244,y);g.stroke();}
        g.fillStyle='#8fa7b8';g.font='600 9px monospace';g.fillText('TRAFFIC · LIVE',16,13);
        g.strokeStyle='#3ad29f';g.lineWidth=3;g.beginPath();
        for(let i=0;i<=10;i++){const x=20+i*22,v=Math.sin(i*.7+t*.9)+Math.sin(i*.28+t*.37)*.6,y=104-v*16;if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}g.stroke();
        for(let i=0;i<7;i++){const h=14+Math.abs(Math.sin(t*.8+i*.55))*34;g.fillStyle='#e8a33d';g.fillRect(24+i*32,140-h,16,h);}
        g.fillStyle='#5f9a94';g.fillRect(16,148,70,4);g.fillStyle='#324450';g.fillRect(92,148,52,4);}),
    ];
  })();
  function screen(x,z,f,dual=false,keyboardZ=z-f*.46) {
    if(window.officeModels3d?.has('monitor')){
      for(const offset of (dual?[-.38,.38]:[0])){
        const mon=model('monitor',{w:dual?.7:1.05},{x:x+offset,y:.99,z,rotY:f>0?Math.PI:0});
        // Kenney computerScreen.glb has an 8° tilted display. These are its inner face coordinates,
        // kept inside the bezel; the monitor's parent scale turns them into the visible screen.
        const panel=new THREE.Mesh(new THREE.PlaneGeometry(.345,.215),screenContent[(Math.abs(Math.round(x*7+offset*3))%screenContent.length)]);
        panel.rotation.x=-Math.atan2(.0325193,.2313867);
        panel.position.set(0,.171279+.0006*Math.sin(-panel.rotation.x),-.000069+.0006*Math.cos(panel.rotation.x));
        panel.userData.decor='screen';panel.userData.walkable=true;mon.add(panel);
      }
      model('keyboard',{w:.55},{x,y:.99,z:keyboardZ,rotY:f>0?Math.PI:0});return;
    }
    for(const offset of (dual?[-.38,.38]:[0])){
      box(.07,.17,.07,DARK,x+offset,.97,z);box(dual?.7:1.1,.66,.07,DARK,x+offset,1.14,z);
      box(dual?.61:1,.54,.015,SCREEN,x+offset,1.2,z-f*.045);
    }
    box(.65,.03,.23,0x8a8479,x,.97,keyboardZ);
    cylinder(.09,.08,.16,CARD,x+.7,.97,z-f*.42);
  }
  function sofa(x,z,w=4,rotation=0) {
    const g=new THREE.Group();root.add(g);g.position.set(x,0,z);g.rotation.y=rotation;
    const real=window.officeModels3d?.place('sofa_sectional',{w,h:.95,d:1.15,stretch:true},g,{rotY:Math.PI/2});
    if(real)return registerCustom('sofa',buildFloor(),g,x,z,Math.round(rotation*180/Math.PI),{radius:Math.hypot(w,1.1)/2});
    mesh(softBox(w,.5,1.1),0xb8c3a6,0,.25,0,g,false);
    mesh(softBox(w,.85,.3),0x9dab90,0,.6,-.48,g,false);
    for(const side of [-1,1]){
      mesh(softBox(.3,.65,1.1),0x9dab90,side*w/2,.4,-.05,g,false);
      const cushion=mesh(softBox(.55,.55,.2),side>0?0xd5b49b:0xe8ddc8,side*(w/2-.55),.75,-.22,g,false);cushion.rotation.z=side*.16;
    }
    return registerCustom('sofa',buildFloor(),g,x,z,Math.round(rotation*180/Math.PI),{radius:Math.hypot(w,1.1)/2});
  }
  const doorPads=[];
  function stairs(level) {
    doorPads.push(box(2,.12,2.6,0xcfc8ba,-16.8,-.12,7));
    textPlane('STAIRS',-14.2,6.9,2.5);
  }
  // Restroom: a closed, roofed box with a door and a WC sign. Nothing inside is modelled, for privacy.
  // (cx, cz) is the centre, (w, d) the size along x and z, and face the side the door is on.
  const wcTexture=(()=>{
    const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d');
    ctx.fillStyle='#1f2433';ctx.fillRect(0,0,256,128);ctx.fillStyle='#fff';ctx.font='700 72px Archivo, system-ui, sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('WC',128,68);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
  })();
  function restroom(cx,cz,w,d,face){
    const g=new THREE.Group();g.position.set(cx,0,cz);g.rotation.y={'+z':0,'+x':Math.PI/2,'-z':Math.PI,'-x':-Math.PI/2}[face];root.add(g);
    // Local +z is the door side; turning by 90 degrees swaps width and depth.
    const [lw,ld]=face[1]==='x'?[d,w]:[w,d],H=2.4,side=(lw-1)/2;
    box(lw,H,.12,0xefeae0,0,0,-ld/2+.06,g);
    for(const s of [-1,1])box(.12,H,ld,0xefeae0,s*(lw/2-.06),0,0,g);
    for(const s of [-1,1])box(side,H,.12,0xefeae0,s*(lw/2-side/2),0,ld/2-.06,g);
    box(1,H-2.1,.12,0xefeae0,0,2.1,ld/2-.06,g);
    box(lw+.1,.1,ld+.1,0xe2dccf,0,H,0,g);
    box(.94,2.06,.06,BALSA,0,.02,ld/2-.04,g);box(.06,.06,.12,DARK,.34,1,ld/2+.02,g);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(.5,.25),new THREE.MeshBasicMaterial({map:wcTexture}));
    sign.position.set(side>.6?-(.5+side/2):0,side>.6?1.55:2.25,ld/2+.005);g.add(sign);
    // The roof carries the label too, so the box reads as a restroom from above.
    const roofSign=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.65),new THREE.MeshBasicMaterial({map:wcTexture}));
    // Added to the floor, not the rotated box, so it always reads upright from the front camera.
    roofSign.rotation.x=-Math.PI/2;roofSign.position.set(cx,H+.12,cz);root.add(roofSign);
    return g;
  }
  const facing = spot => spot.angle ?? (spot.f>0?0:Math.PI);
  const seat = (x,z,f,floor,aisle,extra={}) => ({x,z,f,floor,route:[[aisle,passage(floor)],[aisle,z]],...extra});
  function shell(level) {
    root=new THREE.Group();root.userData.floor=level;floors[level]=root;scene.add(root);
    box(33,.48,25,0xd3cbba,0,-.48,0);
    box(32,.03,24,{1:0xdcd6ca,2:0xefe8da,3:0xf1ece1,4:0xddd3bf}[level]??0xf1ece1,0,0,0);
    if(!isWork(level)||level>ROOF){
      box(32,level===4?.85:2.4,.22,CARD,0,0,-12);
      if(level!==4)for(const x of [-12,-4,4,12])box(5.5,1.35,.05,SCREEN,x,.82,-11.86);
    }
    box(.22,level===4?.85:1.1,17.5,CARD,-16,0,-3.25);
    box(.22,level===4?.85:1.1,3.5,CARD,-16,0,10.25);
    box(.22,level===4?.85:1.1,24,CARD,16,0,0);
    // Floor 1 leaves the parking half of the front open for cars.
    if(level===1)box(16,.28,.22,CARD,-8,0,12);else box(32,.28,.22,CARD,0,0,12);
    if(level===2||isWork(level)){
      for(let row=0;row<24;row++)for(let col=0;col<4;col++){
        box(7.98,.003,.985,[0xe2cdb0,0xddc5a5,0xe8d5b9][(row+col)%3],-12+col*8,.032,-11.5+row);
      }
    }
    stairs(level);
  }

  shell(1);
  const floorBreaks=[];
  box(.16,2.4,15,CARD,-2,0,-4.3);
  box(13,.02,23,0xe8e1d3,-9.3,.02,0);
  for(const x of [-11,-6]){
    box(2.5,1.8,.08,DARK,x,.55,-10.9);box(2.28,1.58,.02,SCREEN,x,.66,-10.84);
    box(2.7,.12,.7,BALSA,x,.9,-10.3);
    cylinder(.48,.55,.16,0x8a8479,x,0,-8);cylinder(.09,.09,.55,0xa9a397,x,.16,-8);
    box(1.15,.2,1.2,DARK,x,.6,-8);box(1.15,1,.2,DARK,x,.7,-7.5);
    for(const s of [-1,1])box(.14,.25,1,0x8a8479,x+s*.66,.8,-8);
    box(.85,.12,.6,0xa9a397,x,.23,-9);
  }
  sofa(-7,7,4);table(-7,9,2,.9);plant(-3.5,10.7);
  // Cashier counter near the barber exit.
  box(2.6,1,.8,BALSA,-13.5,0,2.5);box(2.7,.06,.9,CARD,-13.5,1,2.5);box(.5,.35,.4,DARK,-13.1,1.06,2.4);box(.4,.04,.3,0x8a8479,-13.9,1.06,2.6);
  textPlane('CASHIER',-13.5,4.6,3.2);
  cylinder(.16,.16,2,CARD,-3,0,-10.5);
  for(let i=0;i<8;i++)cylinder(.17,.17,.13,i%2?CARD:0xb4523a,-3,.2+i*.21,-10.5);
  textPlane('BARBER',-8,-3,7);textPlane('PARKING',7,8.7,8);
  for(const x of [2,7,12]){
    box(.07,.004,8,CARD,x-2.3,.03,-5);box(4.6,.004,.07,CARD,x,.03,-9);
  }
  // Sectional garage door across the open parking half; it rolls up when a car is inside or approaching.
  {
    const width=15.8,group=new THREE.Group();group.position.set(8,3.0,12.75);group.userData.walkable=true;floors[1].add(group);
    for(let i=0;i<8;i++){const y=-.35-i*.37;box(width,.35,.08,0x6f7a80,0,y,0,group);box(width-.36,.2,.02,0x9aa5aa,0,y+.065,.055,group);}
    box(width+.2,.14,.16,0x2a2e32,0,-2.97,0,group);
    for(const x of [.06,15.94])box(.14,3.05,.2,0x2a2e32,x,.03,12.78,floors[1]);
    box(width+.3,.28,.5,0x2a2e32,8,2.78,12.78,floors[1]);
    garage={group,open:0};
  }
  // Parked vehicles are local detailed CC0 models placed by officeEnvironment.
  textPlane('ENTRANCE',7,11,4);
  restroom(-14.5,10.6,2.7,2.5,'-z');
  for(const [x,z] of [[5,10],[10,10]])floorBreaks.push({x,z,f:Math.PI,floor:1,route:[[5,8],[x,8],[x,z]],state:'break',standing:true,label:'Istirahat dekat pintu masuk'});

  // Floor 2: back counter, an island on a terracotta rug, one long table, a coffee bar and a reading corner.
  shell(2);
  function stool(x,z,h=.75) {
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    if(!model('stool',{w:.56,h:h+.12,d:.56})){
    for(const a of [.8,2.4,4,5.5])box(.05,h,.05,DARK,Math.cos(a)*.2,0,Math.sin(a)*.2);
    cylinder(.26,.26,.04,DARK,0,h*.35,0);
    mesh(softBox(.56,.12,.56),CARD,0,h+.06,0,g,false);}
    root=atRoot;atRoot.add(g);
    return registerCustom('chair',floor,g,x,z,0,{radius:.35});
  }
  function diningChair(x,z,f,color) {
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    if(!model('dining_chair',{w:.62,h:.98,d:.75},{rotY:f>0?Math.PI:0})){
    for(const sx of [-1,1])for(const sz of [-1,1])box(.05,.5,.05,DARK,sx*.3,0,sz*.3);
    mesh(softBox(.75,.12,.72),color,0,.56,0,g,false);
    mesh(softBox(.75,.62,.14),color,0,.92,-f*.33,g,false);}
    root=atRoot;atRoot.add(g);
    return registerCustom('chair',floor,g,x,z,f>0?0:180,{radius:.5});
  }
  // Floor 2 has no ceiling to hang from, so light stands on the floor.
  function floorLamp(x,z) {
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    if(!model('arc_lamp',{h:2.1,w:.7,d:.7})){
    cylinder(.28,.3,.05,DARK,0,0,0);box(.04,1.9,.04,DARK,0,.05,0);
    cylinder(.18,.32,.36,SAGE_DARK,0,1.85,0);}oval(.16,.16,.16,0xfff4d6,0,1.9,0,g);
    root=atRoot;atRoot.add(g);
    return registerCustom('lamp',floor,g,x,z,0,{radius:.35,symmetric:true});
  }
  // Back counter with open shelves along the window wall.
  box(24,.95,1.8,0xcdb28a,1,0,-10.5);box(24,.1,1.9,CARD,1,.95,-10.5);
  for(const x of [-9,-6,-3,0,3,6,9,12])box(.03,.85,.03,0x8c7965,x,.05,-9.58);
  box(2,.04,1.3,0x8a8479,-5,1.05,-10.5);box(1.55,.05,.96,0xc9d3d1,-5,1.08,-10.5);
  cylinder(.045,.045,.5,0xa9a397,-5,1.1,-11);
  box(2.3,.05,1.3,DARK,3,1.05,-10.5);
  for(const x of [2.5,3.5])for(const z of [-10.8,-10.2])cylinder(.23,.23,.04,0x8a8479,x,1.1,z);
  box(1.8,2.5,1.8,0xd9d9d0,13.6,0,-10.4);box(1.55,.035,.03,DARK,13.6,1.65,-9.48);
  box(1,.6,.8,DARK,-9,1.05,-10.5);cylinder(.12,.12,.2,CARD,-9,1.05,-9.9);
  for(const x of [-7,5])box(7,.07,.5,BALSA,x,1.95,-11.6);
  for(let i=0;i<7;i++){
    cylinder(.14,.14,.3,i%3?CARD:SAGE,-9.8+i*.55,2.02,-11.6);
    cylinder(.14,.14,.26,i%2?0xa9a397:CARD,3.2+i*.5,2.02,-11.6);
  }
  plant(-4.4,-11.6,.45,2.02);plant(7.8,-11.6,.45,2.02);
  // Island: stone top on a slatted balsa base, stools on the dining side.
  box(9.4,.02,4.6,TERRACOTTA,-3,.035,-5.4);
  box(8,.95,1.5,BALSA,-3,0,-5.6);
  for(let i=0;i<21;i++)box(.05,.9,.03,0xc9a577,-6.8+i*.38,.03,-4.84);
  mesh(softBox(8.4,.12,1.9),0xf1ede4,-3,1.01,-5.6,root,false);
  box(1.2,.03,.8,0x8a8479,-5.2,1.08,-5.8);cylinder(.035,.035,.45,0xa9a397,-5.2,1.1,-6.1);
  cylinder(.35,.25,.16,BALSA,-1.8,1.08,-5.7);for(let i=0;i<4;i++)oval(.2,.2,.2,0xd99a4e,-1.9+(i%2)*.18,1.24+(i>>1)*.08,-5.7+(i%3)*.1-.1);
  plant(1,-5.8,.35,1.08);
  for(const x of [-6,-4.5,-3,-1.5,0])stool(x,-3.9);
  // Coffee bar in the back-right corner.
  box(5,.02,6.4,SAGE,11.6,.035,-5);
  box(1,1,3,BALSA,15.3,0,-5);box(1.1,.06,3.1,CARD,15.3,1,-5);
  box(.7,.55,.55,DARK,15.3,1.06,-5.6);box(.5,.12,.12,0x8a8479,15,1.3,-5.6);
  for(let i=0;i<5;i++)cylinder(.1,.08,.14,CARD,15.2,1.06,-4.8+i*.25);
  box(.9,1,.06,DARK,15.8,1.6,-3.4);
  cylinder(.25,.4,1.02,DARK,11.8,0,-5);
  mesh(softBox(1.2,.1,4.8),0xf1ede4,11.8,1.08,-5,root,false);
  for(const z of [-6.6,-5,-3.4])stool(10.7,z,1);
  cylinder(.07,.07,.24,0xc4dadb,11.9,1.13,-4.2);plant(12,-6.6,.3,1.13);
  // One long table on a sage rug seats the whole team.
  box(15,.02,5.6,SAGE,-1,.035,5);
  const dining=[];
  const diningTableItem=table(-1,5,12.4,2.2);
  for(let i=0;i<7;i++)for(const side of [-1,1]){
    const x=-6.1+i*1.7,z=5+side*1.75;
    const item=diningChair(x,z,-side,side<0?CARD:0xd9cdb6);
    const spot=linkSpot(item,seat(x,z,-side,2,x<-1?-8.8:7,{state:'break',label:'Menuju makan siang'}));
    cylinder(.23,.23,.02,CARD,x,.99,5+side*.6);cylinder(.08,.08,.18,0xc4dadb,x+.45,.99,5+side*.6);
    dining.push(spot);
  }
  plant(-1,5,.4,.99);cylinder(.3,.22,.12,BALSA,1.6,.99,5);for(let i=0;i<3;i++)oval(.2,.2,.2,0x9bb06b,1.5+i*.12,1.12,5);
  floorLamp(-9.4,9.2);floorLamp(9.4,8.8);
  // Reading corner: round rug, two armchairs and a pinned board.
  cylinder(3,3,.02,0xd8cfc0,11.6,.03,6.4);
  function armchair(x,z,r,color=RUST){
    const g=new THREE.Group();root.add(g);g.position.set(x,0,z);g.rotation.y=r;
    if(window.officeModels3d?.place('armchair',{w:1.05,h:1,d:1},g,{rotY:Math.PI}))return registerCustom('sofa',buildFloor(),g,x,z,Math.round(r*180/Math.PI),{radius:.8});
    mesh(softBox(1.1,.45,1),color,0,.35,0,g,false);mesh(softBox(1.1,.75,.25),color,0,.75,-.42,g,false);
    for(const s of [-1,1])mesh(softBox(.22,.55,.9),tint(mix(color,INK,.1),'fabric_sofa'),s*.5,.45,-.02,g,false);
    for(const s of [-1,1])for(const t of [-1,1])box(.05,.14,.05,DARK,s*.4,0,t*.35,g);
    return registerCustom('sofa',buildFloor(),g,x,z,Math.round(r*180/Math.PI),{radius:.8});
  }
  for(const [x,z,r] of [[10.2,5.4,.7],[12.8,7.9,-2.3]])armchair(x,z,r);
  cylinder(.55,.55,.06,BALSA,11.6,.5,6.6);cylinder(.06,.1,.5,DARK,11.6,0,6.6);box(.4,.03,.3,DARK,11.5,.56,6.5);
  const board=new THREE.Group();root.add(board);board.position.set(14.2,0,4.4);board.rotation.y=-.9;
  box(2.2,1.4,.06,CARD,0,.9,0,board);for(const s of [-1,1])box(.06,2.3,.06,DARK,s*1.05,0,0,board);
  for(let i=0;i<5;i++)box(.34,.3,.02,[0xf0d27a,0xe8b8a0,0xc9d9c6][i%3],-.7+(i%3)*.6,1.6-(i>>1)*.5-(i%2)*.1,.05,board);
  plant(-12.2,-8.4);plant(15,-1.2,.8);restroom(-14.4,-10.55,2.9,2.6,'+z');plant(-14.3,10.4,.9);plant(15,10.5,.8);plant(7.2,10.6,.7);
  textPlane('SHARED KITCHEN',-3,-1.9,7);textPlane('COFFEE BAR',11.8,-.9,5);textPlane('DINING',-1,9.5,7);

  // Floor 3: one open room, layered by rugs, a board partition, a low shelf, glass rooms and hanging lamps.
  shell(3);
  const P3=passage(3);
  box(6.2,3.5,.22,CARD,-12.9,0,-12);
  box(25.8,.9,.22,CARD,3.1,0,-12);box(25.8,.45,.22,CARD,3.1,3.05,-12);
  for(let i=0;i<=6;i++)box(.2,2.15,.22,CARD,-9.8+i*25.8/6,.9,-12);
  box(25.8,2.15,.04,'glass',3.1,.9,-12.03);
  for(const z of [-3.5,6.5]){for(const x of [-15.8,15.8])box(.4,3.5,.4,CARD,x,0,z);box(31.6,.22,.3,CARD,0,3.28,z);}
  const desks={};
  // Desk areas sit in the four corners of a work floor; each is one team table with up to eight seats.
  const SLOTS=[{x:-5.5,z:-3.5},{x:5.5,z:-3.5},{x:-5.5,z:6.5},{x:5.5,z:6.5}];
  const colorOf=value=>typeof value==='number'?value:parseInt(String(value||'#8a8479').replace('#',''),16)||0x8a8479;
  const signText=label=>{const text=String(label||'').toUpperCase();return text.length>40?text.slice(0,39)+'…':text;};
  // Builds one area into its own group so a re-plan can drop it whole; returns the seat spot per person.
  function buildDeskArea(level,area){
    const slot=SLOTS[area.slot],color=colorOf(area.color),group=new THREE.Group(),atRoot=root;
    group.userData.floor=level;group.userData.deskArea=true;floors[level].add(group);root=group;
    const n=area.seats.length,full=n>2,cols=full?Math.min(4,Math.ceil(n/2)):2;
    // One desk module per seat column, seat centred on it, so knees land in the legroom between drawer pedestals.
    const module=1.8,xs=Array.from({length:cols},(_,c)=>(c-(cols-1)/2)*module);
    mesh(softBox(cols>2?9.4:8.6,.04,full?6.6:4.4),tint(mix(color,0xf1ece1,.55),'rug_pattern'),slot.x,.02,slot.z+(full?0:.9),root,false);
    const tableItem=table(slot.x,slot.z,cols*module,full?2.3:1.7,cols,full);tableItem.generated=true;
    const sign=signText(area.label);textPlane(sign,slot.x,slot.z>0?10.35:.35,8);
    const seats={},items=[tableItem];
    area.seats.forEach((name,index)=>{
      // Seat clearance follows the active rig: the legacy chibi head projects far forward, the textured adult does
      // not, so adults sit close enough for their hands to rest on the keyboard at the table edge.
      const halfDepth=(full?2.3:1.7)/2,seatOffset=PEOPLE?halfDepth+.30:1.85;
      const side=full?(index<cols?-1:1):1,f=-side,x=slot.x+xs[index%cols],z=slot.z+side*seatOffset;
      const item=chair(x,z,f,color);item.generated=true;items.push(item);
      // Adults: monitor stands back on the desk, keyboard on the near edge. Legacy rig keeps its original layout.
      if(PEOPLE)screen(x,slot.z+side*(halfDepth-.5),f,cols===2&&area.divisionId==='engineering',slot.z+side*(halfDepth-.17));
      else screen(x,slot.z+side*.72,f,cols===2&&area.divisionId==='engineering');
      // Beside the monitor, clear of its stand (dual screens fill the module, so no decor there).
      if(index%2===0&&!(cols===2&&area.divisionId==='engineering'))decor(index%4===0?'mug':'books',{h:index%4===0?.12:.22},root,{x:x+.62+(index%4===0?.03:.2),y:.99,z:slot.z+side*(PEOPLE?halfDepth-.5:.72)});
      if(cols===2){const notebook=mesh(softBox(.35,.04,.45),0xe6dbc4,x-.72,.99,slot.z+side*.9,root,false);notebook.rotation.y=.12;const pot=plant(x+.55,slot.z+side*.1,.24,.97);pot.generated=true;items.push(pot);}
      seats[name]=linkSpot(item,seat(x,z,f,level,slot.x<0?-10.5:area.slot===1?9:10));
      seats[name].cx=slot.x;
    });
    // Pendants hang from the ceiling beam above each team table.
    for(const dx of [-1.6,1.6]){if(!decor('pendant_lamp',{h:.62},root,{x:slot.x+dx,y:2.32,z:slot.z})){box(.03,.88,.03,DARK,slot.x+dx,2.4,slot.z);cylinder(.07,.34,.3,0x5f7d68,slot.x+dx,2.12,slot.z);}oval(.16,.16,.16,0xfff1cf,slot.x+dx,2.1,slot.z);}
    root=atRoot;
    return {group,items,seats,sign};
  }
  let deskAreas=[];
  function seatAreas(plan){
    for(const area of deskAreas){area.group.parent?.remove(area.group);for(const item of area.items){const i=customItems.indexOf(item);if(i>=0)customItems.splice(i,1);customById.delete(item.id);}}
    deskAreas=[];for(const key of Object.keys(desks))delete desks[key];
    plan.floors.forEach((floor,k)=>{for(const area of floor.areas){
      const built=buildDeskArea(workId(k+1),area);built.label=area.label;deskAreas.push(built);
      for(const [name,spot] of Object.entries(built.seats)){spot.areaLabel=area.label;desks[name]=spot;}
      divisionMeta[area.divisionId]={...(divisionMeta[area.divisionId]||{}),color:colorOf(area.color)};
    }});
  }
  const seedOrg={divisions:Object.entries(GROUPS).map(([id,g])=>({id,name:g.name,areaName:'',color:hex(g.color),lead:TEAM.find(p=>p.group===id)?.n||'',collaboratesWith:[]})),
    members:TEAM.map(p=>({name:p.n,initials:p.initials,role:p.role,division:p.group,manager:null,active:true}))};
  for(const d of seedOrg.divisions)divisionMeta[d.id]={name:d.name,color:colorOf(d.color)};
  seatAreas(window.OrgModel.planSeating(seedOrg));
  // Task board between Leadership and Marketing, readable from both sides. It lists the real open tasks.
  // It faces the front of the room so the default camera can read it.
  const taskBoard=new THREE.Group();root.add(taskBoard);taskBoard.position.set(0,0,-3.5);
  box(2.8,1.5,.1,CARD,0,.55,0,taskBoard);
  for(const x of [-1.2,1.2])box(.08,.55,.08,DARK,x,0,0,taskBoard);
  const boardCanvas=document.createElement('canvas');boardCanvas.width=1024;boardCanvas.height=528;
  const boardTexture=new THREE.CanvasTexture(boardCanvas);boardTexture.colorSpace=THREE.SRGBColorSpace;boardTexture.anisotropy=4;
  for(const side of [-1,1]){
    const face=new THREE.Mesh(new THREE.PlaneGeometry(2.7,1.39),new THREE.MeshBasicMaterial({map:boardTexture}));
    face.position.set(0,1.3,side*.056);face.rotation.y=side>0?0:Math.PI;taskBoard.add(face);
  }
  const taskBoardItem=registerCustom('whiteboard',3,taskBoard,0,-3.5,0,{radius:1.45,rotatable:false,unique:true,sub:'task'});
  // Low shelf between Engineering and Customer Service keeps the room open while giving it a back and front.
  box(.6,1.15,5.2,BALSA,0,0,6.8);
  for(const y of [.38,.76])box(.62,.03,5.22,0xb89c70,0,y,6.8);
  for(let i=0;i<10;i++)box(.4,.26+(i%3)*.04,.1+(i%2)*.06,[0x2f4a6b,CARD,0xb4623a,0x3f7a58,0x74598c][i%5],0,.42,4.6+i*.44);
  plant(0,5.2,.55,1.15);plant(0,8.4,.55,1.15);
  // Glass meeting room, back left.
  box(5.9,.02,5.3,0xe6ded0,-12.9,.02,-9.25);
  box(4.1,2.4,.05,'glass',-13.95,0,-6.5);box(.7,2.4,.05,'glass',-10.15,0,-6.5);box(.05,2.4,5.5,'glass',-9.8,0,-9.25);
  for(const [x,z] of [[-11.9,-6.5],[-10.5,-6.5],[-9.8,-6.5],[-9.8,-11.9]])box(.1,2.45,.1,DARK,x,0,z);
  box(6.2,.08,.1,DARK,-12.9,2.4,-6.5);box(.1,.08,5.5,DARK,-9.8,2.4,-9.25);
  table(-13.2,-9,2.8,1.4).sub='meeting';
  box(2.2,1.1,.08,DARK,-13.2,1.1,-11.82);box(2,.95,.02,SCREEN,-13.2,1.17,-11.77);
  textPlane('MEETING ROOM',-12.9,-5.8,4.6);
  // Doors swing open on their own when someone comes within reach, then close again.
  const doors=[];
  function door(hx,hz,width,base,color){
    // Doors swing out of the way, so the walking grid treats them as open.
    const pivot=new THREE.Group();pivot.position.set(hx,0,hz);pivot.rotation.y=base;pivot.userData.walkable=true;root.add(pivot);
    box(width-.04,2.2,.05,color,width/2,0,0,pivot);box(.04,.04,.2,DARK,width-.15,1.05,0,pivot);
    const center=new THREE.Vector3(width/2,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),base).add(new THREE.Vector3(hx,0,hz));
    doors.push({pivot,base,center,floor:3,open:0});
  }
  door(-11.9,-6.5,1.4,0,'glass');
  const hangouts=[];
  for(const x of [-14.2,-13.2,-12.2])for(const [z,f] of [[-10.35,1],[-7.65,-1]]){
    const item=chair(x,z,f,0x8a7a66);
    hangouts.push(linkSpot(item,{x,z,f,floor:3,room:'seed-meeting',route:[[-11.2,P3],[-11.2,z]],state:'meet',label:'Menuju ruang rapat',occupant:null}));
  }
  // Two phone booths, front left.
  for(const x of [-14.6,-12.4]){
    box(1.9,.02,1.9,0xe6ded0,x,.02,10.5);
    box(.05,2.3,1.9,'glass',x-.95,0,10.5);box(.05,2.3,1.9,'glass',x+.95,0,10.5);box(1.9,2.3,.05,'glass',x,0,11.45);
    box(1.95,.08,.08,DARK,x,2.3,9.55);box(1.95,.08,.08,DARK,x,2.3,11.45);
    for(const dx of [-.725,.725])box(.45,2.3,.05,'glass',x+dx,0,9.55);door(x-.5,9.55,1,0,'glass');
    box(.08,.08,1.95,DARK,x-.95,2.3,10.5);box(.08,.08,1.95,DARK,x+.95,2.3,10.5);
    box(1.6,1.1,.04,0x86968a,x,.9,11.38);box(.9,.05,.35,BALSA,x,.95,11.2);
    cylinder(.24,.24,.48,DARK,x,0,10.7);
    hangouts.push({x,z:10.6,f:-1,floor:3,route:[[-11,P3],[-11,8.8],[x,8.8]],state:'call',label:'Menuju bilik telepon',occupant:null});
  }
  textPlane('PHONE BOOTH',-13.5,8.9,4.4);
  // Pantry and lounge, back right.
  box(4.6,.9,.8,0xcdb28a,11.8,0,-11.2);box(4.7,.06,.9,CARD,11.8,.9,-11.2);
  box(.45,.55,.45,CARD,10.4,.96,-11.25);cylinder(.2,.2,.45,0xc4dadb,10.4,1.51,-11.25);
  box(.5,.6,.42,DARK,13.2,.96,-11.3);for(const x of [12.1,12.4])cylinder(.08,.07,.16,CARD,x,.96,-11);
  textPlane('PANTRY',11.8,-8.9,3.6);
  // Pantry and lounge share one glass room with its door on the aisle.
  box(.05,2.4,7.8,'glass',9.6,0,-8.1);box(5.2,2.4,.05,'glass',13.4,0,-4.2);
  for(const [x,z] of [[9.6,-4.2],[10.8,-4.2],[9.6,-11.9]])box(.1,2.45,.1,DARK,x,0,z);
  box(.1,.08,7.8,DARK,9.6,2.4,-8.1);box(6.4,.08,.1,DARK,12.8,2.4,-4.2);
  door(9.6,-4.2,1.2,0,'glass');
  box(3.2,.02,4,0xe3d9c6,14.2,.02,-7.5);
  const loungeSofa=sofa(15,-7.5,3.4,-Math.PI/2);box(.8,.4,1,BALSA,13.1,0,-7.5);
  cylinder(.2,.25,.05,DARK,15.3,0,-4.9);box(.04,1.6,.04,DARK,15.3,.05,-4.9);cylinder(.12,.3,.3,CARD,15.3,1.6,-4.9);
  textPlane('LOUNGE',13.6,-5.3,3.6);
  for(const x of [10.6,12.6])hangouts.push({x,z:-10.2,f:-1,floor:3,route:[[10,P3],[10,-10.2]],state:'drink',label:'Menuju pantry',occupant:null});
  for(const z of [-8.3,-6.7])hangouts.push(linkSpot(loungeSofa,{x:14.75,z,f:-1,angle:-Math.PI/2,floor:3,route:[[10,P3],[10,z]],state:'lounge',label:'Menuju lounge',occupant:null},false));
  // One reader in front of the task board, one behind it (reached around the board's right edge).
  linkSpot(taskBoardItem,{x:0,z:-2.5,f:-1,angle:Math.PI,floor:3,route:[[0,P3]],state:'look',label:'Menuju papan tugas',occupant:null},false);
  linkSpot(taskBoardItem,{x:0,z:-4.5,f:1,angle:0,floor:3,route:[[1.95,P3],[1.95,-4.5]],state:'look',label:'Menuju papan tugas',occupant:null},false);
  hangouts.push(...taskBoardItem.seatRefs);
  // Musholla, front right: low partitions, a door on the aisle side, two rows of prayer mats.
  box(5.3,.02,3.3,0xdfe3d6,13.3,.02,10.15);
  box(.12,1.1,1.1,CARD,10.6,0,9.05);box(.12,1.1,1.1,CARD,10.6,0,11.2);box(5.5,1.1,.12,CARD,13.3,0,8.5);
  door(10.6,9.6,1,-Math.PI/2,BALSA);
  box(.9,.4,.35,BALSA,11.2,0,8.8);
  const prayerSpots=[];
  for(const z of [9.25,11.05])for(const [i,x] of [11.5,12.7,13.9,15.1].entries()){
    box(.7,.03,1.1,i%2?0xa98158:0x86968a,x,.03,z);
    prayerSpots.push({x,z,f:-1,floor:3,route:[[10,P3],[10,10.1],[x,10.1]],state:'pray',label:'Menuju ruang salat',occupant:null});
  }
  textPlane('PRAYER ROOM',13.3,7.9,3.6);
  plant(15,-11,.9);restroom(-14.45,-5.05,2.9,2.5,'+x');
  // Back lounge between the meeting room and the pantry: sofa on a round rug, two armchairs, books and a quote panel.
  cylinder(3.1,3.1,.03,0xe8cfc0,-2.6,.02,-9.6);
  const backSofa=sofa(-3.4,-10.9,3.6);
  cylinder(.6,.6,.06,BALSA,-3.4,.42,-8.9);cylinder(.08,.14,.42,DARK,-3.4,0,-8.9);
  box(.5,.06,.36,0x5f7d68,-3.5,.48,-8.95);box(.44,.06,.32,CARD,-3.5,.54,-8.95);cylinder(.1,.08,.16,CARD,-3.05,.48,-8.75);
  for(const [x,z,r,color] of [[.2,-9.8,-1.9,0x6e8f72],[-.2,-7.8,-2.6,0xefe7da]]){
    const g=new THREE.Group();root.add(g);g.position.set(x,0,z);g.rotation.y=r;
    mesh(softBox(1.1,.45,1),color,0,.35,0,g,false);mesh(softBox(1.1,.8,.28),color,0,.8,-.42,g,false);
    for(const s of [-1,1])mesh(softBox(.24,.58,.92),tint(mix(color,INK,.08),'fabric_sofa'),s*.5,.46,-.02,g,false);
    for(const s of [-1,1])for(const t of [-1,1])box(.05,.14,.05,DARK,s*.4,0,t*.35,g);
    registerCustom('sofa',buildFloor(),g,x,z,Math.round(r*180/Math.PI),{radius:.8}).sub=color===0x6e8f72?'back-a':'back-b';
  }
  // Replace the old shelf in place instead of adding another shelf through the quote panel.
  if(!decor('bookshelf',{w:3,h:2.1,d:.6},root,{x:4.6,z:-11.55,rotY:Math.PI/2})){
    box(3,2.1,.5,BALSA,4.6,0,-11.55);
    for(const y of [.7,1.4])box(2.9,.04,.46,0xb89c70,4.6,y,-11.5);
    for(let i=0;i<16;i++){const row=i>>3;box(.14+(i%3)*.04,.46+(i%4)*.06,.34,[0x2f4a6b,CARD,0xb4623a,0x3f7a58,0x74598c,0xd9a441][i%6],3.35+(i%8)*.33,.06+row*.7,-11.5);}
  }
  plant(5.4,-11.5,.35,1.44);plant(3.6,-11.5,.3,2.1);
  // Quote panel, painted like the lettering on the reference walls.
  {
    const c=document.createElement('canvas');c.width=512;c.height=384;const ctx=c.getContext('2d');
    ctx.fillStyle='#fbf8f2';ctx.fillRect(0,0,512,384);ctx.fillStyle='#2f3a33';ctx.font='600 58px Archivo, system-ui, sans-serif';
    ['Good people','build great','work.'].forEach((line,i)=>ctx.fillText(line,40,110+i*72));
    ctx.fillStyle='#b4623a';ctx.fillRect(40,316,70,6);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    box(2.8,2.2,.14,CARD,-7.6,.4,-11.6);for(const s of [-1,1])box(.1,.4,.1,DARK,-7.6+s*1.2,0,-11.6);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.6,1.95),new THREE.MeshBasicMaterial({map:texture}));sign.position.set(-7.6,1.5,-11.52);root.add(sign);
  }
  plant(-9.3,-10.4,.9);plant(8.7,-11.2,1);plant(-.8,-11.3,.8);
  // Wooden planters with trailing leaves along the front windows.
  for(const x of [-6,6]){
    box(3.4,.55,.7,BALSA,x,0,11.35);for(let i=0;i<5;i++)box(.04,.5,.03,0xc9a577,x-1.4+i*.7,.03,11);
    for(const dx of [-1.1,0,1.1])plant(x+dx,11.35,.42,.55);
  }
  // Two lounge seats on the sofa, reached along the back of the Leadership rug.
  for(const x of [-4.4,-2.4])hangouts.push(linkSpot(backSofa,{x,z:-10.7,f:1,floor:3,route:[[-9.3,P3],[-9.3,-8],[x,-8]],state:'lounge',label:'Menuju lounge belakang',occupant:null},false));
  textPlane('LOUNGE',-2.6,-7.3,3.2);

  shell(4);
  // Rooftop garden: a pergola lounge, and a play deck instead of one long table, so a break is something to do.
  for(let row=0;row<24;row++)box(31.8,.025,.98,[0xd9bd98,0xe0c7a5,0xd4b590][row%3],0,.031,-11.5+row);
  const roofSpots=[];
  const ROOF_STATUS={'relaxes in the pergola lounge':'bersantai di lounge pergola','plays ping pong':'bermain ping pong','hangs out on the bean bags':'bersantai di bean bag',
    'sits on the swing':'duduk di ayunan','plays chess':'bermain catur','stretches on a yoga mat':'meregangkan badan di matras yoga','plays billiards':'bermain biliar','grabs a coffee at the rooftop bar':'ngopi di bar rooftop'};
  // Every rooftop spot keeps the 'break' state; roofPose picks the pose and fun names the activity.
  const roofSpot=(x,z,angle,fun,extra={})=>{const spot={x,z,f:1,angle,floor:ROOF,route:[[x,0]],state:'break',fun,...extra};roofSpots.push(spot);return spot;};
  box(10,.03,8.7,0xd7c5a7,-6,.06,-6.5);
  for(const x of [-11,-1])for(const z of [-11,-2])box(.22,3.3,.22,BALSA,x,0,z);
  for(let x=-11.2;x<=-.8;x+=.65)box(.18,.16,9.6,BALSA,x,3.3,-6.5);
  const pergolaA=sofa(-6.5,-9,5.5);pergolaA.sub='pergola';const pergolaB=sofa(-10,-5.7,3.7,Math.PI/2);pergolaB.sub='pergola';
  cylinder(1,1,.1,BALSA,-6.5,.55,-6.2);cylinder(.14,.3,.55,DARK,-6.5,0,-6.2);plant(-6.5,-6.2,.3,.65);
  cylinder(.5,.5,.5,0x8b9d7d,-4,0,-6);
  for(const x of [-8,-6])linkSpot(pergolaA,roofSpot(x,-8.8,0,'relaxes in the pergola lounge'),false);
  for(const z of [-6.4,-4.8])linkSpot(pergolaB,roofSpot(-9.8,z,Math.PI/2,'relaxes in the pergola lounge'),false);
  const roofGlow=new THREE.MeshStandardMaterial({color:0xffe8b2,emissive:0xffcf83,emissiveIntensity:.8});
  function lantern(x,z){
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    box(.42,.06,.42,DARK,0,0,0);box(.42,.06,.42,DARK,0,.65,0);
    const glow=new THREE.Mesh(new THREE.BoxGeometry(.28,.55,.28),roofGlow);glow.position.set(0,.34,0);g.add(glow);
    for(const dx of [-.18,.18])for(const dz of [-.18,.18])box(.035,.6,.035,DARK,dx,.05,dz);
    root=atRoot;atRoot.add(g);
    return registerCustom('lamp',floor,g,x,z,0,{radius:.35,symmetric:true});
  }
  for(let x=-10;x<=-2;x+=2){
    box(.02,.35,.02,DARK,x,2.85,-2.1);
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.16,12,8),roofGlow);bulb.position.set(x,2.82,-2.1);root.add(bulb);
  }
  for(const [x,z,w,d] of [[-7,11,8,.8],[5,11,8,.8],[7,-11,8,.8],[15,5,.8,6]]){
    box(w,.65,d,0xe7dfce,x,0,z);
    for(let i=-1;i<=1;i++)plant(x+(w>d?i*w*.3:0),z+(d>w?i*d*.3:0),.6,.65);
  }
  for(const [x,z] of [[-11,-11],[-1,-11],[-11,-2],[-1,-2]]){
    for(let i=0;i<4;i++){const leaf=oval(.35,.6,.12,0x718a57,x+.12,2.9-i*.45,z);leaf.rotation.z=i%2?.45:-.45;}
  }
  for(const [x,z] of [[-12,10],[11,10],[-12,-10],[12,-10]])lantern(x,z);
  plant(1,-10.5,1.3);plant(13,-10.5,1.25);restroom(14.55,10.6,2.6,2.5,'-x');
  textPlane('ROOFTOP GARDEN',3,9,8);
  // Rooftop door from the stair core: a white frame with two glass leaves, always open and folded back inside.
  const DOOR_FRAME=0xf6f4ef;
  box(.22,.85,.8,CARD,-16,0,5.9);
  for(const z of [6.3,8.5])box(.14,2.35,.14,DOOR_FRAME,-16,0,z);
  box(.2,.16,2.36,DOOR_FRAME,-16,2.3,7.4);
  for(const [z,dir] of [[6.37,1],[8.43,-1]]){
    const leaf=new THREE.Group();leaf.position.set(-16,0,z);leaf.rotation.y=dir>0?Math.PI/2:-Math.PI/2;root.add(leaf);
    // Hinged at the frame and swung 90 degrees into the rooftop, lying along the edge of the opening.
    box(.06,2.15,1.05,DOOR_FRAME,0,.08,dir*.54,leaf);box(.02,1.9,.86,'glass',0,.2,dir*.54,leaf);box(.08,.05,.3,DARK,.05,1.05,dir*.95,leaf);
  }
  // Ping pong, with a player at each end.
  for(const sx of [-1,1])for(const sz of [-1,1])box(.07,.7,.07,DARK,6+sx*1.2,0,-5.5+sz*.6);
  box(2.74,.05,1.52,0x2f6f8f,6,.7,-5.5);
  for(const z of [-6.24,-4.76])box(2.74,.006,.03,CARD,6,.75,z);box(2.74,.006,.02,CARD,6,.75,-5.5);
  box(.03,.15,1.64,0xf3efe6,6,.75,-5.5);mesh(new THREE.SphereGeometry(.035,10,8),0xf0a531,6.7,1.05,-5.3,root,false);
  roofSpot(4.1,-5.5,Math.PI/2,'plays ping pong',{standing:true,roofPose:'pingpong'});
  roofSpot(7.9,-5.5,-Math.PI/2,'plays ping pong',{standing:true,roofPose:'pingpong'});
  textPlane('PING PONG',6,-3.6,3);
  // Bean bags on a round lawn under a striped parasol.
  cylinder(2.3,2.3,.03,0x9fc17a,4.5,.05,3.2);
  cylinder(.42,.42,.05,BALSA,4.5,.34,3.2);cylinder(.05,.08,.34,DARK,4.5,0,3.2);
  // A tall, narrow cafe parasol, so people on the bean bags stay visible from above.
  cylinder(.035,.035,2.9,CARD,4.5,.39,3.2);
  cylinder(.02,1.05,.4,0xe8634a,4.5,2.95,3.2);cylinder(.02,.6,.22,0xfbf6ee,4.5,3.12,3.2);
  [[0xe8866c,0],[0xe0b04f,Math.PI/2],[0x5f9a94,Math.PI],[0xa594c6,-Math.PI/2]].forEach(([color,a])=>{
    const x=4.5+Math.sin(a)*1.35,z=3.2+Math.cos(a)*1.35;
    oval(1.05,.55,1.05,color,x,.28,z);oval(.9,.7,.4,color,x+Math.sin(a)*.38,.55,z+Math.cos(a)*.38);
    roofSpot(x,z,a+Math.PI,'hangs out on the bean bags',{roofPose:'beanbag'});
  });
  // Swing bench for two, facing the front of the roof.
  for(const x of [9.5,12.1])for(const z of [4.55,5.45])box(.1,2.35,.1,BALSA,x,0,z);
  box(2.75,.12,.12,BALSA,10.8,2.3,5);box(2.75,.12,1,BALSA,10.8,2.35,5);
  for(const x of [9.95,11.65])box(.025,1.72,.025,DARK,x,.6,5.05);
  box(1.9,.08,.6,0xe8866c,10.8,.48,5.05);box(1.9,.55,.07,0xe8866c,10.8,.56,4.78);
  for(const x of [10.35,11.25])roofSpot(x,5.12,0,'sits on the swing');
  // Chess table with two low stools.
  cylinder(.45,.45,.05,BALSA,11.2,.68,-1.3);cylinder(.06,.14,.68,DARK,11.2,0,-1.3);
  {
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
    for(let i=0;i<8;i++)for(let j=0;j<8;j++){ctx.fillStyle=(i+j)%2?'#5b4636':'#efe4cf';ctx.fillRect(i*16,j*16,16,16);}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;
    const board=new THREE.Mesh(new THREE.PlaneGeometry(.5,.5),new THREE.MeshBasicMaterial({map:texture}));board.rotation.x=-Math.PI/2;board.position.set(11.2,.735,-1.3);root.add(board);
    for(let i=0;i<6;i++)cylinder(.025,.03,.07+(i%3)*.02,i<3?0xfbf6ee:DARK,11.05+(i%3)*.1,.735,i<3?-1.48:-1.12);
  }
  const chessStools=[stool(10.3,-1.3,.45),stool(12.1,-1.3,.45)];
  linkSpot(chessStools[0],roofSpot(10.3,-1.3,Math.PI/2,'plays chess'));linkSpot(chessStools[1],roofSpot(12.1,-1.3,-Math.PI/2,'plays chess'));
  // Two yoga mats by the back planter.
  for(const [x,color] of [[10.1,0x7fa98a],[11.7,0xd98f7a]]){
    box(.7,.02,1.8,color,x,.06,-8.3);
    roofSpot(x,-8.1,0,'stretches on a yoga mat',{standing:true,roofPose:'stretch'});
  }
  // Flower bed in the middle of the deck.
  box(2.6,.4,.9,0xe7dfce,1.6,0,-1.2);
  for(let i=0;i<9;i++)oval(.26,.26,.26,[0xe8634a,0xf0c24f,0xf3efe6,0xa594c6][i%4],.6+(i%5)*.5,.5+(i%2)*.08,-1.45+Math.floor(i/5)*.5);
  // Billiard table, front left.
  function billiard(x,z){
    const g=new THREE.Group();g.position.set(x,0,z);
    const floor=buildFloor(),atRoot=root;
    root=g;
    for(const sx of [-1,1])for(const sz of [-1,1])box(.16,.72,.16,0x5a3d2a,sx*1.25,0,sz*.6);
    box(2.9,.14,1.6,0x6b4a33,0,.72,0);box(2.6,.02,1.3,0x3d7a5a,0,.86,0);
    for(const bx of [-1.35,0,1.35])for(const bz of [-.7,.7])cylinder(.07,.07,.02,DARK,bx,.87,bz);
    [[CARD,.8,0],[ACCENT,-.7,0],[0xd8a13a,-.8,-.07],[0xd8a13a,-.8,.07],[0x2f4a6b,-.9,-.14],[DARK,-.9,0],[0x3f7a58,-.9,.14]]
      .forEach(([color,bx,bz])=>mesh(new THREE.SphereGeometry(.05,12,8),color,bx,.93,bz,g,false));
    const spareCue=mesh(new THREE.CylinderGeometry(.012,.02,1.45,8),BALSA,0,.9,-.75,g,false);spareCue.rotation.z=Math.PI/2;
    root=atRoot;atRoot.add(g);
    return registerCustom('billiard',floor,g,x,z,0,{radius:Math.hypot(2.9,1.6)/2});
  }
  const pool=billiard(-6,6);
  textPlane('BILLIARDS',-6,8.1,3);
  linkSpot(pool,roofSpot(-8,6.3,Math.PI/2,'plays billiards',{standing:true,roofPose:'billiard'}),false);
  linkSpot(pool,roofSpot(-4,5.7,-Math.PI/2,'plays billiards',{standing:true,roofPose:'billiard'}),false);
  // Coffee bar along the right parapet.
  box(.8,1,4,0x8a6a4a,15.2,0,-1);box(.9,.06,4.1,CARD,15.2,1,-1);
  box(.5,.6,.45,DARK,15.25,1.06,-2.2);box(.3,.08,.25,0x8a8479,15.1,1.06,-2.2);
  cylinder(.12,.14,.45,DARK,15.25,1.06,-1.5);
  for(const z of [-.7,-.35,0,.35])cylinder(.07,.06,.14,CARD,15,1.06,z);
  for(const z of [-2.4,.4])cylinder(.2,.22,.72,DARK,14.3,0,z);
  textPlane('COFFEE',13.2,2.3,2.4);
  for(let i=0;i<13;i++)box(.06,.85,.035,0xc9a577,14.78,.08,-2.8+i*.3);
  for(const y of [1.8,2.3])box(.65,.07,4.2,BALSA,15.5,y,-1);
  for(const z of [-2.5,-1.5,-.5,.5]){plant(15.5,z,.22,2.37);cylinder(.08,.07,.17,CARD,15.45,1.87,z);}
  roofSpot(14.1,-1,Math.PI/2,'grabs a coffee at the rooftop bar',{standing:true,roofPose:'coffee'});

  function flight(x,z1,z2,y1,y2,parent) {
    const steps=16,run=(z2-z1)/steps,rise=(y2-y1)/steps;
    for(let i=0;i<steps;i++){
      box(2.4,.18,Math.abs(run)+.015,0xcfc8ba,x,y1+rise*(i+1)-.18,z1+run*(i+.5),parent);
      if(i%4===0)for(const side of [-1,1])box(.045,.95,.045,DARK,x+side*1.15,y1+rise*(i+1),z1+run*(i+.5),parent);
    }
    for(const side of [-1,1]){
      const a=new THREE.Vector3(x+side*1.15,y1+.95,z1),b=new THREE.Vector3(x+side*1.15,y2+.95,z2);
      const rail=mesh(new THREE.CylinderGeometry(.035,.035,a.distanceTo(b),8),DARK,0,0,0,parent,false);
      rail.position.copy(a).add(b).multiplyScalar(.5);rail.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.sub(a).normalize());
    }
  }
  function buildStair(lower){
    const bridge=new THREE.Group();bridge.position.y=floorY(lower);stairways[lower]=bridge;scene.add(bridge);
    box(3.7,.18,2.6,0xcfc8ba,-17.15,-.18,7,bridge);
    const half=FLOOR_GAP/2;
    flight(-18.5,7,1,0,half,bridge);
    box(5.5,.18,2.6,0xcfc8ba,-20,half-.18,1,bridge);
    flight(-21.5,1,7,half,FLOOR_GAP,bridge);
    box(7,.18,2.6,0xcfc8ba,-19,FLOOR_GAP-.18,7,bridge);
    for(const x of [-22.75,-17.25])box(.08,1.05,2.6,DARK,x,half,1,bridge);
    return bridge;
  }
  for(const lower of ORDER.slice(0,-1))buildStair(lower);
  // Glass curtain walls for the whole-building view: floors 1 to 3 are enclosed storeys, the stair core is glazed too.
  // Static decoration that never moves: merge a group's direct opaque meshes per material (one draw call each).
  function mergeGroup(group){const groups=new Map(),drop=[];group.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(group.matrixWorld).invert();
    for(const o of [...group.children]){if(!o.isMesh||o.material.transparent||Array.isArray(o.material)||!o.visible||o.userData.level!==undefined)continue;
      const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();for(const n of Object.keys(g.attributes))if(!['position','normal','uv'].includes(n))g.deleteAttribute(n);if(!g.attributes.uv||!g.attributes.normal)continue;
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld));if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(g);drop.push(o);}
    for(const [material,list] of groups){if(list.length<2){list.forEach(g=>g.dispose());continue;}const merged=new THREE.Mesh(ADD.BufferGeometryUtils.mergeGeometries(list),material);merged.receiveShadow=true;group.add(merged);list.forEach(g=>g.dispose());
      for(const o of drop)if(o.material===material){o.removeFromParent();o.geometry.dispose();}}return group;}
  const facade=new THREE.Group();scene.add(facade);facade.visible=false;
  // Each storey's glass sits in its own group so it can travel and fade with that floor during camera transitions.
  const facadeLevels={};
  function glazing(w,h,d,x,y,z,parent){box(w,h,d,'roofglass',x,y,z,parent);}
  // White frame, as in the building reference: slab edges and mullions are white, the glass stays clear.
  const FRAME=0xf6f4ef;
  function buildFacadeLevel(level){
    const y=floorY(level),h=FLOOR_GAP-.48,lg=new THREE.Group();facade.add(lg);facadeLevels[level]=lg;
    // A white slab edge wraps each storey; it knows its level so a click on it enters that floor.
    const edge=box(33.4,.56,25.4,FRAME,0,y-.54,0,lg);edge.userData.level=level;
    if(level===ROOF){
      // Rooftop: a glass balustrade with a white handrail on the parapet.
      // The left side stops at the stair door (z 5.5 to 8.5), where the rooftop door stands open.
      for(const [w,d,x,z] of [[33,.05,0,12.55],[33,.05,0,-12.55],[.05,25,16.55,0],[.05,18,-16.55,-3.5],[.05,4,-16.55,10.5]]){
        glazing(w,1.15,d,x,y,z,lg);box(Math.max(w,.12),.08,Math.max(d,.12),FRAME,x,y+1.15,z,lg);
      }
      return lg;
    }
    if(level===1)glazing(16.5,h,.05,-8.25,y,12.55,lg);else glazing(33,h,.05,0,y,12.55,lg);
    glazing(33,h,.05,0,y,-12.55,lg);glazing(.05,h,25,16.55,y,0,lg);
    glazing(.05,h,12.4,-16.55,y,-6.3,lg);glazing(.05,h,3.6,-16.55,y,10.7,lg);
    for(let x=-16.5;x<=16.51;x+=33/8)for(const z of [-12.55,12.55])if(level!==1||z<0||x<.1)box(.14,h,.14,FRAME,x,y,z,lg);
    // The parking entrance keeps two structural columns and a header beam, wide enough for cars.
    if(level===1){for(const x of [8.25,16.5])box(.3,h,.3,FRAME,x,y,12.55,lg);box(16.5,.35,.3,FRAME,8.25,y+h-.35,12.55,lg);}
    for(let z=-12.5;z<=12.51;z+=25/6)box(.14,h,.14,FRAME,16.55,y,z,lg);
    for(const z of [-12.55,-.1,4.9,8.9,12.55])box(.14,h,.14,FRAME,-16.55,y,z,lg);
    return lg;
  }
  let stairCore=null;
  function buildStairCore(){
    if(stairCore){disposeFade(stairCore);facade.remove(stairCore);}stairCore=new THREE.Group();facade.add(stairCore);
    // The stair core rises well above the rooftop floor, so people arriving on the last flight keep their heads inside it.
    const top=floorY(ROOF)+2.7;
    glazing(.05,top,9.6,-23.3,0,3.9,stairCore);glazing(7,top,.05,-19.8,0,8.7,stairCore);glazing(7,top,.05,-19.8,0,-.9,stairCore);
    for(const [x,z] of [[-23.3,-.9],[-23.3,8.7],[-16.6,-.9],[-16.6,8.7]])box(.16,top,.16,FRAME,x,0,z,stairCore);
    box(7.1,.12,9.9,FRAME,-19.95,top,3.9,stairCore);
  }
  for(const level of ORDER)mergeGroup(buildFacadeLevel(level));buildStairCore();
  facade.traverse(o=>{o.castShadow=false;});
  const eveningLights=new THREE.Group();scene.add(eveningLights);eveningLights.visible=false;
  const lampMaterial=new THREE.MeshStandardMaterial({color:0xffdda0,emissive:0xffbb66,emissiveIntensity:1.6,roughness:.5});
  const streetBulbMaterial=new THREE.MeshStandardMaterial({color:0xfff1cf,emissive:0xffc06a,emissiveIntensity:0,roughness:.4});
  const cityFacadeMats=[];
  const levelLights={};
  function buildLights(level){
    const y=floorY(level),lights=new THREE.Group();eveningLights.add(lights);levelLights[level]=lights;
    const strip=new THREE.Mesh(new THREE.BoxGeometry(31,.07,.08),lampMaterial);strip.position.set(0,y+.12,12.15);lights.add(strip);
    const light=new THREE.PointLight(0xffce8c,2.2,38,1);light.position.set(0,y+3,1);lights.add(light);lights.userData.point=light;
    for(const x of [-15,15]){
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(.32,.55,.32),lampMaterial);lamp.position.set(x,y+.3,10.5);lights.add(lamp);
    }
  }
  for(const level of ORDER)buildLights(level);
  // Parts that fade during camera transitions get their own material copies, so floors keep full opacity.
  function prepareFade(root){root.traverse(o=>{if(!o.material)return;o.material=o.material.clone();o.material.transparent=true;o.userData.fadeMaterial=true;o.userData.baseOpacity=o.material.opacity;});}
  // Removed stair/facade groups own their fade clones, but not cached base or shared model materials.
  function disposeFade(root){root?.traverse(o=>{o.geometry?.dispose();if(!o.userData.fadeMaterial)return;for(const m of [o.material].flat()){if(!window.officeSurfaces?.release(m))m?.dispose();}});}
  function setFade(root,alpha){root.visible=alpha>.001;root.traverse(o=>{if(o.userData.baseOpacity!==undefined)o.material.opacity=o.userData.baseOpacity*alpha;});}
  prepareFade(facade);Object.values(stairways).forEach(prepareFade);doorPads.forEach(prepareFade);
  function stairRoute(from,to){
    const base=Math.min(floorY(from),floorY(to)),half=FLOOR_GAP/2;
    // Door and landing sit at z 7.5, clear of the floor-3 column at z 6.5, so both lanes fit through the doorway.
    const points=[[-16,base,7.5],[-18.5,base,7.5]];
    for(let i=1;i<=16;i++)points.push([-18.5,base+half*i/16,7-6*i/16]);
    points.push([-21.5,base+half,1]);
    for(let i=1;i<=16;i++)points.push([-21.5,base+half+half*i/16,1+6*i/16]);
    points.push([-18.5,base+FLOOR_GAP,7.5],[-16,base+FLOOR_GAP,7.5]);
    // People going up keep to one side of the flights and people coming down to the other, so they pass instead of colliding.
    const up=floorY(to)>floorY(from),lane=up?.35:-.35,ordered=up?points:points.reverse();
    return ordered.map(([x,y,z],k)=>{
      const [px,,pz]=ordered[Math.max(0,k-1)],[nx,,nz]=ordered[Math.min(ordered.length-1,k+1)],dx=nx-px,dz=nz-pz,d=Math.hypot(dx,dz)||1;
      return new THREE.Vector3(x-dz/d*lane,y,z+dx/d*lane);
    });
  }
  // attach() re-derives Euler angles from the matrix, which turns a yaw past 90 degrees into (PI, PI-yaw, PI). Everything
  // else only turns rotation.y, so that would mirror the person's heading. Floors and stairs never rotate, so the yaw carries over.
  function moveTo(parent,g){const yaw=new THREE.Euler().setFromQuaternion(g.getWorldQuaternion(new THREE.Quaternion()),'YXZ').y;parent.attach(g);g.rotation.set(0,yaw,0);}
  function beginStairs(agent){
    const next=ORDER[orderOf(agent.floor)+Math.sign(orderOf(agent.destination.floor)-orderOf(agent.floor))];
    floors[agent.floor].updateMatrixWorld(true);moveTo(travelRoot,agent.g);
    agent.stairTrip={from:agent.floor,to:next,points:stairRoute(agent.floor,next)};
    agent.state='stairs';agent.g.visible=true;
  }
  function visibleAgent(agent){
    // The outside stairs only exist in the building view; a single floor shows just that floor.
    return agent.state==='stairs'?stairsShown:floors[agent.floor].visible;
  }


  // Surroundings for the whole-building view only: a round paper base with streets, other buildings and clouds.
  const skyline=new THREE.Group();scene.add(skyline);skyline.visible=false;
  {
    let seed=29;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
    const PAVEMENT=0xe4dfd3,LAWN=0xa9cc7a,SIDEWALK=0xf1eee7,ASPHALT=0xa9a8a3,LINE=0xfbfaf6;
    mesh(new THREE.CylinderGeometry(150,150,.4,64),PAVEMENT,0,-1.1,0,skyline,false);
    // The office sits on its own lawn, bounded by sidewalks on the two streets.
    // The office lawn is the textured grass plane from officeEnvironment.
    const flat=(w,d,color,x,y,z)=>{const m=box(w,.02,d,color,x,y,z,skyline);m.children.forEach(line=>line.visible=false);return m;};
    const WALK=0xeeeae0,CURB=0xd9d4c9,METAL=0x3d4347;
    // Raised sidewalks with a curb face; the front walk opens at the driveway.
    const walk=(x,z,w,d)=>box(w,.09,d,WALK,x,-.89,z,skyline);
    for(const [x0,x1] of [[-145,2.5],[13.5,31],[37,145]])walk((x0+x1)/2,19.8,x1-x0,2.4);
    for(const [x0,x1] of [[-145,31],[37,145]])walk((x0+x1)/2,28.2,x1-x0,2.4);
    for(const x of [29.8,38.2])for(const [z0,z1] of [[-145,18.6],[29.4,145]])walk(x,(z0+z1)/2,2.4,z1-z0);
    const curb=(w,d,x,z)=>box(w,.075,d,CURB,x,-.875,z,skyline);
    for(const [x0,x1] of [[-145,2.5],[13.5,31],[37,145]])curb(x1-x0,.12,(x0+x1)/2,21.06);
    for(const [x0,x1] of [[-145,31],[37,145]])curb(x1-x0,.12,(x0+x1)/2,26.94);
    for(const [z0,z1] of [[-145,21],[27,145]]){curb(.12,z1-z0,31.06,(z0+z1)/2);curb(.12,z1-z0,36.94,(z0+z1)/2);}
    // Plain asphalt is only a fallback under the textured street, never above the wheels.
    flat(290,6,ASPHALT,0,-.89,24);flat(6,166,ASPHALT,34,-.89,-62);flat(6,118,ASPHALT,34,-.89,86);
    // Driveway apron and its paint.
    flat(14,8.5,0xd6d1c6,8.25,-.885,16.75);
    // Street paint: edge lines stay clear of the driveway and the crossing.
    const paint=(w,d,x,z)=>flat(w,d,LINE,x,-.855,z);
    for(const [x0,x1] of [[-140,2.5],[13.5,29],[39,140]])paint(x1-x0,.12,(x0+x1)/2,21.45);
    for(const [x0,x1] of [[-140,29],[39,140]])paint(x1-x0,.12,(x0+x1)/2,26.55);
    for(const [z0,z1] of [[-140,19.5],[28.5,140]]){paint(.12,z1-z0,31.45,(z0+z1)/2);paint(.12,z1-z0,36.55,(z0+z1)/2);}
    for(let i=-140;i<=140;i+=8){if(Math.abs(i-34)>5)flat(3,.25,LINE,i,-.86,24);if(Math.abs(i-24)>5)flat(.25,3,LINE,34,-.86,i);}
    // Zebra crossings at the corner.
    for(let k=0;k<6;k++){flat(.5,5,LINE,27.4-k*.9,-.855,24);flat(5,.5,LINE,34,-.855,17.4-k*.9);}
    const tones=[0xc9c2b4,0xb8b2a6,0xd2cbbd,0xa9a69d];
    // Three shared curtain-wall textures replace the old solid stripes; bands merge by material.
    const facadeMats=[0,1,2].map(variant=>{
      const c=document.createElement('canvas');c.width=256;c.height=64;const ctx=c.getContext('2d');
      let s=19+variant*17;const rndTex=()=>(s=s*16807%2147483647)/2147483647;
      ctx.fillStyle=['#22313b','#2b333a','#1d2a33'][variant];ctx.fillRect(0,0,256,64);
      for(let i=0;i<8;i++){
        const x=i*32;
        ctx.fillStyle='#0f171d';ctx.fillRect(x,0,2,64);ctx.fillRect(x+30,0,2,64);
        ctx.fillStyle=['#3b5361','#46545c','#324a58'][variant];ctx.fillRect(x+4,7,24,50);
        if(rndTex()<.28){ctx.fillStyle='#dfbd83';ctx.fillRect(x+6,11,20,42);}
        ctx.fillStyle='rgba(255,255,255,.10)';ctx.fillRect(x+4,7,24,9);
      }
      ctx.fillStyle='#0d1419';ctx.fillRect(0,0,256,3);ctx.fillRect(0,61,256,3);
      const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
      const material=new THREE.MeshStandardMaterial({map:tex,roughness:.58,metalness:.16,emissive:0xffe0a8,emissiveMap:tex,emissiveIntensity:0});cityFacadeMats.push(material);return material;
    });
    const band=(w,d,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w+.06,1.6,d+.06),mat);m.position.set(x,y+.8,z);m.castShadow=false;m.receiveShadow=true;skyline.add(m);};
    for(let placed=0,tries=0;placed<64&&tries<600;tries++){
      const a=rnd()*Math.PI*2,dist=40+rnd()*100,x=Math.cos(a)*dist,z=Math.sin(a)*dist,w=6+rnd()*7,d=6+rnd()*7;
      if(Math.hypot(x,z)+Math.max(w,d)>145)continue;
      if(Math.abs(z-24)<d/2+6||Math.abs(x-34)<w/2+6)continue;
      if(x>-40&&x<28&&z>-28&&z<22)continue;
      // Near blocks stay low so they never hide the office from the default camera; far ones rise higher.
      const h=dist<65?4+rnd()*10:8+rnd()*(dist/140)*42,base=-.9,tone=tones[placed%4],mat=facadeMats[placed%3];
      const stepped=dist>70&&h>24&&rnd()<.5,bodyH=stepped?h*.72:h,shoulder=base+bodyH,topY=base+h;
      flat(w+3,d+3,rnd()<.5?LAWN:SIDEWALK,x,-.895,z);
      // Dark podium with a glazed lobby, then the lit body and its window bands.
      box(w+.16,3.0,d+.16,0x3b4247,x,base,z,skyline);
      box(w,bodyH,d,tone,x,base,z,skyline);
      for(let y=2.2;y+1.6<bodyH-.1;y+=3.2)band(w,d,x,base+y,z,mat);
      for(const sx of [-1,1])for(const sz of [-1,1])box(.14,bodyH,.14,0x3a4146,x+sx*(w/2-.07),base,z+sz*(d/2-.07),skyline);
      if(stepped){
        const tw=w*.62,td=d*.62,th=h-bodyH;
        box(tw,th,td,tone,x,shoulder,z,skyline);
        for(let y=shoulder+1.8;y+1.6<topY-.1;y+=3.2)band(tw,td,x,y,z,mat);
        for(const sx of [-1,1])for(const sz of [-1,1])box(.12,th,.12,0x3a4146,x+sx*(tw/2-.06),shoulder,z+sz*(td/2-.06),skyline);
      }
      // Roof slab, parapet and plant equipment.
      const rw=stepped?w*.62:w,rd=stepped?d*.62:d;
      box(rw+.2,.16,rd+.2,0x8b8579,x,topY-.16,z,skyline);
      for(const [pw,pd,px,pz] of [[rw+.2,.16,0,rd/2+.08],[rw+.2,.16,0,-rd/2-.08],[.16,rd+.2,rw/2+.08,0],[.16,rd+.2,-rw/2-.08,0]])box(pw,.55,pd,0x6b6a63,x+px,topY,pz?z+pz:z,skyline);
      if(rnd()<.65)box(Math.min(3,rw*.24),.75,Math.min(3,rd*.24),0xb9b3a6,x+rw*.16,topY,z-rd*.12,skyline);
      if(rnd()<.35)cylinder(.3,.3,1.1,0x9c9a90,x-rw*.2,topY,z+rd*.12,skyline);
      if(rnd()<.22)box(.05,2.2,.05,0x4a4a46,x,topY,z,skyline);
      if(rnd()<.3)flat(rw*.55,rd*.55,0x9fbf73,x,topY+.06,z);
      // A canopy, sign and lobby glass face the office, giving each block a front door.
      const faceX=Math.abs(x)>=Math.abs(z),dir=faceX?(x>=0?-1:1):(z>=0?-1:1);
      if(faceX){
        box(1.3,.16,2.4,0xd8d2c4,x+dir*(w/2+.55),base+3.1,z,skyline);
        box(.06,1.3,d*.62,0x8faab0,x+dir*(w/2+.09),base+.6,z,skyline);
        box(.06,.48,2.2,0xe8e2d8,x+dir*(w/2+.04),base+3.3,z,skyline);
      }else{
        box(2.4,.16,1.3,0xd8d2c4,x,base+3.1,z+dir*(d/2+.55),skyline);
        box(w*.62,1.3,.06,0x8faab0,x,base+.6,z+dir*(d/2+.09),skyline);
        box(2.2,.48,.06,0xe8e2d8,x,base+3.3,z+dir*(d/2+.04),skyline);
      }
      placed++;
    }
    // Front garden: clipped hedges and flowers frame the lawn; the office sign faces the street.
    let flower=0;
    for(const [x0,x1] of [[-32,-3],[15.6,27.5]]){
      for(let x=x0;x<x1;x+=4)box(3.95,.5,.55,0x587a50,x+1.85,-.878,17.55,skyline);
      for(let x=x0+.8;x<x1;x+=1.6){cylinder(.018,.018,.55,0x4d6b45,x,-.878,17.3,skyline);oval(.16,.13,.16,[0xd07a5a,0xe0c05a,0xc95f7d][flower++%3],x,-.33,17.3,skyline);}
    }
    {
      const c=document.createElement('canvas');c.width=512;c.height=160;const ctx=c.getContext('2d');
      ctx.fillStyle='#fbf8f2';ctx.fillRect(0,0,512,160);ctx.fillStyle='#e8634a';ctx.fillRect(36,32,26,96);
      ctx.fillStyle='#1e2230';ctx.font='700 58px Archivo, system-ui, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('KANTOR KITA',86,82);
      const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(3.4,1.06),new THREE.MeshStandardMaterial({map:tex,roughness:.9}));panel.position.set(22,1.08,18.26);
      skyline.add(panel);
      for(const dx of [-1.5,1.5])box(.08,2.55,.08,METAL,22+dx,-.878,18.2,skyline);
      box(3.6,1.16,.06,CARD,22,.5,18.18,skyline);
    }
    // Street lights, a bus shelter, benches, bins, a hydrant and a mailbox give the sidewalk a reason to exist.
    function streetlight(x,z,fx,fz){
      cylinder(.13,.17,.16,CURB,x,-.80,z,skyline);
      cylinder(.055,.075,4.28,METAL,x,-.64,z,skyline);
      if(fx){box(1.4,.06,.06,METAL,x+fx*.7,3.50,z,skyline);box(.3,.1,.22,METAL,x+fx*1.36,3.46,z,skyline);const b=new THREE.Mesh(new THREE.BoxGeometry(.3,.04,.2),streetBulbMaterial);b.position.set(x+fx*1.36,3.42,z);skyline.add(b);}
      else{box(.06,.06,1.4,METAL,x,3.50,z+fz*.7,skyline);box(.22,.1,.3,METAL,x,3.46,z+fz*1.36,skyline);const b=new THREE.Mesh(new THREE.BoxGeometry(.2,.04,.3),streetBulbMaterial);b.position.set(x,3.42,z+fz*1.36);skyline.add(b);}
    }
    for(const [x,z,fx,fz] of [[-30,20.35,0,1],[-11,20.35,0,1],[18,20.35,0,1],[27,20.35,0,1],[-22,27.6,0,-1],[4,27.6,0,-1],[26,27.6,0,-1],[30.4,-14,1,0],[37.6,8,-1,0]])streetlight(x,z,fx,fz);
    {
      const x=-20,z=20.05,top=-.80;
      for(const dx of [-2.1,2.1])for(const dz of [-.65,.65])box(.07,2.45,.07,METAL,x+dx,top,z+dz,skyline);
      box(4.5,.12,1.55,METAL,x,top+2.35,z,skyline);
      box(4.2,2.05,.05,'glass',x,top+.15,z-.62,skyline);
      for(const dx of [-2.15,2.15])box(.05,2.05,1.3,'glass',x+dx,top+.15,z,skyline);
      box(3,.09,.45,BALSA,x,top+.48,z+.05,skyline);
      box(3,.45,.08,BALSA,x,top+.55,z-.12,skyline);
      for(const dx of [-1.2,1.2])box(.07,.48,.35,METAL,x+dx,top,z+.05,skyline);
      cylinder(.04,.04,2.6,METAL,x+2.75,top,z+.45,skyline);
      box(.5,.7,.05,CARD,x+2.75,top+2.55,z+.45,skyline);
      box(.38,.1,.06,0x2f6b4f,x+2.75,top+3.0,z+.43,skyline);
    }
    function bench(x,z,face){
      for(const dx of [-.85,.85])box(.08,.46,.5,METAL,x+dx,-.80,z,skyline);
      box(2,.09,.55,BALSA,x,-.34,z,skyline);
      box(2,.5,.08,BALSA,x,-.28,z-face*.3,skyline);
    }
    bench(-7.5,20.05,1);bench(15.5,20.05,1);bench(-8,27.95,-1);
    for(const [x,z] of [[-24.5,20.2],[17.5,20.2],[12.5,27.85]])cylinder(.24,.28,.8,0x3f5f4a,x,-.80,z,skyline);
    {
      const x=21.5,z=28.0,y=-.80;
      cylinder(.14,.16,.55,0xb23a2c,x,y,z,skyline);
      cylinder(.16,.16,.08,CURB,x,y+.55,z,skyline);
      box(.5,.12,.12,0xb23a2c,x,y+.32,z,skyline);
    }
    {
      const x=6,z=28.0,y=-.80;
      cylinder(.05,.05,.9,METAL,x,y,z,skyline);
      box(.6,.5,.4,0x2f4a6b,x,y+.9,z,skyline);
      box(.5,.06,.05,CARD,x,y+1.02,z+.21,skyline);
    }
    for(const x of [2.2,13.8])cylinder(.09,.11,.8,METAL,x,-.80,20.3,skyline);
  }
  const clouds=[];
  {
    let seed=71;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
    // Soft, irregular cloud sprites painted once (overlapping radial gradients), not solid faceted shapes.
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const g2=canvas.getContext('2d');
    for(let k=0;k<40;k++){const x=90+rnd()*330,y=100+rnd()*70,r=30+rnd()*70,grad=g2.createRadialGradient(x,y,0,x,y,r);grad.addColorStop(0,'rgba(255,255,255,.22)');grad.addColorStop(1,'rgba(255,255,255,0)');g2.fillStyle=grad;g2.fillRect(0,0,512,256);}
    const cloudMap=new THREE.CanvasTexture(canvas);cloudMap.colorSpace=THREE.SRGBColorSpace;
    for(let i=0;i<12;i++){
      // A ring just past the city edge: always in the distance, whichever way the camera turns.
      const a=i/12*Math.PI*2+rnd()*.3,dist=150+rnd()*25;
      const cloud=new THREE.Group();cloud.position.set(Math.cos(a)*dist,15+rnd()*10,Math.sin(a)*dist);skyline.add(cloud);
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudMap,transparent:true,depthWrite:false,opacity:.85}));sprite.scale.set(42+rnd()*20,18+rnd()*6,1);cloud.add(sprite);
      clouds.push({cloud,sprite,speed:1+rnd()*1.5});
    }
  }
  // A small flock circles the neighbourhood above the roofs, flapping on the simulation clock.
  const birds=[];
  {
    const c=document.createElement('canvas');c.width=64;c.height=32;const ctx=c.getContext('2d');
    ctx.strokeStyle='#2b3137';ctx.lineWidth=5;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(6,22);ctx.quadraticCurveTo(20,5,32,18);ctx.quadraticCurveTo(44,5,58,22);ctx.stroke();
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,opacity:.7});
    for(let i=0;i<9;i++){
      const sprite=new THREE.Sprite(mat),r=40+i*4,a=i/9*Math.PI*2;
      sprite.position.set(Math.cos(a)*r,16+(i%3)*2.5,Math.sin(a)*r);sprite.scale.set(2.6,1.3,1);skyline.add(sprite);
      birds.push({sprite,r,y:16+(i%3)*2.5,phase:i*.8,speed:.05+(i%3)*.012});
    }
  }
  // Night sky: a starfield and a soft moon, revealed by the Malam mood.
  const nightSky=new THREE.Group();nightSky.visible=false;scene.add(nightSky);
  const starMat=new THREE.PointsMaterial({color:0xdfe9ff,size:1.7,sizeAttenuation:false,transparent:true,opacity:0,depthWrite:false,fog:false});
  {
    const pos=[];let s=211;const rndStar=()=>(s=s*16807%2147483647)/2147483647;
    for(let i=0;i<700;i++){const u=rndStar()*2-1,a=rndStar()*Math.PI*2,k=Math.sqrt(1-u*u),rad=280;pos.push(Math.cos(a)*k*rad,u*rad,Math.sin(a)*k*rad);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));nightSky.add(new THREE.Points(geo,starMat));
  }
  const moonMat=(()=>{const c=document.createElement('canvas');c.width=128;c.height=128;const g=c.getContext('2d');const grad=g.createRadialGradient(64,64,8,64,64,62);grad.addColorStop(0,'rgba(255,250,226,1)');grad.addColorStop(.55,'rgba(255,246,214,.9)');grad.addColorStop(1,'rgba(255,246,214,0)');g.fillStyle=grad;g.beginPath();g.arc(64,64,62,0,Math.PI*2);g.fill();const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,fog:false,opacity:0});})();
  const moon=new THREE.Sprite(moonMat);moon.position.set(-150,150,-210);moon.scale.set(26,26,1);nightSky.add(moon);
  const environment=window.officeEnvironment.create({scene,parkingRoot:floors[1],onWarning:status});
  const mobility=window.OfficeMobility.create({...environment.layout,maxTeamAway:2});
  let ambientSerial=0,nextAmbient=2;
  mergeGroup(skyline);
  skyline.traverse(o=>{o.castShadow=false;});prepareFade(skyline);
  function animateSky(dt){
    // Clouds drift slowly around the ring.
    for(const c of clouds){const p=c.cloud.position,r=Math.hypot(p.x,p.z),a=Math.atan2(p.z,p.x)+c.speed*dt/r;p.x=Math.cos(a)*r;p.z=Math.sin(a)*r;}
    for(const b of birds){const p=b.sprite.position,a=Math.atan2(p.z,p.x)+b.speed*dt;p.x=Math.cos(a)*b.r;p.z=Math.sin(a)*b.r;p.y=b.y+Math.sin(simTime*.8+b.phase)*.7;b.sprite.scale.x=2.6+Math.sin(simTime*7+b.phase)*.18;}
  }
  const rand=(min,max)=>min+Math.random()*(max-min),pick=list=>list[Math.floor(Math.random()*list.length)];
  const shuffle=list=>list.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(p=>p[1]);
  const bubbleMaterial=(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=80;const ctx=c.getContext('2d');
    ctx.fillStyle='#faf7f0';ctx.strokeStyle='#2a2622';ctx.lineWidth=4;
    ctx.beginPath();ctx.moveTo(22,4);ctx.lineTo(106,4);ctx.quadraticCurveTo(124,4,124,22);ctx.lineTo(124,44);ctx.quadraticCurveTo(124,62,106,62);
    ctx.lineTo(56,62);ctx.lineTo(40,77);ctx.lineTo(42,62);ctx.lineTo(22,62);ctx.quadraticCurveTo(4,62,4,44);ctx.lineTo(4,22);ctx.quadraticCurveTo(4,4,22,4);ctx.fill();ctx.stroke();
    ctx.fillStyle='#2a2622';for(const x of [42,64,86]){ctx.beginPath();ctx.arc(x,33,6,0,Math.PI*2);ctx.fill();}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    return new THREE.SpriteMaterial({map:texture});
  })();

  const SKIN=0xe5ba91,HAIR=0x2f2925,TROUSERS=0x38414c,SHOES=0x2a2622,FIGURE_SCALE=1;
  const part=(geometry,color,x,y,z,parent)=>mesh(geometry,color,x,y,z,parent,false);

  function softBox(w,h,d){
    const key=[w,h,d].join('/');if(softShapes.has(key))return softShapes.get(key);
    const radius=Math.min(w,h,d)*.22,shape=new THREE.BoxGeometry(w,h,d,4,4,4);
    const points=shape.attributes.position,inner=new THREE.Vector3(),normal=new THREE.Vector3();
    for(let i=0;i<points.count;i++){
      normal.fromBufferAttribute(points,i);
      inner.set(Math.max(-w/2+radius,Math.min(w/2-radius,normal.x)),Math.max(-h/2+radius,Math.min(h/2-radius,normal.y)),Math.max(-d/2+radius,Math.min(d/2-radius,normal.z)));
      normal.sub(inner).normalize().multiplyScalar(radius).add(inner);points.setXYZ(i,normal.x,normal.y,normal.z);
    }
    shape.computeVertexNormals();softShapes.set(key,shape);return shape;
  }
  function blendPose(rig,leg,arm,y,z,lean,dt,sway=0){
    const k=rig.posed?1-Math.exp(-dt*12):1;rig.posed=true;
    const ease=(object,key,value)=>{object[key]+=(value-object[key])*k;};
    rig.legs.forEach(({thigh,knee},i)=>{ease(thigh.rotation,'x',leg[i][0]);ease(knee.rotation,'x',leg[i][1]);});
    rig.arms.forEach(({shoulder,elbow},i)=>{ease(shoulder.rotation,'x',arm[i][0]);ease(shoulder.rotation,'z',(i?1:-1)*arm[i][1]);ease(elbow.rotation,'x',arm[i][2]);});
    ease(rig.body.position,'y',y);ease(rig.body.position,'z',z);ease(rig.hips.rotation,'x',lean);ease(rig.hips.rotation,'z',sway);
    rig.sync?.();
  }
  function joint(parent,x,y,z,length,width,color){
    const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);
    part(softBox(width,length,width*.92),color,0,-length/2,0,pivot);
    return pivot;
  }
  function buildLegacyFigure(shirt,gender,index){
    const figure=new THREE.Group();figure.scale.setScalar(FIGURE_SCALE);
    const body=new THREE.Group();figure.add(body);
    const hips=new THREE.Group();hips.position.y=.88;body.add(hips);
    part(softBox(.55,.17,.35),TROUSERS,0,.015,0,hips);
    oval(.64,.7,.43,shirt,0,.38,0,hips).userData.shirt=true;
    part(softBox(.13,.14,.13),SKIN,0,.75,0,hips);
    const head=new THREE.Group();head.position.y=1.02;hips.add(head);
    oval(.68,.7,.61,SKIN,0,.03,0,head);
    oval(.72,.38,.65,HAIR,0,.25,-.055,head);
    for(let i=0;i<5;i++){
      const lock=oval(.23,.27,.23,HAIR,-.27+i*.13,.27+Math.sin(i)*.035,.18,head);lock.rotation.z=-.3+i*.1;
    }
    for(const side of [-1,1]){
      oval(.12,.19,.13,SKIN,side*.33,0,0,head);
      oval(.058,.088,.03,HAIR,side*.13,.025,.293,head);
      oval(.016,.023,.012,0xffffff,side*.13-.01,.043,.31,head);
      oval(.1,.04,.016,0xd59a80,side*.19,-.09,.275,head);
    }
    oval(.085,.065,.08,SKIN,0,-.04,.3,head);
    oval(.09,.026,.02,0x895d4c,0,-.15,.286,head);
    if(gender==='female'){
      oval(.65,.68,.27,HAIR,0,-.13,-.25,head);
      for(const side of [-1,1])oval(.18,.55,.28,HAIR,side*.29,-.12,-.06,head);
      if(index%2===0)oval(.32,.33,.32,HAIR,.19,.4,-.23,head);
    }else{
      oval(.62,.35,.22,HAIR,0,.11,-.27,head);
      oval(.35,.23,.35,HAIR,.14,.39,-.03,head);
    }
    const legs=[-1,1].map(sx=>{
      const thigh=joint(hips,sx*.155,-.03,0,.38,.25,TROUSERS);
      const knee=joint(thigh,0,-.38,0,.39,.24,TROUSERS);
      part(softBox(.27,.12,.38),SHOES,0,-.41,.055,knee);
      return {thigh,knee};
    });
    const arms=[-1,1].map(sx=>{
      const shoulder=joint(hips,sx*.425,.65,0,.33,.23,shirt);shoulder.children[0].userData.shirt=true;
      const elbow=joint(shoulder,0,-.33,0,.29,.2,SKIN);
      oval(.23,.22,.23,SKIN,0,-.31,0,elbow);
      return {shoulder,elbow};
    });
    const cup=part(new THREE.CylinderGeometry(.08,.07,.17,10),CARD,0,-.36,.13,arms[1].elbow);
    const phone=part(softBox(.045,.25,.14),SHOES,-.1,-.34,0,arms[1].elbow);
    cup.visible=phone.visible=false;
    return {figure,body,hips,head,legs,arms,cup,phone,seatDrop:.29};
  }
  // Stage 2: proportional humans from office-people.js; the old chibi figure stays as fallback.
  function character(person,index) {
    const g=new THREE.Group(),rig=PEOPLE?.build(person,metaOf(person.group).color)||buildLegacyFigure(metaOf(person.group).color,person.gender,index);
    g.add(rig.figure);
    rig.cue=mesh(new THREE.CylinderGeometry(.012,.02,1.45,8),BALSA,0,-.3,0,rig.arms[1].elbow,false);rig.cue.visible=false;
    const bubble=new THREE.Sprite(bubbleMaterial);bubble.scale.set(.75,.45,1);bubble.center.set(-.3,-.1);bubble.visible=false;g.add(bubble);
    const label=document.createElement('button');label.className='name-label';label.type='button';label.textContent=person.initials;
    label.title=`${person.initials}, ${person.role}`;label.setAttribute('aria-label',`View ${person.initials}, ${person.role}`);$('labels').append(label);
    const desk=desks[person.n];g.position.set(desk.x,0,desk.z);g.rotation.y=facing(desk);floors[desk.floor].add(g);
    const aisle=desk.route[0][0],stretchZ=desk.z-desk.f*.95;
    const stretchSpot=linkSpot(desk._item,{x:desk.x,z:stretchZ,f:desk.f,floor:desk.floor,route:[[aisle,passage(desk.floor)],[aisle,stretchZ]],state:'stretch',local:true,label:'Berdiri sejenak'},false);stretchSpot._dynamic=true;
    const agent={...person,index,g,rig,bubble,label,desk,stretchSpot,heading:facing(desk),floor:desk.floor,spot:desk,path:[],destination:desk,state:'work',stairTrip:null,activity:null,visitor:null,nextRoutine:rand(6,25)};
    label.onclick=()=>selectAgent(agent);g.traverse(o=>{o.userData.agent=agent;});return agent;
  }

  // Walking grid per floor, rasterised from the furniture itself: anything between ankle and head height blocks,
  // grown by a body radius. Built once, before any people are placed, so only the static office counts.
  // Cells are 0 open, 1 furniture (a seat can be reached through it) or 2 wall (walls, glass, partitions: never crossed).
  const NAV={cell:.2,x0:-16.4,z0:-12.4,w:164,h:124,clear:.22,soft:.16};
  // A clear 16:9 presentation display for the meeting room: bright slide, slim bezel, soundbar and camera.
  function meetingDisplay(x,z,parent){
    const c=document.createElement('canvas');c.width=768;c.height=432;const ctx=c.getContext('2d');
    ctx.fillStyle='#f5f1e8';ctx.fillRect(0,0,768,432);
    ctx.fillStyle='#1e2230';ctx.fillRect(0,0,768,56);
    ctx.fillStyle='#f5f1e8';ctx.font='700 22px Archivo, system-ui, sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('KANTOR KITA',24,29);
    ctx.fillStyle='#f0a531';ctx.fillRect(700,18,40,20);
    ctx.fillStyle='#1e2230';ctx.font='700 42px Archivo, system-ui, sans-serif';ctx.fillText('Sinkronisasi mingguan',24,116);
    ctx.fillStyle='#6b6f7b';ctx.font='500 19px Archivo, system-ui, sans-serif';ctx.fillText('Ruang rapat · agenda, progres, dan keputusan',24,151);
    const cards=[['Tugas aktif','8','#f0a531'],['Selesai','12','#5f9a94'],['Perlu keputusan','2','#c95f5f']];
    cards.forEach(([label,value,color],i)=>{const cx=24+i*244;ctx.fillStyle='#ffffff';ctx.fillRect(cx,178,224,92);ctx.fillStyle=color;ctx.fillRect(cx,178,6,92);ctx.fillStyle='#6b6f7b';ctx.font='600 16px Archivo, system-ui, sans-serif';ctx.fillText(label,cx+20,206);ctx.fillStyle='#1e2230';ctx.font='700 32px Archivo, system-ui, sans-serif';ctx.fillText(value,cx+20,244);});
    ctx.fillStyle='#1e2230';ctx.font='700 18px Archivo, system-ui, sans-serif';ctx.textBaseline='alphabetic';ctx.fillText('Progres per divisi',24,314);
    [38,54,44,68,58,72].forEach((h,i)=>{ctx.fillStyle=i%2?'#5f9a94':'#f0a531';ctx.fillRect(24+i*48,400-h,28,h);});
    ctx.strokeStyle='#d8d2c6';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(24,402);ctx.lineTo(330,402);ctx.stroke();
    ctx.fillStyle='#9a9488';ctx.font='500 14px Archivo, system-ui, sans-serif';ctx.fillText('Rapat dimulai 09.30 · 45 menit',24,420);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    box(2.7,1.55,.07,DARK,x,.86,z,parent);
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(2.48,1.36),new THREE.MeshBasicMaterial({map:tex}));
    screen.position.set(x,1.635,z+.045);parent.add(screen);
    box(1.8,.1,.12,0x22262a,x,.72,z+.06,parent);
    box(1.1,.07,.08,0x2a2e32,x,2.48,z+.03,parent);
  }
  // Room dressing in the spirit of the reference interiors: art on the walls, plants, shelves, rugs, lounge pieces,
  // pendant and arc lights, a TV in the meeting room, and dark window mullions. Placed in free space only.
  function dress(level){
    const f=floors[level];if(!f||f.userData.dressed)return;f.userData.dressed=true;
    // Height is rotation-invariant: fitting a thin picture by world-X width after a quarter turn scales its depth into a giant wall.
    const wall=(name,x,z,rotY,y=1.55,size={h:.8})=>{const o=decor(name,size,f,{x,y,z,rotY});if(o)o.userData.walkable=true;return o;};
    // Window mullions along the long glass walls: dark frames every 2 m like floor-to-ceiling glazing.
    if(level!==4)for(let x=-15;x<=15;x+=2)decorBox('window_frame',.06,2.38,.08,'metal_black',x,0,-12.08,f);
    if(isWork(level)){
      for(const [x,z,r] of [[-6.5,-11.85,0],[1.5,-11.85,0],[8,-11.85,0],[-15.85,2,Math.PI/2],[15.85,2.5,-Math.PI/2]])wall('painting',x,z,r);
      wall('clock',-1,-11.88,0,2.05,{w:.4});
      // Meeting room: a large presentation screen on a walnut slat wall, patterned rug.
      decorBox('wood_panel',3.4,2.2,.04,'wood_panel_walnut',-13.2,.45,-11.86,f);meetingDisplay(-13.2,-11.8,f);
      decorBox('rug',3.6,.012,2.6,'rug_pattern',-13.2,.025,-9,f);
      // Back lounge: shaggy rug, glass coffee table, cushions, arc lamp, tall plants, bookshelf with books.
      decorBox('rug',3.2,.012,2.2,'rug_shaggy',-2.8,.03,-9.4,f);decor('coffee_table_glass',{w:1.1},f,{x:-1.6,z:-9.2});
      decor('cushions',{w:.9},f,{x:-3.4,y:.52,z:-10.75});decor('arc_lamp',{h:1.9},f,{x:-5.6,z:-11.3});
      decor('plant_tall',{h:1.5},f,{x:-0.9,z:-11.4});decor('plant_tall',{h:1.5},f,{x:7,z:-11.4});
      if(level!==3)decor('bookshelf',{w:2.6,h:2,d:.6},f,{x:4.6,z:-11.55,rotY:Math.PI/2});
      decor('books',{w:.5,h:.25,d:.3},f,{x:4.6,y:1.1,z:-11.5});
      // Pantry lounge: rug, side table, lamp, pendants over the counter.
      decorBox('rug',2.4,.012,3,'rug_shaggy',13.6,.03,-7.5,f);decor('side_table',{h:.55},f,{x:13.2,z:-5.4});
      for(const x of [10.8,12.8])decor('pendant_lamp',{h:.6},f,{x,y:2.32,z:-11});
      decor('tv_cabinet',{w:1.8},f,{x:12.6,z:-4.6,rotY:Math.PI});
      // Aisles: tall plants at the ends.
      for(const [x,z] of [[-15.2,-1],[15.2,-1],[-15.2,11.4],[15.2,11.4]])decor('plant_tall',{h:1.6},f,{x,z});
    }else if(level===1){
      for(const [x,z,r] of [[-13.5,-11.85,0],[-8,-11.85,0]])wall('mirror',x,z,r,1.4,{h:1});
      for(const [x,z] of [[-15.2,-10.8],[-4.2,-10.8],[-15.2,6],[-3.5,4]])decor('plant_tall',{h:1.6},f,{x,z});
      decorBox('rug',3.4,.012,2.2,'rug_shaggy',-7,.03,7.6,f);decor('coffee_table_glass',{w:1},f,{x:-7,z:8.8});
      wall('painting',-15.85,0,Math.PI/2);wall('painting',-2.1,-6,-Math.PI/2);wall('clock',-10.5,-11.88,0,2.05,{w:.4});
      decor('side_table',{h:.55},f,{x:-9.3,z:7.2});decor('arc_lamp',{h:1.9},f,{x:-9.6,z:6});
      for(const x of [-12,-9,-6])decor('pendant_lamp',{h:.6},f,{x,y:2.42,z:-8});
    }else if(level===2){
      for(const x of [-6,-1,4])decor('pendant_lamp',{h:.6},f,{x,y:2.42,z:5});
      for(const [x,z,r] of [[-15.85,-2,Math.PI/2],[15.85,0,-Math.PI/2],[-4,-11.85,0],[6,-11.85,0]])wall('painting',x,z,r);
      for(const [x,z] of [[-15.2,-10.8],[15.2,-10.8],[-15.2,11],[15.2,11]])decor('plant_tall',{h:1.6},f,{x,z});
      decor('bookshelf',{w:1.4,h:1.8,d:.55},f,{x:-14.5,z:-11.6,rotY:Math.PI/2});wall('clock',8.5,-11.88,0,2.05,{w:.4});
      decorBox('rug',4,.012,2.6,'rug_pattern',10.5,.03,6,f);
    }else if(level===4){
      for(const [x,z] of [[-15,-11],[15,-11],[-15,11],[15,11],[0,-11.2],[8,11]])decor('plant_tall',{h:1.7},f,{x,z});
      decorBox('rug',4.2,.012,2.6,'rug_shaggy',-8,.03,-7.3,f);decor('cushions',{w:.9},f,{x:-6.5,y:.52,z:-8.85});
      decor('coffee_table_glass',{w:1.1},f,{x:-8,z:-7.4});decor('side_table',{h:.55},f,{x:-11.3,z:-4});
    }
  }
  for(const level of Object.keys(floors).map(Number))dress(level);
  const navGrids={};
  // ---- custom rooms (port dari orchestrator-patterns): template geometry, seats as activity spots ----
  // Rooms land in the routine pools of their floor, so idle excursions and meetings reach them
  // through the stairs like any built-in place. applyRooms rebuilds them without a page reload.
  let customRooms=[];
  try{const roomsResponse=await fetch('/api/rooms',{cache:'no-store'});if(roomsResponse.ok){const list=await roomsResponse.json();if(Array.isArray(list))customRooms=list.filter(r=>!r.builtIn&&Number.isFinite(r.x)&&Number.isFinite(r.z));}}catch{/* static host: built-in office only */}
  const roomSpots=[],roomBuilt=new Map(),roomDoors=[],roomLabels=[],roomTextureMaps=[];
  const ROOM_RUGS={meeting:0xe6ded0,focus:0xdfe3d6,lounge:0xe8cfc0,pantry:0xb3c0a0,musholla:0xdfe3d6,custom:0xd8cfc0};
  const ROOM_SEAT=0xd9d2c3;
  function roomChair(parent,x,z,f){
    cylinder(.055,.15,.46,0x595d54,x,.06,z,parent);
    mesh(softBox(.78,.17,.72),ROOM_SEAT,x,.5,z,parent,false);
    mesh(softBox(.78,.78,.2),ROOM_SEAT,x,.88,z-f*.32,parent,false);
  }
  function roomPlant(parent,x,z,scale){
    cylinder(.3*scale,.24*scale,.5*scale,0xc9ab86,x,0,z,parent);
    for(let i=0;i<5;i++){const a=i*1.3,leaf=oval(.3*scale,.6*scale,.12*scale,i%2?0x64825b:0x839769,x+Math.cos(a)*.2*scale,.55*scale,z+Math.sin(a)*.2*scale,parent);leaf.rotation.set(.35,a,Math.sin(a)*.5);}
  }
  // Animated executive monitor: a small live dashboard redrawn on the simulation clock.
  const animatedScreens=[];
  // Open-floor plants hidden because a custom room now occupies their spot; restored when it moves away.
  const hiddenBaseDecor=new Set();
  function executiveScreen(){
    const c=document.createElement('canvas');c.width=320;c.height=192;const ctx=c.getContext('2d');
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    const draw=t=>{
      ctx.fillStyle='#0d121b';ctx.fillRect(0,0,320,192);
      ctx.fillStyle='#121a26';ctx.fillRect(0,0,320,22);
      ctx.fillStyle='#8fa7b8';ctx.font='600 11px "IBM Plex Mono", monospace';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('KANTOR KITA · LIVE',10,12);
      ctx.fillStyle=t%2<1?'#3fae6a':'#2a6b47';ctx.beginPath();ctx.arc(300,11,4,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(120,150,170,.15)';ctx.lineWidth=1;
      for(let y=40;y<176;y+=22){ctx.beginPath();ctx.moveTo(12,y);ctx.lineTo(308,y);ctx.stroke();}
      for(const [color,phase,amp,off] of [['#f0a531',0,26,96],['#3fae6a',1.6,18,140]]){
        ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
        for(let i=0;i<=48;i++){const x=12+i*(296/48),v=Math.sin(i*.32+t*.9+phase)+Math.sin(i*.11+t*.35+phase*2)*.6,y=off-v*amp*.55;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
        ctx.stroke();
      }
      for(let i=0;i<10;i++){const h=10+Math.abs(Math.sin(t*.7+i*.5))*26;ctx.fillStyle='#5f9a94';ctx.fillRect(226+i*8,176-h,5,h);}
      ctx.fillStyle='#6b7f92';ctx.font='600 10px "IBM Plex Mono", monospace';ctx.fillText(new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}),12,184);
    };
    draw(0);
    return {texture,draw};
  }
  function roomFurniture(parent,item){
    if(item.kind==='table'){mesh(softBox(2.6,.14,1.3),BALSA,item.x,.88,item.z,parent,false);for(const sx of [-1,1])box(.09,.82,.09,DARK,item.x+sx*1.1,.06,item.z,parent);}
    else if(item.kind==='chair')roomChair(parent,item.x,item.z,1);
    else if(item.kind==='sofa'){mesh(softBox(2.8,.45,1),0xb8c3a6,item.x,.22,item.z,parent,false);mesh(softBox(2.8,.78,.24),0x9dab90,item.x,.55,item.z-.38,parent,false);}
    else if(item.kind==='board'){box(2,1.25,.07,CARD,item.x,1,item.z,parent);box(1.8,1.05,.02,SCREEN,item.x,1.07,item.z+.045,parent);for(const sx of [-1,1])box(.07,.45,.07,DARK,item.x+sx*.9,0,item.z,parent);}
    else if(item.kind==='plant')roomPlant(parent,item.x,item.z,.9);
  }
  function buildRoom(room){
    const group=new THREE.Group();group.position.set(room.x,0,room.z);floors[room.floor].add(group);
    const P=passage(room.floor),cap=Math.min(room.capacity,8),seats=[];
    mesh(softBox(room.w-.1,.04,room.d-.1),ROOM_RUGS[room.type]??0xd8cfc0,0,.02,0,group,false);
    const addSeat=(lx,lz,angle,state,standing=false)=>seats.push({x:room.x+lx,z:room.z+lz,f:1,angle,floor:room.floor,
      route:[[Math.max(-14,Math.min(14,room.x)),P]],state,label:`Menuju ${room.name}`,room:room.id,roomName:room.name,occupant:null,standing});
    const seated=(lx,lz,facing,state)=>{roomChair(group,lx,lz,facing);addSeat(lx,lz,facing>0?0:Math.PI,state);};
    if(room.type==='meeting'||room.type==='custom'){
      const state=room.type==='meeting'?'meet':'lounge';
      const tw=room.w-2.2,td=Math.min(room.d-1.8,2.2);
      mesh(softBox(tw,.14,td),BALSA,0,.88,0,group,false);
      for(const sx of [-1,1])for(const sz of [-1,1])box(.09,.82,.09,DARK,sx*(tw/2-.15),.06,sz*(td/2-.12),group);
      const perSide=Math.max(1,Math.min(3,Math.ceil(cap/2)));
      let placed=0;
      for(const side of [-1,1])for(let i=0;i<perSide&&placed<cap;i++,placed++)
        seated(side*(room.w/2-.75),(i-(perSide-1)/2)*.95,-side,state);
      // Seats past six go to the short ends of the table, facing in.
      for(const side of [-1,1])if(placed<cap)seated((placed++-2.5)*.95,side*(room.d/2-.75),-side,state);
      if(room.type==='meeting'){box(2.2,1.1,.08,DARK,0,1.1,-room.d/2+.12,group);box(2,.95,.02,SCREEN,0,1.17,-room.d/2+.17,group);}
    }else if(room.type==='lounge'){
      const sw=room.w-1.5;
      mesh(softBox(sw,.45,1),0xb8c3a6,0,.22,-room.d/2+.85,group,false);
      mesh(softBox(sw,.8,.24),0x9dab90,0,.55,-room.d/2+.4,group,false);
      for(let i=0;i<cap;i++)addSeat((i-(cap-1)/2)*Math.min(1.35,sw/Math.max(cap,1)),-room.d/2+.85,0,'lounge');
      cylinder(.55,.55,.06,BALSA,0,.5,room.d/2-1,group);cylinder(.07,.12,.48,DARK,0,.06,room.d/2-1,group);
    }else if(room.type==='focus'){
      // A large focus room is a leader's office: the desk sits at the back, the owner behind it
      // facing the door, guests across the desk, and a credenza and floor lamp fill the space.
      const executive=room.w>=3.2&&room.d>=4;
      const deskZ=executive?-room.d/2+2.2:0,dw=executive?Math.min(2.6,room.w-1.4):1.8,dd=executive?1.05:.9;
      mesh(softBox(dw,.14,dd),BALSA,0,.88,deskZ,group,false);
      for(const sx of [-1,1])box(.09,.82,.09,DARK,sx*(dw/2-.2),.06,deskZ,group);
      if(executive){
        // Owner behind the desk (away from the door), reading an animated monitor on the far edge.
        seated(0,deskZ-.85,1,'work');
        const mon=new THREE.Group();mon.position.set(0,.88,deskZ+.3);group.add(mon);
        box(.07,.2,.07,DARK,0,.02,0,mon);box(.95,.58,.06,DARK,0,.2,0,mon);
        const screen=executiveScreen();
        const panel=new THREE.Mesh(new THREE.PlaneGeometry(.86,.5),new THREE.MeshBasicMaterial({map:screen.texture}));
        panel.position.set(0,.2,-.034);panel.rotation.y=Math.PI;mon.add(panel);
        animatedScreens.push({group,floor:room.floor,room:room.id,texture:screen.texture,draw:screen.draw,last:-1});
        box(.5,.02,.16,0x2a2b2f,0,.96,deskZ-.15,group); // keyboard within reach
        for(const gx of [-.95,.95])roomChair(group,gx,deskZ+2.9,-1); // guests face the leader
        box(.5,.72,2.2,BALSA,-room.w/2+.32,0,deskZ+1.1,group);
        box(.55,.05,2.3,CARD,-room.w/2+.32,.72,deskZ+1.1,group);
        cylinder(.18,.18,.03,DARK,-room.w/2+.45,0,room.d/2-1.6,group);
        cylinder(.025,.025,1.12,DARK,-room.w/2+.45,.03,room.d/2-1.6,group);
        cylinder(.15,.23,.3,0xe7d8b6,-room.w/2+.45,1.15,room.d/2-1.6,group);
      }else{
        box(.07,.17,.07,DARK,0,.95,-.25,group);box(.9,.55,.06,DARK,0,1.12,-.25,group);box(.8,.45,.015,SCREEN,0,1.18,-.2,group);
        seated(0,.95,-1,'work');
        roomPlant(group,room.w/2-.5,-room.d/2+.5,.5);
      }
    }else if(room.type==='pantry'){
      box(room.w-1,.9,.7,0xcdb28a,0,0,-room.d/2+.45,group);
      box(room.w-.9,.06,.8,CARD,0,.9,-room.d/2+.45,group);
      cylinder(.2,.2,.4,0xc4dadb,-room.w/4,.96,-room.d/2+.45,group);
      for(let i=0;i<cap;i++)addSeat((i-(cap-1)/2)*1,-room.d/2+1.4,Math.PI,'drink');
    }else if(room.type==='musholla'){
      box(room.w-.4,1.05,.1,CARD,0,0,-room.d/2+.06,group);
      const perRow=Math.min(4,Math.ceil(cap/2));
      for(let i=0;i<cap;i++){
        const lx=(i%perRow-(perRow-1)/2)*1.1,lz=i<perRow?-room.d/2+1.1:room.d/2-1.1;
        box(.7,.03,1.05,i%2?0xa98158:0x86968a,lx,.03,lz,group);
        addSeat(lx,lz,Math.PI,'pray');
      }
    }
    // Focus and meeting rooms are enclosed: glass partitions, window frames and an auto door
    // with a nameplate, so a private office reads as a room instead of an open patch of rug.
    if(room.type==='focus'||room.type==='meeting'){
      const H=2.4,half=room.w/2-.03,front=room.d/2-.03,back=-room.d/2+.03;
      const doorW=Math.max(.8,Math.min(.9,room.w-.6)),gapLeft=Math.max(-half+.2,half-doorW-.3),gapRight=gapLeft+doorW;
      const wall=(w,h,d,x,y,z)=>box(w,h,d,'glass',x,y,z,group);
      wall(room.w-.06,H,.05,0,0,back);
      wall(.05,H,room.d-.1,-half,0,0);wall(.05,H,room.d-.1,half,0,0);
      wall(gapLeft-half,H,.05,(gapLeft-half)/2,0,front);
      wall(half-gapRight,H,.05,(gapRight+half)/2,0,front);
      for(const [px,pz] of [[-half,back],[half,back],[-half,front],[half,front],[gapLeft,front],[gapRight,front]])box(.08,H,.08,DOOR_FRAME,px,0,pz,group);
      box(room.w,.07,.1,DOOR_FRAME,0,H,back,group);box(room.w,.07,.1,DOOR_FRAME,0,H,front,group);
      box(.1,.07,room.d,DOOR_FRAME,-half,H,0,group);box(.1,.07,room.d,DOOR_FRAME,half,H,0,group);
      // Window transoms along the sides and the back wall.
      for(const px of [-half,half])box(.06,.06,room.d-.1,DOOR_FRAME,px,1.05,0,group);
      box(room.w-.1,.06,.06,DOOR_FRAME,0,1.05,back,group);
      // The door hinges at the gap and swings inward; the walking grid treats it as open.
      const pivot=new THREE.Group();pivot.position.set(gapLeft,0,front);pivot.userData.walkable=true;group.add(pivot);
      box(doorW-.04,2.12,.05,'glass',doorW/2,0,0,pivot);box(.03,.5,.08,DARK,doorW-.14,1.0,0,pivot);
      const doorRecord={pivot,base:0,center:new THREE.Vector3(room.x+gapLeft+doorW/2,0,room.z+front),floor:room.floor,open:0,room:room.id};
      roomDoors.push(doorRecord);doors.push(doorRecord);
      // Nameplate above the door, readable from outside.
      const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');
      ctx.fillStyle='#fbf8f2';ctx.fillRect(0,0,512,96);ctx.strokeStyle='#2a2622';ctx.lineWidth=4;ctx.strokeRect(2,2,508,92);
      ctx.fillStyle='#1e2230';ctx.font='700 44px Archivo, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      const full=String(room.name).toUpperCase();let label=full;while(ctx.measureText(label).width>480&&label.length>4)label=label.slice(0,-2);
      if(label!==full)label=label.trimEnd()+'…';
      ctx.fillText(label,256,50);
      const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;roomTextureMaps.push({texture:tex,room:room.id});
      const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.21),new THREE.MeshBasicMaterial({map:tex}));
      sign.position.set((gapLeft+gapRight)/2,H+.2,front+.03);group.add(sign);
    }
    for(const item of room.furniture??[])roomFurniture(group,item);
    const roomLabel=textPlane(String(room.name).toUpperCase(),room.x,room.z+room.d/2+.7,Math.min(6,room.w),'#5c554b',floors[room.floor]);
    roomLabel.userData.roomId=room.id;roomLabels.push({mesh:roomLabel,room:room.id});
    return {group,seats};
  }
  const roomPool=floor=>floor===1?floorBreaks:floor===2?dining:floor===ROOF?roofSpots:hangouts;
  // A room is only rebuilt when its own definition changes, so an unrelated edit cannot strand
  // people who are already sitting in another room.
  const roomSignature=room=>JSON.stringify({name:String(room.name||''),floor:room.floor,type:room.type,x:room.x,z:room.z,w:room.w,d:room.d,capacity:room.capacity,owner:room.owner||null,furniture:(room.furniture||[]).map(item=>[item.kind,item.x,item.z])});
  const roomLayoutSignature=room=>JSON.stringify({floor:room.floor,type:room.type,x:room.x,z:room.z,w:room.w,d:room.d,capacity:room.capacity,furniture:(room.furniture||[]).map(item=>[item.kind,item.x,item.z])});
  function removeRoomSpots(roomId){
    for(let i=roomSpots.length-1;i>=0;i--){
      const spot=roomSpots[i];if(spot.room!==roomId)continue;
      const pool=roomPool(spot.floor),at=pool.indexOf(spot);if(at>=0)pool.splice(at,1);
      const pray=prayerSpots.indexOf(spot);if(pray>=0)prayerSpots.splice(pray,1);
      roomSpots.splice(i,1);
    }
  }
  function removeRoomBuilt(roomId){
    const built=roomBuilt.get(roomId);if(!built)return;
    built.group.parent?.remove(built.group);
    for(let i=roomDoors.length-1;i>=0;i--)if(roomDoors[i].room===roomId){const at=doors.indexOf(roomDoors[i]);if(at>=0)doors.splice(at,1);roomDoors.splice(i,1);}
    for(let i=roomLabels.length-1;i>=0;i--)if(roomLabels[i].room===roomId){const mesh=roomLabels[i].mesh;mesh.parent?.remove(mesh);mesh.material?.map?.dispose();mesh.material?.dispose();mesh.geometry?.dispose();roomLabels.splice(i,1);}
    for(let i=roomTextureMaps.length-1;i>=0;i--)if(roomTextureMaps[i].room===roomId){roomTextureMaps[i].texture.dispose();roomTextureMaps.splice(i,1);}
    for(let i=animatedScreens.length-1;i>=0;i--)if(animatedScreens[i].room===roomId){animatedScreens[i].texture.dispose();animatedScreens.splice(i,1);}
    removeRoomSpots(roomId);roomBuilt.delete(roomId);
  }
  function captureRoomOccupants(roomId){
    const seats=roomSpots.filter(spot=>spot.room===roomId),saved=[];
    for(const agent of agents){
      const spot=agent.spot?.room===roomId?agent.spot:agent.activity?.spot?.room===roomId?agent.activity.spot:agent.destination?.room===roomId?agent.destination:null;
      if(!spot)continue;const index=seats.indexOf(spot);if(index<0)continue;
      saved.push({agent,index,seated:agent.spot===spot,destination:agent.destination===spot,activity:agent.activity?.spot===spot});
    }
    return saved;
  }
  function detachRoomOccupants(roomId){
    const seats=new Set(roomSpots.filter(spot=>spot.room===roomId));
    for(const agent of agents){
      if(!seats.has(agent.spot)&&!seats.has(agent.destination)&&!seats.has(agent.activity?.spot))continue;
      clearActivity(agent);
      if(seats.has(agent.spot))agent.spot=null;
      if(seats.has(agent.destination))agent.destination=agent.desk;
      setPath(agent,agent.desk);
    }
  }
  function reattachRoomOccupants(saved,built,room){
    for(const rec of saved){
      const spot=built.seats[rec.index];if(!spot)continue;
      spot.ownerRoom=room.owner||null;
      if(rec.activity&&rec.agent.activity)rec.agent.activity.spot=spot;
      if(rec.seated||rec.activity)spot.occupant=rec.agent;
      if(rec.seated){
        rec.agent.spot=spot;rec.agent.destination=spot;
        rec.agent.g.position.set(spot.x,0,spot.z);rec.agent.heading=facing(spot);rec.agent.g.rotation.y=rec.agent.heading;
      }else if(rec.destination)rec.agent.destination=spot;
    }
  }
  function addRoomSeats(room,built){
    for(const spot of built.seats){spot.ownerRoom=room.owner||null;roomSpots.push(spot);if(spot.state==='pray')prayerSpots.push(spot);else roomPool(room.floor).push(spot);}
  }
  function applyRooms(list){
    const next=(list||[]).filter(room=>!room.builtIn&&Number.isFinite(room.x)&&Number.isFinite(room.z));
    const nextById=new Map(next.map(room=>[room.id,room])),touched=new Set();
    // Rebuild only removed or changed rooms. Unchanged rooms keep their group, seats and occupants.
    for(const [id,built] of [...roomBuilt]){
      const room=nextById.get(id),signature=room?roomSignature(room):null;
      if(room&&built.signature===signature)continue;
      const old=customRooms.find(item=>item.id===id),sameLayout=!!room&&!!old&&roomLayoutSignature(old)===roomLayoutSignature(room);
      const saved=sameLayout?captureRoomOccupants(id):[];
      if(!sameLayout)detachRoomOccupants(id);
      removeRoomBuilt(id);
      if(old)touched.add(old.floor);
      if(room)touched.add(room.floor);
      if(room&&floors[room.floor]){
        const rebuilt=buildRoom(room);roomBuilt.set(id,{...rebuilt,signature});
        addRoomSeats(room,rebuilt);
        if(sameLayout)reattachRoomOccupants(saved,rebuilt,room);
      }
    }
    // A room on a floor that was just created is built now; one on a missing floor waits for that floor.
    for(const room of next){
      if(roomBuilt.has(room.id)||!floors[room.floor])continue;
      const built=buildRoom(room);roomBuilt.set(room.id,{...built,signature:roomSignature(room)});
      addRoomSeats(room,built);touched.add(room.floor);
    }
    customRooms=next;
    // Loose open-floor plants are put away inside a room's footprint; moving or deleting the room brings them back.
    for(const item of hiddenBaseDecor)if(item.parent)item.visible=true;
    hiddenBaseDecor.clear();
    for(const room of customRooms){
      const floorGroup=floors[room.floor];if(!floorGroup)continue;
      floorGroup.traverse(o=>{
        if(o.userData.decor!=='plant_tall'&&o.userData.decor!=='plant_small')return;
        const at=o.getWorldPosition(new THREE.Vector3());
        if(Math.abs(at.x-room.x)<room.w/2&&Math.abs(at.z-room.z)<room.d/2){o.visible=false;hiddenBaseDecor.add(o);}
      });
    }
    // Room furniture joins the collision grid exactly like an edited desk. Floors whose last room
    // disappeared are rebuilt too, so their old collision cells do not linger.
    for(const floor of touched)if(floors[floor])navGrids[floor]=rasterize(floors[floor],a=>a.userData.walkable||a.userData.agent||a.visible===false);
    return customRooms.length;
  }
  applyRooms(customRooms);
  // One rasterizer for start-up and furniture edits. skip(a) excludes ancestors (walkable pads, agents, hidden items).
  function rasterize(rootF,skip=a=>a.userData.walkable){
    const grid=rootF.userData.staticGrid?new Uint8Array(rootF.userData.staticGrid):new Uint8Array(NAV.w*NAV.h),bounds=new THREE.Box3(),y0=rootF.position.y;rootF.updateMatrixWorld(true);
    rootF.traverse(o=>{
      if(o.userData.merged)return; // Its original collision cells were saved before visual geometry was merged.
      // A furniture model blocks its requested footprint (the space the procedural piece took), not mesh by mesh.
      const isModel=!!o.userData.model;
      if(!isModel&&(!o.isMesh||o.material?.isMeshBasicMaterial))return;
      // The floor group itself is hidden while another floor is selected; that must not erase its
      // dynamic furniture from the grid when a room edit asks for a rebuild.
      for(let a=o;a&&a!==rootF;a=a.parent){if(skip(a))return;if(!isModel&&a!==o&&a.userData.model)return;}
      if(isModel){const f=o.userData.footprint,c=o.getWorldPosition(new THREE.Vector3()),yaw=new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion())).y,sw=Math.abs(Math.sin(yaw))>.7;
        const hw=(sw?f.d:f.w)/2,hd=(sw?f.w:f.d)/2;bounds.min.set(c.x-hw,c.y,c.z-hd);bounds.max.set(c.x+hw,c.y+f.h,c.z+hd);}
      else bounds.setFromObject(o);
      if(bounds.max.y-y0<.18||bounds.min.y-y0>1.75)return;
      const sx=bounds.max.x-bounds.min.x,sz=bounds.max.z-bounds.min.z;
      const wall=bounds.max.y-y0>1.9||Math.min(sx,sz)<.3&&Math.max(sx,sz)>1.2,value=wall?2:1,pad=wall?NAV.clear:NAV.soft;
      const i0=Math.max(0,Math.floor((bounds.min.x-pad-NAV.x0)/NAV.cell)),i1=Math.min(NAV.w-1,Math.floor((bounds.max.x+pad-NAV.x0)/NAV.cell));
      const j0=Math.max(0,Math.floor((bounds.min.z-pad-NAV.z0)/NAV.cell)),j1=Math.min(NAV.h-1,Math.floor((bounds.max.z+pad-NAV.z0)/NAV.cell));
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)if(grid[j*NAV.w+i]<value)grid[j*NAV.w+i]=value;
    });
    return grid;
  }
  for(const [key,root] of Object.entries(floors))navGrids[key]=rasterize(root);
  // Draw-call budget: static architecture never moves, so each floor's plain meshes are merged per material after
  // the walking grid is built. Custom furniture, desk areas, agents, models, decor and anything animated stay separate.
  function mergeStatic(rootF){
    const groups=new Map(),drop=[];rootF.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(rootF.matrixWorld).invert();
    rootF.traverse(o=>{
      if(!o.isMesh||o.isInstancedMesh||o.isSkinnedMesh||o.material.transparent||Array.isArray(o.material)||o.userData.agent)return;
      for(let a=o;a&&a!==rootF;a=a.parent)if(a.userData.customId||a.userData.deskArea||a.userData.agent||a.userData.model||a.userData.decor||a.userData.walkable||a.userData.keep||!a.visible)return;
      if(doorPads.includes(o)||o.parent!==rootF&&o.parent.parent!==rootF&&!o.parent.isGroup)return;
      const geometry=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
      for(const name of Object.keys(geometry.attributes))if(!['position','normal','uv'].includes(name))geometry.deleteAttribute(name);
      if(!geometry.attributes.uv||!geometry.attributes.normal)return;
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld));
      const key=o.material.uuid+(o.castShadow?'c':'');if(!groups.has(key))groups.set(key,{material:o.material,cast:o.castShadow,list:[]});groups.get(key).list.push(geometry);drop.push(o);
    });
    for(const {material,cast,list} of groups.values()){
      if(list.length<2){list.forEach(g=>g.dispose());continue;}
      const merged=new THREE.Mesh(ADD.BufferGeometryUtils.mergeGeometries(list),material);merged.castShadow=cast;merged.receiveShadow=true;merged.userData.merged=true;rootF.add(merged);list.forEach(g=>g.dispose());
    }
    const kept=new Set([...groups.values()].filter(g=>g.list.length>=2).map(g=>g.material.uuid+(g.cast?'c':'')));
    const collisionObjects=new Set(drop.filter(o=>kept.has(o.material.uuid+(o.castShadow?'c':''))));
    // Preserve only the merged static pieces' cells, not movable desks/furniture which must be rasterized fresh.
    rootF.userData.staticGrid=rasterize(rootF,o=>o.userData.walkable||o.isMesh&&!collisionObjects.has(o));
    for(const o of collisionObjects){o.parent.remove(o);o.geometry.dispose();}
  }
  for(const rootF of Object.values(floors))mergeStatic(rootF);
  const cellOf=(x,z)=>[Math.floor((x-NAV.x0)/NAV.cell),Math.floor((z-NAV.z0)/NAV.cell)];
  const centerOf=(i,j)=>[NAV.x0+(i+.5)*NAV.cell,NAV.z0+(j+.5)*NAV.cell];
  const open=(grid,i,j)=>i>=0&&j>=0&&i<NAV.w&&j<NAV.h&&!grid[j*NAV.w+i];
  // The open cell closest to a seat or a standing spot, searched through furniture but never through a wall,
  // so the last step into a chair never crosses glass.
  function nearestOpen(grid,i,j){
    const W=NAV.w,seen=new Set([j*W+i]),queue=[[i,j]];
    for(let k=0;k<queue.length&&k<3000;k++){
      const [ci,cj]=queue[k];if(open(grid,ci,cj))return [ci,cj];
      for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const ni=ci+di,nj=cj+dj,key=nj*W+ni;
        if(ni<0||nj<0||ni>=W||nj>=NAV.h||seen.has(key)||grid[key]===2)continue;
        seen.add(key);queue.push([ni,nj]);
      }
    }
    return null;
  }
  function sightLine(grid,ax,az,bx,bz){
    const steps=Math.ceil(Math.hypot(bx-ax,bz-az)/(NAV.cell*.5));
    for(let k=1;k<steps;k++){const [i,j]=cellOf(ax+(bx-ax)*k/steps,az+(bz-az)*k/steps);if(!open(grid,i,j))return false;}
    return true;
  }
  // Where to step off the open floor into a seat: from behind the chair (so neighbours at a table use different
  // gaps), or from the front for sofas and swings; whichever side crosses less furniture on the last step.
  function approachCell(grid,to,seat){
    if(!seat||seat.standing||seat.angle===undefined&&seat.f===undefined)return nearestOpen(grid,...cellOf(...to));
    const a=facing(seat),fx=Math.sin(a),fz=Math.cos(a),options=[];
    for(const side of [-1,1]){
      const cell=nearestOpen(grid,...cellOf(to[0]+fx*side*.8,to[1]+fz*side*.8));if(!cell)continue;
      const [cx,cz]=centerOf(...cell),steps=Math.ceil(Math.hypot(cx-to[0],cz-to[1])/(NAV.cell*.5));let crossed=0;
      for(let k=1;k<steps;k++){const [i,j]=cellOf(to[0]+(cx-to[0])*k/steps,to[1]+(cz-to[1])*k/steps);if(!open(grid,i,j))crossed++;}
      options.push({cell,cost:crossed+(side<0?0:.5)});
    }
    options.sort((p,q)=>p.cost-q.cost);
    return options[0]?.cell||nearestOpen(grid,...cellOf(...to));
  }
  // A* over the grid (8 neighbours, no corner cutting), then string-pulled into a few straight legs.
  function navPath(level,from,to,self,seat=null,leaving=null){
    const base=navGrids[level];if(!base)return null;
    const grid=base.slice();
    // People standing still are obstacles too; seated people are already covered by their chair.
    for(const o of agents){
      if(o===self||o.floor!==level||o.state==='walk'||o.state==='stairs'||(SIT.has(o.state)&&!o.spot?.standing))continue;
      const q=o.g.position;if(Math.hypot(q.x-to[0],q.z-to[1])<.5||Math.hypot(q.x-from[0],q.z-from[1])<.5)continue;
      const [ci,cj]=cellOf(q.x,q.z);
      for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++)if(di*di+dj*dj<=5&&ci+di>=0&&cj+dj>=0&&ci+di<NAV.w&&cj+dj<NAV.h)grid[(cj+dj)*NAV.w+ci+di]||=1;
    }
    const s=approachCell(grid,from,leaving),g=approachCell(grid,to,seat);if(!s||!g)return null;
    const W=NAV.w,N=W*NAV.h,start=s[1]*W+s[0],goal=g[1]*W+g[0];
    const cost=new Float32Array(N).fill(Infinity),came=new Int32Array(N).fill(-1),done=new Uint8Array(N);
    const heap=[],push=(node,f)=>{heap.push([f,node]);let k=heap.length-1;while(k){const up=(k-1)>>1;if(heap[up][0]<=heap[k][0])break;[heap[up],heap[k]]=[heap[k],heap[up]];k=up;}};
    const popMin=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m;}}return top[1];};
    const h=node=>{const dx=Math.abs(node%W-g[0]),dz=Math.abs((node/W|0)-g[1]);return Math.max(dx,dz)+.414*Math.min(dx,dz);};
    cost[start]=0;push(start,h(start));
    while(heap.length){
      const node=popMin();if(node===goal)break;if(done[node])continue;done[node]=1;
      const i=node%W,j=node/W|0;
      for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
        if(!di&&!dj||!open(grid,i+di,j+dj))continue;
        if(di&&dj&&(!open(grid,i+di,j)||!open(grid,i,j+dj)))continue;
        const next=(j+dj)*W+i+di,c=cost[node]+(di&&dj?1.414:1);
        if(c<cost[next]){cost[next]=c;came[next]=node;push(next,c+h(next));}
      }
    }
    if(start!==goal&&came[goal]<0)return null;
    const cells=[];for(let n=goal;n!==-1;n=n===start?-1:came[n])cells.push(centerOf(n%W,n/W|0));cells.reverse();
    const points=[...cells,to],path=[];let anchor=from;
    for(let k=0;k<points.length;){
      let far=k;while(far+1<points.length&&sightLine(grid,anchor[0],anchor[1],points[far+1][0],points[far+1][1]))far++;
      if(far===k&&k<points.length-1)far=k;
      path.push(points[far]);anchor=points[far];k=far+1;
    }
    return path;
  }
  TEAM.forEach((person,index)=>agents.push(character(person,index)));
  // Barber shop on floor 1: two barbers, a cashier, and customers who arrive, wait on the sofa, get a haircut,
  // pay and leave. They are generic visitors, not team members, so they carry no name labels.
  const shop={people:[],chairs:[-11,-6].map(x=>({x,customer:null})),seats:[-8.4,-7,-5.6].map(x=>({x,customer:null})),paying:null,nextArrival:6};
  function extra(shirt,gender,index,x,z,rot){
    const g=new THREE.Group(),visitor={n:`Pengunjung ${index}`,gender};
    const rig=PEOPLE?.build(visitor,shirt)||buildLegacyFigure(shirt,gender,index);
    g.add(rig.figure);g.position.set(x,0,z);g.rotation.y=rot;floors[1].add(g);
    return {g,rig,pose:'stand',path:[],heading:rot,seat:0};
  }
  const barbers=shop.chairs.map((c,i)=>{const b=extra(0x5c554b,i?'female':'male',i+20,c.x+1.05,-8.2,-Math.PI/2);b.chair=c;return b;});
  const cashier=extra(0x5c554b,'female',23,-13.5,1.75,0);
  const customerShirts=[0xa9a397,0x8a6a4a,0x6f8580,0xc08a64,0x9aa89c,0xb89c70,0x7d8a9a];
  customerShirts.forEach((shirt,i)=>{const c=extra(shirt,i%3===1?'female':'male',i+30,7,13,Math.PI);c.state='outside';c.g.visible=false;shop.people.push(c);});
  function walk(person,points,then){person.path=points.map(([x,z])=>new THREE.Vector3(x,0,z));person.then=then;person.pose='walk';}
  function sit(person,rot,seatY,pose='sit'){person.pose=pose;person.seat=seatY;person.heading=rot;}
  function toChair(c,chair){
    chair.customer=c;c.state='toChair';const from=c.g.position;
    walk(c,[[from.x,5.8],[chair.x,-6.4],[chair.x,-8]],()=>{c.state='cut';c.until=simTime+18+Math.random()*10;sit(c,Math.PI,.21);});
  }
  function toSofa(c,seat){
    seat.customer=c;c.state='toSofa';c.g.visible=true;c.g.position.set(7,0,13);
    walk(c,[[7,4.5],[-3,4.5],[seat.x,5.8],[seat.x,7.1]],()=>{c.state='waiting';c.since=simTime;sit(c,0,-.09,Math.random()<.5?'phone':'sit');});
  }
  // Starting scene: both chairs busy, two people waiting.
  shop.chairs.forEach((chair,i)=>{const c=shop.people[i];chair.customer=c;c.g.visible=true;c.g.position.set(chair.x,0,-8);c.g.rotation.y=Math.PI;c.state='cut';c.until=6+i*9;sit(c,Math.PI,.21);});
  shop.seats.slice(0,2).forEach((seat,i)=>{const c=shop.people[2+i];seat.customer=c;c.g.visible=true;c.g.position.set(seat.x,0,7.1);c.g.rotation.y=0;c.state='waiting';c.since=-i;sit(c,0,-.09,i?'phone':'sit');});
  function shopPose(person,dt){
    const {body,hips,legs,arms,phone}=person.rig,t=simTime+person.g.id;
    let leg=[[0,0],[0,0]],arm=[[.02,.07,-.15],[.02,.07,-.15]],bodyY=0,bodyZ=0,lean=0;
    if(person.pose==='walk'){const w=t*8;leg=[[Math.sin(w)*.5,Math.max(0,Math.sin(w+1.3))*.75],[-Math.sin(w)*.5,Math.max(0,-Math.sin(w+1.3))*.75]];arm=[[-Math.sin(w)*.4,.07,-.25],[Math.sin(w)*.4,.07,-.25]];bodyY=Math.abs(Math.sin(w))*.03;}
    else if(person.pose==='sit'||person.pose==='phone'){leg=[[-Math.PI/2,Math.PI/2],[-Math.PI/2,Math.PI/2]];bodyY=-(person.rig.seatDrop??.29)+person.seat;bodyZ=.2;arm=[[-.35,.1,-.95],[-.35,.1,-.95]];if(person.pose==='phone')arm[1]=[-.9,.05,-1.5];}
    else if(person.pose==='cut'){const snip=Math.sin(t*10)*.12;arm=[[-1.25,-.15,-1.1],[-1.45+snip,.25,-1.25-snip]];lean=.12;}
    else if(person.pose==='till'){const k=Math.sin(t*9)*.08;arm=[[-.85+k,.1,-.6],[-.85-k,.1,-.6]];lean=.08;}
    else if(person.pose==='pay'){arm[1]=[-1.2,.08,-.35];}
    blendPose(person.rig,leg,arm,bodyY,bodyZ,lean,dt,person.pose==='walk'?Math.sin(t*8)*.035:Math.sin(t*1.4)*.008);
    phone.visible=person.pose==='phone';
    person.g.rotation.y+=wrap(person.heading-person.g.rotation.y)*Math.min(1,dt*8);
  }
  function updateVisitorTravel(dt){if(dt<=0)return;const snapshot=mobility.snapshot();for(const c of shop.people){if(!c.vehicleTrip)continue;const t=snapshot.trips.find(t=>t.id===c.vehicleTrip);if(!t){c.vehicleTrip=null;c.state='outside';c.g.visible=false;continue;}
    if(t.phase==='dismount'){const seat=shop.seats.find(s=>!s.customer);if(!seat)continue;const bay=environment.layout.parking.find(b=>b.id===t.parking);c.g.visible=true;c.g.position.set(bay.position[0]+1.35,0,bay.position[2]);mobility.arrive(t.id,'dismount');seat.customer=c;c.state='toSofa';walk(c,[[7,c.g.position.z],[7,4.5],[-3,4.5],[seat.x,5.8],[seat.x,7.1]],()=>{c.state='waiting';c.since=simTime;sit(c,0,-.09);mobility.arrive(t.id,'walkToOffice');});}
    else if(t.phase==='mount'){c.vehicleTimer=(c.vehicleTimer||0)+dt;if(c.vehicleTimer>.7){c.g.visible=false;mobility.arrive(t.id,'mount');c.state='driving';}}
  }}
  function stepShop(dt){
    for(const person of [...shop.people,...barbers,cashier]){
      if(person.path.length){
        let distance=dt*2.4;
        while(person.path.length&&distance>0){
          const target=person.path[0],p=person.g.position,d=p.distanceTo(target);
          if(d>.001)person.heading=Math.atan2(target.x-p.x,target.z-p.z);
          if(d<=distance){p.copy(target);distance-=d;person.path.shift();}else{p.addScaledVector(target.clone().sub(p),distance/d);distance=0;}
        }
        if(!person.path.length&&person.then){const then=person.then;person.then=null;person.pose='stand';then();}
      }
      shopPose(person,dt);
    }
    for(const chair of shop.chairs){
      const c=chair.customer;
      if(!c){const next=shop.people.filter(p=>p.state==='waiting').sort((a,b)=>a.since-b.since)[0];if(next){shop.seats.find(s=>s.customer===next).customer=null;toChair(next,chair);}}
      else if(c.state==='cut'&&simTime>c.until&&!shop.paying){
        shop.paying=c;chair.customer=null;c.state='toPay';
        walk(c,[[chair.x,-6.4],[-10,-6.4],[-10,3.5],[-13.5,3.5]],()=>{c.state='pay';c.until=simTime+4;c.pose='pay';c.heading=Math.PI;});
      }
    }
    const payer=shop.paying;
    if(payer?.state==='pay'&&simTime>payer.until){
      shop.paying=null;payer.state='leaving';
      if(payer.vehicleTrip){const trip=mobility.snapshot().trips.find(t=>t.id===payer.vehicleTrip),bay=trip&&environment.layout.parking.find(b=>b.id===trip.parking);if(bay){mobility.departVisitor(trip.owner);walk(payer,[[-10,3.5],[-10,4.5],[7,4.5],[bay.position[0]+1.35,bay.position[2]]],()=>{mobility.arrive(trip.id,'walkToVehicle');payer.state='mounting';payer.vehicleTimer=0;});}}
      else walk(payer,[[-10,3.5],[-10,4.5],[7,4.5],[7,13]],()=>{payer.state='outside';payer.g.visible=false;});
    }
    const seat=shop.seats.find(s=>!s.customer),waiting=shop.people.find(p=>p.state==='outside'&&!p.vehicleTrip);
    if(seat&&waiting&&simTime>shop.nextArrival&&environment.audit().loaded.includes('car')){const id=mobility.requestVisitor({id:'visitor-'+(++travelSerial),owner:'visitor-'+shop.people.indexOf(waiting),vehicle:'car',lane:'visitor-in'});if(id){waiting.vehicleTrip=id;waiting.arrivalMode='vehicle';waiting.state='driving';waiting.g.visible=false;}shop.nextArrival=simTime+12;}
    updateVisitorTravel(dt);
    for(const barber of barbers){const busy=barber.chair.customer?.state==='cut';barber.pose=busy?'cut':'stand';barber.heading=-Math.PI/2;}
    cashier.pose=payer?.state==='pay'?'till':'stand';cashier.heading=0;
  }

  const ring=new THREE.Mesh(new THREE.RingGeometry(.5,.62,40),new THREE.MeshBasicMaterial({color:linear(ACCENT),side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);

  const SIT=new Set(['work','break','meet','lounge','call']),SOCIAL=new Set(['drink','look','lounge','meet']),MAX_AWAY=4;
  // Office log: simulated events only, newest first.
  function log(text,group) {
    // The first person named in the event gets an initials chip in their desk-group colour.
    const lead=agents.map(p=>[text.indexOf(p.n),p]).filter(([at])=>at>=0).sort((a,b)=>a[0]-b[0])[0]?.[1];
    for(const person of [...agents].sort((a,b)=>b.n.length-a.n.length))text=text.replaceAll(person.n,person.initials);
    const item=document.createElement('li');item.style.setProperty('--dot',hex(metaOf(lead?.group??group).color??INK));
    const time=document.createElement('time');time.textContent=new Date().toTimeString().slice(0,5);
    const body=document.createElement('span');body.className='log-text';body.textContent=text;
    if(lead){const chip=document.createElement('span');chip.className='log-chip';chip.textContent=lead.initials;chip.setAttribute('aria-hidden','true');body.prepend(chip);item.classList.add('has-chip');}
    item.append(time,body);$('logList').prepend(item);
    while($('logList').children.length>40)$('logList').lastChild.remove();
    $('logEmpty').hidden=true;
  }
  const ACTIVITY_LOG={drink:'mendapat minum di pantry',look:'membaca papan tugas',lounge:'beristirahat di lounge',call:'menerima panggilan di bilik telepon',break:'beristirahat'};
  // Who joins prayer time is chosen by the user per person, never assumed.
  const PRAY_KEY='kantor-ai.musholla.v1';let prayers=new Set();
  try{prayers=new Set((JSON.parse(localStorage.getItem(PRAY_KEY)||'[]')||[]).filter(n=>TEAM.some(p=>p.n===n)));}catch{prayers=new Set();}
  function savePrayers(){try{localStorage.setItem(PRAY_KEY,JSON.stringify([...prayers]));}catch{status('Pilihan waktu salat tidak bisa disimpan di browser ini. Pilihan tetap berlaku sampai halaman dimuat ulang.');}}
  function prayerTime() {
    const group=agents.filter(a=>prayers.has(a.n));
    if(!group.length){status('Belum ada yang ikut. Pilih anggota tim, lalu centang "Ikut waktu salat".');return;}
    const going=group.slice(0,prayerSpots.length);
    going.forEach((a,i)=>assign(a,prayerSpots[i],rand(18,24)));
    const names=going.map(a=>a.initials).join(', ');
    log(`Waktu salat: ${names} menuju ruang salat`,going[0].group);
    status(group.length>going.length?`Simulasi: ${going.length} orang menuju ruang salat. Tersedia ${prayerSpots.length} sajadah.`:`Simulasi: ${names} menuju ruang salat.`);
  }
  const STAIR_DOOR=[-16,7.5];
  function setPath(agent,spot) {
    clearActivity(agent);
    // A new destination (command or routine) outranks mobility's own return-to-desk reroutes.
    agent.commanded=spot!==agent.desk;
    // A new command changes the destination, but never pulls a person off a flight mid-step.
    if(agent.state==='stairs'){agent.destination=spot;return;}
    if(agent.spot===spot){agent.destination=spot;agent.path=[];arrive(agent);return;}
    const p=agent.g.position,old=agent.spot,P=passage(agent.floor);
    agent.destination=spot;agent.state='walk';agent.spot=null;
    // Standing up behind the chair and sitting back down is a short direct step.
    if(spot.local||(old?.local&&spot===agent.desk)){agent.path=[[spot.x,spot.z]];return;}
    // Walk around furniture and people on the walking grid; the hand-written routes remain as a fallback.
    // Leaving a seat steps out the way the seat is entered, so neighbours at a table do not meet in the same gap.
    const leaving=old&&Math.hypot(p.x-old.x,p.z-old.z)<.3?old:null;
    const planned=agent.floor!==spot.floor?navPath(agent.floor,[p.x,p.z],STAIR_DOOR,agent,null,leaving):navPath(agent.floor,[p.x,p.z],[spot.x,spot.z],agent,spot,leaving);
    if(planned){agent.path=planned;return;}
    // Every spot has a route from the floor's central passage; leaving reverses it.
    const departure=old?[...old.route].reverse():[[p.x,P]];
    agent.path=agent.floor!==spot.floor?[...departure,[-14,P],[-14,7.5],STAIR_DOOR]:[...departure,...spot.route,[spot.x,spot.z]];
  }
  function arrive(agent) {
    const spot=agent.destination;agent.spot=spot;agent.state=spot.state||(spot===agent.desk||isWork(spot.floor)?'work':'break');
    agent.commanded=false;
    const activity=agent.activity;
    if(activity?.spot===spot){if(activity.meeting)settleMeeting(activity.meeting);else activity.until=simTime+activity.duration;}
    if(spot===agent.desk&&agent.nextRoutine<simTime+8)agent.nextRoutine=simTime+rand(8,25);
  }
  function settleMeeting(meeting) {
    // The meeting clock starts once everyone has sat down.
    if(meeting.members.every(m=>m.spot===m.activity.spot)&&meeting.members.some(m=>m.activity.until===Infinity))
      meeting.members.forEach(m=>{m.activity.until=simTime+m.activity.duration;});
  }
  function clearActivity(agent) {
    const activity=agent.activity;
    if(activity){
      if(activity.spot.occupant===agent)activity.spot.occupant=null;
      if(activity.spot.host?.visitor===agent)activity.spot.host.visitor=null;
      const item=activity.spot._item;
      item?.activityRefs.delete(agent);
      if(activity.spot._dynamic&&item){const index=item.seatRefs.indexOf(activity.spot);if(index>=0)item.seatRefs.splice(index,1);}
      agent.activity=null;agent.nextRoutine=simTime+rand(20,50)*(window.officeTasks.activeFor(agent.n)?2.5:1);
      const meeting=activity.meeting;
      if(meeting){
        meeting.members=meeting.members.filter(m=>m!==agent);
        if(meeting.members.length<2)meeting.members.forEach(m=>{m.activity.duration=1;m.activity.until=Math.min(m.activity.until,simTime+1);});
        else settleMeeting(meeting);
      }
    }
    // A host who is called away cuts the visit short.
    const visitor=agent.visitor;
    if(visitor){agent.visitor=null;if(visitor.activity){visitor.activity.duration=.8;visitor.activity.until=Math.min(visitor.activity.until,simTime+.8);}}
  }
  function visitSpot(host) {
    const d=host.desk,side=-d.f,toCenter=d.x<(d.cx??0)?1:-1,z=d.z+side*1.05,aisle=d.route[0][0];
    const spot=linkSpot(d._item,{x:d.x+toCenter*.75,z,f:d.f,floor:d.floor,route:[[aisle,passage(d.floor)],[aisle,z]],state:'chat',host,label:`Walking over to ${host.initials}`},false);spot._dynamic=true;return spot;
  }
  const reservedByOthers=(spot,allowed=[])=>!!spot.occupant&&!allowed.includes(spot.occupant)||agents.some(a=>a.destination===spot&&!allowed.includes(a));
  const reserved=spot=>spot.blocked||reservedByOthers(spot);
  // An owned room is private: only its member picks its seats (a removed member makes it public again).
  const roomOwnerAllows=(agent,spot)=>!spot.ownerRoom||spot.ownerRoom===agent.n||!agents.some(a=>a.n===spot.ownerRoom);
  const routineSpots=floor=>floor===1?floorBreaks:floor===2?dining:floor===ROOF?roofSpots:hangouts;
  function assign(agent,spot,duration,extra={}) {
    setPath(agent,spot);
    if('occupant' in spot)spot.occupant=agent;
    agent.activity={spot,duration,until:Infinity,...extra};
    spot._item?.activityRefs.add(agent);
  }
  function startActivity(agent) {
    const idle=agents.filter(o=>o!==agent&&o.floor===agent.floor&&o.state==='work'&&o.spot===o.desk&&!o.visitor&&!o.activity);
    const excursions=shuffle([1,2,4]).map(floor=>shuffle(routineSpots(floor).filter(spot=>!reserved(spot)&&roomOwnerAllows(agent,spot))).find(Boolean)).filter(Boolean);
    const away=agents.filter(a=>a.activity).length;
    if(excursions.length&&away<MAX_AWAY&&Math.random()<.35){const spot=pick(excursions);assign(agent,spot,rand(6,11));log(`${agent.n} ${spot.label||ACTIVITY_LOG[spot.state]||'beristirahat'}`,agent.group);return;}
    const open=kind=>hangouts.filter(s=>s.state===kind&&!reserved(s)&&roomOwnerAllows(agent,s));
    const prefer=list=>{const mates=list.filter(o=>o.group===agent.group);return mates.length&&Math.random()<.6?mates:list;};
    const roll=Math.random();
    if(roll<.28&&idle.length){const host=pick(prefer(idle));assign(agent,visitSpot(host),rand(7,12));host.visitor=agent;log(`${agent.n} menghampiri ${host.n}`,agent.group);return;}
    if(roll>=.76&&roll<.9&&idle.length&&away<MAX_AWAY-1){
      // One meeting stays in one room: pick a room with enough free seats for the party.
      const free=open('meet'),byRoom=new Map();
      for(const s of free){const k=s.room||'seed-meeting';byRoom.set(k,[...(byRoom.get(k)||[]),s]);}
      const seats=shuffle([...byRoom.values()].find(group=>group.length>=2)||[]);
      if(seats.length>=2){
        const others=shuffle(prefer(idle)).slice(0,away<MAX_AWAY-2&&Math.random()<.5?2:1);
        const meeting={members:[agent,...others]},duration=rand(10,16);
        meeting.members.forEach((m,i)=>assign(m,seats[i],duration,{meeting}));
        log(`Rapat singkat di ruang rapat: ${meeting.members.map(m=>m.n).join(', ')}`,agent.group);return;
      }
    }
    const kind=roll<.44?'drink':roll<.54?'look':roll<.66?'lounge':roll<.76?'call':null;
    const spot=kind&&pick(open(kind));
    if(spot){assign(agent,spot,rand(6,11));log(`${agent.n} ${ACTIVITY_LOG[kind]}`,agent.group);return;}
    assign(agent,agent.stretchSpot,rand(3.5,6));
  }
  // Excursions pace on the wall clock: a slow renderer slows simTime (dt is clamped per
  // frame), and an idle-member drive should not become minutes just because the FPS dipped.
  let travelSerial=0,nextExcursion=performance.now()+40000;
  let travelTaskStateKnown=false;
  document.addEventListener('officetasks:server',()=>{travelTaskStateKnown=true;});
  const tasksKnown=()=>travelTaskStateKnown||!!window.officeTasks?.online?.();
  function updateTeamTravel(dt){
    if(dt<=0)return;
    const snapshot=mobility.snapshot(),byId=new Map(snapshot.trips.map(t=>[t.id,t]));
    for(const a of agents){
      if(!a.vehicleTrip)continue;
      const trip=byId.get(a.vehicleTrip);
      if(!trip){a.vehicleTrip=null;a.vehiclePhase=null;a.g.visible=true;a.rig.figure.visible=true;setPath(a,a.commanded&&a.destination?a.destination:a.desk);continue;}
      if(!window.OfficeMobility.canDepart(a.n,window.officeTasks.list(),tasksKnown())||!routineOn){mobility.recall(a.n);a.commanded=false;}
      a.vehiclePhase=trip.phase;
      if(trip.phase==='walkToVehicle'){
        if(a.floor===1&&a.spot===a.vehicleSpot)mobility.arrive(trip.id,'walkToVehicle');
      }else if(trip.phase==='mount'){
        a.vehicleTimer=(a.vehicleTimer||0)+dt;if(a.vehicleTimer>.7){a.vehicleTimer=0;mobility.arrive(trip.id,'mount');}
      }else if(['outbound','away','inbound','park'].includes(trip.phase)){
        const v=snapshot.vehicles.find(v=>v.id===trip.id);if(v){const riding=v.kind==='motorcycle';a.g.visible=riding;a.rig.figure.visible=riding;if(a.floor!==1){a.floor=1;moveTo(floors[1],a.g);}a.g.position.set(...v.pose);a.g.rotation.y=v.heading;if(riding){const rig=a.rig;rig.body.position.set(0,-(rig.seatDrop??.29)+.22,-.12);rig.hips.rotation.set(.12,0,0);for(const leg of rig.legs){leg.thigh.rotation.x=-1.35;leg.knee.rotation.x=1.3;}for(const arm of rig.arms){arm.shoulder.rotation.x=-.8;arm.shoulder.rotation.z=0;arm.elbow.rotation.x=-.6;}rig.sync?.();if(!a.helmet){a.helmet=new THREE.Mesh(new THREE.SphereGeometry(.135,16,10,0,Math.PI*2,0,Math.PI*.7),new THREE.MeshStandardMaterial({color:0x232c34,roughness:.45}));const head=rig.bones?.get('head')||rig.head;head.add(a.helmet);a.helmet.position.set(0,.13,0);}a.helmet.visible=true;}}
      }else if(trip.phase==='dismount'){
        a.g.visible=true;a.rig.figure.visible=true;if(a.helmet)a.helmet.visible=false;a.state='stretch';const spot=a.vehicleSpot;a.g.position.set(spot.x,0,spot.z);a.floor=1;moveTo(floors[1],a.g);a.spot=spot;a.destination=spot;
        mobility.arrive(trip.id,'dismount');setPath(a,a.commanded&&a.destination?a.destination:a.desk);
      }else if(trip.phase==='walkToOffice'){
        a.g.visible=true;a.rig.figure.visible=true;
        // A destination commanded while away survives the return; the trip just ends here.
        if(a.commanded){mobility.arrive(trip.id,'walkToOffice');}
        else{if(a.destination!==a.desk)setPath(a,a.desk);if(a.spot===a.desk)mobility.arrive(trip.id,'walkToOffice');}
      }
    }
    if(!routineOn||!tasksKnown()||performance.now()<nextExcursion||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    nextExcursion=performance.now()+25000;
    const a=agents.find(a=>!a.vehicleTrip&&!a.activity&&a.spot===a.desk&&window.OfficeMobility.canDepart(a.n,window.officeTasks.list(),true));
    if(!a)return;const kind=travelSerial%2?'motorcycle':'car';if(!environment.audit().loaded.includes(kind))return;
    const id=mobility.request({id:'team-trip-'+(++travelSerial),owner:a.n,kind:'team',vehicle:kind});if(!id)return;
    const trip=mobility.snapshot().trips.find(t=>t.id===id),bay=environment.layout.parking.find(p=>p.id===trip.parking);
    a.vehicleTrip=id;a.vehiclePhase='walkToVehicle';a.vehicleSpot={x:bay.position[0]+(kind==='car'?1.35:.85),z:bay.position[2],floor:1,f:1,state:'stretch',route:[[7,7],[7,bay.position[2]]]};setPath(a,a.vehicleSpot);a.commanded=false;
  }
  function live(agent) {
    const activity=agent.activity;
    if(activity){if(agent.spot===activity.spot&&simTime>=activity.until)setPath(agent,agent.desk);return;}
    if(agent.floor===ROOF&&agent.destination?.floor===ROOF&&!agent.activity){roofRoutine(agent);return;}
    if(!routineOn||agent.floor!==agent.desk.floor||agent.state!=='work'||agent.spot!==agent.desk||agent.visitor||simTime<agent.nextRoutine)return;
    if(agents.filter(a=>a.activity).length>=MAX_AWAY){agent.nextRoutine=simTime+rand(3,8);return;}
    startActivity(agent);
  }
  // On the rooftop people move between activities, but only once everyone heading up has arrived.
  function roofRoutine(agent) {
    const settled=agents.every(a=>a.destination?.floor!==ROOF||(a.floor===ROOF&&a.spot===a.destination));
    if(!routineOn||!settled||agent.spot!==agent.destination){agent.roofNext=simTime+rand(12,20);return;}
    if(simTime<agent.roofNext)return;
    agent.roofNext=simTime+rand(16,28);
    const free=roofSpots.filter(s=>!reserved(s));
    if(!free.length)return;
    const spot=pick(free);setPath(agent,spot);log(`${agent.n} ${ROOF_STATUS[spot.fun]||spot.fun}`,agent.group);
  }
  function circleOf(agent) {
    if(agent.state==='chat'){const host=agent.activity?.spot.host;return host&&host.visitor===agent&&host.spot===host.desk&&host.state==='work'?[agent,host]:[];}
    if(agent.visitor?.state==='chat'&&agent.state==='work'&&agent.spot===agent.desk)return [agent.visitor,agent];
    if(SOCIAL.has(agent.state))return agents.filter(o=>o.state===agent.state&&o.floor===agent.floor);
    return [];
  }
  const companions=agent=>circleOf(agent).filter(o=>o!==agent);
  function speaking(agent) {
    if(agent.state==='call')return Math.floor(simTime/2.2+agent.index)%2===0;
    const circle=circleOf(agent).sort((a,b)=>a.index-b.index);
    return circle.length>1&&circle[Math.floor(simTime/1.9)%circle.length]===agent;
  }
  const wrap=a=>((a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
  // Keyboard position relative to the seated shoulder, measured once from the real desk geometry (agent-local frame).
  function keyboardReach(agent){
    const kbs=[];floors[agent.floor].traverse(o=>{if(o.userData.model==='keyboard')kbs.push(o);});
    const here=agent.g.getWorldPosition(new THREE.Vector3()),kb=kbs.sort((a,b)=>a.getWorldPosition(new THREE.Vector3()).distanceTo(here)-b.getWorldPosition(new THREE.Vector3()).distanceTo(here))[0];
    if(!kb)return undefined;
    agent.g.updateMatrixWorld(true);
    const inv=new THREE.Matrix4().copy(agent.g.matrixWorld).invert(),k=kb.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const rest=agent.rig.body.position.y,restZ=agent.rig.body.position.z;agent.rig.body.position.set(0,-(agent.rig.seatDrop),.2);agent.rig.figure.updateMatrixWorld(true);
    const s=agent.rig.bones.get('upperarm01.R').getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    agent.rig.body.position.y=rest;agent.rig.body.position.z=restZ;agent.rig.figure.updateMatrixWorld(true);
    // Hands rest on the keys, a little above the keyboard origin.
    return agent.keyboardReach={dy:k.y+.04-s.y,dz:k.z-s.z};
  }
  // One pose per state, written as joint angles: legs [thigh, knee], arms [shoulder forward, shoulder outward, elbow].
  function pose(agent,state,walking,sitting,talking,partner,dt) {
    const {body,hips,head,legs,arms,cup,phone}=agent.rig,t=simTime,i=agent.index;
    let leg=[[0,0],[0,0]],arm=[[.02,.07,-.15],[.02,.07,-.15]],bodyY=0,bodyZ=0,lean=0;
    if(walking){
      const w=t*7.2+i*1.7;
      leg=[[Math.sin(w)*.5,Math.max(0,Math.sin(w+1.3))*.75],[-Math.sin(w)*.5,Math.max(0,-Math.sin(w+1.3))*.75]];
      arm=[[-Math.sin(w)*.4,.07,-.25],[Math.sin(w)*.4,.07,-.25]];bodyY=Math.abs(Math.sin(w))*.03;lean=.05;
    }else if(sitting){
      leg=[[-Math.PI/2,Math.PI/2],[-Math.PI/2,Math.PI/2]];bodyY=-(agent.rig.seatDrop??.29);bodyZ=state==='lounge'||state==='call'?.05:(agent.rig.bones?.06:.2);
      if(state==='work'){const typing=Math.sin(t*.65+i*2)>.1,k=typing?Math.sin(t*10+i)*.045:0;arm=[[-.9+k,.12,-.67],[typing?-.9-k:-.65,.12,typing?-.67:-.85]];lean=.08+Math.sin(t*.8+i)*.025;
        // Textured adults reach the actual keyboard: shoulder pitch/elbow come from two-bone IK on real limb lengths.
        if(agent.rig.reach){const r=agent.rig.reach(agent.keyboardReach||keyboardReach(agent));if(r){lean=r.lean+Math.sin(t*.8+i)*.02;arm=[[r.shoulder+k,.1,r.elbow],[typing?r.shoulder-k:r.shoulder+.25,.1,typing?r.elbow:r.elbow-.2]];}}}
      else if(state==='break'){arm=[[-.6,.1,-.9],[-.6,.1,-.9]];}
      else arm=[[-.35,.1,-.95],[-.35,.1,-.95]];
      if(state==='lounge')lean=-.15;
      // Bean bags sit lower and lean back.
      if(agent.spot?.roofPose==='beanbag'){bodyY=-(agent.rig.seatDrop??.29)-.12;lean=-.22;arm=[[-.25,.2,-.6],[-.25,.2,-.6]];}
    }else if(agent.spot?.roofPose==='billiard'){
      // Bent over the table, bridge hand forward, cue arm drawing back and striking.
      const stroke=Math.max(0,Math.sin(t*1.8+i))*.35;
      leg=[[-.2,.25],[.25,.05]];lean=.55;arm=[[-1.45,-.08,-.1],[-1.05+stroke,.12,-.35-stroke]];
    }else if(agent.spot?.roofPose==='pingpong'){
      // Ready stance with the paddle arm swinging through each rally.
      const k=Math.sin(t*4.2+i*1.3);leg=[[-.25,.35],[-.1,.3]];lean=.18;arm=[[-.5,-.1,-.9],[-.7+k*.55,.35,-1.1-k*.2]];
    }else if(agent.spot?.roofPose==='stretch'){
      const k=Math.sin(t*1.1+i)*.25;arm=[[-2.9+k,.25,-.1],[-2.9-k,.25,-.1]];lean=-.05+Math.max(0,Math.sin(t*.55+i))*.35;
    }else if(agent.spot?.roofPose==='coffee'){
      arm[1]=[-.45,.1,Math.sin(t*1.2+i)>.4?-2.25:-1.4];
    }else if(state==='stretch'){
      const k=Math.sin(t*1.6+i)*.1;arm=[[-2.9+k,.18,-.1],[-2.9-k,.18,-.1]];lean=-.08;
    }else if(state==='drink'){
      arm[1]=[-.45,.1,Math.sin(t*1.2+i)>.4?-2.25:-1.4];
    }else if(state==='look'){
      arm[0]=[-.55,-.05,-1.7];
    }else if(state==='pray'){
      arm=[[-.35,-.28,-1.55],[-.35,-.28,-1.55]];
    }
    if(talking&&state!=='call'&&!walking)arm[1]=[(sitting?-.7:-.5)+Math.sin(t*3+i)*.25,.25,-1.1+Math.sin(t*4.3)*.2];
    if(state==='call')arm[1]=[-.3,.38,-2.55];
    const sway=walking?Math.sin(t*7.2+i*1.7)*.035:Math.sin(t*1.2+i)*.008;
    blendPose(agent.rig,leg,arm,bodyY+(walking?0:Math.sin(t*1.5+i)*.008),bodyZ,lean,dt,sway);
    cup.visible=state==='drink'||(!walking&&agent.spot?.roofPose==='coffee');phone.visible=state==='call';
    agent.rig.cue.visible=!walking&&agent.spot?.roofPose==='billiard';
    // Seated people turn only their head toward whoever they talk with.
    let look=walking?Math.max(-.4,Math.min(.4,wrap(agent.heading-agent.g.rotation.y))):Math.sin(t*.45+i*2)*.08;
    if(partner&&sitting){const q=partner.g.position,p=agent.g.position;look=Math.max(-.9,Math.min(.9,wrap(Math.atan2(q.x-p.x,q.z-p.z)-agent.g.rotation.y)));}
    head.rotation.y+=(look-head.rotation.y)*(1-Math.exp(-dt*9));
    agent.rig.sync?.();
  }
  // Local courtesy while walking: follow someone going the same way, both step right when meeting head-on,
  // the later person waits at a crossing, and people standing still are walked around. Waiting never lasts
  // more than a few seconds, so nobody gets stuck.
  function giveWay(agent,dt){
    // After about three seconds of being held up in total, walk on for a moment regardless, so a crowd at a door
    // (everyone waiting for everyone) always clears.
    if(agent.passUntil>simTime)return false;
    const hold=()=>{agent.blocked=(agent.blocked||0)+dt;if(agent.blocked>3){agent.blocked=0;agent.passUntil=simTime+1.6;return false;}return true;};
    const p=agent.g.position,[tx,tz]=agent.path[0],len=Math.hypot(tx-p.x,tz-p.z);if(len<.05)return false;
    const fx=(tx-p.x)/len,fz=(tz-p.z)/len;
    for(const o of agents){
      if(o===agent||o.floor!==agent.floor||o.state==='stairs'||(SIT.has(o.state)&&!o.spot?.standing&&o.state!=='walk'))continue;
      const q=o.g.position,ox=q.x-p.x,oz=q.z-p.z,along=ox*fx+oz*fz,side=Math.abs(ox*fz-oz*fx);
      if(along<=.05||along>.95||side>.55)continue;
      let dot=0,moving=o.state==='walk'&&o.path.length;
      if(moving){const [ux,uz]=o.path[0],ul=Math.hypot(ux-q.x,uz-q.z)||1;dot=((ux-q.x)*fx+(uz-q.z)*fz)/ul;}
      // Same way, or crossing with the earlier person going first: wait.
      if(moving&&dot>.3||moving&&dot>=-.3&&o.index<agent.index)return hold();
      // Head-on, or someone standing in the way: one step to the right (or left), at most once a second.
      if(!agent.path[0].sidestep&&!(agent.sidestep>simTime)){
        const grid=navGrids[agent.floor];
        for(const turn of [1,-1]){
          const x=p.x+fx*.55+fz*.6*turn,z=p.z+fz*.55-fx*.6*turn;
          if(grid&&open(grid,...cellOf(x,z))&&sightLine(grid,p.x,p.z,x,z)&&sightLine(grid,x,z,tx,tz)){
            const step=[x,z];step.sidestep=true;agent.path.unshift(step);agent.sidestep=simTime+1;agent.blocked=(agent.blocked||0)+.5;return false;
          }
        }
      }
      return hold();
    }
    agent.blocked=Math.max(0,(agent.blocked||0)-dt*.5);return false;
  }
  function updateAgent(agent,dt) {
    const before=agent.g.getWorldPosition(new THREE.Vector3());
    if(agent.state==='stairs'){
      const trip=agent.stairTrip;let remaining=dt*3.1;
      // Queue behind whoever is just ahead on the same flight, going the same way.
      const ahead=agents.find(o=>o!==agent&&o.state==='stairs'&&o.stairTrip&&o.stairTrip.from===trip.from&&o.stairTrip.to===trip.to&&
        o.stairTrip.points.length<trip.points.length&&o.g.position.distanceTo(agent.g.position)<.85);
      if(ahead&&(agent.queued=(agent.queued||0)+dt)<3)remaining=0;else if(!ahead)agent.queued=0;
      if(trip.points.length){const d=trip.points[0].clone().sub(agent.g.position);if(Math.hypot(d.x,d.z)>.05){agent.heading=Math.atan2(d.x,d.z);if(Math.abs(wrap(agent.heading-agent.g.rotation.y))>1.3)remaining=0;}}
      while(trip.points.length&&remaining>0){
        const target=trip.points[0],delta=target.clone().sub(agent.g.position),distance=delta.length();
        if(Math.hypot(delta.x,delta.z)>.001)agent.heading=Math.atan2(delta.x,delta.z);
        if(distance<=remaining){agent.g.position.copy(target);remaining-=distance;trip.points.shift();}
        else{agent.g.position.addScaledVector(delta,remaining/distance);remaining=0;}
      }
      if(!trip.points.length){
        agent.floor=trip.to;moveTo(floors[agent.floor],agent.g);agent.stairTrip=null;
        if(agent.floor!==agent.destination.floor)beginStairs(agent);
        else{const s=agent.destination;agent.path=navPath(agent.floor,[agent.g.position.x,agent.g.position.z],[s.x,s.z],agent,s)||[[-14,7.5],[-14,passage(agent.floor)],...s.route,[s.x,s.z]];agent.state='walk';}
      }
    }
    const lastPoint=agent.path.length===1?agent.path[0]:null;
    const approach=lastPoint&&agent.destination.floor===agent.floor?Math.min(1,Math.max(.3,Math.hypot(lastPoint[0]-agent.g.position.x,lastPoint[1]-agent.g.position.z)/1.2)):1;
    let distance=dt*3.1*approach;
    if(agent.state==='walk'&&agent.path.length&&giveWay(agent,dt))distance=0;
    // Turn on the spot before setting off in a new direction, so nobody is seen walking backwards.
    if(agent.state==='walk'&&agent.path.length){
      const [x,z]=agent.path[0],p=agent.g.position;
      if(Math.hypot(x-p.x,z-p.z)>.05){agent.heading=Math.atan2(x-p.x,z-p.z);if(Math.abs(wrap(agent.heading-agent.g.rotation.y))>1.3)distance=0;}
    }
    while(agent.path.length&&distance>0){
      const [x,z]=agent.path[0],p=agent.g.position,dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
      if(d>.001)agent.heading=Math.atan2(dx,dz);
      if(d<=distance){p.x=x;p.z=z;distance-=d;agent.path.shift();}
      else{p.x+=dx/d*distance;p.z+=dz/d*distance;distance=0;}
      if(!agent.path.length){
        if(agent.floor!==agent.destination.floor)beginStairs(agent);
        else arrive(agent);
      }
    }
    // The walking animation plays only while someone actually covers ground; waiting in a queue or turning on the
    // spot is a standing pose, so nobody appears to walk in place or backwards.
    const moved=agent.g.getWorldPosition(new THREE.Vector3()).distanceTo(before);
    agent.stepping=moved>dt*.4?.25:Math.max(0,(agent.stepping||0)-dt);
    const state=agent.state,travelling=state==='walk'||state==='stairs',walking=travelling&&agent.stepping>0,sitting=SIT.has(state)&&!agent.spot?.standing,talking=speaking(agent);
    const partner=companions(agent).sort((a,b)=>agent.g.position.distanceTo(a.g.position)-agent.g.position.distanceTo(b.g.position))[0];
    if(!travelling&&agent.spot){
      const p=agent.g.position,q=partner?.g.position;
      agent.heading=q&&!sitting?Math.atan2(q.x-p.x,q.z-p.z):facing(agent.spot);
    }
    const turn=wrap(agent.heading-agent.g.rotation.y);agent.g.rotation.y+=turn*Math.min(1,dt*(Math.abs(turn)>1.3?14:8));
    pose(agent,state,walking,sitting,talking,partner,dt);
    agent.bubble.visible=talking;agent.bubble.position.set(0,sitting?2.05:2.55,0);
    agent.g.visible=visibleAgent(agent);
  }
  function moveTeam(level) {
    // Rooftop spots are dealt out at random, so different people end up at the billiard table and coffee bar.
    const roofOrder=level===ROOF?shuffle([...roofSpots]):[];
    // Dining and rooftop seats are fixed; anyone beyond them stays at their desk.
    agents.forEach((agent,i)=>setPath(agent,level===3?agent.desk:(level===2?dining[i]:roofOrder[i])||agent.desk));
    const message=level===3?'Simulasi: tim kembali ke meja.':level===2?'Simulasi: tim turun untuk makan siang.':'Simulasi: tim naik ke rooftop.';
    status(message);log(message.replace('Simulation: t','T'));
  }
  function commandMembers(members, action) {
    if(!members.length){status('Pilih minimal satu anggota tim.');return;}
    let spots;
    if(action==='meet'){
      const free=hangouts.filter(s=>s.state==='meet'&&!reservedByOthers(s,members)&&(!s.ownerRoom||members.some(m=>m.n===s.ownerRoom)));
      // A group meets in one room: keep the first room that fits everyone.
      const byRoom=new Map();
      for(const s of free){const k=s.room||'seed-meeting';byRoom.set(k,[...(byRoom.get(k)||[]),s]);}
      spots=[...byRoom.values()].find(group=>group.length>=members.length);
      if(!spots){
        const largest=Math.max(0,...[...byRoom.values()].map(group=>group.length));
        status(`Tidak ada satu ruangan yang menampung ${members.length} orang. Hanya ${largest} tempat tersedia di satu ruangan. Pilih lebih sedikit orang atau kembalikan yang sedang di sana ke meja.`);return;
      }
    }else if(action!=='work'){
      const pool=action==='lunch'?dining:shuffle([...roofSpots]);
      spots=pool.filter(s=>!reservedByOthers(s,members)&&(!s.ownerRoom||members.some(m=>m.n===s.ownerRoom)));
    }
    // Reserve the entire group before moving anyone; a full room must not split the invitation.
    if(spots&&spots.length<members.length){status(`Hanya ${spots.length} tempat tersedia. Pilih lebih sedikit orang atau kembalikan yang sedang di sana ke meja.`);return;}
    members.forEach(a=>{clearActivity(a);if(a.vehicleTrip){mobility.recall(a.n);a.commanded=false;}});
    members.forEach((a,i)=>{
      if(a.vehicleTrip)return;
      if(action==='meet')assign(a,spots[i],Infinity);
      else setPath(a,action==='work'?a.desk:spots[i]);
    });
    const names=members.map(a=>a.initials).join(', ');
    const destination={meet:'the meeting room',lunch:'lunch',roof:'the rooftop',work:'their desks'}[action];
    const message=`${names} heading to ${destination}.`;
    status(message+(action==='meet'?' Gunakan Kembali kerja untuk mengakhiri rapat.':''));log(message,members[0].group);
  }
  function memberCommands(agent){
    const section=document.createElement('section');section.className='member-commands';
    const label=document.createElement('label');label.htmlFor='iScope';label.textContent='Kirim instruksi ke';
    const scope=document.createElement('select');scope.id='iScope';
    for(const [value,text] of [['person',agent.initials],['division',metaOf(agent.group).name],['custom','Choose people…']]){
      const option=document.createElement('option');option.value=value;option.textContent=text;scope.append(option);
    }
    const people=document.createElement('fieldset');people.id='iPeople';people.hidden=true;
    const legend=document.createElement('legend');legend.textContent='Orang yang diikutkan';people.append(legend);
    for(const a of agents){const row=document.createElement('label');row.className='check';const input=document.createElement('input');input.type='checkbox';input.value=a.n;input.checked=a===agent;row.append(input,`${a.initials} · ${a.role}`);people.append(row);}
    scope.onchange=()=>{people.hidden=scope.value!=='custom';};
    const actions=document.createElement('div');actions.className='member-actions';
    for(const [action,text] of [['meet','Rapat bersama'],['lunch','Makan siang'],['roof','Rooftop'],['work','Kembali kerja']]){
      const button=document.createElement('button');button.className='btn';button.textContent=text;button.dataset.command=action;
      button.onclick=()=>{const chosen=new Set([...people.querySelectorAll('input:checked')].map(i=>i.value));commandMembers(scope.value==='person'?[agent]:agents.filter(a=>scope.value==='division'?a.group===agent.group:chosen.has(a.n)),action);};actions.append(button);
    }
    // The owner of a private room can work there with one click; routine leaves them alone until another command.
    const privateSeat=roomSpots.find(s=>s.ownerRoom===agent.n);
    if(privateSeat){
      const button=document.createElement('button');button.className='btn';button.textContent='Ruang pribadi';button.dataset.command='private-room';
      button.onclick=()=>{
        const seat=roomSpots.find(s=>s.ownerRoom===agent.n);
        if(!seat)return;
        if(seat.occupant&&seat.occupant!==agent){status(`${seat.roomName} sedang dipakai ${seat.occupant.initials}.`);return;}
        clearActivity(agent);assign(agent,seat,Infinity);
        status(`${agent.initials} bekerja di ${seat.roomName}.`);log(`${agent.n} bekerja di ${seat.roomName}`,agent.group);
      };
      actions.append(button);
    }
    section.append(label,scope,people,actions);return section;
  }
  function syncTaskDisplay(agent){
    const task=window.officeTasks.activeFor(agent.n);
    agent.label.classList.toggle('has-task',!!task);
    const description=`${agent.initials}, ${agent.role}${task?` · In progress: ${task.title}`:''}`;
    if(agent.label.title!==description){agent.label.title=description;agent.label.setAttribute('aria-label',`View ${description}`);}
    if(selected===agent&&$('iActiveTask')){
      const title=task?task.title:'Tidak ada tugas aktif';
      if($('iActiveTask').textContent!==title)$('iActiveTask').textContent=title;
      const brief=task?.brief||'';
      if($('iTaskBrief').textContent!==brief)$('iTaskBrief').textContent=brief;
      $('iTaskBrief').hidden=!brief;
    }
  }
  function agentStatus(agent) {
    const destination=agent.destination,others=companions(agent).map(o=>o.initials).join(' & ');
    if(agent.state==='stairs')return `Di tangga menuju ${floorName(destination.floor)}`;
    if(agent.state==='walk'){
      if(destination.label)return destination.label;
      if(destination===agent.desk&&agent.floor===agent.desk.floor)return 'Kembali ke meja';
      return `Menuju ${floorName(destination.floor)}`;
    }
    const text={
      chat:others?`mengobrol dengan ${others}`:'rekan sedang pergi',
      drink:others?`minum bersama ${others}`:'mengambil minum di pantry',
      look:others?`berdiskusi di papan tugas dengan ${others}`:'membaca papan tugas',
      lounge:others?`mengobrol di lounge dengan ${others}`:'bersantai di lounge',
      meet:others?`rapat singkat dengan ${others}`:'menunggu rekan di ruang rapat',
      call:'menelepon di bilik telepon',
      stretch:'meregangkan badan sejenak',
      pray:'salat di ruang salat',
      break:agent.spot?.label?.replace(/^Menuju /,'')||'beristirahat'
    }[agent.state];
    if(text)return `Simulasi: ${text}`;
    // A custom room names the activity instead of the generic floor text.
    if(agent.spot?.roomName){
      const verb={work:'bekerja tenang di',meet:'rapat di',lounge:'bersantai di',drink:'mengambil minum di'}[agent.state];
      if(verb)return `Simulasi: ${verb} ${agent.spot.roomName}`;
    }
    if(agent.floor===2)return 'Simulasi: makan bersama';
    if(agent.floor===ROOF)return `Simulasi: ${ROOF_STATUS[agent.spot?.fun]||'di rooftop'}`;
    if(others)return `Simulasi: mengobrol dengan ${others}`;
    return window.officeTasks.activeFor(agent.n)?.title || 'Simulasi: bekerja di meja';
  }
  function selectAgent(agent) {
    if(selected)selected.label.classList.remove('selected');selected=agent;
    $('info').hidden=!agent;ring.visible=!!agent;if(!agent)return;
    if(activeFloor!==0&&activeFloor!==agent.floor)setFloor(agent.floor,false);
    agent.label.classList.add('selected');
    const info=$('info');info.replaceChildren();
    const close=document.createElement('button');close.id='iClose';close.textContent='×';close.setAttribute('aria-label','Tutup detail');close.onclick=()=>selectAgent(null);
    const heading=document.createElement('h2');heading.textContent=agent.initials;
    const role=document.createElement('p');role.className='role';role.textContent=agent.role;
    // Members connected to an AI agent on the server say so; everyone else stays a labelled simulation.
    const ai=window.officeTasks.agentFor(agent.n);
    if(ai){const badge=document.createElement('span');badge.className='ai-badge';badge.textContent=ai.mode==='claude'?`AI agent · ${ai.model.replace(/^claude-/,'').replace(/-\d{8}$/,'').replace(/-(\d+)-(\d+)$/,' $1.$2').replace(/^\w/,c=>c.toUpperCase())}`:'AI agent · dry run';role.append(badge);}
    const list=document.createElement('dl');
    const division=window.officeTasks.divisionOf?.(agent.n)||'—';
    for(const [title,value,id] of [['Divisi',division,''],['Kelompok meja',agent.desk.areaLabel||metaOf(agent.group).name,''],['Lokasi',floorName(agent.floor),'iLocation'],['Aktivitas',agentStatus(agent),'iActivity']]){
      const dt=document.createElement('dt');dt.textContent=title;const dd=document.createElement('dd');dd.textContent=value;if(id)dd.id=id;list.append(dt,dd);
    }
    const pray=document.createElement('label');pray.className='check';const box=document.createElement('input');box.type='checkbox';box.id='iPray';box.checked=prayers.has(agent.n);
    box.onchange=()=>{if(box.checked)prayers.add(agent.n);else prayers.delete(agent.n);savePrayers();};pray.append(box,'Ikut waktu salat');
    const view=document.createElement('div');view.className='view-buttons';
    for(const [id,text,mode] of [['iEyes','Tampilan mata','eyes'],['iChase','Ikuti dari belakang','chase']]){const b=document.createElement('button');b.id=id;b.className='btn';b.textContent=text;b.onclick=()=>startFollow(agent,mode);view.append(b);}
    const tasks=document.createElement('button');tasks.id='iTasks';tasks.className='btn primary';tasks.textContent='Lihat / tetapkan tugas';tasks.onclick=()=>window.officeTasks.open(agent.n);
    const taskSection=document.createElement('section');taskSection.className='active-task';
    const taskHeading=document.createElement('h3');taskHeading.textContent='Tugas aktif';
    const taskTitle=document.createElement('p');taskTitle.id='iActiveTask';
    const taskBrief=document.createElement('p');taskBrief.id='iTaskBrief';
    taskSection.append(taskHeading,taskTitle,taskBrief,tasks);
    info.append(close,heading,role,taskSection,memberCommands(agent),list,pray,view);
    syncTaskDisplay(agent);
  }
  // Team members are rendered in the rail popover.
  const teamList=$('teamList'),teamSearch=$('teamSearch');
  function renderTeamList(){const query=(teamSearch.value||'').trim().toLowerCase();teamList.replaceChildren(...agents.map(agent=>{const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.dataset.member=agent.n;button.className='team-member';button.textContent=`${agent.initials} · ${agent.n} · ${agent.role}`;button.hidden=!!query&&!`${agent.n} ${agent.role}`.toLowerCase().includes(query);button.onclick=()=>{selectAgent(agent);if(activeFloor!==0){agent.g.getWorldPosition(cam.target);cam.radius=Math.max(32,28/camera.aspect);} $('teamPopover').hidden=true;};item.append(button);return item;}));}
  renderTeamList();teamSearch.oninput=renderTeamList;

  const cam={target:new THREE.Vector3(1,0,0),radius:62,theta:-.22,phi:.78,spin:0};
  function cameraFor(level){
    return {target:new THREE.Vector3(level===0?-1:innerWidth>1000?-5:-3,level===0?7:floorY(level),0),theta:-.32,phi:level===0?1.08:.78,
      radius:level===0?Math.max(76,66/camera.aspect):Math.max(70,72/camera.aspect)};
  }
  function resetCamera(){
    const view=cameraFor(activeFloor);cam.target.copy(view.target);cam.theta=view.theta;cam.phi=view.phi;cam.radius=view.radius;cam.spin=0;
  }
  // Moving between one floor and the whole building glides the camera, while the other floors slide in to assemble
  // the building (zooming out) or slide away (zooming in). Glass, stairs and the city settle at the end.
  let transition=null,viewReady=false;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function startTransition(from,to){
    transition={to,focus:to===0?from:to,t:0,duration:1.4,from:{target:cam.target.clone(),theta:cam.theta,phi:cam.phi,radius:cam.radius},dest:cameraFor(to)};
    cam.spin=0;showLevels(ORDER,false);stepTransition(0);
  }
  function stepTransition(dt){
    const tr=transition;tr.t=Math.min(1,tr.t+dt/tr.duration);
    const t=tr.t,e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    cam.target.lerpVectors(tr.from.target,tr.dest.target,e);
    cam.radius=tr.from.radius*Math.pow(tr.dest.radius/tr.from.radius,e);
    cam.phi=tr.from.phi+(tr.dest.phi-tr.from.phi)*e;cam.theta=tr.from.theta+wrap(tr.dest.theta-tr.from.theta)*e;
    const spread=tr.to===0?1-e:e;
    const offset=level=>Math.sign(level-tr.focus)*spread*28;
    for(const [key,group] of Object.entries(floors)){const level=Number(key);group.position.y=floorY(level)+offset(level);}
    // Glass and stairs travel with their floor and fade in once the building has nearly assembled (or fade out first
    // when zooming into a floor); the city fades in the first half of zooming out and away at the end of zooming in.
    const smooth=(a,b,x)=>{const k=Math.max(0,Math.min(1,(x-a)/(b-a)));return k*k*(3-2*k);};
    const building=tr.to===0?smooth(.45,1,t):1-smooth(0,.4,t),city=tr.to===0?smooth(0,.5,t):1-smooth(.5,1,t);
    for(const [key,lg] of Object.entries(facadeLevels))lg.position.y=offset(Number(key));
    for(const [key,bridge] of Object.entries(stairways)){bridge.position.y=floorY(Number(key))+offset(Number(key));setFade(bridge,building);}
    setFade(facade,building);doorPads.forEach(pad=>setFade(pad,building));setFade(skyline,city);
    if(t<1)return;
    transition=null;
    for(const lg of Object.values(facadeLevels))lg.position.y=0;
    for(const [key,bridge] of Object.entries(stairways))bridge.position.y=floorY(Number(key));
    for(const root of [facade,skyline,...Object.values(stairways),...doorPads])setFade(root,1);
    if(tr.to===0){showLevels(ORDER,true);facade.visible=skyline.visible=true;}
    else{showLevels([tr.to],false);skyline.visible=facade.visible=false;}
  }
  let stairsShown=false,follow=null;
  // Which floors and outside stairs are drawn. The character camera may need two floors plus the stairs between them.
  function showLevels(levels,stairs){
    for(const [key,group] of Object.entries(floors)){group.visible=levels.includes(Number(key));group.position.y=floorY(Number(key));}
    stairsShown=stairs;for(const outside of [...Object.values(stairways),...doorPads])outside.visible=stairs;
  }
  function setFloor(level,clearSelection=true,keepCamera=false) {
    if(follow&&!keepCamera)stopFollow(false);
    if(transition)stepTransition(Infinity);
    const from=activeFloor;activeFloor=level;buildingMood(level===0);if(clearSelection)selectAgent(null);
    showLevels(level?[level]:ORDER,level===0);skyline.visible=facade.visible=level===0;setShadowCaching(level===0);
    document.querySelectorAll('[data-floor]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.floor)===level?'true':'false'));
    if(keepCamera)return;
    status(level?'Pilih anggota tim untuk melihat perannya.':'Klik lantai untuk masuk.');
    if(viewReady&&!reduceMotion&&(from===0)!==(level===0))startTransition(from,level);else resetCamera();
  }
  // Character camera: 'eyes' looks out from the head like a first-person game, 'chase' follows from behind.
  function startFollow(agent,mode){
    if(follow?.agent&&follow.agent!==agent)follow.agent.rig.head.visible=true;
    buildingMood(false);
    follow={agent,mode,yaw:0,pitch:mode==='eyes'?-.12:-.32,distance:3.4,snap:true};
    agent.rig.head.visible=mode!=='eyes';cam.spin=0;skyline.visible=facade.visible=false;camera.fov=mode==='eyes'?68:55;camera.updateProjectionMatrix();
    document.body.classList.add('following');$('followBar').hidden=false;$('followName').textContent=`Kamera ${agent.initials}`;
    $('fEyes').setAttribute('aria-pressed',String(mode==='eyes'));$('fChase').setAttribute('aria-pressed',String(mode==='chase'));
    status(mode==='eyes'?`Seeing through ${agent.initials}'s eyes. Drag to look around, Esc to exit.`:`Following ${agent.initials} from behind. Drag to orbit, scroll for distance, Esc to exit.`);
    // Put the camera at the head right away; waiting for the next frame leaves
    // it parked at the previous view for a beat.
    scene.updateMatrixWorld(true);followCamera(0);
  }
  function stopFollow(reset=true){
    if(!follow)return;follow.agent.rig.head.visible=true;follow=null;document.body.classList.remove('following');$('followBar').hidden=true;camera.fov=38;camera.updateProjectionMatrix();
    if(reset){setFloor(activeFloor,false);}
  }
  const followEye=new THREE.Vector3(),followLook=new THREE.Vector3(),followWanted=new THREE.Vector3();
  function followCamera(realDt){
    const a=follow.agent,trip=a.stairTrip;
    const levels=a.state==='stairs'&&trip?[trip.from,trip.to]:[a.floor];
    if(a.state!=='stairs'&&activeFloor!==a.floor)setFloor(a.floor,false,true);
    showLevels(levels,a.state==='stairs');
    // Skinned rigs: the eyes are the real head bone (rig.head is only a pose control there).
    (a.rig.bones?.get('head')||a.rig.head).getWorldPosition(followEye);if(a.rig.bones)followEye.y+=.09;
    const heading=a.g.rotation.y+follow.yaw,pitch=follow.pitch,dir=new THREE.Vector3(Math.sin(heading)*Math.cos(pitch),Math.sin(pitch),Math.cos(heading)*Math.cos(pitch));
    if(follow.mode==='eyes'){
      followWanted.copy(followEye).addScaledVector(dir,.12);followLook.copy(followWanted).add(dir);
    }else{
      followLook.copy(followEye);followLook.y-=.2;
      followWanted.copy(followLook).addScaledVector(dir,-follow.distance);followWanted.y=Math.max(followWanted.y,followLook.y-.6);
    }
    if(follow.snap){camera.position.copy(followWanted);follow.snap=false;}
    else camera.position.lerp(followWanted,1-Math.exp(-realDt*(follow.mode==='eyes'?20:6)));
    camera.lookAt(followLook);camera.updateMatrixWorld();
  }
  document.querySelectorAll('[data-floor]').forEach(b=>b.onclick=()=>setFloor(Number(b.dataset.floor)));
  $('bPause').onclick=()=>{paused=!paused;$('bPause').textContent=paused?'Lanjut':'Jeda';$('bPause').setAttribute('aria-pressed',String(paused));};
  const syncRoutine=()=>{$('bRoutine').textContent=routineOn?'Rutinitas: aktif':'Rutinitas: nonaktif';$('bRoutine').setAttribute('aria-pressed',String(routineOn));};
  $('bRoutine').onclick=()=>{routineOn=!routineOn;syncRoutine();status(routineOn?'Simulasi: tim bergerak sendiri di kantor.':'Rutinitas nonaktif. Tim menyelesaikan kegiatan lalu kembali ke meja.');};syncRoutine();
  $('bPray').onclick=()=>{$('moments').open=false;prayerTime();};
  const syncLog=open=>{$('log').classList.toggle('collapsed',!open);$('logList').hidden=!open;$('logEmpty').hidden=!open;$('logToggle').textContent=open?'Sembunyikan':'Tampilkan';$('logToggle').setAttribute('aria-expanded',String(open));};
  $('logToggle').onclick=()=>syncLog($('log').classList.contains('collapsed'));syncLog(window.officeSettings?.preferences.read().logVisible===true);
  $('bLunch').onclick=()=>{$('moments').open=false;moveTeam(2);};$('bRoof').onclick=()=>{$('moments').open=false;moveTeam(ROOF);};$('bWork').onclick=()=>{$('moments').open=false;moveTeam(3);};
  $('bReset').onclick=()=>{if(follow)stopFollow();else resetCamera();};
  $('fEyes').onclick=()=>follow&&startFollow(follow.agent,'eyes');$('fChase').onclick=()=>follow&&startFollow(follow.agent,'chase');$('fExit').onclick=()=>stopFollow();
  $('bZoomIn').onclick=()=>cam.radius*=.85;$('bZoomOut').onclick=()=>cam.radius/=.85;
  $('bRotate').onclick=()=>{cam.spin=3;};
  // Navigation owns task and settings launchers; legacy controls remain available to the drawer.
  // --- Customize office: move furniture, keep seats working ---
  let customizing=false, customSel=null, customDraft=null, customGrab=null, customSlotIdx=0, customPrevRoutine=true;
  const CUSTOM_KEY='kantor-ai.layouts.v1';
  const customStore={names:['Slot 1','Slot 2','Slot 3','Slot 4','Slot 5'],layouts:[null,null,null,null,null],current:0};
  try{
    const saved=JSON.parse(localStorage.getItem(CUSTOM_KEY)||'null');
    if(saved&&Array.isArray(saved.names)&&Array.isArray(saved.layouts)){
      for(let i=0;i<5;i++){
        if(typeof saved.names[i]==='string'&&saved.names[i].trim())customStore.names[i]=saved.names[i].slice(0,40);
        if(saved.layouts[i]&&typeof saved.layouts[i]==='object')customStore.layouts[i]=saved.layouts[i];
      }
      if(Number.isInteger(saved.current)&&saved.current>=0&&saved.current<=5)customStore.current=saved.current;
    }
  }catch{}
  customSlotIdx=customStore.current;
  function saveCustom(){customStore.current=customSlotIdx;try{localStorage.setItem(CUSTOM_KEY,JSON.stringify(customStore));}catch{status('Nama tata letak tidak bisa disimpan di browser ini.');}}
  const customRing=new THREE.Mesh(new THREE.RingGeometry(.85,1,48),new THREE.MeshBasicMaterial({color:linear(ACCENT),side:THREE.DoubleSide,transparent:true,opacity:.85}));
  customRing.rotation.x=-Math.PI/2;customRing.visible=false;scene.add(customRing);
  const customMsg=(t,err=false)=>{const m=$('cMsg');if(!m)return;m.textContent=t||'';m.classList.toggle('error',!!err);};
  function syncCustomRing(){
    if(!customSel){customRing.visible=false;return;}
    const r=Math.max(.4,customSel.radius);
    customRing.visible=true;customRing.scale.set(r,r,1);
    customRing.position.set(customDraft?.x??customSel.x,(floors[customSel.floor]?.position.y||0)+.06,customDraft?.z??customSel.z);
  }
  function rebuildNavFloor(floor){
    const rootF=floors[floor];if(!rootF)return;
    navGrids[floor]=rasterize(rootF,a=>a.userData.walkable||a.userData.agent||a.visible===false);
  }
  function reseatCustom(item){
    const rad=item.rot*Math.PI/180;
    for(const spot of item.seatRefs){
      const ref=spot._ref,oldX=spot.x,oldZ=spot.z;
      if(ref&&ref[1]===-1){spot.x=item.x+spot._dx;spot.z=item.z+spot._dz;}
      else{spot.x=item.x;spot.z=item.z;if('f' in spot)spot.angle=rad;}
      if(Array.isArray(spot.route))for(const pt of spot.route){
        if(Math.abs(pt[0]-oldX)<.011)pt[0]=spot.x;
        if(Math.abs(pt[1]-oldZ)<.011)pt[1]=spot.z;
      }
    }
    for(const a of item.activityRefs){
      if(!a.activity||a.activity.spot._item!==item)continue;
      const spot=a.activity.spot;
      if(a.state==='stairs'||a.floor!==item.floor){a.destination=spot;continue;}
      if(a.spot===spot){a.g.position.x=spot.x;a.g.position.z=spot.z;a.heading=facing(spot);a.path=[];continue;}
      a.destination=spot;
      a.path=navPath(a.floor,[a.g.position.x,a.g.position.z],[spot.x,spot.z],a,spot,a.spot)||[...spot.route,[spot.x,spot.z]];
      a.state='walk';a.spot=null;
    }
  }
  function placeCustom(item){item.group.position.set(item.x,item.y||0,item.z);item.group.rotation.y=item.rot*Math.PI/180;rebuildNavFloor(item.floor);reseatCustom(item);}
  const clampCustom=(item,x,z)=>{const r=item.radius+.1;return [Math.max(-16+r,Math.min(16-r,x)),Math.max(-12+r,Math.min(12-r,z))];};
  const INVENTORY_KEY='kantor-ai.inventory.v1';
  const INVENTORY_CATALOG={chair:{label:'Chair',stock:6,floor:3},table:{label:'Table',stock:2,floor:3},sofa:{label:'Sofa',stock:2,floor:3},plant:{label:'Plant',stock:4,floor:3},lamp:{label:'Lamp',stock:4,floor:4},shelf:{label:'Bookshelf',stock:2,floor:3},coffee:{label:'Coffee table',stock:2,floor:3},whiteboard:{label:'Whiteboard',stock:2,floor:3}};
  const inventoryStore={stock:Object.fromEntries(Object.entries(INVENTORY_CATALOG).map(([type,data])=>[type,data.stock])),placed:{},items:[]};
  try{const saved=JSON.parse(localStorage.getItem(INVENTORY_KEY)||'null');if(saved?.stock&&typeof saved.stock==='object')for(const type of Object.keys(INVENTORY_CATALOG))if(Number.isFinite(saved.stock[type]))inventoryStore.stock[type]=Math.max(0,Math.floor(saved.stock[type]));if(saved?.placed&&typeof saved.placed==='object')inventoryStore.placed={...saved.placed};if(Array.isArray(saved?.items))inventoryStore.items=saved.items.filter(item=>INVENTORY_CATALOG[item.type]&&typeof item.id==='string'&&Number.isFinite(item.floor)&&Number.isFinite(item.x)&&Number.isFinite(item.z)&&Number.isFinite(item.rot));}catch{}
  const saveInventory=()=>{try{localStorage.setItem(INVENTORY_KEY,JSON.stringify(inventoryStore));}catch{status('Inventaris tidak bisa disimpan di browser ini.');}};
  const inventoryData=()=>({stock:{...inventoryStore.stock},placed:{...inventoryStore.placed}});
  function addSeat(item,spot){return linkSpot(item,spot,true);}
  function runtimeFurniture(type,floor,x,z,savedId=null){
    const atRoot=root;root=floors[floor];let item;
    if(type==='chair')item=chair(x,z,1,0x8a8479);
    else if(type==='sofa')item=sofa(x,z,2.6);
    else if(type==='plant')item=plant(x,z,.75);
    else if(type==='lamp')item=floor===ROOF?lantern(x,z):floorLamp(x,z);
    else if(type==='table')item=table(x,z,2.4,1.2);
    else if(type==='shelf'){
      const g=new THREE.Group();g.position.set(x,0,z);root.add(g);box(2.4,1.8,.5,BALSA,0,0,0,g);for(const y of [.6,1.2])box(2.3,.04,.46,0xb89c70,0,y,0,g);item=registerCustom(type,floor,g,x,z,0,{radius:1.25,isExtra:true,catalog:type});
    }else if(type==='coffee'){
      const g=new THREE.Group();g.position.set(x,0,z);root.add(g);box(1.8,.12,1.1,BALSA,0,.45,0,g);for(const sx of [-1,1])for(const sz of [-1,1])box(.08,.45,.08,DARK,sx*.7,0,sz*.38,g);item=registerCustom(type,floor,g,x,z,0,{radius:.95,isExtra:true,catalog:type});
    }else if(type==='whiteboard'){
      const g=new THREE.Group();g.position.set(x,0,z);root.add(g);box(2.4,1.3,.08,CARD,0,.6,0,g);for(const sx of [-1,1])box(.08,.7,.08,DARK,sx*1,0,0,g);item=registerCustom(type,floor,g,x,z,0,{radius:1.25,isExtra:true,catalog:type});
    }
    root=atRoot;
    if(!item)return null;
    if(savedId){const old=item.id;customById.delete(old);item.id=savedId;customById.set(savedId,item);const match=/^c(\d+)$/.exec(savedId);if(match)customSeq=Math.max(customSeq,Number(match[1]));item.group.traverse(o=>{o.userData.customId=savedId;});}
    item.isExtra=true;item.catalog=type;item.isPreview=savedId===null;item.home={x,z,rot:item.rot};
    if(type==='chair'){const spot=addSeat(item,seat(x,z,1,floor,x<0?-10:10,{state:'lounge',label:'Menuju lounge'}));hangouts.push(spot);}
    if(type==='sofa'){for(const dx of [-.55,.55]){const spot=linkSpot(item,{x:x+dx,z,f:-1,angle:Math.PI,floor,route:[[x<0?-10:10,passage(floor)],[x<0?-10:10,z]],state:'lounge',label:'Menuju lounge',occupant:null},false);hangouts.push(spot);}}
    placeCustom(item);return item;
  }
  const freeSpawn=(type,floor)=>{const probe={floor,radius:type==='chair'?.5:type==='sofa'?1.4:type==='table'?1.3:type==='shelf'||type==='whiteboard'?1.3:type==='coffee'?1:type==='plant'?.65:.5};for(let z=-10;z<=10;z+=2)for(let x=-14;x<=14;x+=2)if(!customItems.some(o=>o.floor===floor&&Math.hypot(o.x-x,o.z-z)<o.radius+probe.radius+.15))return [x,z];return null;};
  const removeCustomItem=item=>{item.seatRefs.forEach(spot=>{for(const a of agents){if(a.activity?.spot===spot){clearActivity(a);setPath(a,a.desk);}if(a.destination===spot){a.destination=a.desk;a.path=[];}}const index=hangouts.indexOf(spot);if(index>=0)hangouts.splice(index,1);});item.group.parent?.remove(item.group);const index=customItems.indexOf(item);if(index>=0)customItems.splice(index,1);customById.delete(item.id);if(customSel===item){customSel=null;customDraft=null;customRing.visible=false;}rebuildNavFloor(item.floor);syncCustomPanel();};
  const renderInventory=()=>{const list=$('inventoryList');if(!list)return;list.replaceChildren(...Object.entries(INVENTORY_CATALOG).map(([type,data])=>{const row=document.createElement('div');row.className='inventory-row';const name=document.createElement('span');name.textContent=data.label;const count=document.createElement('strong');count.textContent=inventoryStore.stock[type];const minus=document.createElement('button');minus.className='btn';minus.type='button';minus.textContent='−';minus.disabled=inventoryStore.stock[type]===0;minus.onclick=()=>adjustStock(type,-1);const plus=document.createElement('button');plus.className='btn';plus.type='button';plus.textContent='+';plus.onclick=()=>adjustStock(type,1);const add=document.createElement('button');add.className='btn';add.type='button';add.textContent='Add';add.disabled=inventoryStore.stock[type]===0;add.onclick=()=>addInventory(type);row.append(name,count,minus,plus,add);return row;}));};
  function adjustStock(type,delta){if(!INVENTORY_CATALOG[type]||!Number.isFinite(delta))return inventoryStore.stock[type]??0;inventoryStore.stock[type]=Math.max(0,inventoryStore.stock[type]+Math.trunc(delta));saveInventory();renderInventory();return inventoryStore.stock[type];}
  function addInventory(type){if(!INVENTORY_CATALOG[type]||inventoryStore.stock[type]<1)return false;const floor=INVENTORY_CATALOG[type].floor,spawn=freeSpawn(type,floor);if(!spawn){customMsg('No free location on this floor.',true);return false;}if(activeFloor!==floor)setFloor(floor,false);const item=runtimeFurniture(type,floor,...spawn);if(!item)return false;selectCustom(item);renderInventory();customMsg(`Preview ${INVENTORY_CATALOG[type].label}; Apply to add it.`);return {id:item.id,preview:true};}
  function restoreInventoryItems(){for(const saved of inventoryStore.items){const item=runtimeFurniture(saved.type,saved.floor,saved.x,saved.z,saved.id);if(item){item.rot=saved.rot;item.home.rot=saved.rot;placeCustom(item);}}}
  function applyInventory(){if(!customSel?.isPreview)return applyCustom();const item=customSel;if(!applyCustom())return false;item.isPreview=false;inventoryStore.stock[item.catalog]--;inventoryStore.placed[item.catalog]=(inventoryStore.placed[item.catalog]||0)+1;inventoryStore.items.push({id:item.id,type:item.catalog,floor:item.floor,x:item.home.x,z:item.home.z,rot:item.home.rot});if(customSlotIdx>0){const d=customStore.layouts[customSlotIdx-1]||(customStore.layouts[customSlotIdx-1]={});d[item.id]={x:item.x,z:item.z,rot:item.rot};saveCustom();}saveInventory();renderInventory();customMsg('Added to inventory layout.');syncCustomPanel();return true;}
  function cancelInventory(){if(customSel?.isPreview){const item=customSel;removeCustomItem(item);renderInventory();customMsg('Preview discarded.');return true;}return cancelCustom();}
  function returnInventory(id){const item=customById.get(id);if(!item?.isExtra||item.isPreview)return false;if(!confirm('Return this furniture to inventory? This removes it from all layout slots.'))return false;const type=item.catalog;for(const layout of customStore.layouts)if(layout)delete layout[id];inventoryStore.items=inventoryStore.items.filter(saved=>saved.id!==id);removeCustomItem(item);inventoryStore.stock[type]=(inventoryStore.stock[type]||0)+1;inventoryStore.placed[type]=Math.max(0,(inventoryStore.placed[type]||1)-1);saveInventory();saveCustom();renderInventory();customMsg('Furniture returned to inventory.');return true;}

  function overlapCustom(item,x,z){
    for(const o of customItems){
      if(o===item||o.floor!==item.floor)continue;
      const clearance=item.sub==='task'||o.sub==='task'?Math.max(.5,Math.min(o.radius,item.radius))+.15:o.radius+item.radius+.15;
      if(Math.hypot(o.x-x,o.z-z)<clearance)return o;
    }
    return null;
  }
  function previewCustom(){
    if(!customSel||!customDraft)return;
    customSel.group.position.set(customDraft.x,customSel.y||0,customDraft.z);
    customSel.group.rotation.y=(customSel.rotatable?customDraft.rot:customSel.rot)*Math.PI/180;syncCustomRing();
  }
  function syncCustomPanel(){
    if(!customSel||!customDraft){
      $('cSelected').textContent='Belum ada pilihan. Klik meja, kursi, sofa, meja rapat, tanaman, lampu, lentera, atau meja biliar.';
      $('cReturn').disabled=true;
      $('cX').value='';$('cZ').value='';$('cRot').value=0;$('cRotNum').value=0;$('cRotWrap').hidden=false;return;
    }
    $('cSelected').textContent=`Terpilih: ${customSel.type} di lantai ${customSel.floor} — seret atau ketik nilai baru, lalu Terapkan.`;
    $('cReturn').disabled=!customSel.isExtra||customSel.isPreview;
    $('cX').value=(Math.round(customDraft.x*10)/10).toFixed(1);
    $('cZ').value=(Math.round(customDraft.z*10)/10).toFixed(1);
    $('cRot').value=Math.round(customDraft.rot);$('cRotNum').value=Math.round(customDraft.rot);
    $('cRotWrap').hidden=!customSel.rotatable;
  }
  function syncCustomSlotUI(){
    const sel=$('cSlot');
    if(!sel.options.length){
      const def=document.createElement('option');def.value='0';def.textContent='Default';sel.append(def);
      for(let i=1;i<=5;i++)sel.append(document.createElement('option'));
    }
    for(let i=1;i<=5;i++)sel.options[i].value=String(i),sel.options[i].textContent=customStore.names[i-1]||`Slot ${i}`;
    sel.value=String(customSlotIdx);
    $('cSlotName').value=customSlotIdx===0?'':(customStore.names[customSlotIdx-1]||'');
    $('cSlotName').disabled=customSlotIdx===0;
    $('cSlotName').placeholder=customSlotIdx===0?'Default layout (read-only)':'Slot name';
    $('cRename').disabled=customSlotIdx===0;
  }
  function selectCustom(item){
    if(item?.generated)item=null;
    customSel=item;customDraft=item?{x:item.x,z:item.z,rot:item.rot}:null;customGrab=null;
    syncCustomRing();syncCustomPanel();
    if(item)customMsg('');
  }
  function applyCustom(){
    if(!customSel||!customDraft){customMsg('Pick a piece of furniture first.',true);return false;}
    const [cx,cz]=clampCustom(customSel,customDraft.x,customDraft.z);
    const rot=customSel.rotatable?((Math.round(customDraft.rot)%360)+360)%360:customSel.rot;
    const bad=overlapCustom(customSel,cx,cz);
    if(bad){customDraft={x:customSel.x,z:customSel.z,rot:customSel.rot};previewCustom();syncCustomPanel();customMsg(`Blocked: overlaps with ${bad.type}.`,true);return false;}
    customSel.x=cx;customSel.z=cz;customSel.rot=rot;customDraft={x:cx,z:cz,rot};
    placeCustom(customSel);
    if(customSel.isPreview){syncCustomPanel();return true;}
    if(customSel.isExtra){const saved=inventoryStore.items.find(entry=>entry.id===customSel.id);if(saved){saved.x=cx;saved.z=cz;saved.rot=rot;saveInventory();}}
    if(customSlotIdx>0){
      const d=customStore.layouts[customSlotIdx-1]||(customStore.layouts[customSlotIdx-1]={});
      d[customSel.id]={x:cx,z:cz,rot};saveCustom();customMsg('Applied and saved.');
    }else customMsg('Applied (Default is read-only — pick Slot 1–5 to keep it).');
    syncCustomPanel();return true;
  }
  function cancelCustom(){
    if(!customSel||!customDraft)return;
    customDraft={x:customSel.x,z:customSel.z,rot:customSel.rot};previewCustom();syncCustomPanel();customMsg('Changes discarded.');
  }
  function loadCustomSlot(i,silent=false){
    if(customSel){customSel.group.position.set(customSel.x,customSel.y||0,customSel.z);customSel.group.rotation.y=customSel.rot*Math.PI/180;}
    customSel=null;customDraft=null;customGrab=null;customRing.visible=false;customSlotIdx=i;
    const data=i===0?null:customStore.layouts[i-1],touched=new Set();
    for(const item of customItems){
      const t=data?.[item.id];
      if(t&&Number.isFinite(t.x)&&Number.isFinite(t.z)&&Number.isFinite(t.rot)){
        const [cx,cz]=clampCustom(item,t.x,t.z);
        // Keep saved coordinates when a generated team desk covers them; hideCovered() hides the item without losing its placement.
        const overlap=overlapCustom(item,cx,cz);
        const coveredByDesk=customItems.some(other=>other.generated&&other.floor===item.floor&&Math.hypot(other.x-cx,other.z-cz)<other.radius+item.radius*.6);
        if(!overlap||coveredByDesk){item.x=cx;item.z=cz;item.rot=((Math.round(t.rot)%360)+360)%360;}
        else{item.x=item.home.x;item.z=item.home.z;item.rot=item.home.rot;}
      }else if(item.isExtra){
        const saved=inventoryStore.items.find(entry=>entry.id===item.id);
        if(saved){item.x=saved.x;item.z=saved.z;item.rot=saved.rot;}
      }else{item.x=item.home.x;item.z=item.home.z;item.rot=item.home.rot;}
      item.group.position.set(item.x,item.y||0,item.z);item.group.rotation.y=item.rot*Math.PI/180;
      reseatCustom(item);touched.add(item.floor);
    }
    hideCovered();
    for(const f of touched)rebuildNavFloor(f);
    saveCustom();syncCustomSlotUI();syncCustomPanel();
    if(!silent)customMsg(i===0?'Default layout loaded.':'Layout loaded.');
  }
  function resetCustomSlot(){
    customSel=null;customDraft=null;customGrab=null;customRing.visible=false;
    if(customSlotIdx>0){customStore.layouts[customSlotIdx-1]=null;saveCustom();}
    const touched=new Set();
    for(const item of customItems){
      if(item.isPreview)continue;
      item.x=item.home.x;item.z=item.home.z;item.rot=item.home.rot;
      item.group.position.set(item.x,item.y||0,item.z);item.group.rotation.y=item.rot*Math.PI/180;
      reseatCustom(item);touched.add(item.floor);
    }
    for(const f of touched)rebuildNavFloor(f);
    syncCustomPanel();customMsg('Back to Default.');
  }
  function customFloorPoint(event,floor){
    pointer.set(event.clientX/innerWidth*2-1,-event.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);
    const y=floors[floor]?.position.y||0,plane=new THREE.Plane(new THREE.Vector3(0,1,0),-y),pt=new THREE.Vector3();
    return ray.ray.intersectPlane(plane,pt)?pt:null;
  }
  function setCustomizing(on){
    if(on===customizing)return;
    if(on){
      renderInventory();
      if(follow)stopFollow(false);
      selectAgent(null);
      customPrevRoutine=routineOn;routineOn=false;syncRoutine();
      if(activeFloor===0)setFloor(3);
      customizing=true;document.body.classList.add('customizing');
      $('bCustom').setAttribute('aria-pressed','true');$('customPanel').hidden=false;
      syncCustomSlotUI();syncCustomPanel();customMsg('Pick furniture, or add a bookshelf, coffee table or whiteboard from inventory.');
      status('Mode tata ruang: seret furnitur untuk memindahkan, atau tambah dari inventaris.');
    }else{
      if(customSel&&customDraft&&(customDraft.x!==customSel.x||customDraft.z!==customSel.z||customDraft.rot!==customSel.rot)){
        const keep=customSel;
        if(!applyCustom()){keep.group.position.set(keep.x,keep.y||0,keep.z);keep.group.rotation.y=keep.rot*Math.PI/180;}
      }
      customSel=null;customDraft=null;customGrab=null;customRing.visible=false;
      customizing=false;document.body.classList.remove('customizing');
      $('bCustom').setAttribute('aria-pressed','false');$('customPanel').hidden=true;
      routineOn=customPrevRoutine;syncRoutine();saveCustom();
      status('Pilih anggota tim untuk melihat perannya.');
    }
  }
  $('bCustom').onclick=()=>setCustomizing(!customizing);
  $('cClose').onclick=()=>setCustomizing(false);
  window.officeScene = window.officeScene || {};
  window.officeScene.setEditing = on => setCustomizing(!!on);
  window.officeNav?.onOpen(()=>{if(customizing)setCustomizing(false)});
  $('cSlot').onchange=e=>loadCustomSlot(Number(e.target.value));
  $('cRename').onclick=()=>{
    if(customSlotIdx===0){customMsg('Default cannot be renamed.',true);return;}
    const name=$('cSlotName').value.trim().slice(0,40);
    if(!name){customMsg('Type a name first.',true);return;}
    customStore.names[customSlotIdx-1]=name;saveCustom();syncCustomSlotUI();customMsg(`Saved as "${name}".`);
  };
  $('cX').oninput=e=>{if(!customSel||!customDraft)return;const v=parseFloat(e.target.value);if(!Number.isFinite(v))return;customDraft.x=v;previewCustom();customMsg('');};
  $('cZ').oninput=e=>{if(!customSel||!customDraft)return;const v=parseFloat(e.target.value);if(!Number.isFinite(v))return;customDraft.z=v;previewCustom();customMsg('');};
  $('cRot').oninput=e=>{if(!customSel||!customDraft)return;const v=parseFloat(e.target.value);if(!Number.isFinite(v))return;customDraft.rot=((Math.round(v)%360)+360)%360;$('cRotNum').value=Math.round(customDraft.rot);previewCustom();customMsg('');};
  $('cRotNum').oninput=e=>{if(!customSel||!customDraft)return;const v=parseFloat(e.target.value);if(!Number.isFinite(v))return;customDraft.rot=((Math.round(v)%360)+360)%360;$('cRot').value=Math.round(customDraft.rot);previewCustom();customMsg('');};
  $('cRot90').onclick=()=>{if(!customSel||!customDraft){customMsg('Pick a piece of furniture first.',true);return;}customDraft.rot=(Math.round(customDraft.rot)+90)%360;previewCustom();syncCustomPanel();customMsg('');};
  $('cApply').onclick=()=>applyInventory();
  $('cCancel').onclick=()=>cancelInventory();
  $('cReset').onclick=()=>resetCustomSlot();
  $('cReturn').onclick=()=>customSel&&returnInventory(customSel.id);

  addEventListener('beforeunload',()=>saveCustom());
  const customAPI={
    isEditing:()=>customizing,
    list:()=>customItems.map(i=>({id:i.id,generated:!!i.generated,hidden:!!i.hidden,type:i.type,sub:i.sub||null,floor:i.floor,x:+i.x.toFixed(2),z:+i.z.toFixed(2),rot:i.rot,radius:i.radius,symmetric:i.symmetric,rotatable:i.rotatable,seatCount:i.seatRefs.length,isExtra:i.isExtra,isPreview:i.isPreview,home:{...i.home}})),
    selected:()=>customSel?.id||null,
    select:id=>{const it=customById.get(id);if(!it||it.generated)return null;if(it.floor!==activeFloor)setFloor(it.floor,false);selectCustom(it);return customSel?.id||null;},
    draft:()=>customDraft?{...customDraft}:null,
    screen:id=>{const it=customById.get(id);if(!it)return null;const v=new THREE.Vector3();it.group.getWorldPosition(v);v.y+=.6;v.project(camera);return {x:(v.x*.5+.5)*innerWidth,y:(-v.y*.5+.5)*innerHeight};},
    applyMove:(id,x,z,rot)=>{const it=customById.get(id);if(!it)return false;if(it.floor!==activeFloor)setFloor(it.floor,false);selectCustom(it);customDraft={x,z,rot:rot??it.rot};return applyCustom();},
    apply:()=>applyInventory(),cancel:()=>cancelInventory(),reset:()=>resetCustomSlot(),
    inventory:inventoryData,
    adjustStock,
    add:addInventory,
    seats:id=>customById.get(id)?.seatRefs.map(spot=>({x:spot.x,z:spot.z,state:spot.state}))||[],
    returnItem:returnInventory,
    slot:i=>{if(!Number.isInteger(i)||i<0||i>5)return customSlotIdx;loadCustomSlot(i);return customSlotIdx;},
    rename:name=>{if(customSlotIdx===0)return false;customStore.names[customSlotIdx-1]=String(name).slice(0,40)||`Slot ${customSlotIdx}`;saveCustom();syncCustomSlotUI();return true;},
    slots:()=>({current:customSlotIdx,names:customStore.names.map((n,i)=>n||`Slot ${i+1}`)}),
    setEditing:on=>setCustomizing(!!on),
  };
  loadCustomSlot(customSlotIdx,true);restoreInventoryItems();loadCustomSlot(customSlotIdx,true);renderInventory();
  const keys={};
  addEventListener('keydown',event=>{
    const modalOpen=document.querySelector('dialog:modal');
    if(event.key==='Escape'&&follow&&!modalOpen){stopFollow();return;}
    if(event.target.closest('input,textarea,select,dialog,button')||modalOpen)return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key))event.preventDefault();keys[event.key.toLowerCase()]=true;
  });
  addEventListener('keyup',event=>keys[event.key.toLowerCase()]=false);
  addEventListener('blur',()=>{for(const key in keys)keys[key]=false;});

  // Orbit by default: drag rotates, Shift or right drag pans, wheel or pinch zooms, two fingers pan and pinch.
  const canvas=$('c'),ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),pointers=new Map();
  ray.params.Line.threshold=.05;
  let drag=null,pinch=null;
  const pinchState=()=>{const [a,b]=[...pointers.values()];return {d:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2};};
  function pan(dx,dy){const k=cam.radius*.0012;cam.target.x-=dx*k*Math.cos(cam.theta)+dy*k*Math.sin(cam.theta);cam.target.z+=dx*k*Math.sin(cam.theta)-dy*k*Math.cos(cam.theta);}
  function pickAt(event){
    pointer.set(event.clientX/innerWidth*2-1,-event.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);
    if(customizing&&activeFloor!==0){
      const groups=customItems.filter(i=>i.floor===activeFloor).map(i=>i.group);
      const hit=ray.intersectObjects(groups,true)[0];
      if(!hit){selectCustom(null);return;}
      let id=null;for(let a=hit.object;a;a=a.parent){if(a.userData.customId){id=a.userData.customId;break;}}
      selectCustom(id?customById.get(id)||null:null);return;
    }
    if(activeFloor===0){
      // Glass facade panels know their storey, so clicking a floor through the glass enters that floor.
      const hit=ray.intersectObjects([facade,...Object.values(floors)],true)[0];if(!hit)return;
      let o=hit.object,inFacade=false,edgeLevel=0;for(let a=o;a;a=a.parent){if(a===facade)inFacade=true;edgeLevel||=a.userData.level||0;}
      if(inFacade){setFloor(edgeLevel||ORDER[Math.max(0,Math.min(ORDER.length-1,Math.floor(hit.point.y/FLOOR_GAP)))]);return;}
      while(o.parent&&o.parent!==scene)o=o.parent;
      const level=Number(Object.keys(floors).find(k=>floors[k]===o));if(level)setFloor(level);return;
    }
    const visible=agents.filter(a=>a.g.visible&&visibleAgent(a)).map(a=>a.g);
    const hit=ray.intersectObjects(visible,true)[0];selectAgent(hit?hit.object.userData.agent:null);
  }
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('pointerdown',event=>{
    if(transition)stepTransition(Infinity);
    canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});cam.spin=0;
    if(customizing&&pointers.size===1&&activeFloor!==0&&event.button!==2&&!event.shiftKey){
      pointer.set(event.clientX/innerWidth*2-1,-event.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);
      const groups=customItems.filter(i=>i.floor===activeFloor).map(i=>i.group);
      const hit=ray.intersectObjects(groups,true)[0];
      if(hit){
        let id=null;for(let a=hit.object;a;a=a.parent){if(a.userData.customId){id=a.userData.customId;break;}}
        const item=id?customById.get(id):null;
        if(item){
          if(item!==customSel)selectCustom(item);
          const pt=customFloorPoint(event,item.floor);
          if(pt){customGrab={dx:customDraft.x-pt.x,dz:customDraft.z-pt.z};drag={x:event.clientX,y:event.clientY,mode:'custom',moved:0,time:performance.now()};return;}
        }
      }
    }
    if(pointers.size===1)drag={x:event.clientX,y:event.clientY,mode:event.button===2||event.shiftKey?'pan':'orbit',moved:0,time:performance.now()};
    else if(pointers.size===2){pinch=pinchState();if(drag)drag.moved=99;}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>=2&&pinch&&follow){const next=pinchState();follow.distance=Math.max(1.6,Math.min(9,follow.distance*pinch.d/Math.max(next.d,1)));pinch=next;return;}
    if(pointers.size>=2&&pinch){const next=pinchState();cam.radius*=pinch.d/Math.max(next.d,1);pan(next.x-pinch.x,next.y-pinch.y);pinch=next;return;}
    if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;drag.moved+=Math.abs(dx)+Math.abs(dy);
    if(drag.mode==='custom'&&customSel&&customDraft){
      const pt=customFloorPoint(event,customSel.floor);
      if(pt){const [cx,cz]=clampCustom(customSel,pt.x+customGrab.dx,pt.z+customGrab.dz);customDraft.x=cx;customDraft.z=cz;previewCustom();syncCustomPanel();customMsg('');}
      return;
    }
    if(drag.moved<4)return;
    if(follow){follow.yaw-=dx*.005;follow.pitch=Math.max(-1.2,Math.min(.9,follow.pitch-dy*.004));return;}
    if(drag.mode==='orbit'){
      const now=performance.now();cam.theta-=dx*.006;cam.phi-=dy*.005;
      cam.spin=Math.max(-6,Math.min(6,-dx*.006/Math.max(.008,(now-drag.time)/1000)));drag.time=now;
    }else pan(dx,dy);
  });
  function release(event){
    if(!pointers.has(event.pointerId))return;
    const click=event.type==='pointerup'&&drag&&drag.moved<5&&pointers.size===1;
    pointers.delete(event.pointerId);if(pointers.size<2)pinch=null;
    if(click)pickAt(event);
    if(!drag||drag.mode!=='orbit'||performance.now()-drag.time>90)cam.spin=0;
    if(!pointers.size)drag=null;
    else{const [p]=[...pointers.values()];drag={x:p.x,y:p.y,mode:'orbit',moved:99,time:performance.now()};}
  }
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  // Name labels sit over the canvas, so they forward wheel zoom too.
  const onWheel=event=>{
    event.preventDefault();cam.spin=0;
    if(follow){follow.distance=Math.max(1.6,Math.min(9,follow.distance*Math.exp(Math.sign(event.deltaY)*.12)));return;}
    if(event.ctrlKey)cam.radius*=Math.exp(event.deltaY*.01);
    else if(Math.abs(event.deltaX)>Math.abs(event.deltaY))cam.theta-=event.deltaX*.004;
    else cam.radius*=Math.exp(Math.sign(event.deltaY)*Math.min(Math.abs(event.deltaY),60)*.0015);
  };
  canvas.addEventListener('wheel',onWheel,{passive:false});$('labels').addEventListener('wheel',onWheel,{passive:false});
  addEventListener('resize',()=>{if(transition)stepTransition(Infinity);if(innerWidth<=1000&&!$('log').hidden)syncLog(false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resizeComposer();resetCamera();});
  const TASK_LOG={active:'mulai tugas',done:'menyelesaikan tugas',blocked:'butuh keputusan sebelum lanjut',review:'mengirim draf untuk review','manager-review':'mengirim draf ke atasan',queued:'mengembalikan tugas ke antrean'};
  document.addEventListener('officetasks:server',()=>{
    for(const a of agents)a.label.classList.toggle('ai',!!window.officeTasks.agentFor(a.n));
    if(selected)selectAgent(selected);
  });
  // Speech bubbles for real task events: a short line on start and finish, and a steady one while an AI agent drafts.
  const SAY={active:'Siap!',blocked:'Ada pertanyaan!',review:'Siap direview','manager-review':'Dikirim ke atasan!',done:'Selesai!'};
  function say(agent,text,seconds=3.5){agent.sayText=text;agent.sayUntil=performance.now()+seconds*1000;}
  function sayingNow(agent){
    if(agent.sayUntil>performance.now())return agent.sayText;
    return window.officeTasks.agentFor(agent.n)&&window.officeTasks.activeFor(agent.n)?'Drafting…':'';
  }
  function syncBubble(agent){
    const text=sayingNow(agent);if(agent.sayShown===text)return;agent.sayShown=text;
    let bubble=agent.label.querySelector('.say');
    if(!text){bubble?.remove();return;}
    if(!bubble){bubble=document.createElement('span');bubble.className='say';bubble.setAttribute('aria-hidden','true');agent.label.append(bubble);}
    bubble.textContent=text;bubble.classList.toggle('drafting',text==='Drafting…');
  }
  // Task board and log summary follow the task list, whether it lives in the browser or on the server.
  function drawBoard(){
    const ctx=boardCanvas.getContext('2d'),W=boardCanvas.width,H=boardCanvas.height;
    const open=window.officeTasks.list().filter(t=>t.status!=='done').sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1));
    ctx.fillStyle='#fbf8f2';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#1e2230';ctx.font='700 44px Archivo, system-ui, sans-serif';ctx.textBaseline='middle';ctx.fillText('TASK BOARD',36,48);
    ctx.fillStyle='#6b6f7b';ctx.font='500 28px Archivo, system-ui, sans-serif';ctx.textAlign='right';ctx.fillText(`${open.length} open`,W-36,50);ctx.textAlign='left';
    ctx.fillStyle='#e8634a';ctx.fillRect(36,86,90,6);
    if(!open.length){ctx.fillStyle='#6b6f7b';ctx.font='500 34px Archivo, system-ui, sans-serif';ctx.fillText('Belum ada tugas terbuka. Tambahkan dari Tugas.',36,230);}
    open.slice(0,5).forEach((task,i)=>{
      const y=150+i*70,person=agents.find(p=>p.n===task.assignee);
      ctx.fillStyle=person?hex(metaOf(person.group).color):'#8a8479';ctx.beginPath();ctx.roundRect(36,y-22,86,44,10);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='700 24px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.fillText(person?.initials||'?',79,y+1);ctx.textAlign='left';
      ctx.fillStyle='#1e2230';ctx.font='500 30px Archivo, system-ui, sans-serif';
      let title=task.title;while(ctx.measureText(title).width>640&&title.length>4)title=title.slice(0,-2);if(title!==task.title)title=title.trimEnd()+'…';
      ctx.fillText(title,142,y+1);
      const [chip,ink,label]={active:['#fdeee9','#c24a31','Berjalan'],blocked:['#fff1d6','#9a6212','Question'],'manager-review':['#e9e4f7','#5b4a9e','Review atasan'],review:['#e8f3ec','#2f6b47','Review']}[task.status]||['#f0ece5','#6b6f7b','Antre'];
      ctx.fillStyle=chip;ctx.beginPath();ctx.roundRect(W-212,y-20,176,40,20);ctx.fill();
      ctx.fillStyle=ink;ctx.font='600 22px Archivo, system-ui, sans-serif';ctx.textAlign='center';ctx.fillText(label,W-124,y+1);ctx.textAlign='left';
    });
    if(open.length>5){ctx.fillStyle='#6b6f7b';ctx.font='500 24px Archivo, system-ui, sans-serif';ctx.fillText(`+${open.length-5} lagi di Tugas`,142,H-30);}
    boardTexture.needsUpdate=true;
  }
  function drawStats(){
    const list=window.officeTasks.list(),today=new Date().toDateString();
    const busy=new Set(list.filter(t=>t.status==='active').map(t=>t.assignee)).size;
    const done=list.filter(t=>t.status==='done'&&new Date(t.updatedAt||t.createdAt).toDateString()===today).length;
    $('logStats').replaceChildren(...[['sedang tugas',busy],['bebas',agents.length-busy],['selesai',done]].map(([label,value])=>{
      const item=document.createElement('div');const number=document.createElement('strong');number.textContent=value;
      const caption=document.createElement('span');caption.textContent=label;item.append(number,caption);return item;
    }));
    // Needs decision: agents that asked a question instead of guessing. One click opens those tasks.
    const waiting=list.filter(t=>t.status==='blocked'&&!['children','failed','interrupted','environment_unavailable'].includes(t.blockedReason)&&(!t.decisionTarget||t.decisionTarget==='owner')),button=$('decisions');button.hidden=!waiting.length;button.querySelector('.badge').textContent=waiting.length||'';
    if(waiting.length){const who=[...new Set(waiting.map(t=>agents.find(p=>p.n===t.assignee)?.initials||t.assignee))].join(', ');button.setAttribute('aria-label',`${waiting.length} tugas menunggu keputusanmu · ${who}`);}
  }
  document.addEventListener('officetasks:change',()=>{for(const a of agents)if(a.vehicleTrip&&!window.OfficeMobility.canDepart(a.n,window.officeTasks.list(),tasksKnown()))mobility.recall(a.n);drawBoard();drawStats();});
  window.officeTasks.init(TEAM,(name,state,title)=>{const a=agents.find(a=>a.n===name);if(a&&window.officeTasks.activeFor(name))setPath(a,a.desk);if(a&&SAY[state])say(a,SAY[state]);if(a&&state)log(`${name} ${TASK_LOG[state]}: ${title}`,a.group);},name=>{const a=agents.find(a=>a.n===name);if(a)selectAgent(a);});
  // ---- Time-of-day moods: morning, noon, golden evening and night. ----
  // Noon reproduces the previous light; the others move the sun, sky, fog, interior lamps, street lamps,
  // city windows and stars. Changes blend over 1.4 s so the light shifts instead of snapping.
  const MOODS={
    pagi:{skyFloor:0xb9cad8,skyBuilding:0xc4d2dc,fog:0xc4d2dc,fogDensity:.0024,sunFloor:0xffd8b5,sunBuilding:0xffd8b5,sunI:1.8,sunB:1.9,sunPos:[-44,26,18],ambSky:0xe2eef8,ambGround:0x9a8b76,ambI:1.0,ambB:.8,env:.5,lamps:1.4,point:1.8,night:0,city:0,stars:0,birds:.7,clouds:.7,street:0},
    siang:{skyFloor:0x8c9aa6,skyBuilding:0xa9b6c0,fog:0xa9b6c0,fogDensity:.003,sunFloor:0xffe7c7,sunBuilding:0xffe2bd,sunI:2.2,sunB:2.4,sunPos:[-12,55,25],ambSky:0xdfe9f5,ambGround:0x8a7a66,ambI:1.1,ambB:.9,env:.6,lamps:1.6,point:2.2,night:0,city:0,stars:0,birds:.7,clouds:.85,street:0},
    sore:{skyFloor:0xc79f86,skyBuilding:0xc08e78,fog:0xc08e78,fogDensity:.0028,sunFloor:0xffb377,sunBuilding:0xffb377,sunI:2.4,sunB:2.6,sunPos:[38,15,25],ambSky:0xffd4b2,ambGround:0x6e5648,ambI:.8,ambB:.7,env:.42,lamps:2.0,point:2.4,night:.65,city:.7,stars:0,birds:.5,clouds:.55,street:1.0},
    malam:{skyFloor:0x141c26,skyBuilding:0x0d141d,fog:0x0d141d,fogDensity:.0032,sunFloor:0x93add8,sunBuilding:0x93add8,sunI:.5,sunB:.6,sunPos:[-30,42,-35],ambSky:0x33445c,ambGround:0x14181e,ambI:.4,ambB:.3,env:.16,lamps:1.6,point:2.8,night:1,city:2.0,stars:1,birds:0,clouds:.12,street:1.8}
  };
  const moodColor=hex=>new THREE.Color(hex);
  const moodLookOf=m=>({skyFloor:moodColor(m.skyFloor),skyBuilding:moodColor(m.skyBuilding),fog:moodColor(m.fog),fogDensity:m.fogDensity,sunColorFloor:moodColor(m.sunFloor),sunColorBuilding:moodColor(m.sunBuilding),sunI:m.sunI,sunB:m.sunB,sunPos:new THREE.Vector3(...m.sunPos),ambSky:moodColor(m.ambSky),ambGround:moodColor(m.ambGround),ambI:m.ambI,ambB:m.ambB,env:m.env,lamps:m.lamps,point:m.point,night:m.night,city:m.city,stars:m.stars,birds:m.birds,clouds:m.clouds,street:m.street});
  const MOOD_COLORS=['skyFloor','skyBuilding','fog','sunColorFloor','sunColorBuilding','ambSky','ambGround'],MOOD_NUMBERS=['fogDensity','sunI','sunB','ambI','ambB','env','lamps','point','night','city','stars','birds','clouds','street'];
  const cloneMoodLook=look=>{const copy={};for(const key of MOOD_COLORS)copy[key]=look[key].clone();copy.sunPos=look.sunPos.clone();for(const key of MOOD_NUMBERS)copy[key]=look[key];return copy;};
  let buildingView=false,moodId='siang',moodBlend=1,moodFrom=null,moodTo=null,moodCurrent=moodLookOf(MOODS.siang);
  const moodFog=new THREE.FogExp2(MOODS.siang.fog,MOODS.siang.fogDensity);
  function setEnvIntensity(value){scene.traverse(o=>{if(!o.material)return;for(const m of [o.material].flat())if(m&&'envMapIntensity'in m)m.envMapIntensity=value;});}
  function syncLevelLights(look){
    eveningLights.visible=buildingView||look.night>.02;
    for(const [level,lights]of Object.entries(levelLights)){
      lights.visible=buildingView||Number(level)===activeFloor;
      if(lights.userData.point)lights.userData.point.intensity=buildingView?look.point:look.point*look.night;
    }
    lampMaterial.emissiveIntensity=buildingView?look.lamps:look.lamps*look.night;
  }
  function applyMoodLook(){
    const m=moodCurrent;
    scene.background.copy(buildingView?m.skyBuilding:m.skyFloor);
    if(buildingView){moodFog.color.copy(m.fog);moodFog.density=m.fogDensity;scene.fog=moodFog;}else scene.fog=null;
    sun.color.copy(buildingView?m.sunColorBuilding:m.sunColorFloor);sun.intensity=buildingView?m.sunB:m.sunI;sun.position.copy(m.sunPos);
    ambient.color.copy(m.ambSky);ambient.groundColor.copy(m.ambGround);ambient.intensity=buildingView?m.ambB:m.ambI;
    syncLevelLights(m);
    streetBulbMaterial.emissiveIntensity=m.street;
    for(const mat of cityFacadeMats)mat.emissiveIntensity=m.city;
    nightSky.visible=m.stars>.02;starMat.opacity=.9*m.stars;moonMat.opacity=.9*m.stars;
    for(const c of clouds){c.sprite.userData.baseOpacity=m.clouds;c.sprite.material.opacity=m.clouds;}
    for(const b of birds){b.sprite.userData.baseOpacity=m.birds;b.sprite.material.opacity=m.birds;b.sprite.visible=m.birds>.04;}
  }
  function moodStep(realDt){
    if(moodBlend>=1||!moodFrom||!moodTo)return;
    moodBlend=Math.min(1,moodBlend+realDt/1.4);
    const t=moodBlend*moodBlend*(3-2*moodBlend);
    for(const key of MOOD_COLORS)moodCurrent[key].copy(moodFrom[key]).lerp(moodTo[key],t);
    moodCurrent.sunPos.copy(moodFrom.sunPos).lerp(moodTo.sunPos,t);
    for(const key of MOOD_NUMBERS)moodCurrent[key]=moodFrom[key]+(moodTo[key]-moodFrom[key])*t;
    applyMoodLook();
  }
  function setMood(id,{instant=false}={}){
    if(!MOODS[id])return false;
    moodId=id;
    const select=$('bMood');if(select&&select.value!==id)select.value=id;
    try{localStorage.setItem('kantor-ai.mood',id);}catch{/* storage can be blocked */}
    const target=moodLookOf(MOODS[id]);
    moodEnvFactor=target.env/.6;setEnvIntensity(target.env);
    if(instant){moodCurrent=target;moodFrom=moodTo=null;moodBlend=1;applyMoodLook();return true;}
    moodFrom=cloneMoodLook(moodCurrent);moodTo=target;moodBlend=0;applyMoodLook();return true;
  }
  // Floor changes switch between the cut-away sky and the hazy city sky; the current mood supplies both.
  function buildingMood(on){document.body.classList.toggle('building-view',!!on);buildingView=!!on;applyMoodLook();}
  const moodSelect=$('bMood');if(moodSelect)moodSelect.onchange=()=>setMood(moodSelect.value);
  let savedMood='siang';try{savedMood=localStorage.getItem('kantor-ai.mood')||'siang';}catch{/* storage can be blocked */}
  setMood(MOODS[savedMood]?savedMood:'siang',{instant:true});
  const projected=new THREE.Vector3(),world=new THREE.Vector3();let last=performance.now();
  function frame(now) {
    // Allow slower renderers to keep pace, while limiting jumps after a background-tab pause.
    requestAnimationFrame(frame);const realDt=Math.min(.15,(now-last)/1000);last=now;const dt=paused?0:realDt;simTime+=dt;
    if(moodBlend<1)moodStep(realDt);
    if(document.querySelector('dialog:modal')){for(const k in keys)keys[k]=false;}
    if(transition&&!follow)stepTransition(realDt);
    if(!drag&&cam.spin){cam.theta+=cam.spin*realDt;cam.spin*=Math.pow(.03,realDt);if(Math.abs(cam.spin)<.01)cam.spin=0;}
    const move=realDt*cam.radius*.3,fx=-Math.sin(cam.theta),fz=-Math.cos(cam.theta);
    if(keys.w){cam.target.x+=fx*move;cam.target.z+=fz*move;}if(keys.s){cam.target.x-=fx*move;cam.target.z-=fz*move;}
    if(keys.d){cam.target.x-=fz*move;cam.target.z+=fx*move;}if(keys.a){cam.target.x+=fz*move;cam.target.z-=fx*move;}
    if(keys.arrowleft)cam.theta-=realDt*1.3;if(keys.arrowright)cam.theta+=realDt*1.3;
    if(keys.arrowup)cam.phi-=realDt*.9;if(keys.arrowdown)cam.phi+=realDt*.9;
    if(keys.q)cam.radius+=move;if(keys.e)cam.radius-=move;
    cam.phi=Math.max(.18,Math.min(1.45,cam.phi));cam.radius=Math.max(12,Math.min(190,cam.radius));
    cam.target.x=Math.max(-25,Math.min(25,cam.target.x));cam.target.z=Math.max(-20,Math.min(20,cam.target.z));
    if(follow){if(keys.arrowleft)follow.yaw+=realDt*1.6;if(keys.arrowright)follow.yaw-=realDt*1.6;if(keys.arrowup)follow.pitch=Math.min(.9,follow.pitch+realDt);if(keys.arrowdown)follow.pitch=Math.max(-1.2,follow.pitch-realDt);}
    else{camera.position.set(cam.target.x+cam.radius*Math.sin(cam.phi)*Math.sin(cam.theta),cam.target.y+cam.radius*Math.cos(cam.phi),cam.target.z+cam.radius*Math.sin(cam.phi)*Math.cos(cam.theta));camera.lookAt(cam.target);camera.updateMatrixWorld();}
    for(const a of agents){if(!a.vehicleTrip||!['outbound','away','inbound','park','mount','dismount'].includes(a.vehiclePhase))updateAgent(a,dt);if(dt>0&&!a.vehicleTrip)live(a);syncTaskDisplay(a);}
    updateTeamTravel(dt);
    if(dt>0&&routineOn&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&skyline.visible&&simTime>=nextAmbient&&mobility.snapshot().vehicles.filter(v=>v.id.startsWith('ambient-')).length<({low:3,medium:5,high:7,ultra:9}[window.officeGraphics.level()]||3)){nextAmbient=simTime+9;const kind=ambientSerial%3===0?'motorcycle':'car';if(environment.audit().loaded.includes(kind))mobility.requestTraffic({id:'ambient-'+(++ambientSerial),vehicle:kind,lane:ambientSerial%2?'street-east':'street-west'});}
    if(skyline.visible)animateSky(dt);
    mobility.tick(dt);environment.setLevel(window.officeGraphics.level());environment.setCityVisible(skyline.visible);environment.update(mobility.snapshot(),dt);
    stepShop(dt);
    // Keep-visible dashboards: redraw the executive monitors a few times per second while time runs.
    if(dt>0)for(const screen of animatedScreens){if(simTime-screen.last<.45)continue;screen.last=simTime;screen.draw(simTime);screen.texture.needsUpdate=true;}
    // Desk monitors share three animated canvases, so every workstation is alive without per-desk textures.
    if(dt>0)for(const screen of deskScreens){if(simTime-screen.last<.4)continue;screen.last=simTime;screen.draw(simTime);}
    for(const d of doors){const near=agents.some(a=>a.floor===d.floor&&a.state!=='stairs'&&a.g.position.distanceTo(d.center)<1.6);d.open+=((near?1:0)-d.open)*Math.min(1,dt*6);d.pivot.rotation.y=d.base+d.open*1.45;}
    if(garage){const near=mobility.snapshot().vehicles.some(v=>v.pose[0]>0&&v.pose[0]<16&&v.pose[2]>5&&v.pose[2]<18);garage.open+=((near?1:0)-garage.open)*Math.min(1,dt*4);garage.group.scale.y=Math.max(.015,1-garage.open*.985);}
    if(follow){scene.updateMatrixWorld(true);followCamera(realDt);}
    scene.updateMatrixWorld(true);
    const occupied=[];
    for(const a of [...agents].sort((a,b)=>Number(b===selected)-Number(a===selected))){
      a.g.getWorldPosition(world);projected.copy(world);projected.y+=2.65;projected.project(camera);
      const x=(projected.x*.5+.5)*innerWidth,y=(-projected.y*.5+.5)*innerHeight;
      const width=a.initials.length*7+24;
      let labelY=y;
      if(activeFloor!==0)for(let step=0;step<5&&occupied.some(p=>Math.abs(x-p.x)<(width+p.width)/2+5&&Math.abs(labelY-p.y)<34);step++)labelY-=35;
      const compact=innerWidth<1000&&cam.radius>80;
      const representative=agents.find(p=>p.group===a.group)===a;
      const clearLabel=activeFloor!==0||a===selected||!occupied.some(p=>Math.abs(x-p.x)<(width+p.width)/2+5&&Math.abs(labelY-p.y)<34);
      const show=clearLabel&&(activeFloor!==0||a.state==='stairs'||a===selected)&&(!compact||representative||a===selected)&&visibleAgent(a)&&a.g.visible&&projected.z<1&&x>width/2&&x<innerWidth-width/2&&labelY>(innerWidth<=1000?230:95)&&y<innerHeight-130;
      a.label.hidden=!show||(follow?.mode==='eyes'&&follow.agent===a);
      syncBubble(a);
      if(show){a.label.style.transform=`translate(${x}px,${labelY}px) translate(-50%,-100%)`;a.label.style.setProperty('--stem',`${y-labelY+6}px`);occupied.push({x,y:labelY,width});}
    }
    if(selected){
      selected.g.getWorldPosition(world);ring.position.set(world.x,world.y+.07,world.z);ring.visible=!follow&&selected.g.visible&&visibleAgent(selected);
      $('iLocation').textContent=selected.state==='stairs'?`Tangga kiri · ${floorName(selected.stairTrip.from)} ke ${floorName(selected.stairTrip.to)}`:`Lantai ${orderOf(selected.floor)+1} · ${floorName(selected.floor)}`;$('iActivity').textContent=agentStatus(selected);
    }
    for(const level of ORDER){
      const count=agents.filter(a=>a.floor===level&&a.state!=='stairs').length;
      const badge=document.querySelector(`[data-floor="${level}"] .floor-count`);
      if(badge&&badge.textContent!==String(count)){badge.textContent=String(count);badge.setAttribute('aria-label',`${count} team members on this floor`);}
    }
    renderFrame(realDt);
    if(showFps){fpsFrames++;const t=performance.now();if(t-fpsSince>=1000){fpsLabel.textContent=`${fpsFrames} FPS`;fpsFrames=0;fpsSince=t;}}
  }
  let fpsFrames=0,fpsSince=performance.now();
  // Capture the actual floor models once for the navigation previews.
  renderer.setSize(200,140,false);camera.aspect=200/140;camera.updateProjectionMatrix();
  const thumbs={};
  function captureThumb(level){
    renderer.setSize(200,140,false);camera.aspect=200/140;camera.updateProjectionMatrix();
    showLevels([level],false);camera.position.set(-32,floorY(level)+35,42);camera.lookAt(0,floorY(level),0);
    renderer.render(scene,camera);thumbs[level]=renderer.domElement.toDataURL('image/png');
    renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  }
  function renderFloorButtons(){
    const stack=document.querySelector('#floors .section-stack');if(!stack)return;
    stack.replaceChildren(...[...ORDER].reverse().map(level=>{
      const button=document.createElement('button');button.dataset.floor=level;button.setAttribute('aria-pressed',String(level===activeFloor));
      const thumb=document.createElement('img');thumb.className='floor-thumb';thumb.alt='';thumb.width=60;thumb.height=42;thumb.src=thumbs[level]||thumbs[3]||'';
      const number=document.createElement('span');number.className='floor-number';number.textContent=`FL.${String(orderOf(level)+1).padStart(2,'0')}`;
      const name=document.createElement('span');name.textContent=floorName(level);
      const count=document.createElement('span');count.className='floor-count';count.textContent='0';
      button.append(thumb,number,name,count);button.onclick=()=>setFloor(level);return button;
    }));
    const brand=document.querySelector('#railBrand .brand-meta');if(brand)brand.textContent=`${agents.length} orang · ${ORDER.length} lantai`;
  }
  for(const level of ORDER)captureThumb(level);
  renderFloorButtons();
  renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  applyGraphics(GFX.level());GFX.onChange(level=>applyGraphics(level));
  const modelStatus=window.officeModels3d?.status()||{loaded:0,failed:[]};
  showFps=window.officeSettings?.preferences.read().showFps===true;fpsLabel.hidden=!showFps;
  setFloor(3);viewReady=true;requestAnimationFrame(frame);
  if(modelStatus.failed.length)status('Sebagian aset 3D gagal dimuat; memakai bentuk sederhana.');
  // The server organization replaces the built-in team as soon as tasks.js has loaded it.
  window.officeTasks.ready?.then(state=>{if(state?.members?.length||state?.divisions)applyOrg(state);});
  // The office follows the organization: desk areas from the seating plan, one work floor per four areas,
  // Extra work floors (many divisions need more storeys) carry real furniture with usable seats,
  // not just wall decor: a glass meeting room, pantry corner, lounge, divider shelf and planters.
  function furnishExtraWorkFloor(level){
    const f=floors[level];if(!f)return;
    const atRoot=root;root=f;
    const tag=(m,kind)=>{if(m)m.userData.decor=kind;return m;};
    const plainChair=(x,z,facing)=>{
      cylinder(.055,.15,.46,0x595d54,x,.06,z);
      tag(mesh(softBox(.78,.17,.72),0xc9cfc4,x,.5,z,root,false),'meeting_chair');
      mesh(softBox(.78,.78,.2),0xc9cfc4,x,.88,z-facing*.32,root,false);
    };
    // Meeting room (back left), matching the wall TV and rug dress() already adds there.
    tag(box(5.9,.02,5.3,0xe6ded0,-12.9,.02,-9.25),'meeting_floor');
    tag(box(4.1,2.4,.05,'glass',-13.95,0,-6.5),'glass_wall');
    tag(box(.7,2.4,.05,'glass',-10.15,0,-6.5),'glass_wall');
    tag(box(.05,2.4,5.5,'glass',-9.8,0,-9.25),'glass_wall');
    for(const [x,z] of [[-11.9,-6.5],[-10.5,-6.5],[-9.8,-6.5],[-9.8,-11.9]])box(.1,2.45,.1,DARK,x,0,z);
    tag(mesh(softBox(2.8,.14,1.4),BALSA,-13.2,.88,-9,root,false),'meeting_table');
    for(const sx of [-1,1])for(const sz of [-1,1])box(.09,.8,.09,DARK,-13.2+sx*1.2,.06,-9+sz*.55);
    for(const [x,z,face] of [[-14.2,-10.35,1],[-13.2,-10.35,1],[-12.2,-10.35,1],[-14.2,-7.65,-1],[-13.2,-7.65,-1],[-12.2,-7.65,-1]]){
      plainChair(x,z,face);
      hangouts.push(seat(x,z,face,level,-11.2,{state:'meet',room:`extra-meet-${level}`,label:'Menuju ruang rapat',occupant:null}));
    }
    textPlane('MEETING ROOM',-12.9,-5.8,4.6);
    // Pantry corner (back right): counter, coffee machine, cups and two stools.
    tag(box(4.6,.9,.8,0xcdb28a,11.8,0,-11.2),'pantry_counter');
    box(4.7,.06,.9,CARD,11.8,.9,-11.2);
    box(.45,.55,.45,CARD,10.4,.96,-11.25);cylinder(.2,.2,.45,0xc4dadb,10.4,1.51,-11.25);
    for(const x of [12.1,12.4])cylinder(.08,.07,.16,CARD,x,.96,-11);
    for(const x of [10.6,12.6]){
      cylinder(.24,.24,.48,DARK,x,0,-10.4);
      hangouts.push(seat(x,-10.2,-1,level,10,{state:'drink',room:`extra-pantry-${level}`,label:'Menuju pantry',occupant:null}));
    }
    textPlane('PANTRY',11.8,-8.9,3.6);
    // Lounge (back middle): sofa, coffee table, two seats.
    tag(box(3.4,.5,1.1,0xb8c3a6,-3.4,.25,-10.9),'lounge_sofa');
    tag(box(3.4,.85,.3,0x9dab90,-3.4,.6,-11.38),'lounge_sofa');
    cylinder(.6,.6,.06,BALSA,-3.4,.42,-8.9);cylinder(.08,.14,.42,DARK,-3.4,0,-8.9);
    for(const x of [-4.4,-2.4])hangouts.push(seat(x,-10.7,1,level,-9.3,{state:'lounge',room:`extra-lounge-${level}`,label:'Menuju lounge',occupant:null}));
    textPlane('LOUNGE',-3.4,-7.3,3.2);
    // Divider shelf on the centre aisle and planters under the front windows.
    box(.6,1.15,5.2,BALSA,0,0,6.8);
    for(const y of [.38,.76])box(.62,.03,5.22,0xb89c70,0,y,6.8);
    for(let i=0;i<10;i++)box(.4,.26+(i%3)*.04,.1+(i%2)*.06,[0x2f4a6b,CARD,0xb4623a,0x3f7a58,0x74598c][i%5],0,.42,4.6+i*.44);
    for(const x of [-6,6]){
      tag(box(3.4,.55,.7,BALSA,x,0,11.35),'planter');
      for(let i=0;i<5;i++)box(.04,.5,.03,0xc9a577,x-1.4+i*.7,.03,11);
      for(const dx of [-1.1,0,1.1])plant(x+dx,11.35,.42,.55);
    }
    tag(textPlane(floorName(level).toUpperCase(),-13.6,10.9,4.2),'floor_sign');
    root=atRoot;
  }
  // the rooftop always on top. Floors that disappear send their people to their new desks.
  function setFloorCount(count){
    const want=[3,...Array.from({length:count-1},(_,i)=>ROOF+1+i)];
    const previousY=new Map(Object.keys(facadeLevels).map(level=>[Number(level),floorY(Number(level))]));
    // floorY depends on ORDER: update it before building extra storeys or their glazing lands at the old rooftop height.
    ORDER.splice(0,ORDER.length,1,2,...want,ROOF);
    for(const [level,oldY] of previousY){const delta=floorY(level)-oldY;if(delta){facadeLevels[level].children.forEach(o=>o.position.y+=delta);levelLights[level]?.children.forEach(o=>o.position.y+=delta);}}
    for(const level of Object.keys(floors).map(Number).filter(l=>l>ROOF&&!want.includes(l))){
      // Custom rooms on a removed storey lose their geometry, labels and seats with it.
      for(const room of customRooms.filter(item=>item.floor===level))removeRoomBuilt(room.id);
      // Seats that lived on a removed storey must not strand the routine pools.
      for(let i=hangouts.length-1;i>=0;i--)if(hangouts[i].floor===level)hangouts.splice(i,1);
      for(let i=roomDoors.length-1;i>=0;i--)if(roomDoors[i].floor===level)roomDoors.splice(i,1);
      for(let i=animatedScreens.length-1;i>=0;i--)if(animatedScreens[i].floor===level)animatedScreens.splice(i,1);
      for(let i=roomSpots.length-1;i>=0;i--)if(roomSpots[i].floor===level){const pool=roomPool(roomSpots[i].floor);const k=pool.indexOf(roomSpots[i]);if(k>=0)pool.splice(k,1);roomSpots.splice(i,1);}
      scene.remove(floors[level]);delete floors[level];delete navGrids[level];
      disposeFade(facadeLevels[level]);facadeLevels[level]?.parent?.remove(facadeLevels[level]);delete facadeLevels[level];
      levelLights[level]?.parent?.remove(levelLights[level]);delete levelLights[level];
      for(let i=customItems.length-1;i>=0;i--)if(customItems[i].floor===level){customById.delete(customItems[i].id);customItems.splice(i,1);}
      delete thumbs[level];
    }
    for(const level of want)if(!floors[level]){
      const atRoot=root;shell(level);for(const [x,z] of [[-14.6,-10.6],[14.6,-10.6],[14.6,10.6],[-12.5,10.6]])plant(x,z,.85);dress(level);if(level>ROOF)furnishExtraWorkFloor(level);root=atRoot;
      mergeGroup(buildFacadeLevel(level)).traverse(o=>{o.castShadow=false;});prepareFade(facadeLevels[level]);buildLights(level);
    }
    for(const bridge of Object.values(stairways)){disposeFade(bridge);scene.remove(bridge);}for(const key of Object.keys(stairways))delete stairways[key];
    for(const lower of ORDER.slice(0,-1))prepareFade(buildStair(lower));
    buildStairCore();stairCore.traverse(o=>{o.castShadow=false;});prepareFade(stairCore);
    for(const level of ORDER){floors[level].position.y=floorY(level);for(const pad of doorPads)if(pad.parent===floors[level])pad.position.y=-.06;}
    for(const level of want)if(!thumbs[level]&&level!==3)thumbs[level]=thumbs[3];
    // Rooms on a new storey are built now; rooms whose storey disappeared stay in the list and
    // return when that storey exists again.
    applyRooms(customRooms);
  }
  function hideCovered(){
    const desksOn=level=>customItems.filter(o=>o.generated&&o.floor===level);let hidden=0;
    for(const item of customItems){
      if(item.generated||item.unique)continue;
      const covered=desksOn(item.floor).some(o=>Math.hypot(o.x-item.x,o.z-item.z)<o.radius+item.radius*.6);
      if(covered!==!!item.hidden){item.hidden=covered;item.group.visible=!covered;
        for(const spot of item.seatRefs){spot.blocked=covered;for(const a of agents)if(a.destination===spot||a.activity?.spot===spot){clearActivity(a);setPath(a,a.desk);}}}
      if(covered)hidden++;
    }
    if(hidden)customMsg(`${hidden} furnitur disembunyikan karena tertutup meja tim.`);
    return hidden;
  }
  function applyOrg(state){
    const followLevels=follow?Object.keys(floors).filter(k=>floors[k].visible).map(Number):null;
    const active=(state?.members||[]).filter(m=>m.active!==false);
    const plan=window.OrgModel.planSeating({divisions:state?.divisions||[],members:active});
    for(const d of state?.divisions||[])divisionMeta[d.id]={name:d.areaName||d.name,color:colorOf(d.color)};
    setFloorCount(plan.floors.length);
    seatAreas(plan);
    hideCovered();
    for(const level of ORDER.filter(isWork))rebuildNavFloor(level);
    const wanted=new Map(active.map(m=>[m.name,m]));
    // People who left the organization leave the office.
    for(let i=agents.length-1;i>=0;i--){const a=agents[i];if(wanted.has(a.n)&&desks[a.n])continue;
      clearActivity(a);if(selected===a)selectAgent(null);if(follow?.agent===a)stopFollow(false);mobility.removeOwner(a.n);if(a.helmet){a.helmet.geometry.dispose();a.helmet.material.dispose();}a.g.parent?.remove(a.g);a.rig.cue.geometry.dispose();a.rig.dispose?.();a.label.remove();agents.splice(i,1);}
    for(const [name,m] of wanted){
      if(!desks[name])continue;
      let a=agents.find(x=>x.n===name);
      const person={n:name,initials:m.initials||name.split(/\s+/).map(p=>p[0]).join('').slice(0,4).toUpperCase(),role:m.role,group:m.division,gender:a?.gender||TEAM.find(p=>p.n===name)?.gender||'nonbinary'};
      if(!a){a=character(person,agents.length);agents.push(a);continue;}
      Object.assign(a,{group:person.group,role:person.role,initials:person.initials});a.label.textContent=person.initials;
      clearActivity(a);const desk=desks[name],wasAtDesk=a.spot===a.desk;a.desk=desk;a.keyboardReach=null;
      a.stretchSpot=linkSpot(desk._item,{x:desk.x,z:desk.z-desk.f*.95,f:desk.f,floor:desk.floor,route:[[desk.route[0][0],passage(desk.floor)],[desk.route[0][0],desk.z-desk.f*.95]],state:'stretch',local:true,label:'Berdiri sejenak'},false);a.stretchSpot._dynamic=true;
      // Anyone on a floor that is gone, or mid-stairs, is placed straight at the new desk.
      // Seated people move straight to their new desk; walkers and people on removed floors too.
      if(!floors[a.floor]||a.state==='stairs'||wasAtDesk||a.floor!==desk.floor&&a.destination===a.desk){
        a.stairTrip=null;a.floor=desk.floor;moveTo(floors[desk.floor],a.g);a.g.position.set(desk.x,0,desk.z);a.heading=facing(desk);a.g.rotation.y=a.heading;
        a.spot=desk;a.destination=desk;a.path=[];a.state='work';
      }else if(!a.destination||!floors[a.destination.floor]||!a.activity)setPath(a,desk);
      // Division colour: textured humans retint only the shirt; the legacy figure swaps its flat shirt material.
      if(a.rig.shirtMaterials){for(const m of a.rig.shirtMaterials)m.userData.shirt.value.set(metaOf(a.group).color);a.rig.look.shirt=metaOf(a.group).color;}
      else{const shirtColor=material(metaOf(a.group).color);a.rig.figure.traverse(o=>{if(o.material&&o.userData.shirt)o.material=shirtColor;});}
    }
    if(activeFloor&&!floors[activeFloor])setFloor(3,false);
    // New work floors start visible by default; reapply the selected view after rebuilding the organization.
    // Preserve a character camera's two-floor stair view when it is following someone between floors.
    if(follow)showLevels(followLevels.filter(l=>floors[l]),stairsShown);else showLevels(activeFloor?[activeFloor]:ORDER,activeFloor===0);
    renderFloorButtons();renderTeamList();window.officeTasks.setTeam?.(agents);drawStats();
    return {floors:plan.floors.length,seated:Object.keys(desks).length};
  }
  // Skinned rigs keep rig.head as a detached pose control, so measure from the head bone instead.
  // ponytail: fixed 0.24m head box above the head joint; use skinned vertex bounds if audits need more precision.
  const headBounds=a=>{const b=a.rig.bones?.get('head');if(!b)return new THREE.Box3().setFromObject(a.rig.head);const p=b.getWorldPosition(new THREE.Vector3());return new THREE.Box3(new THREE.Vector3(p.x-.1,p.y-.02,p.z-.1),new THREE.Vector3(p.x+.1,p.y+.22,p.z+.1));};
  window.officeScene={
    // Custom rooms (port): rebuild rooms without a reload and report live occupancy per room.
    applyRooms:list=>applyRooms(list),
    roomOccupancy:()=>Object.fromEntries(customRooms.map(room=>[room.id,roomSpots.filter(s=>s.room===room.id&&s.occupant).length])),
    visitorTravelAudit:()=>shop.people.map(c=>({state:c.state,mode:c.arrivalMode||'walking-existing',trip:c.vehicleTrip||null})),
    environmentAudit:()=>environment.audit(),
    mobilitySnapshot:()=>mobility.snapshot(),
    customize:customAPI,
    applyOrg,
    floorRoles:()=>ORDER.map(level=>({level,number:orderOf(level)+1,role:level===1?'lobby':level===2?'dining':level===ROOF?'roof':`work-${level===3?1:level-ROOF+1}`,name:floorName(level)})),
    floorHeight:level=>floorY(level),
    signs:()=>deskAreas.map(a=>a.sign),
    select:name=>selectAgent(agents.find(agent=>agent.n===name)||null),
    setEditing:on=>setCustomizing(!!on),
    // Adds or updates the given members on top of the current organization.
    syncRoster:roster=>{const before=new Set(agents.map(a=>a.n)),s=window.officeTasks.state(),names=new Set((roster||[]).map(m=>m.name));applyOrg({...s,members:[...s.members.filter(m=>!names.has(m.name)),...(roster||[])]});const assigned=agents.filter(a=>!before.has(a.n)).map(a=>a.n);return {assigned,hotDesk:[],warnings:[]};},
    removeRosterMember:name=>{if(window.officeTasks?.state){const s=window.officeTasks.state();return applyOrg({...s,members:s.members.map(m=>m.name===name?{...m,active:false}:m)}).seated>=0;}const agent=agents.find(a=>a.n===name);if(!agent)return false;agent.active=false;agent.label.hidden=true;agent.g.visible=false;return true;},
    snapshot:()=>({shop:{states:shop.people.map(p=>p.state),barbers:barbers.map(b=>b.pose),cashier:cashier.pose},transitioning:!!transition,sky:skyline.visible,floor:activeFloor,paused,routine:routineOn,follow:follow&&{name:follow.agent.n,mode:follow.mode},cameraPosition:camera.position.toArray(),doors:doors.map(d=>Math.round(d.open*100)/100),camera:{theta:cam.theta,phi:cam.phi,radius:cam.radius,target:cam.target.toArray()},
      team:agents.map(a=>({name:a.n,initials:a.initials,gender:a.gender,role:a.role,group:a.group,floor:a.floor,state:a.state,visible:a.g.visible,position:a.g.getWorldPosition(new THREE.Vector3()).toArray(),heading:new THREE.Euler().setFromQuaternion(a.g.getWorldQuaternion(new THREE.Quaternion()),'YXZ').y,spotFacing:a.spot?facing(a.spot):null,path:a.path.slice(0,4).map(q=>q.map(v=>+v.toFixed(2))),pathLeft:a.path.length,blocked:+(a.blocked||0).toFixed(2),pass:a.passUntil>simTime,dest:a.destination&&[a.destination.x,a.destination.z],sitting:SIT.has(a.state)&&!a.spot?.standing,destination:a.destination.floor,activity:a.activity?.spot.state||null,atDesk:a.spot===a.desk,talkingWith:companions(a)[0]?.n||null,roomName:a.spot?.roomName||null})),
      visibleFloors:Object.keys(floors).filter(k=>floors[k].visible).map(Number),
      models:window.officeModels3d?.status()||{loaded:0,failed:[]},
      graphics:(()=>{const L=GFX.LEVELS[gfxLevel]||{};return {environmentSource:scene.environment?envSource:null,level:gfxLevel,pending:gfxPending,shadows:renderer.shadowMap.enabled,environment:!!scene.environment,post:[...(L.ao&&composer?['sao']:[]),...(L.bloom&&composer?['bloom']:[])],aoSize:(()=>{const a=composer?.passes.find(p=>p instanceof ADD.SAOPass);return a?[a.saoRenderTarget.width,a.saoRenderTarget.height]:null;})(),textures:window.officeSurfaces?.tier?.()??L.textures??null,drawCalls:renderer.info.render.calls,textureCount:renderer.info.memory.textures};})()}),
    showFps:on=>{showFps=!!on;fpsLabel.hidden=!showFps;},
    // Time-of-day state for the mood picker and its browser test.
    mood:()=>({id:moodId,blend:+moodBlend.toFixed(2),sun:+sun.intensity.toFixed(2),ambient:+ambient.intensity.toFixed(2),background:'#'+scene.background.getHexString(),fog:!!scene.fog,stars:nightSky.visible,lamps:eveningLights.visible,city:+(cityFacadeMats[0]?.emissiveIntensity||0).toFixed(2),street:+(streetBulbMaterial.emissiveIntensity||0).toFixed(2)}),
    setMood:(id,instant=false)=>{setMood(id,{instant:!!instant});return moodId;},
    decor:level=>{const kinds=new Set();let total=0;floors[level]?.traverse(o=>{if(o.userData.decor){total++;kinds.add(o.userData.decor==='rug'||o.userData.decor==='wood_panel'||o.userData.decor==='window_frame'?o.userData.decor:o.userData.decor);}if(o.userData.model&&!o.userData.decor){total++;kinds.add(o.userData.model);}});return {total,kinds:[...kinds]};},
    // Mean relative luminance (0–1) of the current frame, rendered with the active graphics pipeline.
    luminance:()=>{renderFrame();const gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
      let sum=0,n=0;for(let i=0;i<px.length;i+=4*37){sum+=(.2126*px[i]+.7152*px[i+1]+.0722*px[i+2])/255;n++;}return sum/n;},
    setRoutine:on=>{routineOn=!!on;syncRoutine();},
    everyoneToDesk:()=>commandMembers(agents,'work'),
    modelCount:level=>{let n=0;floors[level]?.traverse(o=>{if(o.userData.model)n++;});return n;},
    // Human measurements and looks, for tests and the character panel.
    people:()=>agents.map(a=>{const L=a.rig.look||{};const box=new THREE.Box3().setFromObject(a.rig.figure);const height=box.max.y-box.min.y;const floorY=a.g.parent?.position.y??0;const standing=(box.max.y-floorY);const rest=a.rig.body.position.y; a.rig.body.position.y=0; a.rig.figure.updateMatrixWorld(true); const upright=new THREE.Box3().setFromObject(a.rig.figure); const uprightHeight=upright.max.y-floorY; a.rig.body.position.y=rest; a.rig.figure.updateMatrixWorld(true);
      const headBox=headBounds(a);return {name:a.n,height:+uprightHeight.toFixed(3),seatedHeight:+standing.toFixed(3),headHeight:+(headBox.max.y-headBox.min.y).toFixed(3),
        shoulderWidth:+(L.shoulder??0).toFixed(3),skin:L.skin===undefined?null:'#'+L.skin.toString(16).padStart(6,'0'),hair:L.hair===undefined?null:'#'+L.hair.toString(16).padStart(6,'0'),
        build:L.build||null,scale:a.rig.model?a.rig.model.scale.toArray():null,shirt:L.shirt===undefined?null:'#'+L.shirt.toString(16).padStart(6,'0')};}),
    // Real bone positions vs the office geometry, for the stage-2 pose tests (skinned rigs only).
    poseAudit:()=>{scene.updateMatrixWorld(true);const v=o=>o.getWorldPosition(new THREE.Vector3());
      return agents.filter(a=>a.rig.bones).map(a=>{const B=n=>a.rig.bones.get(n),floorY=floors[a.floor]?.position.y??0;
        const soles=['foot.L','foot.R'].map(n=>v(B(n)).y),hip=v(B('root')),hands=['wrist.L','wrist.R'].map(n=>v(B(n)));
        let keyboard=null,monitor=null;floors[a.floor].traverse(o=>{if(o.userData.model==='keyboard'&&Math.abs(v(o).x-a.desk.x)<.6&&(!keyboard||v(o).distanceTo(hip)<v(keyboard).distanceTo(hip)))keyboard=o;if(o.userData.model==='monitor'&&Math.abs(v(o).x-a.desk.x)<.6&&(!monitor||v(o).distanceTo(hip)<v(monitor).distanceTo(hip)))monitor=o;});
        const headPos=v(B('head')),mb=monitor&&new THREE.Box3().setFromObject(monitor),gap=mb?Math.hypot(...['x','y','z'].map(k=>Math.max(0,mb.min[k]-headPos[k]-.1,headPos[k]-.1-mb.max[k]))):null;
        const k=B('lowerleg01.L').quaternion,e=B('lowerarm01.L').quaternion;
        return {name:a.n,state:a.state,atDesk:a.spot===a.desk,soleAboveFloor:+(Math.min(...soles)-floorY-.05).toFixed(3),
          hipAboveSeat:+(hip.y-floorY-(.46+.04)).toFixed(3),handToKeyboard:keyboard?+Math.min(...hands.map(h=>h.distanceTo(v(keyboard)))).toFixed(3):null,
          headToMonitor:gap===null?null:+gap.toFixed(3),kneeBend:+(2*Math.acos(Math.min(1,Math.abs(k.w)))).toFixed(3),armSwing:+a.rig.arms[0].shoulder.rotation.x.toFixed(3)};});},
    // Cached keyboard reach vs a fresh measurement at the current desk (stage-2 tests).
    reachAudit:()=>agents.filter(a=>a.rig.reach&&a.keyboardReach).map(a=>{const cached=a.keyboardReach,fresh=keyboardReach(a);return {name:a.n,drift:Math.hypot(fresh.dy-cached.dy,fresh.dz-cached.dz)};}),
    // Desk layout geometry (stage-2 tests): desk-top items must not overlap, each seated worker's chair back is
    // behind them, and a horizontal ray from the hips at knee height finds no desk part before the knee.
    deskLayoutAudit:()=>{scene.updateMatrixWorld(true);const overlaps=[];
      for(const area of deskAreas){const tops=[];area.group.traverse(o=>{const m=o.userData.model||o.userData.decor;if(['monitor','keyboard','books','mug'].includes(m))tops.push({m,box:new THREE.Box3().setFromObject(o).expandByScalar(-.005)});});
        for(let i=0;i<tops.length;i++)for(let j=i+1;j<tops.length;j++)if(tops[i].m!==tops[j].m&&tops[i].box.intersectsBox(tops[j].box)&&!(tops[i].m==='monitor'&&tops[j].m==='keyboard'))overlaps.push(tops[i].m+'/'+tops[j].m);}
      const seats=agents.filter(a=>a.spot===a.desk&&a.desk?._item).map(a=>{const inv=new THREE.Matrix4().copy(a.g.matrixWorld).invert(),v=new THREE.Vector3();let n=0,zs=0;
        a.desk._item.group.traverse(o=>{if(!o.isMesh)return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i+=3){v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);if(v.y-(floors[a.floor]?.position.y??0)<.75)continue;v.applyMatrix4(inv);zs+=v.z;n++;}});
        const table=deskAreas.find(d=>Object.values(d.seats).includes(a.desk))?.items[0].group,forward=new THREE.Vector3(0,0,1).applyQuaternion(a.g.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
        const origin=a.g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.5,0)),hit=table&&new THREE.Raycaster(origin,forward,0,1.2).intersectObject(table,true)[0];
        const knee=a.rig.bones?a.rig.bones.get('lowerleg01.L').getWorldPosition(new THREE.Vector3()).sub(a.g.getWorldPosition(new THREE.Vector3())).dot(forward)+.06:.5;
        return {name:a.n,backForward:n?+(zs/n).toFixed(3):null,legroom:hit?+(hit.distance-knee).toFixed(3):1};});
      return {overlaps,seats};},
    sendToStretch:name=>{const a=agents.find(x=>x.n===name);if(a){clearActivity(a);assign(a,a.stretchSpot,30);}},
    workstationAudit:()=>{scene.updateMatrixWorld(true);return agents.filter(a=>a.spot===a.desk).map(a=>{const head=headBounds(a),monitors=[];floors[a.floor].traverse(o=>{if(o.userData.model!=='monitor')return;const b=new THREE.Box3().setFromObject(o);if(Math.abs(b.getCenter(new THREE.Vector3()).x-a.desk.x)<1)monitors.push(b);});const gap=b=>Math.hypot(...['x','y','z'].map(k=>Math.max(0,head.min[k]-b.max[k],b.min[k]-head.max[k])));return {name:a.n,side:a.desk.f,monitors:monitors.length,minGap:monitors.length?Math.min(...monitors.map(gap)):null};});},
    screenAudit:()=>{scene.updateMatrixWorld(true);const out=[];scene.traverse(o=>{if(o.userData.decor!=='screen')return;const p=o.getWorldPosition(new THREE.Vector3()),normal=new THREE.Vector3(0,0,1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())),ray=new THREE.Raycaster(p.clone().addScaledVector(normal,.01),normal.clone().negate()),attached=o.parent.userData.model==='monitor',hit=attached?ray.intersectObjects(o.parent.children.filter(c=>c!==o),true)[0]:null;const box=new THREE.Box3().setFromObject(o);let marginX=null,marginY=null;if(attached){const mon=new THREE.Box3().setFromObject(o.parent),mw=mon.max.x-mon.min.x,mh=mon.max.y-mon.min.y;marginX=+(1-(box.max.x-box.min.x)/mw).toFixed(3);marginY=+(1-(box.max.y-box.min.y)/mh).toFixed(3);}out.push({attached,gap:hit?hit.distance-.01:null,marginX,marginY});});return out;},
    geometryAudit:()=>{scene.updateMatrixWorld(true);const decor=[];for(const [level,f] of Object.entries(floors))f.traverse(o=>{if(!o.userData.decor)return;const b=new THREE.Box3().setFromObject(o);decor.push({level:Number(level),kind:o.userData.decor,size:b.getSize(new THREE.Vector3()).toArray(),min:b.min.toArray(),max:b.max.toArray()});});return {decor,facades:Object.entries(facadeLevels).map(([level,f])=>{const b=new THREE.Box3().setFromObject(f);return {level:Number(level),minY:b.min.y,maxY:b.max.y};})};},
    surfaceAudit:level=>{let textured=0,flat=0;floors[level]?.traverse(o=>{if(!o.isMesh||o.material?.isMeshBasicMaterial||o.material?.transparent||!o.geometry.parameters?.width)return;const {width:w,height:h,depth:d}=o.geometry.parameters;if(Math.max(w*d,w*h,d*h)<.2)return;if(o.material.map)textured++;else flat++;});return {textured,flat};},
    // The walking grid of a floor (1 = blocked), for tests and debugging.
    navGrid:level=>({cell:NAV.cell,x0:NAV.x0,z0:NAV.z0,w:NAV.w,h:NAV.h,cells:Array.from(navGrids[level]||[])}),
    // Scripted camera moves for tests and recordings: any of target [x,y,z], theta, phi, radius.
    setCamera:view=>{if(view.target)cam.target.set(...view.target);for(const key of ['theta','phi','radius'])if(view[key]!==undefined)cam[key]=view[key];cam.spin=0;},
    // Screen position of a floor's centre, used by the browser test to click into a floor from the building view.
    floorPoint:level=>{const v=new THREE.Vector3(0,2,12.6);floors[level].localToWorld(v);v.project(camera);return {x:(v.x*.5+.5)*innerWidth,y:(-v.y*.5+.5)*innerHeight};}
  };
})();
