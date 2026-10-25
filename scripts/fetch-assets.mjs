// One-off: download the CC0 textures, HDRI and models the realistic office uses into public/assets,
// and write manifest.json + LICENSES.md. Sources: Poly Haven (API) and Kenney Furniture Kit (zip).
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const OUT=path.resolve('public/assets'),TMP=path.resolve('.superpowers/asset-download');fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(TMP,{recursive:true});
const PH='https://api.polyhaven.com';
// name -> Poly Haven id, repeat per metre-ish tile.
const TEXTURES={
  parquet_herringbone:['herringbone_parquet',[1,1]],wood_planks_light:['laminate_floor_02',[1,1]],plaster_white:['plastered_wall_04',[1,1]],
  wood_panel_walnut:['black_walnut_veneer_01',[1,1]],concrete_ceiling:['concrete_wall_006',[1,1]],fabric_sofa:['fabric_pattern_07',[1,1]],
  rug_shaggy:['wool_boucle',[1,1]],rug_pattern:['poly_wool_herringbone',[1,1]],metal_brushed:['metal_plate',[1,1]],metal_black:['metal_plate_02',[1,1]],
  leather_brown:['brown_leather',[1,1]],marble_white:['marble_01',[1,1]],brick_painted:['brick_wall_001',[1,1]],asphalt:['asphalt_02',[1,1]],tiles_kitchen:['floor_tiles_06',[1,1]]};
const MAPS={diff:['Diffuse','diff','col_1','Color'],nor:['nor_gl'],rough:['Rough','arm']};
// name -> Poly Haven model id (1k glTF with its textures).
const PH_MODELS={desk:'metal_office_desk',laptop:'classic_laptop',sofa_sectional:'sofa_03',armchair:'modern_arm_chair_01',coffee_table_glass:'modern_coffee_table_01',
  tv_cabinet:'modern_wooden_cabinet',tv:'television_02',dining_table:'dining_table',dining_chair:'dining_chair_02',bookshelf:'wooden_display_shelves_01',
  pendant_lamp:'hanging_industrial_lamp',arc_lamp:'desk_lamp_arm_01',plant_tall:'potted_plant_01',plant_small:'potted_plant_04',painting:'hanging_picture_frame_02',
  mug:'ceramic_vase_01',books:'book_encyclopedia_set_01',stool:'bar_chair_round_01',cushions:'throw_pillows_01',lounge_chair:'mid_century_lounge_chair',
  barber_chair:'BarberShopChair_01',mirror:'ornate_mirror_01',side_table:'side_table_01',clock:'wall_clock'};
// name -> file inside the Kenney Furniture Kit zip (CC0) for items Poly Haven does not have.
const KENNEY={office_chair:'chairDesk.glb',monitor:'computerScreen.glb',keyboard:'computerKeyboard.glb'};
const KENNEY_ZIP='https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip';

async function save(url,dest){if(fs.existsSync(dest))return;const r=await fetch(url);if(!r.ok)throw new Error(`${url}: ${r.status}`);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.from(await r.arrayBuffer()));}
async function info(id){const r=await fetch(`${PH}/info/${id}`);return r.json();}
async function files(id){const r=await fetch(`${PH}/files/${id}`);return r.json();}
const manifest={textures:{},hdri:{},models:{}},licenses=[];
const credit=(name,id,i,kind)=>licenses.push(`| ${name} | Poly Haven ${kind} \`${id}\` | ${Object.keys(i.authors||{}).join(', ')} | https://polyhaven.com/a/${id} | CC0 |`);

for(const [name,[id,repeat]] of Object.entries(TEXTURES)){
  const f=await files(id),i=await info(id),entry={repeat};
  for(const tier of ['1k','2k']){entry[tier]={};for(const [map,keys] of Object.entries(MAPS)){
    // 2k tier keeps only the colour map; normals/roughness reuse 1k to stay inside the size budget.
    if(tier==='2k'&&map!=='diff')continue;
    const key=keys.find(k=>f[k]?.[tier]?.jpg);if(!key)continue;const rel=`assets/textures/${name}/${tier}/${map}.jpg`;
    await save(f[key][tier].jpg.url,path.join('public',rel));entry[tier][map]=rel;}}
  manifest.textures[name]=entry;credit(name,id,i,'texture');console.log('texture',name);
}
{const id='photo_studio_loft_hall',f=await files(id),i=await info(id),rel='assets/hdri/interior_1k.hdr';await save(f.hdri['1k'].hdr.url,path.join('public',rel));manifest.hdri.interior=rel;credit('interior',id,i,'HDRI');console.log('hdri');}
for(const [name,id] of Object.entries(PH_MODELS)){
  const f=await files(id),i=await info(id),g=f.gltf['1k'].gltf,dir=`assets/models/${name}`;
  await save(g.url,path.join('public',dir,path.basename(g.url)));
  for(const [rel,inc] of Object.entries(g.include||{}))await save(inc.url,path.join('public',dir,rel));
  manifest.models[name]={file:`${dir}/${path.basename(g.url)}`,source:'polyhaven'};credit(name,id,i,'model');console.log('model',name);
}
{const zip=path.join(TMP,'kenney.zip');await save(KENNEY_ZIP,zip);
  for(const [name,file] of Object.entries(KENNEY)){const rel=`assets/models/${name}.glb`;
    if(!fs.existsSync(path.join('public',rel))){const data=execFileSync('unzip',['-p',zip,`Models/GLTF format/${file}`],{maxBuffer:5e7});fs.writeFileSync(path.join('public',rel),data);}
    manifest.models[name]={file:rel,source:'kenney'};licenses.push(`| ${name} | Kenney Furniture Kit \`${file}\` | Kenney | https://kenney.nl/assets/furniture-kit | CC0 |`);console.log('model',name);}}
fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(OUT,'LICENSES.md'),`# Lisensi aset 3D\n\nSemua aset di folder ini berlisensi **CC0** (domain publik). Diunduh oleh \`scripts/fetch-assets.mjs\`.\n\n| Nama | Sumber | Pembuat | URL | Lisensi |\n|---|---|---|---|---|\n${licenses.join('\n')}\n`);
console.log('done');
