// One-off: copy Three.js 0.160.0 core + the addons Kantor Kita uses into public/vendor/three (no runtime CDN).
import fs from 'node:fs';import path from 'node:path';
const BASE='https://cdn.jsdelivr.net/npm/three@0.160.0/',OUT=path.resolve('public/vendor/three');
const files=['build/three.module.min.js',...['postprocessing/EffectComposer','postprocessing/RenderPass','postprocessing/ShaderPass','postprocessing/MaskPass','postprocessing/Pass','postprocessing/SAOPass','postprocessing/UnrealBloomPass','postprocessing/OutputPass','shaders/CopyShader','shaders/SAOShader','shaders/DepthLimitedBlurShader','shaders/UnpackDepthRGBAShader','shaders/LuminosityHighPassShader','shaders/OutputShader','loaders/GLTFLoader','loaders/RGBELoader','utils/BufferGeometryUtils','utils/SkeletonUtils','environments/RoomEnvironment','math/SimplexNoise'].map(f=>`examples/jsm/${f}.js`),'LICENSE'];
const seen=new Set();
async function get(rel){if(seen.has(rel))return;seen.add(rel);const res=await fetch(BASE+rel);if(!res.ok)throw new Error(`${rel}: ${res.status}`);let text=await res.text();
  const dest=path.join(OUT,rel.replace(/^build\//,'').replace(/^examples\/jsm\//,''));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);
  // Follow relative imports inside addons so every dependency is vendored too.
  if(rel.startsWith('examples/'))for(const m of text.matchAll(/from\s+'(\.\.?\/[^']+)'/g))await get(path.posix.join(path.posix.dirname(rel),m[1]));}
for(const f of files)await get(f);console.log(`vendored ${seen.size} files into ${OUT}`);
