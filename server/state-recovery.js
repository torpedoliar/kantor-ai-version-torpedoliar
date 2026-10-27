// Startup recovery for the JSON state files. A corrupt file is archived (never silently
// overwritten), the newest valid last-good snapshot is tried, and only then a caller-supplied
// fallback is used. Callers report the returned flags so the UI can say what happened.
const fs=require('node:fs');
const path=require('node:path');

const KEEP=5;
const stamp=(date=new Date())=>date.toISOString().replace(/[:.]/g,'-');
const snapshotDir=dataDir=>path.join(dataDir,'last-good');

function snapshotLastGood(file,dataDir,label=path.basename(file),keep=KEEP){
  if(!fs.existsSync(file))return null;
  const dir=snapshotDir(dataDir);fs.mkdirSync(dir,{recursive:true});
  const target=path.join(dir,`${label}.${stamp()}.json`);
  fs.copyFileSync(file,target);
  const names=fs.readdirSync(dir).filter(name=>name.startsWith(`${label}.`)&&name.endsWith('.json')).sort();
  for(const name of names.slice(0,Math.max(0,names.length-keep)))try{fs.unlinkSync(path.join(dir,name));}catch{}
  return target;
}

function archiveCorrupt(file,dataDir){
  if(!fs.existsSync(file))return null;
  const target=`${file}.corrupt-${stamp()}`;
  try{fs.renameSync(file,target);}
  catch{fs.copyFileSync(file,target);fs.unlinkSync(file);}
  return target;
}

// validate(value) throws when the parsed value is unusable. Fresh values are used for a missing
// file and (corruptFresh) for a corrupt file with no usable snapshot.
function recoverState({file,dataDir,label=path.basename(file),validate=()=>true,fresh,corruptFresh=fresh,keep=KEEP}={}){
  if(typeof fresh!=='function')throw new Error('recoverState needs a fresh() value.');
  if(!fs.existsSync(file))return {value:fresh(),label,file,missing:true,recovered:false,degraded:false};
  let parsed;
  try{parsed=JSON.parse(fs.readFileSync(file,'utf8'));validate(parsed);}
  catch(error){
    const corruptPath=archiveCorrupt(file,dataDir);
    const dir=snapshotDir(dataDir),prefix=`${label}.`;
    const candidates=fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>name.startsWith(prefix)&&name.endsWith('.json')).sort().reverse():[];
    for(const name of candidates){
      try{
        const value=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));validate(value);
        return {value,label,file,missing:false,recovered:true,degraded:false,corruptPath,lastGood:path.join(dir,name),error:error.message};
      }catch{/* try the next snapshot */}
    }
    return {value:corruptFresh(),label,file,missing:false,recovered:false,degraded:true,corruptPath,error:error.message};
  }
  let snapshot=null;try{snapshot=snapshotLastGood(file,dataDir,label,keep);}catch{/* a read-only data dir must not block startup */}
  return {value:parsed,label,file,missing:false,recovered:false,degraded:false,snapshot};
}

module.exports={recoverState,snapshotLastGood,archiveCorrupt,snapshotDir};
