// Backup, restore and health checks for the whole DATA_DIR (workspace, org, rooms, settings,
// credentials, settings.key and generated projects). No dependencies; the scripts and the
// owner-only API share this module so a restore means the same thing everywhere.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const STATE_FILES=['workspace.json','org.json','rooms.json','settings.json','credentials.json','team.json'];
const COLLECTIONS=['tasks','threads','messages','decisions','events','projects','jobs'];
const TRANSIENT=name=>name==='.lock'||name==='backups'||/\.tmp($|\.)/.test(name);
const posix=rel=>rel.split(path.sep).join('/');
const parts=rel=>rel.split('/');

function walk(root,rel='',out=[],skipRel=''){
  const dir=path.join(root,...parts(rel).filter(Boolean));
  let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return out;}
  for(const entry of entries){
    const child=rel?`${rel}/${entry.name}`:entry.name;
    if(TRANSIENT(entry.name)||child===skipRel)continue;
    if(entry.isDirectory())walk(root,child,out,skipRel);
    else if(entry.isFile())out.push(child);
  }
  return out;
}
function sha256(file){return new Promise((resolve,reject)=>{const hash=crypto.createHash('sha256'),stream=fs.createReadStream(file);stream.on('data',chunk=>hash.update(chunk));stream.on('end',()=>resolve(hash.digest('hex')));stream.on('error',reject);});}
function stampOf(date){return date.toISOString().replace(/[:.]/g,'-');}
function inside(parent,child){const rel=path.relative(parent,child);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)?posix(rel):'';}
function safeRel(rel){return typeof rel==='string'&&rel&&!rel.startsWith('/')&&!rel.includes('\\')&&!parts(rel).includes('..');}

async function backupData({dataDir,outDir,tag='backup',now=new Date()}={}){
  if(!dataDir)throw new Error('dataDir is required.');
  const source=path.resolve(dataDir);
  if(!fs.existsSync(source))throw new Error(`Data directory not found: ${source}`);
  const base=path.resolve(outDir||path.join(source,'backups'));
  const skipRel=inside(source,base);
  const dir=path.join(base,`${String(tag||'backup').replace(/[^\w.-]/g,'_')}-${stampOf(now)}`);
  fs.mkdirSync(dir,{recursive:true});
  const files=[];
  for(const rel of walk(source,'',[],skipRel)){
    const src=path.join(source,...parts(rel)),dest=path.join(dir,...parts(rel));
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(src,dest);
    const stat=fs.statSync(src),mode=(stat.mode&0o777).toString(8);
    if(mode==='600')try{fs.chmodSync(dest,0o600);}catch{/* mode is best effort on Windows */}
    files.push({path:rel,size:stat.size,sha256:await sha256(src),mode});
  }
  const manifest={schemaVersion:1,createdAt:now.toISOString(),source,files};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  return {dir,manifest};
}

function readManifest(dir){
  const file=path.join(dir,'manifest.json');
  let manifest;try{manifest=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw new Error(`Manifest tidak bisa dibaca: ${error.message}`);}
  if(!manifest||manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw new Error('Manifest backup tidak valid.');
  for(const entry of manifest.files){
    if(!entry||!safeRel(entry.path)||typeof entry.sha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.sha256))throw new Error(`Entri manifest tidak valid: ${entry?.path||'(tanpa path)'}`);
  }
  return manifest;
}

async function verifyBackup(dir){
  const manifest=readManifest(dir),problems=[];
  for(const entry of manifest.files){
    const file=path.join(dir,...parts(entry.path));
    if(!fs.existsSync(file)){problems.push(`${entry.path}: file tidak ada di backup`);continue;}
    const size=fs.statSync(file).size;if(Number.isFinite(entry.size)&&size!==entry.size){problems.push(`${entry.path}: ukuran berubah (${size} != ${entry.size})`);continue;}
    if(await sha256(file)!==entry.sha256)problems.push(`${entry.path}: checksum tidak cocok`);
  }
  return {manifest,problems};
}

async function restoreData({dataDir,backupDir,confirm=false}={}){
  if(!confirm)throw new Error('Restore menimpa data. Jalankan ulang dengan --yes setelah memeriksa backup.');
  if(!dataDir||!backupDir)throw new Error('dataDir and backupDir are required.');
  const source=path.resolve(dataDir),dir=path.resolve(backupDir);
  const {manifest,problems}=await verifyBackup(dir);
  if(problems.length)throw Object.assign(new Error(`Backup tidak valid; tidak ada file yang ditimpa.\n${problems.join('\n')}`),{problems});
  // A verified backup is snapshotted first, so even a mistaken restore can be undone.
  const pre=await backupData({dataDir:source,tag:'pre-restore'});
  const known=new Set(manifest.files.map(entry=>entry.path));
  const extras=walk(source).filter(rel=>!known.has(rel)&&!rel.startsWith('backups/'));
  for(const entry of manifest.files){
    const src=path.join(dir,...parts(entry.path)),dest=path.join(source,...parts(entry.path));
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(src,dest);
    if(entry.mode==='600')try{fs.chmodSync(dest,0o600);}catch{/* best effort */}
  }
  return {restored:manifest.files.length,preRestore:pre.dir,extras};
}

function inspectData({dataDir}={}){
  const source=path.resolve(dataDir||path.join(__dirname,'..','data')),issues=[];
  const readJson=name=>{
    try{return JSON.parse(fs.readFileSync(path.join(source,name),'utf8'));}
    catch(error){
      if(error.code==='ENOENT')issues.push({level:'warn',file:name,message:'belum ada'});
      else issues.push({level:'error',file:name,message:`tidak bisa dibaca: ${error.message}`});
      return null;
    }
  };
  const workspace=readJson('workspace.json');
  if(workspace){
    if(workspace.schemaVersion!==1||!Number.isInteger(workspace.version)||!Number.isInteger(workspace.nextSeq)||workspace.nextSeq<1||COLLECTIONS.some(key=>!Array.isArray(workspace[key])))issues.push({level:'error',file:'workspace.json',message:'skema workspace tidak valid'});
    else{let seq=0;for(const event of workspace.events){if(!Number.isInteger(event.seq)||event.seq<=seq||event.seq>=workspace.nextSeq){issues.push({level:'error',file:'workspace.json',message:`urutan event rusak di seq ${event.seq}`});break;}seq=event.seq;}}
  }
  const org=readJson('org.json');
  if(org){try{require('./org').normalize(org);}catch(error){issues.push({level:'error',file:'org.json',message:error.message});}}
  const rooms=readJson('rooms.json');
  if(rooms&&!Array.isArray(rooms))issues.push({level:'error',file:'rooms.json',message:'harus berupa daftar ruangan'});
  const settings=readJson('settings.json');
  if(settings&&(typeof settings!=='object'||Array.isArray(settings)))issues.push({level:'error',file:'settings.json',message:'harus berupa objek'});
  const credentials=readJson('credentials.json');
  if(credentials&&(typeof credentials!=='object'||Array.isArray(credentials)))issues.push({level:'error',file:'credentials.json',message:'harus berupa objek'});
  const team=readJson('team.json');
  if(team&&!Array.isArray(team))issues.push({level:'error',file:'team.json',message:'harus berupa daftar anggota'});
  const keyFile=path.join(source,'settings.key');
  if(fs.existsSync(keyFile)){
    const raw=fs.readFileSync(keyFile,'utf8').trim(),ok=/^[0-9a-f]{64}$/i.test(raw)||(()=>{try{return Buffer.from(raw,'base64').length===32;}catch{return false;}})();
    if(!ok)issues.push({level:'error',file:'settings.key',message:'bukan kunci 32-byte base64 atau 64 karakter hex'});
  }else issues.push({level:'warn',file:'settings.key',message:'belum ada; kredensial tersimpan tidak bisa dibuka tanpa kunci ini'});
  const projectRoot=path.join(source,'projects');
  if(fs.existsSync(projectRoot))for(const name of fs.readdirSync(projectRoot)){
    const project=path.join(projectRoot,name);if(!fs.statSync(project).isDirectory())continue;
    if(!fs.existsSync(path.join(project,'project.json')))issues.push({level:'warn',file:`projects/${name}`,message:'project.json tidak ada'});
  }
  const backups=[];
  const backupRoot=path.join(source,'backups');
  if(fs.existsSync(backupRoot))for(const name of fs.readdirSync(backupRoot)){
    const dir=path.join(backupRoot,name);if(!fs.statSync(dir).isDirectory())continue;
    try{const manifest=readManifest(dir);backups.push({name,createdAt:manifest.createdAt,files:manifest.files.length});}
    catch(error){issues.push({level:'warn',file:`backups/${name}`,message:error.message});}
  }
  let storageBytes=0;for(const rel of walk(source))try{storageBytes+=fs.statSync(path.join(source,...parts(rel))).size;}catch{/* raced with a write */}
  return {ok:!issues.some(issue=>issue.level==='error'),issues,dataDir:source,storageBytes,backups,counts:workspace?{tasks:workspace.tasks.length,messages:workspace.messages.length,events:workspace.events.length,projects:workspace.projects.length,jobs:workspace.jobs.length}:null};
}

module.exports={backupData,restoreData,inspectData,verifyBackup,readManifest,walk,sha256,STATE_FILES};
