// Generated application sources: validated bundles become immutable, hashed revisions under
// DATA_DIR/projects/<projectId>/revisions/<revisionId>/src. Nothing here runs code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const LIMITS={files:200,fileBytes:1024*1024,revisionBytes:10*1000*1000};
const RUNTIMES=new Set(['static-web','node-web']),EXECUTABLES=new Set(['node']),PHASES=['build','test','start'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
function fail(message,code='BUNDLE_INVALID'){throw Object.assign(new Error(message),{status:422,code});}

// A relative POSIX path made of plain segments: no traversal, drives, UNC, encodings, secrets or installed deps.
function cleanPath(raw){
  const value=typeof raw==='string'?raw:'';
  if(!value||value.length>240||/[\u0000-\u001f\\:*?"<>|%]/.test(value)||value.startsWith('/'))fail(`Path tidak diizinkan: ${JSON.stringify(value).slice(0,80)}`);
  const parts=value.split('/');
  for(const part of parts)if(!part||part==='.'||part==='..'||RESERVED.test(part)||part.endsWith('.')||part.endsWith(' '))fail(`Path tidak diizinkan: ${value}`);
  if(parts.some(p=>/^\.env(\.|$)/i.test(p)||p==='node_modules'||p==='.git'))fail(`Path tidak diizinkan: ${value}`);
  if(/^dockerfile$/i.test(parts.at(-1)))fail('Dockerfile dari model tidak dipakai; image runtime diatur server.');
  return parts.join('/');
}
function cleanCommand(phase,command){
  if(!command)return null;
  if(!EXECUTABLES.has(command.executable))fail(`Perintah ${phase} hanya boleh memakai node (bukan ${String(command.executable).slice(0,40)}).`);
  const args=Array.isArray(command.args)?command.args.map(String):[];
  if(args.length>20||args.some(a=>a.length>200||/^[a-z]:[\\/]|^[\\/]{1,2}|\.\.[\\/]|\u0000/i.test(a)))fail(`Argumen ${phase} memuat path absolut atau traversal.`);
  return {executable:'node',args};
}
// Model output in, a normalized bundle out (or a readable error). Validation happens before anything touches disk.
function validateBundle(bundle){
  if(!RUNTIMES.has(bundle?.runtime))fail(`Runtime ${String(bundle?.runtime).slice(0,40)} belum didukung. Yang didukung: static-web, node-web.`,'UNSUPPORTED_RUNTIME');
  const files=Array.isArray(bundle.files)?bundle.files:[];
  if(!files.length)fail('Bundle tidak berisi file.');
  if(files.length>LIMITS.files)fail(`Maksimal ${LIMITS.files} file per revisi.`);
  const seen=new Set();let total=0;
  const clean=files.map(file=>{
    const rel=cleanPath(file?.path),content=typeof file?.content==='string'?file.content:'',bytes=Buffer.byteLength(content);
    const key=rel.toLowerCase();if(seen.has(key))fail(`Path duplikat: ${rel}`);seen.add(key);
    if(bytes>LIMITS.fileBytes)fail(`File ${rel} lebih dari 1 MB.`);
    total+=bytes;if(total>LIMITS.revisionBytes)fail('Total sumber lebih dari 10 MB.');
    return {path:rel,content};
  });
  const commands=Object.fromEntries(PHASES.map(phase=>[phase,cleanCommand(phase,bundle.commands?.[phase])]).filter(([,c])=>c));
  if(!commands.test)fail('Bundle butuh perintah test.');
  const list=value=>(Array.isArray(value)?value:[]).map(v=>String(v).slice(0,500)).filter(Boolean).slice(0,30);
  return {runtime:bundle.runtime,files:clean,commands,acceptanceTests:list(bundle.acceptanceTests),knownLimitations:list(bundle.knownLimitations)};
}

function createProjectWorkspace({dataDir,writeFile=(file,data)=>fs.writeFileSync(file,data,{flag:'wx'}),rename=fs.renameSync}){
  const root=path.join(dataDir,'projects');fs.mkdirSync(root,{recursive:true});
  const realRoot=fs.realpathSync(root);
  // Every existing ancestor from the projects root down must be a real directory, never a symlink or junction.
  function safeDir(...segments){
    let cursor=realRoot;
    for(const segment of segments){
      cursor=path.join(cursor,segment);
      let stat;try{stat=fs.lstatSync(cursor);}catch(error){if(error.code==='ENOENT')return cursor;throw error;}
      if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(cursor)!==cursor)fail(`Lokasi proyek berupa link atau bukan folder: ${segment}`,'PATH_LINK');
    }
    return cursor;
  }
  const projectDir=id=>{if(!UUID.test(String(id)))fail('Project id tidak dikenal.','PROJECT_UNKNOWN');const dir=safeDir(id);if(!fs.existsSync(dir))fail('Project id tidak dikenal.','PROJECT_UNKNOWN');return dir;};
  const revisionDir=(projectId,revisionId)=>{projectDir(projectId);if(!UUID.test(String(revisionId)))fail('Revision tidak dikenal.','REVISION_UNKNOWN');const dir=safeDir(projectId,'revisions',revisionId);if(!fs.existsSync(path.join(dir,'manifest.json')))fail('Revision tidak dikenal.','REVISION_UNKNOWN');return dir;};
  function createProject({taskId,environment}){
    const id=crypto.randomUUID(),dir=safeDir(id);fs.mkdirSync(path.join(dir,'revisions'),{recursive:true});
    const project={id,taskId,environment,createdAt:new Date().toISOString()};fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(project,null,2));return project;
  }
  // Staging directory first, then one rename: a crash or failed write never leaves a half-published revision.
  function writeRevision(projectId,bundle,{revisionId}={}){
    const dir=projectDir(projectId),clean=validateBundle(bundle);
    if(revisionId!==undefined)fail('Revisi bersifat immutable dan sudah ada; buat revisi baru.','REVISION_IMMUTABLE');
    const id=crypto.randomUUID(),staging=path.join(dir,`.staging-${id}`),target=safeDir(projectId,'revisions',id);
    fs.mkdirSync(path.join(staging,'src'),{recursive:true});
    try{
      const files=[];
      for(const file of clean.files){
        const dest=path.join(staging,'src',...file.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});
        writeFile(dest,file.content);files.push({path:file.path,bytes:Buffer.byteLength(file.content),sha256:sha256(file.content)});
      }
      files.sort((a,b)=>a.path.localeCompare(b.path));
      const sourceHash=sha256(files.map(f=>`${f.path}\0${f.sha256}`).join('\n'));
      const manifest={id,projectId,runtime:clean.runtime,commands:clean.commands,acceptanceTests:clean.acceptanceTests,knownLimitations:clean.knownLimitations,files,sourceHash,manifestHash:sha256(JSON.stringify({runtime:clean.runtime,commands:clean.commands,sourceHash})),createdAt:new Date().toISOString()};
      fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2));
      for(let attempt=0;;attempt++){try{rename(staging,target);break;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=4)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(attempt+1));}}
      // ponytail: read-only bit only; it keeps honest code from editing a revision, not a hostile local user.
      for(const file of files)fs.chmodSync(path.join(target,'src',...file.path.split('/')),0o444);
      return {id,sourceHash,manifestHash:manifest.manifestHash};
    }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  }
  const manifest=(projectId,revisionId)=>JSON.parse(fs.readFileSync(path.join(revisionDir(projectId,revisionId),'manifest.json'),'utf8'));
  function readFile(projectId,revisionId,rel){
    const dir=revisionDir(projectId,revisionId),clean=cleanPath(rel);
    if(!manifest(projectId,revisionId).files.some(f=>f.path===clean))fail(`File tidak ada di revisi: ${clean}`,'FILE_UNKNOWN');
    return fs.readFileSync(path.join(dir,'src',...clean.split('/')),'utf8');
  }
  // Download = the manifest plus each file by path; no archive is produced or advertised.
  const exportSource=(projectId,revisionId)=>{const m=manifest(projectId,revisionId);return {format:'files',manifest:m,files:m.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256}))};};
  const sourceDir=(projectId,revisionId)=>path.join(revisionDir(projectId,revisionId),'src');
  function verifyRevision(projectId,revisionId){
    const m=manifest(projectId,revisionId),root=sourceDir(projectId,revisionId);
    for(const file of m.files){const target=path.join(root,...file.path.split('/'));let cursor=root;for(const part of file.path.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())fail('Sumber berubah menjadi link.','SOURCE_CHANGED');}if(sha256(fs.readFileSync(target))!==file.sha256)fail('Hash sumber berubah sejak revisi disimpan.','SOURCE_CHANGED');}
    return m;
  }
  return {createProject,writeRevision,manifest,readFile,exportSource,sourceDir,verifyRevision};
}
module.exports={createProjectWorkspace,validateBundle,LIMITS};
