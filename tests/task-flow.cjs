// Task flow graph and console come from stored events only: real delegations, results and questions, nothing invented.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43541),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-flow-'));
const SECRET='sk-flow-SECRET777',XSS='Rancang UI <img src=x onerror="window.__flowXss=1">';
const mock=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const text=JSON.stringify(JSON.parse(raw||'{}').messages);let content='Hasil kerja.';
  if(/MODE: PLAN/.test(text))content=JSON.stringify({assumptions:['web'],acceptance:['Hitung benar'],children:[{key:'ui',title:XSS,brief:'Tombol angka besar',assignee:'Bagas Pratama Putra'},{key:'logic',title:'Logika hitung',brief:'Empat operasi',assignee:'Rizky Hakim',dependencyKeys:['ui']},{key:'cs',title:'FAQ',assignee:'Kak Sinta'}]});
  else if(/MODE: SYNTHESIZE/.test(text))content='Ringkasan akhir kalkulator.';
  setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));},40);});});
const child=()=>spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,8).toString('base64')},stdio:['ignore','pipe','inherit']});
const wait=async(fn,label,ms=20000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await new Promise(r=>mock.listen(0,'127.0.0.1',r));const server=child();await new Promise((r,j)=>{server.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());server.on('exit',c=>j(Error('exit '+c)));});let browser;
 try{
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  const s=(await call('GET','/api/settings')).body;
  await call('PUT','/api/settings',{version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:`http://127.0.0.1:${mock.address().port}`,enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:SECRET}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}});
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  const o=(await call('GET','/api/org')).body;
  await call('PUT','/api/org',{...o,members:o.members.map(m=>['Koh Wira','Bagas Pratama Putra','Rizky Hakim'].includes(m.name)?{...m,isAgent:true}:m)});
  const root=(await call('POST','/api/tasks',{title:'Program Kalkulator',assignee:'Koh Wira',division:'engineering',asLead:true,executionMode:'automatic',brief:'Kalkulator web'})).body;
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===root.id).status==='review','root review');
  const kids=(await call('GET','/api/tasks')).body.filter(t=>t.parentId===root.id),ui=kids.find(k=>k.assignee==='Bagas Pratama Putra');
  browser=await launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(t=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken',t);}catch{}},token);
  await page.goto(origin);await page.waitForFunction(()=>window.officeTasks?.list().length===3);
  await page.click('#bTasks');await page.locator(`.task-card[data-task-id="${ui.id}"] .task-card-open`).click();
  // Flow: the selected task's root, its real children, and an Owner node for the final result.
  await page.click('[data-view="flow"]');await page.locator('#taskFlow .flow-node').first().waitFor();
  assert.equal(await page.inputValue('#flowRoot'),root.id,'flow focuses the root of the selected task');
  assert.deepEqual((await page.locator('#taskFlow .flow-node[data-task-id]').evaluateAll(n=>n.map(x=>x.dataset.taskId))).sort(),[root.id,...kids.map(k=>k.id)].sort());
  assert.equal(await page.locator('#taskFlow .flow-node-owner').count(),1);
  const flowText=(await page.locator('#taskFlow .flow-node').allInnerTexts()).join(' | ');assert.doesNotMatch(flowText,/Kak Sinta|Yoga|Koh Arman/,'allowed-but-unused routes and rejected people are not drawn as nodes');
  assert.doesNotMatch(flowText,/\d+\s*%/,'no invented percentages');assert.match(flowText,/2\/2 subtugas selesai/);
  await page.waitForFunction(()=>/Kak Sinta/.test(document.querySelector('#taskFlow .flow-rejected')?.innerText||''),null,{timeout:10000}).catch(()=>{});
  assert.match(await page.locator('#taskFlow .flow-rejected').innerText(),/Kak Sinta/,'route-denied delegation is listed as rejected, not as an edge');
  const events=(await call('GET','/api/task-events?after=0')).body.events.filter(e=>e.rootId===root.id);
  assert.equal(await page.locator('#taskFlow .flow-edge[data-kind="delegation"]').count(),events.filter(e=>e.type==='delegation.created').length);
  assert.equal(await page.locator('#taskFlow .flow-edge[data-kind="result"]').count(),events.filter(e=>e.type==='result.submitted').length);
  for(const seq of await page.locator('#taskFlow .flow-edge').evaluateAll(n=>n.map(x=>Number(x.dataset.eventSeq))))assert.ok(events.some(e=>e.seq===seq),'every edge is a stored event');
  // Clicking an edge opens its source message; clicking a node opens the task detail.
  await page.locator(`#taskFlow .flow-edge-label[data-kind="delegation"][data-task-id="${ui.id}"]`).click();
  await page.locator('#flowInspector',{hasText:'Tombol angka besar'}).waitFor();
  await page.locator(`#taskFlow .flow-node[data-task-id="${kids.find(k=>k!==ui).id}"]`).click();await page.locator('#taskDetail',{hasText:'Logika hitung'}).waitFor();
  // Pan and zoom move the canvas without changing the graph.
  await page.click('[data-view="flow"]');const before=await page.locator('#taskFlow .flow-canvas').getAttribute('style');await page.click('#flowZoomIn');assert.notEqual(await page.locator('#taskFlow .flow-canvas').getAttribute('style'),before);
  // Console: real events, escaped, filterable, pausable, exportable without secrets.
  await page.click('[data-view="console"]');await page.locator('#taskConsole .console-row').first().waitFor();
  assert.match(await page.locator('#taskConsole').innerText(),/delegation\.created/);assert.match(await page.locator('#taskConsole').innerText(),/<img src=x/);
  assert.equal(await page.evaluate(()=>window.__flowXss||false),false);
  await page.selectOption('#consoleAgent','Bagas Pratama Putra');
  assert.ok((await page.locator('#taskConsole .console-row .console-agent').allInnerTexts()).every(t=>t.trim()==='Bagas Pratama Putra'));
  const run=await page.locator('#consoleRun option').evaluateAll(o=>o.map(x=>x.value).find(v=>v&&v!=='all'));assert.ok(run,'runs are listed');
  await page.selectOption('#consoleRun',run);assert.ok((await page.locator('#taskConsole .console-row').evaluateAll(r=>r.map(x=>x.dataset.runId))).every(id=>id===run));
  await page.selectOption('#consoleAgent','all');await page.selectOption('#consoleRun','all');
  const rows=await page.locator('#taskConsole .console-row').count();await page.click('#consolePause');
  const seen=await page.evaluate(()=>window.officeTasks.events().length);
  assert.equal((await call('POST',`/api/tasks/${root.id}/messages`,{text:'Tolong cek warna tombol'})).status,201);
  await page.waitForFunction(n=>window.officeTasks.events().length>n,seen);
  assert.equal(await page.locator('#taskConsole .console-row').count(),rows,'pause stops the view, not ingestion');assert.match(await page.locator('#consoleNew').innerText(),/1 baru/);
  await page.click('#consolePause');await page.waitForFunction(n=>document.querySelectorAll('#taskConsole .console-row').length>n,rows);
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#consoleExport')]);
  const exported=fs.readFileSync(await download.path(),'utf8');assert.match(exported,/delegation\.created/);assert.doesNotMatch(exported,/SECRET777|credential/);
  console.log('PASS: event-built flow graph with owner/result edges, edge→message, node→detail, zoom; console filters, escaping, pause and sanitized export');
 }finally{if(browser)await browser.close();server.kill();mock.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
