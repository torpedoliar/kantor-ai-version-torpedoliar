// Pure organization logic: member moves, division edits, the chart layout and the 3D seating plan.
// Every function returns new data and never mutates its input. Loaded by the browser and by Node tests.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OrgModel=factory();})(this,()=>{
  'use strict';
  const PALETTE=['#2f4a6b','#b4623a','#3f7a58','#74598c','#a8842c','#2e7d8c','#b0455e','#5d6b2f'];
  const CARD={w:150,h:52},GAP_X=16,GAP_Y=40,PAD=12,HEAD=22,BOX_GAP=32,LEAF_COLS=1,AREA_SEATS=8,FLOOR_AREAS=4;
  const CYCLE='Tidak bisa: membuat siklus';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const find=(state,name)=>state.members.find(m=>m.name===name);
  const divisionById=(state,id)=>state.divisions.find(d=>d.id===id);

  function leadershipId(state){return state.divisions.find(d=>find(state,d.lead)?.manager===null)?.id||null;}
  function descendants(state,name){const out=[],queue=[name],seen=new Set([name]);while(queue.length){const current=queue.shift();for(const m of state.members)if(m.manager===current&&!seen.has(m.name)){seen.add(m.name);out.push(m.name);queue.push(m.name);}}return out;}
  function hasCycle(state){for(const m of state.members){const seen=new Set([m.name]);let cursor=m.manager;while(cursor){if(seen.has(cursor))return true;seen.add(cursor);cursor=find(state,cursor)?.manager||null;}}return false;}
  // The top lead a newly led division reports to, unless that would point someone at themselves.
  function topLead(state,except){const id=leadershipId(state),lead=id?divisionById(state,id).lead:null;return lead&&lead!==except?lead:null;}

  function moveMember(state,name,{manager,division,withTeam=false}={}){
    const next=clone(state),mover=find(next,name);if(!mover)return {state,warnings:[],error:'Anggota tidak ditemukan.'};
    if(manager!==undefined&&manager!==null&&(manager===name||descendants(state,name).includes(manager)))return {state,warnings:[],error:CYCLE};
    const warnings=[],oldDivision=mover.division,oldManager=mover.manager;
    const target=division||(manager?find(next,manager)?.division:oldDivision)||oldDivision;
    if(target!==oldDivision){
      const team=withTeam?descendants(state,name):[];
      if(!withTeam)for(const m of next.members)if(m.manager===name)m.manager=oldManager;
      for(const m of next.members)if(m.name===name||team.includes(m.name)){m.division=target;m.divisions=[target];}
      const old=divisionById(next,oldDivision);
      if(old&&old.lead===name){
        const heir=state.members.find(m=>m.manager===name&&!team.includes(m.name)&&m.division===oldDivision);
        old.lead=heir?heir.name:'';
        warnings.push(heir?`${name} bukan lagi lead ${old.name}; ${heir.name} jadi lead.`:`${old.name} belum punya lead.`);
        if(heir)find(next,heir.name).manager=oldManager;
      }
      const dest=divisionById(next,target);
      if(manager!==undefined)mover.manager=manager;
      else if(dest&&!dest.lead){dest.lead=name;mover.manager=topLead(next,name);}
      else mover.manager=dest?.lead&&dest.lead!==name?dest.lead:mover.manager;
    }else if(manager!==undefined)mover.manager=manager;
    if(hasCycle(next))return {state,warnings:[],error:CYCLE};
    return {state:next,warnings};
  }
  function toggleCollaboration(state,fromId,toId){
    if(fromId===toId)return clone(state);const next=clone(state),from=divisionById(next,fromId);if(!from||!divisionById(next,toId))return next;
    from.collaboratesWith=from.collaboratesWith.includes(toId)?from.collaboratesWith.filter(id=>id!==toId):[...from.collaboratesWith,toId];return next;
  }
  const slug=name=>String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'divisi';
  function addDivision(state,name){
    const next=clone(state),base=slug(name),ids=new Set(next.divisions.map(d=>d.id));let id=base;for(let n=2;ids.has(id);n++)id=`${base}-${n}`;
    const used=new Set(next.divisions.map(d=>d.color));const color=PALETTE.find(c=>!used.has(c))||PALETTE[next.divisions.length%PALETTE.length];
    next.divisions.push({id,name:String(name).trim(),areaName:'',color,lead:'',collaboratesWith:[]});return next;
  }
  function removeDivision(state,id){
    if(state.members.some(m=>m.division===id))return {state,error:'Pindahkan semua anggota dulu.'};
    const next=clone(state);next.divisions=next.divisions.filter(d=>d.id!==id).map(d=>({...d,collaboratesWith:d.collaboratesWith.filter(c=>c!==id)}));return {state:next};
  }
  function moveAllMembers(state,fromId,toId){
    const next=clone(state),lead=divisionById(next,toId)?.lead||null;
    for(const m of next.members)if(m.division===fromId){m.division=toId;m.divisions=[toId];m.manager=lead&&lead!==m.name?lead:topLead(next,m.name);}
    const from=divisionById(next,fromId);if(from)from.lead='';return next;
  }

  // The new lead takes the old lead's manager; the old lead and everyone who reported to it move under the new lead.
  function setLead(state,divisionId,name){
    const next=clone(state),d=divisionById(next,divisionId),lead=find(next,name);if(!d||!lead)return next;
    const old=d.lead,oldLead=find(next,old);if(old===name)return next;
    const above=oldLead?oldLead.manager:topLead(next,name);
    for(const m of next.members)if(m.name!==name&&(m.manager===old||m.name===old))m.manager=name;
    lead.manager=above===name?null:above;lead.division=divisionId;lead.divisions=[divisionId];d.lead=name;
    return next;
  }
  function setActive(state,name,active){
    const next=clone(state),m=find(next,name);if(!m)return {state,error:'Anggota tidak ditemukan.'};
    if(!active){const led=next.divisions.find(d=>d.lead===name);if(led)return {state,error:`Pilih lead lain untuk ${led.name} dulu.`};for(const r of next.members)if(r.manager===name)r.manager=m.manager;}
    m.active=active;return {state:next};
  }
  function renameMember(state,from,to){
    const next=clone(state);for(const m of next.members){if(m.name===from)m.name=to;if(m.manager===from)m.manager=to;}for(const d of next.divisions)if(d.lead===from)d.lead=to;return next;
  }

  // Members of one division in tree order: lead first, then depth-first through managers inside the division.
  function divisionOrder(state,divisionId,activeOnly){
    const members=state.members.filter(m=>m.division===divisionId&&(!activeOnly||m.active!==false)),names=new Set(members.map(m=>m.name));
    const lead=divisionById(state,divisionId)?.lead,out=[],seen=new Set();
    const visit=name=>{if(seen.has(name)||!names.has(name))return;seen.add(name);out.push(name);for(const m of members)if(m.manager===name)visit(m.name);};
    if(lead)visit(lead);for(const m of members)if(!names.has(m.manager)||m.manager===null)visit(m.name);for(const m of members)visit(m.name);
    return out;
  }
  function orderedDivisions(state){const top=leadershipId(state);return [...state.divisions].sort((a,b)=>(b.id===top)-(a.id===top));}

  function planSeating(state){
    const areas=[];
    for(const d of orderedDivisions(state)){
      const seats=divisionOrder(state,d.id,true),base=d.areaName||d.name;
      for(let i=0;i<seats.length;i+=AREA_SEATS)areas.push({divisionId:d.id,label:i?`${base} (lanjutan)`:base,color:d.color||PALETTE[0],seats:seats.slice(i,i+AREA_SEATS)});
    }
    const floors=[];
    areas.forEach((area,i)=>{const index=Math.floor(i/FLOOR_AREAS);floors[index]||(floors[index]={level:`work-${index+1}`,areas:[]});floors[index].areas.push({...area,slot:i%FLOOR_AREAS});});
    return {floors:floors.length?floors:[{level:'work-1',areas:[]}]};
  }

  // Tidy top-down tree inside each division box. Leaf siblings stack in LEAF_COLS columns under their manager, as in printed org charts, so the chart stays narrow.
  function layoutDivision(state,divisionId){
    const order=divisionOrder(state,divisionId,false),names=new Set(order),lead=divisionById(state,divisionId)?.lead;
    const childrenOf=name=>order.filter(n=>{const m=find(state,n);return n!==name&&(m.manager===name||(name===lead&&n!==lead&&!names.has(m.manager)));});
    const roots=names.has(lead)?[lead]:order.filter(n=>!names.has(find(state,n).manager));
    const seen=new Set();
    function measure(name){
      seen.add(name);const kids=childrenOf(name).filter(k=>!seen.has(k));kids.forEach(k=>seen.add(k));
      const sub=kids.map(k=>{seen.delete(k);return measure(k);});
      if(!sub.length)return {name,w:CARD.w,h:CARD.h,place:(x,y,out)=>out.push({name,x,y})};
      const leaves=sub.every(s=>s.leaf!==false&&s.w===CARD.w&&s.h===CARD.h);
      if(leaves&&sub.length>LEAF_COLS){
        const cols=LEAF_COLS,rows=Math.ceil(sub.length/cols),gw=cols*CARD.w+(cols-1)*GAP_X,gh=rows*CARD.h+(rows-1)*GAP_Y/2,w=Math.max(CARD.w,gw);
        return {name,w,h:CARD.h+GAP_Y+gh,leaf:false,place:(x,y,out)=>{out.push({name,x:x+(w-CARD.w)/2,y});sub.forEach((s,i)=>out.push({name:s.name,x:x+(w-gw)/2+(i%cols)*(CARD.w+GAP_X),y:y+CARD.h+GAP_Y+Math.floor(i/cols)*(CARD.h+GAP_Y/2)}));}};
      }
      const rowW=sub.reduce((t,s)=>t+s.w,0)+GAP_X*(sub.length-1),w=Math.max(CARD.w,rowW),h=CARD.h+GAP_Y+Math.max(...sub.map(s=>s.h));
      return {name,w,h,leaf:false,place:(x,y,out)=>{out.push({name,x:x+(w-CARD.w)/2,y});let cx=x+(w-rowW)/2;for(const s of sub){s.place(cx,y+CARD.h+GAP_Y,out);cx+=s.w+GAP_X;}}};
    }
    const trees=[];for(const r of roots)if(!seen.has(r))trees.push(measure(r));for(const n of order)if(!seen.has(n))trees.push(measure(n));
    const w=trees.reduce((t,s)=>t+s.w,0)+GAP_X*Math.max(0,trees.length-1),h=trees.length?Math.max(...trees.map(s=>s.h)):0;
    return {w,h,place:(x,y,out)=>{let cx=x;for(const t of trees){t.place(cx,y,out);cx+=t.w+GAP_X;}}};
  }
  function chartLayout(state){
    const nodes=[],boxes=[],top=leadershipId(state);
    const sized=orderedDivisions(state).map(d=>{const inner=layoutDivision(state,d.id);return {id:d.id,inner,w:Math.max(200,inner.w+PAD*2),h:Math.max(CARD.h,inner.h)+PAD*2+HEAD};});
    const head=sized.filter(b=>b.id===top),rest=sized.filter(b=>b.id!==top);
    const rowW=rest.reduce((t,b)=>t+b.w,0)+BOX_GAP*Math.max(0,rest.length-1),width=Math.max(rowW,...head.map(b=>b.w),0);
    const place=(b,x,y)=>{boxes.push({id:b.id,x,y,w:b.w,h:b.h});b.inner.place(x+(b.w-b.inner.w)/2,y+PAD+HEAD,nodes);};
    let y=0;for(const b of head){place(b,(width-b.w)/2,y);y+=b.h+BOX_GAP+GAP_Y;}
    let x=(width-rowW)/2;for(const b of rest){place(b,x,y);x+=b.w+BOX_GAP;}
    const height=boxes.length?Math.max(...boxes.map(b=>b.y+b.h)):0;
    return {nodes,boxes,width,height};
  }
  return {PALETTE,CARD,leadershipId,descendants,moveMember,setLead,setActive,renameMember,toggleCollaboration,addDivision,removeDivision,moveAllMembers,planSeating,chartLayout};
});
