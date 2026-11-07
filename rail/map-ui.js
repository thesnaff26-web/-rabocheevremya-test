/* Compact warning drawer; the rail profile stays visible and unchanged. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
function init(){
 const profile=$('driverPanel');if(!profile||$('mapQuickNav'))return;
 const nav=document.createElement('div');nav.id='mapQuickNav';
 nav.innerHTML='<button type="button" id="mapWarningsToggle" aria-expanded="false" aria-controls="mapWarningDrawer">⚠ Предупреждения <span id="mapWarningCount">0</span></button>';
 profile.before(nav);
 const drawer=document.createElement('div');drawer.id='mapWarningDrawer';drawer.hidden=true;
 drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','Предупреждения');
 drawer.innerHTML='<div class="mapDrawerShade" id="mapDrawerShade"></div><div class="mapDrawerSheet"><div class="mapDrawerHead"><strong>Предупреждения</strong><button type="button" id="mapCloseDrawer" aria-label="Закрыть предупреждения">×</button></div><div id="mapDrawerContent"></div></div>';
 document.body.append(drawer);
 const manager=()=>$('userSpeedManager');
 const trigger=$('mapWarningsToggle');
 let ready=false,open=false;
 function close(){drawer.hidden=true;document.body.classList.remove('mapDrawerOpen');trigger.setAttribute('aria-expanded','false');open=false;trigger.focus({preventScroll:true})}
 function show(){const m=manager();if(!m)return;drawer.hidden=false;document.body.classList.add('mapDrawerOpen');trigger.setAttribute('aria-expanded','true');m.open=true;open=true}
 trigger.onclick=show;$('mapCloseDrawer').onclick=close;$('mapDrawerShade').onclick=close;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)close()});
 function setup(m){
  if(ready)return;
  const form=$('userSpeedForm'),tabs=$('userSpeedTabs');
  if(!form||!tabs)return;
  ready=true;
  $('mapDrawerContent').append(m);m.hidden=false;m.open=true;
  // The drawer already has a clear heading; do not repeat it.
  const summary=m.querySelector(':scope > summary');if(summary)summary.hidden=true;
  const intro=m.querySelector(':scope > p.small');if(intro)intro.classList.add('mapSmallNotice');
  const actions=document.createElement('div');actions.className='mapWarningActions';
  actions.innerHTML='<button type="button" id="mapNewWarning">＋ Добавить</button>';
  tabs.before(actions);
  const tools=document.createElement('details');tools.className='mapAdvanced';
  tools.innerHTML='<summary>Резервная копия и сброс данных</summary>';
  // Preserve event handlers by moving their existing controls, not cloning them.
  const rows=new Set();
  for(const id of ['userSpeedExport','userSpeedImport','userResetTemp','userResetTp','userRestoreReset']){
    const el=$(id);if(!el)continue;
    const row=el.closest('.row');if(row&&row.parentElement===m)rows.add(row);
  }
  rows.forEach(row=>tools.append(row));m.append(tools);
  form.hidden=true;
  $('userSpeedAddTitle').textContent='Данные предупреждения';
  const reveal=()=>{form.hidden=false;requestAnimationFrame(()=>form.scrollIntoView({block:'start',behavior:'smooth'}))};
  $('mapNewWarning').onclick=()=>{$('userClearForm')?.click();reveal()};
  m.addEventListener('click',e=>{if(e.target.closest('[data-edit]'))requestAnimationFrame(reveal)});
  const cancel=document.createElement('button');cancel.id='mapCancelEditing';cancel.type='button';cancel.textContent='Отмена';
  $('userClearForm')?.after(cancel);cancel.onclick=()=>{$('userClearForm')?.click();form.hidden=true};
  const status=$('userSpeedStatus');
  form.addEventListener('submit',()=>setTimeout(()=>{if(status?.textContent==='Сохранено офлайн')form.hidden=true},40));
  // Keep switches and tabs already provided by the warning manager.
 }
 function sync(){
  const m=manager();if(!m)return;setup(m);
  const count=$('mapWarningCount');
  if(count){const n=[...m.querySelectorAll('.userSpeedCount')].reduce((a,e)=>a+(Number(e.textContent)||0),0);const next=String(n);if(count.textContent!==next)count.textContent=next}
 }
 new MutationObserver(sync).observe(document.body,{childList:true,subtree:true,characterData:true});
 sync();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

/* One consolidated offline-library sheet replaces the large download button. */
(function(){
 const $=id=>document.getElementById(id);
 async function init(){
  const select=$('driverRouteSelect'),old=$('driverDownload');
  if(!select||!old||$('offlineLibraryButton'))return;
  const button=document.createElement('button');button.type='button';button.id='offlineLibraryButton';button.textContent='Офлайн-профили';old.hidden=true;old.after(button);
  const sheet=document.createElement('div');sheet.id='offlineLibrary';sheet.hidden=true;
  sheet.innerHTML='<div class="offlineLibraryShade"></div><section class="offlineLibrarySheet" role="dialog" aria-modal="true" aria-label="Офлайн-профили"><header class="offlineLibraryHead"><b>Офлайн-профили</b><button id="offlineLibraryClose" type="button" aria-label="Закрыть">×</button></header><p class="offlineLibraryHint">Сохраняйте направления для работы без интернета.</p><div id="offlineLibraryList" aria-live="polite">Проверка сохранённых листов…</div><p id="offlineLibraryProgress" role="status"></p></section>';
  document.body.append(sheet);
  const close=()=>{sheet.hidden=true;document.body.classList.remove('offlineLibraryOpen')};
  button.onclick=()=>{sheet.hidden=false;document.body.classList.add('offlineLibraryOpen');refresh()};
  $('offlineLibraryClose').onclick=close;sheet.querySelector('.offlineLibraryShade').onclick=close;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)close()});
  let catalog=null,busy=false,refreshToken=0;
  const label=r=>r.name.replace(/ · (чётный|нечётный) путь/,'');
  const root=new URL('./',document.baseURI);
  const fmt=(n,total)=>!total?'Нет листов':n===total?'✓ Скачан':n===0?'Не скачан':n+' из '+total+' листов';
  async function getCatalog(){
   if(catalog)return catalog;
   const response=await fetch(new URL('rail/regime-catalog.json',root));
   if(!response.ok)throw Error('Каталог участков недоступен');
   catalog=await response.json();return catalog;
  }
  async function statuses(){
   const data=await getCatalog();
   if(!('caches' in window))throw Error('Офлайн-хранилище недоступно');
   const cache=await caches.open('rabochee-regime-documents-v1');
   return Promise.all(data.routes.map(async r=>{
    const doc=data.documents.find(d=>d.id===r.document);
    const pages=doc.leaves.filter(p=>p.kind==='profile'&&p.route===r.id);
    let count=0;
    for(const p of pages){
      const hit=await cache.match(new URL(p.file,root).href);
      if(hit?.headers.get('X-Regime-SHA256')===p.sha256)count++;
    }
    return {route:r,done:count,total:pages.length};
   }));
  }
  async function refresh(){
   const token=++refreshToken,list=$('offlineLibraryList');
   try{
    const stats=await statuses();if(token!==refreshToken)return;
    const complete=stats.filter(x=>x.total&&x.done===x.total).length;
    button.textContent='Офлайн · '+complete+'/'+stats.length;
    // iPhone's native selector supports plain text labels, unlike styled badges.
    for(const option of select.options){
      const stat=stats.find(x=>x.route.id===option.value);
      if(stat)option.textContent=label(stat.route)+(stat.done===stat.total?' ✓':stat.done?' ◐':'');
    }
    list.replaceChildren();
    for(const item of stats){
      const row=document.createElement('div');row.className='offlineLibraryRow';
      const info=document.createElement('div');info.className='offlineLibraryInfo';
      const title=document.createElement('strong');title.textContent=label(item.route);
      const status=document.createElement('small');status.textContent=fmt(item.done,item.total);
      info.append(title,status);
      const action=document.createElement('button');action.type='button';
      action.textContent=item.done>0?'Удалить':'Скачать';
      if(item.done>0)action.classList.add('offlineDelete');
      action.disabled=busy;
      action.onclick=()=>item.done>0?removeOffline(item.route.id):start(item.route.id);
      row.append(info,action);list.append(row);
    }
   }catch(e){if(token===refreshToken)list.textContent='Не удалось проверить профили: '+e.message}
  }
  async function removeOffline(id){
   if(busy)return;
   const data=await getCatalog();
   const chosen=data.routes.find(r=>r.id===id);
   if(!chosen)return;
   const doc=data.documents.find(d=>d.id===chosen.document);
   if(!doc)return;
   const pages=doc.leaves.filter(p=>p.kind==='profile'&&p.route===id);
   const others=new Set(data.routes.filter(r=>r.id!==id).flatMap(r=>{
      const d=data.documents.find(x=>x.id===r.document);
      return d?d.leaves.filter(p=>p.kind==='profile'&&p.route===r.id).map(p=>p.file):[];
   }));
   const exclusive=pages.filter(p=>!others.has(p.file));
   if(!exclusive.length){$('offlineLibraryProgress').textContent='Нет отдельных файлов для удаления.';return}
   if(!confirm('Удалить офлайн-профиль «'+label(chosen)+'» с этого устройства? После удаления для просмотра несохранённых листов потребуется интернет. Другие направления и маршруты останутся.'))return;
   busy=true;
   $('offlineLibraryProgress').textContent='Удаляем сохранённые листы…';
   try{
     const cache=await caches.open('rabochee-regime-documents-v1');
     let removed=0;
     for(const page of exclusive){
       const url=new URL(page.file,root).href;
       if(await cache.delete(url))removed++;
     }
     $('offlineLibraryProgress').textContent='Удалено листов: '+removed+'. Данные маршрутов сохранены.';
   }catch(e){$('offlineLibraryProgress').textContent='Не удалось удалить: '+e.message}
   finally{busy=false;await refresh()}
  }
  async function start(id){
   if(busy)return;
   if(!navigator.onLine){$('offlineLibraryProgress').textContent='Нет подключения к интернету';return}
   const save=$('regimeSave');if(!save||save.disabled){$('offlineLibraryProgress').textContent='Скачивание сейчас недоступно';return}
   busy=true;
   // Select the requested route through the existing verified downloader.
   select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));
   $('offlineLibraryProgress').textContent='Начинаем сохранение…';
   save.click();
   const progress=$('regimeOffline');
   const watcher=setInterval(()=>{
      $('offlineLibraryProgress').textContent=progress?.textContent||'Сохраняем…';
      if(!save.disabled){
       clearInterval(watcher);busy=false;refresh();
      }
   },500);
   refresh();
  }
  document.addEventListener('railroutechanged',()=>{refresh().catch(()=>{})});
  document.addEventListener('regimepagesready',()=>{if(!sheet.hidden)refresh().catch(()=>{})});
  window.addEventListener('focus',()=>refresh());
  refresh();
 }
 let booted=false;
 function startWhenReady(){
   if(booted)return;
   if(!$('driverRouteSelect')||!$('driverDownload'))return;
   booted=true;observer.disconnect();init().catch(e=>console.error('Офлайн-профили:',e));
 }
 const observer=new MutationObserver(startWhenReady);
 observer.observe(document.documentElement,{childList:true,subtree:true});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startWhenReady,{once:true});
 startWhenReady();
})();
