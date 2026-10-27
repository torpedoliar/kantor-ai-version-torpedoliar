// Room edits must not leave stale collision cells behind, and rebuilding one room must not
// orphan people sitting in another room that did not change.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43546),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-rooms-nav-')),origin=`http://127.0.0.1:${PORT}`;
(async()=>{
  const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64')},stdio:['ignore','pipe','inherit']});
  await new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('exit '+code)));});
  let browser;
  try{
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;
    const call=async(method,route,body,extra={})=>{const response=await fetch(origin+route,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...extra},body:body&&method!=='GET'?JSON.stringify(body):undefined});return {status:response.status,body:await response.json().catch(()=>null)};};
    const owner={'x-kantor-org':(await call('POST','/api/org/unlock',{pin:'2468'})).body.token};
    browser=await launch();
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken','')}catch{}});
    await page.goto(origin);
    await page.waitForFunction(()=>window.officeScene&&window.officeTasks&&!document.getElementById('bLock').disabled,null,{timeout:90000});
    // Wait out the drawer's initial poll: a stale list landing after a room is created must not remove it.
    await page.evaluate(()=>window.officeRooms?.refresh?.(true));
    // Cells around the chosen point must be clear before a room is placed there.
    const findOpen=(region,avoid=[])=>page.evaluate(({region,avoid})=>{
      const grid=officeScene.navGrid(2),step=.5;
      for(let z=region[2];z<=region[3];z+=step)for(let x=region[0];x<=region[1];x+=step){
        if(avoid.some(a=>Math.abs(x-a.x)<=a.rx&&Math.abs(z-a.z)<=a.rz))continue;
        const i=Math.floor((x-grid.x0)/grid.cell),j=Math.floor((z-grid.z0)/grid.cell);
        let clear=true;
        for(let dj=-3;dj<=3&&clear;dj++)for(let di=-3;di<=3;di++){const value=grid.cells[(j+dj)*grid.w+i+di];if(value===undefined||value){clear=false;break;}}
        if(clear)return {x,z};
      }
      return null;
    },{region,avoid});
    const navValue=(x,z)=>page.evaluate(({x,z})=>{const grid=officeScene.navGrid(2),i=Math.floor((x-grid.x0)/grid.cell),j=Math.floor((z-grid.z0)/grid.cell);return grid.cells[j*grid.w+i];},{x,z});
    const applyRooms=async()=>{const list=(await call('GET','/api/rooms')).body;await page.evaluate(items=>officeScene.applyRooms(items),list);return list;};
    const create=async body=>{const result=await call('POST','/api/rooms',body,owner);assert.equal(result.status,201,`room ${body.name} created: ${JSON.stringify(result.body)}`);return result.body;};
    const remove=async id=>assert.equal((await call('DELETE',`/api/rooms/${id}?occupants=0`,null,owner)).status,200,'room removed');

    // 1. A room's table blocks the walking grid; deleting it must free those cells again.
    const spotA=await findOpen([-10,10,6.5,8.8]);
    assert.ok(spotA,'an open floor-2 area exists for the first room');
    const roomA=await create({name:'Ruang Uji',type:'meeting',floor:2,x:spotA.x,z:spotA.z,capacity:2});
    await applyRooms();
    assert.notEqual(await navValue(spotA.x,spotA.z),0,'meeting table blocks its centre cell');
    await remove(roomA.id);
    await applyRooms();
    assert.equal(await navValue(spotA.x,spotA.z),0,'deleting the last room rebuilds the floor grid');

    // 2. A private room stays occupied when another room is added later.
    const spotB=await findOpen([-10,10,6.5,8.8]);
    assert.ok(spotB,'an open floor-2 area exists for the private room');
    const roomB=await create({name:'Ruang Uji Pribadi',type:'focus',floor:2,x:spotB.x,z:spotB.z,capacity:1,owner:'Koh Arman'});
    await applyRooms();
    await page.evaluate(()=>officeScene.select('Koh Arman'));
    await page.locator('[data-command="private-room"]').click();
    await page.waitForFunction(()=>{const person=officeScene.snapshot().team.find(member=>member.name==='Koh Arman');return person&&person.roomName==='Ruang Uji Pribadi';},null,{timeout:240000,polling:500});
    assert.equal(await page.evaluate(id=>officeScene.roomOccupancy()[id]||0,roomB.id),1,'owner sits in the private room');
    const spotC=await findOpen([2,12,6.5,8.8],[{x:spotB.x,z:spotB.z,rx:2.6,rz:2.6}]);
    assert.ok(spotC,'a second open area exists away from the private room');
    const roomC=await create({name:'Ruang Uji Lain',type:'focus',floor:2,x:spotC.x,z:spotC.z,capacity:1});
    await applyRooms();
    assert.notEqual(await navValue(spotC.x,spotC.z),0,'the new room blocks its own cells');
    assert.equal(await page.evaluate(id=>officeScene.roomOccupancy()[id]||0,roomB.id),1,'unchanged private room keeps its occupant');
    assert.equal(await page.evaluate(()=>officeScene.snapshot().team.find(member=>member.name==='Koh Arman').roomName),'Ruang Uji Pribadi','occupant is not orphaned by another room rebuild');
    await remove(roomC.id);
    await applyRooms();
    assert.equal(await navValue(spotC.x,spotC.z),0,'the second room frees its cells');
    assert.equal(await page.evaluate(id=>officeScene.roomOccupancy()[id]||0,roomB.id),1,'private room still occupied after the other room is deleted');
    assert.deepEqual(errors,[]);
    console.log('PASS: room rebuild is diff-aware, clears stale nav cells and keeps unrelated occupants seated');
  }finally{if(browser)await browser.close();server.kill();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
