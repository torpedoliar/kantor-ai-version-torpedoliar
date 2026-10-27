#!/usr/bin/env node
// Zero-dependency static gate: node --check every first-party JS file. Vendored ESM and browser
// modules that rely on import maps are covered by the browser tests instead.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const SKIP_DIRS=new Set(['node_modules','.git','data','.superpowers','vendor','assets','.zcode']);
const SKIP_FILES=new Set(['three-global.js']);
const roots=['server','public','tests','scripts'];
const files=[];
function walk(rel){
  const dir=path.join(root,rel);
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(SKIP_DIRS.has(entry.name))continue;
    const child=path.join(rel,entry.name);
    if(entry.isDirectory())walk(child);
    else if(/\.(js|cjs|mjs)$/.test(entry.name)&&!SKIP_FILES.has(entry.name))files.push(child);
  }
}
for(const dir of roots)walk(dir);
const failures=[];
for(const file of files.sort()){
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  if(result.status!==0)failures.push({file,error:(result.stderr||'').trim().split('\n').slice(0,4).join(' ')});
}
if(failures.length){
  console.error(`${failures.length} file(s) gagal parse:`);
  for(const failure of failures)console.error(`- ${failure.file}: ${failure.error}`);
  process.exitCode=1;
}else console.log(`OK: ${files.length} file JS lolos node --check.`);
