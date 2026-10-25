(() => {
  const el=id=>document.getElementById(id);let csrf='',state=null,open=false,dirty=false,previousFocus=null;
  const key='kantor-ai.general.v1';
  const readPrefs=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}};
  const savePrefs=next=>{try{localStorage.setItem(key,JSON.stringify(next));return true}catch{return false}};
  async function session(){try{const response=await fetch('/api/session',{cache:'no-store'});if(!response.ok)throw 0;csrf=(await response.json()).csrf||'';return true}catch{return false}}
  async function api(method,path,body){const response=await fetch(path,{method,headers:{'content-type':'application/json','x-kantor-csrf':csrf},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Server error ${response.status}`);return data}
  function message(text,error=false){const node=el('settingsMessage');node.textContent=text;node.classList.toggle('settings-error',error)}
  function providerCard(provider){
    const article=document.createElement('article');article.className='settings-card';
    const title=document.createElement('h3');title.textContent=provider.displayName;article.append(title);
    const meta=document.createElement('p');meta.className='settings-meta';meta.textContent=`${provider.protocol} · ${provider.baseUrl} · ${provider.hasCredential?'Kredensial tersimpan':'Kredensial belum ada'}${provider.environmentManaged?' · Dikelola environment':''} · ${provider.models.length} model`;article.append(meta);
    const row=document.createElement('div');row.className='settings-actions';
    const test=document.createElement('button');test.type='button';test.textContent='Tes koneksi';test.disabled=provider.environmentManaged;
    test.onclick=async()=>{try{await api('POST',`/api/settings/providers/${encodeURIComponent(provider.id)}/test`,{});message(`${provider.displayName}: tes koneksi berhasil.`)}catch(error){message(error.message,true)}};row.append(test);
    const fetchModels=document.createElement('button');fetchModels.type='button';fetchModels.textContent='Ambil model';fetchModels.disabled=provider.environmentManaged;
    fetchModels.onclick=async()=>{fetchModels.disabled=true;message(`${provider.displayName}: mengambil model…`);try{state=await api('POST',`/api/settings/providers/${encodeURIComponent(provider.id)}/models`,{});render();const count=state.providers.find(p=>p.id===provider.id)?.models.length||0;message(`${provider.displayName}: ${count} model diambil. Pilih model di Model dan routing.`)}catch(error){message(`${provider.displayName}: gagal mengambil model — ${error.message}`,true)}finally{fetchModels.disabled=false}};row.append(fetchModels);article.append(row);return article;
  }
  function render(){
    const list=el('settingsProviders');list.replaceChildren();if(!state){list.append(Object.assign(document.createElement('p'),{textContent:'Server tidak tersedia. Pengaturan provider membutuhkan server Node lokal.'}));el('settingsVersion').textContent='Mode browser saja';return;}
    if(!state.providers.length)list.append(Object.assign(document.createElement('p'),{textContent:'Belum ada provider. Tambahkan lewat formulir di atas.'}));
    state.providers.forEach(provider=>list.append(providerCard(provider)));
    el('settingsVersion').textContent=`Versi konfigurasi ${state.version}`;
    renderRouting();
  }
  // Every fetched model of every enabled provider, as "providerId|modelId" options.
  function modelOptions(){return state.providers.filter(p=>p.enabled!==false).flatMap(p=>p.models.filter(m=>m.status!=='stale').map(m=>[`${p.id}|${m.id}`,`${p.displayName} · ${m.name||m.id}`]));}
  const routeValue=route=>route?`${route.providerId}|${route.modelId}`:'';
  const routeOf=value=>{if(!value)return null;const at=value.indexOf('|');return {providerId:value.slice(0,at),modelId:value.slice(at+1)};};
  function routeSelect(id,label,value,empty){const wrap=document.createElement('div');const l=document.createElement('label');l.htmlFor=id;l.textContent=label;const select=document.createElement('select');select.id=id;select.append(Object.assign(document.createElement('option'),{value:'',textContent:empty}));for(const [v,t] of modelOptions())select.append(Object.assign(document.createElement('option'),{value:v,textContent:t}));select.value=value;wrap.append(l,select);return wrap;}
  function renderRouting(){
    const box=el('settingsRouting');box.replaceChildren();
    const options=modelOptions();if(!options.length){box.append(Object.assign(document.createElement('p'),{textContent:'Belum ada model. Tambahkan provider lalu klik Ambil model.'}));return;}
    const form=document.createElement('form');form.className='settings-form';
    form.append(routeSelect('routeDefault','Model default untuk semua agen AI',routeValue(state.defaultRoute),'Tanpa model (mode dry run)'),routeSelect('routeFallback','Model cadangan bila model default gagal',routeValue(state.fallbackRoute),'Tanpa cadangan'));
    // Max output tokens per call. Empty = unlimited (default), so reasoning models are never cut off by a hidden cap.
    const tokens=Object.assign(document.createElement('input'),{id:'routeMaxTokens',type:'number',min:256,max:1000000,step:256,placeholder:'Tanpa batas',value:state.maxTokens??''});
    const tokensLabel=Object.assign(document.createElement('label'),{htmlFor:'routeMaxTokens',textContent:'Maks token per jawaban (kosong = tanpa batas)'});
    form.append(tokensLabel,tokens);
    // How many agents may call a model at the same time. Protects the provider's rate limit; the rest wait in the queue
    // and start by task priority. Each provider can also have its own lower cap.
    const conc=Object.assign(document.createElement('input'),{id:'routeConcurrency',type:'number',min:1,max:100,step:1,placeholder:'Tanpa batas',value:state.concurrency??''});
    const concLabel=Object.assign(document.createElement('label'),{htmlFor:'routeConcurrency',textContent:'Maks agen bersamaan di seluruh kantor (kosong = tanpa batas)'});
    form.append(concLabel,conc);
    for(const p of state.providers.filter(p=>!p.environmentManaged)){
      const id='providerConcurrency-'+p.id;
      const input=Object.assign(document.createElement('input'),{id,type:'number',min:1,max:100,step:1,placeholder:'Ikuti batas kantor',value:p.maxConcurrent??''});
      form.append(Object.assign(document.createElement('label'),{htmlFor:id,textContent:`Maks bersamaan untuk ${p.displayName} (kosong = ikuti batas kantor)`}),input);
    }
    form.append(Object.assign(document.createElement('p'),{className:'settings-hint',textContent:'Agen yang melebihi batas menunggu giliran; tugas prioritas tinggi jalan lebih dulu.'}));
    const save=Object.assign(document.createElement('button'),{type:'submit',className:'primary',textContent:'Simpan routing'});form.append(save);
    form.onsubmit=async event=>{event.preventDefault();const defaultRoute=routeOf(el('routeDefault').value),fallbackRoute=routeOf(el('routeFallback').value);
      // A chosen model is enabled so the server accepts the route.
      const used=[defaultRoute,fallbackRoute,...Object.values(state.overrides||{})].filter(Boolean);
      const cap=id=>{const v=el('providerConcurrency-'+id)?.value.trim();return v?Number(v):null;};
      const providers=state.providers.filter(p=>!p.environmentManaged).map(p=>({...p,maxConcurrent:cap(p.id),models:p.models.map(m=>used.some(r=>r.providerId===p.id&&r.modelId===m.id)?{...m,enabled:true}:m)}));
      const maxTokens=el('routeMaxTokens').value.trim()?Number(el('routeMaxTokens').value):null;
      const concurrency=el('routeConcurrency').value.trim()?Number(el('routeConcurrency').value):null;
      try{state=await api('PUT','/api/settings',{...state,providers,defaultRoute,fallbackRoute,maxTokens,concurrency,version:state.version});dirty=false;render();message('Routing disimpan.')}catch(error){message(error.message,true)}};
    box.append(form);
  }
  window.officeModels={options:()=>state?modelOptions():[],overrides:()=>state?.overrides||{},load:async(force)=>{if(!state||force)await load();return state?modelOptions():[]},routeOf,routeValue};
  async function load(){if(!await session()){state=null;render();return}try{state=await api('GET','/api/settings');render()}catch(error){state=null;render();message(error.message,true)}}
  const clearProviderForm=()=>{el('providerName').value='';el('providerProtocol').value='anthropic';el('providerBaseUrl').value='';el('providerCredential').value='';dirty=false};
  el('providerForm').onsubmit=async event=>{event.preventDefault();if(!state){message('Server lokal tidak tersedia.',true);return}const provider={id:crypto.randomUUID(),displayName:el('providerName').value.trim(),protocol:el('providerProtocol').value,baseUrl:el('providerBaseUrl').value.trim(),enabled:true,models:[],credential:el('providerCredential').value};if(!provider.displayName||!provider.baseUrl||!provider.credential){message('Nama, URL dasar, dan API key wajib diisi.',true);return}try{state=await api('PUT','/api/settings',{...state,providers:[...state.providers.filter(item=>!item.environmentManaged),provider],version:state.version});el('providerCredential').value='';clearProviderForm();render();message('Provider disimpan.')}catch(error){message(error.message,true)}};
  el('providerCancel').onclick=clearProviderForm;
  function close(){if(dirty&&!confirm('Buang perubahan Pengaturan yang belum disimpan?'))return false;dirty=false;window.officeNav.close();open=false;previousFocus?.focus();return true;}
  window.officeSettings={open:async()=>{previousFocus=document.activeElement;open=true;window.officeNav.open('settingsDialog');await load();el('settingsClose').focus()},close,refresh:load,preferences:{read:readPrefs,save:savePrefs}};
  window.officeNav.guard('settingsDialog',()=>!dirty||confirm('Buang perubahan Pengaturan yang belum disimpan?'));
  el('settingsClose').onclick=close;
  el('settingsDialog').addEventListener('cancel',event=>{event.preventDefault();close()});
  el('settingsDialog').addEventListener('input',event=>{if(!['settingsGraphics','settingsFps'].includes(event.target.id))dirty=true;});
  el('settingsGeneralSave').onclick=()=>{const prefs={...readPrefs(),routineDefault:el('settingsRoutine').checked,logVisible:el('settingsLog').checked};if(savePrefs(prefs)){dirty=false;message('Preferensi browser disimpan.')}else message('Penyimpanan browser tidak tersedia.',true)};
  el('settingsExport').onclick=()=>{const payload={schemaVersion:1,providers:state?.providers?.filter(provider=>!provider.environmentManaged).map(provider=>({...provider,hasCredential:undefined}))||[],general:readPrefs()};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='kantor-kita-settings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Pengaturan aman diekspor.')};
  el('settingsReset').onclick=async()=>{if(!state||!confirm('Reset provider dan routing? Kredensial dan metadata provider akan dihapus.'))return;try{state=await api('POST','/api/settings/reset',{version:state.version});render();message('Provider dan routing direset.')}catch(error){message(error.message,true)}};
  el('settingsRoutine').checked=readPrefs().routineDefault!==false;el('settingsLog').checked=readPrefs().logVisible===true;
  // Graphics level applies immediately (no Save needed) and is remembered per browser by officeGraphics.
  el('settingsGraphics').value=window.officeGraphics.level();
  el('settingsGraphics').onchange=event=>{event.stopPropagation();window.officeGraphics.set(el('settingsGraphics').value);message(`Level grafis: ${window.officeGraphics.LEVELS[window.officeGraphics.level()].label}.`);};
  el('settingsFps').checked=readPrefs().showFps===true;
  el('settingsFps').onchange=()=>{savePrefs({...readPrefs(),showFps:el('settingsFps').checked});window.officeScene?.showFps?.(el('settingsFps').checked);};
})();
