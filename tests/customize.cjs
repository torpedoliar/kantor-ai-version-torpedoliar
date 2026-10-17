const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.OFFICE_URL || 'http://127.0.0.1:4173';
const shot = name => path.join(os.tmpdir(), name);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.officeScene && window.officeScene.customize, null, { timeout: 60000 });

  // Sanity: scene intact, both header buttons present (bTasks restore + bCustom).
  const snap = await page.evaluate(() => officeScene.snapshot());
  assert.equal(snap.team.length, 13);
  assert.equal(await page.locator('#bTasks').count(), 1);
  assert.equal(await page.locator('#bCustom').count(), 1);
  console.log('PASS: scene loads with Tasks + Customize buttons');

  // Registry covers the 6 types + movable billiard; meeting tables tagged via sub.
  const items = await page.evaluate(() => officeScene.customize.list());
  assert.ok(items.length >= 20, `expected >=20 customizable items, got ${items.length}`);
  const types = new Set(items.map(i => i.type));
  for (const t of ['table', 'chair', 'sofa', 'plant', 'lamp', 'billiard']) {
    assert.ok(types.has(t), `missing type ${t} (have: [...types])`);
  }
  assert.ok(items.some(i => i.type === 'table' && i.sub === 'meeting'), 'meeting table tagged via sub');
  assert.ok(items.every(i => Number.isFinite(i.x) && Number.isFinite(i.z) && Number.isFinite(i.rot)), 'all items have x/z/rot');
  console.log(`PASS: registry ${items.length} items, 6 types + billiard`);

  // Enter Mode Edit via the header button.
  assert.equal(await page.evaluate(() => officeScene.snapshot().routine), true);
  await page.click('#bCustom');
  assert.equal(await page.evaluate(() => officeScene.customize.isEditing()), true);
  assert.equal(await page.locator('#customPanel').isVisible(), true);
  assert.equal(await page.locator('#bCustom').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => officeScene.snapshot().routine), false, 'routine pauses in edit mode');
  assert.match(await page.locator('#cSelected').innerText(), /No selection|Selected/);
  console.log('PASS: Mode Edit opens, routine pauses');

  // Pick a floor-3 item whose projection avoids the right-side panel.
  const target = await page.evaluate(() => {
    const c = officeScene.customize;
    const ids = c.list().filter(i => i.floor === 3).map(i => i.id);
    for (const id of ids) {
      const p = c.screen(id);
      if (p && p.x > 60 && p.x < 1000 && p.y > 120 && p.y < 820) return { id, ...p };
    }
    return null;
  });
  assert.ok(target, 'found a clickable floor-3 item');

  // Real pointer click selects (raycast path, not just the API).
  await page.mouse.click(target.x, target.y);
  assert.equal(await page.evaluate(() => officeScene.customize.selected()), target.id);
  const draft = await page.evaluate(() => officeScene.customize.draft());
  assert.ok(draft && Number.isFinite(draft.x), 'draft created on select');
  assert.match(await page.locator('#cSelected').innerText(), /Selected/);
  console.log(`PASS: click selects ${target.id}`);

  // Symmetric kinds hide the rotation knob.
  const symId = await page.evaluate(() => {
    const c = officeScene.customize;
    const it = c.list().find(i => i.symmetric);
    if (it) c.select(it.id);
    return it ? it.id : null;
  });
  assert.ok(symId, 'a symmetric item exists');
  assert.equal(await page.locator('#cRotWrap').isHidden(), true, 'rotation hidden for symmetric plant/lamp');
  await page.evaluate(id => officeScene.customize.select(id), target.id);
  assert.equal(await page.locator('#cRotWrap').isHidden(), false, 'rotation shown for asymmetric furniture');

  // Apply a move to a free spot via the API (clamped + saved path).
  const moved = await page.evaluate(id => {
    const c = officeScene.customize;
    const me = c.list().find(i => i.id === id);
    const others = c.list().filter(i => i.id !== id && i.floor === me.floor);
    const r = me.radius + 0.1;
    const cx0 = v => Math.max(-16 + r, Math.min(16 - r, v));
    const cz0 = v => Math.max(-12 + r, Math.min(12 - r, v));
    const free = (x, z) => others.every(o => Math.hypot(o.x - x, o.z - z) >= o.radius + me.radius + 0.3);
    let best = null, bestD = 1e9;
    for (let gx = -15; gx <= 15; gx += 0.5) for (let gz = -11; gz <= 11; gz += 0.5) {
      const x = cx0(gx), z = cz0(gz);
      if (!free(x, z)) continue;
      const d = Math.hypot(x - me.x, z - me.z);
      if (d > 0.5 && d < bestD) { bestD = d; best = { x, z }; }
    }
    if (!best) return null;
    return { ok: c.applyMove(id, best.x, best.z), ...best };
  }, target.id);
  assert.ok(moved, 'found a free spot for the move');
  assert.equal(moved.ok, true);
  assert.match(await page.locator('#cMsg').innerText(), /Applied/);
  const after = await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id);
  assert.ok(Math.abs(after.x - moved.x) < 0.01 && Math.abs(after.z - moved.z) < 0.01, 'position updates after apply');
  console.log('PASS: apply move to free spot');

  // Overlap is rejected with a message and no position change.
  const blocked = await page.evaluate(id => {
    const c = officeScene.customize;
    const me = c.list().find(i => i.id === id);
    const other = c.list().find(i => i.id !== id && i.floor === me.floor);
    const ok = c.applyMove(id, other.x, other.z);
    const now = c.list().find(i => i.id === id);
    return { ok, otherId: other.id, sameX: Math.abs(now.x - me.x) < 1e-9, sameZ: Math.abs(now.z - me.z) < 1e-9 };
  }, target.id);
  assert.equal(blocked.ok, false, 'move onto another item rejected');
  assert.ok(blocked.sameX && blocked.sameZ, 'position unchanged after blocked move');
  assert.match(await page.locator('#cMsg').innerText(), /Blocked: overlaps/, 'overlap message shown');
  console.log(`PASS: overlap onto ${blocked.otherId} rejected`);

  // Rotate 90° via the panel button, then Apply.
  const rotBefore = (await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id)).rot;
  await page.click('#cRot90');
  await page.click('#cApply');
  const rotAfter = (await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id)).rot;
  assert.equal(rotAfter, (Math.round(rotBefore) + 90) % 360);
  console.log('PASS: Rotate 90° + Apply');

  // Numeric X input changes the draft; Cancel discards it.
  const cur = await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id);
  await page.fill('#cX', String(Math.round((cur.x + 0.7) * 10) / 10));
  const draftX = await page.evaluate(() => officeScene.customize.draft().x);
  assert.ok(Math.abs(draftX - (cur.x + 0.7)) < 0.11, 'typing X updates the draft');
  await page.click('#cCancel');
  assert.match(await page.locator('#cMsg').innerText(), /discarded/);
  const kept = await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id);
  assert.ok(Math.abs(kept.x - cur.x) < 0.01, 'cancel keeps the applied position');
  console.log('PASS: numeric input + Cancel');

  // Slots: switch to Slot 1, rename, persist across reload, reset to home.
  await page.selectOption('#cSlot', '1');
  assert.equal(await page.evaluate(() => officeScene.customize.slots().current), 1);
  await page.fill('#cSlotName', 'Uji Slot');
  await page.click('#cRename');
  assert.match(await page.locator('#cMsg').innerText(), /Saved as/);
  assert.ok((await page.evaluate(() => officeScene.customize.slots())).names.includes('Uji Slot'));
  const slotPos = await page.evaluate(id => {
    const c = officeScene.customize;
    const me = c.list().find(i => i.id === id);
    c.applyMove(id, me.x, me.z, (me.rot + 10) % 360);
    return c.list().find(i => i.id === id);
  }, target.id);
  await page.reload();
  await page.waitForFunction(() => window.officeScene && window.officeScene.customize, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => officeScene.customize.slots().current), 1, 'last slot remembered');
  const persisted = await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id);
  assert.ok(Math.abs(persisted.x - slotPos.x) < 0.01 && persisted.rot === slotPos.rot, 'slot layout persists');
  console.log('PASS: slot rename + persist across reload');

  // Re-seat check: the moved item's seats still resolve; nav grid rebuilds.
  const seats = await page.evaluate(() => {
    const s = officeScene.snapshot();
    const nav = officeScene.navGrid(s.floor);
    return { team: s.team.length, cells: nav.cells.length, expected: nav.w * nav.h };
  });
  assert.equal(seats.team, 13);
  assert.equal(seats.cells, seats.expected);
  await page.click('#bCustom');
  await page.evaluate(id => officeScene.customize.select(id), target.id);
  await page.click('#cReset');
  assert.match(await page.locator('#cMsg').innerText(), /Back to Default/);
  const home = await page.evaluate(id => officeScene.customize.list().find(i => i.id === id), target.id);
  assert.ok(Math.abs(home.x - home.home.x) < 1e-9 && Math.abs(home.z - home.home.z) < 1e-9, 'reset restores home');
  console.log('PASS: nav grid + reset to Default');

  // Exit edit mode: Default slot is read-only, routine resumes.
  await page.selectOption('#cSlot', '0');
  assert.equal(await page.evaluate(() => officeScene.customize.rename('X')), false, 'Default cannot be renamed');
  await page.click('#cClose');
  assert.equal(await page.evaluate(() => officeScene.customize.isEditing()), false);
  assert.equal(await page.evaluate(() => officeScene.snapshot().routine), true, 'routine resumes after edit');
  console.log('PASS: exit edit, routine resumes');

  // Narrow viewport: panel must not cause horizontal overflow.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.click('#bCustom');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: shot('kantor-customize-375.png') });
  await page.click('#cClose');

  assert.deepEqual(errors, []);
  console.log('PASS: mobile panel, no JavaScript errors');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
