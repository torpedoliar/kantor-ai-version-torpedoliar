// One gate for every model call, so a busy office never fires more requests than the provider allows.
// limits() returns {office:number|null, providers:{[providerId]:number}}; null/absent = unlimited.
// Waiting calls start highest priority first, then oldest.
const RANK={high:0,normal:1,low:2};
function createGate(limits){
  const waiting=[],running=new Map();let seq=0;
  const count=provider=>[...running.values()].filter(p=>p===provider).length;
  function fits(item,L){
    if(L.office&&running.size>=L.office)return false;
    const cap=L.providers?.[item.provider];return !cap||count(item.provider)<cap;
  }
  function poke(){
    const L=limits()||{};
    waiting.sort((a,b)=>(RANK[a.priority]??1)-(RANK[b.priority]??1)||a.seq-b.seq);
    for(let i=0;i<waiting.length;){
      const item=waiting[i];
      if(!fits(item,L)){if(L.office&&running.size>=L.office)break;i++;continue;}
      waiting.splice(i,1);running.set(item.seq,item.provider);
      Promise.resolve().then(item.fn).then(item.resolve,item.reject).finally(()=>{running.delete(item.seq);poke();});
    }
  }
  function run({provider='default',priority='normal',label=''}={},fn){
    return new Promise((resolve,reject)=>{waiting.push({seq:++seq,provider,priority,label,fn,resolve,reject});poke();});
  }
  return {run,poke,snapshot:()=>({running:running.size,waiting:waiting.length,queue:waiting.map(w=>({label:w.label,provider:w.provider,priority:w.priority}))})};
}
module.exports={createGate};
