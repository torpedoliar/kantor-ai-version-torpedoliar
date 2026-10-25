// Komunikasi: a real agent question becomes a persistent toast that opens the exact decision; answering resumes the
// worker once; unread counts follow what the owner has actually seen; drafts survive reload.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43561),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-messenger-'));
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',DRY_RUN_DELAY_MS:'200'},stdio:['ignore','pipe','inherit']});
const started=new Promise((r,j)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&r());child.on('exit',c=>j(Error('exit '+c)));});
const wait=async(fn,label,ms=20000)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,100));}};
(async()=>{await started;let browser;try{
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf;let token='';
  const call=async(method,p,body)=>{const r=await fetch(origin+p,{method,headers:{'content-type':'application/json',origin,'x-kantor-csrf':csrf,...(token?{'x-kantor-org':token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
  token=(await call('POST','/api/org/unlock',{pin:'2468'})).body.token;
  browser=await launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});page.on('pageerror',e=>console.error('PAGEERR',e.message));
  await page.addInitScript(t=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');sessionStorage.setItem('kantor-ai.orgToken',t);}catch{}},token);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.officeTasks&&window.Messenger);
  assert.equal(await page.locator('#bCommunications').isVisible(),true,'Komunikasi lives in the rail');
  // A short brief makes the dry-run agent ask: that real question must surface as a toast naming agent and task.
  const ask=(await call('POST','/api/tasks',{title:'Caption peluncuran',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Singkat'})).body;
  const toast=page.locator('#notificationCenter .toast[data-decision-id]');await toast.waitFor({timeout:20000});
  assert.match(await toast.innerText(),/KR menunggu jawabanmu · Caption peluncuran/);
  assert.match(await page.locator('#bCommunications').innerText(),/[1-9]/,'unread count shows (acknowledgement + question)');assert.equal(await page.locator('#bCommunications .decision-dot').isVisible(),true);
  await page.waitForTimeout(3500);assert.equal(await toast.count(),1,'toast persists and is not duplicated by polling/reconnect');
  // Unrelated messages do not steal focus from what the owner is typing.
  await page.click('#bTasks');await page.click('#taskCreate');await page.locator('#taskTitle').focus();
  // A note on another task (one that is not waiting on questions) arrives while the owner types.
  const other=(await call('POST','/api/tasks',{title:'Catatan lain',assignee:'Koh Arman',division:'leadership',asLead:true,brief:'manual'})).body;
  await call('POST',`/api/tasks/${other.id}/messages`,{text:'Catatan lain dari owner via API'});
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>document.activeElement.id),'taskTitle');
  // The rail's Keputusan button and the blocked task in Tugas lead to the same decision card.
  await page.click('#closeTasks');await page.click('#decisions');await page.locator('#communicationDialog[open]').waitFor();
  assert.equal(await page.locator('#messageTimeline .decision-card[data-status="open"]').getAttribute('data-decision-id'),await toast.getAttribute('data-decision-id'));
  await page.click('#bTasks');await page.locator(`.task-card[data-task-id="${ask.id}"] .task-card-open`).click();
  await page.locator('#taskDetail').getByRole('button',{name:'Jawab di Komunikasi'}).click();await page.locator('#communicationDialog[open]').waitFor();
  await page.waitForFunction(()=>document.activeElement.id==='decisionAnswer');await page.keyboard.press('Escape');
  // Claude-Code-style status and activity: what the agent is doing now, and what happened, from real events.
  const act=(await call('GET',`/api/tasks/${ask.id}/activity`)).body;
  assert.equal(act.status.label,'Menunggu jawabanmu');assert.ok(act.items.some(i=>/mulai mengerjakan/.test(i.text)),'start line from model.started');
  assert.ok(act.items.some(i=>/bertanya kepadamu/.test(i.text)),'question line');
  // Toast click opens the exact thread and decision card.
  await toast.click();await page.locator('#communicationDialog[open]').waitFor();
  assert.equal(await page.locator('#threadList [aria-current="true"]').getAttribute('data-thread-id'),ask.id);
  const card=page.locator('#messageTimeline .decision-card[data-status="open"]');await card.waitFor();assert.match(await card.innerText(),/who is this for/);
  await page.waitForFunction(()=>document.activeElement.id==='decisionAnswer',null,{timeout:5000}).catch(()=>{});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'decisionAnswer','answer box gets focus');
  // The thread shows a live status bar and activity lines between bubbles.
  assert.match(await page.locator('#threadStatus').innerText(),/Menunggu jawabanmu/);
  assert.ok(await page.locator('#messageTimeline .activity-line').count()>=2,'activity lines are shown in the timeline');
  assert.match(await page.locator('#messageTimeline').innerText(),/mulai mengerjakan/);
  // Reading marks the thread read, but the decision stays open.
  await wait(async()=>(await call('GET','/api/communications')).body.threads.find(t=>t.id===ask.id).unread===0,'read cursor');
  assert.equal((await call('GET','/api/communications')).body.decisions.find(d=>d.taskId===ask.id).status,'open');
  assert.equal(await page.locator('#bCommunications .decision-dot').isVisible(),true,'read status does not resolve a decision');
  // Draft survives reload.
  await page.fill('#decisionAnswer','Untuk pengikut Instagram, peluncuran Jumat.');
  await page.reload();await page.waitForFunction(()=>window.Messenger&&!document.querySelector('#bLock').disabled);await page.click('#bCommunications');
  await page.locator(`#threadList [data-thread-id="${ask.id}"]`).click();
  assert.equal(await page.inputValue('#decisionAnswer'),'Untuk pengikut Instagram, peluncuran Jumat.');
  // Keyboard-only send: Ctrl+Enter answers; the worker resumes exactly once.
  const calls=()=>call('GET','/api/task-events?after=0').then(r=>r.body.events.filter(e=>e.type==='model.started'&&e.taskId===ask.id).length);
  const before=await calls();
  await page.locator('#decisionAnswer').focus();await page.keyboard.press('Control+Enter');
  await page.locator('#messageTimeline .decision-card[data-status="answered"]').waitFor();
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===ask.id).status==='review','resumed to review');
  assert.equal(await calls(),before+1,'answer resumes the worker exactly once');
  await wait(async()=>!(await toast.count()),'toast leaves once the decision is answered');
  // A second question answered by simply typing in the chat composer resumes the agent too (the live bug).
  const ask2=(await call('POST','/api/tasks',{title:'Caption kedua',assignee:'Kak Rani',division:'marketing',asLead:false,brief:'Pendek'})).body;
  await page.locator(`#notificationCenter .toast[data-decision-id]`).waitFor({timeout:20000});
  await page.locator(`#threadList [data-thread-id="${ask2.id}"]`).click();
  assert.equal(await page.locator('#messageTimeline .decision-card[data-status="open"]').count(),1,'the open decision card is shown in the thread');
  assert.match(await page.locator('label[for="composerText"]').innerText(),/jawab|pertanyaan/i,'composer says a reply answers the waiting questions');
  await page.fill('#composerText','Bebas, terserah kamu');await page.click('#messageComposer button[type=submit]');
  await wait(async()=>(await call('GET','/api/tasks')).body.find(t=>t.id===ask2.id).status==='review','chat reply resumes the agent');
  await page.locator('#messageTimeline .decision-card[data-status="answered"]').waitFor();
  await page.locator(`#threadList [data-thread-id="${ask.id}"]`).click();
  assert.equal(await page.locator('#bCommunications .decision-dot').isVisible(),false);
  // Owner, agent and system bubbles are distinct; agent text is rendered as text.
  // Messenger polls every 2.5s: wait for the agent's result bubble rather than sampling right after the server state changes.
  await page.locator('#messageTimeline .bubble-agent').first().waitFor({timeout:10000});const owners=await page.locator('#messageTimeline .bubble-owner').count();assert.ok(owners>=1,`owner bubbles: ${owners}; thread: ${await page.locator('#threadTitle').innerText()}; html: ${(await page.locator('#messageTimeline').innerText()).slice(0,300)}`);
  // Reading old messages: a new message does not scroll the reader away.
  for(let i=0;i<25;i++)await call('POST',`/api/tasks/${ask.id}/messages`,{text:`Baris catatan panjang nomor ${i} <b>tebal?</b>`});
  await page.waitForFunction(()=>document.querySelectorAll('#messageTimeline .bubble').length>25);
  await page.locator('#messageTimeline').evaluate(t=>t.scrollTop=0);
  await call('POST',`/api/tasks/${ask.id}/messages`,{text:'Pesan paling baru'});
  await page.waitForFunction(()=>document.getElementById('messageTimeline').innerText.includes('Pesan paling baru'));
  assert.equal(await page.locator('#messageTimeline').evaluate(t=>t.scrollTop),0,'reader keeps their place');assert.equal(await page.locator('#messageTimeline b').count(),0);
  // Esc closes the top layer only: the drawer, not the whole office state.
  await page.keyboard.press('Escape');assert.equal(await page.locator('#communicationDialog').evaluate(d=>d.open),false);
  // The same thread opens from the task detail.
  await page.click('#bTasks');await page.locator(`.task-card[data-task-id="${ask.id}"] .task-card-open`).click();
  await page.locator('#taskDetail').getByRole('button',{name:'Buka percakapan'}).click();await page.locator('#communicationDialog[open]').waitFor();
  assert.equal(await page.locator('#threadList [aria-current="true"]').getAttribute('data-thread-id'),ask.id);
  // Phone: inbox and thread alternate with a back button; no page overflow.
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#messageTimeline').isVisible(),true);await page.click('#threadBack');assert.equal(await page.locator('#threadList').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  // Notifications never carry secrets or the PIN token.
  assert.doesNotMatch(await page.locator('#notificationCenter').innerHTML(),new RegExp(token));
  assert.deepEqual(errors,[]);
  console.log('PASS: question toast → exact decision, single resume, read≠resolved, draft restore, keyboard send, scroll kept, phone thread view');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
