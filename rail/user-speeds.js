(function(root){
'use strict';
// User-managed, offline-only rail speed annotations. No operational values are inferred.
const KEY='rail-user-speeds-v1', $=id=>document.getElementById(id);
const VIS_KEY='rail-user-speed-visible-categories-v1';
const PERMANENT_COLORS={passenger:'#60a5fa',freight:'#fbbf24',empty:'#c4b5fd',all:'#f1f5f9'};
let permanentVisible={passenger:true,freight:true,empty:true};
try{const saved=JSON.parse(localStorage.getItem(VIS_KEY)||'null');if(saved&&typeof saved==='object')for(const k of ['passenger','freight','empty'])if(typeof saved[k]==='boolean')permanentVisible[k]=saved[k]}catch(_){}
let records=[],route=null,category='freight',selectedTab='permanent',shown={permanent:true,temporary:true,tp:true},lastPosition=null,rerender=()=>{};
try { const a=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(a))records=a.filter(valid); } catch(e){console.warn('Скорости: база недоступна',e);}
function valid(a){return a&&typeof a.id==='string'&&typeof a.routeId==='string'&&['permanent','temporary','tp'].includes(a.type)&&Number.isFinite(a.start)&&(a.type==='tp'?(Number.isFinite(a.lower)&&Number.isFinite(a.raise)):((a.end==null||Number.isFinite(a.end))&&Number.isFinite(a.speed)&&a.speed>0));}
function persist(){localStorage.setItem(KEY,JSON.stringify(records));rerender();list();}
function metres(km,pk){const k=Number(km),p=Number(pk);if(!Number.isInteger(k)||!Number.isInteger(p)||p<1||p>10||k<5000||k>9000)throw Error('Проверьте километр и пикет (1–10)');return k*1000+(p-1)*100;}
function stamp(s){if(!s||typeof s!=='string')return null;const n=Date.parse(s+':00+03:00');return Number.isFinite(n)?n:null;}
function status(a){if(a.type==='permanent')return 'active';if(!a.begin||(!a.untilCancel&&!a.endTime))return 'unverified';const now=Date.now(),begin=stamp(a.begin),end=a.untilCancel?null:stamp(a.endTime);if(begin!==null&&now<begin)return 'upcoming';if(end!==null&&now>end)return 'expired';return 'active';}
function active(a){return status(a)==='active';}
function nowMoscow(){return new Date(Date.now()+3*3600000).toISOString().slice(0,16);}
function statusLabel(a){const s=status(a);return s==='upcoming'?'Ещё не началось (МСК)':s==='expired'?'Срок истёк (МСК)':s==='unverified'?'Время не указано — проверьте':'Действует по времени (МСК)';}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function prettyMsk(value){const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);return m?m[3]+'.'+m[2]+'.'+m[1]+' · '+m[4]+':'+m[5]+' МСК':String(value||'');}
function point(a){if(!Number.isFinite(a))return 'граница не указана';const km=Math.floor(a/1000),pk=Math.floor(a%1000/100)+1;return km+' км ПК'+pk;}
function categoryName(s){return {passenger:'Пассажирский',freight:'Грузовой',empty:'Порожний',all:'Все'}[s]||s;}
function setTab(type,resetForm=true){
 if(!['permanent','temporary','tp'].includes(type))return;
 selectedTab=type;
 const f=$('userSpeedForm');
 if(f&&resetForm){f.reset();f.elements.uid.value='';f.elements.kind.value=type;if(type!=='permanent')f.elements.begin.value=nowMoscow();toggle();syncTimeButtons();}
 list();
 if(root.UserSpeedImporter)root.UserSpeedImporter.setTab(type);
}
function sortingInfo(a){
 const direction=route&&route.direction===-1?-1:1;
 const orderedStart=a.start*direction;
 const gpsValid=lastPosition&&lastPosition.mode==='gps'&&lastPosition.valid&&Number.isFinite(lastPosition.chain);
 if(!gpsValid)return {rank:0,dist:orderedStart,second:orderedStart};
 const here=lastPosition.chain*direction;
 const start=a.start*direction;
 // An interval that contains our location comes before any approaching interval.
 const finish=(a.type==='tp'?a.raise:a.end);
 const min=finish==null?start:Math.min(start,finish*direction);
 const max=finish==null?start:Math.max(start,finish*direction);
 if(min<=here&&max>=here)return {rank:0,dist:0,second:start};
 if(min>here)return {rank:1,dist:min-here,second:start};
 // Passed records remain listed, after all upcoming records.
 return {rank:2,dist:here-max,second:-max};
}
function list(){
 const el=$('userSpeedList');if(!el)return;
 const sameRoute=records.filter(a=>!route||a.routeId===route.id);
 const selection=sameRoute.filter(a=>a.type===selectedTab).sort((a,b)=>{
  const x=sortingInfo(a),y=sortingInfo(b);
  return x.rank-y.rank||x.dist-y.dist||x.second-y.second||a.id.localeCompare(b.id);
 });
 const names={permanent:'Постоянные скорости',temporary:'Временные предупреждения',tp:'Опускание ТП'};
 const counters={permanent:0,temporary:0,tp:0};
 for(const record of sameRoute)counters[record.type]=(counters[record.type]||0)+1;
 for(const b of document.querySelectorAll('#userSpeedTabs [data-tab]')){
  const type=b.dataset.tab,selected=type===selectedTab;
  b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));b.setAttribute('tabindex',selected?'0':'-1');
  const count=b.querySelector('.userSpeedCount');if(count)count.textContent=String(counters[type]||0);
 }
 const heading=$('userSpeedListTitle');if(heading)heading.textContent=names[selectedTab];
 const addTitle=$('userSpeedAddTitle');if(addTitle)addTitle.textContent='Добавить / изменить: '+names[selectedTab].toLowerCase();
 if($('userSpeedForm')&&!$('userSpeedForm').elements.uid.value&&$('userSpeedForm').elements.kind.value!==selectedTab){
  $('userSpeedForm').elements.kind.value=selectedTab;toggle();
 }
 el.innerHTML=selection.length?selection.map(a=>'<div class="userSpeedItem"><div><b>'+esc(a.type==='tp'?'ТП · 3 точки':a.speed+' км/ч')+'</b> · '+esc(a.type==='permanent'?'Постоянная':a.type==='temporary'?'Временная':'Токоприёмник')+'<small>'+esc(point(a.start))+(a.type==='tp'?' → '+point(a.lower)+' → '+point(a.raise):a.end==null?' · конец не указан':' — '+point(a.end))+' · '+esc(a.category==='all'?'Все категории':categoryName(a.category||'all'))+(a.begin?' · '+esc(prettyMsk(a.begin)):'')+(a.type==='permanent'?'':' · '+statusLabel(a))+'</small></div><div><button type="button" data-edit="'+esc(a.id)+'">Править</button><button type="button" data-del="'+esc(a.id)+'">Удалить</button></div></div>').join(''):'<p class="userSpeedEmpty">В разделе «'+esc(names[selectedTab])+'» пока нет записей.</p>';
 el.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{if(confirm('Удалить эту запись?')){records=records.filter(a=>a.id!==b.dataset.del);persist()}});
 el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));
}
function edit(id){const a=records.find(x=>x.id===id);if(!a)return;setTab(a.type,false);const f=$('userSpeedForm');f.elements.uid.value=a.id;f.elements.kind.value=a.type;f.elements.train.value=a.category||'all';f.elements.speed.value=a.speed??'';f.elements.km1.value=Math.floor(a.start/1000);f.elements.pk1.value=Math.floor(a.start%1000/100)+1;f.elements.km2.value=a.end!=null?Math.floor(a.end/1000):'';f.elements.pk2.value=a.end!=null?Math.floor(a.end%1000/100)+1:'';f.elements.tpKm2.value=Math.floor((a.lower??a.end)/1000);f.elements.tpPk2.value=Math.floor((a.lower??a.end)%1000/100)+1;f.elements.km3.value=Math.floor((a.raise??a.end??a.start)/1000);f.elements.pk3.value=Math.floor((a.raise??a.end??a.start)%1000/100)+1;f.elements.pole1.value=a.pole1||'';f.elements.pole2.value=a.pole2||'';f.elements.pole3.value=a.pole3||'';f.elements.begin.value=a.begin||'';f.elements.endTime.value=a.endTime||'';f.elements.untilCancel.checked=!!a.untilCancel;toggle();syncTimeButtons();$('userSpeedManager').open=true;f.scrollIntoView({block:'nearest',behavior:'smooth'});}
function toggle(){const f=$('userSpeedForm'),tp=f.elements.kind.value==='tp',perm=f.elements.kind.value==='permanent';$('userTpFields').hidden=!tp;$('userEndFields').hidden=tp;$('userSpeedFields').hidden=tp;$('userTimeFields').hidden=perm;$('userEndTime').hidden=f.elements.untilCancel.checked;f.elements.speed.disabled=tp;f.elements.km2.disabled=tp;f.elements.pk2.disabled=tp;f.elements.tpKm2.disabled=!tp;f.elements.tpPk2.disabled=!tp;f.elements.km3.disabled=!tp;f.elements.pk3.disabled=!tp;}

function syncTimeButtons(){const f=$('userSpeedForm');if(!f)return;for(const key of ['begin','endTime']){const b=document.querySelector('#userSpeedForm [data-time="'+key+'"]');if(b)b.textContent=f.elements[key].value?prettyMsk(f.elements[key].value):'Выбрать дату и время';}}
function initTimePicker(){
 const f=$('userSpeedForm'),overlay=$('userTimeOverlay'),pad=n=>String(n).padStart(2,'0');
 let key=null;
 const names=['Day','Month','Year','Hour','Minute'],wheels=Object.fromEntries(names.map(n=>[n,$('userWheel'+n)]));
 const step=54,mid=2;
 function value(name){const el=wheels[name],i=Math.max(0,Math.min(el.children.length-1,Math.round(el.scrollTop/step)));return Number(el.children[i]?.dataset.value)||0}
 function fillWheel(name,values,chosen,loop=true){
  const el=wheels[name],frag=document.createDocumentFragment();el.replaceChildren();el.dataset.count=String(values.length);el.dataset.loop=loop?'1':'0';
  for(let cycle=0;cycle<(loop?5:1);cycle++)for(const v of values){const d=document.createElement('div');d.className='userWheelItem';d.dataset.value=String(v);d.textContent=name==='Year'?String(v):pad(v);frag.append(d)}
  el.append(frag);return ((loop?mid*values.length:0)+Math.max(0,values.indexOf(chosen)))*step;
 }
 function fill(s){
  const v=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s||'')?s:nowMoscow();
  const [d,t]=v.split('T'),[y,mo,day]=d.split('-').map(Number),[h,mi]=t.split(':').map(Number);
  const positions={Year:fillWheel('Year',Array.from({length:301},(_,i)=>1900+i),y,false),Month:fillWheel('Month',Array.from({length:12},(_,i)=>i+1),mo),Day:fillWheel('Day',Array.from({length:new Date(y,mo,0).getDate()},(_,i)=>i+1),day),Hour:fillWheel('Hour',Array.from({length:24},(_,i)=>i),h),Minute:fillWheel('Minute',Array.from({length:60},(_,i)=>i),mi)};
  requestAnimationFrame(()=>{for(const n of names)wheels[n].scrollTop=positions[n]});
 }
 function recenter(name){
  const el=wheels[name];if(el.dataset.loop!=='1')return;
  const count=+el.dataset.count;if(!count)return;
  const ix=Math.round(el.scrollTop/step),local=((ix%count)+count)%count;
  const target=(mid*count+local)*step;
  if(Math.abs(el.scrollTop-target)>count*step)el.scrollTop=target;
 }
 function refreshDay(){
  const y=value('Year'),mo=value('Month');if(!y||!mo)return;
  const count=new Date(y,mo,0).getDate();
  if(count!==+wheels.Day.dataset.count){const current=value('Day'),pos=fillWheel('Day',Array.from({length:count},(_,i)=>i+1),Math.min(current||1,count));wheels.Day.scrollTop=pos}
 }
 for(const name of names)wheels[name].addEventListener('scroll',()=>{
  const el=wheels[name];clearTimeout(el._scrollTimer);el._scrollTimer=setTimeout(()=>{recenter(name);if(name==='Month'||name==='Year')refreshDay()},110);
 },{passive:true});
 const close=()=>{overlay.hidden=true;document.body.style.overflow='';key=null};
 document.querySelectorAll('#userSpeedForm [data-time]').forEach(b=>b.onclick=()=>{
  key=b.dataset.time;overlay.hidden=false;document.body.style.overflow='hidden';fill(f.elements[key].value);
 });
 $('userTimeCancel').onclick=close;
 $('userTimeDone').onclick=()=>{
  if(key){const y=value('Year'),mo=value('Month'),d=Math.min(value('Day'),new Date(y,mo,0).getDate()),h=value('Hour'),mi=value('Minute');f.elements[key].value=y+'-'+pad(mo)+'-'+pad(d)+'T'+pad(h)+':'+pad(mi);syncTimeButtons()}
  close();
 };
 $('userTimeClear').onclick=()=>{if(key){f.elements[key].value='';syncTimeButtons()}close()};
 overlay.onclick=e=>{if(e.target===overlay)close()};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
}
function init(){
 const panel=$('driverPanel');if(!panel||$('userSpeedManager'))return;
 const wrap=document.createElement('details');wrap.className='card';wrap.id='userSpeedManager';wrap.innerHTML=`<summary>Скорости и предупреждения · мои данные</summary>
 <p class="small">По умолчанию скорости отсутствуют. Данные хранятся на этом устройстве и не заменяют действующие официальные предупреждения. Время — только МСК.</p>
 <div class="userSpeedOptions"><label><input id="userShowPerm" type="checkbox" checked> Постоянные</label><label><input id="userShowTemp" type="checkbox" checked> Временные</label><label><input id="userShowTp" type="checkbox" checked> Токоприёмники</label></div>
 <fieldset class="userPermanentFilters"><legend>Постоянные скорости на карте</legend>
<label><input id="userPermPassenger" type="checkbox" data-perm-category="passenger"> <span class="permanentSwatch" style="--speed-color:#60a5fa"></span> Пассажирские</label>
<label><input id="userPermFreight" type="checkbox" data-perm-category="freight"> <span class="permanentSwatch" style="--speed-color:#fbbf24"></span> Грузовые</label>
<label><input id="userPermEmpty" type="checkbox" data-perm-category="empty"> <span class="permanentSwatch" style="--speed-color:#c4b5fd"></span> Порожние</label>
<p class="small">Галочки только скрывают или показывают скорости. Записи не удаляются. Цвета условные.</p></fieldset>
<label>Категория для временных предупреждений и ТП<select id="userSpeedCategory"><option value="freight">Грузовой</option><option value="passenger">Пассажирский</option><option value="empty">Порожний</option></select></label>
 <div class="userSpeedTabs" id="userSpeedTabs" role="tablist" aria-label="Разделы скоростей и предупреждений">
 <button type="button" role="tab" data-tab="permanent" aria-selected="true"><span>Постоянные скорости</span><span class="userSpeedCount">0</span></button>
 <button type="button" role="tab" data-tab="temporary" aria-selected="false"><span>Временные предупреждения</span><span class="userSpeedCount">0</span></button>
 <button type="button" role="tab" data-tab="tp" aria-selected="false"><span>Опускание ТП</span><span class="userSpeedCount">0</span></button></div>
 <h3 id="userSpeedListTitle">Постоянные скорости</h3><div id="userSpeedList" role="tabpanel"></div>
 <form id="userSpeedForm"><h3 id="userSpeedAddTitle">Добавить / изменить: постоянные скорости</h3><input type="hidden" name="uid">
 <input name="kind" type="hidden" value="permanent">
 <label>Категория поезда<select name="train"><option value="all">Все</option><option value="freight">Грузовой</option><option value="passenger">Пассажирский</option><option value="empty">Порожний</option></select></label>
 <div id="userSpeedFields"><label>Скорость, км/ч<input name="speed" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="3" required></label></div>
 <div class="userSpeedGrid"><label>Начало · км<input name="km1" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" min="5000" max="9000" required></label><label>ПК<input name="pk1" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="2" min="1" max="10" required></label></div>
 <div id="userEndFields"><p class="small">Конец необязателен. Без него на карте будет только точечная отметка, не участок ограничения.</p><div class="userSpeedGrid"><label>Конец · км<input name="km2" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" min="5000" max="9000"></label><label>ПК<input name="pk2" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="2" min="1" max="10"></label></div></div>
 <div id="userTpFields" hidden><p class="small">1 — приготовиться, 2 — опустить, 3 — поднять. Первая точка выше.</p><label>Опора · приготовиться<input name="pole1" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" placeholder="Номер опоры"></label><div class="userSpeedGrid"><label>Опустить · км<input name="tpKm2" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" min="5000" max="9000"></label><label>ПК<input name="tpPk2" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="2" min="1" max="10"></label></div><label>Опора · опустить<input name="pole2" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6"></label><div class="userSpeedGrid"><label>Поднять · км<input name="km3" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" min="5000" max="9000"></label><label>ПК<input name="pk3" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="2" min="1" max="10"></label></div><label>Опора · поднять<input name="pole3" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6"></label></div>
 <div id="userTimeFields" hidden><p class="small" id="userMoscowNow">Начало автоматически выставляется по Москве (UTC+3). При необходимости измените дату и время.</p>
 <label>Начало действия · МСК (необязательно)<input name="begin" type="hidden"><button type="button" class="userTimePick" data-time="begin">Выбрать дату и время</button></label>
 <label><input type="checkbox" name="untilCancel"> До отмены</label>
 <label id="userEndTime">Конец действия · МСК (необязательно)<input name="endTime" type="hidden"><button type="button" class="userTimePick" data-time="endTime">Выбрать дату и время</button></label>
 <p class="small">Если срок неизвестен, запись сохраняется как непроверенная и не считается действующей.</p></div>
 <div class="userTimeOverlay" id="userTimeOverlay" hidden><div class="userTimeSheet">
 <div class="userTimeHead"><button type="button" id="userTimeCancel">Отмена</button><b>Дата и время · МСК</b><button type="button" id="userTimeDone">Готово</button></div>
 <div class="userWheelLabels"><span>День</span><span>Месяц</span><span>Год</span><span>Час</span><span>Мин</span></div><div class="userWheelBody"><div class="userWheelFocus"></div><div class="userWheelCol" id="userWheelDay"></div><div class="userWheelCol" id="userWheelMonth"></div><div class="userWheelCol" id="userWheelYear"></div><div class="userWheelCol" id="userWheelHour"></div><div class="userWheelCol" id="userWheelMinute"></div></div>
 <div class="userTimeFoot"><button type="button" id="userTimeClear">Без времени</button></div></div></div>
 <button type="submit" class="primary">Сохранить запись</button><button type="button" id="userClearForm">Очистить форму</button><p id="userSpeedStatus" role="status"></p></form>
 <div class="row"><button id="userSpeedExport">Резервная копия JSON</button><label class="userImport">Импорт JSON<input type="file" id="userSpeedImport" accept="application/json,.json"></label></div>
  <div class="row"><button id="userResetTemp">Сбросить временные</button><button id="userResetPerm">Сбросить постоянные</button></div>`;
 panel.insertAdjacentElement('afterend',wrap);
 const f=$('userSpeedForm');
 // Keep the two kilometer/PK field pairs unique for form.elements.

 // Only digits are accepted in km, PK and support-number inputs, including pastes.
 for(const name of ['speed','km1','pk1','km2','pk2','tpKm2','tpPk2','km3','pk3','pole1','pole2','pole3']){
  const field=f.elements[name];
  field.addEventListener('input',()=>{const only=field.value.replace(/[^0-9]/g,'');if(field.value!==only)field.value=only.slice(0,field.maxLength>0?field.maxLength:undefined)});
 }
 const clear=()=>{f.reset();f.elements.uid.value='';f.elements.kind.value=selectedTab;if(selectedTab!=='permanent')f.elements.begin.value=nowMoscow();toggle();syncTimeButtons()};
 for(const btn of wrap.querySelectorAll('#userSpeedTabs [data-tab]'))btn.onclick=()=>setTab(btn.dataset.tab);
 f.elements.untilCancel.onchange=toggle;$('userClearForm').onclick=clear;
 $('userMoscowNow').textContent='Начало подставлено по МСК. При необходимости измените дату и время. Часовой пояс телефона не используется.';
 f.onsubmit=e=>{e.preventDefault();try{if(!route)throw Error('Сначала выберите путь');const type=f.elements.kind.value,start=metres(f.elements.km1.value,f.elements.pk1.value),end=type==='tp'?metres(f.elements.tpKm2.value,f.elements.tpPk2.value):(f.elements.km2.value!==''&&f.elements.pk2.value!==''?metres(f.elements.km2.value,f.elements.pk2.value):null),raise=type==='tp'?metres(f.elements.km3.value,f.elements.pk3.value):null;if(type!=='tp'&&(f.elements.km2.value!==''||f.elements.pk2.value!=='')&&end===null)throw Error('Заполните обе границы конца или оставьте их пустыми');const speed=type==='tp'?null:Number(f.elements.speed.value);if(type!=='tp'&&!(speed>=1&&speed<=200))throw Error('Неверная скорость');if(type!=='tp'&&end!==null&&start===end)throw Error('Укажите разные границы');if(type==='tp'&&(new Set([start,end,raise]).size!==3))throw Error('Укажите три разные точки');if(type==='tp'&&!((end-start)*route.direction>0&&(raise-end)*route.direction>0))throw Error('Точки ТП должны идти последовательно по выбранному направлению');const begin=f.elements.begin.value,endTime=f.elements.endTime.value,untilCancel=f.elements.untilCancel.checked;if(type!=='permanent'&&endTime&&!begin)throw Error('Для времени окончания укажите начало действия МСК');if(type!=='permanent'&&!untilCancel&&begin&&endTime&&stamp(endTime)<stamp(begin))throw Error('Конец раньше начала');const id=f.elements.uid.value||('s-'+Date.now()+'-'+Math.random().toString(36).slice(2));const a={id,routeId:route.id,type,category:f.elements.train.value,start,end:type==='tp'?undefined:end,lower:type==='tp'?end:undefined,raise,speed,pole1:f.elements.pole1.value,pole2:f.elements.pole2.value,pole3:f.elements.pole3.value,begin:type==='permanent'?'':begin,endTime:type==='permanent'?'':(untilCancel?'':endTime),untilCancel:type==='permanent'?false:untilCancel};records=records.filter(x=>x.id!==id);records.push(a);persist();clear();$('userSpeedStatus').textContent='Сохранено офлайн';}catch(err){$('userSpeedStatus').textContent=err.message;}};
 for(const [id,k] of [['userShowPerm','permanent'],['userShowTemp','temporary'],['userShowTp','tp']])$(id).onchange=e=>{shown[k]=e.target.checked;rerender()};
 $('userSpeedCategory').onchange=e=>{category=e.target.value;rerender()};
 for(const input of wrap.querySelectorAll('[data-perm-category]')){
  input.checked=permanentVisible[input.dataset.permCategory];
  input.onchange=()=>{permanentVisible[input.dataset.permCategory]=input.checked;try{localStorage.setItem(VIS_KEY,JSON.stringify(permanentVisible))}catch(_){}rerender()};
 }
 for(const [id,k] of [['userResetPerm','permanent'],['userResetTemp','temporary']])$(id).onclick=()=>{if(confirm('Удалить все '+(k==='permanent'?'постоянные скорости':'временные предупреждения')+' на этом устройстве?')){records=records.filter(a=>k==='permanent'?a.type!=='permanent':a.type==='permanent');persist()}};
 $('userSpeedExport').onclick=()=>{const blob=new Blob([JSON.stringify({format:'rail-user-speeds-v1',records},null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='rail-speeds-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)};
 $('userSpeedImport').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text());if(data.format!=='rail-user-speeds-v1'||!Array.isArray(data.records)||!data.records.every(valid))throw Error('Неподдерживаемая резервная копия');if(!confirm('Добавить '+data.records.length+' записей из копии? Существующие не будут удалены.'))return;const known=new Set(records.map(x=>x.id));records.push(...data.records.filter(x=>!known.has(x.id)));persist();}catch(err){alert('Ошибка импорта: '+err.message)}finally{e.target.value=''}};
 toggle();initTimePicker();syncTimeButtons();list();
 if(root.UserSpeedImporter){
  root.UserSpeedImporter.setup({
   tab:selectedTab,
   route:()=>route,
   save:rows=>{
    if(!route)throw Error('Сначала выберите путь');
    const ids=new Set(records.map(a=>[a.type,a.routeId,a.category,a.start,a.end,a.speed,a.begin,a.endTime,a.untilCancel].join('|')));
    let added=0,duplicates=0;
    for(const row of rows){
     if(row.type!==selectedTab||row.routeId!==route.id)throw Error('Раздел или направление изменились во время импорта');
     if(!['permanent','temporary'].includes(row.type)||!valid({...row,id:'import'}))throw Error('Недопустимые данные для импорта');
     const key=[row.type,row.routeId,row.category,row.start,row.end,row.speed,row.begin,row.endTime,row.untilCancel].join('|');
     if(ids.has(key)){duplicates++;continue}
     ids.add(key);
     records.push({...row,id:'imp-'+Date.now()+'-'+Math.random().toString(36).slice(2)});
     added++;
    }
    if(added)persist();
    return {added,duplicates};
   }
  });
  root.UserSpeedImporter.setTab(selectedTab);
 }
}

function distanceInfo(pos){
 let div=$('userSpeedDistance');if(!div){div=document.createElement('div');div.id='userSpeedDistance';div.className='userSpeedDistance';$('driverChart')?.insertAdjacentElement('beforebegin',div);}
 if(!div)return;
 if(!pos||!pos.valid||pos.mode!=='gps'||!Number.isFinite(pos.chain)){div.textContent='Расстояние до предупреждения: включите GPS и дождитесь подтверждённого км/ПК';return;}
 const next=records.filter(a=>a.routeId===route?.id&&a.type==='temporary'&&a.end!=null&&active(a)&&shown.temporary&&(a.category==='all'||a.category===category)).map(a=>({...a,dist:(a.start-pos.chain)*route.direction})).filter(a=>a.dist>=0).sort((a,b)=>a.dist-b.dist)[0];
 div.textContent=next?'До временного ограничения '+next.speed+' км/ч: ≈ '+(next.dist>=1000?(next.dist/1000).toFixed(2)+' км':Math.round(next.dist)+' м')+' (GPS)':'Впереди нет подтверждённых действующих временных ограничений в личной базе';
}
function render(el,r,currentRoute,cb,position){
 route=currentRoute;lastPosition=position||null;rerender=cb||(()=>{});init();list();
 const prev=el.querySelector('.userSpeedOverlay');if(prev)prev.remove();
 if(el.id==='driverChart')distanceInfo(position);
 if(!route)return;
 const manualPreview=el.id==='driverChart'&&typeof document!=='undefined'&&document.getElementById('driverMode')?.textContent?.includes('Ручной');
 const items=records.filter(a=>a.routeId===route.id&&shown[a.type]&&
  (a.type==='permanent'?(a.category==='all'||permanentVisible[a.category]===true):(a.category==='all'||a.category===category))&&
  (active(a)||manualPreview));
 const n=document.createElement('div');n.className='userSpeedOverlay';n.setAttribute('aria-hidden','true');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const w=Math.max(260,el.clientWidth||320);svg.setAttribute('viewBox','0 0 '+w+' 130');svg.setAttribute('preserveAspectRatio','none');n.append(svg);
 const NS='http://www.w3.org/2000/svg',make=(tag,attrs,str)=>{const node=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(str!=null)node.textContent=str;svg.append(node)};
 // Fixed vertical rows for each permanent train category plus one temporary row.
 const x=m=>(m-r.start)/route.direction/r.span*w;
 const rows={passenger:18,freight:39,empty:60,all:80,temporary:99,tp:120};
 const labels={passenger:[],freight:[],empty:[],all:[],temporary:[]};
 for(const line of [30,51,72,91,112])make('line',{x1:0,y1:line,x2:w,y2:line,stroke:'#658198','stroke-opacity':.22,'stroke-width':.8});
 for(const a of items){
  if(a.type==='tp'){
   for(const [m,color,t] of [[a.start,'#facc15','П'],[a.lower,'#fb7185','О'],[a.raise,'#4ade80','↑']]){
    const cx=x(m);if(cx<0||cx>w)continue;
    make('circle',{cx,cy:120,r:8,fill:active(a)?color:'#8493a3','fill-opacity':active(a)?1:.65});
    make('text',{x:cx,y:123,'text-anchor':'middle','font-size':11,'font-weight':800,fill:'#081321'},t);
   }
   continue;
  }
  const isPerm=a.type==='permanent',group=isPerm?(a.category||'all'):'temporary';
  if(!Object.prototype.hasOwnProperty.call(labels,group))continue;
  const sy=rows[group],x1=x(a.start),x2=a.end==null?x1:x(a.end);
  const left=Math.max(0,Math.min(x1,x2)),right=Math.min(w,Math.max(x1,x2));
  if(a.end!=null&&right<=left)continue;
  if(a.end==null&&(x1<0||x1>w))continue;
  const isActive=active(a);
  const color=!isActive?'#94a3b8':isPerm?PERMANENT_COLORS[group]:'#fb7185';
  if(a.end!=null){
   make('line',{x1:left,y1:sy,x2:right,y2:sy,stroke:color,'stroke-width':2.5,...(!isActive?{'stroke-dasharray':'5 4'}:{})});
   for(const xx of [left,right])make('line',{x1:xx,y1:sy,x2:xx,y2:sy+7,stroke:color,'stroke-width':1,'stroke-opacity':.45});
  }else make('circle',{cx:x1,cy:sy,r:4,fill:color});
  labels[group].push({at:a.end==null?x1:(left+right)/2,y:sy-3,color,value:String(a.speed)});
 }
 // Keep numerical labels at a fixed vertical level, spread nearby labels horizontally.
 for(const group of Object.values(labels)){
  group.sort((a,b)=>a.at-b.at);
  if(!group.length)continue;
  const labelGap=28;
  const maxLabels=Math.max(1,Math.floor((w-18)/labelGap));
  // Dense sections show each line but not an unreadable stack of overlapping digits.
  const visible=group.length<=maxLabels?group:group.filter((_,i)=>i%Math.ceil(group.length/maxLabels)===0);
  let prev=-Infinity;
  for(const item of visible){
   const px=Math.max(13,Math.min(w-13,item.at));
   const labelX=Math.min(w-13,Math.max(px,prev+labelGap));
   prev=labelX;
   if(Math.abs(labelX-item.at)>5)make('line',{x1:item.at,y1:item.y+3,x2:labelX,y2:item.y+3,stroke:item.color,'stroke-opacity':.5});
   make('text',{x:labelX,y:item.y,'text-anchor':'middle','font-size':17,'font-weight':900,fill:item.color,stroke:'#101d2c','stroke-width':2,'paint-order':'stroke'},item.value);
  }
 }
 el.append(n);
}
root.UserSpeeds={render};
})(typeof globalThis!=='undefined'?globalThis:this);
