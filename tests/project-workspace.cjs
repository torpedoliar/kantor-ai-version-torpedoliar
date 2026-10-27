// Project revisions: model-proposed files land only inside DATA_DIR/projects/<id>/revisions/<rev>/src, are immutable,
// hashed, and published all-or-nothing. Fixtures are trusted test files, never model output.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createProjectWorkspace,validateBundle}=require('../server/project-workspace');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-projects-'));
const base={runtime:'static-web',files:[{path:'index.html',content:'<h1>Kalkulator</h1>'},{path:'src/app.js',content:'export const add=(a,b)=>a+b;'},{path:'test/app.test.js',content:'import assert from "node:assert";'}],
  commands:{build:{executable:'node',args:['--version']},test:{executable:'node',args:['--test','test']},start:{executable:'node',args:['server.js']}},acceptanceTests:['2+2=4'],knownLimitations:[]};
// Server routes: metadata and file download are owner-only and read only validated revisions.
async function routes(ws,project,rev){
  const {spawn}=require('node:child_process'),PORT=Number(process.env.TEST_PORT||43581),origin=`http://127.0.0.1:${PORT}`;
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','inherit']});
  try{
    await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf,h={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
    const meta=`/api/projects/${project.id}/revisions/${rev.id}`;
    assert.equal((await fetch(origin+meta)).status,403,'owner only');
    h['x-kantor-org']=(await (await fetch(origin+'/api/org/unlock',{method:'POST',headers:h,body:JSON.stringify({pin:'2468'})})).json()).token;
    const body=await (await fetch(origin+meta,{headers:h})).json();assert.equal(body.sourceHash,ws.manifest(project.id,rev.id).sourceHash);assert.equal(body.files.length,4);
    const file=await fetch(origin+`${meta}/files/src/app.js`,{headers:h});assert.equal(file.status,200);
    assert.match(file.headers.get('content-disposition')||'',/attachment/);assert.equal(file.headers.get('content-type'),'text/plain; charset=utf-8','served as text, never executed by the app origin');
    assert.equal(await file.text(),'export const add=(a,b)=>a+b;');
    assert.equal((await fetch(origin+`${meta}/files/..%2Fmanifest.json`,{headers:h})).status,422);
    assert.equal((await fetch(origin+`/api/projects/${project.id}/revisions/planted`,{headers:h})).status,422);
  }finally{child.kill();}
}
const bad=(files,pattern,label)=>assert.throws(()=>validateBundle({...base,files}),pattern,label);
(async()=>{try{
  // Path rules.
  for(const p of ['../x.js','src/../../x.js','C:/Windows/x.js','C:x.js','\\\\server\\share\\x.js','//server/share/x.js','/etc/passwd','src/%2e%2e/x.js','a\u0000b.js','src\\..\\x.js','.env','src/.env.local','node_modules/x/index.js','CON.js','src/aux.txt'])
    bad([{path:p,content:'x'}],/path/i,`rejects ${JSON.stringify(p)}`);
  bad([{path:'src/App.js',content:'a'},{path:'src/app.js',content:'b'}],/duplikat|duplicate/i,'case-insensitive duplicate');
  bad([{path:'a/b.js',content:'a'},{path:'a/./b.js',content:'b'}],/duplikat|duplicate|path/i,'canonical duplicate');
  bad(Array.from({length:201},(_,i)=>({path:`f${i}.js`,content:''})),/200/,'file count');
  bad([{path:'big.js',content:'x'.repeat(1024*1024+1)}],/1 ?MB/i,'single file size');
  bad(Array.from({length:11},(_,i)=>({path:`f${i}.js`,content:'x'.repeat(1000*1000)})),/10 ?MB/i,'revision size');
  assert.throws(()=>validateBundle({...base,runtime:'python'}),/runtime/i,'unsupported runtime');
  assert.throws(()=>validateBundle({...base,commands:{...base.commands,test:{executable:'cmd.exe',args:['/c','del']}}}),/executable|perintah/i,'only node');
  assert.throws(()=>validateBundle({...base,commands:{...base.commands,build:{executable:'node',args:['C:\\secret\\x.js']}}}),/path|absolut/i,'no host paths in args');
  assert.throws(()=>validateBundle({...base,files:[...base.files,{path:'Dockerfile',content:'FROM x'}]}),/Dockerfile/i,'no model Dockerfile');
  // Nested paths succeed; ids are server-assigned; hashes are stable and content-addressed.
  const ws=createProjectWorkspace({dataDir:dir}),project=ws.createProject({taskId:'t1',environment:'docker'});
  assert.match(project.id,/^[0-9a-f-]{36}$/);
  const rev=ws.writeRevision(project.id,{...base,files:[...base.files,{path:'deep/a/b/c.js',content:'1'}]});
  assert.match(rev.id,/^[0-9a-f-]{36}$/);const manifest=ws.manifest(project.id,rev.id);
  assert.equal(manifest.files.length,4);assert.ok(manifest.files.every(f=>/^[0-9a-f]{64}$/.test(f.sha256)));
  const again=ws.writeRevision(project.id,{...base,files:[{path:'deep/a/b/c.js',content:'1'},...[...base.files].reverse()]});
  assert.equal(ws.manifest(project.id,again.id).sourceHash,manifest.sourceHash,'source hash ignores file order');
  assert.notEqual(again.id,rev.id,'every revision gets its own id');
  // Retention keeps the newest revisions and removes only job folders past their age.
  const kept=ws.createProject({taskId:'retention',environment:'docker'}),keptRoot=path.join(dir,'projects',kept.id,'revisions');
  for(let i=0;i<25;i++){const id=crypto.randomUUID(),target=path.join(keptRoot,id);fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({id,createdAt:new Date(Date.now()-(25-i)*60000).toISOString()}));}
  const jobRoot=path.join(dir,'projects',kept.id,'jobs'),oldJob=path.join(jobRoot,crypto.randomUUID()),newJob=path.join(jobRoot,crypto.randomUUID());
  fs.mkdirSync(jobRoot,{recursive:true});fs.mkdirSync(oldJob);fs.mkdirSync(newJob);
  const oldTime=new Date(Date.now()-40*24*60*60*1000);fs.utimesSync(oldJob,oldTime,oldTime);
  const pruned=ws.prune({keepRevisions:20,jobMaxAgeDays:30});
  assert.equal(pruned.revisions,5);assert.equal(pruned.jobs,1);
  assert.equal(fs.readdirSync(keptRoot).filter(name=>/^[0-9a-f-]{36}$/.test(name)).length,20,'the newest twenty revisions stay');
  assert.ok(fs.existsSync(newJob));assert.ok(!fs.existsSync(oldJob),'only the old job folder is removed');
  assert.equal(ws.readFile(project.id,rev.id,'src/app.js'),'export const add=(a,b)=>a+b;');
  assert.throws(()=>ws.readFile(project.id,rev.id,'../manifest.json'),/path/i);
  const root=path.join(dir,'projects',project.id,'revisions',rev.id,'src');
  assert.equal(fs.readFileSync(path.join(root,'deep','a','b','c.js'),'utf8'),'1');
  assert.equal(crypto.createHash('sha256').update('1').digest('hex'),manifest.files.find(f=>f.path==='deep/a/b/c.js').sha256);
  // Immutable: published revisions are read-only and cannot be rewritten through the API.
  assert.throws(()=>ws.writeRevision(project.id,base,{revisionId:rev.id}),/immutable|sudah ada/i);
  assert.throws(()=>ws.writeRevision('../../x',base),/project/i,'unknown/unsafe project id');
  // Link ancestors are refused: a junction (Windows) or symlink (POSIX) planted inside the project tree.
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-outside-'));
  const linkParent=path.join(dir,'projects',project.id,'revisions');const planted=path.join(linkParent,'planted');
  fs.symlinkSync(outside,planted,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>ws.readFile(project.id,'planted','x.js'),/revision|link|path/i,'link revision is not readable');
  assert.throws(()=>ws.manifest(project.id,'planted'),/revision|link/i);
  const projLink=path.join(dir,'projects','00000000-0000-4000-8000-000000000000');fs.symlinkSync(outside,projLink,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>ws.writeRevision('00000000-0000-4000-8000-000000000000',base),/link|project/i,'project root that is a link is refused');
  assert.deepEqual(fs.readdirSync(outside),[],'nothing was written through a link');
  // A failed write never publishes a partial revision.
  const failing=createProjectWorkspace({dataDir:dir,writeFile:(file,data)=>{if(file.endsWith('app.js'))throw Object.assign(new Error('disk full'),{code:'ENOSPC'});fs.writeFileSync(file,data);}});
  const before=fs.readdirSync(linkParent).length;
  assert.throws(()=>failing.writeRevision(project.id,base),/disk full/);
  assert.equal(fs.readdirSync(linkParent).length,before,'no partial revision directory is left');
  assert.equal(fs.readdirSync(path.join(dir,'projects',project.id)).filter(n=>n.startsWith('.staging')).length,0,'staging cleaned');
  let renameAttempts=0;
  const transient=createProjectWorkspace({dataDir:dir,rename:(from,to)=>{if(++renameAttempts<3)throw Object.assign(Error('sharing lock'),{code:'EPERM'});fs.renameSync(from,to);}});
  const recovered=transient.writeRevision(project.id,base);assert.ok(recovered.id);assert.ok(renameAttempts>=3&&renameAttempts<=5,'transient Windows rename locks get a bounded retry');
  // Download: individual files + manifest, no archive claimed.
  const listing=ws.exportSource(project.id,rev.id);assert.equal(listing.format,'files');assert.equal(listing.files.length,4);assert.ok(!('zip' in listing));
  fs.rmSync(outside,{recursive:true,force:true});
  await routes(ws,project,rev);
  const sourceFile=path.join(root,'src','app.js');fs.chmodSync(sourceFile,0o644);fs.writeFileSync(sourceFile,'modified after approval');
  assert.throws(()=>ws.verifyRevision(project.id,rev.id),/hash|berubah/i,'source changes invalidate approval');
  console.log('PASS: path rules, size/count limits, node-only commands, stable hashes, immutable revisions, link refusal, atomic publish, file export');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
