const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript(() => localStorage.clear());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.OFFICE_URL || 'http://127.0.0.1:4173');
  await page.waitForFunction(() => window.officeScene?.customize?.inventory, null, { timeout: 60000 });

  const initial = await page.evaluate(() => ({
    inventory: officeScene.customize.inventory(),
    items: officeScene.customize.list()
  }));
  for (const [type, count] of Object.entries({ chair: 6, table: 2, sofa: 2, plant: 4, lamp: 4, shelf: 2, coffee: 2, whiteboard: 2 })) {
    assert.equal(initial.inventory.stock[type], count, `initial stock for ${type}`);
  }
  const taskBoard = initial.items.find(item => item.sub === 'task');
  assert.ok(taskBoard, 'task board is movable and registered');
  assert.equal(taskBoard.rotatable, false, 'task board rotation is locked');
  assert.equal(taskBoard.seatCount, 2, 'task board has two linked reader spots');

  await page.click('#bCustom');

  const beforePreview = await page.evaluate(() => officeScene.customize.inventory());
  const preview = await page.evaluate(() => officeScene.customize.add('shelf'));
  assert.ok(preview?.preview, 'adding creates a preview');
  assert.equal((await page.evaluate(() => officeScene.customize.inventory())).stock.shelf, beforePreview.stock.shelf, 'preview does not consume stock');
  await page.evaluate(() => officeScene.customize.cancel());
  assert.equal((await page.evaluate(() => officeScene.customize.inventory())).stock.shelf, beforePreview.stock.shelf, 'cancel leaves stock unchanged');
  assert.equal(await page.evaluate(id => officeScene.customize.list().some(item => item.id === id), preview.id), false, 'cancel removes preview item');

  const added = await page.evaluate(() => officeScene.customize.add('chair'));
  assert.ok(added?.preview, 'chair preview created');
  assert.ok((await page.evaluate(id => officeScene.customize.list().find(item => item.id === id), added.id)).seatCount >= 1, 'added chair is usable by agents');
  assert.equal(await page.evaluate(() => officeScene.customize.apply()), true, 'Apply commits added chair');
  const afterApply = await page.evaluate(() => officeScene.customize.inventory());
  assert.equal(afterApply.stock.chair, 5, 'Apply consumes one chair');
  assert.equal(afterApply.placed.chair, 1, 'inventory counts placed extra chair');

  assert.equal(await page.evaluate(() => officeScene.customize.adjustStock('shelf', 3)), 5, 'manual restock increases stock');
  assert.equal(await page.evaluate(() => officeScene.customize.adjustStock('shelf', -99)), 0, 'stock cannot become negative');
  assert.equal(await page.evaluate(() => officeScene.customize.add('shelf')), false, 'zero stock blocks adding');
  assert.equal(await page.evaluate(() => officeScene.customize.adjustStock('shelf', 1)), 1, 'manual restock re-enables adding');

  const taskBefore = await page.evaluate(id => officeScene.customize.list().find(item => item.id === id), taskBoard.id);
  const seatsBefore = await page.evaluate(id => officeScene.customize.seats(id), taskBoard.id);
  assert.equal(seatsBefore.length, 2);
  assert.equal(await page.evaluate(({ id, x, z }) => officeScene.customize.applyMove(id, x, z, 90), { id: taskBoard.id, x: taskBefore.x + 3, z: taskBefore.z + 1 }), true);
  const taskAfter = await page.evaluate(id => officeScene.customize.list().find(item => item.id === id), taskBoard.id);
  const seatsAfter = await page.evaluate(id => officeScene.customize.seats(id), taskBoard.id);
  assert.equal(taskAfter.rot, taskBefore.rot, 'task board rotation remains locked');
  assert.equal(Math.round((taskAfter.x - taskBefore.x) * 10) / 10, 3);
  assert.equal(Math.round((taskAfter.z - taskBefore.z) * 10) / 10, 1);
  for (let i = 0; i < seatsBefore.length; i++) {
    assert.equal(Math.round((seatsAfter[i].x - seatsBefore[i].x) * 10) / 10, 3, 'reader spot follows board x');
    assert.equal(Math.round((seatsAfter[i].z - seatsBefore[i].z) * 10) / 10, 1, 'reader spot follows board z');
  }

  const addedId = added.id;
  page.once('dialog', async dialog => {
    assert.match(dialog.message(), /all layout slots/i);
    await dialog.accept();
  });
  assert.equal(await page.evaluate(id => officeScene.customize.returnItem(id), addedId), true, 'return item succeeds after confirmation');
  const afterReturn = await page.evaluate(() => officeScene.customize.inventory());
  assert.equal(afterReturn.stock.chair, 6, 'returned chair restores stock');
  assert.equal(await page.evaluate(id => officeScene.customize.list().some(item => item.id === id), addedId), false, 'returned item is removed');

  assert.deepEqual(errors, []);
  console.log('PASS: inventory stock, preview/apply/cancel, usable extra chair, movable task board and return flow');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
