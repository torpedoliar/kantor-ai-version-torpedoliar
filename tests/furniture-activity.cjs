const assert = require('node:assert/strict');
const { launch } = require('./browser.cjs');
// Fresh data dirs have no owner PIN; keep the first-run organization wizard out of the way.
const skipWizard=async page=>{await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});return page;};
const URL = process.env.OFFICE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }).then(skipWizard);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.officeScene?.customize, null, { timeout: 60000 });

  const target = await page.evaluate(() => {
    const item = officeScene.customize.list().find(candidate => candidate.floor === 3 && candidate.type === 'sofa' && !candidate.generated && officeScene.customize.seats(candidate.id).some(seat => seat.state === 'lounge'));
    const seat = item && officeScene.customize.seats(item.id).find(candidate => candidate.state === 'lounge');
    return item && { id: item.id, before: { x: item.x, z: item.z }, seat: { x: seat.x, z: seat.z } };
  });
  assert.ok(target, 'found a lounge sofa with linked seats');
  // Team desk chairs follow the organization and cannot be moved in Tata ruang.
  assert.equal(await page.evaluate(() => { const c = officeScene.customize; const desk = c.list().find(i => i.generated && i.type === 'chair'); return c.select(desk.id); }), null);

  const moved = await page.evaluate(id => {
    const c = officeScene.customize;
    const item = c.list().find(candidate => candidate.id === id);
    const free = (x, z) => c.list().filter(other => other.id !== id && other.floor === item.floor).every(other => {
      const clearance = other.radius + item.radius + .15;
      return Math.hypot(other.x - x, other.z - z) >= clearance;
    });
    for (let x = -15; x <= 15; x += .5) for (let z = -11; z <= 11; z += .5) {
      if (Math.hypot(x - item.x, z - item.z) > 2 && free(x, z)) {
        return { ok: c.applyMove(id, x, z), x, z };
      }
    }
    return { ok: false };
  }, target.id);
  assert.equal(moved.ok, true, `linked furniture can be moved to a free location: ${JSON.stringify(moved)}`);

  const after = await page.evaluate(id => {
    const item = officeScene.customize.list().find(candidate => candidate.id === id);
    const seat = officeScene.customize.seats(id).find(candidate => candidate.state === 'lounge');
    return { item, seat };
  }, target.id);
  // applyMove clamps large furniture away from the walls; use the applied coordinates.
  const delta = { x: after.item.x - target.before.x, z: after.item.z - target.before.z };
  assert.ok(Math.abs(after.seat.x - (target.seat.x + delta.x)) < .01, 'lounge seat follows moved sofa on x');
  assert.ok(Math.abs(after.seat.z - (target.seat.z + delta.z)) < .01, 'lounge seat follows moved sofa on z');
  assert.deepEqual(errors, []);
  console.log('PASS: linked lounge seats follow a moved sofa; team desk chairs are locked');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
