// Backup/restore covers the whole data directory with checksums, doctor reports broken state,
// and the owner-only import replaces the workspace only when asked.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {createTaskStore}=require('../server/task-store');
const root=path.join(__dirname,'..'),PORT=Number(process.env.TEST_PORT||43642),origin=`http://127.0.0.1:${PORT}`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-backup-')),key=Buffer.alloc(32,11).toString('base64');
const run=(script,args)=>new Promise(resolve=>{const child=spawn(process.execPath,[path.join(root,'scripts',script),...args],{cwd:root});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',code=>resolve({code,out,err}));});
function seedData(target){
  fs.mkdirSync(path.join(target,'projects','demo'),{recursive:true});fs.mkdirSync(path.join(target,'archive'),{recursive:true});
  const store=createTaskStore({dataDir:target});
  store.transaction(undefined,draft=>{draft.tasks.push({id:'t1',title:'Tugas lama',assignee:'Koh Wira',division:'engineering',status:'queued',brief:'Simpan ini',result:'',messages:[],version:0,createdAt:new Date().toISOString()});draft.threads.push({id:'t1',taskId:'t1',title:'Tugas lama'});});
  fs.writeFileSync(path.join(target,'org.json'),JSON.stringify(require('../server/org').seed(),null,2));
  fs.writeFileSync(path.join(target,'rooms.json'),JSON.stringify(require('../server/rooms').SEED,null,2));
  fs.writeFileSync(path.join(target,'settings.json'),JSON.stringify({schemaVersion:1,providers:[],defaultRoute:null,fallbackRoute:null,overrides:{},concurrency:3,maxTokens:null},null,2));
  fs.writeFileSync(path.join(target,'credentials.json'),'{}');
  fs.writeFileSync(path.join(target,'settings.key'),key+'\n',{mode:0o600});
  fs.writeFileSync(path.join(target,'projects','demo','project.json'),JSON.stringify({id:'demo',taskId:'t1',environment:'docker'}));
  fs.writeFileSync(path.join(target,'archive','tasks-1.json'),'[]');
}
(async()=>{try{
  seedData(dir);
  // 1. Backup writes a manifest with a hash for every file, including the encryption key.
  const backup=await run('backup-data.mjs',['--data',dir]);
  assert.equal(backup.code,0,backup.err);
  const backupDir=fs.readdirSync(path.join(dir,'backups')).map(name=>path.join(dir,'backups',name)).find(p=>fs.statSync(p).isDirectory());
  const manifest=JSON.parse(fs.readFileSync(path.join(backupDir,'manifest.json'),'utf8'));
  for(const name of ['workspace.json','org.json','rooms.json','settings.json','credentials.json','settings.key','projects/demo/project.json','archive/tasks-1.json']){
    const entry=manifest.files.find(file=>file.path===name);
    assert.ok(entry,`${name} is in the backup`);
    assert.match(entry.sha256,/^[0-9a-f]{64}$/);
  }
  assert.ok(typeof manifest.files.find(file=>file.path==='settings.key').mode==='string','the manifest records the key file mode');
  if(process.platform!=='win32')assert.equal(manifest.files.find(file=>file.path==='settings.key').mode,'600','the encryption key keeps its private mode');
  // 2. Doctor is clean, then names a corrupt state file.
  const clean=await run('doctor.mjs',['--data',dir]);
  assert.equal(clean.code,0,clean.out+clean.err);assert.match(clean.out,/OK: semua file state utama/);
  fs.writeFileSync(path.join(dir,'rooms.json'),'not json');
  const broken=await run('doctor.mjs',['--data',dir]);
  assert.equal(broken.code,1);assert.match(broken.out,/ERROR rooms\.json/);
  // 3. Restore verifies first, snapshots the current data, then puts the backup back.
  fs.writeFileSync(path.join(dir,'org.json'),JSON.stringify({...require('../server/org').seed(),company:{name:'Diubah',type:'Lainnya',description:''}},null,2));
  const restored=await run('restore-data.mjs',['--backup',backupDir,'--data',dir,'--yes']);
  assert.equal(restored.code,0,restored.err);
  const org=JSON.parse(fs.readFileSync(path.join(dir,'org.json'),'utf8'));
  assert.equal(org.company.name,'Kantor Kita','the backup replaces the edited org');
  assert.equal(fs.readFileSync(path.join(dir,'rooms.json'),'utf8'),JSON.stringify(require('../server/rooms').SEED,null,2),'corrupt rooms are restored');
  assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(name=>name.startsWith('pre-restore-')).length,1,'a pre-restore snapshot is always written');
  // 4. A tampered backup is refused before anything is overwritten.
  const other=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-restore-target-'));seedData(other);
  fs.writeFileSync(path.join(other,'org.json'),JSON.stringify({...require('../server/org').seed(),company:{name:'Tetap',type:'Lainnya',description:''}},null,2));
  const tampered=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-tampered-'));
  fs.cpSync(backupDir,tampered,{recursive:true});
  const tamperFile=path.join(tampered,'org.json'),tamperBytes=fs.readFileSync(tamperFile);
  tamperBytes[Math.floor(tamperBytes.length/2)]^=1;fs.writeFileSync(tamperFile,tamperBytes);
  const refused=await run('restore-data.mjs',['--backup',tampered,'--data',other,'--yes']);
  assert.equal(refused.code,1);assert.match(refused.err,/checksum tidak cocok/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(other,'org.json'),'utf8')).company.name,'Tetap','a bad backup changes nothing');
  // 5. Owner-only import: refuse a populated workspace unless replace is explicit, archive first, then load.
  const server=spawn(process.execPath,[path.join(root,'server','server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:key},stdio:['ignore','pipe','inherit']});
  try{
    await new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
    const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token;
    const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
    token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
    assert.equal((await call('GET','/api/workspace/info')).status,200);
    const info=(await call('GET','/api/workspace/info')).body;
    assert.ok(info.ok);assert.ok(info.counts.tasks>=1);assert.ok(info.backups.length>=1);
    const exported=(await call('GET','/api/workspace/export')).body;
    await call('POST','/api/tasks',{title:'Tambahan setelah export',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'direct',brief:'Harus hilang setelah import.'});
    const refusedImport=await call('POST','/api/workspace/import',{workspace:exported,replace:false});
    assert.equal(refusedImport.status,409);assert.equal(refusedImport.body.code,'WORKSPACE_NOT_EMPTY');
    const imported=await call('POST','/api/workspace/import',{workspace:exported,replace:true});
    assert.equal(imported.status,200,JSON.stringify(imported.body));
    const tasks=(await call('GET','/api/tasks')).body;
    assert.deepEqual(tasks.map(task=>task.title),['Tugas lama'],'the imported workspace replaces the newer task');
    const events=(await call('GET','/api/task-events?after=0')).body.events||[];
    assert.ok(events.some(event=>event.type==='workspace.imported'),'the import is in the audit trail');
    assert.ok(imported.body.workspaceArchiveName&&(await call('GET',`/api/workspace/archive/${imported.body.workspaceArchiveName}`)).status===200,'the pre-import workspace is archived');
    token='';const denied=await call('GET','/api/workspace/info');assert.equal(denied.status,403,'diagnostics stay owner-only');
    console.log('PASS: checksum backup, clean doctor, guarded restore with pre-snapshot, and owner-only workspace import');
  }finally{server.kill();}
  fs.rmSync(other,{recursive:true,force:true});fs.rmSync(tampered,{recursive:true,force:true});
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
