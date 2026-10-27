// Exporting a verified revision to a folder the owner chose: safe targets only, nothing overwritten without consent.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProjectWorkspace}=require('../server/project-workspace');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-export-')),data=path.join(tmp,'data'),ws=createProjectWorkspace({dataDir:data});
const p=ws.createProject({taskId:'t',environment:'docker'});
const rev=ws.writeRevision(p.id,{runtime:'static-web',files:[{path:'index.html',content:'<h1>Kalkulator</h1>'},{path:'src/calc.js',content:'export const add=(a,b)=>a+b;'}],commands:{test:{executable:'node',args:['test.js']}}});
const code=fn=>{try{fn();return null;}catch(e){return e.code;}};
// 1) Fresh folder: every file written with its exact content, plus nothing else.
const target=path.join(tmp,'Calculator');
const out=ws.exportRevision(p.id,rev.id,target);
assert.equal(fs.readFileSync(path.join(target,'index.html'),'utf8'),'<h1>Kalkulator</h1>');
assert.equal(fs.readFileSync(path.join(target,'src','calc.js'),'utf8'),'export const add=(a,b)=>a+b;');
assert.deepEqual(out.files.sort(),['index.html','src/calc.js']);assert.equal(out.target,target);
// Exported files are ordinary writable files for the owner (not the read-only revision copies).
fs.writeFileSync(path.join(target,'index.html'),'edited');
// 2) An existing non-empty folder is refused unless the owner confirms overwrite; then files are replaced.
assert.equal(code(()=>ws.exportRevision(p.id,rev.id,target)),'EXPORT_NOT_EMPTY');
assert.equal(fs.readFileSync(path.join(target,'index.html'),'utf8'),'edited','nothing touched without consent');
ws.exportRevision(p.id,rev.id,target,{overwrite:true});assert.equal(fs.readFileSync(path.join(target,'index.html'),'utf8'),'<h1>Kalkulator</h1>');
// 3) Unsafe targets: relative, inside Kantor Kita data, a file, a link.
assert.equal(code(()=>ws.exportRevision(p.id,rev.id,'relative/dir')),'EXPORT_PATH');
assert.equal(code(()=>ws.exportRevision(p.id,rev.id,path.join(data,'projects','x'))),'EXPORT_PATH');
assert.equal(code(()=>ws.exportRevision(p.id,rev.id,data)),'EXPORT_PATH');
fs.writeFileSync(path.join(tmp,'afile'),'x');assert.equal(code(()=>ws.exportRevision(p.id,rev.id,path.join(tmp,'afile'))),'EXPORT_PATH');
const real=path.join(tmp,'real');fs.mkdirSync(real);let linked=null;try{fs.symlinkSync(real,path.join(tmp,'link'),'junction');linked=path.join(tmp,'link');}catch{}
if(linked)assert.equal(code(()=>ws.exportRevision(p.id,rev.id,linked)),'EXPORT_PATH','a junction/symlink target is refused');
// 4) A revision whose source changed since it was saved is never exported.
const src=path.join(ws.sourceDir(p.id,rev.id),'index.html');fs.chmodSync(src,0o644);fs.writeFileSync(src,'tampered');
assert.equal(code(()=>ws.exportRevision(p.id,rev.id,path.join(tmp,'second'))),'SOURCE_CHANGED');assert.equal(fs.existsSync(path.join(tmp,'second','index.html')),false);
// 5) HTTP route: owner unlock required; export lands in the chosen folder.
(async()=>{const {spawn}=require('node:child_process'),PORT=Number(process.env.TEST_PORT||43591),origin=`http://127.0.0.1:${PORT}`;
 const fresh=ws.writeRevision(p.id,{runtime:'static-web',files:[{path:'index.html',content:'<h1>Route</h1>'}],commands:{test:{executable:'node',args:['t.js']}}});
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:data,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','inherit']});
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,u,b)=>{const r=await fetch(origin+u,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const dest=path.join(tmp,'ViaRoute'),url=`/api/projects/${p.id}/revisions/${fresh.id}/export`;
  assert.equal((await call('POST',url,{target:dest})).status,403,'locked owner cannot export');
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const ok=await call('POST',url,{target:dest});assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal(fs.readFileSync(path.join(dest,'index.html'),'utf8'),'<h1>Route</h1>');
  const again=await call('POST',url,{target:dest});assert.equal(again.status,409);assert.equal(again.body.code,'EXPORT_NOT_EMPTY');
  assert.equal((await call('POST',url,{target:'relative'})).status,422);
 }finally{child.kill();}
 fs.rmSync(tmp,{recursive:true,force:true});
 console.log(`PASS: verified export to an owner-chosen folder, overwrite only with consent, unsafe targets refused${linked?'':' (link case skipped: no junction support)'}`);
})().catch(e=>{console.error(e);process.exitCode=1;});
