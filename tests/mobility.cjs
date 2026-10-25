// Deterministic vehicle journeys, reserved return parking and task-priority recall.
const assert=require('node:assert/strict'),M=require('../public/mobility.js');
const config={seed:7,maxTeamAway:2,lanes:[{id:'out',points:[[0,0,0],[0,0,20]],next:['loop'],speed:5},{id:'loop',points:[[0,0,20],[20,0,20],[20,0,0]],next:['in'],speed:5},{id:'in',points:[[20,0,0],[0,0,0]],next:[],speed:5}],conflicts:[],parking:[{id:'p1',kind:'car',position:[0,0,0],heading:0,entryLane:'in',exitLane:'out'},{id:'p2',kind:'motorcycle',position:[2,0,0],heading:0,entryLane:'in',exitLane:'out'}]};
const create=()=>M.create(config),step=(s,n)=>{for(let i=0;i<n;i++)s.tick(.1);};
// Oriented vehicle footprints overlap? (separating-axis test on the x/z plane; heading 0 = +z)
function rectsOverlap(a,b){const corners=v=>{const s=Math.sin(v.heading),c=Math.cos(v.heading),hl=v.length/2,hw=v.width/2;return [[hw,hl],[-hw,hl],[-hw,-hl],[hw,-hl]].map(([x,z])=>[v.pose[0]+x*c+z*s,v.pose[2]-x*s+z*c]);};
 const A=corners(a),B=corners(b);for(const P of [A,B])for(let i=0;i<4;i++){const [x1,z1]=P[i],[x2,z2]=P[(i+1)%4],nx=z2-z1,nz=x1-x2;const proj=Q=>Q.map(([x,z])=>x*nx+z*nz);const pa=proj(A),pb=proj(B);if(Math.max(...pa)<Math.min(...pb)||Math.max(...pb)<Math.min(...pa))return false;}return true;}
let s=create();const id=s.request({id:'one',kind:'team',owner:'A',vehicle:'car'});assert.ok(id);assert.equal(s.request({id:'again',kind:'team',owner:'A',vehicle:'car'}),id);assert.equal(s.request({id:'B',kind:'team',owner:'B',vehicle:'car'}),null,'reserved return bay cannot be stolen');
assert.equal(s.request({id:'bad',kind:'team',owner:'C',vehicle:'truck'}),null);
assert.equal(s.snapshot().trips[0].phase,'walkToVehicle');step(s,30);assert.equal(s.snapshot().trips[0].phase,'walkToVehicle','wait for actual walker');
s.arrive(id,'walkToVehicle');s.arrive(id,'mount');assert.equal(s.snapshot().trips[0].phase,'outbound');const before=s.snapshot().vehicles[0].pose;step(s,20);const after=s.snapshot().vehicles[0].pose;assert.ok(Math.hypot(after[0]-before[0],after[2]-before[2])>1);
s.recall('A');step(s,300);assert.equal(s.snapshot().trips[0].phase,'dismount');s.arrive(id,'dismount');s.arrive(id,'walkToOffice');assert.equal(s.snapshot().reservations.length,0);
const a=create(),b=create();for(const c of [a,b]){const i=c.request({id:'x',owner:'x',kind:'team',vehicle:'car'});c.arrive(i,'walkToVehicle');c.arrive(i,'mount');}step(a,100);step(b,100);assert.deepEqual(a.snapshot(),b.snapshot());
s=create();const i=s.request({id:'r',owner:'r',kind:'team',vehicle:'car'});s.recall('r');assert.equal(s.snapshot().trips[0].phase,'walkToOffice');s.arrive(i,'walkToOffice');assert.equal(s.snapshot().reservations.length,0);
s=create();s.setDepartures(false);assert.equal(s.request({id:'n',owner:'n',kind:'team',vehicle:'car'}),null);
s=create();const j=s.request({id:'j',owner:'j',kind:'team',vehicle:'car'});s.arrive(j,'walkToVehicle');s.arrive(j,'mount');const p=s.snapshot().vehicles[0].pose;s.tick(10);assert.ok(Math.hypot(...s.snapshot().vehicles[0].pose.map((v,i)=>v-p[i]))<1,'large dt bounded');const snap=s.snapshot();s.tick(0);assert.deepEqual(s.snapshot(),snap);
s.removeOwner('j');step(s,400);assert.equal(s.snapshot().reservations.length,0,'removed owner retires through route');
// Parking poses connect continuously to lanes; a vehicle must not jump from the bay to a lane endpoint.
s=create();const c=s.request({id:'continuous',owner:'continuous',kind:'team',vehicle:'car'});const parked=s.snapshot().vehicles[0].pose;s.arrive(c,'walkToVehicle');s.arrive(c,'mount');assert.ok(Math.hypot(...s.snapshot().vehicles[0].pose.map((v,i)=>v-parked[i]))<.01);
// A mount acknowledgment cannot depart after its owner was recalled.
s=create();const m=s.request({id:'mount',owner:'mount',kind:'team',vehicle:'car'});s.arrive(m,'walkToVehicle');s.recall('mount');s.arrive(m,'mount');assert.equal(s.snapshot().trips[0].phase,'dismount');
// Crossing occupancy holds a vehicle before the controlled lane; release lets it make progress.
const crossingConfig=structuredClone(config);crossingConfig.lanes[0].conflicts=['ped'];s=M.create(crossingConfig);const cross=s.request({id:'cross',owner:'cross',kind:'team',vehicle:'car'});s.arrive(cross,'walkToVehicle');s.arrive(cross,'mount');s.occupyCrossing('ped',true);step(s,40);assert.ok(s.snapshot().vehicles[0].pose[2]<.1);s.occupyCrossing('ped',false);step(s,40);assert.ok(s.snapshot().vehicles[0].pose[2]>1);
// Following vehicles must retain bumper separation before a junction and while it is occupied.
s=M.create({...config,maxTeamAway:3,parking:[config.parking[0],{...config.parking[0],id:'p3',position:[0,0,0]}]});
for(const owner of ['front','rear']){const id=s.request({id:owner,owner,kind:'team',vehicle:'car'});s.arrive(id,'walkToVehicle');s.arrive(id,'mount');}
step(s,120);const vs=s.snapshot().vehicles;assert.ok(Math.hypot(...vs[0].pose.map((n,i)=>n-vs[1].pose[i]))>=4.9,'vehicles do not overlap');
// Visitors begin on a road, reserve a bay, arrive/park, then depart only after their actor returns.
s=create();const visit=s.requestVisitor({id:'visitor',owner:'visitor',vehicle:'car',lane:'out'});assert.ok(visit);assert.equal(s.snapshot().trips[0].phase,'inbound');step(s,400);assert.equal(s.snapshot().trips[0].phase,'dismount');s.arrive(visit,'dismount');s.arrive(visit,'walkToOffice');assert.equal(s.snapshot().trips[0].phase,'visiting');s.departVisitor('visitor');assert.equal(s.snapshot().trips[0].phase,'walkToVehicle');s.arrive(visit,'walkToVehicle');s.arrive(visit,'mount');step(s,400);assert.equal(s.snapshot().vehicles.length,0);
// Ambient traffic uses lanes, not scarce parking; it retires at its exit.
s=create();assert.ok(s.requestTraffic({id:'ambient',vehicle:'car',lane:'out'}));step(s,400);assert.equal(s.snapshot().vehicles.length,0);assert.equal(s.snapshot().reservations.length,0);
// Vehicles on overlapping lane ids still share physical road space.
const overlapConfig=structuredClone(config);overlapConfig.lanes.push({...overlapConfig.lanes[0],id:'parallel-id'});s=M.create(overlapConfig);s.requestTraffic({id:'lead',vehicle:'car',lane:'out'});step(s,5);assert.equal(s.requestTraffic({id:'overlap',vehicle:'car',lane:'parallel-id'}),null,'physical spawn clearance across lanes');
// The real exterior layout: busy parking with visitors and team trips must keep flowing (no deadlock in the aisle).
{const L=require('./fixtures/environment-layout.cjs');const live=M.create({...L,maxTeamAway:2});
 const ids=[live.requestVisitor({id:'v1',owner:'v1',vehicle:'car',lane:'visitor-in'})];
 for(const o of ['t1','t2']){const id=live.request({id:o,owner:o,kind:'team',vehicle:'motorcycle'});live.arrive(id,'walkToVehicle');live.arrive(id,'mount');ids.push(id);}
 for(let k=0;k<3000;k++){live.tick(.1);const s=live.snapshot();for(const t of s.trips){if(t.phase==='dismount')live.arrive(t.id,'dismount');else if(t.phase==='walkToOffice')live.arrive(t.id,'walkToOffice');else if(t.phase==='visiting')live.departVisitor(t.owner);else if(t.phase==='walkToVehicle')live.arrive(t.id,'walkToVehicle');else if(t.phase==='mount')live.arrive(t.id,'mount');}
  if(k===200)live.recall('t1');}
 const left=live.snapshot();assert.equal(left.trips.filter(t=>t.kind!=='ambient').length,0,'all journeys finished: '+JSON.stringify(left.trips.map(t=>[t.id,t.phase,left.vehicles.find(v=>v.id===t.id)?.lane])));
 assert.equal(left.reservations.length,0);}
// A returning bike and a departing vehicle meeting in the lot aisle must not stand off head-on.
{const L=require('./fixtures/environment-layout.cjs');const s2=M.create({...L,maxTeamAway:3});const a=s2.request({id:'a',owner:'a',kind:'team',vehicle:'motorcycle'});s2.arrive(a,'walkToVehicle');s2.arrive(a,'mount');
 for(let k=0;k<3000;k++){s2.tick(.1);if(k===300)s2.recall('a');for(const t of s2.snapshot().trips){if(t.phase==='dismount')s2.arrive(t.id,'dismount');else if(t.phase==='walkToOffice')s2.arrive(t.id,'walkToOffice');}
  if(k===415){const b=s2.request({id:'b',owner:'b',kind:'team',vehicle:'motorcycle'});s2.arrive(b,'walkToVehicle');s2.arrive(b,'mount');s2.recall('b');}}
 assert.equal(s2.snapshot().trips.length,0,'lot standoff resolved: '+JSON.stringify(s2.snapshot().trips.map(t=>[t.id,t.phase])));}
// Review #3: a visitor never spawns on top of a car already at the start of its road.
{const L=require('./fixtures/environment-layout.cjs');const s3=M.create({...L,maxTeamAway:2});s3.requestTraffic({id:'amb',vehicle:'car',lane:'street-east'});
 assert.equal(s3.requestVisitor({id:'vis',owner:'vis',vehicle:'car',lane:'visitor-in'}),null,'visitor waits for spawn clearance');
 assert.equal(s3.snapshot().reservations.length,0,'refused visitor does not keep a parking reservation');}
// Review #2: a team car returning across the eastbound street yields to through traffic (footprints never overlap).
{const L=require('./fixtures/environment-layout.cjs');let overlaps=0;
 for(let delay=0;delay<320;delay++){const s4=M.create({...L,maxTeamAway:2});const id=s4.request({id:'t',owner:'t',kind:'team',vehicle:'car'});s4.arrive(id,'walkToVehicle');s4.arrive(id,'mount');s4.recall('t');
  for(let k=0;k<900;k++){if(k===delay)s4.requestTraffic({id:'amb',vehicle:'car',lane:'street-east'});s4.tick(.1);
   // Real footprint test: oriented 4.5 x 2.2 m rectangles (separating axis), not a coarse box around the centre.
   const v=s4.snapshot().vehicles;if(v.length===2&&rectsOverlap(v[0],v[1])){overlaps++;break;}}}
 assert.equal(overlaps,0,`team car and street car overlapped in ${overlaps}/320 timings`);}
// Terminal history must not grow forever as visitors come and go.
s=create();for(let k=0;k<50;k++){const id=s.request({id:'gone'+k,owner:'gone'+k,kind:'team',vehicle:'car'});s.recall('gone'+k);s.arrive(id,'walkToOffice');}assert.equal(s.snapshot().retainedTrips,0,'completed journeys released');
// Reject mismatched parking-to-lane joins instead of teleporting through walls.
assert.throws(()=>M.create({...config,parking:[{...config.parking[0],position:[40,0,40]}]}),/parking|connect/i);
console.log('PASS: deterministic acknowledged trips, exclusive compatible parking, safe recall, bounded time and retirement');
