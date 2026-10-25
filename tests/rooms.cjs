// Custom rooms (port dari orchestrator-patterns, diadaptasi ke v2): owner-gated CRUD with
// overlap/bounds/built-in/occupancy guards, then the 3D side — the room builds into the
// navigation grid and an idle excursion reaches it through the stairs.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43541),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-rooms-')),origin=`http://127.0.0.1:${PORT}`;
const api=async(p,opts={},extra={})=>fetch(origin+p,{...opts,headers:{'content-type':'application/json',origin,...extra},...((opts.body&&opts.method!=='GET')?{}:{})}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
(async()=>{
  const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64')},stdio:['ignore','pipe','inherit']});
  await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});
  try{
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
    const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...extra},body:body&&method!=='GET'?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
    const owner={'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
    // 1. Guards: the list is public, writes need the owner unlock, built-ins mirror the 3D office.
    const seeds=(await call('GET','/api/rooms')).body;
    assert.equal(seeds.filter(r=>r.builtIn).length,5,'five built-in rooms');
    assert.equal((await call('POST','/api/rooms',{name:'Nope',type:'lounge',floor:2})).status,403,'writes are owner-only');
    const war=await call('POST','/api/rooms',{name:'War Room',type:'meeting',floor:3,x:0,z:8.5},owner);
    assert.equal(war.status,201);assert.equal(war.body.capacity,6);assert.equal(war.body.w,6);
    assert.equal((await call('POST','/api/rooms',{name:'Clash',type:'lounge',floor:3,x:1,z:9},owner)).status,409,'overlap refused');
    assert.equal((await call('POST','/api/rooms',{name:'war room',type:'lounge',floor:2},owner)).status,409,'duplicate name refused');
    assert.equal((await call('POST','/api/rooms',{name:'Edge',type:'lounge',floor:2,x:15,z:0},owner)).status,400,'outside the floor');
    assert.equal((await call('POST','/api/rooms',{name:'Bad kind',type:'lounge',floor:2,furniture:[{kind:'alien',x:0,z:0}]},owner)).status,400,'unknown furniture');
    assert.equal((await call('PATCH','/api/rooms/seed-meeting',{name:'Board Room'},owner)).status,200,'built-ins can be renamed');
    assert.equal((await call('PATCH','/api/rooms/seed-meeting',{type:'lounge'},owner)).status,400,'built-in type locked');
    assert.equal((await call('DELETE','/api/rooms/seed-meeting',null,owner)).status,409,'built-in delete refused');
    assert.equal((await call('DELETE',`/api/rooms/${war.body.id}?occupants=2`,null,owner)).status,409,'busy room refused');
    assert.equal((await call('DELETE',`/api/rooms/${war.body.id}?occupants=0`,null,owner)).status,200);
    // 2. A room the team will roam to.
    const sky=await call('POST','/api/rooms',{name:'Sky Lounge',type:'lounge',floor:2,x:4,z:9.5,furniture:[{kind:'plant',x:1.8,z:1.5}]},owner);
    const pod=await call('POST','/api/rooms',{name:'Quiet Pod',type:'focus',floor:4,x:8,z:-8},owner);
    assert.equal(sky.status,201);assert.equal(pod.status,201);
    // 3. The office builds the room into the scene and the nav grid; an excursion eventually reaches it.
    const browser=await launch();
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken','')}catch{}});
    await page.goto(origin);await page.waitForFunction(()=>window.officeScene);
    assert.ok((await page.evaluate(()=>officeScene.navGrid(2).cells)).length>0,'nav grid builds with the room');
    assert.equal(await page.evaluate(id=>officeScene.roomOccupancy()[id]||0,sky.body.id),0,'empty at first');
    // The rooms surface is wired once the server connection is live.
    await page.waitForFunction(()=>!document.getElementById('bRooms').hidden);
    await page.click('#railMore summary');
    await page.click('#bRooms');
    assert.match(await page.locator('#roomsList').innerText(),/Sky Lounge/);
    assert.match(await page.locator('#roomsList').innerText(),/bawaan/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(id=>(officeScene.roomOccupancy()[id]||0)>=1,sky.body.id,{timeout:240000,polling:500});
    assert.deepEqual(errors,[]);
    console.log('PASS: rooms API guards, 3D build, nav grid, excursion reaches the room, occupancy, rooms drawer');
    await browser.close();
  }finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
