// Ramp geometry and vehicle pitch must agree: a car on the driveway should nose up/down with the
// mesh instead of staying level and cutting its wheels through the asphalt.
const assert = require('node:assert/strict');
const layout = require('../public/environment-layout.js');
const mobility = require('../public/mobility.js');

const engine = mobility.create({...layout, maxTeamAway: 0});
const rampY = z => z < 12.5 ? .03 : z > 21 ? -.86 : .03 - .89 * (z - 12.5) / 8.5;
const vehicle = id => engine.snapshot().vehicles.find(v => v.id === id);
const run = (id, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) engine.tick(1 / 60);
  return vehicle(id);
};

assert.ok(engine.requestTraffic({id: 'flat', vehicle: 'car', lane: 'street-east'}), 'street car spawned');
const flat = run('flat', .5);
assert.ok(Math.abs(flat.pitch) < 1e-6, `street stays level: ${flat.pitch}`);

assert.ok(engine.requestTraffic({id: 'climb', vehicle: 'car', lane: 'in'}), 'climbing car spawned');
const climb = run('climb', .5);
assert.ok(climb && climb.pose[2] > 12.5 && climb.pose[2] < 16, `climbing car is on the ramp: ${climb?.pose}`);
assert.ok(climb.pitch < -.05 && Math.abs(climb.pitch + .1045) < .02, `nose-up on the climb: ${climb.pitch}`);
assert.ok(Math.abs(climb.roll) < .02, `straight ramp has no roll: ${climb.roll}`);

assert.ok(engine.requestTraffic({id: 'down', vehicle: 'car', lane: 'out'}), 'descending car spawned');
const down = run('down', 1.5);
assert.ok(down && down.pose[2] > 12.5 && down.pose[2] < 21, `descending car is on the ramp: ${down?.pose}`);
assert.ok(down.pitch > .05 && down.pitch < .12, `nose-down on the descent: ${down.pitch}`);
assert.ok(down.roll > .03, `diagonal ramp rolls the car onto the plane: ${down.roll}`);

for (const lane of layout.lanes) {
  for (const point of lane.points) {
    const [, y, z] = point;
    if (z < 12.5 || z > 21 || point[0] < 3 || point[0] > 13) continue;
    assert.ok(Math.abs(y - rampY(z)) < .01, `${lane.id} keeps the ramp grade at ${point}`);
  }
}
console.log('PASS: ramp lanes share the mesh grade and vehicles pitch with the slope');
