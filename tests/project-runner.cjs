// Windows local runner: nothing runs without an owner approval tied to the exact revision and command manifest.
// Commands are argv (no shell), env is a minimal allowlist, timeouts/cancel kill the whole process tree, restarts never rerun.
// Every fixture below is a trusted file written by this test, never model output.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {createProjectWorkspace}=require('../server/project-workspace');
const PORT=Number(process.env.TEST_PORT||43591),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-runner-'));
const META='a;b&&echo pwned|x "$(whoami)" %PATH%';
const probe=`console.log(JSON.stringify({argv:process.argv.slice(2),sentinel:process.env.KANTOR_SENTINEL||null,apiKey:process.env.ANTHROPIC_API_KEY??null,cwd:process.cwd(),keys:Object.keys(process.env).sort()}));`;
const slow=`const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(path.join(process.env.TEMP,'grandchild.pid'),String(g.pid));setInterval(()=>{},1000);`;
const bundle=(test,extra=[])=>({runtime:'node-web',files:[{path:'index.html',content:'<h1>x</h1>'},...extra],commands:{test}});
const ws=createProjectWorkspace({dataDir:dir}),project=ws.createProject({taskId:'none',environment:'windows'});
const ok=ws.writeRevision(project.id,bundle({executable:'node',args:['probe.js',META]},[{path:'probe.js',content:probe}]));
const bad=ws.writeRevision(project.id,bundle({executable:'node',args:['fail.js']},[{path:'fail.js',content:'console.error("kalkulator salah: 2+2=5");process.exit(1);'}]));
const hang=ws.writeRevision(project.id,bundle({executable:'node',args:['slow.js']},[{path:'slow.js',content:slow}]));
const noisy=ws.writeRevision(project.id,bundle({executable:'node',args:['noisy.js']},[{path:'noisy.js',content:"process.stdout.write('x'.repeat(20000));"}]));
const manifest=rev=>ws.manifest(project.id,rev.id);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const wait=async(fn,label,ms=20000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
function start(){const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SENTINEL:'leak-123',RUNNER_TIMEOUT_MS:'10000'},stdio:['ignore','pipe','inherit']});
  return new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r(child));child.on('exit',c=>j(Error('exit '+c)));});}
(async()=>{let server=await start();try{
  if(process.platform!=='win32'){console.log('SKIP: Windows runner tests need a Windows host');return;}
  let csrf=(await (await fetch(origin+'/api/session')).json()).csrf,token='';
  const call=async(method,p,body,extra={})=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{}),...extra},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const envs=(await call('GET','/api/execution/environments')).body;
  assert.equal(envs.windows.available,true);assert.match(envs.windows.warning,/bukan sandbox/i);assert.match(envs.windows.warning,/jaringan mengikuti OS/i);
  assert.equal(typeof envs.docker.available,'boolean');
  assert.equal((await call('POST',`/api/projects/${project.id}/run`,{revisionId:ok.id})).status,403,'owner only');
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  // No approval → refused before anything spawns.
  const none=await call('POST',`/api/projects/${project.id}/run`,{revisionId:ok.id});assert.equal(none.status,403);assert.equal(none.body.code,'APPROVAL_REQUIRED');
  const approve=(rev,extra={})=>call('POST',`/api/projects/${project.id}/approve`,{revisionId:rev.id,manifestHash:manifest(rev).manifestHash,environment:'windows',networkAllowed:false,acknowledgeHostAccess:true,...extra});
  assert.equal((await approve(ok,{manifestHash:'0'.repeat(64)})).status,409,'stale manifest hash');
  assert.equal((await approve(ok,{acknowledgeHostAccess:false})).body.code,'HOST_ACCESS_ACK_REQUIRED');
  assert.equal((await approve(ok,{environment:'docker'})).body.code,'ENVIRONMENT_MISMATCH','switching environment is a separate owner decision');
  const okApproval=(await approve(ok)).body;assert.equal(okApproval.manifestHash,manifest(ok).manifestHash);assert.equal(okApproval.environment,'windows');
  // An approval belongs to one revision.
  assert.equal((await call('POST',`/api/projects/${project.id}/run`,{revisionId:bad.id,approvalId:okApproval.id})).body.code,'APPROVAL_REQUIRED');
  // Duplicate run requests (same idempotency key) give the same job.
  const runOk=()=>call('POST',`/api/projects/${project.id}/run`,{revisionId:ok.id,approvalId:okApproval.id},{'x-kantor-request':'run-ok-1'});
  const first=(await runOk()).body,second=(await runOk()).body;assert.equal(first.id,second.id);
  const done=await wait(async()=>{const j=(await call('GET',`/api/jobs/${first.id}`)).body;return ['passed','failed','timed_out','cancelled'].includes(j.status)&&j;},'ok job');
  assert.equal(done.status,'passed',JSON.stringify(done.evidence));const ev=done.evidence.find(e=>e.phase==='test');assert.equal(ev.exitCode,0);
  assert.deepEqual(ev.argv.slice(1),['probe.js',META]);
  const seen=JSON.parse(ev.stdout);
  assert.deepEqual(seen.argv,[META],'metacharacters reach the program as one literal argument');
  assert.equal(seen.sentinel,null,'server env is not inherited');assert.equal(seen.apiKey,null);
  // Evidence in the workspace is an excerpt; the full log is a file under the job folder.
  assert.match(ev.logs.stdout,/^logs\/test\.stdout\.log$/);assert.ok(ev.stdoutBytes>0);
  const logResponse=await fetch(`${origin}/api/jobs/${first.id}/logs/test/stdout`,{headers:{'x-kantor-org':token}});
  assert.equal(logResponse.status,200);assert.match(await logResponse.text(),/"argv"/);
  assert.equal((await fetch(`${origin}/api/jobs/${first.id}/logs/test/stdout`)).status,403,'logs are owner-only');
  assert.ok(seen.cwd.startsWith(path.join(fs.realpathSync(dir),'projects',project.id,'jobs'))||seen.cwd.toLowerCase().startsWith(path.join(dir,'projects',project.id,'jobs').toLowerCase()),'runs in the job folder, not the revision');
  // Windows adds its own session variables (USERNAME, USERPROFILE, …) to every process; what matters is that none of the
  // server's variables leak. This test process has dozens; the child must only see the allowlist plus those OS additions.
  const osAdded=new Set(['HOMEDRIVE','HOMEPATH','LOGONSERVER','USERDOMAIN','USERDOMAIN_ROAMINGPROFILE','USERNAME','USERPROFILE','APPDATA','LOCALAPPDATA','ALLUSERSPROFILE','PUBLIC','ProgramData','COMPUTERNAME']);
  const allowed=new Set(['SystemRoot','SystemDrive','WINDIR','ComSpec','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PATH','TEMP','TMP','NODE_ENV',...osAdded]);
  assert.deepEqual(seen.keys.filter(k=>!allowed.has(k)),[],'no server environment variables reach the child');
  assert.equal(done.revisionId,ok.id);assert.equal(done.manifestHash,manifest(ok).manifestHash);
  // A failing command is a failed job with its exit code and stderr.
  const badApproval=(await approve(bad)).body;const failed=(await call('POST',`/api/projects/${project.id}/run`,{revisionId:bad.id,approvalId:badApproval.id})).body;
  const failedDone=await wait(async()=>{const j=(await call('GET',`/api/jobs/${failed.id}`)).body;return j.status!=='queued'&&j.status!=='running'&&j;},'failed job');
  assert.equal(failedDone.status,'failed');assert.equal(failedDone.evidence[0].exitCode,1);assert.match(failedDone.evidence[0].stderr,/2\+2=5/);
  // A long log is clipped in the workspace but kept whole on disk.
  const noisyApproval=(await approve(noisy)).body;
  const noisyJob=(await call('POST',`/api/projects/${project.id}/run`,{revisionId:noisy.id,approvalId:noisyApproval.id})).body;
  const noisyDone=await wait(async()=>{const j=(await call('GET',`/api/jobs/${noisyJob.id}`)).body;return ['passed','failed','timed_out','cancelled'].includes(j.status)&&j;},'noisy job');
  assert.equal(noisyDone.status,'passed');
  const noisyEvidence=noisyDone.evidence[0];
  assert.equal(noisyEvidence.stdout.length,16384,'the workspace keeps a 16 KB excerpt');
  assert.ok(noisyEvidence.stdoutBytes>=20000);assert.equal(noisyEvidence.stdoutTruncated,true);
  const fullLog=await (await fetch(`${origin}/api/jobs/${noisyJob.id}/logs/test/stdout`,{headers:{'x-kantor-org':token}})).text();
  assert.ok(fullLog.length>=20000,'the full log stays on disk');
  assert.match(fullLog,/^x+$/,'the log is the raw captured stream');
  // Cancel and timeout kill the whole tree, grandchild included.
  const hangApproval=(await approve(hang)).body;
  const grandchild=async job=>Number(await wait(()=>{try{return fs.readFileSync(path.join(dir,'projects',project.id,'jobs',job.id,'tmp','grandchild.pid'),'utf8');}catch{return null;}},'grandchild pid'));
  const cancelJob=(await call('POST',`/api/projects/${project.id}/run`,{revisionId:hang.id,approvalId:hangApproval.id})).body;
  const g1=await grandchild(cancelJob);assert.ok(alive(g1));
  const orgBeforeReset=(await call('GET','/api/org')).body;
  const activeReset=await call('POST','/api/org/reset',{confirmation:'RESET',version:orgBeforeReset.version});assert.equal(activeReset.status,409);assert.equal(activeReset.body.code,'JOB_ACTIVE','active jobs block reset even without an active task');
  assert.equal((await call('POST',`/api/jobs/${cancelJob.id}/cancel`,{})).status,200);
  await wait(async()=>(await call('GET',`/api/jobs/${cancelJob.id}`)).body.status==='cancelled','cancelled');await wait(()=>!alive(g1),'grandchild killed on cancel',5000);
  const slowJob=(await call('POST',`/api/projects/${project.id}/run`,{revisionId:hang.id,approvalId:hangApproval.id})).body;const g2=await grandchild(slowJob);
  await wait(async()=>(await call('GET',`/api/jobs/${slowJob.id}`)).body.status==='timed_out','timed out');await wait(()=>!alive(g2),'grandchild killed on timeout',5000);
  // Restart while running: the job becomes interrupted and is never rerun automatically.
  const crashJob=(await call('POST',`/api/projects/${project.id}/run`,{revisionId:hang.id,approvalId:hangApproval.id})).body;const g3=await grandchild(crashJob);
  server.kill();await new Promise(r=>server.once('exit',r));try{process.kill(g3);}catch{}
  server=await start();csrf=(await (await fetch(origin+'/api/session')).json()).csrf;token='';token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const afterRes=await call('GET',`/api/jobs/${crashJob.id}`);const after=afterRes.body;assert.equal(after?.status,'interrupted',JSON.stringify(afterRes));
  await new Promise(r=>setTimeout(r,1500));
  const events=(await call('GET','/api/task-events?after=0')).body.events.filter(e=>e.data?.jobId===crashJob.id&&e.type==='command.started');
  assert.equal(events.length,1,'no automatic rerun after restart');
  console.log('PASS: approval tied to revision+manifest+environment, argv not shell, minimal env, idempotent run, failure evidence, cancel/timeout kill tree, restart → interrupted');
}finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
