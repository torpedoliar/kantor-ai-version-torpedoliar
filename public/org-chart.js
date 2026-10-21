// Organization flowchart: division boxes with person cards, elbow lines, drag to re-parent and a side panel.
// Data and saving belong to tasks.js, which passes an `api`; layout and moves come from OrgModel.
(() => {
  'use strict';
  const M=window.OrgModel,SVG='http://www.w3.org/2000/svg';
  const ZOOMS=[.5,.6,.7,.8,.9,1,1.15,1.3,1.5];
  const EFFORTS=[['light','Ringan'],['standard','Standar'],['deep','Mendalam']];
  let api,root,zoom=1,selection=null,connectFrom=null,connecting=false,tab='Profil',pendingBusy=null,notice='';

  function h(tag,props={},...children){
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(props)){
      if(value===undefined||value===null||value===false)continue;
      if(key==='class')node.className=value;else if(key==='text')node.textContent=value;else if(key.startsWith('on'))node[key]=value;else if(key in node&&key!=='list')node[key]=value;else node.setAttribute(key,value===true?'':value);
    }
    node.append(...children.flat().filter(child=>child!==null&&child!==undefined&&child!==false));return node;
  }
  const field=(label,id,control)=>{control.id=id;return h('div',{class:'org-field'},h('label',{for:id,text:label}),control);};
  const options=(select,items,value)=>{for(const [v,label] of items)select.append(h('option',{value:v,text:label}));select.value=value??'';return select;};
  const state=()=>api.getState();
  const member=name=>state().members.find(m=>m.name===name);
  const division=id=>state().divisions.find(d=>d.id===id);

  // Every edit goes through here: unlock if needed, save, and handle the conflict and busy-member paths.
  async function commit(next,message){
    if(!api.isUnlocked()&&!(await api.unlock()))return false;
    try{await api.save(next);pendingBusy=null;notice=message||'Tersimpan.';render();return true;}
    catch(error){
      if(error.code==='ORG_MEMBER_BUSY'||error.code==='ORG_DIVISION_BUSY'){pendingBusy={next,tasks:error.tasks||[],message};render();return false;}
      if(error.code==='ORG_LOCKED'){api.clearToken();notice='Sesi kunci kedaluwarsa. Masukkan PIN lagi.';render();await api.unlock();return false;}
      if(error.status===409||/changed in another tab/i.test(error.message)){await api.reload();notice='Organisasi berubah di tab lain, dimuat ulang.';render();return false;}
      notice=error.message;render();return false;
    }
  }
  function flash(name,text){const card=root.querySelector(`.org-card[data-member="${CSS.escape(name)}"]`);if(!card)return;card.querySelector('.org-card-error')?.remove();const error=h('span',{class:'org-card-error',role:'alert',text});card.append(error);setTimeout(()=>error.remove(),3000);}
  let pendingMove=null;
  async function move(name,target){
    const result=M.moveMember(state(),name,target);
    if(result.error){flash(name,result.error);return;}
    selection={type:'member',name};pendingMove={name,result};render();
  }

  let companyView=false;
  function companyForm(){
    const c=state().company||{},name=h('input',{value:c.name||'',required:true,maxLength:160}),type=options(h('select'),['Marketing office','Software dev','Agensi kreatif','Toko & retail','Lainnya'].map(v=>[v,v]),c.type||'Lainnya'),description=h('textarea',{value:c.description||'',rows:5,maxLength:4000});
    return h('form',{class:'org-side org-side-form',onsubmit:async e=>{e.preventDefault();await commit({...state(),company:{name:name.value.trim(),type:type.value,description:description.value.trim()}},'Profil perusahaan disimpan.');}},field('Nama perusahaan','orgCompanyName',name),field('Jenis usaha','orgCompanyType',type),field('Deskripsi','orgCompanyDescription',description),h('button',{type:'submit',class:'task-primary',text:'Simpan profil'}));
  }
  function render(){
    if(!root)return;
    const s=state(),layout=M.chartLayout(s),locked=!api.isUnlocked();
    const toolbar=h('div',{class:'org-toolbar',role:'toolbar','aria-label':'Alat bagan organisasi'},
      h('button',{type:'button',id:'orgAddPerson',class:'org-tool',text:'+ Orang',onclick:addPerson}),
      h('button',{type:'button',id:'orgAddDivision',class:'org-tool',text:'+ Divisi',onclick:addDivision}),
      h('button',{type:'button',id:'orgConnect',class:'org-tool','aria-pressed':String(connecting),text:connecting?'Pilih divisi… (Esc batal)':'Hubungkan divisi',onclick:()=>{connecting=!connecting;connectFrom=null;render();}}),
      h('button',{type:'button',id:'orgTidy',class:'org-tool',text:'Rapikan',onclick:()=>{zoom=1;render();root.querySelector('#orgCanvas')?.scrollTo(0,0);}}),
      h('span',{class:'org-zoom'},h('button',{type:'button',id:'orgZoomOut',class:'org-tool','aria-label':'Perkecil',text:'−',onclick:()=>setZoom(-1)}),h('span',{id:'orgZoomLabel',text:`${Math.round(zoom*100)}%`}),h('button',{type:'button',id:'orgZoomIn',class:'org-tool','aria-label':'Perbesar',text:'+',onclick:()=>setZoom(1)})),
      h('button',{type:'button',id:'orgRearrange',class:'org-tool',text:'Susun ulang',onclick:()=>api.openWizard('edit')}),
      moreMenu(),
      locked?h('span',{class:'org-locked',text:'Terkunci · perubahan meminta PIN'}):null);
    const stage=h('div',{id:'orgStage',class:'org-stage',style:`width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom})`});
    const lines=document.createElementNS(SVG,'svg');lines.id='orgLines';lines.setAttribute('width',layout.width);lines.setAttribute('height',layout.height);lines.setAttribute('aria-hidden','true');stage.append(lines);
    const position=new Map(layout.nodes.map(n=>[n.name,n])),boxEls=new Map();
    for(const box of layout.boxes){
      const d=division(box.id),color=d.color||M.PALETTE[0];
      const title=h('button',{type:'button',class:'org-box-title',text:d.name,title:d.areaName?`Area 3D: ${d.areaName}`:undefined,onclick:()=>{if(connecting){connect(d.id);return;}select({type:'division',id:d.id});}});
      const el=h('section',{class:`org-box${selection?.type==='division'&&selection.id===d.id?' is-selected':''}${connectFrom===d.id?' is-connecting':''}`,'data-division':d.id,style:`left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;--division:${color}`,'aria-label':`Divisi ${d.name}`},h('div',{class:'org-box-head'},title,d.lead?null:h('span',{class:'org-box-warning',text:'Belum ada lead'})));
      stage.append(el);boxEls.set(box.id,{el,box});
    }
    for(const n of layout.nodes){
      const m=member(n.name),d=division(m.division),lead=d?.lead===m.name;
      const card=h('button',{type:'button',class:['org-card',lead&&'is-lead',m.isAgent&&'is-ai',m.active===false&&'is-inactive',selection?.type==='member'&&selection.name===m.name&&'is-selected'].filter(Boolean).join(' '),'data-member':m.name,style:`left:${n.x-(boxEls.get(m.division)?.box.x||0)}px;top:${n.y-(boxEls.get(m.division)?.box.y||0)}px;--division:${d?.color||M.PALETTE[0]}`,'aria-label':`${m.name}, ${m.role}${lead?', lead':''}${m.isAgent?', agen AI':''}`},
        h('strong',{text:m.name}),h('small',{text:m.role}),
        h('span',{class:'org-badges'},lead?h('span',{class:'org-badge',text:'Lead'}):null,m.isAgent?h('span',{class:'org-badge ai',text:'AI'}):null));
      dragBehaviour(card,m.name);(boxEls.get(m.division)?.el||stage).append(card);
      const boss=m.manager&&position.get(m.manager);
      if(boss){const x1=boss.x+M.CARD.w/2,y1=boss.y+M.CARD.h,x2=n.x+M.CARD.w/2,y2=n.y,mid=y1+(y2-y1)/2;const path=document.createElementNS(SVG,'path');path.setAttribute('d',`M${x1} ${y1}V${mid}H${x2}V${y2}`);path.setAttribute('class','org-link');lines.append(path);}
    }
    for(const d of s.divisions)for(const id of d.collaboratesWith){
      const a=layout.boxes.find(b=>b.id===d.id),b=layout.boxes.find(x=>x.id===id);if(!a||!b)continue;
      const path=document.createElementNS(SVG,'path'),x1=a.x+a.w/2,y1=a.y+a.h,x2=b.x+b.w/2,y2=b.y+b.h,dip=Math.max(y1,y2)+28;
      path.setAttribute('d',`M${x1} ${y1}C${x1} ${dip} ${x2} ${dip} ${x2} ${y2}`);path.setAttribute('class','org-collab');lines.append(path);
    }
    if(!layout.boxes.length)stage.append(h('div',{class:'org-empty'},h('p',{text:'Belum ada divisi.'}),h('button',{type:'button',class:'task-primary',text:'Susun organisasi dengan wizard',onclick:()=>api.openWizard('edit')})));
    const canvas=h('div',{id:'orgCanvas',class:'org-canvas',tabindex:'0','aria-label':'Kanvas bagan organisasi'},stage);
    panDrag(canvas);
    canvas.addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();setZoom(event.deltaY>0?-1:1);},{passive:false});
    const keepScroll=root.querySelector('#orgCanvas');const scroll=keepScroll?[keepScroll.scrollLeft,keepScroll.scrollTop]:[0,0];
    const live=h('p',{class:'org-notice',role:'status',text:notice});
    const views=h('div',{class:'org-tabs',role:'tablist','aria-label':'Tampilan organisasi'},h('button',{type:'button',role:'tab','aria-selected':String(!companyView),text:'Bagan',onclick:()=>{companyView=false;render();}}),h('button',{type:'button',role:'tab','aria-selected':String(companyView),text:'Profil perusahaan',onclick:()=>{companyView=true;render();}}));
    root.replaceChildren(views,toolbar,live,companyView?companyForm():h('div',{class:'org-workspace'},canvas,sidePanel()));
    canvas.scrollTo(...scroll);
  }
  function moreMenu(){
    const menu=h('details',{class:'org-more'},h('summary',{id:'orgMore',class:'org-tool','aria-label':'Lainnya',text:'⋯'}),
      h('div',{class:'org-more-menu'},
        h('button',{type:'button',class:'danger',text:'Setel ulang total',onclick:()=>{menu.open=false;api.openReset();}}),
        h('p',{id:'orgResetHint',class:'org-reset-hint',text:'Lupa PIN: hentikan server, hapus pinHash dari data/org.json, jalankan ulang, lalu buat PIN baru.'})));
    return menu;
  }
  function setZoom(step){const i=ZOOMS.indexOf(zoom);zoom=ZOOMS[Math.max(0,Math.min(ZOOMS.length-1,(i<0?5:i)+step))];render();}
  function panDrag(canvas){
    let start=null;
    canvas.addEventListener('pointerdown',event=>{if(event.target!==canvas&&!event.target.matches('#orgStage,#orgLines,.org-box'))return;start={x:event.clientX,y:event.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!start)return;canvas.scrollLeft=start.left-(event.clientX-start.x);canvas.scrollTop=start.top-(event.clientY-start.y);});
    const end=()=>{start=null;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  }
  // Pointer drag on a card: under 4px it stays a click; a drop on a card re-parents, on an empty box changes division.
  function dragBehaviour(card,name){
    let drag=null;
    card.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,moved:false};card.setPointerCapture(event.pointerId);});
    card.addEventListener('pointermove',event=>{
      if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;card.classList.add('is-dragging');card.style.translate=`${dx/zoom}px ${dy/zoom}px`;
      root.querySelectorAll('.is-drop').forEach(n=>n.classList.remove('is-drop'));dropTarget(event,card)?.el.classList.add('is-drop');
    });
    card.addEventListener('pointerup',async event=>{
      if(!drag)return;const moved=drag.moved;drag=null;card.classList.remove('is-dragging');card.style.translate='';root.querySelectorAll('.is-drop').forEach(n=>n.classList.remove('is-drop'));
      if(!moved){select({type:'member',name});return;}
      const target=dropTarget(event,card);if(!target)return;
      if(target.member){if(target.member===name)return;await move(name,{manager:target.member,division:member(target.member).division});}
      else if(target.division&&target.division!==member(name).division)await move(name,{division:target.division});
    });
    card.addEventListener('pointercancel',()=>{drag=null;card.classList.remove('is-dragging');card.style.translate='';});
    card.addEventListener('click',event=>{if(event.detail===0)select({type:'member',name});});
  }
  function dropTarget(event,self){
    self.style.pointerEvents='none';const under=document.elementFromPoint(event.clientX,event.clientY);self.style.pointerEvents='';
    const card=under?.closest('.org-card');if(card&&card!==self)return {el:card,member:card.dataset.member};
    const box=under?.closest('.org-box');return box?{el:box,division:box.dataset.division}:null;
  }
  async function connect(id){
    if(!connectFrom){connectFrom=id;render();return;}
    const from=connectFrom;connectFrom=null;connecting=false;
    if(from===id){render();return;}
    await commit(M.toggleCollaboration(state(),from,id),`Jalur kolaborasi ${division(from).name} ↔ ${division(id).name} diperbarui.`);
  }
  function select(next){selection=next;pendingMove=null;pendingBusy=null;notice='';tab='Profil';render();root.querySelector('#orgSide h3')?.focus?.();}

  async function addPerson(){
    const s=state(),target=selection?.type==='division'?selection.id:(s.divisions[0]?.id);
    if(!target){notice='Buat divisi dulu.';render();return;}
    let name='Orang baru',n=2;while(s.members.some(m=>m.name===name))name=`Orang baru ${n++}`;
    const lead=division(target).lead;
    const next={...s,divisions:s.divisions.map(d=>d.id===target&&!lead?{...d,lead:name}:d),members:[...s.members,{name,initials:'OB',role:'Peran',division:target,divisions:[target],manager:lead||null,active:true,effort:'standard',workloadPct:100,instructions:'',isAgent:false}]};
    if(await commit(next,`${name} ditambahkan. Ubah nama dan perannya di panel.`)){selection={type:'member',name};render();root.querySelector('#orgSideName')?.select();}
  }
  async function addDivision(){
    const next=M.addDivision(state(),'Divisi baru'),created=next.divisions.at(-1);
    if(await commit(next,'Divisi baru dibuat. Beri nama dan pilih lead.')){selection={type:'division',id:created.id};render();root.querySelector('#orgSideName')?.select();}
  }

  function sidePanel(){
    if(pendingMove){const {name,result}=pendingMove,m=result.state.members.find(m=>m.name===name);return h('aside',{id:'orgSide',class:'org-side'},h('h3',{text:'Konfirmasi perpindahan'}),h('p',{text:`${name} → ${m.manager||'Owner'} · ${result.state.divisions.find(d=>d.id===m.division)?.name}`}),h('p',{text:result.warnings.join(' ')}),h('button',{type:'button',class:'task-primary',text:'Terapkan perpindahan',onclick:async()=>{pendingMove=null;await commit(result.state,`${name} dipindahkan.`);}}),h('button',{type:'button',text:'Batal',onclick:()=>{pendingMove=null;render();}}));}
    if(!selection)return h('aside',{id:'orgSide',class:'org-side is-empty'},h('p',{text:connecting?'Klik judul dua divisi untuk menghubungkan atau memutus jalur kolaborasi.':'Klik kartu orang atau judul divisi untuk mengatur. Tarik kartu ke kartu lain untuk mengganti atasan.'}));
    return selection.type==='member'?memberPanel():divisionPanel();
  }
  const closeButton=()=>h('button',{type:'button',class:'org-side-close','aria-label':'Tutup panel',text:'×',onclick:()=>{selection=null;pendingBusy=null;render();}});
  function busyBlock(){
    if(!pendingBusy)return null;
    const people=state().members.filter(m=>m.active!==false&&!pendingBusy.tasks.some(t=>t.assignee===m.name));
    const target=options(h('select'),people.map(m=>[m.name,`${m.name} · ${m.role}`]),people[0]?.name);
    return h('div',{id:'orgBusy',class:'org-busy',role:'alert'},
      h('p',{text:'Masih ada tugas terbuka:'}),h('ul',{},pendingBusy.tasks.map(t=>h('li',{text:`${t.title} · ${t.assignee}`}))),
      field('Pindahkan semua ke','orgBusyTarget',target),
      h('button',{type:'button',id:'orgReassign',class:'task-primary',text:'Pindahkan semua ke…',onclick:async()=>{
        try{for(const from of new Set(pendingBusy.tasks.map(t=>t.assignee)))await api.reassign(from,target.value);}catch(error){notice=error.message;render();return;}
        const {next,message}=pendingBusy;pendingBusy=null;await commit(next,message);}}));
  }
  function memberPanel(){
    const m=member(selection.name);if(!m){selection=null;return sidePanel();}
    const s=state(),d=division(m.division),tabs=['Profil','Kerja','AI'];
    const name=h('input',{value:m.name,maxLength:120,required:true}),initials=h('input',{value:m.initials||'',maxLength:12}),role=h('input',{value:m.role,maxLength:120,required:true});
    const div=options(h('select'),s.divisions.map(x=>[x.id,x.name]),m.division);
    const manager=options(h('select'),[['','Owner (langsung)'],...s.members.filter(x=>x.active!==false&&x.name!==m.name&&!M.descendants(s,m.name).includes(x.name)).map(x=>[x.name,`${x.name} · ${x.role}`])],m.manager||'');
    const withTeam=h('input',{type:'checkbox'});
    const effort=options(h('select'),EFFORTS,m.effort||'standard'),workload=h('input',{type:'number',min:0,max:100,step:5,value:m.workloadPct??100});
    const instructions=h('textarea',{rows:5,maxLength:4000,value:m.instructions||''});
    const agent=h('input',{type:'checkbox',checked:m.isAgent===true}),model=options(h('select'),[['','Ikuti model default di Pengaturan'],...api.modelOptions()],api.memberRoute(m.name));
    const panes={
      Profil:[field('Nama','orgSideName',name),field('Inisial','orgSideInitials',initials),field('Peran','orgSideRole',role),field('Divisi','orgSideDivision',div),h('label',{class:'org-check'},withTeam,' Pindahkan beserta timnya'),field('Atasan','orgSideManager',manager)],
      Kerja:[field('Effort','orgSideEffort',effort),field('Kapasitas kerja (%)','orgSideWorkload',workload),field('Instruksi anggota','orgSideInstructions',instructions)],
      AI:[h('label',{class:'org-check'},agent,' Jadikan agen AI'),field('Model','orgSideModel',model),h('p',{class:'org-hint',text:api.modelOptions().length?'Daftar berasal dari model yang diambil di Pengaturan. Instruksi ada di tab Kerja.':'Belum ada model: buka Pengaturan, tambah provider, lalu klik Ambil model.'})]
    };
    withTeam.id='orgMoveWithTeam';agent.id='orgSideAgent';
    const tablist=h('div',{class:'org-tabs',role:'tablist'},tabs.map(t=>h('button',{type:'button',role:'tab','aria-selected':String(t===tab),text:t,onclick:()=>{collect();tab=t;render();}})));
    // Keep edits from other tabs while switching.
    const draft=selection.draft||(selection.draft={});
    const collect=()=>Object.assign(draft,{name:name.value,initials:initials.value,role:role.value,division:div.value,manager:manager.value,withTeam:withTeam.checked,effort:effort.value,workloadPct:workload.value,instructions:instructions.value,isAgent:agent.checked,model:model.value});
    for(const [key,input] of [['name',name],['initials',initials],['role',role],['division',div],['manager',manager],['effort',effort],['workloadPct',workload],['instructions',instructions],['model',model]])if(draft[key]!==undefined)input.value=draft[key];
    if(draft.withTeam!==undefined)withTeam.checked=draft.withTeam;if(draft.isAgent!==undefined)agent.checked=draft.isAgent;
    const form=h('form',{class:'org-side-form',onsubmit:async event=>{
      event.preventDefault();collect();
      const nextName=draft.name.trim(),nextRole=draft.role.trim();if(!nextName||!nextRole){notice='Nama dan peran wajib diisi.';render();return;}
      let next=state();
      if(draft.division!==m.division){const moved=M.moveMember(next,m.name,{division:draft.division,withTeam:draft.withTeam});if(moved.error){notice=moved.error;render();return;}next=moved.state;}
      else if((draft.manager||null)!==(m.manager||null)){const moved=M.moveMember(next,m.name,{manager:draft.manager||null});if(moved.error){notice=moved.error;render();return;}next=moved.state;}
      next={...next,members:next.members.map(x=>x.name===m.name?{...x,initials:draft.initials.trim()||nextName.split(/\s+/).map(p=>p[0]).join('').slice(0,4).toUpperCase(),role:nextRole,effort:draft.effort,workloadPct:Math.max(0,Math.min(100,Math.round(Number(draft.workloadPct)||0))),instructions:draft.instructions.trim(),isAgent:draft.isAgent}:x)};
      if(nextName!==m.name){if(state().members.some(x=>x.name===nextName)){notice='Nama sudah dipakai.';render();return;}next=M.renameMember(next,m.name,nextName);}
      const routeChanged=draft.model!==api.memberRoute(m.name);
      if(await commit(next,`${nextName} disimpan.`)){selection={type:'member',name:nextName};if(routeChanged){try{await api.saveMemberRoutes({[nextName]:draft.model});notice=`${nextName} disimpan, model diperbarui.`;}catch(error){notice=error.message;}}}render();
    }},tablist,h('div',{class:'org-pane',role:'tabpanel'},panes[tab]),busyBlock(),
      h('button',{type:'submit',id:'orgSideSave',class:'task-primary',text:'Simpan'}),
      h('div',{class:'org-secondary'},
        h('button',{type:'button',id:'orgSideToggleActive',text:m.active===false?'Aktifkan':'Nonaktifkan',onclick:async()=>{const result=M.setActive(state(),m.name,m.active===false);if(result.error){notice=result.error;render();return;}await commit(result.state,m.active===false?`${m.name} aktif lagi.`:`${m.name} dinonaktifkan.`);}}),
        h('button',{type:'button',text:'Tunjukkan di kantor',onclick:()=>{window.officeNav.close();window.officeScene?.select?.(m.name);}})));
    return h('aside',{id:'orgSide',class:'org-side'},closeButton(),h('h3',{tabindex:'-1',text:m.name}),h('p',{class:'org-side-meta',text:`${m.role} · ${d?.name||m.division}${d?.lead===m.name?' · Lead':''}${m.active===false?' · Nonaktif':''}`}),form);
  }
  function divisionPanel(){
    const s=state(),d=s.divisions.find(x=>x.id===selection.id);if(!d){selection=null;return sidePanel();}
    const name=h('input',{value:d.name,maxLength:120,required:true}),area=h('input',{value:d.areaName||'',maxLength:120,placeholder:d.name});
    const people=s.members.filter(m=>m.active!==false&&m.division===d.id);
    const lead=options(h('select'),[['','(belum dipilih)'],...people.map(m=>[m.name,`${m.name} · ${m.role}`])],d.lead||'');
    const colors=h('div',{class:'org-swatches',role:'radiogroup','aria-label':'Warna divisi'},M.PALETTE.map(c=>h('label',{class:'org-swatch',style:`--swatch:${c}`},h('input',{type:'radio',name:'color',value:c,checked:c===d.color,'aria-label':c}))));
    const collab=h('fieldset',{class:'org-collab-list'},h('legend',{text:'Bekerja sama dengan'}),s.divisions.filter(x=>x.id!==d.id).map(x=>h('label',{class:'org-check'},h('input',{type:'checkbox',name:'collab',value:x.id,checked:d.collaboratesWith.includes(x.id)}),` ${x.name}`)));
    const others=s.divisions.filter(x=>x.id!==d.id),moveTarget=options(h('select'),others.map(x=>[x.id,x.name]),others[0]?.id);
    const count=s.members.filter(m=>m.division===d.id).length;
    const form=h('form',{class:'org-side-form',onsubmit:async event=>{
      event.preventDefault();
      if(!name.value.trim()){notice='Nama divisi wajib diisi.';render();return;}
      let next=state();
      if(lead.value&&lead.value!==d.lead)next=M.setLead(next,d.id,lead.value);
      next={...next,divisions:next.divisions.map(x=>x.id===d.id?{...x,name:name.value.trim(),areaName:area.value.trim(),color:form.querySelector('input[name=color]:checked')?.value||x.color,collaboratesWith:[...form.querySelectorAll('input[name=collab]:checked')].map(i=>i.value)}:x)};
      if(await commit(next,`Divisi ${name.value.trim()} disimpan.`))selection={type:'division',id:d.id};render();
    }},
      field('Nama divisi','orgSideName',name),field('Nama area 3D','orgSideArea',area),h('p',{class:'org-hint',text:'Kosongkan agar papan di kantor mengikuti nama divisi.'}),
      field('Lead','orgSideLead',lead),h('div',{class:'org-field'},h('span',{class:'org-label',text:'Warna'}),colors),collab,busyBlock(),
      h('button',{type:'submit',id:'orgSideSave',class:'task-primary',text:'Simpan'}),
      h('div',{class:'org-secondary'},
        h('button',{type:'button',text:'Kirim review roster',disabled:!d.lead,onclick:()=>api.sendRosterReview(d.id)}),
        count&&others.length?h('div',{class:'org-move-all'},field('Pindahkan semua anggota ke','orgMoveAllTarget',moveTarget),h('button',{type:'button',id:'orgMoveAll',text:'Pindahkan semua anggota ke…',onclick:async()=>{await commit(M.moveAllMembers(state(),d.id,moveTarget.value),`Anggota ${d.name} dipindahkan.`);}})):null,
        h('button',{type:'button',class:'danger',id:'orgRemoveDivision',text:'Hapus divisi',onclick:async()=>{const result=M.removeDivision(state(),d.id);if(result.error){notice=result.error;render();return;}if(await commit(result.state,`Divisi ${d.name} dihapus.`))selection=null;render();}})));
    return h('aside',{id:'orgSide',class:'org-side'},closeButton(),h('h3',{tabindex:'-1',text:d.name}),h('p',{class:'org-side-meta',text:`${count} orang · ${d.lead?`Lead ${d.lead}`:'Belum ada lead'}`}),form);
  }

  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&connecting&&root?.isConnected){connecting=false;connectFrom=null;render();event.stopPropagation();event.preventDefault();}},true);
  window.OrgChart={
    mount(container,nextApi){
      api=nextApi;root=container;render();
    },
    render,
    reset(){selection=null;connecting=false;connectFrom=null;pendingBusy=null;notice='';}
  };
})();
