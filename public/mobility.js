// Pure deterministic lane/parking controller. Walking/mounting requires the real actor's arrival acknowledgment.
(function(root){
  function create({lanes,parking,maxTeamAway=2}){
    const roads=new Map(lanes.map(l=>{let length=0;const segments=[];for(let i=1;i<l.points.length;i++){const a=l.points[i-1],b=l.points[i],n=Math.hypot(...b.map((v,k)=>v-a[k]));segments.push({a,b,n,start:length});length+=n;}return [l.id,{...l,length,segments}];}));
    parking=structuredClone(parking);
    const bays=new Map(parking.map(p=>[p.id,p])),trips=new Map(),vehicles=new Map(),reserved=new Map(),locks=new Map(),crossings=new Set();let enabled=true,limit=Infinity,time=0;
    const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
    for(const bay of parking){
      const exit=roads.get(bay.exitLane),entry=roads.get(bay.entryLane);
      if(!exit||!entry)throw Error('Missing parking connection: '+bay.id);
      // Explicit low-speed parking connectors preserve continuity even when bays branch off a shared access lane.
      const depart=bay.id+':depart',arrive=bay.id+':arrive';
      function connector(id,a,b,next){const n=distance(a,b);roads.set(id,{id,points:[a,b],segments:[{a,b,n:Math.max(n,.000001),start:0}],length:n,next,speed:1.5});}
      connector(depart,bay.position,exit.points[0],[bay.exitLane]);
      connector(arrive,entry.points.at(-1),bay.position,[]);
      bay.departLane=depart;bay.arriveLane=arrive;
      if(distance(bay.position,exit.points[0])>15||distance(bay.position,entry.points.at(-1))>15)throw Error('Parking connection too long: '+bay.id);
    }
    const dimensions={car:{length:4.5,width:2.2},motorcycle:{length:2.35,width:1.23}};
    function pose(v){const l=roads.get(v.lane);if(!l)return v.pose;const s=l.segments.find(s=>v.distance<=s.start+s.n)||l.segments.at(-1),t=Math.max(0,Math.min(1,(v.distance-s.start)/s.n));return s.a.map((a,i)=>a+(s.b[i]-a)*t);}
    // Height of the lane surface at a distance; sampling under both axles lets a long car bridge the
    // crest and foot of the driveway instead of one end cutting through the flat sections.
    function heightAt(l,d){const s=l.segments.find(s=>d<=s.start+s.n)||l.segments.at(-1),t=Math.max(0,Math.min(1,(d-s.start)/s.n));return s.a[1]+(s.b[1]-s.a[1])*t;}
    function release(t){if(t.parking&&reserved.get(t.parking)===t.id)reserved.delete(t.parking);for(const [k,id]of locks)if(id===t.id)locks.delete(k);vehicles.delete(t.id);t.phase='complete';trips.delete(t.id);}
    function request({id,owner,kind='team',vehicle='car'}){
      const old=[...trips.values()].find(t=>t.owner===owner&&t.phase!=='complete');if(old)return old.id;
      if(!dimensions[vehicle]||(!enabled&&kind==='team')||vehicles.size>=limit)return null;
      if(kind==='team'&&[...trips.values()].filter(t=>t.kind==='team'&&t.phase!=='complete').length>=maxTeamAway)return null;
      const bay=[...bays.values()].find(b=>b.kind===vehicle&&!reserved.has(b.id));if(!bay)return null;
      if(trips.has(id))return null;
      const t={id,owner,kind,vehicle,parking:bay.id,phase:'walkToVehicle',recall:false,retiring:false,awayUntil:0};trips.set(id,t);reserved.set(bay.id,id);
      vehicles.set(id,{id,owner,kind:vehicle,lane:null,distance:0,speed:0,pose:[...bay.position],heading:bay.heading||0,pitch:0,roll:0,length:dimensions[vehicle].length,width:dimensions[vehicle].width});return id;
    }
    // A new vehicle may only appear when nothing occupies the start of its road (any lane sharing that space).
    const clearAt=(point,len)=>![...vehicles.values()].some(v=>distance(v.pose,point)<(v.length+len)/2+.5);
    function requestVisitor({id,owner,vehicle='car',lane}){if(!roads.has(lane)||!dimensions[vehicle]||!clearAt(roads.get(lane).points[0],dimensions[vehicle].length))return null;const tripId=request({id,owner,kind:'visitor',vehicle});if(!tripId)return null;const t=trips.get(tripId),v=vehicles.get(tripId);t.phase='inbound';v.lane=lane;v.distance=0;v.pose=pose(v);return tripId;}
    function departVisitor(owner){for(const t of trips.values())if(t.owner===owner&&t.phase==='visiting'){t.phase='walkToVehicle';t.leaving=true;}}
    function requestTraffic({id,vehicle='car',lane}){const l=roads.get(lane);if(!l||!dimensions[vehicle]||vehicles.has(id)||vehicles.size>=limit)return null;const dim=dimensions[vehicle];if(!clearAt(l.points[0],dim.length))return null;trips.set(id,{id,owner:id,kind:'ambient',vehicle,phase:'outbound',recall:false});const v={id,owner:id,kind:vehicle,lane,distance:0,speed:0,heading:0,pitch:0,roll:0,...dim};v.pose=pose(v);vehicles.set(id,v);return id;}
    function arrive(id,phase){const t=trips.get(id);if(!t||t.phase!==phase)return false;const v=vehicles.get(id),bay=bays.get(t.parking);
      if(phase==='walkToVehicle')t.phase=t.recall?'walkToOffice':'mount';
      else if(phase==='mount'){if(t.recall)t.phase='dismount';else{t.phase='outbound';v.lane=bay.departLane;v.distance=0;v.pose=pose(v);}}
      else if(phase==='dismount')t.phase='walkToOffice';else if(phase==='walkToOffice'){if(t.kind==='visitor'&&!t.leaving)t.phase='visiting';else release(t);}else return false;return true;}
    function recall(owner){for(const t of trips.values())if(t.owner===owner&&t.phase!=='complete'){t.recall=true;if(t.phase==='walkToVehicle')t.phase='walkToOffice';if(t.phase==='away')t.phase='inbound';}}
    function removeOwner(owner){recall(owner);for(const t of trips.values())if(t.owner===owner&&t.phase!=='complete'){t.retiring=true;if(!vehicles.get(t.id)?.lane)release(t);}}
    function advance(dt){time+=dt;const ordered=[...vehicles.values()].sort((a,b)=>b.distance-a.distance||a.id.localeCompare(b.id));
      for(const v of ordered){const t=trips.get(v.id);if(!v.lane)continue;const l=roads.get(v.lane);if(!l){release(t);continue;}
        if(t.phase==='away'&&time>=t.awayUntil)t.phase='inbound';
        let speed=l.speed||5;const conflicts=l.conflicts||[];
        if(conflicts.some(c=>crossings.has(c)||(locks.has(c)&&locks.get(c)!==t.id)))speed=0;
        const ahead=ordered.filter(o=>o.id!==v.id&&o.lane===v.lane&&o.distance>=v.distance).sort((a,b)=>a.distance-b.distance)[0];
        if(ahead)speed=Math.min(speed,Math.max(0,(ahead.distance-v.distance-(ahead.length+v.length)/2-.5)/Math.max(dt,.001)));
        if(speed>0)for(const c of conflicts)locks.set(c,t.id);
        // Slow before junctions; no transfer until the receiving segment has bumper clearance.
        const remaining=l.length-v.distance;speed=Math.min(speed,remaining<5?2.5:speed);const bay=bays.get(t.parking),next=bay&&l.id===bay.entryLane?bay.arriveLane:l.next?.[0],nl=roads.get(next);
        const nextBlocked=nl&&ordered.some(o=>o.id!==v.id&&o.lane===next&&o.distance<(o.length+v.length)/2+.5);
        const conflictBlocked=nl&&(nl.conflicts||[]).some(c=>crossings.has(c)||(locks.has(c)&&locks.get(c)!==t.id));
        if((nextBlocked||conflictBlocked)&&remaining<1)speed=0;
        // Turning across another lane: wait at the stop line until the crossing box is empty (and stay committed once in it).
        const crossing=nl?.yieldTo?.box,inBox=(p,b)=>p[0]>=b[0]&&p[0]<=b[2]&&p[2]>=b[1]&&p[2]<=b[3];
        const approaching=o=>{if(o.id===v.id||!o.lane||o.lane===next)return false;const ln=roads.get(o.lane);if(!ln)return false;const b=crossing,margin=(o.speed||ln.speed||5)*3+o.length;
          return inBox(o.pose,b)||(o.pose[2]>=b[1]-1&&o.pose[2]<=b[3]+1&&o.pose[0]>=b[0]-margin&&o.pose[0]<=b[2]+margin);};
        if(crossing&&remaining<1.5&&ordered.some(approaching))speed=0;
        const ownBox=l.yieldTo?.box;if(ownBox&&!inBox(v.pose,ownBox)&&v.distance<1&&ordered.some(o=>o.id!==v.id&&o.lane!==v.lane&&o.lane&&inBox(o.pose,ownBox)))speed=0;
        const candidate={...v,distance:Math.min(l.length,v.distance+speed*dt)},nextPose=pose(candidate);
        // Lane identifiers may overlap physically at merges. Yield when the next step would close an unsafe gap.
        // Only a vehicle in our path counts: ahead along the travel direction and overlapping laterally.
        // Opposite-lane traffic beside us (e.g. at a U-turn) must not stop us, or vehicles wait on each other in a cycle.
        const fx=nextPose[0]-v.pose[0],fz=nextPose[2]-v.pose[2],fl=Math.hypot(fx,fz);
        // Inside the lot, arrivals have priority: a departing vehicle waits on its bay while anyone is pulling in,
        // and an arriving vehicle never yields to a departing one (prevents head-on standoffs in the aisle).
        const departing=v.lane.endsWith(':depart'),arriving=v.lane.endsWith(':arrive')||v.lane===(bay&&bay.entryLane);
        if(departing&&v.distance<.01&&ordered.some(o=>o.id!==v.id&&o.lane&&(o.lane.endsWith(':arrive')||roads.get(o.lane)===roads.get(bay?.entryLane))))speed=0;
        const closing=fl>1e-6&&ordered.some(o=>{if(o.id===v.id)return false;if(arriving&&o.lane?.endsWith(':depart'))return false;
        // Converging connectors all end at the same exit mouth, so two vehicles can each see the
        // other "ahead" and wait forever. The one nearer its merge point has priority; a stopped
        // vehicle farther from its junction never blocks one that is closer (id breaks exact ties).
        const oRoad=o.lane&&roads.get(o.lane),oRemain=oRoad?oRoad.length-o.distance:Infinity,myRemain=l.length-v.distance;
        if(o.speed===0&&o.lane!==v.lane&&(oRemain>myRemain||(oRemain===myRemain&&o.id>v.id)))return false;
        const ox=o.pose[0]-v.pose[0],oz=o.pose[2]-v.pose[2],along=(ox*fx+oz*fz)/fl,side=Math.abs(ox*fz-oz*fx)/fl;
          return along>0&&along<(o.length+v.length)/2+.5+fl&&side<(o.width+v.width)/2+.2;});
        if(closing)speed=0;
        v.speed=speed;v.distance=Math.min(l.length,v.distance+speed*dt);v.pose=pose(v);
        const seg=l.segments.find(s=>v.distance<=s.start+s.n)||l.segments.at(-1);v.heading=Math.atan2(seg.b[0]-seg.a[0],seg.b[2]-seg.a[2]);
        // Sample the lane under both axles: pitch follows the chord between the wheels, so a car crossing
        // the driveway crest or foot no longer buries the axle that is still on the flat section.
        const axle=v.length*.34,front=heightAt(l,Math.min(l.length,v.distance+axle)),rear=heightAt(l,Math.max(0,v.distance-axle));
        v.pose[1]=(front+rear)/2;v.pitch=Math.atan2(-(front-rear),2*axle);
        // Roll keeps both sides of the car on the same plane when the lane crosses the ramp diagonally.
        const dy=seg.b[1]-seg.a[1],dz=seg.b[2]-seg.a[2],run=Math.hypot(seg.b[0]-seg.a[0],seg.b[2]-seg.a[2])||1;
        const gz=Math.abs(dz)>run*.15?dy/dz:0;v.roll=Math.atan(gz*-Math.sin(v.heading));
        if(v.distance<l.length-1e-7)continue;
        if(nextBlocked||conflictBlocked)continue;
        if(crossing&&ordered.some(approaching)){v.speed=0;continue;}
        for(const c of conflicts)if(locks.get(c)===t.id)locks.delete(c);
        if(t.leaving&&bay&&l.id===bay.exitLane){release(t);continue;}
        if(bay&&l.id===bay.arriveLane){
          if(t.retiring){release(t);continue;}
          v.lane=null;v.speed=0;v.pose=[...bay.position];v.heading=bay.heading||0;v.pitch=0;v.roll=0;t.phase='dismount';
        }else if(nl){v.lane=next;v.distance=0;if(bay&&l.id===bay.exitLane&&t.phase==='outbound'){t.phase=t.recall?'inbound':'away';t.awayUntil=time+12;}if(t.recall&&t.phase==='away')t.phase='inbound';}
        else release(t);
      }
    }
    function tick(dt){let left=Math.min(.15,Math.max(0,Number.isFinite(dt)?dt:0));while(left>1e-8){const step=Math.min(1/30,left);advance(step);left-=step;}}
    return {tick,request,requestVisitor,departVisitor,requestTraffic,arrive,recall,removeOwner,setDepartures:on=>{enabled=!!on;if(!enabled)for(const t of trips.values())if(t.kind==='team')recall(t.owner);},setLimit:n=>{limit=Math.max(0,n);},occupyCrossing:(id,on)=>on?crossings.add(id):crossings.delete(id),snapshot:()=>structuredClone({retainedTrips:trips.size,vehicles:[...vehicles.values()],trips:[...trips.values()].filter(t=>t.phase!=='complete'),reservations:[...reserved].map(([parking,trip])=>({parking,trip}))})};
  }
  const canDepart=(name,tasks,known)=>!!known&&Array.isArray(tasks)&&!tasks.some(t=>t.assignee===name&&t.status!=='done');
  const api={create,canDepart};if(typeof module==='object'&&module.exports)module.exports=api;else root.OfficeMobility=api;
})(typeof window==='object'?window:globalThis);
