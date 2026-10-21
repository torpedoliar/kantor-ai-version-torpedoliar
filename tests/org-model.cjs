// Pure organization logic shared by the chart, the wizard and the 3D seating plan.
const assert=require('node:assert/strict');
const {seed}=require('../server/org.js');
const M=require('../public/org-model.js');
const s=seed(),frozen=JSON.stringify(s);
const member=(state,name)=>state.members.find(m=>m.name===name),division=(state,id)=>state.divisions.find(d=>d.id===id);

assert.equal(M.leadershipId(s),'leadership');
assert.equal(M.leadershipId({divisions:[],members:[]}),null);

// Cycles are refused before any server round-trip.
assert.equal(M.moveMember(s,'Koh Arman',{manager:'Bagas Pratama Putra'}).error,'Tidak bisa: membuat siklus');
assert.equal(M.moveMember(s,'Yoga',{manager:'Yoga'}).error,'Tidak bisa: membuat siklus');

// Moving a lead alone: reports stay and report to the mover's old manager, first remaining report leads.
const r1=M.moveMember(s,'Koh Wira',{division:'marketing'});
assert.equal(member(r1.state,'Koh Wira').division,'marketing');assert.equal(member(r1.state,'Koh Wira').manager,'Kak Rani');
assert.equal(member(r1.state,'Rizky Hakim').manager,'Koh Arman');
assert.equal(division(r1.state,'engineering').lead,'Bagas Pratama Putra');
assert.deepEqual(r1.warnings,['Koh Wira bukan lagi lead Engineering; Bagas Pratama Putra jadi lead.']);

// Moving with the team: every descendant changes division, the old division has no lead left.
const r2=M.moveMember(s,'Koh Wira',{division:'marketing',withTeam:true});
assert.ok(r2.state.members.filter(m=>m.manager==='Koh Wira').every(m=>m.division==='marketing'));
assert.equal(member(r2.state,'Rizky Hakim').manager,'Koh Wira');
assert.equal(division(r2.state,'engineering').lead,'');assert.deepEqual(r2.warnings,['Engineering belum punya lead.']);

// Dropping onto a card in another division moves under that card.
const r3=M.moveMember(s,'Tari',{manager:'Gilang',division:'service'});
assert.equal(member(r3.state,'Tari').manager,'Gilang');assert.equal(member(r3.state,'Tari').division,'service');assert.deepEqual(r3.warnings,[]);
assert.equal(JSON.stringify(s),frozen,'input is never mutated');

// Collaboration, divisions.
assert.deepEqual(division(M.toggleCollaboration(s,'marketing','service'),'marketing').collaboratesWith,['service']);
assert.deepEqual(division(M.toggleCollaboration(M.toggleCollaboration(s,'marketing','service'),'marketing','service'),'marketing').collaboratesWith,[]);
assert.deepEqual(division(M.toggleCollaboration(s,'marketing','marketing'),'marketing').collaboratesWith,[]);
const added=M.addDivision(M.addDivision(s,'Riset & Data'),'Riset & Data');
assert.deepEqual(added.divisions.slice(-2).map(d=>d.id),['riset-data','riset-data-2']);assert.equal(added.divisions.at(-1).lead,'');
assert.match(added.divisions.at(-1).color,/^#[0-9a-f]{6}$/);
assert.equal(M.removeDivision(s,'service').error,'Pindahkan semua anggota dulu.');
const emptied=M.moveAllMembers(s,'service','marketing');
assert.ok(emptied.members.filter(m=>['Gilang','Kak Sinta','Kak Laras'].includes(m.name)).every(m=>m.division==='marketing'&&m.manager==='Kak Rani'));
const without=M.removeDivision(emptied,'service');assert.ok(!without.error);assert.equal(division(without.state,'service'),undefined);

// Changing a lead: the new lead takes the old lead's place, the old lead and its reports move under them.
const led=M.setLead(s,'service','Kak Sinta');
assert.equal(division(led,'service').lead,'Kak Sinta');assert.equal(member(led,'Kak Sinta').manager,'Koh Arman');
assert.equal(member(led,'Gilang').manager,'Kak Sinta');assert.equal(member(led,'Kak Laras').manager,'Kak Sinta');
const ceo=M.setLead(s,'leadership','Koh Wira');assert.equal(member(ceo,'Koh Wira').manager,null);assert.equal(member(ceo,'Kak Rani').manager,'Koh Wira');assert.equal(member(ceo,'Koh Arman').manager,'Koh Wira');
assert.equal(M.leadershipId(ceo),'leadership');
// Deactivating: reports move up; a division lead cannot be deactivated before another lead is picked.
assert.equal(M.setActive(s,'Gilang',false).error,'Pilih lead lain untuk Service dulu.');
const off=M.setActive(s,'Koh Wira',false);assert.ok(off.error);
const offDewi=M.setActive(M.moveMember(s,'Tari',{manager:'Kak Dewi'}).state,'Kak Dewi',false);
assert.equal(member(offDewi.state,'Kak Dewi').active,false);assert.equal(member(offDewi.state,'Tari').manager,'Kak Rani');
assert.equal(member(M.setActive(offDewi.state,'Kak Dewi',true).state,'Kak Dewi').active,true);
// Renaming keeps every reference.
const renamed=M.renameMember(s,'Gilang','Gilang Saputra');
assert.equal(division(renamed,'service').lead,'Gilang Saputra');assert.equal(member(renamed,'Kak Sinta').manager,'Gilang Saputra');
assert.equal(JSON.stringify(s),frozen,'input is never mutated');

// Seating: 8 per area, 4 areas per floor, overflow areas labelled, at least one floor.
const big={...s,members:[...s.members,...Array.from({length:20},(_,i)=>({name:`P${i}`,initials:'P',role:'r',division:'marketing',manager:'Kak Rani',active:true}))]};
const plan=M.planSeating(big);
assert.equal(plan.floors.length,2);assert.equal(plan.floors[0].level,'work-1');
assert.deepEqual(plan.floors[0].areas.map(a=>a.divisionId),['leadership','marketing','marketing','marketing']);
assert.deepEqual(plan.floors[0].areas.map(a=>a.slot),[0,1,2,3]);
assert.equal(plan.floors[0].areas[2].label,'Marketing (lanjutan)');assert.equal(plan.floors[0].areas[1].seats[0],'Kak Rani','lead sits first');
assert.ok(plan.floors.flatMap(f=>f.areas).every(a=>a.seats.length>=1&&a.seats.length<=8));
assert.equal(plan.floors.flatMap(f=>f.areas).flatMap(a=>a.seats).length,33,'everyone active is seated once');
assert.deepEqual(M.planSeating({divisions:[],members:[]}).floors,[{level:'work-1',areas:[]}]);
const named=M.planSeating({...s,divisions:s.divisions.map(d=>d.id==='service'?{...d,areaName:'Pojok CS'}:d)});
assert.ok(named.floors[0].areas.some(a=>a.label==='Pojok CS'));
const inactive=M.planSeating({...s,members:s.members.map(m=>m.name==='Tari'?{...m,active:false}:m)});
assert.ok(!inactive.floors.flatMap(f=>f.areas).flatMap(a=>a.seats).includes('Tari'));

// Chart layout: one node per member, division boxes never overlap, nodes sit inside their box.
const L=M.chartLayout(s);assert.equal(L.nodes.length,13);
for(const a of L.boxes)for(const b of L.boxes)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`boxes ${a.id}/${b.id} overlap`);
for(const n of L.nodes){const box=L.boxes.find(b=>b.id===member(s,n.name).division);assert.ok(n.x>=box.x&&n.x+M.CARD.w<=box.x+box.w&&n.y>=box.y&&n.y+M.CARD.h<=box.y+box.h,`${n.name} inside its box`);}
for(const a of L.nodes)for(const b of L.nodes)if(a!==b)assert.ok(Math.abs(a.x-b.x)>=M.CARD.w||Math.abs(a.y-b.y)>=M.CARD.h,`${a.name}/${b.name} overlap`);
const leadership=L.boxes.find(b=>b.id==='leadership');assert.ok(L.boxes.filter(b=>b!==leadership).every(b=>b.y>=leadership.y+leadership.h),'leadership on top');
assert.ok(L.width>0&&L.height>0);
assert.deepEqual(M.chartLayout({divisions:[],members:[]}).nodes,[]);
console.log('PASS: org model moves, cycles, divisions, seating plan and chart layout');
