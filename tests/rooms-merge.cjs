// A custom room built at startup stays removable: its meshes are never baked into the floor's
// merged static geometry, so deleting it also clears its collision cells.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
const PORT=43559,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-rooms-merge-')),origin=`http://127.0.0.1:${PORT}`;
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,9).toString('base64')},stdio:['ignore','pipe','inherit']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
(async()=>{await ready;let browser;try{
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
  const call=async(method,p,body,headers={'content-type':'application/json',origin,'x-kantor-csrf':csrf})=>{const r=await fetch(origin+p,{method,headers,body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const owner={...{'content-type':'application/json',origin,'x-kantor-csrf':csrf},'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
  const room=(await call('POST','/api/rooms',{name:'Ghost Check',type:'focus',floor:2,x:0,z:0},owner)).body;
  assert.ok(room.id,'room created before the scene loads');
  browser=await launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken','')}catch{}});
  await page.goto(origin);await page.waitForFunction(()=>window.officeScene);
  await page.waitForFunction(id=>(officeScene.roomMeshes()[id]||0)>0,room.id,{timeout:30000});
  const before=await page.evaluate(id=>({meshes:officeScene.meshCount(2),blocked:officeScene.navGrid(2).cells.filter(v=>v>0).length,room:officeScene.roomMeshes()[id]}),room.id);
  assert.ok(before.room>0,'the room is built as its own removable group, not merged');
  assert.equal((await call('DELETE',`/api/rooms/${room.id}?occupants=0`,null,owner)).status,200);
  const after=await page.evaluate(async id=>{const list=await (await fetch('/api/rooms',{cache:'no-store'})).json();officeScene.applyRooms(list);return new Promise(r=>setTimeout(()=>r({meshes:officeScene.meshCount(2),blocked:officeScene.navGrid(2).cells.filter(v=>v>0).length,room:officeScene.roomMeshes()[id]}),400));},room.id);
  assert.equal(after.room,undefined,'no ghost meshes remain after the room is deleted');
  assert.ok(after.meshes<before.meshes,`floor meshes dropped after deletion (${before.meshes} → ${after.meshes})`);
  assert.ok(after.blocked<before.blocked,`collision cells dropped after deletion (${before.blocked} → ${after.blocked})`);
  assert.deepEqual(errors,[]);
  console.log('PASS: startup rooms stay out of merged geometry, and deleting one removes its meshes and collision cells');
}finally{if(browser)await browser.close();server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
