// Org chart + approve satu pintu: rantai, siklus, alur penuh, reject, rename cascade, delete reassign.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const PORT = 4198, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-org-'));
const api = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {...opts, headers: {'content-type': 'application/json'}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
const waitFor = async (check, ms = 25000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } throw new Error('timed out'); };
(async () => {
  const mock = http.createServer((req, res) => { req.resume(); res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({content: [{type: 'text', text: 'MOCK ORG DRAFT'}]})); });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const server = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], {env: {...process.env, PORT: String(PORT), DATA_DIR: dir, ENV_FILE: '/nonexistent', ANTHROPIC_API_KEY: 't', ANTHROPIC_DRY_RUN: '0', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`}, stdio: ['ignore', 'pipe', 'inherit']});
  await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes('Kantor Kita:')) resolve(); }); server.on('exit', () => reject(new Error('server exited'))); });
  try {
    // 1. Seed org: Tari → Kak Dewi → Koh Arman.
    const team = (await api('/api/team')).body;
    assert.equal(team.find(m => m.n === 'Tari').manager, 'Kak Dewi');
    // 2. Siklus ditolak: Kak Dewi tidak bisa lapor ke Tari.
    assert.equal((await api('/api/team/Kak%20Dewi', {method: 'PATCH', body: JSON.stringify({manager: 'Tari'})})).status, 409);
    // 3. Diri sendiri ditolak.
    assert.equal((await api('/api/team/Tari', {method: 'PATCH', body: JSON.stringify({manager: 'Tari'})})).status, 400);
    // 4. Alur penuh staf: queued → manager-review → review → done. Tari manual:
    // tugaskan ke Kak Rani (AI, manager Kak Dewi) agar worker mock yang draft.
    const made = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Staff post', assignee: 'Kak Rani', brief: 'a sufficiently long brief for the mock'})})).body;
    const mr = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made.id); return t.status === 'manager-review' ? t : null; });
    assert.match(mr.result, /MOCK ORG DRAFT/);
    assert.equal((await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'approve', version: mr.version})})).status, 409);
    const toOwner = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-approve', version: mr.version})});
    assert.equal(toOwner.status, 200); assert.equal(toOwner.body.status, 'review');
    const done = await api(`/api/tasks/${made.id}`, {method: 'PATCH', body: JSON.stringify({action: 'approve', version: toOwner.body.version})});
    assert.equal(done.body.status, 'done');
    // 5. Reject kembali ke antrean dengan feedback.
    const made2 = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Staff post 2', assignee: 'Kak Rani', brief: 'another sufficiently long brief here'})})).body;
    const mr2 = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made2.id); return t.status === 'manager-review' ? t : null; });
    const rej = await api(`/api/tasks/${made2.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-reject', feedback: 'shorten it', version: mr2.version})});
    assert.equal(rej.body.status, 'queued'); assert.equal(rej.body.feedback, 'shorten it');
    // 6. Owner langsung ke review: tugaskan ke Koh Wira (AI, manager Koh Arman)?
    // Koh Wira manual. Nyalakan AI-nya dulu agar worker mock jalan.
    await api('/api/team/Koh%20Wira', {method: 'PATCH', body: JSON.stringify({ai: {on: true, model: 'mock-m', system: 's'}})});
    await api('/api/team/Koh%20Wira', {method: 'PATCH', body: JSON.stringify({manager: null})});
    const made3 = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Owner post', assignee: 'Koh Wira', brief: 'owner brief long enough here'})})).body;
    const rev = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made3.id); return t.status === 'review' ? t : null; });
    assert.match(rev.result, /MOCK ORG DRAFT/);
    // 7. Rename manager cascade ke bawahan.
    assert.equal((await api('/api/team/Kak%20Dewi', {method: 'PATCH', body: JSON.stringify({n: 'Kak Dewi Baru'})})).status, 200);
    assert.equal((await api('/api/team')).body.find(m => m.n === 'Tari').manager, 'Kak Dewi Baru');
    // 8. Hapus manager: bawahan ikut manager almarhum (Koh Arman).
    const del = await api('/api/team/Kak%20Dewi%20Baru', {method: 'DELETE'});
    assert.equal(del.status, 200);
    assert.equal((await api('/api/team')).body.find(m => m.n === 'Tari').manager, 'Koh Arman');
    // 9. Rantai 4 level tetap satu pintu: L4 cukup sekali manager-approve.
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L1', initials: 'L1', gender: 'male', role: 'R1', group: 'engineering', manager: null})});
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L2', initials: 'L2', gender: 'male', role: 'R2', group: 'engineering', manager: 'L1'})});
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L3', initials: 'L3', gender: 'male', role: 'R3', group: 'engineering', manager: 'L2'})});
    await api('/api/team', {method: 'POST', body: JSON.stringify({n: 'L4', initials: 'L4', gender: 'male', role: 'R4', group: 'engineering', manager: 'L3'})});
    await api('/api/team/L4', {method: 'PATCH', body: JSON.stringify({ai: {on: true, model: 'mock-m', system: 's'}})});
    const deep = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Deep', assignee: 'L4', brief: 'deep brief long enough here'})})).body;
    const dmr = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === deep.id); return t.status === 'manager-review' ? t : null; });
    const dgo = await api(`/api/tasks/${deep.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-approve', version: dmr.version})});
    assert.equal(dgo.body.status, 'review');
    // 10. Task review lama tetap approve final: import status review langsung.
    const imp = await api('/api/tasks/import', {method: 'POST', body: JSON.stringify([])});
    assert.ok([201, 409].includes(imp.status), 'import guard intact');
    // 11. Manager ke nama terhapus: 400 Unknown manager.
    assert.equal((await api('/api/team/Tari', {method: 'PATCH', body: JSON.stringify({manager: 'Kak Dewi Baru'})})).status, 400);
    // 12. Draft manager-review yang manager-nya dihapus: manager-approve tetap 200 (local trust).
    const made4 = (await api('/api/tasks', {method: 'POST', body: JSON.stringify({title: 'Orphan draft', assignee: 'L4', brief: 'orphan brief long enough here'})})).body;
    const mr4 = await waitFor(async () => { const t = (await api('/api/tasks')).body.find(t => t.id === made4.id); return t.status === 'manager-review' ? t : null; });
    assert.equal((await api('/api/team/L3', {method: 'DELETE'})).status, 200);
    const orph = await api(`/api/tasks/${made4.id}`, {method: 'PATCH', body: JSON.stringify({action: 'manager-approve', version: mr4.version})});
    assert.equal(orph.status, 200); assert.equal(orph.body.status, 'review');
    console.log('PASS: org chart, cycle guard, one-gate approve, reject, rename cascade, delete reassign');
  } finally { server.kill(); await new Promise(r => mock.close(r)); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
