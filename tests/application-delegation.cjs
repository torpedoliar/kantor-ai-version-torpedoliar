// An automatic application root must integrate the team's work into a source revision, never enter Review on text alone.
const assert=require('node:assert/strict');
const {createOrchestrator}=require('../server/task-orchestrator');
let state={tasks:[{id:'root',assignee:'Lead',outputType:'application',status:'blocked',phase:'waiting_children'},{id:'child',parentId:'root',planRunId:'p',status:'done',result:'Trusted team result'}]},built=[];
const o=createOrchestrator({snapshot:()=>structuredClone(state),commit:fn=>fn(state,()=>{}),org:{state:{}},canRun:()=>true,askModel:async()=>{throw Error('Text synthesis must not run for application roots');},buildApplication:async(id,results)=>{built.push([id,results]);state.tasks[0].phase='awaiting_approval';}});
o.wake();
setImmediate(()=>{assert.equal(built.length,1);assert.equal(built[0][0],'root');assert.match(built[0][1],/Trusted team result/);assert.notEqual(state.tasks[0].status,'review');console.log('PASS: automatic application roots integrate team results through the application workflow');});
