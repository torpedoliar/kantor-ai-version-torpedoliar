// The local API perimeter: cross-origin writes, plain bodies, missing CSRF, oversized payloads,
// invalid hosts, traversal, owner-only archives, unknown routes and graceful 413 delivery.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const PORT=Number(process.env.TEST_PORT||43649),dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-api-guard-')),origin=`http://127.0.0.1:${PORT}`;
const server=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,17).toString('base64')},stdio:['ignore','pipe','ignore']});
const ready=new Promise((resolve,reject)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());server.on('exit',code=>reject(Error('server exit '+code)));});
const raw=(requestPath,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:PORT,path:requestPath,method,headers,timeout:10000},res=>{
    let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:data,headers:res.headers}));
  });
  req.on('timeout',()=>req.destroy(Error('request timeout')));req.on('error',reject);if(body)req.write(body);req.end();
});
(async()=>{await ready;try{
  const session=await raw('/api/session');const csrf=JSON.parse(session.body).csrf;
  const json={'content-type':'application/json','x-kantor-csrf':csrf};
  assert.equal((await raw('/api/org/unlock',{method:'POST',headers:{...json,origin:'http://evil.example'},body:JSON.stringify({pin:'2468'})})).status,403,'cross-origin writes are refused');
  assert.equal((await raw('/api/org/unlock',{method:'POST',headers:{...json,'content-type':'text/plain',origin},body:JSON.stringify({pin:'2468'})})).status,415,'plain bodies are refused');
  assert.equal((await raw('/api/org/unlock',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({pin:'2468'})})).status,403,'missing session');
  const huge=JSON.stringify({pin:'1'.repeat(1100000)});
  const oversized=await raw('/api/org/unlock',{method:'POST',headers:{...json,origin,'content-length':Buffer.byteLength(huge)},body:huge});
  assert.equal(oversized.status,413,'an oversized body gets a real 413, not a socket reset');
  assert.match(oversized.body,/Request too large/);
  assert.equal((await raw('/api/session?x='+'a'.repeat(4200))).status,414,'long request targets are refused');
  assert.equal((await raw('/api/session',{headers:{host:'evil.example'}})).status,400,'foreign Host headers are refused');
  assert.equal((await raw('/%2e%2e%2fserver%2fserver.js')).status,403,'static traversal is blocked');
  assert.equal((await raw('/api/workspace/archive/workspace-1.json')).status,403,'archives need the owner unlock');
  assert.equal((await raw('/api/does-not-exist')).status,404,'unknown API routes are 404');
  const unlock=await raw('/api/org/unlock',{method:'POST',headers:{...json,origin},body:JSON.stringify({pin:'2468'})});
  const token=JSON.parse(unlock.body).token;
  assert.equal((await raw('/api/workspace/archive/workspace-1.json',{headers:{'x-kantor-org':token}})).status,404,'a missing archive is 404 for the owner');
  console.log('PASS: cross-origin, content-type, CSRF, oversized body, long URL, host, traversal, archive and 404 guards');
}finally{server.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
