// One gate for every model call, so a busy office never fires more requests than the provider allows.
// limits() returns {office:number|null, providers:{[providerId]:number}}; null/absent = unlimited.
// Waiting calls start highest priority first, then oldest.
const RANK={high:0,normal:1,low:2};
const MAX_COOLDOWN=300000;
function createGate(limits){
  const waiting=[],running=new Map(),cooldowns=new Map();let seq=0,cooldownTimer=null;
  const count=provider=>[...running.values()].filter(p=>p===provider).length;
  function cooldownLeft(provider){
    const until=cooldowns.get(provider);if(!until)return 0;
    const left=until-Date.now();if(left<=0){cooldowns.delete(provider);return 0;}return left;
  }
  function fits(item,L){
    if(L.office&&running.size>=L.office)return false;
    if(cooldownLeft(item.provider))return false;
    const cap=L.providers?.[item.provider];return !cap||count(item.provider)<cap;
  }
  // A provider that answered 429/503 is rested once for the whole office. One timer wakes the
  // queue when the earliest cooldown ends; calling poke() on every task would hammer it again.
  function scheduleCooldownPoke(){
    if(cooldownTimer)return;
    const now=Date.now();
    for(const [provider,until] of cooldowns)if(until<=now)cooldowns.delete(provider);
    const next=Math.min(...[...cooldowns.values()]);
    if(!Number.isFinite(next))return;
    cooldownTimer=setTimeout(()=>{cooldownTimer=null;poke();scheduleCooldownPoke();},Math.max(10,next-now));
    cooldownTimer.unref?.();
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
  function cooldown(provider,ms){
    const until=Date.now()+Math.max(0,Math.min(MAX_COOLDOWN,Number(ms)||0));
    if(until<=Date.now())return;
    if(until>(cooldowns.get(provider)||0))cooldowns.set(provider,until);
    scheduleCooldownPoke();
  }
  return {run,poke,cooldown,snapshot:()=>({running:running.size,waiting:waiting.length,queue:waiting.map(w=>({label:w.label,provider:w.provider,priority:w.priority})),cooldowns:Object.fromEntries([...cooldowns].map(([provider,until])=>[provider,Math.max(0,until-Date.now())]).filter(([,left])=>left>0))})};
}
module.exports={createGate};
