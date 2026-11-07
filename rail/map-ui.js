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