// Exposes the vendored Three.js (0.160.0) and the addons the office uses as window.THREE, so office.js stays a plain script.
import * as core from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SAOPass} from 'three/addons/postprocessing/SAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

window.THREE=Object.assign({},core,{addons:{EffectComposer,RenderPass,SAOPass,UnrealBloomPass,OutputPass,GLTFLoader,RGBELoader,RoomEnvironment,BufferGeometryUtils,SkeletonUtils}});
// office.js is loaded after this module, so it always finds THREE ready.
// office-surfaces.js (classic script) needs THREE; office.js needs both, so load them in order.
const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.body.append(script);});
// Textured CC0 humans are the default; ?people=legacy keeps the old procedural figures (also the automatic fallback
// when the people assets fail to load).
load('office-surfaces.js').then(()=>load('office-models.js')).then(()=>new URLSearchParams(location.search).get('people')==='legacy'?undefined:load('office-people.js')).then(()=>load('mobility.js')).then(()=>load('environment-layout.js')).then(()=>load('office-environment.js')).then(()=>load('office.js')).catch(error=>{
  window.officeBootError=String(error?.message||error);
  console.error('Kantor 3D gagal dimuat:',error);
  const status=document.getElementById('sceneStatus');
  if(!status)return;
  status.textContent='Kantor 3D gagal dimuat. Periksa koneksi, lalu ';
  const button=document.createElement('button');button.type='button';button.className='scene-reload';button.textContent='muat ulang';
  button.addEventListener('click',()=>location.reload());status.append(button);
});
