// Real Docker run of a trusted calculator fixture. Opt-in only: RUN_DOCKER_TESTS=1 (needs the daemon and the image).
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {dockerAdapter}=require('../server/project-runner');
if(process.env.RUN_DOCKER_TESTS!=='1'){console.log('SKIP: set RUN_DOCKER_TESTS=1 to run against the real Docker daemon');return;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kantor docker live '));
const work=path.join(tmp,'work'),out=path.join(tmp,'tmp');fs.mkdirSync(path.join(work,'test'),{recursive:true});fs.mkdirSync(out);
fs.writeFileSync(path.join(work,'calc.js'),'exports.add=(a,b)=>a+b;exports.div=(a,b)=>{if(b===0)throw new Error("bagi nol");return a/b;};');
fs.writeFileSync(path.join(work,'test','calc.test.js'),`const test=require('node:test'),assert=require('node:assert');const c=require('../calc.js');
test('2+2',()=>assert.equal(c.add(2,2),4));test('negatif',()=>assert.equal(c.add(-2,-3),-5));test('desimal',()=>assert.equal(c.add(0.1,0.2).toFixed(2),'0.30'));test('bagi nol',()=>assert.throws(()=>c.div(1,0),/bagi nol/));
test('tanpa jaringan',async()=>{await assert.rejects(fetch('http://example.com',{signal:AbortSignal.timeout(3000)}));});
test('root fs read-only',()=>assert.throws(()=>require('node:fs').writeFileSync('/app/x.txt','x')));`);
(async()=>{try{
  const docker=dockerAdapter();const state=await docker.availability();
  if(!state.available){console.log(`BLOCKED: ${state.reason}`);process.exitCode=2;return;}
  const job={id:require('node:crypto').randomUUID()},events=[];
  const result=await docker.run({job,workDir:work,tmpDir:out,manifest:{commands:{test:{executable:'node',args:['--test','test/calc.test.js']}},files:[]},signal:new AbortController().signal,timeoutMs:120000,networkAllowed:false,onEvent:(t,d)=>events.push([t,d])});
  assert.equal(result.status,'passed',result.evidence.map(e=>e.stdout+e.stderr).join('\n'));
  assert.match(result.evidence[0].stdout,/pass 6/);
  console.log(`PASS: real container (${state.imageDigest||state.image}) ran 6 calculator/isolation tests with network off and read-only source`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
