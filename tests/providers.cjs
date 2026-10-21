const assert=require('node:assert/strict');
const http=require('node:http');
const providers=require('../server/providers');
(async()=>{
  const requests=[];
  const mock=http.createServer((req,res)=>{requests.push(req.url);if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'mock-model',name:'Mock'}]}));return;}if(req.url==='/r2/v1/chat/completions'){req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(JSON.stringify({choices:[{message:{content:'Router OK'}}]})+'data: [DONE]\n\n');});return;}if(req.url==='/r3/v1/chat/completions'){req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'Hal'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'o'}}]})+'\n\ndata: [DONE]\n\n');});return;}if(req.url==='/v1/chat/completions'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{assert.equal(JSON.parse(body).model,'mock-model');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));});return;}res.writeHead(404);res.end();});
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  try{
    const provider={protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`};
    const models=await providers.discoverModels(provider,'sentinel');assert.deepEqual(models,[{id:'mock-model',name:'Mock',contextLength:undefined}]);
    const answer=await providers.generate(provider,'sentinel','mock-model',{system:'test'},{title:'Task',brief:'Brief'});assert.equal(answer,'OK');
    assert.equal(requests.includes('/v1/models'),true);assert.equal(requests.includes('/v1/chat/completions'),true);
    // Routers like 9Router answer a non-streaming request with the JSON body followed by an SSE [DONE] marker, or stream deltas.
    assert.equal(await providers.generate({protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}/r2/v1`},'sentinel','m',{system:'s'},{title:'T'}),'Router OK');
    assert.equal(await providers.generate({protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}/r3/v1`},'sentinel','m',{system:'s'},{title:'T'}),'Halo');
    assert.throws(()=>providers.normalizeBase('http://192.168.1.2:11434'),/loopback/);
    console.log('PASS: provider discovery, OpenAI-compatible generation and URL guard');
  }finally{await new Promise(resolve=>mock.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
