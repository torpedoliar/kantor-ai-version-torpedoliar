const assert=require('node:assert/strict');
const {criteriaEvidence}=require('../server/application-workflow');
const criteria=['2+2=4','negatif'];
const text='# tests 2\n# pass 2\n# fail 0\nok 1 - C1 2+2=4\nok 2 - C2 negatif\n';
assert.deepEqual(criteriaEvidence(text,criteria).map(c=>c.status),['passed','passed']);
assert.deepEqual(criteriaEvidence('# tests 2\n# pass 2\n# fail 0\n# console says 2+2=4 negatif',criteria).map(c=>c.status),['not_verified','not_verified']);
assert.equal(criteriaEvidence('ok 1 - C1 2+2=4 # SKIP\n# tests 1\n# pass 0\n# skipped 1',['2+2=4'])[0].status,'not_verified');
assert.equal(criteriaEvidence('not ok 1 - C1 2+2=4\n# tests 1\n# pass 0\n# fail 1',['2+2=4'])[0].status,'not_verified');
assert.equal(criteriaEvidence('ok 1 - irrelevant\n# console 2+2=4\n# tests 1\n# pass 1',['2+2=4'])[0].status,'not_verified');
const {canReviewApplication}=require('../server/application-workflow');
const evidence={jobId:'j',revisionId:'r',manifestHash:'h',exitCode:0,criteria:[{status:'passed'}]};
const state={jobs:[{id:'j',status:'passed',revisionId:'r',manifestHash:'h'}]};
assert.equal(canReviewApplication({revisionId:'r',evidence},state),false,'smoke evidence is mandatory');
assert.equal(canReviewApplication({revisionId:'r',evidence:{...evidence,smoke:{status:'passed'}}},state),true);
console.log('PASS: criteria require successful, non-skipped TAP cases rather than console claims');
// A source change between the run and review must fail the task visibly, never reject unhandled.
(async()=>{
  const {createApplicationWorkflow}=require('../server/application-workflow');
  const task={id:'t',jobId:'j',revisionId:'r',projectId:'p',acceptance:['2+2=4'],version:0};
  const state={tasks:[task],jobs:[],decisions:[],projects:[]};
  const wf=createApplicationWorkflow({snapshot:()=>state,commit:fn=>fn(state,()=>{}),projects:{verifyRevision(){throw Object.assign(Error('Hash sumber berubah sejak revisi disimpan.'),{code:'SOURCE_CHANGED'});}},smoke:async()=>({status:'passed'})});
  await wf.completed({id:'j',taskId:'t',revisionId:'r',status:'passed',evidence:[{phase:'test',exitCode:0,stdout:'ok 1 - 2+2=4\n# tests 1\n# pass 1',stderr:''}]});
  assert.equal(task.status,'blocked');assert.equal(task.phase,'failed');assert.match(task.error,/berubah/);
  console.log('PASS: a source change after the run blocks the task with a visible cause');
})().catch(e=>{console.error(e);process.exitCode=1;});
