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
    assert.equal((await call('POST','/api/rooms',{name:'Bad owner',type:'focus',floor:2,owner:'Tidak Ada'},owner)).status,400,'unknown room owner');
    assert.equal((await call('POST','/api/rooms',{name:'Too Many',type:'meeting',floor:2,capacity:9},owner)).status,400,'capacity above the eight seats the scene builds is refused');
    const eight=await call('POST','/api/rooms',{name:'Eight Seats',type:'focus',floor:2,x:0,z:0,capacity:8},owner);
    assert.equal(eight.status,201,'capacity eight is allowed');
    assert.equal((await call('DELETE',`/api/rooms/${eight.body.id}?occupants=0`,null,owner)).status,200);
    assert.equal((await call('PATCH','/api/rooms/seed-meeting',{name:'Board Room'},owner)).status,200,'built-ins can be renamed');
    assert.equal((await call('PATCH','/api/rooms/seed-meeting',{type:'lounge'},owner)).status,400,'built-in type locked');
    assert.equal((await call('DELETE','/api/rooms/seed-meeting',null,owner)).status,409,'built-in delete refused');
    assert.equal((await call('DELETE',`/api/rooms/${war.body.id}?occupants=2`,null,owner)).status,409,'busy room refused');
    assert.equal((await call('DELETE',`/api/rooms/${war.body.id}?occupants=0`,null,owner)).status,200);
    // 2. A room the team will roam to.
    const sky=await call('POST','/api/rooms',{name:'Sky Lounge',type:'lounge',floor:2,x:4,z:9.5,furniture:[{kind:'plant',x:1.8,z:1.5}]},owner);
    const pod=await call('POST','/api/rooms',{name:'Quiet Pod',type:'focus',floor:4,x:8,z:-8},owner);
    const priv=await call('POST','/api/rooms',{name:'Ruang Koh Arman',type:'focus',floor:2,x:-4,z:9.5,owner:'Koh Arman'},owner);
    assert.equal(sky.status,201);assert.equal(pod.status,201);assert.equal(priv.status,201);assert.equal(priv.body.owner,'Koh Arman');
    assert.equal((await call('PATCH','/api/rooms/'+priv.body.id,{owner:null},owner)).body.owner,null,'owner can be cleared');
    assert.equal((await call('PATCH','/api/rooms/'+priv.body.id,{owner:'Koh Arman'},owner)).body.owner,'Koh Arman');
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
    await page.click('#bRooms');
    assert.match(await page.locator('#roomsList').innerText(),/Sky Lounge/);
    assert.match(await page.locator('#roomsList').innerText(),/bawaan/);
    // Renaming a built-in room updates its floor sign, not only the sidebar row.
    await page.waitForFunction(()=>officeScene.roomLabelText('seed-meeting')==='BOARD ROOM',null,{timeout:5000});
    // The floor plan is keyboard-operable: arrows nudge 0.1 m, Shift 0.5 m.
    const skyRow=page.locator('.room-row',{hasText:'Sky Lounge'});
    await skyRow.getByRole('button',{name:'Ubah'}).click();
    await page.focus('#roomPlan');
    const x0=Number(await page.locator('#roomX').inputValue()),z0=Number(await page.locator('#roomZ').inputValue());
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs(Number(await page.locator('#roomX').inputValue())-x0-.1)<.01,'ArrowRight moves the room 0.1 m');
    await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');
    assert.ok(Math.abs(Number(await page.locator('#roomX').inputValue())-x0-.6)<.01,'Shift+ArrowRight moves 0.5 m more');
    assert.equal(Number(await page.locator('#roomZ').inputValue()),z0);
    assert.match(await page.locator('#roomsMessage').innerText(),/Posisi ruangan/);
    await page.click('#roomCancel');
    await page.keyboard.press('Escape');
    await page.waitForFunction(id=>(officeScene.roomOccupancy()[id]||0)>=1,sky.body.id,{timeout:420000,polling:500});
    // Private room: the owner gets a personal-room command; nobody else can be sent there.
    await page.evaluate(()=>officeScene.select('Kak Rani'));
    assert.equal(await page.locator('[data-command="private-room"]').count(),0,'non-owner has no private-room command');
    await page.evaluate(()=>officeScene.select('Koh Arman'));
    await page.locator('[data-command="private-room"]').click();
    await page.waitForFunction(()=>{const p=officeScene.snapshot().team.find(t=>t.name==='Koh Arman');return p&&p.roomName==='Ruang Koh Arman';},null,{timeout:240000,polling:500});
    const intruders=await page.evaluate(()=>officeScene.snapshot().team.filter(t=>t.roomName==='Ruang Koh Arman'&&t.name!=='Koh Arman').length);
    assert.equal(intruders,0,'nobody else sits in the private room');
    assert.match(await page.locator('#roomsList').innerText(),/milik Koh Arman/);
    assert.deepEqual(errors,[]);
    console.log('PASS: rooms API guards, 3D build, nav grid, excursion reaches the room, occupancy, rooms drawer');
    await browser.close();
  }finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
