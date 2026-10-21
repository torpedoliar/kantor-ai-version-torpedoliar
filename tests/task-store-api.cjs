// HTTP writes must persist workspace state and real transition events, while keeping legacy source untouched.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task-store-api-')),origin='http://127.0.0.1:43551';
fs.writeFileSync(path.join(dir,'tasks.json'),'[]');
const child=spawn(process.execPath,['server/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:'43551',DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'60000'},stdio:['ignore','pipe','inherit']});
(async()=>{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('server exit '+c)))});try{
const csrf=(await(await fetch(origin+'/api/session')).json()).csrf,headers={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
const r=await fetch(origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({title:'Persist task',assignee:'Koh Wira',division:'engineering',asLead:true})});assert.equal(r.status,201);const task=await r.json();
const state=JSON.parse(fs.readFileSync(path.join(dir,'workspace.json'),'utf8'));assert.equal(state.tasks[0].id,task.id);assert.ok(state.events.some(e=>e.type==='task.created'&&e.taskId===task.id));assert.equal(fs.readFileSync(path.join(dir,'tasks.json'),'utf8'),'[]');
const changed=await fetch(origin+'/api/tasks/'+task.id,{method:'PATCH',headers,body:JSON.stringify({priority:'low',version:task.version})});assert.equal(changed.status,200);
const stale=await fetch(origin+'/api/tasks/'+task.id,{method:'PATCH',headers,body:JSON.stringify({priority:'high',version:task.version})});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'VERSION_CONFLICT');
console.log('PASS: HTTP task writes use durable workspace events and reject stale generic PATCH');
}finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);child.kill();process.exitCode=1;});
