// While a model streams, the thread shows the growing text ("sedang menulis…"); the final message replaces it.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43711),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-typing-'));
const words='Halo owner, ini draf caption untuk peluncuran menu kopi baru minggu depan.'.split(' ');
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{const body=JSON.parse(raw||'{}');
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({choices:[{message:{content:'ok'}}]}));}
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const w of words){res.write(`data: ${JSON.stringify({choices:[{delta:{content:w+' '}}]})}\n\n`);await new Promise(r=>setTimeout(r,350));}
  res.end('data: [DONE]\n\n');});});
const wait=async(fn,label,ms=30000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,80));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,9).toString('base64')},stdio:['ignore','pipe','inherit']});let browser;
 try{await new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
  const csrf=(await(await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(m,p,b)=>{const r=await fetch(origin+p,{method:m,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:b&&JSON.stringify(b)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  browser=await launch();const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(t=>{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken',t);},token);
  await page.goto(origin);await page.waitForFunction(()=>window.Messenger&&window.officeTasks);
  const task=(await call('POST','/api/tasks',{title:'Caption menu',assignee:'Kak Rani',division:'marketing',asLead:true,executionMode:'direct',brief:'Caption peluncuran menu kopi'})).body;
  // API: the growing text is visible while the model streams.
  const first=await wait(async()=>{const a=(await call('GET',`/api/tasks/${task.id}/activity`)).body;return a.typing?.text&&a;},'typing appears');
  assert.equal(first.typing.agent,'Kak Rani');
  const later=await wait(async()=>{const a=(await call('GET',`/api/tasks/${task.id}/activity`)).body;return a.typing?.text?.length>first.typing.text.length&&a;},'typing grows');
  assert.ok(later.typing.text.startsWith(first.typing.text.trim().split(' ')[0]),'text only grows');
  // UI: the live bubble shows in the open thread before the agent finishes.
  await page.click('#bCommunications');await page.locator(`#threadList [data-thread-id="${task.id}"]`).click();
  const live=page.locator('#messageTimeline .bubble-typing');await live.waitFor({timeout:10000});
  assert.match(await live.innerText(),/sedang menulis/);const t1=await live.innerText();
  if(process.env.SHOT)await page.screenshot({path:path.join(process.env.SHOT,'live-typing-desktop.png')});

  await page.waitForFunction(t=>{const b=document.querySelector('#messageTimeline .bubble-typing');return b&&b.innerText.length>t.length;},t1,{timeout:8000});
  // Polling for live text must not rebuild the thread when nothing in it changed (it would wipe open panels/inputs).
  await page.evaluate(()=>{const tl=document.getElementById('messageTimeline');window.__marker=document.createElement('span');window.__marker.id='keepMarker';tl.querySelector('.activity-line')?.append(window.__marker);});
  // Finished: the typing bubble is replaced by the final result message.
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===task.id).status==='review','done');
  assert.equal((await call('GET',`/api/tasks/${task.id}/activity`)).body.typing,null,'typing cleared after finish');
  await page.waitForFunction(()=>!document.querySelector('#messageTimeline .bubble-typing')&&[...document.querySelectorAll('#messageTimeline .bubble-agent')].some(b=>/minggu depan/.test(b.innerText)),null,{timeout:10000});
  if(process.env.SHOT){await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.SHOT,'live-typing-mobile.png')});}
  // Idle thread (task in review, nothing streaming): 2s of 500ms polls must keep existing DOM nodes.
  await page.evaluate(()=>{const tl=document.getElementById('messageTimeline');const m=document.createElement('span');m.id='idleMarker';tl.querySelector('.bubble')?.append(m);});
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#idleMarker').count(),1,'idle polling does not rebuild the timeline');
  console.log('PASS: streamed text is shown live in the thread and replaced by the final message');
 }finally{if(browser)await browser.close();child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
