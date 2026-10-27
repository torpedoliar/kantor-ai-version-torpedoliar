#!/usr/bin/env node
// Restore a verified backup into DATA_DIR. Always snapshots the current data first.
// Usage: node scripts/restore-data.mjs --backup data/backups/backup-... --yes [--data DIR]
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import backup from '../server/backup.js';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
function options(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];if(!arg.startsWith('--'))continue;
    const key=arg.slice(2),next=argv[i+1];
    if(next&&!next.startsWith('--')){out[key]=next;i++;}else out[key]=true;
  }
  return out;
}
const opts=options(process.argv.slice(2));
if(!opts.backup){console.error('Pakai: node scripts/restore-data.mjs --backup <folder-backup> --yes [--data DIR]');process.exitCode=2;}
else if(opts.yes!==true){console.error('Restore menimpa data. Periksa backup lalu jalankan ulang dengan --yes.');process.exitCode=2;}
else{
  const dataDir=path.resolve(opts.data||process.env.DATA_DIR||path.join(root,'data'));
  const backupDir=path.resolve(opts.backup);
  try{
    const result=await backup.restoreData({dataDir,backupDir,confirm:true});
    console.log(`Restore ${result.restored} file → ${dataDir}`);
    console.log(`Backup pra-restore: ${result.preRestore}`);
    if(result.extras.length)console.log(`${result.extras.length} file di data yang tidak ada di backup dibiarkan: ${result.extras.slice(0,8).join(', ')}${result.extras.length>8?'…':''}`);
  }catch(error){
    console.error(`Restore gagal: ${error.message}`);process.exitCode=1;
  }
}
