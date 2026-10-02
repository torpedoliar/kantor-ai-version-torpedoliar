// Team CRUD: validation, duplicates, rename cascade, delete guards. Throwaway server.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PORT = 4192, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-team-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: '', DRY_RUN_DELAY_MS: '50'}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise(r => server.stdout.on('data', d => String(d).includes('Kantor Kita:') && r()));
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
  } finally { server.kill(); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
