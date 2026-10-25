// Excursion permission must use real nonterminal assignments, never the seated character's 'work' pose.
const assert=require('node:assert/strict'),M=require('../public/mobility.js');
for(const status of ['queued','active','blocked','review','unknown'])assert.equal(M.canDepart('A',[{assignee:'A',status}],true),false,status+' blocks departure');
assert.equal(M.canDepart('A',[{assignee:'A',status:'done'}],true),true);assert.equal(M.canDepart('A',[{assignee:'B',status:'active'}],true),true);assert.equal(M.canDepart('A',[],false),false,'unknown/offline task state blocks departure');
console.log('PASS: every nonterminal assignment blocks team excursions, done and reassigned work do not');
