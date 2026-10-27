// Corrupt state files are archived, last-good is used when possible, and the server still boots.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {recoverState}=require('../server/state-recovery');
const {createOrg}=require('../server/org');
const {createTaskStore}=require('../server/task-store');
const PORT=43643,origin=`http://127.0.0.1:${PORT}`;
(async()=>{
  // 1. A valid file is snapshotted; a later corrupt file is archived and the snapshot is used.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-recovery-'));
  try{
    const file=path.join(dir,'demo.json'),validate=value=>{if(value.v!==1)throw new Error('bad value');};
    fs.writeFileSync(file,'{"v":1}');
    const clean=recoverState({file,dataDir:dir,label:'demo',validate,fresh:()=>({v:0})});
    assert.equal(clean.value.v,1);assert.equal(clean.recovered,false);
    assert.ok(fs.readdirSync(path.join(dir,'last-good')).some(name=>name.startsWith('demo.')),'a valid load writes last-good');
    fs.writeFileSync(file,'{broken');
    const restored=recoverState({file,dataDir:dir,label:'demo',validate,fresh:()=>({v:0})});
    assert.equal(restored.recovered,true);assert.equal(restored.value.v,1);assert.ok(restored.corruptPath);
    // 2. With no snapshot the caller's corrupt file starts degraded instead of crashing.
    const dir2=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-recovery-empty-'));
    try{
      const file2=path.join(dir2,'other.json');fs.writeFileSync(file2,'{broken');
      const empty=recoverState({file:file2,dataDir:dir2,label:'other',validate:()=>{},fresh:()=>({v:0}),corruptFresh:()=>({v:9})});
      assert.equal(empty.degraded,true);assert.equal(empty.value.v,9);assert.ok(empty.corruptPath);
    }finally{fs.rmSync(dir2,{recursive:true,force:true});}
    // 3. The organization recovers its members from last-good instead of seeding over them.
    const orgDir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-recovery-org-'));
    try{
      const first=createOrg({dataDir:orgDir});first.seedFromMembers();
      createOrg({dataDir:orgDir}); // snapshots the valid org
      fs.writeFileSync(path.join(orgDir,'org.json'),'{broken');
      const recovered=createOrg({dataDir:orgDir});
      assert.equal(recovered.roster().length,13,'members return from last-good');
      assert.equal(recovered.recovery().recovered,true);
      assert.ok(fs.readdirSync(orgDir).some(name=>name.startsWith('org.json.corrupt-')),'the corrupt org is archived');
    }finally{fs.rmSync(orgDir,{recursive:true,force:true});}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  // 4. Every state file corrupt at once: the server boots in a reported degraded state.
  const bad=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-recovery-boot-'));
  const key=Buffer.alloc(32,12).toString('base64');
  for(const name of ['workspace.json','org.json','rooms.json','settings.json','credentials.json'])fs.writeFileSync(path.join(bad,name),'{broken');
  fs.writeFileSync(path.join(bad,'settings.key'),key,{mode:0o600});
  const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:bad,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:key},stdio:['ignore','pipe','ignore']});
  try{
    await new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exited '+code)));});
    const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;
    const headers={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
    const org=await (await fetch(origin+'/api/org',{headers})).json();
    assert.deepEqual(org.members,[],'a corrupt org starts empty, not reseeded');
    const rooms=await (await fetch(origin+'/api/rooms')).json();
    assert.deepEqual(rooms,[],'a corrupt room list starts empty');
    const settings=await (await fetch(origin+'/api/settings')).json();
    assert.equal(settings.broken,true,'broken settings block saving until repaired');
    const tasks=await (await fetch(origin+'/api/tasks')).json();
    assert.deepEqual(tasks,[],'a corrupt workspace starts empty');
    const unlock=await fetch(origin+'/api/org/unlock',{method:'POST',headers,body:JSON.stringify({pin:'2468'})});
    const token=(await unlock.json()).token;assert.ok(token,'the owner can still set a new PIN');
    const infoResponse=await fetch(origin+'/api/workspace/info',{headers:{...headers,'x-kantor-org':token}});
    const info=await infoResponse.json();
    assert.ok(info.recovery.length>=5,'every degraded file is reported');
    assert.ok(info.recovery.every(entry=>entry.degraded||entry.recovered));
    assert.equal((await fetch(origin+'/api/workspace/info')).status,403,'diagnostics stay owner-only');
    for(const name of ['workspace.json','org.json','rooms.json','settings.json','credentials.json'])assert.ok(fs.readdirSync(bad).some(file=>file.startsWith(name+'.corrupt-')),`${name} is archived`);
    console.log('PASS: state files recover from last-good, or start degraded and reported without blocking startup');
  }finally{server.kill();fs.rmSync(bad,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
