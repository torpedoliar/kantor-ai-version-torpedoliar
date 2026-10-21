// Runs an approved revision's commands on the local Windows host. This is NOT a sandbox: the process has the
// Windows account's access. It only narrows what we control: argv without a shell, a fresh job folder, a minimal
// environment, time and output limits, and killing the whole process tree on cancel or timeout.
const fs=require('node:fs'),path=require('node:path'),{spawn,execFile}=require('node:child_process');
const {sanitizeText}=require('./task-store');

const OUTPUT_CAP=1024*1024,PHASES=['build','test'];
const WINDOWS_WARNING='Windows lokal bukan sandbox: kode berjalan dengan akses akun Windows kamu. Akses jaringan mengikuti OS (tidak bisa dimatikan di sini). Hanya setujui kode yang sudah kamu periksa.';
// Only what Node needs on Windows; nothing from the server's own environment (keys, tokens, settings).
function minimalEnv(tmp){
  const keep=['SystemRoot','SystemDrive','WINDIR','ComSpec','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'];
  const env=Object.fromEntries(keep.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  return {...env,PATH:path.dirname(process.execPath),TEMP:tmp,TMP:tmp,NODE_ENV:'test'};
}
// Owned PID only: taskkill /T walks that process's own tree; nothing else is touched.
function killTree(child){
  if(!child||child.exitCode!==null)return Promise.resolve();
  if(process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}return Promise.resolve();}
  return new Promise(resolve=>execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
}
function capture(){let text='',dropped=0;return {add(chunk){const s=chunk.toString();if(text.length<OUTPUT_CAP)text+=s.slice(0,OUTPUT_CAP-text.length);dropped+=Math.max(0,s.length-(OUTPUT_CAP-text.length));},value(){return sanitizeText(text)+(dropped?`\n[… ${dropped} karakter dipotong]`:'');}};}

function runCommand({command,cwd,env,timeoutMs,signal}){
  return new Promise(resolve=>{
    const started=Date.now(),out=capture(),err=capture();
    const args=command.args.includes('--test')&&!command.args.some(a=>a.startsWith('--test-reporter'))?['--test-reporter=tap',...command.args]:command.args;
    const child=spawn(process.execPath,args,{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let ending=null;const finish=reason=>{if(!ending){ending=reason;killTree(child);}};
    const timer=setTimeout(()=>finish('timed_out'),timeoutMs);
    const onAbort=()=>finish('cancelled');signal.addEventListener('abort',onAbort,{once:true});
    child.stdout.on('data',d=>out.add(d));child.stderr.on('data',d=>err.add(d));
    child.on('error',error=>{err.add(Buffer.from(error.message));});
    child.on('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);
      resolve({argv:['node',...command.args],exitCode:code,ending,stdout:out.value(),stderr:err.value(),startedAt:new Date(started).toISOString(),durationMs:Date.now()-started});});
  });
}
// The job folder gets a copy of the revision's source: commands may write files without touching the immutable revision.
// Both environments get the same job folder: a writable copy of the revision plus a private temp dir.
function prepareJob(sourceDir,manifest,jobDir){
  const work=path.join(jobDir,'work'),tmp=path.join(jobDir,'tmp');fs.mkdirSync(tmp,{recursive:true});
  fs.cpSync(sourceDir,work,{recursive:true});
  for(const file of manifest.files)fs.chmodSync(path.join(work,...file.path.split('/')),0o644);
  return {work,tmp};
}
async function run({job,sourceDir,manifest,jobDir,signal,onEvent,timeoutMs,environment='windows',networkAllowed=false,imageDigest,docker}){
  const {work,tmp}=prepareJob(sourceDir,manifest,jobDir);
  if(environment==='docker')return (docker||dockerAdapter()).run({job,workDir:work,tmpDir:tmp,manifest,signal,timeoutMs,networkAllowed,imageDigest,onEvent});
  if(environment!=='windows')throw Object.assign(new Error(`Lingkungan ${environment} tidak dikenal.`),{code:'ENVIRONMENT_UNAVAILABLE'});
  const env=minimalEnv(tmp),evidence=[];
  for(const phase of PHASES){
    const command=manifest.commands[phase];if(!command)continue;
    onEvent('command.started',{phase,argv:['node',...command.args]});
    const result=await runCommand({command,cwd:work,env,timeoutMs,signal});
    evidence.push({phase,...result});
    onEvent('command.finished',{phase,exitCode:result.exitCode,ending:result.ending,durationMs:result.durationMs});
    if(result.ending)return {status:result.ending,evidence};
    if(result.exitCode!==0)return {status:'failed',evidence};
  }
  return {status:'passed',evidence};
}
// ---- Docker: same phases, but each command runs in a hardened, labelled container from one configured image ----
// `cli` is argv for the Docker CLI (tests pass a fake). The model never chooses the image, mounts or flags.
function dockerAdapter({cli=process.env.KANTOR_DOCKER_CLI?JSON.parse(process.env.KANTOR_DOCKER_CLI):['docker'],image=process.env.KANTOR_RUNNER_IMAGE||'node:22-alpine',env=process.env}={}){
  const call=(args,{timeoutMs=15000,signal}={})=>new Promise(resolve=>{
    const out=capture(),err=capture();
    const child=spawn(cli[0],[...cli.slice(1),...args],{shell:false,windowsHide:true,env,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>child.kill(),timeoutMs);
    child.stdout.on('data',d=>out.add(d));child.stderr.on('data',d=>err.add(d));
    child.on('error',error=>err.add(Buffer.from(error.message)));
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout:out.value(),stderr:err.value()});});
  });
  // Reads state only: never starts the daemon or pulls an image.
  async function availability(){
    const info=await call(['info','--format','{{json .ServerVersion}}']);
    if(info.code!==0)return {available:false,reason:'Docker daemon tidak berjalan atau Docker belum terpasang. Jalankan Docker Desktop lalu cek ulang.'};
    const inspect=await call(['image','inspect',image]);
    if(inspect.code!==0)return {available:false,reason:`Image ${image} belum ada. Ambil sekali dengan: docker pull ${image} (perlu persetujuanmu).`};
    let digest=null;try{digest=JSON.parse(inspect.stdout)[0]?.RepoDigests?.[0]||null;}catch{}
    return {available:true,image,imageDigest:digest};
  }
  function runArgs(job,phase,command,workDir,tmpDir,networkAllowed,pinnedImage){
    return ['run','--rm',`--name=kantor-${job.id}-${phase}`,`--label=kantor-job=${job.id}`,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
      `--network=${networkAllowed?'bridge':'none'}`,'--cpus=1','--memory=512m','--pids-limit=128','--user=1000:1000','--tmpfs=/tmp:rw,size=64m',
      `--mount=type=bind,source=${workDir},target=/app,readonly`,`--mount=type=bind,source=${tmpDir},target=/tmp/out`,'--workdir=/app','--env=HOME=/tmp','--env=NODE_ENV=test',
      pinnedImage||image,'node',...command.args];
  }
  async function removeOwned(jobId){
    const list=await call(['ps','-aq','--filter',`label=kantor-job=${jobId}`]);
    const ids=list.stdout.split(/\s+/).filter(id=>/^[0-9a-f]{6,64}$/.test(id));
    if(ids.length)await call(['rm','-f',...ids]);
  }
  async function run({job,workDir,tmpDir,manifest,signal,timeoutMs,networkAllowed,imageDigest,onEvent}){
    const state=await availability();if(!state.available)throw Object.assign(new Error(state.reason),{code:'ENVIRONMENT_UNAVAILABLE',status:409});
    const evidence=[];
    for(const phase of PHASES){
      const command=manifest.commands[phase];if(!command)continue;
      const argv=runArgs(job,phase,command,workDir,tmpDir,networkAllowed,imageDigest);
      onEvent('command.started',{phase,argv:['node',...command.args],environment:'docker',image:state.imageDigest||image});
      const started=Date.now();let ending=null;
      const controller=new AbortController(),stop=reason=>{if(!ending){ending=reason;removeOwned(job.id);}};
      const timer=setTimeout(()=>stop('timed_out'),timeoutMs),onAbort=()=>stop('cancelled');signal.addEventListener('abort',onAbort,{once:true});
      const result=await call(argv,{timeoutMs:timeoutMs+10000,signal:controller.signal});
      clearTimeout(timer);signal.removeEventListener('abort',onAbort);
      evidence.push({phase,argv:['node',...command.args],environment:'docker',image:state.imageDigest||image,exitCode:result.code,ending,stdout:result.stdout,stderr:result.stderr,startedAt:new Date(started).toISOString(),durationMs:Date.now()-started});
      onEvent('command.finished',{phase,exitCode:result.code,ending,durationMs:Date.now()-started});
      if(ending)return {status:ending,evidence};
      if(result.code!==0)return {status:'failed',evidence};
    }
    return {status:'passed',evidence};
  }
  return {availability,run,removeOwned};
}
async function environments(docker=dockerAdapter()){
  return {windows:{available:process.platform==='win32',reason:process.platform==='win32'?null:'Host ini bukan Windows.',warning:WINDOWS_WARNING},docker:await docker.availability()};
}
module.exports={run,environments,dockerAdapter,killTree,WINDOWS_WARNING};
