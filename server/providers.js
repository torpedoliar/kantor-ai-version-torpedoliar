const dns=require('node:dns').promises;
const net=require('node:net');
const {URL}=require('node:url');

const MAX_MODELS=500,MAX_RESPONSE=1e6;
// Reasoning-heavy routed models (e.g. *-xhigh) can take several minutes; override with PROVIDER_TIMEOUT_MS.
const GENERATE_TIMEOUT=()=>Math.max(5000,Number(process.env.PROVIDER_TIMEOUT_MS)||300000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function classify(error){return error?.category||'connection';}
function safeError(message,category='connection',status=0){const error=new Error(message);error.category=category;error.status=status;return error;}
function normalizeBase(value){
  let url;try{url=new URL(value);}catch{throw safeError('Provider URL is invalid.','invalid');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw safeError('Provider URL must use clean HTTP(S) without credentials or query parameters.','invalid');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname))throw safeError('HTTP providers must use a loopback hostname.','invalid');
  url.pathname=url.pathname.replace(/\/+$/,'');return url.toString().replace(/\/$/,'');
}
function endpoint(provider,suffix){const base=normalizeBase(provider.baseUrl);return `${base}${base.endsWith('/v1')?'':'/v1'}${suffix}`;}
async function bodyLimit(response){
  const length=Number(response.headers.get('content-length')||0);if(length>MAX_RESPONSE)throw safeError('Provider response is too large.','invalid');
  const raw=await response.text();if(Buffer.byteLength(raw)>MAX_RESPONSE)throw safeError('Provider response is too large.','invalid');return raw;
}
// Some OpenAI-compatible routers (e.g. 9Router) send `text/event-stream` even for non-streaming calls:
// either one JSON body followed by `data: [DONE]`, or `data:` chunks with deltas. Both become one response object.
function parseBody(raw){
  try{return raw?JSON.parse(raw):{};}catch{}
  const events=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(line=>line&&line!=='[DONE]');
  if(events.length&&!raw.trimStart().startsWith('{')){
    const chunks=events.map(line=>JSON.parse(line)),text=chunks.map(c=>c.choices?.[0]?.delta?.content||c.choices?.[0]?.message?.content||'').join('');
    return {...chunks.at(-1),choices:[{message:{content:text}}]};
  }
  const end=raw.search(/\r?\n?data:/);if(end>0)return JSON.parse(raw.slice(0,end));
  throw new Error('invalid');
}
async function request(url,options={}){
  let parsed;try{parsed=new URL(url);}catch{throw safeError('Provider URL is invalid.','invalid');}
  if(parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]','::1'].includes(parsed.hostname))throw safeError('Provider URL is not allowed.','invalid');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout||15000);
  try{
    const response=await fetch(url,{...options,signal:controller.signal,redirect:'error'});
    const raw=await bodyLimit(response);let data={};try{data=parseBody(raw);}catch{throw safeError('Provider returned invalid JSON.','invalid',response.status);}
    if(!response.ok){const category=[401,403].includes(response.status)?'auth':[408,429].includes(response.status)?'quota':[502,503,504].includes(response.status)?'unavailable':response.status>=500?'connection':'request';throw safeError(`Provider request failed (${response.status}).`,category,response.status);}
    return data;
  }catch(error){if(error.name==='AbortError')throw safeError('Provider request timed out.','timeout');if(error.category)throw error;throw safeError('Could not reach provider.','connection');}
  finally{clearTimeout(timer);}
}
function headers(provider,credential){return provider.protocol==='anthropic'?{'content-type':'application/json','x-api-key':credential,'anthropic-version':'2023-06-01'}:{'content-type':'application/json',authorization:`Bearer ${credential}`};}
async function discoverModels(provider,credential){
  const items=[];let next=endpoint(provider,'/models');
  for(let page=0;page<20&&next&&items.length<MAX_MODELS;page++){
    const data=await request(next,{headers:headers(provider,credential)});
    if(!Array.isArray(data.data))throw safeError('Provider model list is unavailable.','invalid');
    for(const item of data.data){const id=typeof item?.id==='string'&&item.id.trim();if(id)items.push({id,name:typeof item.name==='string'?item.name:'',contextLength:Number.isFinite(item.context_length)?item.context_length:undefined});if(items.length>=MAX_MODELS)break;}
    const candidate=data.next||data.next_page;
    if(typeof candidate!=='string'||!candidate)break;
    const base=new URL(endpoint(provider,'/models'));const url=new URL(candidate,next);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname.replace(/\/models$/,'')))throw safeError('Provider pagination URL is not allowed.','invalid');next=url.toString();
  }
  return items;
}
// OpenAI-compatible streaming: reports the growing text through onDelta and returns the final answer.
// A router that ignores stream:true and answers with one JSON body is handled the same way as before.
async function streamChat(provider,credential,body,onDelta){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),GENERATE_TIMEOUT());
  try{
    const response=await fetch(endpoint(provider,'/chat/completions'),{method:'POST',headers:headers(provider,credential),body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    if(!response.ok){
      const raw=await bodyLimit(response);
      if([400,422,501].includes(response.status)&&/stream/i.test(raw)&&/not supported|unsupported|not support|not available/i.test(raw)){
        const data=await request(endpoint(provider,'/chat/completions'),{method:'POST',headers:headers(provider,credential),timeout:GENERATE_TIMEOUT(),body:JSON.stringify({...body,stream:false})});
        const answer=(data.choices||[]).map(c=>c.message?.content||'').join('\n').trim();if(answer)onDelta(answer);return answer;
      }
      const category=[401,403].includes(response.status)?'auth':[408,429].includes(response.status)?'quota':[502,503,504].includes(response.status)?'unavailable':response.status>=500?'connection':'request';throw safeError(`Provider request failed (${response.status}).`,category,response.status);
    }
    if(!/event-stream/.test(response.headers.get('content-type')||'')){
      const raw=await bodyLimit(response);let data;try{data=parseBody(raw);}catch{throw safeError('Provider returned invalid JSON.','invalid',response.status);}
      const answer=(data.choices||[]).map(c=>c.message?.content||c.delta?.content||'').join('\n').trim();if(answer)onDelta(answer);return answer;
    }
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',raw='',text='',size=0;
    for(;;){
      const {value,done}=await reader.read();if(done)break;
      size+=value.length;if(size>MAX_RESPONSE)throw safeError('Provider response is too large.','invalid');
      const decoded=decoder.decode(value,{stream:true});raw+=decoded;buffer+=decoded;let cut;
      while((cut=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);
        if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;
        let chunk;try{chunk=JSON.parse(data);}catch{continue;}
        const piece=(chunk.choices||[]).map(c=>c.delta?.content||c.message?.content||'').join('');
        if(piece){text+=piece;onDelta(text);}
      }
    }
    if(!text.trim()){let data;try{data=parseBody(raw);}catch{throw safeError('Provider returned invalid JSON.','invalid');}text=(data.choices||[]).map(c=>c.message?.content||'').join('\n');if(text.trim())onDelta(text);}
    return text.trim();
  }catch(error){if(error.name==='AbortError')throw safeError('Provider request timed out.','timeout');if(error.category)throw error;throw safeError('Could not reach provider.','connection');}
  finally{clearTimeout(timer);}
}
// Reasoning models can spend the whole budget deliberating and return no answer text. One retry asks for a direct answer.
const DIRECT='\n\nAnswer directly now. Keep any deliberation very short and write the final answer immediately.';
// Max tokens: null/0 = unlimited (OpenAI-compatible omits the field; Anthropic requires one, so a high ceiling is used).
const ANTHROPIC_CEILING=64000;
async function generateOnce(provider,credential,model,agent,prompt,options){
  const limit=Number(options.maxTokens)>0?Number(options.maxTokens):null,tokens=limit?{max_tokens:limit}:{};
  if(provider.protocol!=='anthropic'&&options.onDelta)return streamChat(provider,credential,{model,stream:true,...tokens,messages:[{role:'system',content:agent.system},{role:'user',content:prompt}]},options.onDelta).catch(error=>{if(error.empty)return '';throw error;});
  const data=provider.protocol==='anthropic'
    ?await request(endpoint(provider,'/messages'),{method:'POST',headers:headers(provider,credential),timeout:GENERATE_TIMEOUT(),body:JSON.stringify({model,max_tokens:limit||ANTHROPIC_CEILING,system:agent.system,messages:[{role:'user',content:prompt}]})})
    :await request(endpoint(provider,'/chat/completions'),{method:'POST',headers:headers(provider,credential),timeout:GENERATE_TIMEOUT(),body:JSON.stringify({model,stream:false,...tokens,messages:[{role:'system',content:agent.system},{role:'user',content:prompt}]})});
  return provider.protocol==='anthropic'?(data.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n').trim():(data.choices||[]).map(choice=>choice.message?.content||'').join('\n').trim();
}
async function generate(provider,credential,model,agent,task,options={}){
  const prompt=`${task.memory?`Your memory from earlier work (owner preferences and finished tasks):\n${task.memory}\n\n`:''}Task: ${task.title}\n\nBrief:\n${task.brief||'(no brief given)'}${task.conversation?`\n\nConversation so far:\n${task.conversation}`:''}${task.childResults?`\n\nResults from your team:\n${task.childResults}`:''}${task.feedback?`\n\nPrevious draft:\n${task.result}\n\nRevision requested:\n${task.feedback}`:''}`;
  let answer=await generateOnce(provider,credential,model,agent,prompt,options);
  if(!answer){options.onEmpty?.();answer=await generateOnce(provider,credential,model,agent,prompt+DIRECT,options);}
  if(!answer)throw safeError('Model berpikir terlalu lama dan tidak menulis jawaban (reasoning tanpa hasil). Coba model lain, atau atur Maks token di Pengaturan.','empty');
  return answer;
}
async function testConnection(provider,credential,model){
  if(model)return generate(provider,credential,model,{system:'Reply with exactly OK.'},{title:'Connection test',brief:'Reply exactly OK.'});
  await discoverModels(provider,credential);return {discovery:true};
}
module.exports={normalizeBase,discoverModels,generate,testConnection,classify,safeError};
