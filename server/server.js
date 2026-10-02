// Kantor Kita server: serves public/ and a small task API. Tasks assigned to an AI-enabled
// team member (roster ai.on in data/team.json) are worked by Claude, or by a labelled dry run when no API key is set.
// No login yet, so it only listens on this machine.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
try { process.loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env')); } catch { /* no .env file: dry run */ }

const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const HOST = '127.0.0.1', PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const API_URL = `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`;
const MODELS_URL = `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/models`;
const DRY_RUN = !API_KEY || process.env.ANTHROPIC_DRY_RUN === '1';
const STATES = new Set(['queued', 'active', 'blocked', 'review', 'done']);

// ---- storage: one JSON file, written atomically ----
fs.mkdirSync(DATA_DIR, {recursive: true});
let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); if (!Array.isArray(tasks)) throw new Error('not a list'); }
catch (error) { if (error.code !== 'ENOENT') { console.error(`Cannot read ${TASKS_FILE}: ${error.message}. Fix or move the file, then restart.`); process.exit(1); } }
let durable = JSON.stringify(tasks);
function save() {
  try {
  const tmp = `${TASKS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
  fs.renameSync(tmp, TASKS_FILE);
  durable=JSON.stringify(tasks);
  } catch(error) { tasks=JSON.parse(durable); throw error; }
}
const now = () => new Date().toISOString();
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
// Team roster: canonical member store. Agents' AI config lives here, not in agents.js.
const team = require('./team');
const TEAM_FILE = path.join(DATA_DIR, 'team.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
let roster = [];
try {
  roster = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
  if (!Array.isArray(roster) || !roster.length) throw new Error('empty roster');
} catch (error) {
  if (error.code === 'ENOENT') roster = structuredClone(team.SEED);
  else { console.error(`Cannot read ${TEAM_FILE}: ${error.message}. Fix or move the file, then restart.`); process.exit(1); }
}
// One-time merge: model picks saved in models.json move into the roster, then ignored.
try {
  const saved = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  for (const [name, model] of Object.entries(saved || {})) {
    const m = roster.find(m => m.n === name);
    if (m && typeof model === 'string' && model.trim() && m.ai) m.ai.model = model.trim();
  }
} catch { /* no saved model picks */ }
// Migrate old rosters: members without a manager key get the SEED default (else owner).
{
  const seedManager = new Map(team.SEED.map(m => [m.n, m.manager ?? null]));
  let migrated = false;
  for (const m of roster) {
    if (!Object.hasOwn(m, 'manager')) { m.manager = seedManager.get(m.n) ?? null; migrated = true; }
  }
  if (migrated) saveTeam();
}
function saveTeam() {
  const tmp = `${TEAM_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(roster, null, 2));
  fs.renameSync(tmp, TEAM_FILE);
}
if (!fs.existsSync(TEAM_FILE)) saveTeam();
const hasMember = name => roster.some(m => m.n === name);
const isAI = name => roster.find(m => m.n === name)?.ai?.on === true;
const aiOf = name => roster.find(m => m.n === name)?.ai || null;

// ---- agent worker: one AI member at a time, oldest queued task first ----
const busy = new Set();
async function askClaude(member, task) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: {'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: member.ai.model || MODEL, max_tokens: 2000, stream: false, system: member.ai.system,
        messages: [{role: 'user', content: `Task: ${task.title}\n\nBrief:\n${task.brief || '(no brief given)'}${task.feedback ? `\n\nPrevious draft:\n${task.result}\n\nRevision requested:\n${task.feedback}` : ''}`}]})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `Claude API returned ${response.status}`);
    const answer = (body.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
    if (!answer) throw new Error('Claude returned an empty answer');
    return answer;
  } finally { clearTimeout(timer); }
}
async function dryRun(member, task) {
  await new Promise(resolve => setTimeout(resolve, Number(process.env.DRY_RUN_DELAY_MS ?? 4000)));
  // Dry runs ask back when the brief is nearly empty, so the "Needs decision" flow can be tried without a key.
  if ((task.brief || '').trim().length < 12) return 'QUESTIONS:\n1. DRY RUN: who is this for, and what should it say?\n2. DRY RUN: any facts, links or deadlines to include?';
  return `DRY RUN: no ANTHROPIC_API_KEY is set, so this is placeholder text, not AI output.\n\n${member.role} would draft: "${task.title}".\nBrief received: ${task.brief || '(none)'}${task.feedback ? `\nRevision requested: ${task.feedback}` : ''}`;
}
async function work(name) {
  if (busy.has(name)) return;
  const member = roster.find(m => m.n === name);
  if (!member?.ai?.on) return;
  const task = tasks.filter(t => t.assignee === name && t.status === 'queued' && !t.error).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!task || tasks.some(t => t.assignee === name && t.status === 'active')) return;
  busy.add(name);
  const runId=crypto.randomUUID();
  try {
    Object.assign(task, {status: 'active', runId, version:(task.version||0)+1, updatedAt: now()}); save();
    const input=structuredClone(task);
    const answer = DRY_RUN ? await dryRun(member, input) : await askClaude(member, input);
    const current = tasks.find(t => t.id === task.id);
    // The task may have been moved back to the queue or reassigned while the agent worked.
    if (current && current.status === 'active' && current.assignee === name && current.runId === runId) {
      const by=DRY_RUN?'dry-run':(member.ai.model || MODEL),asked=answer.match(/^QUESTIONS:\s*([\s\S]+)/);
      // The agent asked instead of guessing: park the task until someone answers.
      if(asked){Object.assign(current,{status:'blocked',questions:asked[1].trim().slice(0,2000),askedBy:by,runId:null,version:(current.version||0)+1,updatedAt:now()});save();return;}
      const draft={result:answer.slice(0,10000),by,createdAt:now(),feedback:input.feedback||''};
      Object.assign(current, {status:'review',result:draft.result,by:draft.by,history:[...(current.history||[]),draft],runId:null,version:(current.version||0)+1,updatedAt:now()});save();
    }
  } catch (error) {
    const current = tasks.find(t => t.id === task.id);
    if (current && current.status === 'active' && current.assignee === name && current.runId === runId) { Object.assign(current, {status: 'queued', runId:null, version:(current.version||0)+1, error: error.name === 'AbortError' ? 'Claude took too long to answer.' : error.message === 'fetch failed' ? 'Could not reach the Claude API. Check the internet connection.' : error.message, updatedAt: now()}); save(); }
    console.error(`Agent ${name} failed on "${task.title}": ${error.message}`);
  } finally { busy.delete(name); setImmediate(() => work(name)); }
}
const kick = () => roster.filter(m => m.ai?.on).forEach(m => work(m.n));

// ---- HTTP ----
function send(res, status, body) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 1e6) { reject(Object.assign(new Error('Request too large'), {status: 413})); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), {status: 400})); } });
  });
}
function newTask(input) {
  if(!input||typeof input!=='object')return null;
  const title = text(input.title, 160), assignee = text(input.assignee, 80);
  if (!title || !assignee) return null;
  const status = STATES.has(input.status) ? input.status : 'queued', result = text(input.result, 10000);
  return {id: crypto.randomUUID(), title, assignee, brief: text(input.brief, 5000), status: ['done','review'].includes(status) && !result ? 'queued' : status, result, createdAt: now()};
}
async function api(req, res, url) {
  if (url.pathname === '/api/models' && req.method === 'GET') {
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(MODELS_URL, {signal: controller.signal, headers: {'x-api-key': API_KEY, 'anthropic-version': '2023-06-01'}});
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || `Models API returned ${response.status}`);
        return send(res, 200, Array.isArray(body.data) ? body.data.map(m => m.id).filter(Boolean) : body);
      } finally { clearTimeout(timer); }
    } catch (error) { return send(res, 502, {error: error.name === 'AbortError' ? 'Router took too long to answer.' : error.message === 'fetch failed' ? 'Could not reach the router. Check ANTHROPIC_BASE_URL.' : error.message}); }
  }
  if (url.pathname === '/api/team' && req.method === 'GET') return send(res, 200, roster);
  if (url.pathname === '/api/team' && req.method === 'POST') {
    const input = await readJson(req);
    const v = team.validateMember(input, roster, true);
    if (!v.ok) return send(res, v.code === 'dup' ? 409 : 400, {error: v.error});
    const mv = team.validateManagerAssignment(roster, v.member.n, input.manager ?? null);
    if (!mv.ok) return send(res, mv.code === 'dup' ? 409 : 400, {error: mv.error});
    const member = {ai: null, ...v.member, manager: mv.manager};
    if (member.ai && !String(input.ai?.system ?? '').trim()) member.ai.system = team.defaultSystem(member.role, mv.manager !== null);
    roster.push(member); saveTeam(); kick(); return send(res, 201, member);
  }
  const teamMatch = url.pathname.match(/^\/api\/team\/(.+)$/);
  if (teamMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const name = decodeURIComponent(teamMatch[1]);
    const member = roster.find(m => m.n === name);
    if (!member) return send(res, 404, {error: 'Unknown team member.'});
    if (req.method === 'DELETE') {
      const to = new URL(req.url, 'http://x').searchParams.get('reassignTo');
      const open = tasks.filter(t => t.assignee === name && t.status !== 'done');
      if (open.length && !to) return send(res, 409, {error: `${open.length} tasks still assigned. Pick a member to move them to.`});
      let moved = 0;
      if (to) {
        if (!hasMember(to) || to === name) return send(res, 400, {error: 'Pick another team member.'});
        moved = team.reassignTasks(tasks, name, to).moved; save();
      } else if (open.length) return send(res, 409, {error: 'Tasks still assigned.'});
      const leavingManager = member.manager ?? null;
      let subordinates = 0;
      for (const m of roster) if (m.manager === name) { m.manager = leavingManager; subordinates++; }
      roster.splice(roster.indexOf(member), 1); saveTeam(); kick();
      return send(res, 200, {removed: name, moved, subordinates});
    }
    const input = await readJson(req);
    const v = team.validateMember({...input, _self: name}, roster, false);
    if (!v.ok) return send(res, v.code === 'dup' ? 409 : 400, {error: v.error});
    if (input.manager !== undefined) {
      const mv = team.validateManagerAssignment(roster, name, input.manager);
      if (!mv.ok) return send(res, mv.code === 'dup' ? 409 : 400, {error: mv.error});
      v.member.manager = mv.manager;
    }
    if (v.member.ai && !String(input.ai?.system ?? '').trim()) v.member.ai.system = team.defaultSystem(v.member.role || member.role, (v.member.manager ?? member.manager ?? null) !== null);
    const oldName = member.n;
    Object.assign(member, v.member);
    if (v.member.n && v.member.n !== oldName) { team.cascadeRenameMember(roster, tasks, oldName, member.n); save(); }
    saveTeam(); kick(); return send(res, 200, member);
  }
  const modelMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  if (modelMatch && req.method === 'PATCH') {
    const name = decodeURIComponent(modelMatch[1]);
    const member = roster.find(m => m.n === name);
    if (!member?.ai) return send(res, 404, {error: 'Unknown AI member.'});
    const input = await readJson(req);
    const model = text(input?.model, 200);
    if (!model) return send(res, 400, {error: 'Pick a model from the router list.'});
    member.ai.model = model;
    try { saveTeam(); } catch { return send(res, 500, {error: 'Could not save the model pick.'}); }
    kick();
    return send(res, 200, {[name]: {role: member.role, model}});
  }
  if (url.pathname === '/api/agents' && req.method === 'GET')
    return send(res, 200, {mode: DRY_RUN ? 'dry-run' : 'claude', model: DRY_RUN ? null : MODEL, members: Object.fromEntries(roster.filter(m => m.ai?.on).map(m => [m.n, {role: m.role, model: m.ai.model || MODEL, ai: true, manager: m.manager ?? null, chain: team.managerChain(roster, m.n)}]))});
  if (url.pathname === '/api/tasks' && req.method === 'GET') return send(res, 200, tasks);
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const input=await readJson(req);
    if(input?.status!==undefined&&!STATES.has(input.status))return send(res,400,{error:'Unknown status.'});
    const task = newTask(input); if (!task) return send(res, 400, {error: 'A task needs a title and an assignee.'});
    if(!hasMember(task.assignee))return send(res,400,{error:'Unknown assignee.'});
    if(task.status==='review'||task.status==='blocked'||(isAI(task.assignee)&&task.status!=='queued'))return send(res,409,{error:'AI drafts must be generated before review.'});
    if(task.status==='active'&&tasks.some(t=>t.assignee===task.assignee&&t.status==='active'))return send(res,409,{error:'This member already has an active task.'});
    tasks.unshift(task); save(); send(res, 201, task); setImmediate(kick); return;
  }
  // One-time move of tasks saved in a browser before the server existed; only into an empty store.
  if (url.pathname === '/api/tasks/import' && req.method === 'POST') {
    if (tasks.length) return send(res, 409, {error: 'The server already has tasks.'});
    const list = await readJson(req); if (!Array.isArray(list)) return send(res, 400, {error: 'Expected a list of tasks.'});
    if(tasks.length)return send(res,409,{error:'The server already has tasks.'});
    tasks = list.map(item => { const task = newTask(item); if (task && typeof item.createdAt === 'string') task.createdAt = item.createdAt; if(task&&Array.isArray(item.history))task.history=item.history; return task; }).filter(Boolean);
    // Imported work that was in progress by hand goes back to the queue.
    tasks.forEach(task => { if (task.status === 'active') task.status = 'queued'; });
    save(); kick(); return send(res, 201, tasks);
  }
  const match = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
  if (match && req.method === 'PATCH') {
    const task = tasks.find(t => t.id === match[1]); if (!task) return send(res, 404, {error: 'Task not found.'});
    const input = await readJson(req), change = {};
    if(!input||typeof input!=='object')return send(res,400,{error:'Expected an object.'});
    // Answering an agent's questions adds the answers to the brief and puts the task back in its queue.
    if(input.action==='answer'){
      if(task.status!=='blocked'||input.version!==(task.version||0))return send(res,409,{error:'These questions changed. Refresh and answer the latest ones.'});
      const answer=text(input.answer,3000);if(!answer)return send(res,400,{error:'Write an answer first.'});
      Object.assign(task,{status:'queued',brief:`${task.brief}\n\nQuestions from ${task.assignee}:\n${task.questions}\n\nAnswers:\n${answer}`.trim().slice(0,5000),questions:undefined,askedBy:undefined,error:undefined,runId:null,version:(task.version||0)+1,updatedAt:now()});
      save();send(res,200,task);setImmediate(kick);return;
    }
    if(input.action!==undefined){
      if(!['approve','revise'].includes(input.action))return send(res,400,{error:'Unknown action.'});
      if(task.status!=='review'||input.version!==(task.version||0))return send(res,409,{error:'This draft changed. Refresh and review the latest version.'});
      if(input.action==='revise'&&!text(input.feedback,5000))return send(res,400,{error:'Describe the changes needed.'});
      Object.assign(task,{status:input.action==='approve'?'done':'queued',feedback:input.action==='revise'?text(input.feedback,5000):'',reviewedAt:input.action==='approve'?now():null,runId:null,error:undefined,version:(task.version||0)+1,updatedAt:now()});
      save();send(res,200,task);setImmediate(kick);return;
    }
    if (input.assignee !== undefined) { change.assignee = text(input.assignee, 80); if (!hasMember(change.assignee)) return send(res, 400, {error: 'Pick an assignee.'}); if (task.status !== 'done') change.status = 'queued'; }
    if (input.status !== undefined) {
      if (!STATES.has(input.status)||input.status==='review'||input.status==='blocked') return send(res, 400, {error: 'Unknown status.'});
      const assignee = change.assignee || task.assignee;
      if(task.status==='review'&&!change.assignee)return send(res,409,{error:'Approve this draft or request a revision.'});
      if (isAI(assignee) && input.status !== 'queued') return send(res, 409, {error: 'This member is connected to an AI agent; it starts and finishes its own tasks.'});
      if (input.status === 'active' && tasks.some(t => t.id !== task.id && t.assignee === assignee && t.status === 'active')) return send(res, 409, {error: 'This member already has an active task.'});
      if (input.status === 'done' && !text(input.result, 10000)) return send(res, 400, {error: 'Write a result before finishing.'});
      change.status = input.status; change.result = input.status === 'done' ? text(input.result, 10000) : '';
    }
    if(!Object.keys(change).length)return send(res,400,{error:'Provide an assignee, status, or review action.'});
    // Moving a task back to the queue clears a previous agent error so it is tried again.
    Object.assign(task, change, {runId:null,version:(task.version||0)+1,error: undefined, updatedAt: now()}); save(); kick(); return send(res, 200, task);
  }
  send(res, 404, {error: 'Not found.'});
}
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon'};
function serveFile(res, url) {
  let file;
  try { file = path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { return send(res, 400, {error: 'Bad path.'}); }
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, {error: 'Forbidden.'});
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404, {'content-type': 'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'}); res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  if (!url.pathname.startsWith('/api/')) return serveFile(res, url);
  try { await api(req, res, url); }
  catch (error) { send(res, error.status || 500, {error: error.status ? error.message : 'Server error.'}); if (!error.status) console.error(error); }
});
server.listen(PORT, HOST, () => {
  console.log(`Kantor Kita: http://${HOST}:${PORT}`);
  console.log(DRY_RUN ? 'AI agents: dry run (set ANTHROPIC_API_KEY in .env to use Claude)' : `AI agents: ${roster.filter(m => m.ai?.on).map(m => `${m.n} → ${m.ai.model || MODEL}`).join(', ') || 'none (all manual)'}`);
  // Tasks left active by a previous run go back to the queue and are picked up again.
  let reset = false; tasks.forEach(task => { if (task.status === 'active' && isAI(task.assignee)) { task.status = 'queued'; reset = true; } }); if (reset) save();
  kick();
});
