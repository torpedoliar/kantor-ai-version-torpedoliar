const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('public/index.html'),css=read('public/office.css'),office=read('public/office.js'),tasks=read('public/tasks.js');
for(const legacy of ['#header','#teamSelect','#teamFaces','#floorCaption','#cameraHint','#bLog','.header-card','.team-picker','.brand-tagline']){
  assert.equal(css.includes(legacy),false,`legacy CSS selector remains: ${legacy}`);
}
for(const legacy of ['id="header"','id="teamSelect"','id="teamFaces"','id="floorCaption"','id="cameraHint"','id="bLog"']){
  assert.equal(html.includes(legacy),false,`legacy markup remains: ${legacy}`);
}
for(const [copy,pattern] of [['Routine: on','>Routine: on<'],['Lunch','>Lunch<'],['To the rooftop','>To the rooftop<'],['Prayer time','>Prayer time<'],['Back to work','>Back to work<'],['Music','>Music<'],['Settings','>Settings<'],['Office tasks','>Office tasks<'],['Add task','>Add task<'],['Approve & finish',"'Approve & finish'"],['Request revision',"'Request revision'"],['Send message',"'Send message'"],['Send answer',"'Send answer'"],['Start task',"'Start task'"]]){
  assert.equal(html.includes(pattern)||office.includes(pattern)||tasks.includes(pattern),false,`English UI copy remains: ${copy}`);
}
assert.match(html,/id="bPause"[^>]*>Jeda</);
assert.match(html,/id="moments"[^>]*>[\s\S]*<summary[^>]*>Momen</);
console.log('PASS: Phase 1 legacy selectors removed and core UI copy localized');
