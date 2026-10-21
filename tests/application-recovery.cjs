const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {createTaskStore}=require('../server/task-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-app-recovery-')),PORT=43631;
const store=createTaskStore({dataDir:dir});
store.transaction(undefined,d=>{d.tasks.push({id:'app-recovery',title:'App interrupted',assignee:'Kak Rani',division:'marketing',status:'active',phase:'implementing',outputType:'application',brief:'x',result:'',messages:[],version:0,runId:'old'});});
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:''},stdio:['ignore','pipe','inherit']});
(async()=>{try{await new Promise(r=>child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r()));await new Promise(r=>setTimeout(r,300));const task=(await(await fetch(`http://127.0.0.1:${PORT}/api/tasks`)).json())[0];assert.equal(task.status,'blocked');assert.equal(task.phase,'interrupted');assert.equal(task.runId,null);console.log('PASS: restart parks application work as interrupted instead of automatically invoking models');}finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
