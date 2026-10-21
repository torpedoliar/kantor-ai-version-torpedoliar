// Organization wizard (7 steps) and the total-reset dialog. tasks.js passes `api` (see wizardApi there).
// The draft lives in memory until Simpan; nothing is written before the summary step.
(() => {
  'use strict';
  const M=window.OrgModel;
  const STEPS=[['pin','PIN'],['company','Perusahaan'],['template','Template'],['divisions','Divisi'],['people','Orang'],['agents','Agen AI'],['summary','Ringkasan']];
  const TYPES=['Marketing office','Software dev','Agensi kreatif','Toko & retail','Lainnya'];
  const SUGGEST={'Marketing office':'marketing','Software dev':'software-dev','Agensi kreatif':'creative-agency','Toko & retail':'retail','Lainnya':'example'};
  let api,mode,draft,step,templates={},templateChoice,busy=null,reassignments={},models={},aiModel='',resumeStep=null,selectedPerson=null,peopleQuery='',nextId=1;
  // Draft-only id so the editor follows a person through renames; it is stripped before saving.
  const tag=m=>{if(!m._id)Object.defineProperty(m,'_id',{value:`p${nextId++}`,enumerable:false});return m;};
  const el=id=>document.getElementById(id);

  function h(tag,props={},...children){
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(props)){
      if(value===undefined||value===null||value===false)continue;
      if(key==='class')node.className=value;else if(key==='text')node.textContent=value;else if(key.startsWith('on'))node[key]=value;else if(key in node)node[key]=value;else node.setAttribute(key,value===true?'':value);
    }
    node.append(...children.flat().filter(child=>child!==null&&child!==undefined&&child!==false));return node;
  }
  const field=(label,id,control)=>{control.id=id;return h('div',{class:'wizard-field'},h('label',{for:id,text:label}),control);};
  const select=(name,items,value)=>{const s=h('select',{name});for(const [v,label] of items)s.append(h('option',{value:v,text:label}));s.value=value??'';return s;};
  const initials=name=>name.trim().split(/\s+/).map(part=>part[0]||'').join('').slice(0,4).toUpperCase();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const message=text=>{const m=el('wizardMessage');if(m)m.textContent=text||'';};

  async function open(nextMode,nextApi){
    api=nextApi;mode=nextMode;busy=null;reassignments={};models={};aiModel='';resumeStep=null;selectedPerson=null;peopleQuery='';
    const current=api.getState();
    draft={company:{name:'',type:'Lainnya',description:'',...clone(current.company||{})},divisions:clone(current.divisions||[]),members:clone(current.members||[])};
    if(mode!=='edit'){draft.divisions=[];draft.members=[];if(mode==='after-reset')draft.company={name:'',type:'Lainnya',description:''};}
    templateChoice=mode==='edit'?'keep':null;
    try{templates=await api.call('GET','/api/org/templates');}catch{templates={};}
    step=api.isUnlocked()?1:0;
    const dialog=el('wizardDialog');if(!dialog.open)dialog.showModal();render();
  }
  function close(){const dialog=el('wizardDialog');if(dialog.open)dialog.close();}

  function render(){
    const dialog=el('wizardDialog');
    const steps=h('ol',{class:'wizard-steps'},STEPS.map(([key,label],i)=>h('li',{'aria-current':i===step?'step':undefined,class:i<step?'done':undefined,text:label})));
    const body=h('div',{class:'wizard-body'},STEPS.map(([key],i)=>{const section=h('section',{'data-step':key,hidden:i!==step});if(i===step)section.append(...builders[key]().filter(Boolean));return section;}));
    const footer=h('footer',{class:'wizard-footer'},
      h('button',{type:'button',id:'wizardCancel',class:'wizard-ghost',text:mode==='first-run'||mode==='after-reset'?'Nanti saja':'Batal',onclick:()=>{if(mode==='first-run')try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1');}catch{}close();}}),
      h('p',{id:'wizardMessage',role:'status'}),
      step>0?h('button',{type:'button',id:'wizardBack',text:'Kembali',onclick:()=>{collect();step=Math.max(api.isUnlocked()?1:0,step-1);render();}}):null,
      step<STEPS.length-1?h('button',{type:'submit',id:'wizardNext',class:'wizard-primary',text:'Lanjut'}):h('button',{type:'submit',id:'wizardSave',class:'wizard-primary',text:'Simpan organisasi',disabled:!!busy}));
    const form=h('form',{class:'wizard-form',novalidate:true,onsubmit:async event=>{event.preventDefault();collect();const error=await validate();if(error===null)return;if(error){message(error);return;}if(step===STEPS.length-1){await save();return;}step++;render();el('wizardDialog').querySelector('[data-step]:not([hidden]) input,[data-step]:not([hidden]) select,[data-step]:not([hidden]) button')?.focus();}},
      h('header',{class:'wizard-header'},h('h2',{id:'wizardHeading',text:mode==='edit'?'Susun ulang organisasi':'Susun organisasimu'}),h('p',{text:'Langkah demi langkah. Tidak ada yang tersimpan sebelum Ringkasan.'})),steps,body,footer);
    dialog.replaceChildren(form);
  }

  const builders={
    pin:()=>[h('h3',{text:'PIN owner'}),h('p',{class:'wizard-hint',text:'PIN melindungi perubahan organisasi. Pertama kali dipakai, PIN ini langsung menjadi PIN owner.'}),field('PIN (4–6 angka)','wizardPin',h('input',{type:'password',inputMode:'numeric',maxLength:6,autocomplete:'off'}))],
    company:()=>{const type=select('type',TYPES.map(t=>[t,t]),draft.company.type);return [h('h3',{text:'Profil perusahaan'}),
      field('Nama perusahaan','wizardCompanyName',h('input',{value:draft.company.name,maxLength:160,required:true})),
      field('Jenis usaha','wizardCompanyType',type),
      field('Deskripsi singkat','wizardCompanyDescription',h('textarea',{rows:3,maxLength:4000,value:draft.company.description,placeholder:'Apa yang dikerjakan perusahaan ini? Agen AI memakai konteks ini.'}))];},
    template:()=>{
      const suggested=SUGGEST[draft.company.type]||'example';if(!templateChoice)templateChoice=suggested;
      const choices=[...(mode==='edit'?[['keep','Pertahankan struktur saat ini',`${draft.divisions.length} divisi · ${draft.members.length} orang`]]:[]),['ai','Mulai dari 0 — disusun AI','AI membaca profil perusahaan lalu menyusun divisi, orang, atasan dan effort. Kamu periksa dulu sebelum disimpan.'],...Object.entries(templates).map(([key,t])=>[key,t.label||key,t.divisions.map(d=>d.name).join(' · ')||'Tanpa divisi'])];
      const warning=h('p',{id:'wizardReplaceWarning',class:'wizard-warning',hidden:!(mode==='edit'&&templateChoice!=='keep'),text:'Template akan mengganti semua divisi dan orang. Tugas yang masih terbuka harus dipindahkan sebelum disimpan.'});
      const options=api.modelOptions();
      const picker=select('aiModel',[['',options.length?'Pilih model penyusun':'Belum ada model — ambil dulu di Pengaturan'],...options],aiModel||options[0]?.[0]||'');picker.id='wizardAiModel';picker.onchange=()=>{aiModel=picker.value;};
      const aiBox=h('div',{class:'wizard-ai',hidden:templateChoice!=='ai'},h('label',{for:'wizardAiModel',text:'Agent penyusun (model yang juga dipakai semua agen)'}),picker,h('p',{class:'wizard-hint',text:'Pastikan deskripsi perusahaan di langkah sebelumnya cukup jelas: bidang usaha, layanan, ukuran tim.'}));
      return [h('h3',{text:'Mulai dari template'}),h('div',{class:'wizard-choices',role:'radiogroup'},choices.map(([key,label,detail])=>h('label',{class:'wizard-choice'},h('input',{type:'radio',name:'template',value:key,checked:key===templateChoice,onchange:()=>{templateChoice=key;warning.hidden=!(mode==='edit'&&key!=='keep');aiBox.hidden=key!=='ai';}}),h('span',{},h('strong',{text:label+(key===suggested?' · disarankan':'')}),h('small',{text:detail}))))),aiBox,warning];
    },
    divisions:()=>{
      const rows=h('div',{class:'wizard-rows'},draft.divisions.map((d,i)=>h('div',{class:'wizard-row','data-index':i},
        h('input',{name:'name','aria-label':'Nama divisi',value:d.name,maxLength:120,placeholder:'Nama divisi'}),
        select('lead',[['','(pilih nanti)'],...draft.members.map(m=>[m.name,m.name])],d.lead),
        h('fieldset',{class:'wizard-collab'},h('legend',{text:'Bekerja sama dengan'}),draft.divisions.filter(x=>x.id!==d.id).map(x=>h('label',{},h('input',{type:'checkbox',name:'collab',value:x.id,checked:d.collaboratesWith.includes(x.id)}),` ${x.name||'(tanpa nama)'}`))),
        h('button',{type:'button',class:'wizard-ghost','aria-label':`Hapus divisi ${d.name}`,text:'Hapus',onclick:()=>{collect();draft.members=draft.members.filter(m=>m.division!==d.id);draft.divisions=draft.divisions.filter(x=>x.id!==d.id).map(x=>({...x,collaboratesWith:x.collaboratesWith.filter(c=>c!==d.id)}));render();}}))));
      return [h('h3',{text:'Divisi'}),h('p',{class:'wizard-hint',text:'Lead bisa dipilih setelah orang ditambahkan di langkah berikutnya.'}),rows,h('button',{type:'button',id:'wizardAddDivision',text:'+ Divisi',onclick:()=>{collect();const next=M.addDivision(draft,'');draft.divisions=next.divisions;render();el('wizardDialog').querySelector('.wizard-row:last-child input[name=name]')?.focus();}})];
    },
    people:()=>{
      draft.members.forEach(tag);
      const search=h('input',{type:'search',id:'wizardPeopleSearch',value:peopleQuery,placeholder:'Cari nama atau peran','aria-label':'Cari orang',oninput:()=>{peopleQuery=search.value;filterPeople();}});
      const groups=h('div',{class:'wizard-people-groups'},draft.divisions.map(d=>{
        const list=draft.members.filter(m=>m.division===d.id);
        return h('details',{class:'wizard-division-group',open:true,'data-division':d.id},
          h('summary',{class:'wizard-group-head'},h('strong',{text:d.name||'(tanpa nama)'}),h('span',{text:` · Lead: ${d.lead||'belum dipilih'} · ${list.length} orang`})),
          h('ul',{class:'wizard-people-list'},list.map(personRow)));
      }));
      const orphans=draft.members.filter(m=>!draft.divisions.some(d=>d.id===m.division));
      return [h('h3',{text:'Orang'}),draft.divisions.length?null:h('p',{class:'wizard-warning',text:'Tambahkan divisi dulu di langkah sebelumnya.'}),
        h('div',{class:'wizard-people'},
          h('div',{class:'wizard-people-side'},h('div',{class:'wizard-people-tools'},search,h('button',{type:'button',id:'wizardAddPerson',disabled:!draft.divisions.length,text:'+ Orang',onclick:addPerson})),
            groups,orphans.length?h('ul',{class:'wizard-people-list'},orphans.map(personRow)):null),
          personEditor())];
    },
    agents:()=>[h('h3',{text:'Agen AI'}),h('p',{class:'wizard-hint',text:'Agen AI mengerjakan tugas sendiri dan mengirim draf untuk kamu review. Provider dan model diatur di Pengaturan.'}),
      h('div',{class:'wizard-agents'},draft.members.filter(m=>m.active!==false).map(m=>{const pick=select('model',[['','Ikuti default Pengaturan'],...api.modelOptions()],models[m.name]??api.memberRoute(m.name));pick.dataset.model=m.name;pick.setAttribute('aria-label',`Model untuk ${m.name}`);return h('div',{class:'wizard-agent'},h('label',{},h('input',{type:'checkbox','data-member':m.name,checked:m.isAgent===true}),h('span',{},h('strong',{text:m.name}),h('small',{text:m.role}))),pick);})),api.modelOptions().length?null:h('p',{class:'wizard-hint',text:'Belum ada model: tambahkan provider di Pengaturan lalu klik Ambil model.'})],
    summary:()=>{
      const plan=M.planSeating(draft),name=id=>draft.divisions.find(d=>d.id===id)?.name||id;
      const lines=plan.floors.map((f,i)=>`Lantai kerja ${i+1}: ${f.areas.length?f.areas.map(a=>`${a.label} (${a.seats.length})`).join(', '):'kosong'}`);
      return [h('h3',{text:'Ringkasan'}),
        h('dl',{class:'wizard-summary'},h('dt',{text:'Perusahaan'}),h('dd',{text:`${draft.company.name} · ${draft.company.type}`}),h('dt',{text:'Divisi'}),h('dd',{text:`${draft.divisions.length} divisi · ${draft.members.length} orang · ${draft.members.filter(m=>m.isAgent).length} agen AI`})),
        h('ul',{class:'wizard-tree'},draft.divisions.map(d=>h('li',{},h('strong',{text:`${d.name} · dipimpin ${d.lead}`}),h('span',{text:draft.members.filter(m=>m.division===d.id).map(m=>m.name).join(', ')||'—'})))),
        h('h4',{text:'Denah kantor'}),h('p',{class:'wizard-hint',text:'Kantor 3D ditata ulang otomatis; lantai kerja ditambah kalau meja kurang.'}),
        h('pre',{id:'wizardFloorPlan',class:'wizard-floorplan',text:lines.join('\n')}),
        busy?busyBlock():null];
    }
  };
  function personRow(m){
    const row=h('li',{},h('button',{type:'button',class:'wizard-person','data-member-id':m._id,'aria-current':m._id===selectedPerson?'true':undefined,title:`${m.name} · ${m.role}`,onclick:()=>{selectedPerson=m._id;renderPeople();}},
      h('strong',{text:m.name||'(tanpa nama)'}),h('small',{text:m.role||'(peran kosong)'}),m.manager?h('small',{class:'wizard-person-manager',text:`atasan: ${m.manager}`}):null,m.isAgent?h('span',{class:'wizard-person-tag',text:'AI'}):null));
    row.hidden=!matches(m);return row;
  }
  const matches=m=>!peopleQuery.trim()||`${m.name} ${m.role}`.toLowerCase().includes(peopleQuery.trim().toLowerCase());
  function filterPeople(){el('wizardDialog').querySelectorAll('.wizard-person').forEach(button=>{const m=draft.members.find(x=>x._id===button.dataset.memberId);button.parentElement.hidden=!m||!matches(m);});}
  // Re-render only the people step (keeps focus where the owner was typing).
  function renderPeople(){
    const section=el('wizardDialog').querySelector('[data-step="people"]');if(!section)return;
    const focused=document.activeElement?.id,start=document.activeElement?.selectionStart,end=document.activeElement?.selectionEnd,scroll=section.closest('.wizard-body')?.scrollTop;
    section.replaceChildren(...builders.people().filter(Boolean));
    const again=focused&&document.getElementById(focused);if(again){again.focus({preventScroll:true});try{again.setSelectionRange(start,end);}catch{}}
    const body=section.closest('.wizard-body');if(body&&scroll!==undefined)body.scrollTop=scroll;
  }
  function personEditor(){
    const m=draft.members.find(x=>x._id===selectedPerson);
    if(!m)return h('section',{id:'wizardPersonEditor',class:'wizard-person-editor'},h('p',{class:'wizard-hint',text:'Pilih orang di kiri untuk mengubah nama, peran, divisi, atasan dan effort.'}));
    const error=m.name.trim()?(draft.members.some(x=>x!==m&&x.name===m.name.trim())?'Nama sudah dipakai orang lain.':''):'Isi nama orang ini.';
    const name=h('input',{value:m.name,maxLength:120,oninput:()=>{rename(m,name.value);renderPeople();}});
    const role=h('textarea',{rows:2,maxLength:120,value:m.role,oninput:()=>{m.role=role.value;renderPeople();}});
    const division=select('division',draft.divisions.map(d=>[d.id,d.name||'(tanpa nama)']),m.division);division.onchange=()=>{m.division=division.value;m.divisions=[division.value];renderPeople();};
    const manager=select('manager',[['','Owner (langsung)'],...draft.members.filter(x=>x!==m&&x.name).map(x=>[x.name,`${x.name} · ${x.role}`])],m.manager||'');manager.onchange=()=>{m.manager=manager.value||null;renderPeople();};
    const effort=select('effort',[['light','Ringan'],['standard','Standar'],['deep','Mendalam']],m.effort||'standard');effort.onchange=()=>{m.effort=effort.value;};
    return h('section',{id:'wizardPersonEditor',class:'wizard-person-editor','aria-label':`Ubah ${m.name||'orang baru'}`},
      h('h4',{text:m.name||'Orang baru'}),
      field('Nama','wizardPersonName',name),error?h('p',{class:'wizard-field-error',role:'alert',text:error}):null,
      field('Peran','wizardPersonRole',role),field('Divisi','wizardPersonDivision',division),field('Atasan','wizardPersonManager',manager),field('Effort','wizardPersonEffort',effort),
      h('button',{type:'button',class:'wizard-ghost wizard-danger',text:'Hapus orang ini',onclick:()=>{const at=draft.members.indexOf(m);draft.members.splice(at,1);for(const x of draft.members)if(x.manager===m.name)x.manager=m.manager;for(const d of draft.divisions)if(d.lead===m.name)d.lead='';selectedPerson=null;renderPeople();}}));
  }
  // A rename follows to the division lead and to every report's manager, so references never dangle.
  function rename(m,value){const from=m.name,to=value.trim();m.name=value;m.initials=initials(to);if(!from||from===to)return;for(const x of draft.members)if(x.manager===from)x.manager=to;for(const d of draft.divisions)if(d.lead===from)d.lead=to;if(Object.hasOwn(models,from)){models[to]=models[from];delete models[from];}}
  function addPerson(){const division=draft.divisions[0].id,m=tag({name:'',initials:'',role:'',division,divisions:[division],manager:draft.divisions[0].lead||null,active:true,effort:'standard',workloadPct:100,instructions:'',isAgent:false,model:null});draft.members.push(m);selectedPerson=m._id;peopleQuery='';renderPeople();el('wizardPersonName')?.focus();}
  function busyBlock(){
    const targets=draft.members.filter(m=>m.active!==false&&m.name);
    return h('div',{id:'wizardReassign',class:'wizard-busy',role:'alert'},h('p',{text:'Orang yang akan dihapus masih punya tugas terbuka. Pindahkan dulu:'}),
      [...new Set(busy.map(t=>t.assignee))].map(from=>{const target=select('target',targets.map(m=>[m.name,m.name]),targets[0]?.name);return h('div',{class:'wizard-row'},h('span',{text:`${from}: ${busy.filter(t=>t.assignee===from).map(t=>t.title).join(', ')}`}),target,
        h('button',{type:'button',text:'Pindahkan tugas ke…',disabled:!targets.length,onclick:async()=>{try{reassignments[from]=target.value;busy=busy.filter(t=>t.assignee!==from);if(!busy.length)busy=null;render();}catch(error){message(error.message);}}}));}));
  }

  // Read the visible step's inputs back into the draft.
  function collect(){
    const section=el('wizardDialog')?.querySelector('[data-step]:not([hidden])');if(!section)return;const key=section.dataset.step;
    if(key==='template'&&el('wizardAiModel'))aiModel=el('wizardAiModel').value;
    if(key==='company')draft.company={name:el('wizardCompanyName').value.trim(),type:el('wizardCompanyType').value,description:el('wizardCompanyDescription').value.trim()};
    if(key==='divisions')section.querySelectorAll('.wizard-row').forEach(row=>{const d=draft.divisions[row.dataset.index];d.name=row.querySelector('[name=name]').value.trim();d.lead=row.querySelector('[name=lead]').value;d.collaboratesWith=[...row.querySelectorAll('[name=collab]:checked')].map(i=>i.value);});
    if(key==='people')for(const m of draft.members){m.name=m.name.trim();m.role=m.role.trim();}
    if(key==='agents'){section.querySelectorAll('input[data-member]').forEach(input=>{const m=draft.members.find(x=>x.name===input.dataset.member);if(m)m.isAgent=input.checked;});section.querySelectorAll('select[data-model]').forEach(pick=>{models[pick.dataset.model]=pick.value;});}
  }
  async function validate(){
    const key=STEPS[step][0];
    if(key==='pin'){
      const pin=el('wizardPin').value;if(!/^\d{4,6}$/.test(pin))return 'PIN harus 4–6 angka.';
      try{const result=await api.call('POST','/api/org/unlock',{pin});api.setToken(result.token);}catch(error){return error.message;}
      if(resumeStep!==null){step=resumeStep-1;resumeStep=null;}
    }
    if(key==='company'&&!draft.company.name)return 'Isi nama perusahaan.';
    if(key==='template'&&templateChoice==='ai'){
      if(!aiModel)return 'Pilih model penyusun dulu.';
      if(!draft.company.description)return 'Isi deskripsi perusahaan dulu (kembali ke langkah Perusahaan) agar AI punya bahan.';
      message('AI sedang menyusun organisasi… biasanya 10–60 detik, jangan tutup jendela ini.');el('wizardNext').disabled=true;
      try{const result=await api.call('POST','/api/org/ai-draft',{company:draft.company,route:api.routeOf(aiModel)});draft.divisions=result.divisions;draft.members=result.members;models=Object.fromEntries(result.members.map(m=>[m.name,aiModel]));}
      catch(error){if(relock(error))return null;return error.message;}
      finally{const next=el('wizardNext');if(next)next.disabled=false;}
      templateChoice='keep-draft';return '';
    }
    if(key==='template'&&templateChoice!=='keep'&&templateChoice!=='keep-draft'){
      const t=clone(templates[templateChoice]||{divisions:[],members:[]});
      draft.divisions=t.divisions.map(d=>({areaName:'',...d}));draft.members=t.members.map(m=>({divisions:[m.division],effort:'standard',workloadPct:100,instructions:'',isAgent:false,model:null,...m}));
      if(!draft.company.description&&t.company?.description)draft.company.description=t.company.description;
      templateChoice='keep-draft';
    }
    if(key==='divisions'){
      if(draft.divisions.some(d=>!d.name))return 'Setiap divisi butuh nama.';
      if(new Set(draft.divisions.map(d=>d.name.toLowerCase())).size!==draft.divisions.length)return 'Nama divisi tidak boleh sama.';
    }
    if(key==='people'){
      if(draft.members.some(m=>!m.name||!m.role))return 'Setiap orang butuh nama dan peran.';
      if(new Set(draft.members.map(m=>m.name)).size!==draft.members.length)return 'Nama orang tidak boleh sama.';
      const missing=draft.divisions.filter(d=>draft.members.some(m=>m.division===d.id)&&!draft.members.some(m=>m.name===d.lead));
      if(missing.length)return `Pilih lead untuk ${missing.map(d=>d.name).join(', ')} (kembali ke langkah Divisi).`;
      const check={...draft,members:draft.members.map(m=>({...m}))};for(const m of check.members){const seen=new Set([m.name]);let cursor=m.manager;while(cursor){if(seen.has(cursor))return `Atasan ${m.name} membuat siklus.`;seen.add(cursor);cursor=check.members.find(x=>x.name===cursor)?.manager;}}
    }
    return '';
  }
  // An owner session can expire (server restart, reset in another tab): ask for the PIN, then come back here.
  function relock(error){
    if(error?.code!=='ORG_LOCKED')return false;
    api.clearToken();resumeStep=step;step=0;render();message('Sesi PIN berakhir. Masukkan PIN lagi untuk melanjutkan.');return true;
  }
  async function save(){
    const current=api.getState();
    try{
      const saved=await api.call('POST','/api/org/wizard',{draft:{...current,company:draft.company,divisions:draft.divisions,members:draft.members},version:current.version,reassignments});
      api.setState(saved);
      // Only send routes that differ from what Settings already has.
      const changed=Object.fromEntries(Object.entries(models).filter(([name,value])=>saved.members.some(m=>m.name===name)&&value!==api.memberRoute(name)));
      if(Object.keys(changed).length)try{await api.saveMemberRoutes(changed);}catch(error){api.feedback(`Organisasi disimpan, tapi model gagal disimpan: ${error.message}`);close();return;}
      close();api.feedback('Organisasi disimpan. Kantor ditata ulang.');
    }catch(error){
      if(error.code==='ORG_MEMBER_BUSY'||error.code==='ORG_DIVISION_BUSY'){busy=error.tasks;render();message('Pindahkan tugas yang masih terbuka dulu.');return;}
      if(relock(error))return;
      message(error.message);
    }
  }

  // Total reset: PIN + typed RESET, archive download, then the wizard starts over.
  function openReset(nextApi){
    api=nextApi;const dialog=el('resetDialog');
    const pin=h('input',{type:'password',inputMode:'numeric',maxLength:6,autocomplete:'off'}),confirm=h('input',{autocomplete:'off',placeholder:'RESET'});
    const submit=h('button',{type:'submit',id:'resetSubmit',class:'wizard-danger',text:'Setel ulang total',disabled:true});
    const sync=()=>{submit.disabled=!(/^\d{4,6}$/.test(pin.value)&&confirm.value==='RESET');};pin.oninput=confirm.oninput=sync;
    const status=h('p',{id:'resetMessage',role:'status'}),archive=h('div',{id:'resetArchive'});
    const form=h('form',{class:'wizard-form',onsubmit:async event=>{
      event.preventDefault();if(submit.disabled)return;submit.disabled=true;status.textContent='Mengarsipkan tugas…';
      try{
        const unlocked=await api.call('POST','/api/org/unlock',{pin:pin.value});api.setToken(unlocked.token);
        const result=await api.call('POST','/api/org/reset',{pin:pin.value,confirmation:'RESET',version:api.getState().version});
        const again=await api.call('POST','/api/org/unlock',{pin:pin.value});api.setToken(again.token);
        const data=await api.call('GET',`/api/org/archive/${encodeURIComponent(result.archiveName)}`);
        api.setState(result.org);await api.reloadTasks?.();
        const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
        status.textContent='Organisasi dan tugas dikosongkan. PIN dan pengaturan tetap.';
        archive.replaceChildren(h('a',{href:url,download:result.archiveName,class:'wizard-primary',text:`Unduh arsip tugas (${data.length})`}),h('button',{type:'button',id:'resetContinue',class:'wizard-primary',text:'Susun organisasi baru',onclick:()=>{dialog.close();open('after-reset',api);}}));
        pin.disabled=confirm.disabled=true;
      }catch(error){status.textContent=error.message;sync();}
    }},
      h('h2',{id:'resetHeading',text:'Setel ulang total'}),
      h('p',{class:'wizard-warning',text:'Semua divisi, orang dan tugas dihapus. Tugas diarsipkan dulu dan bisa diunduh. PIN dan pengaturan provider tetap.'}),
      field('PIN owner','resetPin',pin),field('Ketik RESET untuk mengonfirmasi','resetConfirm',confirm),status,archive,
      h('footer',{class:'wizard-footer'},h('button',{type:'button',class:'wizard-ghost',text:'Batal',onclick:()=>dialog.close()}),submit));
    dialog.replaceChildren(form);dialog.showModal();pin.focus();
  }

  window.OrgWizard={open,openReset,close};
})();
