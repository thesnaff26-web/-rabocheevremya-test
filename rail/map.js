(function(root){
 'use strict';
 const R=6378137,D=Math.PI/180;
 function project(lat,lon){if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85.05112878||Math.abs(lon)>180)throw Error('Недопустимые координаты карты');return [R*lon*D,-R*Math.log(Math.tan(Math.PI/4+lat*D/2))]}
 function unproject(x,y){return [(2*Math.atan(Math.exp(-y/R))-Math.PI/2)/D,x/R/D]}
 function pointAt(data,m){
  for(const s of data.sections){
   if(m<s.start||m>s.end)continue;
   let lo=0,hi=s.points.length-1;
   while(lo+1<hi){const mid=(lo+hi)>>1;if(s.points[mid][0]<=m)lo=mid;else hi=mid}
   const a=s.points[lo],b=s.points[hi];if(m<a[0]||m>b[0])continue;
   const t=(m-a[0])/(b[0]-a[0]);return [m,a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];
  }return null;
 }
 function nearest(lines,x,y){
  let best=null;
  for(const line of lines)for(let i=1;i<line.length;i++){
   const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
   if(!den)continue;
   const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/den));
   const distance=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
   if(!best||distance<best.distance)best={chain:a.m+(b.m-a.m)*t,distance};
  }return best;
 }
 function create(svg,data,onSelect,onMessage){
  const W=600,H=400,low=Math.min(...data.sections.map(s=>s.start)),high=Math.max(...data.sections.map(s=>s.end));
  const lines=[];
  for(const s of data.sections){
   let run=[],last=null;
   const raw=[pointAt(data,s.start),...s.points.filter(p=>p[0]>s.start&&p[0]<s.end),pointAt(data,s.end)].filter(Boolean);
   for(const p of raw){const [x,y]=project(p[1],p[2]),v={x,y,m:p[0]};if(last&&Math.hypot(v.x-last.x,v.y-last.y)>5000){if(run.length>1)lines.push(run);run=[]}run.push(v);last=v}
   if(run.length>1)lines.push(run);
  }
  const points=lines.flat();if(!points.length)throw Error('Нет геометрии для карты');
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),bounds={minx:Math.min(...xs),maxx:Math.max(...xs),miny:Math.min(...ys),maxy:Math.max(...ys)};
  const home={x:(bounds.minx+bounds.maxx)/2,y:(bounds.miny+bounds.maxy)/2,span:Math.max((bounds.maxx-bounds.minx)*1.12,(bounds.maxy-bounds.miny)*W/H*1.12)};
  let view={...home},selected=(low+high)/2,pointers=new Map(),gesture=null,frame=null;
  const stations=[],seen=new Set();
  for(const [m,name] of data.sections.flatMap(s=>s.stations).sort((a,b)=>a[0]-b[0])){
   if(seen.has(name)||m<low||m>high)continue;seen.add(name);const p=pointAt(data,m);if(!p)continue;const [x,y]=project(p[1],p[2]);stations.push({m,name,x,y});
  }
  function elem(tag,attrs,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n}
  const scale=()=>W/view.span,toScreen=p=>({x:(p.x-view.x)*scale()+W/2,y:(p.y-view.y)*scale()+H/2}),toWorld=(x,y)=>({x:(x-W/2)/scale()+view.x,y:(y-H/2)/scale()+view.y});
  function draw(){
   svg.replaceChildren();
   const corner=toWorld(0,0),end=toWorld(W,H),a=unproject(corner.x,corner.y),b=unproject(end.x,end.y);
   const options=[.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2,5,10],step=options.find(n=>n>=(b[1]-a[1])/5)||10;
   for(let lon=Math.ceil(a[1]/step)*step;lon<=b[1];lon+=step){const x=toScreen({x:project(0,lon)[0],y:view.y}).x;svg.append(elem('line',{x1:x,x2:x,y1:0,y2:H,class:'mapGrid'}));svg.append(elem('text',{x:x+3,y:H-8,class:'mapAxis'},lon.toFixed(step<.01?3:step<1?2:0)+'°'))}
   for(let lat=Math.ceil(b[0]/step)*step;lat<=a[0];lat+=step){const y=toScreen({x:view.x,y:project(lat,0)[1]}).y;svg.append(elem('line',{x1:0,x2:W,y1:y,y2:y,class:'mapGrid'}));svg.append(elem('text',{x:7,y:y-5,class:'mapAxis'},lat.toFixed(step<.01?3:step<1?2:0)+'°'))}
   for(const line of lines){const coords=line.map(toScreen).map(p=>p.x.toFixed(2)+','+p.y.toFixed(2)).join(' ');svg.append(elem('polyline',{points:coords,class:'mapRouteBase'}));svg.append(elem('polyline',{points:coords,class:'mapRoute'}))}
   const labels=[];
   for(const st of stations){
    const p=toScreen(st);if(p.x<12||p.x>W-12||p.y<25||p.y>H-25)continue;
    const important=/Улан.?Удэ|Хилок|Чита|Карымская|Чернышевск|Могоча|Сковородино|Магдагачи|Белогорск|Облучье|Хабаровск/i.test(st.name);
    if(view.span>150000&&!important)continue;
    svg.append(elem('circle',{cx:p.x,cy:p.y,r:3.5,class:'mapStation'}));
    if(!labels.some(q=>Math.abs(q.x-p.x)<120&&Math.abs(q.y-p.y)<27)){
     const right=p.x>W-160;svg.append(elem('text',{x:p.x+(right?-8:8),y:p.y-10,'text-anchor':right?'end':'start',class:'mapName'},st.name));labels.push(p);
    }
   }
   const selectedPoint=pointAt(data,selected);
   if(selectedPoint){const [x,y]=project(selectedPoint[1],selectedPoint[2]),p=toScreen({x,y});if(p.x>=0&&p.x<=W&&p.y>=0&&p.y<=H){svg.append(elem('circle',{cx:p.x,cy:p.y,r:10,class:'mapSelectionHalo'}));svg.append(elem('circle',{cx:p.x,cy:p.y,r:4,class:'mapSelection'}))}}
   svg.append(elem('text',{x:W-16,y:25,'text-anchor':'end',class:'mapNorth'},'С ↑'));
  }
  function schedule(){if(frame===null)frame=requestAnimationFrame(()=>{frame=null;draw()})}
  function clamp(){view.span=Math.max(3000,Math.min(home.span*1.5,view.span));view.x=Math.max(bounds.minx-view.span/2,Math.min(bounds.maxx+view.span/2,view.x));view.y=Math.max(bounds.miny-view.span/2,Math.min(bounds.maxy+view.span/2,view.y))}
  function zoom(factor,x=W/2,y=H/2){const before=toWorld(x,y);view.span*=factor;clamp();const after=toWorld(x,y);view.x+=before.x-after.x;view.y+=before.y-after.y;clamp();draw()}
  function localPoint(event){const r=svg.getBoundingClientRect();return {x:(event.clientX-r.left)*W/r.width,y:(event.clientY-r.top)*H/r.height}}
  function gestureStart(){const ps=[...pointers.values()];if(ps.length===1)gesture={kind:'pan',start:ps[0],origin:{...view},moved:false};else if(ps.length===2){const [a,b]=ps;gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),middle:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},origin:{...view},moved:true}}}
  svg.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;if(pointers.size>=2)return;svg.setPointerCapture(e.pointerId);pointers.set(e.pointerId,localPoint(e));gestureStart()});
  svg.addEventListener('pointermove',e=>{
   if(!pointers.has(e.pointerId)||!gesture)return;const p=localPoint(e);pointers.set(e.pointerId,p);
   if(gesture.kind==='pan'){const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;if(Math.hypot(dx,dy)>6)gesture.moved=true;view.x=gesture.origin.x-dx*gesture.origin.span/W;view.y=gesture.origin.y-dy*gesture.origin.span/W}
   else if(pointers.size===2){const [a,b]=[...pointers.values()],dist=Math.hypot(a.x-b.x,a.y-b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(dist>1&&gesture.distance>1){view.span=gesture.origin.span*gesture.distance/dist;clamp();view.x=gesture.origin.x+(gesture.middle.x-W/2)*gesture.origin.span/W-(mid.x-W/2)*view.span/W;view.y=gesture.origin.y+(gesture.middle.y-H/2)*gesture.origin.span/W-(mid.y-H/2)*view.span/W}}
   clamp();schedule();
  });
  function end(e,cancel){
   if(!pointers.has(e.pointerId))return;const p=localPoint(e),select=!cancel&&gesture?.kind==='pan'&&!gesture.moved&&pointers.size===1;
   pointers.delete(e.pointerId);if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
   if(select){const world=toWorld(p.x,p.y),hit=nearest(lines,world.x,world.y);if(hit&&hit.distance*scale()<=22){onSelect(Math.max(low,Math.min(high,hit.chain)));onMessage('Выбран километр архивной линии, не ваша позиция.')}else onMessage('Нажмите ближе к линии пути.')}const wasPinch=gesture?.kind==='pinch';gesture=null;if(pointers.size){gestureStart();if(wasPinch)gesture.moved=true;}
  }
  svg.addEventListener('pointerup',e=>end(e,false));svg.addEventListener('pointercancel',e=>end(e,true));
  svg.addEventListener('wheel',e=>{e.preventDefault();const p=localPoint(e);zoom(e.deltaY>0?1.3:1/1.3,p.x,p.y)},{passive:false});
  svg.addEventListener('keydown',e=>{const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'];if(!keys.includes(e.key))return;e.preventDefault();if(e.key==='Home'){view={...home};draw()}else if(e.key==='+'||e.key==='=')zoom(.7);else if(e.key==='-')zoom(1.4);else{view.x+=(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)*view.span/5;view.y+=(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)*view.span/5;clamp();draw()}});
  draw();
  return {select(m,follow=true){selected=m;if(follow){const p=pointAt(data,m);if(p){const [x,y]=project(p[1],p[2]);view={x,y,span:25000}}}draw()},zoomIn:()=>zoom(.6),zoomOut:()=>zoom(1/.6),overview(){view={...home};draw()},state:()=>({...view,selected})};
 }
 const api={project,unproject,pointAt,nearest,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailMap=api;
})(typeof globalThis!=='undefined'?globalThis:this);
