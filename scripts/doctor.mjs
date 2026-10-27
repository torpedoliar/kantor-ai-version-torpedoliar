#!/usr/bin/env node
// Check every state file, settings.key, project folders and backups without starting the server.
// Usage: node scripts/doctor.mjs [--data DIR]
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
const report=backup.inspectData({dataDir});
console.log(`Data: ${report.dataDir}`);
console.log(`Ukuran: ${(report.storageBytes/1048576).toFixed(1)} MB · ${report.backups.length} backup`);
if(report.counts)console.log(`Workspace: ${report.counts.tasks} tugas · ${report.counts.messages} pesan · ${report.counts.events} event · ${report.counts.projects} proyek · ${report.counts.jobs} job`);
for(const issue of report.issues)console.log(`${issue.level==='error'?'ERROR':'WARN '} ${issue.file}: ${issue.message}`);
if(report.ok)console.log('OK: semua file state utama bisa dibaca.');
else console.log('Periksa file di atas. Backup terbaru ada di data/backups; restore memakai scripts/restore-data.mjs.');
process.exitCode=report.ok?0:1;
