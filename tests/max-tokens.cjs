// Max tokens: unlimited by default (no max_tokens sent); configurable in Settings; an empty, reasoning-only answer
// gets one "answer directly" retry before failing.
const assert=require('node:assert/strict'),http=require('node:http');
const providers=require('../server/providers');
const {createSettings}=require('../server/settings');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
  const bodies=[];let mode='ok';
  const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);bodies.push(body);
    res.writeHead(200,{'content-type':'application/json'});
    if(mode==='think'&&!/Answer directly now/.test(JSON.stringify(body.messages)))return res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:'',reasoning:'lama sekali berpikir'}}]}));
    if(mode==='alwaysThink')return res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:'',reasoning:'tetap berpikir'}}]}));
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Jawaban.'}}]}));});});
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  try{
    const p={protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`};
    // Unlimited by default: no max_tokens field at all.
    await providers.generate(p,'k','m',{system:'s'},{title:'T'});assert.equal('max_tokens' in bodies.at(-1),false,'unlimited by default');
    // A configured limit is sent.
    await providers.generate(p,'k','m',{system:'s'},{title:'T'},{maxTokens:4096});assert.equal(bodies.at(-1).max_tokens,4096);
    // Reasoning-only empty answer: one direct retry, which succeeds.
    mode='think';bodies.length=0;
    assert.equal(await providers.generate(p,'k','m',{system:'s'},{title:'T'}),'Jawaban.');assert.equal(bodies.length,2,'exactly one retry');
    // Still empty after the retry: a clear error naming the cause.
    mode='alwaysThink';bodies.length=0;
    await assert.rejects(providers.generate(p,'k','m',{system:'s'},{title:'T'}),e=>/berpikir terlalu lama|reasoning/i.test(e.message)&&e.category==='empty');assert.equal(bodies.length,2,'no endless retries');
    // Settings: maxTokens is validated and stored; null/0 means unlimited.
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-maxtok-'));
    const s=createSettings({dataDir:dir,env:{KANTOR_SETTINGS_KEY:Buffer.alloc(32,1).toString('base64')},agents:{}});
    const v=s.publicState().version;
    assert.equal(s.publicState().maxTokens,null,'default unlimited');
    s.save({...s.publicState(),version:v,maxTokens:8000},v);assert.equal(s.publicState().maxTokens,8000);
    const v2=s.publicState().version;s.save({...s.publicState(),version:v2,maxTokens:0},v2);assert.equal(s.publicState().maxTokens,null,'0 → unlimited');
    const v3=s.publicState().version;assert.throws(()=>s.save({...s.publicState(),version:v3,maxTokens:-5},v3),/token/i);
    fs.rmSync(dir,{recursive:true,force:true});
    console.log('PASS: unlimited max tokens by default, configurable limit, one direct retry for reasoning-only empty answers');
  }finally{mock.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
