// Team CRUD + AI toggle: validation, duplicates, rename cascade, delete guards,
// AI on/off via roster, stale-worker guard after mid-run delete. Throwaway servers.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const PORT = 4192, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-team-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
function start(extraEnv) {
  const child = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: '', DRY_RUN_DELAY_MS: '50', ...extraEnv}, stdio: ['ignore', 'pipe', 'inherit']});
  return new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('Kantor Kita:')) resolve(child); }); child.on('exit', () => reject(new Error('server exited'))); });
}
const waitFor = async (check, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } throw new Error('timed out'); };
(async () => {
  const server = await start();
  try {
    assert.equal((await api('/api/team')).body.length, 13);
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'Kak Rani', initials: 'XX', gender: 'female', role: 'X', group: 'marketing'})})).status, 409);
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'Budi', initials: 'KR', gender: 'male', role: 'Dev', group: 'engineering'})})).status, 409);
    // Review Focus: case-insensitive name duplicate.
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'kak rani', initials: 'KX', gender: 'female', role: 'X', group: 'marketing'})})).status, 409);
    assert.equal((await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'Budi', initials: 'BD', gender: 'male', role: 'Dev', group: 'engineering'})})).status, 201);
    assert.equal((await api('/api/team')).body.length, 14);
    // Review Focus: stored raw; rendering stays safe via textContent-only paths (tasks.js node(), office.js textContent).
    const xss = await api('/api/team', {method: 'POST', body: JSON.stringify({n: '<img src=x onerror=alert(1)>', initials: 'X1', gender: 'male', role: 'Dev', group: 'engineering'})});
    assert.equal(xss.status, 201);
    assert.equal(xss.body.n, '<img src=x onerror=alert(1)>');
    await api('/api/team/' + encodeURIComponent('<img src=x onerror=alert(1)>'), {method: 'DELETE'});
    // Rename cascades to tasks.
    await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'T1', assignee: 'Budi'})});
    assert.equal((await api('/api/team/Budi', {method: 'PATCH', body: JSON.stringify({n: 'Budi Santoso'})})).status, 200);
    assert.equal((await api('/api/tasks')).body.find(t => t.title === 'T1').assignee, 'Budi Santoso');
    // Review Focus: rename onto an existing name fails and leaves tasks untouched.
    assert.equal((await api('/api/team/Budi%20Santoso', {method: 'PATCH', body: JSON.stringify({n: 'Koh Wira'})})).status, 409);
    assert.equal((await api('/api/tasks')).body.find(t => t.title === 'T1').assignee, 'Budi Santoso');
    // Delete blocked without reassignTo, works with it.
    assert.equal((await api('/api/team/Budi%20Santoso', {method: 'DELETE'})).status, 409);
    const del = await api('/api/team/Budi%20Santoso?reassignTo=Koh%20Wira', {method: 'DELETE'});
    assert.equal(del.status, 200); assert.equal(del.body.moved, 1);
    assert.equal((await api('/api/tasks')).body.find(t => t.title === 'T1').assignee, 'Koh Wira');
    console.log('PASS: team CRUD part 1');
  } finally { server.kill(); }
  // Part 2: AI toggle + stale-worker guard, against a mock Anthropic endpoint.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-team-ai-'));
  const api2 = (p, opts = {}) => fetch(`http://127.0.0.1:4193${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
  const mock = http.createServer((req, res) => {
    req.resume();
    setTimeout(() => { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({content: [{type: 'text', text: 'MOCK DRAFT'}]})); }, 800);
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const server2 = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], {env: {...process.env, PORT: '4193', DATA_DIR: dir2, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_DRY_RUN: '0', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((resolve, reject) => { server2.stdout.on('data', d => { if (String(d).includes('Kantor Kita:')) resolve(); }); server2.on('exit', () => reject(new Error('server exited'))); });
  try {
    // Manual member's task is never picked up.
    const manual = (await api2('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Manual job', assignee: 'Koh Wira'})})).body;
    await new Promise(r => setTimeout(r, 1500));
    assert.equal((await api2('/api/tasks')).body.find(t => t.id === manual.id).status, 'queued');
    // Toggle AI on: the mock drafts it.
    assert.equal((await api2('/api/team/Koh%20Wira', {method: 'PATCH', body: JSON.stringify({ai: {on: true, model: 'mock-model', system: 'Reply exactly: MOCK DRAFT'}})})).status, 200);
    const drafted = await waitFor(async () => { const t = (await api2('/api/tasks')).body.find(t => t.id === manual.id); return t.status === 'review' ? t : null; });
    assert.equal(drafted.by, 'mock-model');
    assert.match(drafted.result, /MOCK DRAFT/);
    // Review Focus: delete + reassign mid-run; the late mock result must not overwrite.
    const ai2 = (await api2('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Mid-run move', assignee: 'Kak Rani'})})).body;
    await waitFor(async () => (await api2('/api/tasks')).body.find(t => t.id === ai2.id).status === 'active');
    assert.equal((await api2('/api/team/Kak%20Rani?reassignTo=Koh%20Arman', {method: 'DELETE'})).status, 200);
    await new Promise(r => setTimeout(r, 1500));
    const after = (await api2('/api/tasks')).body.find(t => t.id === ai2.id);
    assert.equal(after.assignee, 'Koh Arman');
    assert.equal(after.status, 'queued');
    assert.ok(!after.error);
    console.log('PASS: AI toggle part 2');
  } finally { server2.kill(); await new Promise(r => mock.close(r)); fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(dir2, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
