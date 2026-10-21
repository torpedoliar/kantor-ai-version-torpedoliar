// Docker adapter: exact argv to the Docker CLI (captured by a fake CLI), hardened container flags, owned labels,
// and no fallback to the host when Docker is unavailable. No real daemon is used here.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {dockerAdapter}=require('../server/project-runner');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kantor docker spaces '));
const log=path.join(tmp,'calls.jsonl');
// Fake docker: records argv; `info` succeeds unless FAKE_DOCKER_DOWN is set; `run` prints and exits with FAKE_EXIT.
const fake=path.join(tmp,'fake-docker.js');
fs.writeFileSync(fake,`const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');
const [cmd]=process.argv.slice(2);
if(cmd==='info'){if(process.env.FAKE_DOCKER_DOWN){console.error('Cannot connect to the Docker daemon');process.exit(1);}console.log('{"ServerVersion":"29.8.0"}');process.exit(0);}
if(cmd==='image'){if(process.env.FAKE_NO_IMAGE){console.error('No such image');process.exit(1);}console.log('[{"Id":"sha256:${'a'.repeat(64)}","RepoDigests":["node@sha256:${'b'.repeat(64)}"]}]');process.exit(0);}
if(cmd==='run'){console.log('hello from container');process.exit(Number(process.env.FAKE_EXIT||0));}
process.exit(0);`);
const calls=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const work=path.join(tmp,'job one','work'),out=path.join(tmp,'job one','tmp');fs.mkdirSync(work,{recursive:true});fs.mkdirSync(out,{recursive:true});
const manifest={commands:{build:{executable:'node',args:['build.js']},test:{executable:'node',args:['--test','test dir/a.test.js','a;b&&c']}},files:[]};
// Through the server: a docker project runs in a container; if the daemon goes down after approval the job is
// environment_unavailable and nothing runs on the host.
async function serverFlow(){
  const {spawn}=require('node:child_process'),{createProjectWorkspace}=require('../server/project-workspace');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-docker-server-')),PORT=43597,origin=`http://127.0.0.1:${PORT}`;
  const ws=createProjectWorkspace({dataDir}),project=ws.createProject({taskId:'none',environment:'docker'});
  const marker=path.join(tmp,'host-ran.txt');
  const rev=ws.writeRevision(project.id,{runtime:'node-web',files:[{path:'t.js',content:`require('node:fs').writeFileSync(${JSON.stringify(marker)},'host')`}],commands:{test:{executable:'node',args:['t.js']}}});
  const downFlag=path.join(tmp,'down');
  const toggling=path.join(tmp,'toggle-docker.js');fs.writeFileSync(toggling,`if(require('node:fs').existsSync(${JSON.stringify(downFlag)}))process.env.FAKE_DOCKER_DOWN='1';require(${JSON.stringify(fake)});`);
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dataDir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_DOCKER_CLI:JSON.stringify([process.execPath,toggling])},stdio:['ignore','pipe','inherit']});
  try{
    await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
    const csrf=(await (await fetch(origin+'/api/session')).json()).csrf,h={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
    h['x-kantor-org']=(await (await fetch(origin+'/api/org/unlock',{method:'POST',headers:h,body:JSON.stringify({pin:'2468'})})).json()).token;
    const post=(p,b)=>fetch(origin+p,{method:'POST',headers:h,body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
    const envs=await (await fetch(origin+'/api/execution/environments',{headers:h})).json();assert.equal(envs.docker.available,true);
    const approval=(await post(`/api/projects/${project.id}/approve`,{revisionId:rev.id,manifestHash:ws.manifest(project.id,rev.id).manifestHash,environment:'docker',networkAllowed:false})).body;
    assert.match(approval.imageDigest,/sha256/,'approval records the image digest');
    const job=async()=>{const j=(await post(`/api/projects/${project.id}/run`,{revisionId:rev.id,approvalId:approval.id})).body;for(let i=0;i<100;i++){const s=await (await fetch(origin+`/api/jobs/${j.id}`,{headers:h})).json();if(!['queued','running'].includes(s.status))return s;await new Promise(r=>setTimeout(r,100));}throw Error('job timeout');};
    const ran=await job();assert.equal(ran.status,'passed');assert.equal(ran.evidence[0].environment,'docker');
    fs.writeFileSync(downFlag,'1');
    const blocked=await job();assert.equal(blocked.status,'environment_unavailable');assert.match(blocked.evidence[0].stderr,/Docker/);
    assert.equal(fs.existsSync(marker),false,'the program never ran on the host');
  }finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}
}
(async()=>{try{
  const docker=dockerAdapter({cli:[process.execPath,fake],image:'node:22-alpine',env:{}});
  // Availability check never starts anything; down daemon = unavailable with a reason.
  const up=await docker.availability();assert.equal(up.available,true);assert.match(up.imageDigest,/^node@sha256:b{64}$/);
  const down=await dockerAdapter({cli:[process.execPath,fake],image:'node:22-alpine',env:{FAKE_DOCKER_DOWN:'1'}}).availability();
  assert.equal(down.available,false);assert.match(down.reason,/daemon|Docker/i);
  const noImage=await dockerAdapter({cli:[process.execPath,fake],image:'node:22-alpine',env:{FAKE_NO_IMAGE:'1'}}).availability();
  assert.equal(noImage.available,false);assert.match(noImage.reason,/image/i);assert.ok(!calls().some(c=>c[0]==='pull'),'never pulls on its own');
  fs.rmSync(log,{force:true});
  // A run: one docker run per phase with hardened flags and the job's own label/name.
  const job={id:'11111111-2222-4333-8444-555555555555'},events=[];
  const result=await docker.run({job,workDir:work,tmpDir:out,manifest,signal:new AbortController().signal,timeoutMs:5000,networkAllowed:false,onEvent:(t,d)=>events.push([t,d])});
  assert.equal(result.status,'passed');
  const runs=calls().filter(c=>c[0]==='run');assert.equal(runs.length,2);
  for(const argv of runs){
    for(const flag of ['--rm','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--network=none','--cpus=1','--memory=512m','--pids-limit=128','--user=1000:1000'])assert.ok(argv.includes(flag),`${flag} in ${argv.join(' ')}`);
    assert.ok(argv.includes(`--label=kantor-job=${job.id}`));assert.ok(argv.some(a=>a.startsWith(`--name=kantor-${job.id}-`)));
    const mounts=argv.filter(a=>a.startsWith('--mount=')||a==='-v'||a.startsWith('--volume'));
    assert.deepEqual(mounts.map(m=>m.replace(/source=[^,]+/,'source=X')),['--mount=type=bind,source=X,target=/app,readonly','--mount=type=bind,source=X,target=/tmp/out'],'only the job folders are mounted');
    assert.ok(argv.includes(`--mount=type=bind,source=${work},target=/app,readonly`),'path with spaces kept as one argument');
    assert.ok(!argv.join(' ').includes('docker.sock')&&!argv.join(' ').includes('.env')&&!argv.includes('--privileged'));
    assert.ok(argv.includes('node:22-alpine'));
  }
  assert.deepEqual(runs[1].slice(runs[1].indexOf('node:22-alpine')+1),['node','--test','test dir/a.test.js','a;b&&c'],'command argv passed literally after the image');
  assert.equal(result.evidence[1].exitCode,0);assert.match(result.evidence[1].stdout,/hello from container/);
  const pinnedDigest='node@sha256:'+'b'.repeat(64);
  fs.rmSync(log,{force:true});
  await docker.run({job,workDir:work,tmpDir:out,manifest:{commands:{test:manifest.commands.test}},signal:new AbortController().signal,timeoutMs:5000,networkAllowed:false,imageDigest:pinnedDigest,onEvent:()=>{}});
  assert.ok(calls().find(c=>c[0]==='run').includes(pinnedDigest),'execution uses the digest approved by the owner, not a mutable tag');
  // Network only when the owner allowed it.
  fs.rmSync(log,{force:true});await docker.run({job,workDir:work,tmpDir:out,manifest:{commands:{test:manifest.commands.test},files:[]},signal:new AbortController().signal,timeoutMs:5000,networkAllowed:true,onEvent:()=>{}});
  const netRun=calls().find(c=>c[0]==='run');assert.ok(!netRun.includes('--network=none'));assert.ok(netRun.includes('--network=bridge'));
  // A failing command is a failed job.
  const failing=dockerAdapter({cli:[process.execPath,fake],image:'node:22-alpine',env:{FAKE_EXIT:'3'}});
  const failed=await failing.run({job,workDir:work,tmpDir:out,manifest:{commands:{test:manifest.commands.test},files:[]},signal:new AbortController().signal,timeoutMs:5000,networkAllowed:false,onEvent:()=>{}});
  assert.equal(failed.status,'failed');assert.equal(failed.evidence[0].exitCode,3);
  // Cancel removes only containers carrying this job's label.
  fs.rmSync(log,{force:true});await docker.removeOwned(job.id);
  const rm=calls();assert.deepEqual(rm[0],['ps','-aq','--filter',`label=kantor-job=${job.id}`]);assert.ok(!rm.some(c=>c.includes('-a')&&c[0]==='rm'&&!c.some(x=>/^[0-9a-f]+$/.test(x))),'never a blanket rm');
  // Unavailable Docker: run refuses without spawning anything else.
  fs.rmSync(log,{force:true});
  const offline=dockerAdapter({cli:[process.execPath,fake],image:'node:22-alpine',env:{FAKE_DOCKER_DOWN:'1'}});
  await assert.rejects(offline.run({job,workDir:work,tmpDir:out,manifest,signal:new AbortController().signal,timeoutMs:5000,networkAllowed:false,onEvent:()=>{}}),e=>e.code==='ENVIRONMENT_UNAVAILABLE');
  assert.deepEqual(calls().map(c=>c[0]),['info'],'no run and no host fallback when the daemon is down');
  await serverFlow();
  console.log('PASS: hardened docker argv, job-only mounts with spaces, literal command argv, network opt-in, failure exit code, owned-label cleanup, no fallback when unavailable');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
