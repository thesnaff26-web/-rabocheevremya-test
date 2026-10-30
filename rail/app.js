(async function(){
 'use strict';const $=id=>document.getElementById(id),C=RailCore;let data,baseData,anchors=[],map,regime,gps,rawHint=null,rawFix=null,liveFix=null,center=6906000;
 const low=5639000,high=8537600;
 function node(tag,attrs,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n}
 function showError(message){$('error').textContent=message}
 function render(syncRegime=true){
  if(!data)return;if(syncRegime)regime?.go(center);if(regime)$('gpsPath').textContent='Выбран путь: '+regime.catalog.routes.find(r=>r.id===regime.state().routeId).name;$('viewRange').value=center;$('centerLabel').textContent='Архив · '+(center/1000).toFixed(1)+' км · не текущая позиция';
  const lo=Math.max(low,center-5000),hi=Math.min(high,center+5000),svg=$('profile');svg.replaceChildren();
  const ranges=C.coverage(data);const x=m=>38+(m-lo)/(hi-lo)*645;
  for(let i=0;i<6;i++){const m=lo+(hi-lo)*i/5;svg.append(node('line',{x1:x(m),x2:x(m),y1:18,y2:187,class:'grid'}));svg.append(node('text',{x:x(m),y:208,'text-anchor':'middle',class:'axis'},(m/1000).toFixed(1)))}
  // Each disconnected run has its own relative-height origin. Unknown stretches remain blank.
  let chunks=[],run=[],height=0,lastEnd=null;
  const gs=data.sections.flatMap(s=>s.grades).filter(g=>g[0]<hi&&g[1]>lo).sort((a,b)=>a[0]-b[0]);
  for(const g of gs){const a=Math.max(lo,g[0]),b=Math.min(hi,g[1]);if(b<=a)continue;if(lastEnd===null||a>lastEnd+.1){if(run.length)chunks.push(run);run=[];height=0;run.push([a,0])}else if(a<lastEnd-.1)continue;height+=g[2]*(b-a)/1000;run.push([b,height]);lastEnd=b}if(run.length)chunks.push(run);
  const heights=chunks.flatMap(r=>r.map(p=>p[1]));const min=heights.length?Math.min(...heights):0,max=heights.length?Math.max(...heights):1,range=Math.max(10,max-min),y=h=>180-(h-min)/range*145;
  for(let i=0;i<3;i++){const h=min+range*i/2;svg.append(node('line',{x1:38,x2:683,y1:y(h),y2:y(h),class:'grid'}));svg.append(node('text',{x:3,y:y(h)+4,class:'axis'},Math.round(h)+'м'))}
  for(const run of chunks)svg.append(node('polyline',{points:run.map(p=>x(p[0])+','+y(p[1])).join(' '),class:'profileLine'}));
  let gaps=[],cursor=lo;for(const r of ranges){if(r[1]<=lo||r[0]>=hi)continue;const a=Math.max(lo,r[0]),b=Math.min(hi,r[1]);if(a>cursor)gaps.push([cursor,a]);cursor=Math.max(cursor,b)}if(cursor<hi)gaps.push([cursor,hi]);
  for(const [a,b] of gaps){svg.append(node('rect',{x:x(a),y:18,width:Math.max(0,x(b)-x(a)),height:169,fill:'var(--warn)',opacity:'.06'}));if(b-a>1000)svg.append(node('text',{x:(x(a)+x(b))/2,y:100,'text-anchor':'middle',class:'gap'},'Нет данных профиля'))}
  svg.append(node('line',{x1:x(center),x2:x(center),y1:16,y2:190,class:'marker'}));
  const grade=C.gradeAt(data,center);$('grade').textContent=grade?'В точке просмотра: '+(grade.grade>0?'+':'')+grade.grade.toFixed(1)+' ‰ · знак и актуальность не проверены':'В точке просмотра нет данных об уклоне.';
  const stations=data.sections.flatMap(s=>s.stations).sort((a,b)=>Math.abs(a[0]-center)-Math.abs(b[0]-center)),unique=[];
  for(const s of stations){if(!unique.some(v=>v[1]===s[1]&&Math.abs(v[0]-s[0])<15000))unique.push(s);if(unique.length===4)break}
  $('nearStations').replaceChildren();$('nearStations').className='';for(const [m,name] of unique){let row=document.createElement('div'),a=document.createElement('b'),b=document.createElement('span');row.className='station';a.textContent=name;b.textContent=C.format(m);row.append(a,b);$('nearStations').append(row)}
 }
 function move(m){if(gps?.isActive())gps.stop('Автоследование приостановлено для ручного просмотра.');if(!Number.isFinite(m)||m<low||m>high){showError('Введите километр от 5639 до 8537,6.');return}showError('');center=m;map?.select(center);render()}
 // Manual navigation pauses the optional GPS following session.
 $('viewRange').oninput=e=>move(+e.target.value);$('prev').onclick=()=>move(Math.max(low,center-5000));$('next').onclick=()=>move(Math.min(high,center+5000));$('go').onclick=()=>move(parseFloat($('manualKm').value.replace(',','.'))*1000);$('manualKm').onkeydown=e=>{if(e.key==='Enter')$('go').click()};$('stations').onchange=e=>{if(e.target.value)move(+e.target.value)};
 try{
  const response=await fetch('./rail/corridor.json');if(!response.ok)throw Error('База недоступна: '+response.status);baseData=C.validate(await response.json());
  try{const saved=JSON.parse(localStorage.getItem(RailCalibration.KEY)||'[]');if(Array.isArray(saved))anchors=saved.slice(-50)}catch(_){}
  data=RailCalibration.apply(baseData,anchors,C);
  $('anchorStatus').textContent='На этом телефоне сохранено привязок: '+anchors.length+'.';
  $('status').textContent='Выберите чётный или нечётный путь. Участок определяется по GPS. Км/ПК будет приблизительным.';
  ['viewRange','stations','go','prev','next'].forEach(id=>$(id).disabled=false);
  const list=data.sections.flatMap(s=>s.stations).sort((a,b)=>a[0]-b[0]),names=new Set();
  for(const [m,name] of list){if(names.has(name))continue;names.add(name);const o=document.createElement('option');o.value=m;o.textContent=name+' · '+Math.floor(m/1000)+' км';$('stations').append(o)}
  $('coverage').textContent='Исходная база: '+data.sections.length+' части, '+data.sections.reduce((n,s)=>n+s.points.length,0)+' координатных точек. Покрытие профиля: '+C.coverage(data).map(r=>(r[0]/1000).toFixed(1)+'–'+(r[1]/1000).toFixed(1)+' км').join('; ')+'.';
  for(const [i,s] of data.sections.entries()){let p=document.createElement('p'),a=document.createElement('a');a.href=s.source;a.textContent='Исходная электронная карта · часть '+(i+1);a.rel='noopener';a.target='_blank';p.append(a);$('sources').append(p)}
  map=RailMap.create($('routeMap'),data,move,message=>{$('mapMessage').textContent=message});
  map.select(center);$('mapPlus').disabled=false;$('mapMinus').disabled=false;$('mapAll').disabled=false;
  $('mapPlus').onclick=map.zoomIn;$('mapMinus').onclick=map.zoomOut;$('mapAll').onclick=map.overview;
  try{regime=await RegimeViewer.create(m=>{if(gps?.isActive())gps.stop('Автоследование приостановлено для ручного просмотра.');if(m>=low&&m<=high){center=m;map?.select(center);render(false)}});if(regime&&window.DriverProfile)DriverProfile.create(regime)}catch(e){$('regimeStatus').textContent='Не удалось открыть режимки: '+e.message}
  gps=RailGPS.create(data,{
   measure(position){rawFix=position;const c=position.coords;rawHint=C.overviewLocation(data,c.latitude,c.longitude,c.accuracy);$('gpsDiagnostic').textContent='Координаты телефона: '+c.latitude.toFixed(6)+', '+c.longitude.toFixed(6)+'. Измерение: '+new Date(position.timestamp).toLocaleTimeString();},
   fix(fix){liveFix=fix;$('position').textContent='≈ '+C.formatPicket(fix.chain);$('accuracy').textContent=Math.round(fix.accuracy)+' м';$('offset').textContent=Math.round(fix.distance)+' м';$('speed').textContent=fix.speed===null?'—':Math.round(fix.speed*3.6)+' км/ч';$('status').textContent='Автоследование · оценка по непроверенной координатной базе. Проверьте выбранное направление и путь.';center=fix.chain;map?.select(center);render(false);$('centerLabel').textContent='GPS ≈ '+C.formatPicket(center);regime?.goLive(center,fix.accuracy)},
   lost(reason,details={}){liveFix=null;$('position').textContent='Км/ПК не определён';const c=rawFix?.coords,fresh=rawFix&&Date.now()-rawFix.timestamp<=10000;$('offset').textContent=Number.isFinite(details.distance)?Math.round(details.distance)+' м':'—';$('speed').textContent=fresh&&Number.isFinite(c.speed)&&c.speed>=0?Math.round(c.speed*3.6)+' км/ч':'—';$('accuracy').textContent=fresh&&Number.isFinite(c.accuracy)?Math.round(c.accuracy)+' м':'—';$('status').textContent=reason;if(fresh&&rawHint&&gps?.isActive()){regime?.previewLive(rawHint.chain);$('gpsPath').textContent='Участок по GPS: '+regime.catalog.routes.find(r=>r.id===regime.state().routeId).name;$('status').textContent=reason+' Участок выбран по GPS; обзор приблизительный.';}else regime?.suspendLive(reason);$('centerLabel').textContent='Просмотр · '+(center/1000).toFixed(1)+' км · не текущая позиция'},
   state(active){$('start').disabled=active||!regime;$('stop').disabled=!active}
  });
  function restartGPS(){if(gps.isActive()){$('start').onclick()}}
  $('anchorSave').onclick=()=>{try{
   const m=RegimeCore.parsePosition($('anchorKm').value,$('anchorPk').value,$('anchorMetres').value);
   if(!regime.catalog.routes.some(r=>r.start<=m&&m<r.end))throw Error('В режимках нет этого километра.');
   if(!gps.isActive())throw Error('Включите GPS перед сохранением привязки.');
   const anchor=RailCalibration.makeAnchor(baseData,m,rawFix,C),next=anchors.filter(a=>a.section!==anchor.section||Math.abs(a.chain-anchor.chain)>=5).concat(anchor).slice(-50),updated=RailCalibration.apply(baseData,next,C);
   localStorage.setItem(RailCalibration.KEY,JSON.stringify(next));anchors=next;data.sections=updated.sections;
   $('anchorStatus').textContent='Сохранена локальная привязка: '+C.format(m)+'. Ожидаем устойчивую GPS-привязку.';restartGPS();
  }catch(e){$('anchorStatus').textContent='Привязка не сохранена: '+e.message}};
  $('anchorRemove').onclick=()=>{try{localStorage.removeItem(RailCalibration.KEY);anchors=[];data.sections=RailCalibration.apply(baseData,[],C).sections;$('anchorStatus').textContent='Локальные GPS-привязки сброшены.';restartGPS()}catch(e){$('anchorStatus').textContent='Не удалось сбросить: '+e.message}};
  $('start').disabled=!regime;$('start').onclick=()=>{rawHint=null;rawFix=null;$('gpsDiagnostic').textContent='Ожидаем координаты телефона…';regime?.beginLive();gps.start()};$('stop').onclick=()=>gps.stop();
  window.addEventListener('pagehide',()=>gps.stop());document.addEventListener('visibilitychange',()=>{if(document.hidden)gps.stop('Экран скрыт: GPS приостановлен. Включите следование после возвращения.')});
  render();
  if('serviceWorker'in navigator) navigator.serviceWorker.register('./service-worker.js?v=1046', {updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(updateNetwork).catch(updateNetwork);
  updateNetwork();
 }catch(e){['start','viewRange','stations','go','prev','next','mapPlus','mapMinus','mapAll'].forEach(id=>$(id).disabled=true);showError('Не удалось открыть карту. Подключитесь к сети и повторно откройте раздел. '+e.message);$('status').textContent='База не загружена.'}
 async function updateNetwork(){
  let ready=false;
  try{if('caches'in window){const cache=await caches.open('rabochee-vremya-v42-driver-20261031');ready=(await Promise.all(['./track-profile.html','./rail/core.js','./rail/map.js','./rail/app.js','./rail/corridor.json','./rail/gps.js','./rail/calibration.js','./rail/regime-core.js','./rail/regime.js','./rail/regime-catalog.json','./rail/driver-profile.js','./rail/driver-profile.css'].map(p=>cache.match(p)))).every(Boolean)}}catch(_){}
  $('offline').textContent=(navigator.onLine?'Интернет доступен. ':'Нет сети. ')+(ready?'Файлы раздела сохранены для офлайн-работы.':'Офлайн-копия ещё не подтверждена. Откройте раздел с интернетом после обновления приложения.');
 }
 navigator.serviceWorker?.addEventListener('controllerchange',updateNetwork);
 window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);
})();
