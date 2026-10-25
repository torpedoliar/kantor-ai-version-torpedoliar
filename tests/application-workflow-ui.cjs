// Trusted app bundle, local provider: source/command review before approval, explicit Windows acknowledgement,
// real test evidence, sandboxed separate-origin preview and source download before owner acceptance.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {launch}=require('./browser.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-app-ui-')),PORT=43611,origin=`http://127.0.0.1:${PORT}`;
const bundle={runtime:'static-web',files:[{path:'index.html',content:'<!doctype html><title>Kalkulator</title><h1>Kalkulator</h1><button onclick="document.querySelector(\'output\').textContent=2+2">Hitung</button><output></output>'},{path:'test.cjs',content:"require('node:test')('2+2=4',()=>require('node:assert/strict').equal(2+2,4));"}],commands:{test:{executable:'node',args:['--test','test.cjs']}},acceptanceTests:['2+2=4'],knownLimitations:['Belum menyimpan riwayat']};
const mock=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(bundle)}}]}));});});
const wait=async fn=>{for(let i=0;i<200;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('timeout');};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,4).toString('base64')},stdio:['ignore','pipe','inherit']});let browser;
try{
 await new Promise(r=>child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r()));
 const csrf=(await(await fetch(origin+'/api/session')).json()).csrf,h={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
 const call=async(method,p,b)=>{const r=await fetch(origin+p,{method,headers:h,body:b&&JSON.stringify(b)});return r.json();};
 const s=await call('GET','/api/settings');await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
 h['x-kantor-org']=(await call('POST','/api/org/unlock',{pin:'2468'})).token;
 const o=await call('GET','/api/org');await call('PUT','/api/org',{...o,members:o.members.map(m=>m.name==='Koh Wira'?{...m,isAgent:true}:m)});
 const task=await call('POST','/api/tasks',{title:'Kalkulator uji UI',assignee:'Koh Wira',division:'engineering',asLead:true,outputType:'application',environment:'windows',acceptance:['2+2=4'],brief:'Kalkulator'});
 await wait(async()=>(await call('GET','/api/tasks')).find(t=>t.id===task.id)?.phase==='awaiting_approval');
 browser=await launch();const page=await browser.newPage({viewport:{width:1440,height:900}});await page.addInitScript(token=>{sessionStorage.setItem('kantor-ai.orgToken',token);sessionStorage.setItem('kantor-ai.wizardSnoozed','1');},h['x-kantor-org']);
 await page.goto(origin);await page.waitForFunction(()=>window.officeTasks?.list().length);await page.click('#bTasks');
 await page.locator('#taskDetail').getByRole('button',{name:'Buka percakapan'}).click();
 await page.locator('#messageTimeline #messageApplicationPanel').waitFor();
 assert.match(await page.locator('#messageTimeline #messageApplicationPanel').innerText(),/Setujui & jalankan pengujian/);
 await page.locator('#threadContext').getByRole('button',{name:'Buka di Tugas'}).click();
 const panel=page.locator('#taskDialog #applicationPanel');await panel.waitFor();assert.match(await panel.innerText(),/Windows lokal.*bukan sandbox/s);assert.match(await panel.innerText(),/node --test test.cjs/);
 assert.match(await page.locator(`.task-card[data-task-id="${task.id}"]`).innerText(),/Menunggu izin pengujian/);
 assert.equal(await panel.getByRole('button',{name:'Setujui & jalankan pengujian'}).isEnabled(),false);
 await panel.getByRole('button',{name:'Periksa sumber'}).click();assert.match(await panel.locator('.application-source').innerText(),/index.html/);
 if(process.env.SHOT)await page.screenshot({path:path.join(process.env.SHOT,'t11-approval-1440.png')});
 await panel.getByLabel('Saya memahami akses akun dan jaringan mengikuti OS').check();await panel.getByRole('button',{name:'Setujui & jalankan pengujian'}).click();
 await page.waitForFunction(()=>window.officeTasks.list().some(t=>t.status==='review'),null,{timeout:150000}).catch(async error=>{throw Error(`${error.message}\nTasks: ${JSON.stringify(await call('GET','/api/tasks'))}\nFeedback: ${await page.locator('#taskFeedback').innerText()}`);});
 assert.match(await page.locator('#applicationPanel').innerText(),/2\+2=4.*passed/s);assert.match(await page.locator('#applicationPanel').innerText(),/Belum menyimpan riwayat/);
 await page.getByRole('button',{name:'Buka preview terisolasi'}).click();const frame=page.locator('#applicationPreview');await frame.waitFor();
 const src=await frame.getAttribute('src');assert.notEqual(new URL(src).origin,origin);assert.equal(await frame.getAttribute('sandbox'),'allow-scripts');
 await frame.contentFrame().getByRole('button',{name:'Hitung'}).click();assert.equal(await frame.contentFrame().locator('output').innerText(),'4');
 // Preview has an independent origin and cannot invoke the authenticated app API.
 const cross=await fetch(origin+'/api/tasks',{headers:{origin:new URL(src).origin}});assert.equal(cross.status,403);
 if(process.env.SHOT)await page.screenshot({path:path.join(process.env.SHOT,'t11-review-1440.png')});
 for(const [width,height] of [[390,844],[768,900]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(process.env.SHOT)await page.screenshot({path:path.join(process.env.SHOT,`t11-review-${width}.png`)});}
 // Copy to an owner-chosen folder; a second copy asks before replacing files.
 await page.setViewportSize({width:1440,height:900});
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-app-export-')),exportTo=path.join(outside,'Calculator');
 await page.locator('#applicationPanel').getByLabel('Salin ke folder').fill(exportTo);
 await page.locator('#applicationPanel').getByRole('button',{name:'Salin sumber ke folder'}).click();
 await page.waitForFunction(()=>/file disalin ke/.test(document.querySelector('#taskFeedback')?.textContent||''),null,{timeout:15000}).catch(async e=>{throw Error(e.message+' feedback='+await page.locator('#taskFeedback').innerText());});
 assert.match(fs.readFileSync(path.join(exportTo,'index.html'),'utf8'),/Kalkulator/);
 let asked=null;page.once('dialog',d=>{asked=d.message();d.dismiss();});
 fs.writeFileSync(path.join(exportTo,'index.html'),'mine');
 await page.locator('#applicationPanel').getByRole('button',{name:'Salin sumber ke folder'}).click();
 await page.waitForFunction(()=>true);await page.waitForTimeout(800);
 assert.match(asked||'',/sudah berisi file/);assert.equal(fs.readFileSync(path.join(exportTo,'index.html'),'utf8'),'mine','declining keeps the owner files');
 const reviewed=(await call('GET','/api/tasks')).find(t=>t.id===task.id);
 await call('PATCH',`/api/tasks/${task.id}`,{action:'revise',version:reviewed.version,feedback:'Ubah warna tombol'});
 await assert.rejects(fetch(src),/fetch failed|ECONNREFUSED|socket/i,'replacing the revision closes its preview');
 console.log('PASS: application approval risks, source inspection, actual evidence, sandboxed separate-origin preview and responsive panel');
}finally{if(browser)await browser.close();child.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});for(const d of fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('kantor-app-export-')))fs.rmSync(path.join(os.tmpdir(),d),{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
