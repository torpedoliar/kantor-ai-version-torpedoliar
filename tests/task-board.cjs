// Task workspace: one global board with exactly four columns, every task once, and a create form behind "+ Tugas".
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {launch}=require('./browser.cjs');
const PORT=Number(process.env.TEST_PORT||43521),origin=`http://127.0.0.1:${PORT}`,dir=fs.mkdtempSync(path.join(os.tmpdir(),'kantor-task-board-'));
const at=new Date(Date.now()-60000).toISOString();
const base={brief:'',result:'',progressPct:0,messages:[],kind:'work',legacy:false,version:0,priority:'normal',asLead:false,parentId:null,createdAt:at};
// Non-agent assignees only: the worker must leave these fixtures alone.
const fixtures=[
  {...base,id:'t-queued',title:'Rencana konten',assignee:'Mira',division:'marketing',status:'queued'},
  {...base,id:'t-active',title:'Perbaiki API',assignee:'Yoga',division:'engineering',status:'active',progressPct:40},
  {...base,id:'t-blocked',title:'Kalkulator web',assignee:'Koh Wira',division:'engineering',asLead:true,status:'blocked',blockedReason:'decision',questions:'Untuk siapa kalkulator ini?'},
  {...base,id:'t-review',title:'Draf FAQ',assignee:'Gilang',division:'service',status:'review',result:'FAQ versi 1'},
  {...base,id:'t-done',title:'Laporan bulanan',assignee:'Kak Dewi',division:'marketing',status:'done',result:'Selesai dikirim'},
  {...base,id:'t-child',title:'Rancang tombol',assignee:'Bagas Pratama Putra',division:'engineering',parentId:'t-blocked',rootId:'t-blocked',status:'queued'},
];
fs.writeFileSync(path.join(dir,'tasks.json'),JSON.stringify(fixtures));
const child=spawn(process.execPath,[path.join(__dirname,'../server/server.js')],{env:{...process.env,PORT:String(PORT),DATA_DIR:dir,ENV_FILE:'/nonexistent',ANTHROPIC_API_KEY:'',KANTOR_SETTINGS_KEY:Buffer.alloc(32,9).toString('base64')},stdio:['ignore','pipe','inherit']});
const started=new Promise((resolve,reject)=>{child.stdout.on('data',d=>String(d).includes('Kantor Kita:')&&resolve());child.on('exit',code=>reject(Error('server exit '+code)));});
const cardIds=page=>page.locator('.task-card[data-task-id]').evaluateAll(cards=>cards.map(card=>card.dataset.taskId));
(async()=>{await started;let browser;try{
  browser=await launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
  await page.goto(origin);await page.waitForFunction(()=>window.officeTasks?.list().length===6);
  await page.click('#bTasks');
  assert.ok(await page.locator('#taskDialog').evaluate(d=>d.classList.contains('drawer-wide')),'task workspace uses the wide drawer');
  assert.equal(await page.locator('#taskKanbanTab').count(),0,'no separate list/kanban/summary tabs');
  // Exactly four columns in order, with the agreed names.
  assert.deepEqual(await page.locator('#taskBoard [data-column]').evaluateAll(cols=>cols.map(c=>c.dataset.column)),['queued','progress','review','done']);
  assert.deepEqual(await page.locator('#taskBoard [data-column] h3').allInnerTexts().then(t=>t.map(s=>s.replace(/\s*\d+$/,'').trim())),['Tugas','Sedang dikerjakan','Review','Selesai']);
  // Every task exactly once, children included as their own cards.
  const ids=await cardIds(page);assert.deepEqual([...ids].sort(),fixtures.map(t=>t.id).sort());
  const inColumn=async(column,id)=>page.locator(`[data-column="${column}"] .task-card[data-task-id="${id}"]`).count();
  assert.equal(await inColumn('queued','t-queued'),1);assert.equal(await inColumn('queued','t-child'),1);
  assert.equal(await inColumn('progress','t-active'),1);assert.equal(await inColumn('progress','t-blocked'),1,'blocked stays In progress');
  assert.equal(await inColumn('review','t-review'),1);assert.equal(await inColumn('done','t-done'),1,'done is visible');
  assert.match(await page.locator('.task-card[data-task-id="t-blocked"]').innerText(),/Menunggu jawabanmu/);
  // Re-rendering the board keeps the keyboard on the same card.
  const activeCard=page.locator('.task-card[data-task-id="t-active"] .task-card-open');await activeCard.focus();
  await page.evaluate(()=>window.officeTasks.open());
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-task-id]')?.dataset.taskId),'t-active','a board rebuild keeps card focus');
  // A child links to its root; following the link opens the root in the detail panel.
  const childCard=page.locator('.task-card[data-task-id="t-child"]');assert.match(await childCard.innerText(),/Kalkulator web/);
  await childCard.locator('.task-root-link').click();await page.locator('#taskDetail',{hasText:'Untuk siapa kalkulator ini?'}).waitFor();
  // Person filter keeps a child standalone with its root link; division filter narrows the whole board.
  await page.selectOption('#agentFilter','Bagas Pratama Putra');assert.deepEqual(await cardIds(page),['t-child']);assert.equal(await childCard.locator('.task-root-link').count(),1);
  await page.selectOption('#agentFilter','all');await page.selectOption('#divisionFilter','marketing');assert.deepEqual((await cardIds(page)).sort(),['t-done','t-queued']);
  await page.selectOption('#divisionFilter','all');
  // Creation form is hidden until "+ Tugas"; application asks for criteria and an explicit environment.
  assert.equal(await page.locator('#taskCreateForm').isVisible(),false);
  await page.click('#taskCreate');await page.locator('#taskCreateForm').waitFor();
  assert.equal(await page.locator('#taskEnvironment').isVisible(),false,'documents need no runtime');
  await page.check('input[name="taskOutput"][value="application"]');assert.equal(await page.locator('#taskEnvironment').isVisible(),true);
  assert.deepEqual(await page.locator('#taskEnvironment option').evaluateAll(o=>o.map(x=>x.value)),['docker','windows']);assert.match(await page.locator('#taskEnvironment').innerText(),/Docker.*disarankan/i);
  assert.equal(await page.locator('input[name="taskMode"]').count(),2);
  await page.fill('#taskTitle','Kalkulator tabungan');await page.selectOption('#taskAssignee','Koh Wira');await page.fill('#taskAcceptance','Tombol hitung benar\nTampil di HP');await page.selectOption('#taskEnvironment','windows');await page.check('input[name="taskMode"][value="direct"]');
  await page.click('#taskCreateForm button[type=submit]');
  await page.waitForFunction(()=>window.officeTasks.list().some(t=>t.title==='Kalkulator tabungan'),null,{timeout:5000}).catch(async e=>{throw Error('create failed: '+await page.locator('#taskFeedback').innerText());});
  const created=(await (await fetch(origin+'/api/tasks')).json()).find(t=>t.title==='Kalkulator tabungan');
  assert.equal(created.outputType,'application');assert.equal(created.environment,'windows');assert.deepEqual(created.acceptance,['Tombol hitung benar','Tampil di HP']);assert.equal(created.executionMode,'direct');
  assert.equal(await page.locator('#taskCreateForm').isVisible(),false,'form closes after creating');
  await page.locator('#taskDetail',{hasText:'Kalkulator tabungan'}).waitFor();
  // Owner summary stays available and read-only.
  assert.equal(await page.locator('.owner-summary').count(),1);assert.equal(await page.locator('.owner-summary button').count(),0);
  // Status note follows the current settings instead of the value read at page load.
  assert.match(await page.locator('#taskNote').innerText(),/dry run/i);
  const csrf=(await (await fetch(origin+'/api/session')).json()).csrf,headers={'content-type':'application/json',origin,'x-kantor-csrf':csrf};
  const s=await (await fetch(origin+'/api/settings')).json();
  const put=await fetch(origin+'/api/settings',{method:'PUT',headers,body:JSON.stringify({version:s.version,providers:[{id:'mock',displayName:'Mock',protocol:'openai',baseUrl:'http://127.0.0.1:9',enabled:true,models:[{id:'m',source:'manual',status:'verified',enabled:true}],credential:'k'}],defaultRoute:{providerId:'mock',modelId:'m'},fallbackRoute:null,overrides:{}})});assert.equal(put.status,200);
  await page.click('#closeTasks');await page.click('#bTasks');await page.waitForFunction(()=>!/dry run/i.test(document.getElementById('taskNote').textContent));
  // No horizontal page overflow on a phone; the board itself may scroll.
  for(const [width,height] of [[390,844],[768,900]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,`no page overflow at ${width}`);assert.equal(await page.locator('#taskDialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true,`drawer fits at ${width}`);}
  // The visible furniture kit and character labels use Indonesian names.
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>officeScene.setEditing(true));
  const inventory=await page.locator('#inventoryList').innerText();assert.match(inventory,/Kursi/);assert.doesNotMatch(inventory,/Chair/);
  await page.evaluate(()=>officeScene.setEditing(false));
  const nameLabels=await page.locator('.name-label').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')).filter(Boolean));
  assert.ok(nameLabels.length&&nameLabels.every(label=>label.startsWith('Lihat ')),`character labels use Indonesian: ${nameLabels.slice(0,2)}`);
  console.log('PASS: four global columns, every task once, blocked badge, root links, filters, gated create form, live status note, focus and language');
}finally{if(browser)await browser.close();child.kill();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
