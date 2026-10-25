// Failed planning waits for an explicit retry; store wakeups must not create a paid retry loop.
const assert=require('node:assert/strict');
const {createOrchestrator}=require('../server/task-orchestrator');
let calls=0;
const state={tasks:[{id:'root',assignee:'Lead',status:'queued',executionMode:'automatic'}],messages:[],threads:[]};
const o=createOrchestrator({snapshot:()=>structuredClone(state),commit:fn=>fn(state,()=>({seq:1,at:new Date().toISOString()})),org:{state:{}},canRun:()=>true,askModel:async()=>{calls++;throw Error('Provider unavailable');}});
(async()=>{o.wake();await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.ok(state.tasks[0].error);for(let i=0;i<4;i++){o.wake();await new Promise(r=>setImmediate(r));}assert.equal(calls,1,'failed planner does not retry on unrelated store wakeups');state.tasks[0].error=null;o.wake();await new Promise(r=>setImmediate(r));assert.equal(calls,2,'explicit retry clears the hold');console.log('PASS: failed planning waits for owner retry instead of repeating model calls');})().catch(e=>{console.error(e);process.exitCode=1;});
