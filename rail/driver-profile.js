(function(root){
 'use strict';
 const $=id=>document.getElementById(id);
 // Source bands are displayed without inventing or interpolating operational values.
 // kmOrder calibrates the horizontal position against each document's own grid.
 function geometry(text,page){
  const xml=new DOMParser().parseFromString(text,'image/svg+xml');
  if(xml.querySelector('parsererror'))throw Error('Ошибка схемы листа');
  const groups=[];
  for(const u of xml.querySelectorAll('use[x][y]')){
   if(+u.getAttribute('y')>Math.min(120,page.height*.2))continue;
   const x=+u.getAttribute('x'),y=+u.getAttribute('y');
   let g=groups.find(g=>Math.abs(g.y-y)<1&&Math.abs(g.last-x)<13);
   if(!g){g={y,x,last:x,n:0};groups.push(g)}g.last=x;g.n++;
  }
  const order=page.kmOrder,rows=[];
  for(const g of groups.filter(g=>g.n===4)){let row=rows.find(r=>Math.abs(r.y-g.y)<1);if(!row){row={y:g.y,labels:[]};rows.push(row)}row.labels.push(g)}
  const row=rows.filter(r=>r.labels.length===order?.length).sort((a,b)=>a.y-b.y)[0];
  const labels=(row?.labels||[]).sort((a,b)=>a.x-b.x);
  if(labels.length!==order?.length||order.length<2)throw Error('Не удалось точно сопоставить километровую сетку');
  const points=labels.map((g,i)=>[order[i]*1000+500,(g.x+g.last+10)/2]);
  const mean=points.reduce((a,p)=>a+p[0],0)/points.length,ym=points.reduce((a,p)=>a+p[1],0)/points.length;
  const a=points.reduce((n,p)=>n+(p[0]-mean)*(p[1]-ym),0)/points.reduce((n,p)=>n+(p[0]-mean)**2,0),b=ym-a*mean;
  // Reject irregular grids rather than silently stretching them to a wrong km.
  if(points.some(p=>Math.abs(a*p[0]+b-p[1])>8))throw Error('Неравномерная сетка: откройте исходный лист');
  const gradeTop=bandBoundary(xml,page);
  return {a,b,width:page.width,height:page.height,speedTop:row.y+12,gradeTop,trace:trackTrace(xml,{...page,profileBox:[0,gradeTop,page.width,page.profileBox[3]]})};
 }
 // Locate the printed divider above the grade table instead of using a fixed crop.
 function bandBoundary(xml,page){
  const ys=[];
  for(const path of xml.querySelectorAll('path[stroke]')){
   if(path.closest('defs')||path.getAttribute('stroke')!=='rgb(0%, 0%, 0%)')continue;
   const d=(path.getAttribute('d')||'').trim().match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+L\s+([-\d.]+)\s+([-\d.]+)\s*$/);
   const m=(path.getAttribute('transform')||'').match(/matrix\(([^)]+)\)/);if(!d||!m)continue;
   const t=m[1].split(/[ ,]+/).map(Number),x1=+d[1],y1=+d[2],x2=+d[3],y2=+d[4];if(t.length!==6)continue;
   const a=t[1]*x1+t[3]*y1+t[5],b=t[1]*x2+t[3]*y2+t[5];
   if(Math.abs(a-b)<1&&Math.abs(t[0]*(x2-x1))>page.width*.75&&a>=page.profileBox[1]&&a<page.profileBox[1]+60)ys.push((a+b)/2);
  }
  return ys.length?Math.min(...ys):page.profileBox[1];
 }
 // Sample only the document's long black route curve, outside the glyph definitions.
 function trackTrace(xml,page){
  let best=[];
  for(const path of xml.querySelectorAll('path[stroke]')){
   if(path.closest('defs')||!/^rgb\(0%, 0%, 0%\)$/.test(path.getAttribute('stroke')||'')||+(path.getAttribute('stroke-width')||0)<1.2)continue;
   const matrix=(path.getAttribute('transform')||'').match(/matrix\(([^)]+)\)/);
   const t=matrix?matrix[1].split(/[ ,]+/).map(Number):[1,0,0,1,0,0];if(t.length!==6||!t.every(Number.isFinite))continue;
   const tokens=(path.getAttribute('d')||'').match(/[MLCZmlcz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g)||[];
   let i=0,cmd='',x=0,y=0,points=[],ok=true;
   const add=(x,y)=>points.push([t[0]*x+t[2]*y+t[4],t[1]*x+t[3]*y+t[5]]);
   while(i<tokens.length){
    if(/^[A-Za-z]$/.test(tokens[i]))cmd=tokens[i++];
    if(cmd==='M'||cmd==='L'){x=+tokens[i++];y=+tokens[i++];add(x,y);if(cmd==='M')cmd='L'}
    else if(cmd==='C'){const x0=x,y0=y,c1x=+tokens[i++],c1y=+tokens[i++],c2x=+tokens[i++],c2y=+tokens[i++],ex=+tokens[i++],ey=+tokens[i++];for(let j=1;j<=12;j++){const q=j/12,u=1-q;add(u*u*u*x0+3*u*u*q*c1x+3*u*q*q*c2x+q*q*q*ex,u*u*u*y0+3*u*u*q*c1y+3*u*q*q*c2y+q*q*q*ey)}x=ex;y=ey}
    else {ok=false;break}
   }
   if(!ok||points.length<2||points.some(p=>!p.every(Number.isFinite)||p[1]<170||p[1]>page.profileBox[1]-8))continue;
   points.sort((a,b)=>a[0]-b[0]);if(points.at(-1)[0]-points[0][0]<page.width*.75)continue;
   if(points.length>best.length)best=points;
  }
  return best;
 }
 function curveY(entry,m){
  const ps=entry.geo.trace,x=entry.geo.a*m+entry.geo.b;if(!ps?.length)return null;
  if(x<=ps[0][0])return ps[0][1];if(x>=ps.at(-1)[0])return ps.at(-1)[1];
  const j=ps.findIndex(p=>p[0]>=x),a=ps[j-1],b=ps[j];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]||1);
 }
 function landmarkLayout(entries,direction){
  const ordered=[...entries].sort((a,b)=>direction*(a.page.start-b.page.start)),shifts=new Map();let previous=null,shift=0;
  for(const e of ordered){
   if(previous){const boundary=direction===1?e.page.start:e.page.end,prevEdge=direction===1?previous.page.end:previous.page.start;
    const py=curveY(previous,boundary),ey=curveY(e,boundary);
    if(Math.abs(boundary-prevEdge)<1&&py!==null&&ey!==null)shift+=(py-180)/Math.max(100,(previous.geo.gradeTop||previous.page.profileBox[1])-180)-(ey-180)/Math.max(100,(e.geo.gradeTop||e.page.profileBox[1])-180);
    else shift=0;
   }
   shifts.set(e.page.file,shift);previous=e;
  }
  const values=[0,...shifts.values()],min=Math.min(...values),max=Math.max(...values);return {shifts,min,scale:1+max-min};
 }
 // Each source loads once, independently of GPS ticks and other source failures.
 function createPageStore(load,onChange,now=()=>Date.now()){
  const records=new Map();
  return {
   get:p=>records.get(p.file)?.value,
   status:p=>records.get(p.file)?.status||'missing',
   error:p=>records.get(p.file)?.error,
   request(p){
    const old=records.get(p.file);if(old&&(old.status!=='failed'||now()-old.at<30000))return old.promise;
    const record={status:'pending',at:now()};records.set(p.file,record);
    record.promise=Promise.resolve().then(()=>load(p)).then(value=>{record.value=value;record.status='ready';onChange();return value},error=>{record.error=error;record.at=now();record.status='failed';onChange();return null});return record.promise;
   }
  };
 }
 function create(viewer){
  const host=$('driverPanel');if(!host)return;
  host.innerHTML=`<div class="driverHead"><div><small>ЭЛЕКТРОННЫЙ ПРОФИЛЬ</small><strong id="driverPosition">—</strong><span id="driverMode" class="driverMode">Ручной просмотр</span></div><div class="driverSpeed"><b id="driverSpeed">—</b><span>км/ч · GPS</span></div></div><div class="driverRoute" id="driverRoute"></div><div class="driverActions"><button id="driverGPS">Включить GPS</button><button id="driverSetup">Участок / км</button></div><div class="driverActions" role="group" aria-label="Выбор пути"><button id="driverEven" aria-pressed="false">Чётный</button><button id="driverOdd" aria-pressed="true">Нечётный</button></div><div class="driverScales" role="group" aria-label="Ширина обзора"><span>Обзор</span>${[3,5,10,20].map(n=>`<button data-span="${n}" aria-pressed="${n===10}" class="${n===10?'active':''}">${n} км</button>`).join('')}</div><div class="driverChart" id="driverChart" role="img" tabindex="0" aria-label="Обзор пути. Нажмите для подробностей, стрелки для перемещения."></div><div class="driverFoot"><span id="driverRange">—</span><span>По ходу движения →</span></div><p id="driverMessage" role="status">Загружаем профиль…</p><div class="driverDetail" id="driverDetail" hidden><header><b id="driverDetailTitle"></b><button id="driverCloseDetail" aria-label="Закрыть подробности">×</button></header><div class="driverChart" id="driverDetailChart"></div></div><div class="driverActions"><button id="driverBack">← Обзор</button><button id="driverHere">К позиции</button><button id="driverNext">Обзор →</button></div><p class="driverNote">Ограничения и уклоны — из режимки 2026. Нажмите на участок для подробностей. GPS-привязка приблизительная; текущие огни светофоров не поступают.</p>`;
  let span=10000,center=null,follow=true,selection=null,sequence=0,route=null,state=null,entries=[],destroyed=false;
  const memo=new Map(),urls=new Set();let currentRoute=null;const tiles=createPageStore(source,()=>{if(!destroyed)render()});
  const fmt=m=>{const x=Math.round(m),km=Math.floor(x/1000),r=x%1000;return `${km} км · ПК ${Math.floor(r/100)+1}`};
  const number=m=>(m/1000).toLocaleString('ru-RU',{maximumFractionDigits:1,useGrouping:false});
  async function source(page){
   if(!memo.has(page.file))memo.set(page.file,viewer.readPage(page).then(text=>{const geo=geometry(text,page);const display=text.replace(/(<svg\b[^>]*?)>/,(_,tag)=>tag.replace(/\s+preserveAspectRatio="[^"]*"/,'')+' preserveAspectRatio="none">');const url=URL.createObjectURL(new Blob([display],{type:'image/svg+xml'}));urls.add(url);return {page,geo,url}}).catch(e=>{memo.delete(page.file);throw e}));
   return memo.get(page.file);
  }
  function range(c,s){let start=c-route.direction*s*.18;const maxStart=route.direction===1?route.end-s:route.start+s;
   start=route.direction===1?Math.max(route.start,Math.min(maxStart,start)):Math.min(route.end,Math.max(maxStart,start));return {start,end:start+route.direction*s,span:s};}
  function chart(el,r,detail=false){
   const width=el.clientWidth;if(!width)return;
   const height=el.clientHeight,alignment=landmarkLayout(entries,route.direction);
   const signature=[route.id,r.span,width,height,detail,...entries.map(e=>e.page.file)].join('|');
   const reuse=el.dataset.profileSignature===signature;
   if(!reuse){el.replaceChildren();el.dataset.profileSignature=signature;el.profileTiles=[]}
   const bands=[['speed','ОГРАНИЧЕНИЯ ПО РЕЖИМКЕ',40,90,.21],['landmarks','ОРИЕНТИРЫ ИЗ ДОКУМЕНТА',180,null,.33],['grade','СХЕМА УКЛОНОВ · ‰ / ДЛИНЫ · м',null,null,.30]];
   if(!reuse)for(const [kind,label,y0,h0,ratio] of bands){if(detail&&kind==='landmarks')continue;const band=document.createElement('div');band.className='driverBand '+kind;const title=document.createElement('span');title.className='driverBandLabel';title.textContent=label;band.append(title);el.append(band);
    for(const entry of entries){const p=entry.page,g=entry.geo,lo=Math.max(p.start,Math.min(r.start,r.end)),hi=Math.min(p.end,Math.max(r.start,r.end));if(hi<=lo)continue;
     const x0=(lo-r.start)/route.direction/r.span*width,x1=(hi-r.start)/route.direction/r.span*width;
     const left=Math.min(x0,x1),w=Math.abs(x1-x0),block=document.createElement('div');block.style.cssText=`position:absolute;left:${left}px;width:${w}px;top:0;bottom:0;overflow:hidden`;
     const sx=width/(Math.abs(g.a)*r.span),y=kind==='grade'?g.gradeTop:kind==='speed'?g.speedTop:(y0||0),h=kind==='grade'?p.profileBox[1]+p.profileBox[3]-g.gradeTop:(h0||Math.max(100,g.gradeTop-180));
     const bh=height*(detail?(kind==='speed'?.40:.45):ratio),sy=bh/h/(kind==='landmarks'?alignment.scale:1);
     const image=document.createElement('img');image.alt='';image.src=entry.url;image.style.width=g.width*sx+'px';image.style.height=g.height*sy+'px';
     // kmOrder and direction determine whether the source needs mirroring.
     // All supplied profiles run left-to-right in their selected direction.
     if(Math.sign(g.a)!==route.direction){block.textContent='Обратная сетка: откройте лист';band.append(block);continue}
     const sourceLeft=(g.a*(route.direction===1?lo:hi)+g.b)*sx;
     image.style.left=-sourceLeft+'px';image.style.top=-y*sy+'px';
     if(kind==='landmarks'){const crop=document.createElement('div');crop.style.cssText=`position:absolute;left:0;right:0;top:${((alignment.shifts.get(p.file)||0)-alignment.min)*bh/alignment.scale}px;height:${bh/alignment.scale}px;overflow:hidden`;crop.append(image);block.append(crop)}else block.append(image);band.append(block);el.profileTiles.push({block,image,p,g,sx});
    }
   }
   if(reuse)for(const {block,image,p,g,sx} of el.profileTiles){
    const lo=Math.max(p.start,Math.min(r.start,r.end)),hi=Math.min(p.end,Math.max(r.start,r.end));block.hidden=hi<=lo;if(block.hidden)continue;
    const x0=(lo-r.start)/route.direction/r.span*width,x1=(hi-r.start)/route.direction/r.span*width;
    block.style.left=Math.min(x0,x1)+'px';block.style.width=Math.abs(x1-x0)+'px';image.style.left=-(g.a*(route.direction===1?lo:hi)+g.b)*sx+'px';
   }
   for(const overlay of el.querySelectorAll('.driverAxis,.driverMarker,.driverSelection'))overlay.remove();
   const axis=document.createElement('div');axis.className='driverAxis';const step=detail?200:r.span<=5000?1000:r.span<=10000?2000:5000;
   const lo=Math.min(r.start,r.end),hi=Math.max(r.start,r.end);
   for(let m=Math.ceil(lo/step)*step;m<=hi;m+=step){const x=(m-r.start)/route.direction/r.span*100;if(x<3||x>97)continue;const tick=document.createElement('div');tick.className='driverTick';tick.style.left=x+'%';const label=document.createElement('span');label.textContent=number(m);tick.append(label);axis.append(tick)}el.append(axis);
   if(state.valid){const x=(state.chain-r.start)/route.direction/r.span*100;if(x>=0&&x<=100){const marker=document.createElement('div');marker.className='driverMarker';marker.style.left=x+'%';el.append(marker)}}
   if(selection!==null&&!detail){const x=(selection-r.start)/route.direction/r.span*100;if(x>=0&&x<=100){const mark=document.createElement('div');mark.className='driverSelection';mark.style.left=x+'%';el.append(mark)}}
  }
  function render(){
   if(destroyed||!route)return;const r=range(center,span);$('driverRange').textContent=number(r.start)+' — '+number(r.end)+' км';
   const doc=viewer.catalog.documents.find(d=>d.id===route.document),lo=Math.min(r.start,r.end),hi=Math.max(r.start,r.end);
   const leaves=doc.leaves.filter(p=>p.route===route.id&&p.start<hi&&p.end>lo),groups=new Map();for(const p of leaves){const k=p.start+':'+p.end;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p)}
   const chosen=[],problems=[];for(const group of groups.values()){if(group.length===1)chosen.push(group[0]);else {const current=group.find(p=>p.number===state.page)||group.find(p=>group.every(l=>l.overviewPage===p.number));if(current)chosen.push(current);else problems.push('В исходнике несколько листов для '+number(group[0].start)+' км')}}
   entries=chosen.map(p=>tiles.get(p)).filter(Boolean);
   for(const p of chosen)tiles.request(p);
   const pending=chosen.filter(p=>tiles.status(p)==='pending').length;
   for(const p of chosen)if(tiles.status(p)==='failed')problems.push('Лист '+p.number+': '+tiles.error(p).message);
   // Explicit gaps remain blank; duplicate pages and route boundaries are never filled with guesses.
   const intervals=entries.map(e=>[Math.max(lo,e.page.start),Math.min(hi,e.page.end)]).sort((a,b)=>a[0]-b[0]);let cursor=lo;for(const [a,b] of intervals){if(a>cursor+1&&!pending)problems.push('Часть обзора без данных');cursor=Math.max(cursor,b)}if(cursor<hi-1&&!pending)problems.push('Часть обзора без данных');
   chart($('driverChart'),r);if(selection!==null)detail();$('driverMessage').textContent=pending?'Загружено '+entries.length+' из '+chosen.length+' листов. Ожидаем остальные…':problems.length?[...new Set(problems)].join('. '):'Нажмите на профиль — подробности участка. Сдвигайте по горизонтали для обзора.';
  }
  function detail(){if(selection===null)return;$('driverDetail').hidden=false;$('driverDetailTitle').textContent=fmt(selection)+' · участок 1 км';chart($('driverDetailChart'),range(selection,1000),true)}
  function update(){
   const next=viewer.state();state=next;route=viewer.catalog.routes.find(r=>r.id===next.routeId);if(!route)return;
   if(currentRoute!==route.id){center=next.chain;selection=null;follow=true;$('driverDetail').hidden=true;currentRoute=route.id}
   if(center===null||follow)center=next.chain;
   $('driverPosition').textContent=next.mode==='gps'&&!next.valid?'Км/ПК не определён':(next.mode==='gps'?'≈ ':'')+fmt(next.chain);$('driverRoute').textContent=route.name;for(const [id,d] of [['driverEven',1],['driverOdd',-1]]){$(id).setAttribute('aria-pressed',String(route.direction===d));$(id).style.borderColor=route.direction===d?'var(--driver-accent, #4fe0b2)':'';}
   $('driverMode').textContent=next.mode==='gps'?(next.valid?'GPS · приблизительная позиция':next.overviewOnly?'Участок по GPS · км/ПК не подтверждён':'GPS · позиция не подтверждена'):'Ручной просмотр';
   $('driverHere').textContent=follow?'К позиции':'Вернуться';
   render();
  }
  for(const b of host.querySelectorAll('[data-span]'))b.onclick=()=>{span=+b.dataset.span*1000;for(const v of host.querySelectorAll('[data-span]')){v.classList.toggle('active',v===b);v.setAttribute('aria-pressed',String(v===b))}render()};
  function shift(d){follow=false;center=Math.max(route.start,Math.min(route.end-1,center+d*route.direction*span*.65));$('driverHere').textContent='Вернуться';render()}
  $('driverBack').onclick=()=>shift(-1);$('driverNext').onclick=()=>shift(1);$('driverHere').onclick=()=>{follow=true;selection=null;$('driverDetail').hidden=true;update()};
  $('driverEven').onclick=()=>viewer.setParity(1);$('driverOdd').onclick=()=>viewer.setParity(-1);
  $('driverSetup').onclick=()=>{$('regimePanel').open=true;$('regimePanel').scrollIntoView({behavior:'smooth',block:'start'})};
  $('driverGPS').onclick=()=>{const active=!$('stop').disabled;if(active)$('stop').click();else if(!$('start').disabled)$('start').click();else {$('gpsSettings').open=true;$('gpsSettings').scrollIntoView({behavior:'smooth'})}};
  const obs=new MutationObserver(()=>{$('driverSpeed').textContent=$('speed').textContent.replace(' км/ч','');$('driverGPS').textContent=$('stop').disabled?'Включить GPS':'Остановить GPS'});obs.observe($('speed'),{childList:true});obs.observe($('stop'),{attributes:true,attributeFilter:['disabled']});
  const el=$('driverChart'),pointers=new Map();let down=null,pinch=null,moved=false;
  el.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});el.setPointerCapture(e.pointerId);if(pointers.size===1){down={x:e.clientX,y:e.clientY};moved=false}if(pointers.size===2){const a=[...pointers.values()];pinch=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);moved=true}});
  el.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(down&&Math.abs(e.clientX-down.x)>10)moved=true});
  function release(e,cancel=false){if(!pointers.has(e.pointerId))return;
   if(pointers.size===2&&pinch){const a=[...pointers.values()],dist=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(!cancel&&Math.abs(dist-pinch)>15){const scales=[3000,5000,10000,20000];let i=scales.indexOf(span);span=scales[Math.max(0,Math.min(3,i+(dist>pinch?-1:1)))];host.querySelector(`[data-span="${span/1000}"]`).click()}pinch=null;down=null}
   else if(!cancel&&down){const dx=e.clientX-down.x,dy=e.clientY-down.y;if(moved&&Math.abs(dx)>25&&Math.abs(dx)>Math.abs(dy)){follow=false;center=Math.max(route.start,Math.min(route.end-1,center-dx/el.clientWidth*span*route.direction));render()}else if(!moved&&Math.abs(dy)<10){const r=range(center,span),x=Math.max(0,Math.min(1,(e.clientX-el.getBoundingClientRect().left)/el.clientWidth));selection=r.start+x*route.direction*r.span;detail();chart(el,r)}}pointers.delete(e.pointerId);if(!pointers.size)down=null;
  }
  el.addEventListener('pointerup',e=>release(e));el.addEventListener('pointercancel',e=>release(e,true));el.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();shift(e.key==='ArrowRight'?1:-1)}};
  $('driverCloseDetail').onclick=()=>{selection=null;$('driverDetail').hidden=true;chart(el,range(center,span))};
  let frame=0;document.addEventListener('regimechange',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update)});const resize=new ResizeObserver(()=>{if(route){chart(el,range(center,span));if(selection!==null)detail()}});resize.observe(el);
  window.addEventListener('pagehide',()=>{destroyed=true;obs.disconnect();resize.disconnect();urls.forEach(url=>URL.revokeObjectURL(url))},{once:true});
  update();
 }
 root.DriverProfile={create,geometry,curveY,landmarkLayout,createPageStore};
})(typeof globalThis!=='undefined'?globalThis:this);
