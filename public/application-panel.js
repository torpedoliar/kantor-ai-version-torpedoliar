// The source/command approval panel is shared by Tugas and the task's Komunikasi thread.
(() => {
  const cache=new Map(),ack=new Set();
  function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function button(text,fn){const b=node('button',text);b.type='button';b.onclick=fn;return b;}
  function mount(container,task,api){
    const panel=node('section',undefined,'application-panel');panel.id=container.id==='messageTimeline'?'messageApplicationPanel':'applicationPanel';container.append(panel);
    if(!task.revisionId){panel.append(node('p',task.error||'Agen sedang menyiapkan sumber aplikasi.'));return;}
    const key=`${task.projectId}/${task.revisionId}`;
    if(!cache.has(key)){panel.append(node('p','Memuat revisi…'));api.call('GET',`/api/projects/${task.projectId}/revisions/${task.revisionId}`).then(m=>{cache.set(key,m);render();}).catch(e=>{panel.textContent=e.message;});return;}
    render();
    function render(){
      const m=cache.get(key);panel.replaceChildren(node('h4','Revisi aplikasi'),node('p',`${m.files.length} file · ${m.runtime} · ${task.revisionId.slice(0,8)}`,'task-meta'));
      const commands=node('pre',Object.entries(m.commands).map(([p,c])=>`${p}: node ${c.args.join(' ')}`).join('\n'),'application-commands');panel.append(commands);
      const source=node('div',undefined,'application-source');source.hidden=true;
      const inspect=button('Periksa sumber',()=>{source.hidden=!source.hidden;});panel.append(inspect,source);
      m.files.forEach(file=>{
        const row=node('div'),get=button(file.path,async()=>{try{const response=await api.source(task,file.path);const details=node('pre',response);row.append(details);}catch(e){api.feedback(e.message);}});
        const download=button('Unduh',async()=>{try{const text=await api.source(task,file.path);const url=URL.createObjectURL(new Blob([text],{type:'text/plain'})),link=node('a');link.href=url;link.download=file.path.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){api.feedback(e.message);}});
        row.append(get,download);source.append(row);
      });
      // Copy this revision to a folder the owner picks. Existing files are only replaced after an explicit confirm.
      const exportBox=node('div',undefined,'application-export'),label=node('label','Salin ke folder'),folder=node('input');
      folder.id=`exportTarget-${panel.id}`;folder.placeholder='Contoh: E:\\Vibe\\Calculator';label.htmlFor=folder.id;
      const exportButton=button('Salin sumber ke folder',async()=>{const target=folder.value.trim();if(!target){api.feedback('Isi folder tujuan dulu.');return;}
        const run=overwrite=>api.call('POST',`/api/projects/${task.projectId}/revisions/${task.revisionId}/export`,{target,overwrite});
        exportButton.disabled=true;
        try{let result;try{result=await run(false);}catch(e){if(e.code!=='EXPORT_NOT_EMPTY'&&!/sudah berisi/.test(e.message))throw e;if(!confirm(`${target} sudah berisi file. Timpa file dengan nama yang sama?`))return;result=await run(true);}
          api.feedback(`${result.files.length} file disalin ke ${result.target}.`);}
        catch(e){api.feedback(e.message);}finally{exportButton.disabled=false;}});
      exportBox.append(label,folder,exportButton);panel.append(exportBox);
      if(task.error)panel.append(node('p',task.error,'task-error'));
      if(task.phase==='awaiting_approval'){
        const warning=node('p',task.environment==='windows'?'Windows lokal bukan sandbox. Kode memiliki akses akun Windows kamu; akses jaringan mengikuti OS. Periksa semua sumber dan perintah sebelum menyetujui.':'Docker memakai sumber read-only dan jaringan mati. Tidak beralih ke Windows jika Docker tidak tersedia.','application-warning');panel.append(warning);
        const approve=button('Setujui & jalankan pengujian',async()=>{approve.disabled=true;try{await api.call('POST',`/api/tasks/${task.id}/application/approve`,{revisionId:task.revisionId,manifestHash:m.manifestHash,acknowledgeHostAccess:ack.has(key),networkAllowed:false});await api.reload();}catch(e){approve.disabled=false;api.feedback(e.message);}});approve.className='task-primary';
        if(task.environment==='windows'){const label=node('label'),input=node('input');input.type='checkbox';input.checked=ack.has(key);approve.disabled=!input.checked;input.onchange=()=>{input.checked?ack.add(key):ack.delete(key);approve.disabled=!input.checked;};label.append(input,document.createTextNode(' Saya memahami akses akun dan jaringan mengikuti OS'));panel.append(label);}
        panel.append(approve);
      }
      if(task.evidence){
        panel.append(node('h4','Bukti pengujian'),node('p',`Revisi ${task.evidence.revisionId.slice(0,8)} · exit ${task.evidence.exitCode}`));
        const list=node('ul');task.evidence.criteria.forEach(c=>list.append(node('li',`${c.criterion}: ${c.status}`)));panel.append(list,node('p',`Keterbatasan: ${m.knownLimitations.join('; ')||'Belum dinyatakan'}`));
        panel.append(button('Buka preview terisolasi',async()=>{try{const result=await api.call('POST',`/api/tasks/${task.id}/application/preview`,{});panel.querySelector('iframe')?.remove();const frame=node('iframe');frame.id='applicationPreview';frame.title='Preview aplikasi terisolasi';frame.setAttribute('sandbox','allow-scripts');frame.src=result.url;panel.append(frame);}catch(e){api.feedback(e.message);}}));
      }
    }
  }
  window.ApplicationPanel={mount};
})();
