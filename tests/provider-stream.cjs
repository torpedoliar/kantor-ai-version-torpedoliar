// generate(..., {onDelta}) streams text as it arrives; plain JSON answers still work; without onDelta nothing changes.
const assert=require('node:assert/strict'),http=require('node:http');
const providers=require('../server/providers');
(async()=>{
  const bodies=[];
  const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{const body=JSON.parse(raw);bodies.push(body);
    if(req.url.startsWith('/plain')){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({choices:[{message:{content:'Satu blok.'}}]}));}
    if(req.url.startsWith('/no-stream')&&body.stream){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'stream is not supported'}}));}
    if(req.url.startsWith('/router')){res.writeHead(200,{'content-type':'text/event-stream'});return res.end(JSON.stringify({choices:[{message:{content:'Router compatible.'}}]})+'data: [DONE]\n\n');}
    if(!body.stream){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({choices:[{message:{content:'Tanpa stream.'}}]}));}
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(const part of ['Halo',' owner,',' ini',' draf.']){res.write(`data: ${JSON.stringify({choices:[{delta:{content:part}}]})}\n\n`);await new Promise(r=>setTimeout(r,30));}
    res.end('data: [DONE]\n\n');});});
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  try{
    const base=`http://127.0.0.1:${mock.address().port}`,seen=[];
    const answer=await providers.generate({protocol:'openai',baseUrl:base},'k','m',{system:'s'},{title:'T'},{onDelta:text=>seen.push(text)});
    assert.equal(answer,'Halo owner, ini draf.');assert.equal(bodies.at(-1).stream,true,'asks for a stream');
    assert.ok(seen.length>=2,'deltas arrive before the end');assert.ok(seen.every((t,i)=>!i||t.length>=seen[i-1].length),'text only grows');assert.equal(seen.at(-1),'Halo owner, ini draf.');
    // A router that ignores stream:true and answers JSON still works.
    assert.equal(await providers.generate({protocol:'openai',baseUrl:base+'/plain'},'k','m',{system:'s'},{title:'T'},{onDelta:()=>{}}),'Satu blok.');
    // 9Router can label a single JSON body plus [DONE] as an event stream.
    assert.equal(await providers.generate({protocol:'openai',baseUrl:base+'/router'},'k','m',{system:'s'},{title:'T'},{onDelta:()=>{}}),'Router compatible.');
    assert.equal(await providers.generate({protocol:'openai',baseUrl:base+'/no-stream'},'k','m',{system:'s'},{title:'T'},{onDelta:()=>{}}),'Tanpa stream.','unsupported streaming falls back to a regular response');
    // Without onDelta: no stream requested.
    assert.equal(await providers.generate({protocol:'openai',baseUrl:base},'k','m',{system:'s'},{title:'T'}),'Tanpa stream.');assert.equal(bodies.at(-1).stream,false);
    console.log('PASS: streamed deltas grow to the final answer, JSON fallback, no stream without onDelta');
  }finally{mock.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
