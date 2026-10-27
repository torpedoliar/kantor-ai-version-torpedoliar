#!/usr/bin/env node
// Snapshot the whole data directory with a checksum manifest: node scripts/backup-data.mjs [--data DIR] [--out DIR]
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
const dataDir=path.resolve(opts.data||process.env.DATA_DIR||path.join(root,'data'));
const outDir=opts.out?path.resolve(opts.out):undefined;
try{
  const result=await backup.backupData({dataDir,outDir,tag:opts.tag||'backup'});
  console.log(`Backup ${result.manifest.files.length} file → ${result.dir}`);
  console.log('Simpan folder ini beserta manifest.json; restore memeriksa checksum setiap file.');
}catch(error){
  console.error(`Backup gagal: ${error.message}`);process.exitCode=1;
}
