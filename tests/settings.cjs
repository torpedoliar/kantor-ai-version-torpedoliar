const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const port=4001,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-settings-'));
const origin=`http://127.0.0.1:${port}`;
const envKey=Buffer.alloc(32,7).toString('base64');
const {createSettings}=require('../server/settings');
const noKeyDir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-settings-no-key-'));
const noKeySettings=createSettings({dataDir:noKeyDir,env:{},agents:{}});
assert.throws(()=>noKeySettings.save({version:0,providers:[{id:'no-key',displayName:'No key',protocol:'openai',baseUrl:'http://127.0.0.1:5001',models:[],credential:'sentinel'}],defaultRoute:null,fallbackRoute:null,overrides:{}},0),error=>error.status===503&&/KANTOR_SETTINGS_KEY/.test(error.message));
fs.rmSync(noKeyDir,{recursive:true,force:true});
function start(){
  const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(port),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:envKey},stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{let ready=false;child.stdout.on('data',data=>{if(String(data).includes('Kantor Kita:')){ready=true;resolve(child);}});child.on('exit',code=>{if(!ready)reject(new Error(`server exited ${code}`));});});
}
async function request(pathname,options={}){const response=await fetch(origin+pathname,options);return {status:response.status,headers:response.headers,body:await response.json().catch(()=>null)};}
(async()=>{
  const child=await start();
  try{
    const session=await request('/api/session');
    assert.equal(session.status,200);
    assert.equal(typeof session.body.csrf,'string');
    const headers={'content-type':'application/json','origin':origin,'x-kantor-csrf':session.body.csrf};
    const settings=await request('/api/settings');
    assert.equal(settings.status,200);
    assert.equal(settings.body.version,0);
    assert.equal(settings.body.providers.length,0);
    assert.equal(JSON.stringify(settings.body).includes(envKey),false);
    const provider={id:'provider-local',displayName:'Local mock',protocol:'openai',baseUrl:'http://127.0.0.1:5001',enabled:true,models:[{id:'mock-model',source:'manual',status:'unverified',enabled:true}],credential:'sentinel-api-key'};
    const saved=await request('/api/settings',{method:'PUT',headers,body:JSON.stringify({version:settings.body.version,providers:[provider],defaultRoute:null,fallbackRoute:null,overrides:{}})});
    assert.equal(saved.status,200);
    assert.equal(JSON.stringify(saved.body).includes('sentinel-api-key'),false);
    assert.equal(saved.body.providers[0].hasCredential,true);
    assert.equal(fs.readFileSync(path.join(dir,'settings.json'),'utf8').includes('sentinel-api-key'),false);
    assert.equal((await request('/api/settings',{method:'PUT',headers,body:JSON.stringify({version:0,providers:[],defaultRoute:null,fallbackRoute:null,overrides:{}})})).status,409);
    assert.equal((await request('/api/settings',{method:'PUT',headers:{'content-type':'application/json','origin':origin},body:'{}'})).status,403);
    console.log('PASS: settings session, encrypted credential redaction, version guard and CSRF');
  }finally{child.kill();}
})().catch(error=>{console.error(error);process.exit(1);});
