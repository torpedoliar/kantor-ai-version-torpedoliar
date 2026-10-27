const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {recoverState,snapshotLastGood}=require('./state-recovery');

const SCHEMA_VERSION=1;
const LIMITS={providers:20,models:500,name:80,url:2048,key:512,model:200};
const clone=value=>structuredClone(value);
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const now=()=>new Date().toISOString();

function keyBytes(value){
  if(!value)return null;
  try{
    const decoded=Buffer.from(value,'base64');
    if(decoded.length===32&&decoded.toString('base64').replace(/=+$/,'')===value.replace(/=+$/,''))return decoded;
  }catch{}
  try{const decoded=Buffer.from(value,'hex');if(decoded.length===32&&/^[0-9a-f]+$/i.test(value))return decoded;}catch{}
  return null;
}
function atomicWrite(file,data){
  const tmp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp,data,{mode:0o600});
  fs.renameSync(tmp,file);
}
function normalBase(value){
  let url;
  try{url=new URL(value);}catch{throw new Error('Base URL is invalid.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Base URL must be a clean HTTP(S) URL.');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname))throw new Error('HTTP providers must use a loopback hostname.');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/$/,'');
}
function empty(){return {schemaVersion:SCHEMA_VERSION,version:0,providers:[],defaultRoute:null,fallbackRoute:null,overrides:{},maxTokens:null,concurrency:DEFAULT_CONCURRENCY};}
// Model calls running at the same time across the office (protects provider rate limits); null = unlimited.
const DEFAULT_CONCURRENCY=3;
function concurrencyLimit(value,fallback){if(value===undefined)return fallback;if(value===null||value===''||Number(value)===0)return null;const n=Number(value);if(!Number.isInteger(n)||n<1||n>100)throw new Error('Maks agen bersamaan harus kosong (tanpa batas) atau bilangan bulat 1–100.');return n;}
// Max output tokens per model call: null = unlimited (the default).
function tokenLimit(value){if(value===null||value===undefined||value===''||Number(value)===0)return null;const n=Number(value);if(!Number.isInteger(n)||n<256||n>1000000)throw new Error('Maks token harus kosong (tanpa batas) atau bilangan bulat 256–1000000.');return n;}
function sanitizeModel(model){
  if(!model||typeof model!=='object')throw new Error('Invalid model.');
  const id=text(model.id||model.modelId,LIMITS.model);if(!id)throw new Error('Model ID is required.');
  return {id,name:text(model.name||model.displayName,LIMITS.model),source:['fetched','manual','legacy'].includes(model.source)?model.source:'manual',enabled:model.enabled!==false,status:['stale','unverified','verified'].includes(model.status)?model.status:'unverified',contextLength:Number.isFinite(model.contextLength)?Math.max(0,Math.floor(model.contextLength)):undefined,lastSeenAt:typeof model.lastSeenAt==='string'?model.lastSeenAt:null};
}
function sanitizeProvider(provider){
  if(!provider||typeof provider!=='object')throw new Error('Invalid provider.');
  const id=text(provider.id||provider.providerId,100)||crypto.randomUUID();
  const protocol=provider.protocol;
  if(!['anthropic','openai'].includes(protocol))throw new Error('Provider protocol must be anthropic or openai.');
  const baseUrl=normalBase(provider.baseUrl);
  const models=Array.isArray(provider.models)?provider.models.map(sanitizeModel):[];
  if(models.length>LIMITS.models)throw new Error('Too many models.');
  return {id,displayName:text(provider.displayName||provider.name,LIMITS.name)||'Unnamed provider',protocol,baseUrl,enabled:provider.enabled!==false,models,environmentManaged:!!provider.environmentManaged,maxConcurrent:concurrencyLimit(provider.maxConcurrent,null)};
}
function routeValid(route,providers,allowNull=true){
  if(route==null&&allowNull)return null;
  if(!route||typeof route!=='object')throw new Error('Invalid model route.');
  const provider=providers.find(item=>item.id===route.providerId);if(!provider)throw new Error('Route provider does not exist.');
  const model=provider.models.find(item=>item.id===route.modelId);if(!model)throw new Error('Route model does not exist.');
  return {providerId:provider.id,modelId:model.id};
}
function validate(input){
  if(!input||typeof input!=='object')throw new Error('Settings must be an object.');
  const providers=(Array.isArray(input.providers)?input.providers:[]).map(sanitizeProvider);
  if(providers.length>LIMITS.providers)throw new Error('Too many providers.');
  if(new Set(providers.map(item=>item.id)).size!==providers.length)throw new Error('Provider IDs must be unique.');
  const defaultRoute=routeValid(input.defaultRoute,providers),fallbackRoute=routeValid(input.fallbackRoute,providers);
  if(defaultRoute&&fallbackRoute&&defaultRoute.providerId===fallbackRoute.providerId&&defaultRoute.modelId===fallbackRoute.modelId)throw new Error('Fallback must differ from the default.');
  const overrides={};
  for(const [name,route] of Object.entries(input.overrides||{})){if(typeof name!=='string'||!name.trim())throw new Error('Unknown agent override.');overrides[name]=routeValid(route,providers);}
  return {schemaVersion:SCHEMA_VERSION,version:Number.isInteger(input.version)?input.version:0,providers,defaultRoute,fallbackRoute,overrides,maxTokens:tokenLimit(input.maxTokens),concurrency:concurrencyLimit(input.concurrency,DEFAULT_CONCURRENCY)};
}

// A key from the environment wins; otherwise a local settings.key is reused, or generated once so
// first-run provider setup works out of the box. Deleting the file makes stored credentials unreadable.
function resolveSettingsKey(envValue,dataDir){
  const fromEnv=keyBytes(envValue);if(fromEnv)return fromEnv;
  const file=path.join(dataDir,'settings.key');
  try{const stored=keyBytes(fs.readFileSync(file,'utf8').trim());if(stored)return stored;}catch{}
  const generated=crypto.randomBytes(32);
  try{fs.writeFileSync(file,generated.toString('base64'),{mode:0o600});console.error(`Generated ${file} to encrypt provider credentials; back it up.`);}
  catch(error){console.error(`Cannot write ${file}: ${error.message}`);return null;}
  return generated;
}
function createSettings({dataDir,env=process.env,agents={}}){
  fs.mkdirSync(dataDir,{recursive:true});
  const file=path.join(dataDir,'settings.json'),credentialFile=path.join(dataDir,'credentials.json');
  const encryptionKey=resolveSettingsKey(env.KANTOR_SETTINGS_KEY,dataDir);
  let state=empty(),credentials=new Map(),explicit=false,broken=null,recovery={settings:null,credentials:null};
  const object=value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('harus berupa objek');return value;};
  function read(){
    explicit=fs.existsSync(file);
    // Settings and stored credentials recover from last-good like every other state file.
    // A degraded file still blocks saving until the owner restores it, so nothing is guessed.
    const settingsResult=recoverState({file,dataDir,label:'settings',validate:value=>validate({...object(value),version:value.version||0}),fresh:empty,corruptFresh:empty});
    recovery.settings=settingsResult;
    state=explicit?validate({...object(settingsResult.value),version:settingsResult.value.version||0}):empty();
    broken=settingsResult.degraded?new Error(settingsResult.error||'settings.json rusak'):null;
    if(settingsResult.recovered)try{atomicWrite(file,JSON.stringify(state,null,2));}catch{}
    const credentialsResult=recoverState({file:credentialFile,dataDir,label:'credentials',validate:value=>{object(value);},fresh:()=>({}),corruptFresh:()=>({})});
    recovery.credentials=credentialsResult;
    credentials=new Map(Object.entries(credentialsResult.value));
    if(credentialsResult.degraded)broken=broken||new Error(credentialsResult.error||'credentials.json rusak');
    if(credentialsResult.recovered)try{atomicWrite(credentialFile,JSON.stringify(Object.fromEntries(credentials),null,2));}catch{}
  }
  function encrypt(value,id){
    if(!encryptionKey){const error=new Error('Set KANTOR_SETTINGS_KEY before saving credentials.');error.status=503;throw error;}
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv);cipher.setAAD(Buffer.from(`kantor:${id}`));
    const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
  }
  function decrypt(record,id){
    if(!encryptionKey||!record)return '';
    try{const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(record.iv,'base64'));decipher.setAAD(Buffer.from(`kantor:${id}`));decipher.setAuthTag(Buffer.from(record.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(record.data,'base64')),decipher.final()]).toString('utf8');}
    catch{return '';}
  }
  function publicProvider(provider){
    return {...provider,hasCredential:provider.environmentManaged?!!env.ANTHROPIC_API_KEY:!!credentials.get(provider.id),models:provider.models.map(model=>({...model}))};
  }
  function checkRoutes(candidate){
    for(const route of [candidate.defaultRoute,candidate.fallbackRoute,...Object.values(candidate.overrides)]) if(route){const provider=candidate.providers.find(item=>item.id===route.providerId),model=provider?.models.find(item=>item.id===route.modelId);if(!provider||!model||!provider.enabled||!model.enabled||model.status==='stale')throw new Error('Routes must use enabled, non-stale models.');}
  }
  function envProvider(){
    if(!env.ANTHROPIC_API_KEY||explicit)return null;
    const base=env.ANTHROPIC_BASE_URL||'https://api.anthropic.com';
    return {id:'env-anthropic',displayName:'Anthropic (environment)',protocol:'anthropic',baseUrl:normalBase(base),enabled:true,environmentManaged:true,models:[...new Set(Object.values(agents).map(agent=>agent.model||env.ANTHROPIC_MODEL||'claude-sonnet-5-5'))].map(id=>({id,name:'',source:'legacy',enabled:true,status:'unverified',lastSeenAt:null}))};
  }
  function publicState(){
    const providers=[...state.providers.map(publicProvider)];const legacy=envProvider();if(legacy)providers.unshift(publicProvider(legacy));
    return {schemaVersion:SCHEMA_VERSION,version:state.version,providers,defaultRoute:state.defaultRoute,fallbackRoute:state.fallbackRoute,overrides:clone(state.overrides),maxTokens:state.maxTokens??null,concurrency:state.concurrency??null,broken:!!broken,hasEncryptionKey:!!encryptionKey};
  }
  function save(next,expectedVersion){
    if(broken)throw new Error('Settings storage is damaged; repair or move settings.json before saving.');
    if(expectedVersion!==undefined&&expectedVersion!==state.version){const error=new Error('Settings changed in another tab. Reload before saving.');error.status=409;throw error;}
    const candidate=validate(next);candidate.version=state.version+1;
    const nextCredentials=new Map(credentials);
    for(const provider of Array.isArray(next.providers)?next.providers:[]){
      if(Object.hasOwn(provider,'credential')){
        const credential=provider.credential;
        if(credential===null)nextCredentials.delete(provider.id);
        else if(typeof credential==='string'&&credential.trim())nextCredentials.set(provider.id,encrypt(credential.slice(0,LIMITS.key),provider.id));
      }
    }
    for(const id of [...nextCredentials.keys()])if(!candidate.providers.some(provider=>provider.id===id))nextCredentials.delete(id);
    checkRoutes(candidate);
    const metadata=JSON.stringify(candidate,null,2),secret=JSON.stringify(Object.fromEntries(nextCredentials),null,2);
    // Keep the previous valid settings/credentials as last-good before replacing them.
    try{snapshotLastGood(file,dataDir,'settings');snapshotLastGood(credentialFile,dataDir,'credentials');}catch{}
    atomicWrite(file,metadata);if(encryptionKey||fs.existsSync(credentialFile))atomicWrite(credentialFile,secret);
    state=candidate;credentials=nextCredentials;explicit=true;return publicState();
  }
  function credential(providerId){
    const provider=state.providers.find(item=>item.id===providerId);
    if(provider?.environmentManaged)return env.ANTHROPIC_API_KEY||'';
    return decrypt(credentials.get(providerId),providerId);
  }
  function resolve(agentName,profile={}){
    const legacy=envProvider();
    if(!explicit&&legacy&&env.ANTHROPIC_DRY_RUN!=='1'){
      const agent=agents[agentName],modelId=profile.model||agent?.model||env.ANTHROPIC_MODEL||legacy.models[0].id;
      return {dryRun:false,settingsVersion:0,provider:{...legacy,credential:env.ANTHROPIC_API_KEY},modelId,route:{providerId:legacy.id,modelId},fallback:null};
    }
    const agent=agents[agentName],base=state.overrides[agentName]||state.defaultRoute;
    const memberModel=base&&profile.model&&state.providers.find(p=>p.id===base.providerId)?.models.some(m=>m.id===profile.model&&m.enabled&&m.status!=='stale');
    const route=memberModel?{...base,modelId:profile.model}:base;
    if(!route)return {dryRun:true,settingsVersion:state.version,provider:null,modelId:profile.model||agent?.model||env.ANTHROPIC_MODEL||null,route:null,fallback:null};
    const provider=state.providers.find(item=>item.id===route.providerId),model=provider?.models.find(item=>item.id===route.modelId),credential=provider?.environmentManaged?env.ANTHROPIC_API_KEY:decrypt(credentials.get(provider?.id),provider?.id);
    if(!provider||!model||!provider.enabled||!model.enabled||model.status==='stale'||!credential)return {dryRun:false,settingsVersion:state.version,provider:null,modelId:model?.id||null,route,fallback:null,invalid:true};
    const fallback=state.fallbackRoute&&(state.fallbackRoute.providerId!==route.providerId||state.fallbackRoute.modelId!==route.modelId)?state.fallbackRoute:null;
    let fallbackSnapshot=null;
    if(fallback){const fp=state.providers.find(item=>item.id===fallback.providerId),fm=fp?.models.find(item=>item.id===fallback.modelId),fc=fp&&!fp.environmentManaged?decrypt(credentials.get(fp.id),fp.id):env.ANTHROPIC_API_KEY;if(fp&&fm&&fp.enabled&&fm.enabled&&fm.status!=='stale'&&fc)fallbackSnapshot={provider:{...fp,credential:fc},modelId:fm.id,route:fallback};}
    return {dryRun:false,settingsVersion:state.version,provider:{...provider,credential},modelId:model.id,route,fallback:fallbackSnapshot};
  }
  // Limits for the model-call gate: office-wide plus each provider's own cap.
  function limits(){const providers={};for(const p of state.providers)if(p.maxConcurrent)providers[p.id]=p.maxConcurrent;return {office:state.concurrency??null,providers};}
  read();
  return {publicState,save,resolve,credential,callLimits:limits,get state(){return clone(state)},get broken(){return broken},recovery:()=>structuredClone(recovery),normalizeBase:normalBase,limits:LIMITS};
}
module.exports={createSettings,validate,keyBytes,normalBase};
